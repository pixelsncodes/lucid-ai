import json
import math
import re
import sqlite3
from pathlib import Path

from config import RERANK_TOP_N, RERANKER_ENABLED
from reranker import rerank as _rerank

BASE_DIR = Path(__file__).parent
WIKIPEDIA_DIR = BASE_DIR / "data" / "wikipedia"
DEFAULT_ARTICLES_PATH = WIKIPEDIA_DIR / "articles.json"
DEFAULT_INDEX_PATH = WIKIPEDIA_DIR / "wikipedia.sqlite3"

WIKIPEDIA_FULL_DIR = BASE_DIR / "data" / "wikipedia-full"
WIKIPEDIA_FULL_INDEX_PATH = WIKIPEDIA_FULL_DIR / "wikipedia-full.sqlite3"

W_POP = 2.0
W_TITLE = 8.0
W_ENTITY = 12.0
# Bonus subtracted from adjusted_score for chunk_index=0 on identity queries.
# Gate: is_identity_query AND chunk_index == 0 AND entity_boost >= 2.
# Derived from the observed 12.7-point BM25 gap between intro and mid-article
# chunks on "Who is Michael Jackson?" — 15.0 guarantees the intro ranks first
# without overriding topic-specific queries where mid-article chunks are better.
CHUNK_INTRO_BONUS = 15.0

# Abbreviation → list of spelled-out tokens to add alongside the abbreviation.
# The abbreviation itself is never removed (expansion adds variants, never replaces).
# Positioned before the abbreviation in the terms list so the AND ladder naturally
# drops the unrecognised abbreviation last and falls through to the expanded tokens.
QUERY_SYNONYMS: dict[str, list[str]] = {
    "ww2":  ["world", "war", "ii"],
    "wwii": ["world", "war", "ii"],
    "ww1":  ["world", "war"],
    "wwi":  ["world", "war"],
}

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
    "know",
    "knows",
    "think",
    "thinks",
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
        if not term.endswith("e"):
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


def build_hybrid_fts_query(anchor_terms: list[str], intent_terms: list[str]) -> str:
    """Build anchor AND (intent1 OR intent2 OR ...) FTS5 query.

    Anchor terms are all required (AND). Intent terms are OR'd with their
    variants — any one match is sufficient. This fires regardless of where
    the anchor appears in the original query (head, tail, or middle).
    """
    anchor_part = build_fts_query_from_terms(anchor_terms)
    intent_variants: list[str] = []
    for term in intent_terms:
        intent_variants.extend(fts_term_variants(term))
    return f"{anchor_part} AND ({' OR '.join(intent_variants)})"


def query_terms(query: str) -> list[str]:
    terms = re.findall(r"[a-zA-Z0-9]+", query.lower())
    normalized_terms = []
    for term in terms:
        if len(term) <= 1 or term in FTS_STOP_WORDS:
            continue
        if term in ("birth", "birthdate", "birthday"):
            term = "born"
        # Synonym expansion: insert spelled-out tokens before the abbreviation so
        # the ladder drops the unrecognised abbreviation last and falls through to
        # the expanded tokens (e.g. "ww2" → world/war/ii inserted ahead of "ww2").
        for expanded in QUERY_SYNONYMS.get(term, []):
            if len(expanded) > 1 and expanded not in FTS_STOP_WORDS and expanded not in normalized_terms:
                normalized_terms.append(expanded)
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


def _has_article_meta(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_meta'"
    ).fetchone()
    return row is not None


def _load_incoming_links(conn: sqlite3.Connection, slugs: list[str]) -> dict[str, int]:
    if not slugs:
        return {}
    placeholders = ",".join("?" * len(slugs))
    rows = conn.execute(
        f"SELECT slug, incoming_links FROM article_meta WHERE slug IN ({placeholders})",
        slugs,
    ).fetchall()
    return {row["slug"]: (row["incoming_links"] or 0) for row in rows}


def _has_article_redirects(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_redirects'"
    ).fetchone()
    return row is not None


def _build_alias_ngrams(terms: list[str]) -> list[tuple[str, int]]:
    ngrams: list[tuple[str, int]] = []
    seen: set[str] = set()
    for n in range(1, min(5, len(terms) + 1)):
        for i in range(len(terms) - n + 1):
            phrase = " ".join(terms[i : i + n])
            if phrase not in seen:
                seen.add(phrase)
                ngrams.append((phrase, n))
    return ngrams


