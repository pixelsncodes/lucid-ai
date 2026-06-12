"""Unit tests for the entity-redirect boost in wiki_store.search_index.

All tests use a synthetic SQLite database built in-process — no dump files,
no live backend required.

Design note on test ordering:
  Both the entity-boost target ("albert-einstein") and the distractor
  ("top-article") are given IDENTICAL chunk text so that their raw BM25 scores
  are equal.  Ordering is therefore determined solely by:
    - incoming_links  (distractor=100 → W_POP*log1p(100)≈9.23 advantage)
    - entity boost    (albert-einstein with "einstein" redirect → W_ENTITY*1=12)
  This makes tests (a) and (c) fully deterministic regardless of FTS5 tuning.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sqlite3
from pathlib import Path

import pytest

from wiki_store import (
    W_ENTITY,
    _build_alias_ngrams,
    _load_entity_boosts,
    search_index,
)

# ---------------------------------------------------------------------------
# Shared synthetic DB helpers
# ---------------------------------------------------------------------------

_SHARED_TEXT = "albert einstein studied physics at the university in berlin"
_SHARED_TITLE = "Generic Article"


def _make_db(path: Path, *, redirect_entries: list[tuple[str, str]] | None) -> None:
    """Build a minimal synthetic search index at *path*.

    redirect_entries=None  → no article_redirects table at all
    redirect_entries=[]    → table exists but is empty
    redirect_entries=[...] → table exists with the given (name_norm, slug) rows
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
    """)

    if redirect_entries is not None:
        conn.execute("""
            CREATE TABLE article_redirects (
                name_norm TEXT PRIMARY KEY,
                slug TEXT NOT NULL
            )
        """)
        for norm, slug in redirect_entries:
            conn.execute("INSERT INTO article_redirects VALUES (?, ?)", (norm, slug))

    for rowid, (chunk_id, article_id, incoming_links) in enumerate(
        [
            ("ae:0", "albert-einstein", 0),
            ("dist:0", "top-article", 100),
        ],
        start=1,
    ):
        conn.execute(
            "INSERT INTO chunks (id, article_id, title, text, chunk_index) VALUES (?, ?, ?, ?, 0)",
            (chunk_id, article_id, _SHARED_TITLE, _SHARED_TEXT),
        )
        conn.execute(
            "INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)",
            (rowid, _SHARED_TITLE, _SHARED_TEXT),
        )
        conn.execute(
            "INSERT INTO article_meta (slug, incoming_links) VALUES (?, ?)",
            (article_id, incoming_links),
        )

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# (a) Alias match boosts the right slug
# ---------------------------------------------------------------------------

def test_alias_match_boosts_right_slug(tmp_path):
    """'einstein' redirect → albert-einstein outranks higher-incoming_links distractor.

    Without boost: top-article wins (W_POP*log1p(100) ≈ 9.23).
    With boost:    albert-einstein wins (W_ENTITY*1 = 12.0 > 9.23).
    """
    db = tmp_path / "a.sqlite3"
    _make_db(db, redirect_entries=[("einstein", "albert-einstein")])
    results = search_index("einstein", limit=2, index_path=db)
    ids = [r["id"] for r in results]
    assert ids, "expected at least one result"
    assert ids[0] == "albert-einstein", (
        f"entity boost should surface albert-einstein first; got {ids}"
    )


# ---------------------------------------------------------------------------
# (b) Longer n-gram match boosts more than single term
# ---------------------------------------------------------------------------

def test_longer_ngram_boosts_more(tmp_path):
    """_load_entity_boosts returns max term-count per slug across all matched n-grams."""
    db_path = tmp_path / "b.sqlite3"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE article_redirects (name_norm TEXT PRIMARY KEY, slug TEXT NOT NULL)"
    )
    # slug-a is reachable via 1-gram "albert" AND 2-gram "albert einstein"
    conn.execute("INSERT INTO article_redirects VALUES ('albert', 'slug-a')")
    conn.execute("INSERT INTO article_redirects VALUES ('albert einstein', 'slug-a')")
    # slug-b is reachable only via 1-gram "einstein"
    conn.execute("INSERT INTO article_redirects VALUES ('einstein', 'slug-b')")
    conn.commit()

    ngrams = _build_alias_ngrams(["albert", "einstein"])
    boosts = _load_entity_boosts(conn, ngrams)
    conn.close()

    assert boosts.get("slug-a") == 2, (
        f"slug-a should use the 2-gram match (count=2); got {boosts.get('slug-a')}"
    )
    assert boosts.get("slug-b") == 1, (
        f"slug-b should use the 1-gram match (count=1); got {boosts.get('slug-b')}"
    )
    assert boosts["slug-a"] > boosts["slug-b"]

    # Verify score impact: slug-a gets W_ENTITY*2 = 24, slug-b gets W_ENTITY*1 = 12
    assert W_ENTITY * boosts["slug-a"] > W_ENTITY * boosts["slug-b"]


# ---------------------------------------------------------------------------
# (c) No article_redirects table → scores identical to no-boost path
# ---------------------------------------------------------------------------

def test_no_redirects_table_scores_unchanged(tmp_path):
    """Without article_redirects, top-article's incoming_links advantage is preserved.

    This is the inverse of test (a): same DB layout minus the redirects table.
    The ordering confirms entity_boost_map stays empty and the formula is
    byte-identical to the pre-redirect code path.
    """
    db = tmp_path / "c.sqlite3"
    _make_db(db, redirect_entries=None)  # no article_redirects table
    results = search_index("einstein", limit=2, index_path=db)
    ids = [r["id"] for r in results]
    assert ids, "expected at least one result"
    assert ids[0] == "top-article", (
        f"without redirects table, incoming_links advantage should keep top-article first; got {ids}"
    )


# ---------------------------------------------------------------------------
# (d) N-gram generation is correct for a 3-term query
# ---------------------------------------------------------------------------

def test_ngram_generation_3_terms():
    """All contiguous n-grams (n=1..3) for a 3-term input, no duplicates."""
    ngrams = _build_alias_ngrams(["albert", "einstein", "university"])
    phrase_to_n = dict(ngrams)

    # 1-grams
    assert phrase_to_n.get("albert") == 1
    assert phrase_to_n.get("einstein") == 1
    assert phrase_to_n.get("university") == 1

    # 2-grams (contiguous only)
    assert phrase_to_n.get("albert einstein") == 2
    assert phrase_to_n.get("einstein university") == 2
    assert "albert university" not in phrase_to_n  # non-contiguous, must be absent

    # 3-gram
    assert phrase_to_n.get("albert einstein university") == 3

    # No duplicates, exactly 3+2+1 = 6 entries
    assert len(ngrams) == 6

    # n never exceeds 3 for a 3-term input
    assert all(n <= 3 for _, n in ngrams)
