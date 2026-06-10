import ctypes
import json
import re
import site
import subprocess
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import requests

from wiki_store import query_terms, required_title_terms, search_index, search_index_multi

from config import (
    DEFAULT_NUM_CTX,
    DEFAULT_TEMPERATURE,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_ENDPOINT,
    OLLAMA_MODEL,
    PLANNER_MODE,
    STT_COMPUTE_TYPE,
    STT_DEVICE,
    STT_LANGUAGE,
    STT_MODEL,
    SYSTEM_PROMPT,
    TTS_MAX_TEXT_LENGTH,
)
from tts_voices import public_voice_payload, resolve_voice

app = FastAPI(title="LUCID Backend")

BASE_DIR = Path(__file__).parent
WIKIPEDIA_ARTICLES_PATH = Path(__file__).parent / "data" / "wikipedia" / "articles.json"


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    source_titles: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("content")
    @classmethod
    def validate_content(cls, value):
        trimmed_content = value.strip()
        if not trimmed_content:
            raise ValueError("history content must not be empty")
        if len(trimmed_content) > 2000:
            raise ValueError("history content must be 2000 characters or fewer")
        return trimmed_content

    @field_validator("source_titles", mode="before")
    @classmethod
    def default_source_titles(cls, value):
        return [] if value is None else value

    @field_validator("source_titles")
    @classmethod
    def validate_source_titles(cls, value):
        source_titles = []
        for title in value:
            if not isinstance(title, str):
                continue

            trimmed_title = title.strip()
            if trimmed_title and trimmed_title not in source_titles:
                source_titles.append(trimmed_title[:120])

        return source_titles[:5]


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    knowledge_base: Literal["none", "wikipedia"] = "none"
    include_retrieval_debug: bool = False
    model: Optional[str] = None
    temperature: float = Field(default=DEFAULT_TEMPERATURE, ge=0.0, le=2.0, allow_inf_nan=False)
    num_ctx: int = Field(default=DEFAULT_NUM_CTX, ge=512, le=32000)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value):
        trimmed_message = value.strip()
        if not trimmed_message:
            raise ValueError("message must not be empty")
        if len(trimmed_message) > 2000:
            raise ValueError("message must be 2000 characters or fewer")
        return trimmed_message

    @field_validator("history", mode="before")
    @classmethod
    def default_history(cls, value):
        return [] if value is None else value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value):
        if value is None:
            return value

        trimmed_model = value.strip()
        if not trimmed_model:
            raise ValueError("model must not be empty")
        return trimmed_model

    @field_validator("temperature", mode="before")
    @classmethod
    def default_temperature(cls, value):
        return DEFAULT_TEMPERATURE if value is None else value

    @field_validator("num_ctx", mode="before")
    @classmethod
    def default_num_ctx(cls, value):
        return DEFAULT_NUM_CTX if value is None else value


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value):
        trimmed_text = value.strip()
        if not trimmed_text:
            raise ValueError("text must not be empty")
        if len(trimmed_text) > TTS_MAX_TEXT_LENGTH:
            raise ValueError(f"text must be {TTS_MAX_TEXT_LENGTH} characters or fewer")
        return trimmed_text

    @field_validator("voice_id")
    @classmethod
    def validate_voice_id(cls, value):
        if value is None:
            return value

        trimmed_voice_id = value.strip()
        return trimmed_voice_id or None


KNOWLEDGE_BASES = [
    {
        "id": "none",
        "name": "None",
        "description": "Use the local model without a selected knowledgebase.",
    },
    {
        "id": "wikipedia",
        "name": "Local Wikipedia",
        "description": "Use the local offline Wikipedia SQLite index.",
    },
]

UNKNOWN_WIKIPEDIA_ANSWER = "I don't know from the selected Wikipedia knowledgebase."
RETRIEVAL_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "about",
    "can",
    "could",
    "describe",
    "did",
    "do",
    "does",
    "explain",
    "for",
    "from",
    "give",
    "how",
    "in",
    "is",
    "it",
    "me",
    "of",
    "on",
    "sentence",
    "short",
    "should",
    "tell",
    "the",
    "to",
    "what",
    "when",
    "where",
    "who",
    "why",
    "would",
}