def _load_entity_boosts(
    conn: sqlite3.Connection, ngrams: list[tuple[str, int]]
) -> dict[str, int]:
    if not ngrams:
        return {}
    phrase_to_count = {phrase: count for phrase, count in ngrams}
    placeholders = ",".join("?" * len(phrase_to_count))
    rows = conn.execute(
        f"SELECT name_norm, slug FROM article_redirects WHERE name_norm IN ({placeholders})",
        list(phrase_to_count),
    ).fetchall()
    slug_best: dict[str, int] = {}
    for row in rows:
        slug = row["slug"]
        count = phrase_to_count.get(row["name_norm"], 1)
        if count > slug_best.get(slug, 0):
            slug_best[slug] = count
    return slug_best


def _title_covered(title: str, query_term_set: set[str]) -> bool:
    title_terms = set(query_terms(title))
    # Require ≥2 title terms so single-word tokens left after stripping non-ASCII
    # (e.g. "Météo" → nothing, leaving only "france") don't accidentally match.
    return len(title_terms) >= 2 and title_terms <= query_term_set


def is_identity_query(terms: list[str], entity_boost_map: dict[str, int]) -> bool:
    """True when all query terms form a single ≥2-term entity anchor.

    Guards CHUNK_INTRO_BONUS: pure identity questions ('Who is Michael Jackson?')
    should surface the intro chunk; topic-specific questions ('Michael Jackson
    albums') should not.
    """
    if len(terms) < 2:
        return False
    return any(boost == len(terms) for boost in entity_boost_map.values())


def _find_best_anchor(
    conn: sqlite3.Connection,
    terms: list[str],
    entity_boost_map: dict[str, int],
) -> tuple[list[str], int] | None:
    """Return (anchor_terms, anchor_start) for the best ≥2-term entity anchor.

    Scans article_redirects for the ngram of size best_boost that maps to the
    top-boosted slug. Returns None when best boost < 2.
    """
    best_count = max(entity_boost_map.values(), default=0)
    if best_count < 2:
        return None
    best_slug = next(s for s, v in entity_boost_map.items() if v == best_count)
    candidates = [
        (" ".join(terms[i : i + best_count]), i)
        for i in range(len(terms) - best_count + 1)
    ]
    phrases = [p for p, _ in candidates]
    placeholders = ",".join("?" * len(phrases))
    rows = conn.execute(
        f"SELECT name_norm FROM article_redirects"
        f" WHERE name_norm IN ({placeholders}) AND slug = ?",
        phrases + [best_slug],
    ).fetchall()
    matched = {row["name_norm"] for row in rows}
    for phrase, i in candidates:
        if phrase in matched:
            return terms[i : i + best_count], i
    return None


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


