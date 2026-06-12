"""Regression tests for the three retrieval recall fixes (2026-06).

Case 3 (Nolan): 'know' was absent from FTS_STOP_WORDS, becoming a required
  AND term that killed recall for "What do you know about X?" phrasing.
Case 2 (DC Atlantis): full-term query returns 0 rows; tail search now surfaces
  the topic article when context terms precede topic terms in the query.
Case 1 (France WW2): vocabulary gap (De Gaulle uses "World War II", user says
  "ww2") — unfixable via FTS alone. fts_term_variants false-plural fix reduces
  noise: 'france' no longer generates 'frances'.

All tests use synthetic in-memory SQLite DBs — no dump files, no live backend.
"""

import sqlite3
from pathlib import Path

import pytest

from wiki_store import fts_term_variants, query_terms, search_index


# ---------------------------------------------------------------------------
# Synthetic DB helpers
# ---------------------------------------------------------------------------


def _make_meta_db(
    path: Path,
    articles: list[tuple[str, str, int, list[str], list[tuple[str, str]]]],
) -> None:
    """Build a minimal enwiki-style index at *path*.

    Each article entry is (article_id, title, incoming_links, chunks, redirects)
    where redirects is a list of (name_norm, slug) pairs.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE chunks (
            id TEXT PRIMARY KEY,
            article_id TEXT NOT NULL,
            title TEXT NOT NULL,
            text TEXT NOT NULL,
            chunk_index INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
            title, text, content='chunks', content_rowid='rowid'
        );
        CREATE TABLE article_meta (
            slug TEXT PRIMARY KEY,
            fiction_kind TEXT,
            incoming_links INTEGER DEFAULT 0
        );
        CREATE TABLE article_redirects (
            name_norm TEXT PRIMARY KEY,
            slug TEXT NOT NULL
        );
    """)

    rowid = 0
    for article_id, title, incoming_links, chunks, redirects in articles:
        conn.execute(
            "INSERT INTO article_meta (slug, incoming_links) VALUES (?, ?)",
            (article_id, incoming_links),
        )
        for norm, slug in redirects:
            conn.execute(
                "INSERT OR IGNORE INTO article_redirects VALUES (?, ?)",
                (norm, slug),
            )
        for i, chunk_text in enumerate(chunks):
            rowid += 1
            chunk_id = f"{article_id}:{i}"
            conn.execute(
                "INSERT INTO chunks (id, article_id, title, text, chunk_index) VALUES (?, ?, ?, ?, ?)",
                (chunk_id, article_id, title, chunk_text, i),
            )
            conn.execute(
                "INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)",
                (rowid, title, chunk_text),
            )

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Case 3: stopword fix — "know" and friends must be filtered
# ---------------------------------------------------------------------------


def test_know_is_stopword():
    assert "know" not in query_terms("What do you know about Christopher Nolan?")


def test_knows_is_stopword():
    assert "knows" not in query_terms("Nobody knows more about Nolan than us.")


def test_think_is_stopword():
    assert "think" not in query_terms("What do you think about this director?")


def test_thinks_is_stopword():
    assert "thinks" not in query_terms("Everyone thinks he is great.")


def test_nolan_phrasing_terms_equal():
    """Both phrasings must extract identical query terms after the fix."""
    t1 = query_terms("What do you know about Christopher Nolan?")
    t2 = query_terms("What can you tell me about Christopher Nolan?")
    assert t1 == t2, f"Expected same terms; got {t1!r} vs {t2!r}"


def test_know_phrasing_finds_nolan(tmp_path):
    """'What do you know about Christopher Nolan?' must surface the article."""
    db = tmp_path / "nolan.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "christopher-nolan",
                "Christopher Nolan",
                500,
                [
                    "Christopher Nolan is a British-American filmmaker known for The Dark Knight and Inception.",
                    "Nolan studied English literature at University College, Cambridge.",
                ],
                [("christopher nolan", "christopher-nolan")],
            ),
            (
                "distractor",
                "Generic Article",
                2000,
                ["This article contains the word know and many other common words about directors."],
                [],
            ),
        ],
    )
    results = search_index(
        "What do you know about Christopher Nolan?", limit=3, index_path=db
    )
    ids = [r["id"] for r in results]
    assert "christopher-nolan" in ids, (
        f"christopher-nolan should be found; got {ids}"
    )