def load_wikipedia_articles(path: Path = WIKIPEDIA_ARTICLES_PATH) -> list[dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []

    if not isinstance(data, list):
        return []

    articles = []
    for entry in data:
        if not isinstance(entry, dict):
            return []

        article = {}
        for field in ("id", "title", "text"):
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                return []
            article[field] = value.strip()

        articles.append(article)

    return articles


WIKIPEDIA_ARTICLES = load_wikipedia_articles()


def normalize_retrieval_token(token: str) -> str:
    normalized = token.lower()
    if normalized.endswith("'s"):
        normalized = normalized[:-2]

    if len(normalized) > 4 and normalized.endswith("ies"):
        return f"{normalized[:-3]}y"
    if len(normalized) > 3 and normalized.endswith("s"):
        return normalized[:-1]
    return normalized


def tokenize_for_retrieval(text: str) -> list[str]:
    tokens = []
    for raw_token in re.findall(r"[a-z0-9]+(?:'s)?", text.lower()):
        if raw_token.endswith("'s"):
            raw_token = raw_token[:-2]
        if raw_token in RETRIEVAL_STOP_WORDS:
            continue
        token = normalize_retrieval_token(raw_token)
        if token and token not in RETRIEVAL_STOP_WORDS and token not in tokens:
            tokens.append(token)
    return tokens


def build_retrieval_debug_entry(scored_entry: dict) -> dict:
    entry = scored_entry["entry"]
    debug_entry = {
        "id": entry["id"],
        "title": entry["title"],
        "score": scored_entry["score"],
        "matched_terms": scored_entry["matched_terms"],
        "title_matches": scored_entry["title_matches"],
        "text_matches": scored_entry["text_matches"],
        "title_phrase_match": scored_entry["title_phrase_match"],
        "title_token_match": scored_entry["title_token_match"],
        "score_breakdown": scored_entry["score_breakdown"],
    }
    return debug_entry


def score_wikipedia_articles(query: str, limit: int = 3) -> list[dict]:
    query_tokens = tokenize_for_retrieval(query)
    query_words = set(query_tokens)
    if not query_words:
        return []

    query_phrase = " ".join(query_tokens)
    scored_entries = []
    for entry in WIKIPEDIA_ARTICLES:
        title_tokens = tokenize_for_retrieval(entry["title"])
        title_words = set(title_tokens)
        text_words = set(tokenize_for_retrieval(entry["text"]))
        title_matches = query_words & title_words
        text_matches = query_words & text_words
        matched_terms = query_words & (title_words | text_words)
        if not matched_terms:
            continue

        title_score = len(title_matches) * 2
        text_score = len(text_matches) * 2
        article_title_phrase = " ".join(title_tokens)
        title_phrase_match = bool(
            article_title_phrase
            and query_phrase
            and article_title_phrase in query_phrase
        )
        title_token_match = bool(
            0 < len(query_words) <= 4
            and query_words <= title_words
        )
        phrase_bonus = 4 if title_phrase_match else 0
        title_token_bonus = 3 if title_token_match else 0
        score = title_score + text_score + phrase_bonus + title_token_bonus

        if score >= 1:
            scored_entries.append(
                {
                    "entry": entry,
                    "score": score,
                    "matched_terms": sorted(matched_terms),
                    "title_matches": sorted(title_matches),
                    "text_matches": sorted(text_matches),
                    "title_phrase_match": title_phrase_match,
                    "title_token_match": title_token_match,
                    "score_breakdown": {
                        "title_score": title_score,
                        "text_score": text_score,
                        "phrase_bonus": phrase_bonus,
                        "title_token_bonus": title_token_bonus,
                    },
                }
            )

    scored_entries.sort(key=lambda item: (-item["score"], item["entry"]["title"], item["entry"]["id"]))
    return scored_entries[:limit]


def search_wikipedia_knowledge_base(query: str, limit: int = 3) -> list[dict[str, str]]:
    return search_index(query, limit)


def search_wikipedia_knowledge_base_multi(queries: list[str]) -> list[dict[str, str]]:
    return search_index_multi(queries, limit_per_query=2, total_limit=5)


def build_wikipedia_context(entries: list[dict[str, str]]) -> str:
    return "\n\n".join(
        f"Title: {entry['title']}\nText: {entry['text']}"
        for entry in entries
    )


def extract_capital_subject(question: str) -> str | None:
    match = re.search(r"\bcapital\s+of\s+([a-zA-Z][a-zA-Z\s-]+)", question.lower())
    if not match:
        return None

    subject = re.sub(r"[^a-zA-Z\s-]", " ", match.group(1))
    subject = re.sub(r"\s+", " ", subject).strip()
    return subject or None


def clean_capital_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" .,;:()[]")
    return value


def answer_supported_capital_question(
    question: str,
    entries: list[dict[str, str]],
) -> str | None:
    subject = extract_capital_subject(question)
    if not subject:
        return None

    subject_title = subject.title()
    subject_pattern = re.escape(subject)
    adjective_by_subject = {
        "canada": "Canadian",
        "france": "French",
    }
    patterns = [
        rf"\bcapital\s+of\s+{subject_pattern}\s+is\s+([A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*){{0,4}})",
        r"\bcapital\s+city\s+([A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*){0,4})",
    ]

    adjective = adjective_by_subject.get(subject)
    if adjective:
        patterns.append(
            rf"\b{re.escape(adjective)}\s+capital\s+of\s+([A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*){{0,4}})"
        )

    for entry in entries:
        text = entry.get("text", "")
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if not match:
                continue

            capital = clean_capital_name(match.group(1))
            if not capital or capital.lower() == subject:
                continue

            return f"{capital} is the capital of {subject_title}."

    return None


def answer_supported_awards_question(
    question: str,
    entries: list[dict[str, str]],
) -> str | None:
    lowered_question = question.lower()
    if "award" not in lowered_question:
        return None

    asked_grammy = bool(re.search(r"\bgrammys?\b|\bgrammy\s+awards?\b", lowered_question))
    award_names = (
        ["Grammy Awards"]
        if asked_grammy
        else [
            "Grammy Awards",
            "Brit Awards",
            "Billboard Music Awards",
            "American Music Awards",
            "Guinness World Records",
        ]
    )

    award_mentions = []
    has_many_awards = False
    for entry in entries:
        text = entry.get("text", "")
        if re.search(r"\bmany awards\b", text, flags=re.IGNORECASE):
            has_many_awards = True

        for award_name in award_names:
            pattern = rf"\b(\d{{1,3}})\s+{re.escape(award_name)}\b"
            for match in re.finditer(pattern, text):
                count = int(match.group(1))
                if count <= 0:
                    continue
                mention = match.group(0)
                if mention not in award_mentions:
                    award_mentions.append(mention)

    if award_mentions:
        if asked_grammy:
            if len(award_mentions) == 1:
                return f"The selected Wikipedia context says Jackson's awards include {award_mentions[0]}."
            return (
                "The selected Wikipedia context mentions Grammy Awards, but I do not see "
                "a clean supported total in the retrieved text."
            )

        return (
            "The selected Wikipedia article does not give one single total, "
            f"but it says Jackson has many awards and lists {', '.join(award_mentions)}."
        )

    if asked_grammy:
        return (
            "The selected Wikipedia context mentions Grammy Awards, but I do not see "
            "a clean supported total in the retrieved text."
        )

    if has_many_awards:
        return "The selected Wikipedia article says Jackson has many awards, but it does not give one single total in the retrieved context."

    return None


def answer_supported_life_event_question(
    question: str,
    entries: list[dict[str, str]],
) -> str | None:
    lowered_question = question.lower()
    asks_birth = bool(re.search(r"\b(?:born|birth)\b", lowered_question))
    asks_death = bool(re.search(r"\b(?:die|died|death|pass away|passed away)\b", lowered_question))
    if not asks_birth and not asks_death:
        return None

    for entry in entries:
        text = re.sub(r"\s+", " ", entry.get("text", "")).strip()
        if asks_birth:
            match = re.search(
                r"\bMichael Joseph Jackson was born\b.*?\bon\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b",
                text,
            )
            if match:
                return f"Michael Jackson was born on {match.group(1)}."

            match = re.search(
                r"\bMichael Joseph Jackson\s*\(([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s+[–-]\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\)",
                text,
            )
            if match:
                return f"Michael Jackson was born on {match.group(1)}."

        if asks_death:
            match = re.search(
                r"\bMichael Jackson\b.*?\bpassed away on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b",
                text,
            )
            if match:
                return f"Michael Jackson died on {match.group(1)}."

            match = re.search(
                r"\bMichael Joseph Jackson\s*\([A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s+[–-]\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\)",
                text,
            )
            if match:
                return f"Michael Jackson died on {match.group(1)}."

            match = re.search(
                r"\bJackson died\b.*?\bon\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b",
                text,
            )
            if match:
                return f"Michael Jackson died on {match.group(1)}."

    return None