def search_index(
    query: str,
    limit: int = 3,
    index_path: Path = DEFAULT_INDEX_PATH,
    _debug_info: "dict | None" = None,
) -> list[dict[str, str]]:
    query = query.strip()
    terms = query_terms(query)
    query_term_set = set(terms)
    required_terms = required_title_terms(query)
    search_limit = min(500, max(limit * 50, 100))

    if not terms or not index_path.exists():
        return []

    _chunk0_injected = False
    filtered_rows: list[sqlite3.Row] = []
    filtered_tail_rows: list[sqlite3.Row] = []
    has_meta = False
    incoming_links_map: dict[str, int] = {}
    entity_boost_map: dict[str, int] = {}

    with connect(index_path) as conn:
        initialize_index(conn)

        has_meta = _has_article_meta(conn)

        if has_meta:
            relaxed_search_limit = min(800, max(search_limit * 3, 300))
            seen_chunk_ids: set[str] = set()
            merged_rows: list[sqlite3.Row] = []

            # Pre-compute entity anchor and intent terms for the hybrid query.
            # Anchor terms: the ≥2-word entity match (required in hybrid).
            # Intent terms: all other query terms OR'd in hybrid (any match
            # suffices). Split by identity — NOT position — so the hybrid
            # works whether the entity appears at query head or tail (e.g.
            # after follow-up resolution appends it).
            hybrid_anchor: list[str] | None = None
            hybrid_intent: list[str] | None = None
            if _has_article_redirects(conn) and terms:
                entity_boost_map = _load_entity_boosts(conn, _build_alias_ngrams(terms))
                anchor = _find_best_anchor(conn, terms, entity_boost_map)
                if anchor is not None:
                    anchor_tms, _ = anchor
                    anchor_set = set(anchor_tms)
                    intent = [t for t in terms if t not in anchor_set]
                    if intent:
                        hybrid_anchor = anchor_tms
                        hybrid_intent = intent

            # Hybrid: anchor AND (intent OR intent...). Fires unconditionally
            # when intent_terms is non-empty — correct for Cases B and C
            # where the main AND ladder's first level returns plausible-but-
            # wrong hits (not empty rows), so the old first_level_empty gate
            # never triggered.
            if hybrid_anchor and hybrid_intent:
                for row in run_fts_search(
                    conn,
                    build_hybrid_fts_query(hybrid_anchor, hybrid_intent),
                    relaxed_search_limit,
                ):
                    if row["id"] not in seen_chunk_ids:
                        seen_chunk_ids.add(row["id"])
                        merged_rows.append(row)

            # Merged ladder: collect rows from ALL levels (full terms down to
            # the floor of 2) so that topic-article chunks reach the re-ranker
            # even when an intent term (e.g. "attend") doesn't co-occur with
            # the topic term in the same chunk.  Cap the merged pool at 800
            # raw rows to bound query cost; dedup by chunk id across levels.
            # Relaxed levels use a wider per-level cap (3× with a 300-row
            # floor) because popular topic articles often rank below the
            # default 50-per-limit window in less discriminating 2-term
            # queries (albert-einstein ranks 272nd for "university einstein").
            attempt_terms = list(terms)
            is_first_level = True
            first_level_empty = False
            while attempt_terms:
                level_limit = search_limit if is_first_level else relaxed_search_limit
                rows_before = len(merged_rows)
                for row in run_fts_search(conn, build_fts_query_from_terms(attempt_terms), level_limit):
                    if row["id"] not in seen_chunk_ids:
                        seen_chunk_ids.add(row["id"])
                        merged_rows.append(row)
                if is_first_level:
                    first_level_empty = len(merged_rows) == rows_before
                is_first_level = False
                if len(merged_rows) >= 800 or len(attempt_terms) <= 2:
                    break
                attempt_terms = attempt_terms[:-1]

            # Tail search: when the full-term query found nothing, also try the
            # last 2 terms. Queries like "DC Comics Atlantis capital" place the
            # topic terms at the end; the normal ladder drops them first and
            # never tries the specific "atlantis capital" combination that finds
            # the right article directly.
            tail_rows: list[sqlite3.Row] = []
            if first_level_empty and len(terms) >= 3:
                for row in run_fts_search(
                    conn, build_fts_query_from_terms(terms[-2:]), relaxed_search_limit
                ):
                    if row["id"] not in seen_chunk_ids:
                        tail_rows.append(row)

            # Chunk 0 injection: for identity queries the intro chunk often
            # falls outside the FTS pool (ranked > search_limit because
            # mid-article chunks have denser entity-term repetition). Fetch
            # it directly so CHUNK_INTRO_BONUS can act on it.
            if is_identity_query(terms, entity_boost_map):
                _best_boost = max(entity_boost_map.values(), default=0)
                if _best_boost >= 2:
                    _best_slug = next(
                        (s for s, v in entity_boost_map.items() if v == _best_boost), None
                    )
                    if _best_slug:
                        _chunk0_id = f"{_best_slug}:0"
                        if _chunk0_id not in seen_chunk_ids:
                            _row0 = conn.execute(
                                """
                                SELECT chunks.id, chunks.article_id, chunks.title,
                                       chunks.text, chunks.chunk_index,
                                       bm25(chunks_fts, 5.0, 1.0) AS score
                                FROM chunks_fts
                                JOIN chunks ON chunks_fts.rowid = chunks.rowid
                                WHERE chunks_fts MATCH ? AND chunks.id = ?
                                """,
                                (build_fts_query_from_terms(terms), _chunk0_id),
                            ).fetchone()
                            if _row0:
                                seen_chunk_ids.add(_chunk0_id)
                                merged_rows.append(_row0)
                                _chunk0_injected = True

            filtered_rows = [
                row for row in merged_rows
                if title_matches_required_terms(row["title"], required_terms)
                and is_useful_chunk(row["text"])
            ]
            filtered_tail_rows = [
                row for row in tail_rows
                if title_matches_required_terms(row["title"], required_terms)
                and is_useful_chunk(row["text"])
            ]
        else:
            # Original first-non-empty-wins ladder — SimpleWiki path unchanged.
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

        if has_meta and (filtered_rows or filtered_tail_rows):
            distinct_slugs = list(
                {row["article_id"] for row in filtered_rows + filtered_tail_rows}
            )
            incoming_links_map = _load_incoming_links(conn, distinct_slugs)
            # entity_boost_map pre-computed above (empty when no redirects table)

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

    if has_meta:
        identity_q = is_identity_query(terms, entity_boost_map)
        for result in results:
            links = incoming_links_map.get(result["id"], 0)
            covered = _title_covered(result["title"], query_term_set)
            entity_boost = entity_boost_map.get(result["id"], 0)
            intro_bonus = (
                CHUNK_INTRO_BONUS
                if identity_q and result["_chunk_index"] == 0 and entity_boost >= 2
                else 0.0
            )
            result["_adjusted_score"] = (
                result["score"]
                - W_POP * math.log1p(links)
                - (W_TITLE if covered else 0.0)
                - W_ENTITY * entity_boost
                - intro_bonus
            )
        results.sort(key=lambda r: r["_adjusted_score"])

        # Cross-encoder reranker pass: reorder the top-RERANK_TOP_N FTS5
        # candidates.  Two exemption rules preserve entity disambiguation:
        #
        # 1. Pinned chunk-0 (identity queries, entity_boost ≥ 2, chunk_index=0)
        #    stays fixed at position 0 regardless of reranker score.
        #
        # 2. Any candidate belonging to an article with entity_boost ≥ 2 is
        #    treated as "entity-anchored": it keeps its adjusted_score rank
        #    relative to other entity-anchored chunks and is never displaced by
        #    a lower-boost article's chunk.  This stops the cross-encoder from
        #    promoting a superficially similar but wrong article (e.g.
        #    "Alfred Einstein" above "Albert Einstein") when the entity-boost
        #    system has already identified the correct target.
        #
        # The reranker freely reorders candidates with entity_boost < 2 (the
        # general case where entity disambiguation adds no strong prior).
        if RERANKER_ENABLED and len(results) > 1:
            pinned = None
            entity_anchored: list[dict] = []
            rerank_pool_raw: list[dict] = []

            for r in results:
                boost = entity_boost_map.get(r["id"], 0)
                if (
                    pinned is None
                    and identity_q
                    and r["_chunk_index"] == 0
                    and boost >= 2
                ):
                    pinned = r
                elif boost >= 1:
                    # Articles matching even a single query term via redirect are
                    # entity-anchored: keep their adjusted_score order rather than
                    # letting the cross-encoder demote them behind a zero-boost article
                    # (e.g. Alfred Einstein must not rank above Albert Einstein when the
                    # query says "Einstein" and the redirect maps "einstein" → albert-einstein).
                    entity_anchored.append(r)
                else:
                    rerank_pool_raw.append(r)

            pool = rerank_pool_raw[:RERANK_TOP_N]
            overflow = rerank_pool_raw[RERANK_TOP_N:]

            pool = _rerank(query, pool)

            results = (
                ([pinned] if pinned is not None else [])
                + entity_anchored
                + pool
                + overflow
            )

        # Guarantee one output slot for the best tail-search result not already
        # present in the top (limit-1) main results. This prevents a
        # popularity-dominated article (e.g. dc-comics) from filling every slot
        # when the full-term query failed and the topic article can only be
        # found via the tail query (e.g. "atlantis capital").
        if filtered_tail_rows:
            tail_results = [
                {
                    "id": row["article_id"],
                    "chunk_id": row["id"],
                    "title": row["title"],
                    "text": row["text"],
                    "_chunk_index": row["chunk_index"],
                    "score": row["score"],
                    "_title_rank": title_rank(row["title"], query, terms),
                }
                for row in filtered_tail_rows
            ]
            # Sort tail candidates by raw BM25 (the tail query's own relevance
            # signal), not adjusted_score. Adjusted scores are calibrated for the
            # full-query context; W_TITLE in particular inflates articles whose
            # title overlaps the full query (e.g. "Atlantis in comics" → covered)
            # even when another article's chunk more directly answers the tail
            # terms (atlantis-aquaman:12 "Poseidonis is the capital of Atlantis").
            tail_results.sort(key=lambda r: r["score"])
            # Dedup at chunk level so an article already represented by a
            # different chunk in main results can still contribute a NEW chunk
            # via the tail search (e.g. atlantis-aquaman:0 in main, :12 in tail).
            main_chunk_ids = {r["chunk_id"] for r in results[:limit]}
            for tr in tail_results:
                if tr["chunk_id"] not in main_chunk_ids:
                    results = results[: limit - 1] + [tr]
                    break

    else:
        results.sort(
            key=lambda result: (
                result["_title_rank"],
                result["_chunk_index"] if result["_title_rank"] < 2 else 999999,
                result["score"],
            )
        )

    if _debug_info is not None:
        _debug_info["terms"] = list(terms)
        _debug_info["chunk0_injected"] = _chunk0_injected
        _debug_info["candidates"] = [
            {
                "article": r["title"],
                "chunk_index": r.get("_chunk_index"),
                "chunk_id": r["chunk_id"],
                "fts5_score": round(float(r["score"]), 4),
                "reranker_score": r.get("reranker_score"),
            }
            for r in results
        ]

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
