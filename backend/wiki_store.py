import json
import re
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).parent
WIKIPEDIA_DIR = BASE_DIR / "data" / "wikipedia"
DEFAULT_ARTICLES_PATH = WIKIPEDIA_DIR / "articles.json"
DEFAULT_INDEX_PATH = WIKIPEDIA_DIR / "wikipedia.sqlite3"


FTS_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "about",
    "also",
    "any",
    "by",
    "can",
    "could",
    "date",
    "did",
    "do",
    "does",
    "for",
    "from",
    "he",
    "her",
    "him",
    "his",
    "how",
    "in",
    "into",
    "is",
    "it",
    "else",
    "more",
    "of",
    "on",
    "or",
    "other",
    "that",
    "the",
    "this",
    "tell",
    "them",
    "their",
    "they",
    "these",
    "those",
    "to",
    "used",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "work",
    "worked",
    "working",
    "works",
    "win",
    "won",
    "you",
    "me",
    "please",
    "many",
    "much",
    "list",
    "lists",
    "show",
    "give",
    "some",
}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "article"


def load_articles(path: Path = DEFAULT_ARTICLES_PATH) -> list[dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []

    if not isinstance(data, list):
        return []

    articles = []
    for index, entry in enumerate(data, start=1):
        if not isinstance(entry, dict):
            continue

        title = str(entry.get("title", "")).strip()
        text = str(entry.get("text", "")).strip()
        article_id = str(entry.get("id", "")).strip() or slugify(title) or f"article-{index}"

        if not title or not text:
            continue

        articles.append(
            {
                "id": article_id,
                "title": title,
                "text": text,
            }
        )

    return articles


def chunk_text(text: str, max_chars: int = 900, overlap_chars: int = 150) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", text) if paragraph.strip()]
    if not paragraphs:
        paragraphs = [text.strip()]

    chunks = []
    current = ""

    for paragraph in paragraphs:
        if not current:
            current = paragraph
        elif len(current) + 2 + len(paragraph) <= max_chars:
            current = f"{current}\n\n{paragraph}"
        else:
            chunks.extend(split_long_text(current, max_chars, overlap_chars))
            current = paragraph

    if current:
        chunks.extend(split_long_text(current, max_chars, overlap_chars))

    return chunks


def split_long_text(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    text = re.sub(r"\s+", " ", text.strip())
    if len(text) <= max_chars:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        target_end = min(start + max_chars, len(text))
        end = target_end

        if target_end < len(text):
            boundary = max(
                text.rfind(". ", start, target_end),
                text.rfind("? ", start, target_end),
                text.rfind("! ", start, target_end),
                text.rfind("; ", start, target_end),
                text.rfind(", ", start, target_end),
                text.rfind(" ", start, target_end),
            )
            if boundary > start + max_chars // 2:
                end = boundary + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        next_start = max(0, end - overlap_chars)
        while next_start < len(text) and next_start > 0 and not text[next_start - 1].isspace():
            next_start += 1

        if next_start <= start:
            next_start = end

        start = next_start

    return chunks


def required_title_terms(query: str) -> list[str]:
    lowered = query.lower()
    match = re.search(r"\bcapital\s+of\s+([a-zA-Z][a-zA-Z\s-]+)", lowered)
    if not match:
        return []

    subject = match.group(1)
    subject = re.sub(r"[^a-zA-Z\s-]", " ", subject)
    terms = [
        term
        for term in re.findall(r"[a-zA-Z]+", subject)
        if len(term) > 2 and term not in FTS_STOP_WORDS
    ]
    return terms[:3]


def title_matches_required_terms(title: str, required_terms: list[str]) -> bool:
    if not required_terms:
        return True

    title_terms = set(re.findall(r"[a-zA-Z0-9]+", title.lower()))
    return all(term in title_terms for term in required_terms)


def is_useful_chunk(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if normalized in {"references", "reference", "sources", "external links", "related pages"}:
        return False

    word_count = len(re.findall(r"[a-zA-Z0-9]+", normalized))
    return word_count >= 8


def fts_term_variants(term: str) -> list[str]:
    """Expand a query term into singular/plural variants.

    The FTS index has no stemming, so "album" and "albums" are different
    tokens. Matching either variant keeps recall stable for natural queries.
    """
    variants = [term]
    if not term.isalpha():
        return variants

    if len(term) > 4 and term.endswith("ies"):
        variants.append(f"{term[:-3]}y")
    elif len(term) > 3 and term.endswith("s") and not term.endswith("ss"):
        variants.append(term[:-1])
    else:
        if len(term) > 2 and term.endswith("y"):
            variants.append(f"{term[:-1]}ies")
        variants.append(f"{term}s")

    deduped = []
    for variant in variants:
        if variant and variant not in deduped:
            deduped.append(variant)
    return deduped


def build_fts_query_from_terms(terms: list[str]) -> str:
    groups = []
    for term in terms:
        variants = fts_term_variants(term)
        if len(variants) == 1:
            groups.append(variants[0])
        else:
            groups.append(f"({' OR '.join(variants)})")
    return " AND ".join(groups)


def build_fts_query(query: str) -> str:
    terms = query_terms(query)

    if not terms:
        return ""

    return build_fts_query_from_terms(terms)


def query_terms(query: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9]+", query.lower())
    normalized_terms = []
    for term in terms:
        if len(term) <= 1 or term in FTS_STOP_WORDS:
            continue
        if term in ("birth", "birthdate", "birthday"):
            term = "born"
        if term not in normalized_terms:
            normalized_terms.append(term)
    return normalized_terms


def normalized_phrase(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9]+", " ", value.lower())).strip()


def title_rank(title: str, query: str, terms: list[str]) -> int:
    if not terms:
        return 2

    title_terms = query_terms(title)
    title_term_set = set(title_terms)
    query_term_set = set(terms)
    normalized_title = normalized_phrase(title)
    normalized_query = normalized_phrase(query)
    query_term_phrase = " ".join(terms)

    if normalized_title == query_term_phrase or (
        normalized_title in normalized_query and query_term_set <= title_term_set
    ):
        return 0
    if query_term_set and query_term_set <= title_term_set:
        return 1
    if len(title_terms) > 1 and normalized_title and normalized_title in normalized_query:
        return 1
    return 2


def connect(index_path: Path = DEFAULT_INDEX_PATH) -> sqlite3.Connection:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(index_path)
    conn.row_factory = sqlite3.Row
    return conn


def initialize_index(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS articles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            text TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            article_id TEXT NOT NULL,
            title TEXT NOT NULL,
            text TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            FOREIGN KEY(article_id) REFERENCES articles(id)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            title,
            text,
            content='chunks',
            content_rowid='rowid'
        );
        """
    )
    conn.commit()


def rebuild_index(
    articles_path: Path = DEFAULT_ARTICLES_PATH,
    index_path: Path = DEFAULT_INDEX_PATH,
) -> dict[str, int]:
    articles = load_articles(articles_path)

    with connect(index_path) as conn:
        initialize_index(conn)
        conn.executescript(
            """
            DELETE FROM chunks_fts;
            DELETE FROM chunks;
            DELETE FROM articles;
            """
        )

        chunk_count = 0
        for article in articles:
            conn.execute(
                "INSERT INTO articles (id, title, text) VALUES (?, ?, ?)",
                (article["id"], article["title"], article["text"]),
            )

            for chunk_index, chunk in enumerate(chunk_text(article["text"])):
                chunk_id = f"{article['id']}:{chunk_index}"
                cursor = conn.execute(
                    """
                    INSERT INTO chunks (id, article_id, title, text, chunk_index)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (chunk_id, article["id"], article["title"], chunk, chunk_index),
                )
                rowid = cursor.lastrowid
                conn.execute(
                    "INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)",
                    (rowid, article["title"], chunk),
                )
                chunk_count += 1

        conn.commit()

    return {
        "articles": len(articles),
        "chunks": chunk_count,
    }


def run_fts_search(conn: sqlite3.Connection, fts_query: str, search_limit: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT
            chunks.id,
            chunks.article_id,
            chunks.title,
            chunks.text,
            chunks.chunk_index,
            bm25(chunks_fts, 5.0, 1.0) AS score
        FROM chunks_fts
        JOIN chunks ON chunks_fts.rowid = chunks.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY score
        LIMIT ?
        """,
        (fts_query, search_limit),
    ).fetchall()


def search_index(query: str, limit: int = 3, index_path: Path = DEFAULT_INDEX_PATH) -> list[dict[str, str]]:
    query = query.strip()
    terms = query_terms(query)
    required_terms = required_title_terms(query)
    search_limit = min(500, max(limit * 50, 100))

    if not terms or not index_path.exists():
        return []

    filtered_rows: list[sqlite3.Row] = []
    with connect(index_path) as conn:
        initialize_index(conn)

        # Relaxation ladder: start with all terms ANDed. Retrieval queries put
        # the topic first and intent terms last, so if a strict query matches
        # nothing, drop trailing terms (down to a floor of 2) instead of
        # returning zero rows. Returning the topic's chunks lets the grounded
        # answer layer respond cautiously instead of falsely claiming the
        # knowledgebase has nothing.
        attempt_terms = list(terms)
        while attempt_terms:
            rows = run_fts_search(conn, build_fts_query_from_terms(attempt_terms), search_limit)
            filtered_rows = [
                row
                for row in rows
                if title_matches_required_terms(row["title"], required_terms)
                and is_useful_chunk(row["text"])
            ]
            if filtered_rows or len(attempt_terms) <= 2:
                break
            attempt_terms = attempt_terms[:-1]

    results = [
        {
            "id": row["article_id"],
            "chunk_id": row["id"],
            "title": row["title"],
            "text": row["text"],
            "_chunk_index": row["chunk_index"],
            "score": row["score"],
            "_title_rank": title_rank(row["title"], query, terms),
        }
        for row in filtered_rows
    ]

    results.sort(
        key=lambda result: (
            result["_title_rank"],
            result["_chunk_index"] if result["_title_rank"] < 2 else 999999,
            result["score"],
        )
    )
    return [
        {
            "id": result["id"],
            "chunk_id": result["chunk_id"],
            "title": result["title"],
            "text": result["text"],
            "score": result["score"],
        }
        for result in results[:limit]
    ]


def search_index_multi(
    queries: list[str],
    limit_per_query: int = 2,
    total_limit: int = 6,
    index_path: Path = DEFAULT_INDEX_PATH,
) -> list[dict[str, str]]:
    """Run several retrieval queries and merge results, deduped by chunk.

    Used when the query planner fans a follow-up out into one query per
    entity (e.g. albums for each of several bands). A single query behaves
    exactly like search_index with the default limit.
    """
    cleaned_queries = []
    for query in queries:
        query = query.strip()
        if query and query not in cleaned_queries:
            cleaned_queries.append(query)

    if not cleaned_queries:
        return []

    if len(cleaned_queries) == 1:
        return search_index(cleaned_queries[0], limit=3, index_path=index_path)

    merged: list[dict[str, str]] = []
    seen_chunk_ids: set[str] = set()
    for query in cleaned_queries:
        for entry in search_index(query, limit=limit_per_query, index_path=index_path):
            chunk_id = entry.get("chunk_id")
            if chunk_id in seen_chunk_ids:
                continue
            seen_chunk_ids.add(chunk_id)
            merged.append(entry)

    return merged[:total_limit]