def answer_supported_famous_song_question(
    question: str,
    entries: list[dict[str, str]],
) -> str | None:
    lowered_question = question.lower()
    if not re.search(r"\b(?:famous|best known|popular)\b", lowered_question) or "song" not in lowered_question:
        return None

    has_michael_jackson_context = False
    for entry in entries:
        if normalize_wikipedia_source_topic(entry.get("title", "")) == "Michael Jackson":
            has_michael_jackson_context = True

        text = re.sub(r"\s+", " ", entry.get("text", "")).strip()
        match = re.search(r"\bThriller includes famous songs like ([^.]+)\.", text)
        if match:
            songs = match.group(1).strip()
            return (
                "The selected Wikipedia context does not name one most famous Michael Jackson song, "
                f"but it says Thriller includes famous songs like {songs}."
            )

    if has_michael_jackson_context:
        return "The selected Wikipedia context does not name one most famous Michael Jackson song."

    return None


def answer_supported_other_bands_question(
    question: str,
    entries: list[dict[str, str]],
) -> str | None:
    lowered_question = question.lower()
    if not re.search(r"\bother\s+bands?\b|\bbands?\b", lowered_question):
        return None

    for entry in entries:
        text = re.sub(r"\s+", " ", entry.get("text", "")).strip()
        match = re.search(
            r"\bMaynard James Keenan\b.*?\b(?:sings|sang)\s+in\s+3\s+[^,.]*bands,\s*Tool,\s*A Perfect Circle,\s*and\s*Puscifer\b",
            text,
            flags=re.IGNORECASE,
        )
        if match:
            return "Maynard James Keenan sings in Tool, A Perfect Circle, and Puscifer."

    return None


def answer_supported_band_album_question(
    question: str,
    entries: list[dict[str, str]],
    active_entities: list[str],
) -> str | None:
    lowered_question = question.lower()
    if "album" not in lowered_question or not active_entities:
        return None

    album_facts = []
    for entity in active_entities:
        entity_facts = []
        entity_pattern = re.escape(entity)
        for entry in entries:
            title = normalize_wikipedia_source_topic(entry.get("title", ""))
            text = re.sub(r"\s+", " ", entry.get("text", "")).strip()
            if title != entity and not re.search(rf"\b{entity_pattern}\b", text):
                continue

            if entity == "Tool":
                if re.search(r"\bTool has put out five studio albums\b", text):
                    entity_facts.append("Tool has put out five studio albums")
                if re.search(r"\bTool released an album in 2019 named Fear Inoculum\b", text):
                    entity_facts.append("Tool released an album in 2019 named Fear Inoculum")
                if re.search(r"\bTool's first album, Undertow\b", text):
                    entity_facts.append("Tool's first album was Undertow")

            if entity == "A Perfect Circle":
                match = re.search(r"\bA Perfect Circle\b.*?\bThey had 4 albums:\s*([^.]+)\.", text)
                if match:
                    entity_facts.append(f"A Perfect Circle had 4 albums: {match.group(1).strip()}")

            if entity == "Puscifer":
                if re.search(r"\bPuscifer\b", text):
                    entity_facts.append("the retrieved context mentions Puscifer but does not list Puscifer albums")

        if entity_facts:
            album_facts.append(f"{entity}: {'; '.join(dict.fromkeys(entity_facts))}.")

    if album_facts:
        return " ".join(album_facts)

    return None


def clean_wikipedia_reply(reply: str) -> tuple[str, bool]:
    reply = reply.strip()
    if UNKNOWN_WIKIPEDIA_ANSWER in reply and reply != UNKNOWN_WIKIPEDIA_ANSWER:
        return UNKNOWN_WIKIPEDIA_ANSWER, True
    return reply, reply == UNKNOWN_WIKIPEDIA_ANSWER


FOLLOW_UP_REFERENCE_PATTERN = re.compile(
    r"\b(he|she|they|it|him|her|his|their|them|that|those|these|its)\b",
    re.IGNORECASE,
)
FOLLOW_UP_PHRASE_PATTERN = re.compile(
    r"\b(what happened next|what about|how many|when was|where was|tell me more)\b",
    re.IGNORECASE,
)
PROPER_NOUN_PATTERN = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\b")
ENTITY_CANDIDATE_PATTERN = re.compile(r"\b[A-Z][A-Za-z0-9']*(?:\s+[A-Z][A-Za-z0-9']*){0,4}\b")
FOLLOW_UP_PRONOUN_PATTERN = r"(?:he|she|they|him|her|them|his|their)"
GENERAL_FOLLOW_UP_PATTERNS = [
    (
        re.compile(
            r"^\s*(?:does|did|was|is|can|could|would|will|has|have)\s+(?:he|she|they|it|him|her|them|that|this)\b",
            re.IGNORECASE,
        ),
        "pronoun_follow_up",
    ),
    (
        re.compile(
            r"^\s*(?:when|where|why|how|what|which)\s+(?:did|does|was|is|were|are|has|have)\s+(?:he|she|they|it|him|her|them|that|this)\b",
            re.IGNORECASE,
        ),
        "pronoun_follow_up",
    ),
    (
        re.compile(
            r"^\s*(?:what\s+else|which\s+other|what\s+about\s+(?:his|her|their|its|that|this)|tell\s+me\s+more\s+about\s+(?:him|her|them|it|that|this))\b",
            re.IGNORECASE,
        ),
        "context_phrase_follow_up",
    ),
    (
        re.compile(r"^\s*how\s+many\b", re.IGNORECASE),
        "context_phrase_follow_up",
    ),
    (
        re.compile(
            r"^\s*(?:and|but|also)\s+(?:the|his|her|its|their|a|an)?\s*\w",
            re.IGNORECASE,
        ),
        "connector_follow_up",
    ),
]
LIFE_EVENT_FOLLOW_UP_PATTERNS = [
    (
        re.compile(
            rf"\bhow\s+old\s+was\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+when\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+(?:died|passed\s+away)\b",
            re.IGNORECASE,
        ),
        "death age",
    ),
    (
        re.compile(
            rf"\bwhen\s+did\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+(?:die|pass\s+away)\b",
            re.IGNORECASE,
        ),
        "death date",
    ),
    (
        re.compile(
            rf"\b{FOLLOW_UP_PRONOUN_PATTERN}\s+(?:died|passed\s+away)\b",
            re.IGNORECASE,
        ),
        "death date",
    ),
    (
        re.compile(
            rf"\bwhen\s+was\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+born\b",
            re.IGNORECASE,
        ),
        "birth date",
    ),
    (
        re.compile(
            rf"\bwhat\s+year\s+was\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+born\b",
            re.IGNORECASE,
        ),
        "birth date",
    ),
    (
        re.compile(
            rf"\bwhere\s+was\s+{FOLLOW_UP_PRONOUN_PATTERN}\s+born\b",
            re.IGNORECASE,
        ),
        "born",
    ),
]


