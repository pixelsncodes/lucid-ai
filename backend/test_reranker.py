"""Tests for the cross-encoder reranker and /debug/retrieval endpoint.

Four live-condition tests following the style of test_retrieval_regression.py:
1. Reranker reorders candidates by semantic relevance.
2. Chunk-0 stays pinned at position 0 for identity queries even when the
   reranker would prefer a different chunk.
3. RERANKER_ENABLED=False causes the reranker pass to be skipped entirely.
4. /debug/retrieval endpoint returns the expected JSON shape.
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

import reranker as reranker_mod
import wiki_store as ws
from main import app
from reranker import rerank
from wiki_store import search_index

client = TestClient(app)


# ---------------------------------------------------------------------------
# DB helpers (mirrors _make_meta_db in test_retrieval_regression.py)
# ---------------------------------------------------------------------------


def _make_db(path, articles, with_redirects=True):
    """Create a minimal enwiki-style DB.

    articles: list of (article_id, title, incoming_links, chunks, redirects)
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
    """)
    if with_redirects:
        conn.execute("""
            CREATE TABLE article_redirects (
                name_norm TEXT PRIMARY KEY,
                slug TEXT NOT NULL
            )
        """)

    rowid = 0
    for article_id, title, incoming_links, chunks, redirects in articles:
        conn.execute(
            "INSERT INTO article_meta (slug, incoming_links) VALUES (?, ?)",
            (article_id, incoming_links),
        )
        if with_redirects:
            for norm, slug in redirects:
                conn.execute(
                    "INSERT OR IGNORE INTO article_redirects VALUES (?, ?)",
                    (norm, slug),
                )
        for i, text in enumerate(chunks):
            rowid += 1
            conn.execute(
                "INSERT INTO chunks (id, article_id, title, text, chunk_index) VALUES (?,?,?,?,?)",
                (f"{article_id}:{i}", article_id, title, text, i),
            )
            conn.execute(
                "INSERT INTO chunks_fts(rowid, title, text) VALUES (?,?,?)",
                (rowid, title, text),
            )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Test 1: reranker reorders candidates by semantic relevance
# ---------------------------------------------------------------------------


def test_rerank_function_reorders_by_relevance():
    """The reranker should place the most semantically relevant chunk first."""
    query = "What is the capital of France?"
    # Arranged so the best answer (Paris) is not first in the input list.
    candidates = [
        {
            "text": (
                "France is a country in Western Europe with a rich cultural heritage. "
                "France borders Germany, Spain, and Italy. The French Revolution "
                "transformed France into a republic."
            ),
            "_label": "france_generic",
        },
        {
            "text": (
                "Paris is the capital and largest city of France. "
                "It is located in northern France on the Seine River and has a "
                "population of over two million people."
            ),
            "_label": "paris_capital",
        },
        {
            "text": (
                "Germany is a country in central Europe. Berlin is the capital of Germany."
            ),
            "_label": "germany",
        },
    ]
    result = rerank(query, candidates)

    assert result[0]["_label"] == "paris_capital", (
        f"Reranker should rank the Paris capital chunk first; got {result[0]['_label']!r}"
    )
    assert all("reranker_score" in c for c in result), "All candidates must have reranker_score"
    assert result[0]["reranker_score"] > result[-1]["reranker_score"], (
        "Highest reranker_score should be on the first result"
    )


# ---------------------------------------------------------------------------
# Test 2: chunk-0 pin survives reranking for identity queries
# ---------------------------------------------------------------------------


def test_chunk0_pin_survives_reranking(tmp_path):
    """For identity queries (entity_boost ≥ 2), chunk-0 must stay at position 0
    even when the reranker scores a later chunk higher.

    Setup: chunk-0 has generic text (reranker score ~0.95 for the query);
    chunk-1 has rich biographical text that the cross-encoder strongly prefers
    (~1.00 score).  Without the pin, chunk-1 would win.  With the pin, chunk-0
    must remain at index 0.
    """
    db = tmp_path / "pin.sqlite3"
    _make_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                1000,
                [
                    # chunk-0: generic overview — reranker scores ~0.95
                    "Michael Jackson biography and overview of career highlights and achievements.",
                    # chunk-1: rich biography — reranker scores ~1.00
                    (
                        "Michael Jackson (August 29, 1958 - June 25, 2009) was an American "
                        "singer, songwriter, and dancer, considered the King of Pop. "
                        "He released Thriller, the best-selling album of all time."
                    ),
                ],
                [
                    ("michael jackson", "michael-jackson"),
                    ("king of pop", "michael-jackson"),
                ],
            ),
            (
                "thriller-album",
                "Thriller",
                200,
                [
                    (
                        "Thriller is the sixth studio album by Michael Jackson, released "
                        "in 1982. It remains the best-selling album in history."
                    )
                ],
                [],
            ),
        ],
    )

    # "Who is Michael Jackson?" → terms=["michael","jackson"], identity_q=True,
    # entity_boost=2 (from "michael jackson" redirect).  chunk-0 must be pinned.
    results = search_index("Who is Michael Jackson?", limit=3, index_path=db)

    assert results, "Expected at least one result"
    assert results[0]["chunk_id"] == "michael-jackson:0", (
        f"chunk-0 must be pinned at position 0 for identity queries; "
        f"got {results[0]['chunk_id']!r}"
    )


# ---------------------------------------------------------------------------
# Test 3: RERANKER_ENABLED=False skips the reranker pass
# ---------------------------------------------------------------------------


def test_reranker_disabled_bypass(tmp_path, monkeypatch):
    """When RERANKER_ENABLED is False, search_index must skip the reranker
    entirely.  Candidates in _debug_info should have reranker_score=None.
    """
    db = tmp_path / "bypass.sqlite3"
    _make_db(
        db,
        [
            (
                "paris",
                "Paris",
                500,
                [
                    "Paris is the capital of France and its largest city.",
                    "Paris has many famous landmarks including the Eiffel Tower.",
                ],
                [("paris", "paris")],
            ),
            (
                "france",
                "France",
                800,
                [
                    "France is a country in Western Europe. Its capital is Paris.",
                ],
                [("france", "france")],
            ),
        ],
    )

    # Disable reranker at the wiki_store module level (where it is imported as
    # a name from config).
    monkeypatch.setattr(ws, "RERANKER_ENABLED", False)

    debug_info: dict = {}
    results = search_index("capital france", limit=3, index_path=db, _debug_info=debug_info)

    assert results, "Expected results"
    candidates = debug_info.get("candidates", [])
    assert candidates, "Expected debug candidates"
    for c in candidates:
        assert c.get("reranker_score") is None, (
            f"Expected reranker_score=None when disabled; got {c['reranker_score']!r} "
            f"for {c['chunk_id']!r}"
        )


# ---------------------------------------------------------------------------
# Test 4: /debug/retrieval endpoint shape
# ---------------------------------------------------------------------------


def test_debug_retrieval_endpoint_shape():
    """GET /debug/retrieval must return the expected JSON keys."""
    response = client.get("/debug/retrieval?q=Who+is+Michael+Jackson")
    assert response.status_code == 200, f"Expected 200; got {response.status_code}"

    data = response.json()
    required_keys = {"query", "kb", "terms", "candidates", "chunk0_injected",
                     "threshold_passed", "final_outcome"}
    missing = required_keys - data.keys()
    assert not missing, f"Response missing keys: {missing}"

    assert isinstance(data["query"], str)
    assert isinstance(data["kb"], str)
    assert isinstance(data["terms"], list)
    assert isinstance(data["candidates"], list)
    assert isinstance(data["chunk0_injected"], bool)
    assert isinstance(data["threshold_passed"], bool)
    assert data["final_outcome"] in {"retrieved", "unknown", "fiction-guard"}

    # If any candidates were returned, verify their shape.
    if data["candidates"]:
        c = data["candidates"][0]
        for key in ("article", "chunk_index", "chunk_id", "fts5_score", "reranker_score"):
            assert key in c, f"Candidate missing key {key!r}; keys: {list(c)}"
