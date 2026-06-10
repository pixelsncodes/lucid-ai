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
    "of",
    "on",
    "or",
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
    "win",
    "won",
    "you",
    "me",
    "please",
    "many",
    "much",
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


def build_fts_query(query: str) -> str:
    terms = query_terms(query)

    if not terms:
        return ""

    return " AND ".join(sorted(set(terms)))


def query_terms(query: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9]+", query.lower())
    return [
        term
        for term in terms
        if len(term) > 1 and term not in FTS_STOP_WORDS
    ]


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


def search_index(query: str, limit: int = 3, index_path: Path = DEFAULT_INDEX_PATH) -> list[dict[str, str]]:
    query = query.strip()
    terms = query_terms(query)
    fts_query = build_fts_query(query)
    required_terms = required_title_terms(query)
    search_limit = min(500, max(limit * 50, 100))

    if not fts_query or not index_path.exists():
        return []

    with connect(index_path) as conn:
        initialize_index(conn)
        rows = conn.execute(
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
        for row in rows
        if title_matches_required_terms(row["title"], required_terms)
        and is_useful_chunk(row["text"])
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