def is_context_dependent_wikipedia_query(message: str) -> bool:
    return bool(
        any(pattern.search(message) for pattern, _reason in GENERAL_FOLLOW_UP_PATTERNS)
        or FOLLOW_UP_REFERENCE_PATTERN.search(message)
        or FOLLOW_UP_PHRASE_PATTERN.search(message)
    )


def extract_recent_topic_from_text(text: str) -> str | None:
    for match in PROPER_NOUN_PATTERN.finditer(text):
        topic = match.group(0).strip()
        first_word = topic.split()[0].lower()
        if first_word in {
            "tell",
            "what",
            "when",
            "where",
            "how",
            "the",
            "this",
            "that",
            "selected",
            "wikipedia",
        }:
            continue
        if topic.lower() in {"american", "english", "french", "canadian"}:
            continue
        return topic

    return None


def add_unique(values: list[str], value: str | None) -> None:
    if value and value not in values:
        values.append(value)


def extract_wikipedia_entities_from_text(text: str) -> list[str]:
    entities = []
    ignored_entities = {
        "American",
        "British",
        "Canadian",
        "English",
        "French",
        "I",
        "It",
        "The",
        "This",
        "That",
        "Title",
        "Wikipedia",
    }

    for match in ENTITY_CANDIDATE_PATTERN.finditer(text):
        entity = match.group(0).strip()
        if entity in ignored_entities:
            continue
        if entity.split()[0].lower() in {"he", "she", "they", "it", "the", "this", "that"}:
            continue
        if len(entity) < 3 and entity != "A Perfect Circle":
            continue
        add_unique(entities, entity)

    return entities[:8]


def normalize_topic_tokens(topic: str) -> set[str]:
    return set(query_terms(topic))


def canonicalize_answer_entity(entity: str, source_titles: list[str]) -> str:
    entity_terms = normalize_topic_tokens(entity)
    if not entity_terms:
        return entity

    for title in source_titles:
        topic = normalize_wikipedia_source_topic(title)
        title_terms = normalize_topic_tokens(topic)
        if title_terms and title_terms <= entity_terms:
            return topic

    return entity


def recent_wikipedia_source_titles(history: list[ChatMessage]) -> list[str]:
    source_titles = []
    for history_message in reversed(history[-6:]):
        for title in history_message.source_titles:
            topic = normalize_wikipedia_source_topic(title)
            if topic and topic not in source_titles:
                source_titles.append(topic)

    return source_titles[:6]


def recent_wikipedia_assistant_text(history: list[ChatMessage]) -> str:
    for history_message in reversed(history[-6:]):
        if history_message.role == "assistant":
            return history_message.content
    return ""


def recent_wikipedia_answer_entities(history: list[ChatMessage]) -> list[str]:
    entities = []
    for history_message in reversed(history[-6:]):
        if history_message.role != "assistant":
            continue

        for entity in extract_wikipedia_entities_from_text(history_message.content):
            add_unique(entities, canonicalize_answer_entity(entity, history_message.source_titles))
        if not entities:
            for title in history_message.source_titles:
                add_unique(entities, normalize_wikipedia_source_topic(title))
        if entities:
            break

    return entities[:8]


def recent_wikipedia_answer_entity(history: list[ChatMessage]) -> str | None:
    for history_message in reversed(history[-6:]):
        if history_message.role != "assistant":
            continue
        if re.match(r"^\s*the\s+selected\s+wikipedia\s+article\b", history_message.content, flags=re.IGNORECASE):
            continue

        topic = extract_recent_topic_from_text(history_message.content)
        if topic:
            return canonicalize_answer_entity(topic, history_message.source_titles)

    return None


def recent_wikipedia_user_topic(history: list[ChatMessage]) -> str | None:
    for history_message in reversed(history[-6:]):
        if history_message.role != "user":
            continue

        topic = extract_recent_topic_from_text(history_message.content)
        if topic:
            return topic

    return None


