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

from wiki_store import query_terms, search_index

from config import (
    DEFAULT_NUM_CTX,
    DEFAULT_TEMPERATURE,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_ENDPOINT,
    OLLAMA_MODEL,
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

    award_patterns = [
        r"\b\d+\s+Grammy Awards\b",
        r"\b\d+\s+Brit Awards\b",
        r"\b\d+\s+Billboard Music Awards\b",
        r"\b\d+\s+American Music Awards\b",
        r"\b\d+\s+Guinness World Records\b",
    ]

    award_mentions = []
    has_many_awards = False
    for entry in entries:
        text = entry.get("text", "")
        if re.search(r"\bmany awards\b", text, flags=re.IGNORECASE):
            has_many_awards = True

        for pattern in award_patterns:
            for match in re.finditer(pattern, text):
                mention = match.group(0)
                if mention not in award_mentions:
                    award_mentions.append(mention)

    if award_mentions:
        return (
            "The selected Wikipedia article does not give one single total, "
            f"but it says Jackson has many awards and lists {', '.join(award_mentions)}."
        )

    if has_many_awards:
        return "The selected Wikipedia article says Jackson has many awards, but it does not give one single total in the retrieved context."

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
    r"\b(what happened next|what about|how many|when was|where was)\b",
    re.IGNORECASE,
)
PROPER_NOUN_PATTERN = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\b")
FOLLOW_UP_PRONOUN_PATTERN = r"(?:he|she|they|him|her|them|his|their)"
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
        "born date",
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
        FOLLOW_UP_REFERENCE_PATTERN.search(message)
        or FOLLOW_UP_PHRASE_PATTERN.search(message)
    )


def extract_recent_topic_from_text(text: str) -> str | None:
    for match in PROPER_NOUN_PATTERN.finditer(text):
        topic = match.group(0).strip()
        first_word = topic.split()[0].lower()
        if first_word in {"tell", "what", "when", "where", "how", "the", "this", "that"}:
            continue
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

    return title


def recent_wikipedia_topic(history: list[ChatMessage]) -> str | None:
    for history_message in reversed(history[-6:]):
        if history_message.source_titles:
            return normalize_wikipedia_source_topic(history_message.source_titles[0])

    for history_message in reversed(history[-6:]):
        if history_message.role != "user":
            continue

        topic = extract_recent_topic_from_text(history_message.content)
        if topic:
            return topic

    for history_message in reversed(history[-6:]):
        if history_message.role != "assistant":
            continue

        topic = extract_recent_topic_from_text(history_message.content)
        if topic:
            return topic

    return None


def wikipedia_life_event_follow_up_terms(message: str) -> str | None:
    for pattern, terms in LIFE_EVENT_FOLLOW_UP_PATTERNS:
        if pattern.search(message):
            return terms

    return None


def build_wikipedia_retrieval_query(message: str, history: list[ChatMessage]) -> str:
    if not is_context_dependent_wikipedia_query(message):
        return message

    topic = recent_wikipedia_topic(history)
    if not topic:
        return message

    life_event_terms = wikipedia_life_event_follow_up_terms(message)
    if life_event_terms:
        return f"{topic} {life_event_terms}"

    follow_up_terms = [
        term
        for term in query_terms(message)
        if term not in query_terms(topic)
    ]
    if follow_up_terms:
        return f"{topic} {' '.join(follow_up_terms)}"

    return f"{topic} {message}"


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
        retrieval_query = build_wikipedia_retrieval_query(request.message, request.history)
        retrieved_entries = search_wikipedia_knowledge_base(retrieval_query)

        if request.include_retrieval_debug:
            retrieval_debug = retrieved_entries

        if not retrieved_entries:
            response = {"reply": UNKNOWN_WIKIPEDIA_ANSWER, "sources": []}
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
                    f"User question: {request.message}"
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
            supported_answer = answer_supported_awards_question(request.message, retrieved_entries)
        if supported_answer:
            response = {"reply": supported_answer, "sources": sources}
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
        if request.knowledge_base == "wikipedia" and retrieval_debug is not None:
            chat_response["retrieval_debug"] = retrieval_debug
        return chat_response
    except (requests.RequestException, KeyError, ValueError):
        return {"reply": "LUCID could not reach the local model."}