# ---------------------------------------------------------------------------
# Case 2: tail search surfaces topic article when full-term query is empty
# ---------------------------------------------------------------------------


def test_tail_search_dc_atlantis_capital(tmp_path):
    """'DC Comics Atlantis capital' must include the atlantis-aquaman capital chunk.

    The full 4-term FTS query finds nothing (no chunk has all four terms).
    The tail search with the last 2 terms ('atlantis capital') finds the chunk
    containing 'Poseidonis is the capital of Atlantis'.
    """
    db = tmp_path / "atlantis.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "dc-comics",
                "DC Comics",
                10_000,  # very popular — would monopolise without tail fix
                [
                    "DC Comics is an American comic book publisher.",
                    "The publisher produces comics featuring Superman and Batman.",
                ],
                [("dc", "dc-comics"), ("dc comics", "dc-comics")],
            ),
            (
                "atlantis-aquaman",
                "Atlantis (Aquaman)",
                50,
                [
                    # chunk 0: no dc/comics, no capital — not found by any ladder level
                    "The kingdom of Atlantis is an underwater realm in ancient mythology.",
                    # chunk 1: capital + atlantis, no dc/comics — found only by tail search
                    "Poseidonis is the capital of Atlantis, named after the Greek deity Poseidon, and serves as Aquaman's base.",
                ],
                [],
            ),
        ],
    )
    results = search_index("DC Comics Atlantis capital", limit=3, index_path=db)
    ids = [r["id"] for r in results]
    assert "atlantis-aquaman" in ids, (
        f"tail search should surface atlantis-aquaman; got {ids}"
    )
    capital_texts = [r["text"] for r in results if r["id"] == "atlantis-aquaman"]
    assert any("capital" in t.lower() for t in capital_texts), (
        f"capital chunk not found in results; atlantis texts = {capital_texts}"
    )


def test_tail_search_not_triggered_when_level1_succeeds(tmp_path):
    """Tail search must not fire when the full-term query already returns rows.

    'capital of Atlantis' (2 terms after stop-word removal) hits both terms
    in the same chunk at level-1 — no tail search needed or triggered.
    """
    db = tmp_path / "cap_atlantis.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "atlantis-aquaman",
                "Atlantis (Aquaman)",
                50,
                [
                    "Poseidonis is the capital city of Atlantis and serves as its main administrative centre.",
                    "Atlantis is a fictional underwater kingdom appearing in various comic book stories.",
                ],
                [],
            ),
        ],
    )
    results = search_index("capital of Atlantis", limit=3, index_path=db)
    ids = [r["id"] for r in results]
    assert "atlantis-aquaman" in ids, (
        f"level-1 search should find atlantis-aquaman; got {ids}"
    )


# ---------------------------------------------------------------------------
# Case 1 (partial): fts_term_variants false-plural fix
# ---------------------------------------------------------------------------


def test_fts_term_variants_france_no_frances():
    """'france' must not generate 'frances' (a person name, not a plural)."""
    variants = fts_term_variants("france")
    assert "frances" not in variants, f"false plural found: {variants}"


def test_fts_term_variants_leader_gets_plural():
    """Common nouns ending in consonants still get plural variants."""
    assert "leaders" in fts_term_variants("leader")


def test_fts_term_variants_capital_gets_plural():
    assert "capitals" in fts_term_variants("capital")


def test_fts_term_variants_album_gets_plural():
    assert "albums" in fts_term_variants("album")


def test_fts_term_variants_city_gets_plural():
    """Words ending in 'y' still get -ies plural variant."""
    assert "cities" in fts_term_variants("city")