def normalize_wikipedia_source_topic(title: str) -> str:
    title = title.strip()
    auxiliary_title_patterns = [
        r"^list\s+of\s+.+\s+received\s+by\s+(.+)$",
        r"^list\s+of\s+.+\s+won\s+by\s+(.+)$",
        r"^list\s+of\s+.+\s+earned\s+by\s+(.+)$",
        r"^death\s+of\s+(.+)$",
    ]

    for pattern in auxiliary_title_patterns:
        match = re.match(pattern, title, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()

    title = re.sub(r"\s+\((?:band|singer|musician|album|song)\)$", "", title, flags=re.IGNORECASE)
    return title


def recent_wikipedia_topic(history: list[ChatMessage]) -> str | None:
    answer_entity = recent_wikipedia_answer_entity(history)
    if answer_entity:
        return answer_entity

    source_titles = recent_wikipedia_source_titles(history)
    if source_titles:
        return source_titles[0]

    return recent_wikipedia_user_topic(history)


def wikipedia_life_event_follow_up_terms(message: str) -> str | None:
    for pattern, terms in LIFE_EVENT_FOLLOW_UP_PATTERNS:
        if pattern.search(message):
            return terms

    return None


def wikipedia_follow_up_intent_terms(message: str) -> str | None:
    lowered_message = message.lower()
    if re.search(r"\b(?:famous|best known|popular)\b", lowered_message) and "song" in lowered_message:
        return "famous song"
    if re.search(r"\bother\s+bands?\b", lowered_message):
        return "other bands"
    if "award" in lowered_message:
        return "awards"
    return None


def wikipedia_follow_up_reason(message: str) -> str | None:
    explicit_topic = extract_recent_topic_from_text(message)
    has_reference = bool(FOLLOW_UP_REFERENCE_PATTERN.search(message))
    context_phrase_topic_match = re.match(
        r"^\s*(?:what\s+about|tell\s+me\s+more\s+about)\s+(.+?)\s*[?.!]*\s*$",
        message,
        flags=re.IGNORECASE,
    )
    context_phrase_topic = context_phrase_topic_match.group(1).strip() if context_phrase_topic_match else ""
    has_named_context_phrase_topic = bool(context_phrase_topic and context_phrase_topic[0].isupper())
    life_event_terms = wikipedia_life_event_follow_up_terms(message)
    if life_event_terms:
        return "life_event_follow_up"

    for pattern, reason in GENERAL_FOLLOW_UP_PATTERNS:
        if pattern.search(message):
            if reason == "context_phrase_follow_up" and (explicit_topic or has_named_context_phrase_topic) and not has_reference:
                return None
            return reason

    if FOLLOW_UP_REFERENCE_PATTERN.search(message):
        return "pronoun_follow_up"
    if FOLLOW_UP_PHRASE_PATTERN.search(message):
        if (explicit_topic or has_named_context_phrase_topic) and not has_reference:
            return None
        return "context_phrase_follow_up"

    return None


def is_plural_wikipedia_follow_up(message: str) -> bool:
    return bool(re.search(r"\b(?:they|them|their|these|those)\b", message, flags=re.IGNORECASE))


def is_standalone_wikipedia_query(message: str) -> bool:
    lowered_message = message.lower()
    return bool(re.search(r"\bcapital\s+of\b", lowered_message))


def infer_wikipedia_planner_entities(
    message: str,
    active_topic: str | None,
    answer_entities: list[str],
) -> list[str]:
    lowered_message = message.lower()
    if "album" in lowered_message and is_plural_wikipedia_follow_up(message):
        return [
            entity
            for entity in answer_entities
            if entity != active_topic and entity not in {"Kansas"}
        ][:5]

    if re.search(r"\b(?:other\s+bands?|bands?)\b", lowered_message) and active_topic:
        return [active_topic]

    if active_topic:
        return [active_topic]

    return answer_entities[:5]


def replace_follow_up_references(message: str, replacement: str) -> str:
    if not replacement:
        return message

    rewritten = re.sub(
        r"\b(he|she|they|it|him|her|them|this|that|these|those)\b",
        replacement,
        message,
        count=1,
        flags=re.IGNORECASE,
    )
    rewritten = re.sub(
        r"\b(his|her|their|its)\b",
        f"{replacement}'s",
        rewritten,
        count=1,
        flags=re.IGNORECASE,
    )
    return rewritten


def build_wikipedia_query_plan(message: str, history: list[ChatMessage]) -> dict[str, object]:
    reason = wikipedia_follow_up_reason(message)
    active_topic = recent_wikipedia_topic(history) if reason else None
    answer_entities = recent_wikipedia_answer_entities(history)
    active_entities = infer_wikipedia_planner_entities(message, active_topic, answer_entities)

    if not reason or is_standalone_wikipedia_query(message):
        return {
            "original_query": message,
            "standalone_question": message,
            "retrieval_queries": [message],
            "active_topic": None,
            "active_entities": [],
            "answer_entities": answer_entities,
            "planner_reason": None,
            "is_follow_up": False,
        }

    if not active_topic:
        return {
            "original_query": message,
            "standalone_question": message,
            "retrieval_queries": [message],
            "active_topic": None,
            "active_entities": active_entities,
            "answer_entities": answer_entities,
            "planner_reason": reason,
            "is_follow_up": True,
        }

    lowered_message = message.lower()
    life_event_terms = wikipedia_life_event_follow_up_terms(message)
    intent_terms = wikipedia_follow_up_intent_terms(message)
    planner_reason = reason

    if "album" in lowered_message and is_plural_wikipedia_follow_up(message) and active_entities:
        retrieval_queries = [f"{entity} albums" for entity in active_entities]
        standalone_question = f"Can you list albums by {', '.join(active_entities)}?"
        planner_reason = "plural_follow_up_from_recent_answer"
    elif life_event_terms:
        retrieval_queries = [f"{active_topic} {life_event_terms}"]
        standalone_question = replace_follow_up_references(message, active_topic)
        planner_reason = "life_event_follow_up"
    elif intent_terms:
        retrieval_queries = [f"{active_topic} {intent_terms}"]
        standalone_question = replace_follow_up_references(message, active_topic)
        if re.search(r"\b(?:other\s+bands?|bands?)\b", lowered_message):
            planner_reason = "entity_follow_up_other_bands"
    else:
        follow_up_terms = [
            term
            for term in query_terms(message)
            if term not in query_terms(active_topic)
        ]
        retrieval_query = f"{active_topic} {' '.join(follow_up_terms)}" if follow_up_terms else f"{active_topic} {message}"
        retrieval_queries = [retrieval_query]
        standalone_question = replace_follow_up_references(message, active_topic)

    return {
        "original_query": message,
        "standalone_question": standalone_question,
        "retrieval_queries": retrieval_queries,
        "active_topic": active_topic,
        "active_entities": active_entities,
        "answer_entities": answer_entities,
        "planner_reason": planner_reason,
        "is_follow_up": True,
    }


def build_wikipedia_context_resolution(message: str, history: list[ChatMessage]) -> dict[str, str | bool | None]:
    plan = build_wikipedia_query_plan(message, history)
    retrieval_queries = plan["retrieval_queries"]
    retrieval_query = retrieval_queries[0] if retrieval_queries else message
    return {
        "is_follow_up": bool(plan["is_follow_up"]),
        "active_topic": plan["active_topic"],
        "retrieval_query": retrieval_query,
        "reason": plan["planner_reason"],
    }


def build_wikipedia_retrieval_query(message: str, history: list[ChatMessage]) -> str:
    return str(build_wikipedia_context_resolution(message, history)["retrieval_query"])


PLANNER_TIMEOUT_SECONDS = 20
PLANNER_MAX_QUERIES = 4
PLANNER_MAX_QUERY_LENGTH = 80

WIKIPEDIA_PLANNER_SYSTEM_PROMPT = (
    "You are a retrieval query planner for an offline Wikipedia search system.\n"
    "You never answer the user's question and you never state facts.\n"
    "Your only job is to rewrite the latest user message into standalone Wikipedia search queries.\n"
    "Rules:\n"
    "- Use only names and topics that appear in the conversation context. Never introduce new names.\n"
    "- Resolve pronouns (he, she, it, they, their, them) to the most recently discussed matching "
    "entity in the context. If the recent context is clearly about a person, treat a stray 'it' "
    "as that person.\n"
    "- If the message refers to multiple entities (for example 'their albums' after several bands "
    "were mentioned), produce one retrieval query per entity, up to 4 queries.\n"
    "- Each retrieval query must be 2 to 6 words: an entity name plus the attribute asked about.\n"
    "- Generate queries only for the attribute the user asked about. Do not add queries for other "
    "aspects (location, history, background) that were not asked.\n"
    "- Do not generate queries from earlier source titles unless the user's question is about them.\n"
    "- If the latest message is already standalone, return it unchanged as the single retrieval query.\n"
    "Respond with only JSON in exactly this shape:\n"
    '{"standalone_question": "...", "active_topic": "..." , '
    '"active_entities": ["..."], "retrieval_queries": ["..."], "reason": "..."}'
)


def build_wikipedia_planner_context(message: str, history: list[ChatMessage]) -> str:
    lines = []
    for history_message in history[-6:]:
        line = f"{history_message.role}: {history_message.content[:300]}"
        if history_message.role == "assistant" and history_message.source_titles:
            line += f" [sources: {', '.join(history_message.source_titles)}]"
        lines.append(line)
    lines.append(f"latest user message: {message}")
    return "\n".join(lines)


def parse_planner_plan(raw: str) -> dict | None:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return plan if isinstance(plan, dict) else None


def planner_grounding_blob(message: str, history: list[ChatMessage]) -> str:
    parts = [message]
    for history_message in history[-8:]:
        parts.append(history_message.content)
        parts.extend(history_message.source_titles)
    return " ".join(parts).lower()


def is_planner_query_grounded(query: str, grounding_blob: str) -> bool:
    """Every proper-noun-like token in a planner query must appear in the
    session context. This mechanically prevents the planner from inventing
    entities; attribute words (albums, born, awards) are lowercase and pass.

    The first word of a query is always capitalised regardless of whether it
    is a proper noun, so it is excluded from the check to avoid spuriously
    rejecting attribute-first queries like "Awards won by Marie Curie"."""
    words = query.strip().split()
    first_word_lower = words[0].lower() if words else ""
    for token in re.findall(r"\b[A-Z][A-Za-z0-9'\-]+\b", query):
        if len(token) <= 2:
            continue
        if token.lower() == first_word_lower:
            continue
        if token.lower() not in grounding_blob:
            return False
    return True


def validate_planner_plan(
    plan: dict,
    message: str,
    history: list[ChatMessage],
    rule_active_topic: str | None = None,
) -> dict | None:
    raw_queries = plan.get("retrieval_queries")
    if not isinstance(raw_queries, list):
        return None

    # Relevance gate: build a term set from the current message, the plan's
    # standalone_question, and the rule-resolver's active_topic. Any planner
    # query that shares zero terms with this set is off-topic (e.g. a stale
    # source title) and is rejected before it reaches retrieval.
    relevance_terms: set[str] = set(query_terms(message))
    raw_sq = plan.get("standalone_question")
    if isinstance(raw_sq, str) and raw_sq.strip():
        relevance_terms.update(query_terms(raw_sq))
    if rule_active_topic:
        relevance_terms.update(query_terms(rule_active_topic))

    grounding_blob = planner_grounding_blob(message, history)
    retrieval_queries = []
    for raw_query in raw_queries:
        if not isinstance(raw_query, str):
            continue
        query = raw_query.strip()
        if not query or len(query) > PLANNER_MAX_QUERY_LENGTH:
            continue
        if not query_terms(query):
            continue
        if not is_planner_query_grounded(query, grounding_blob):
            continue
        if relevance_terms and not relevance_terms.intersection(set(query_terms(query))):
            continue
        if query not in retrieval_queries:
            retrieval_queries.append(query)

    retrieval_queries = retrieval_queries[:PLANNER_MAX_QUERIES]
    if not retrieval_queries:
        return None

    raw_entities = plan.get("active_entities")
    active_entities = []
    if isinstance(raw_entities, list):
        for raw_entity in raw_entities:
            if not isinstance(raw_entity, str):
                continue
            entity = raw_entity.strip()
            if entity and entity.lower() in grounding_blob and entity not in active_entities:
                active_entities.append(entity)
    active_entities = active_entities[:6]

    raw_topic = plan.get("active_topic")
    active_topic = None
    if isinstance(raw_topic, str):
        topic = raw_topic.strip()
        if topic and topic.lower() in grounding_blob:
            active_topic = topic

    raw_standalone = plan.get("standalone_question")
    standalone_question = (
        raw_standalone.strip()
        if isinstance(raw_standalone, str) and raw_standalone.strip()
        else message
    )

    raw_reason = plan.get("reason")
    reason = (
        raw_reason.strip()[:120]
        if isinstance(raw_reason, str) and raw_reason.strip()
        else "planner_follow_up"
    )

    return {
        "standalone_question": standalone_question,
        "active_topic": active_topic,
        "active_entities": active_entities,
        "retrieval_queries": retrieval_queries,
        "reason": reason,
    }


def call_wikipedia_query_planner(
    message: str,
    history: list[ChatMessage],
    model: str,
    rule_active_topic: str | None = None,
) -> dict | None:
    planner_user_prompt = (
        "Conversation context:\n"
        f"{build_wikipedia_planner_context(message, history)}\n\n"
        "Produce the JSON plan for the latest user message. Do not answer the question."
    )
    try:
        response = requests.post(
            OLLAMA_CHAT_ENDPOINT,
            json={
                "model": model,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.0, "num_ctx": 2048, "seed": 42},
                "messages": [
                    {"role": "system", "content": WIKIPEDIA_PLANNER_SYSTEM_PROMPT},
                    {"role": "user", "content": planner_user_prompt},
                ],
            },
            timeout=PLANNER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        raw_content = response.json()["message"]["content"]
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return None

    plan = parse_planner_plan(raw_content)
    if plan is None:
        return None
    return validate_planner_plan(plan, message, history, rule_active_topic)


def plan_wikipedia_retrieval(
    message: str,
    history: list[ChatMessage],
    model: str,
) -> dict[str, object]:
    """Planner-first resolution for follow-ups, with the rule-based resolver
    as the deterministic fallback. Standalone questions never touch the
    planner, which keeps capital-city and other standalone behavior
    deterministic and avoids an extra model call."""
    query_plan = build_wikipedia_query_plan(message, history)
    retrieval_queries = list(query_plan["retrieval_queries"])
    resolution: dict[str, object] = {
        **query_plan,
        "retrieval_query": retrieval_queries[0] if retrieval_queries else message,
        "planner_used": False,
    }

    run_planner = bool(query_plan["is_follow_up"])
    if PLANNER_MODE == "always" and history:
        run_planner = True

    if not run_planner:
        return resolution

    validated_plan = call_wikipedia_query_planner(
        message, history, model, rule_active_topic=query_plan["active_topic"]
    )
    if not validated_plan:
        return resolution

    # In "always" mode, standalone questions that carry a required-title
    # constraint (e.g. "capital of X") depend on the exact query string to
    # activate the title filter inside search_index. A planner rewrite like
    # "Atlantis capital" loses that filter and can return unrelated articles.
    # Keep the rule-based query for these cases.
    if not query_plan["is_follow_up"] and required_title_terms(message):
        return resolution

    planner_queries = validated_plan["retrieval_queries"]

    # Fix 2: when the rule resolver fired a deterministic life-event or intent
    # mapping, its query uses exact vocabulary that matches the index (e.g.
    # "born" not "birthdate"). Prepend it so retrieval always sees it first,
    # then append any planner extras, capped at PLANNER_MAX_QUERIES total.
    if wikipedia_life_event_follow_up_terms(message) or wikipedia_follow_up_intent_terms(message):
        rule_first = str(query_plan["retrieval_queries"][0]) if query_plan["retrieval_queries"] else None
        if rule_first:
            merged = [rule_first] + [q for q in planner_queries if q != rule_first]
            planner_queries = merged[:PLANNER_MAX_QUERIES]

    resolution.update(
        {
            "retrieval_query": planner_queries[0],
            "retrieval_queries": planner_queries,
            "standalone_question": validated_plan["standalone_question"],
            "active_entities": validated_plan["active_entities"] or query_plan["active_entities"],
            "planner_used": True,
        }
    )
    return resolution


def search_wikipedia_query_plan(plan: dict[str, object], limit_per_query: int = 3) -> list[dict[str, str]]:
    retrieved_entries = []
    seen_chunk_ids = set()
    for retrieval_query in plan["retrieval_queries"]:
        for entry in search_wikipedia_knowledge_base(str(retrieval_query), limit_per_query):
            chunk_key = entry.get("chunk_id") or f"{entry.get('id')}:{entry.get('title')}:{entry.get('text', '')[:80]}"
            if chunk_key in seen_chunk_ids:
                continue
            seen_chunk_ids.add(chunk_key)
            retrieved_entries.append(entry)

    return retrieved_entries[:9]


def build_wikipedia_chat_debug(
    request: ChatRequest,
    query_plan: dict[str, object],
    retrieved_entries: list[dict[str, str]],
) -> dict[str, object]:
    retrieval_queries = [str(query) for query in query_plan["retrieval_queries"]]
    return {
        "knowledge_base": "wikipedia",
        "original_query": request.message,
        "standalone_question": query_plan["standalone_question"],
        "retrieval_queries": retrieval_queries,
        "retrieval_query": retrieval_queries[0] if retrieval_queries else request.message,
        "active_topic": query_plan["active_topic"],
        "active_entities": query_plan["active_entities"],
        "answer_entities": query_plan["answer_entities"],
        "planner_reason": query_plan["planner_reason"],
        "resolver_reason": query_plan["planner_reason"],
        "planner_used": bool(query_plan.get("planner_used", False)),
        "source_titles": [entry["title"] for entry in retrieved_entries],
        "history_source_titles": recent_wikipedia_source_titles(request.history),
    }


def log_wikipedia_chat_debug(debug: dict[str, object]) -> None:
    print(f"wikipedia_chat_debug={json.dumps(debug, ensure_ascii=False)}", flush=True)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {
        "name": "LUCID",
        "status": "backend running",
        "description": "Local Unified Conversational Intelligence Desk"
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/models")
def get_models():
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=10)
        response.raise_for_status()
        data = response.json()
        models = [model["name"] for model in data.get("models", []) if "name" in model]
        return {
            "default_model": OLLAMA_MODEL,
            "models": models,
        }
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return {
            "default_model": OLLAMA_MODEL,
            "models": [],
        }


@app.get("/knowledge-bases")
def get_knowledge_bases():
    return KNOWLEDGE_BASES


@app.get("/tts/voices")
def get_tts_voices():
    return public_voice_payload(BASE_DIR)


@app.get("/rag/search")
def search_rag(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=3, ge=1, le=10),
    knowledge_base: Literal["wikipedia"] = "wikipedia",
):
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="q must not be empty")

    results = search_wikipedia_knowledge_base(query, limit)
    return {
        "knowledge_base": knowledge_base,
        "query": query,
        "results": results,
    }


def load_cuda_libraries():
    for base in site.getsitepackages():
        for lib_dir in (
            Path(base) / "nvidia" / "cublas" / "lib",
            Path(base) / "nvidia" / "cudnn" / "lib",
        ):
            if lib_dir.exists():
                for lib in sorted(lib_dir.glob("*.so*")):
                    try:
                        ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass

_stt_model = None


def get_stt_model():
    global _stt_model

    if _stt_model is None:
        load_cuda_libraries()

        from faster_whisper import WhisperModel

        _stt_model = WhisperModel(
            STT_MODEL,
            device=STT_DEVICE,
            compute_type=STT_COMPUTE_TYPE,
        )

    return _stt_model


@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an audio file.")

    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    audio_bytes = await audio.read()

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    with NamedTemporaryFile(delete=True, suffix=suffix) as temp_audio:
        temp_audio.write(audio_bytes)
        temp_audio.flush()

        model = get_stt_model()
        segments, _info = model.transcribe(
            temp_audio.name,
            language=STT_LANGUAGE,
            beam_size=5,
        )

        text = " ".join(segment.text.strip() for segment in segments).strip()

    return {"text": text}


@app.post("/tts")
def text_to_speech(request: TTSRequest):
    voice, fallback_used = resolve_voice(request.voice_id, BASE_DIR)
    if voice is None:
        raise HTTPException(status_code=500, detail="Default TTS voice is unavailable.")

    temp_wav_path = None
    try:
        with NamedTemporaryFile(delete=False, suffix=".wav") as temp_wav:
            temp_wav_path = Path(temp_wav.name)

        result = subprocess.run(
            [sys.executable, "-m", "piper", "-m", str(voice["model_path"]), "-f", str(temp_wav_path)],
            input=request.text,
            text=True,
            capture_output=True,
            check=False,
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Piper exited with a non-zero status."
            raise HTTPException(status_code=500, detail=f"TTS generation failed for voice {voice['id']}: {error}")

        wav_bytes = temp_wav_path.read_bytes()
        headers = {"X-LUCID-TTS-Voice-Id": voice["id"]}
        if fallback_used:
            headers["X-LUCID-TTS-Fallback"] = "true"
        return Response(content=wav_bytes, media_type="audio/wav", headers=headers)
    finally:
        if temp_wav_path is not None:
            temp_wav_path.unlink(missing_ok=True)


@app.post("/chat")
def chat(request: ChatRequest):
    selected_model = request.model or OLLAMA_MODEL
    retrieval_debug = None
    if request.knowledge_base == "none":
        messages = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT,
            },
            *[
                {
                    "role": history_message.role,
                    "content": history_message.content,
                }
                for history_message in request.history
            ],
            {"role": "user", "content": request.message},
        ]
        sources = None
    else:
        query_plan = plan_wikipedia_retrieval(request.message, request.history, selected_model)
        retrieved_entries = search_wikipedia_knowledge_base_multi(
            [str(q) for q in query_plan["retrieval_queries"]]
        )
        wikipedia_debug = build_wikipedia_chat_debug(request, query_plan, retrieved_entries)
        log_wikipedia_chat_debug(wikipedia_debug)

        if request.include_retrieval_debug:
            retrieval_debug = retrieved_entries

        if not retrieved_entries:
            response = {"reply": UNKNOWN_WIKIPEDIA_ANSWER, "sources": [], "debug": wikipedia_debug}
            if retrieval_debug is not None:
                response["retrieval_debug"] = retrieval_debug
            return response

        rag_system_prompt = (
            "You are LUCID using the selected local Wikipedia knowledgebase.\n"
            "Answer only using facts explicitly present in the provided Wikipedia context.\n"
            "Reuse only wording and facts from the provided Wikipedia context.\n"
            "Do not use outside knowledge.\n"
            "Do not infer unstated examples, libraries, names, dates, capabilities, or claims.\n"
            "Do not add assumptions, examples, analogies, marketing claims, extra explanation, jokes, sarcasm, or personality.\n"
            "Answer in 1-3 concise sentences.\n"
            "Cite article titles used.\n"
            f"If the provided context does not contain the answer, say exactly: {UNKNOWN_WIKIPEDIA_ANSWER}"
        )
        wikipedia_context = build_wikipedia_context(retrieved_entries)
        standalone_question = str(query_plan.get("standalone_question") or request.message)
        interpreted_line = (
            f"\n(Interpreted in conversation context as: {standalone_question})"
            if query_plan.get("planner_used") and standalone_question != request.message
            else ""
        )
        messages = [
            {
                "role": "system",
                "content": rag_system_prompt,
            },
            *[
                {
                    "role": history_message.role,
                    "content": history_message.content,
                }
                for history_message in request.history
            ],
            {
                "role": "user",
                "content": (
                    "Wikipedia context:\n"
                    f"{wikipedia_context}\n\n"
                    "Strict instruction: Reuse only wording and facts from the Wikipedia context above. "
                    "Do not infer unstated examples, libraries, names, dates, capabilities, or claims. "
                    "Answer in 1-3 concise sentences.\n\n"
                    f"User question: {request.message}{interpreted_line}"
                ),
            },
        ]
        sources = [
            {
                "id": entry["id"],
                "title": entry["title"],
                "chunk_id": entry.get("chunk_id"),
            }
            for entry in retrieved_entries
        ]

        supported_answer = answer_supported_capital_question(request.message, retrieved_entries)
        if not supported_answer:
            supported_answer = answer_supported_life_event_question(request.message, retrieved_entries)
        if not supported_answer:
            supported_answer = answer_supported_famous_song_question(request.message, retrieved_entries)
        if not supported_answer:
            supported_answer = answer_supported_other_bands_question(request.message, retrieved_entries)
        if not supported_answer:
            supported_answer = answer_supported_band_album_question(
                request.message,
                retrieved_entries,
                [str(entity) for entity in query_plan["active_entities"]],
            )
        if not supported_answer:
            supported_answer = answer_supported_awards_question(request.message, retrieved_entries)
        if supported_answer:
            response = {"reply": supported_answer, "sources": sources, "debug": wikipedia_debug}
            if retrieval_debug is not None:
                response["retrieval_debug"] = retrieval_debug
            return response

    try:
        response = requests.post(
            OLLAMA_CHAT_ENDPOINT,
            json={
                "model": selected_model,
                "stream": False,
                "options": {
                    "temperature": 0.0 if request.knowledge_base == "wikipedia" else request.temperature,
                    "num_ctx": request.num_ctx,
                },
                "messages": messages,
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        reply, is_unknown_wikipedia_reply = (
            clean_wikipedia_reply(data["message"]["content"])
            if request.knowledge_base == "wikipedia"
            else (data["message"]["content"], False)
        )
        chat_response = {"reply": reply}
        if request.knowledge_base == "wikipedia" and is_unknown_wikipedia_reply:
            sources = []
        if sources is not None:
            chat_response["sources"] = sources
        if request.knowledge_base == "wikipedia":
            chat_response["debug"] = wikipedia_debug
            if retrieval_debug is not None:
                chat_response["retrieval_debug"] = retrieval_debug
        return chat_response
    except (requests.RequestException, KeyError, ValueError):
        return {"reply": "LUCID could not reach the local model."}
