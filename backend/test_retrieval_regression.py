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

from wiki_store import (
    CHUNK_INTRO_BONUS,
    fts_term_variants,
    is_identity_query,
    query_terms,
    search_index,
)


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


# ---------------------------------------------------------------------------
# CHUNK_INTRO_BONUS gate — identity vs non-identity queries
# ---------------------------------------------------------------------------


def test_is_identity_query_pure_entity():
    """All terms are the entity anchor → identity query."""
    assert is_identity_query(["michael", "jackson"], {"michael-jackson": 2})


def test_is_identity_query_with_intent_terms():
    """Extra terms beyond the anchor → NOT an identity query.

    'What did Jackson do in the 70s?' must NOT receive CHUNK_INTRO_BONUS.
    entity_boost=2 but len(terms)=3, so the gate should reject it.
    """
    assert not is_identity_query(
        ["michael", "jackson", "70s"], {"michael-jackson": 2}
    )


def test_is_identity_query_single_word():
    """Single-word queries are never identity (boost < 2 implies same)."""
    assert not is_identity_query(["paris"], {"paris": 1})


def test_is_identity_query_empty_boost_map():
    assert not is_identity_query(["michael", "jackson"], {})


def test_chunk_intro_bonus_constant_value():
    """CHUNK_INTRO_BONUS must be 15.0 — matches the observed 12.7-point BM25 gap."""
    assert CHUNK_INTRO_BONUS == 15.0


def test_chunk_intro_bonus_not_applied_for_non_identity_query(tmp_path):
    """Non-identity query: chunk 0 must NOT be forced to rank first.

    'What did Michael Jackson do in the 70s?' has 3 terms; entity_boost=2 < 3,
    so is_identity_query=False.  A mid-article chunk with dense on-topic text
    should beat the intro chunk without interference from CHUNK_INTRO_BONUS.
    """
    db = tmp_path / "mj_nonidentity.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    # chunk 0: intro — sparse on '70s'
                    "Michael Jackson was an American pop star known as the King of Pop.",
                    # chunk 1: dense on '70s' — should outrank chunk 0 on a 70s query
                    "During the 70s Jackson released Off the Wall and Thriller. "
                    "His 70s career defined 70s pop music with 70s chart hits.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )
    results = search_index(
        "Michael Jackson 70s career", limit=3, index_path=db
    )
    assert results, "should find michael-jackson"
    # The intro-bonus gate must not fire here (3 terms, boost=2 → is_identity=False).
    # chunk 1 has the higher BM25 on '70s career' — verify it ranks first.
    top = results[0]
    assert top["id"] == "michael-jackson"
    # chunk_id is formatted as "<article_id>:<chunk_index>"
    chunk_idx = int(top["chunk_id"].split(":")[-1])
    assert chunk_idx == 1, (
        f"non-identity query should surface chunk 1 (dense 70s text), got chunk {chunk_idx}"
    )


def test_chunk_intro_bonus_applied_for_identity_query(tmp_path):
    """Identity query: chunk 0 must rank above higher-BM25 mid-article chunks."""
    db = tmp_path / "mj_identity.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    # chunk 0: brief intro — fewer raw term hits
                    "Michael Jackson (August 29, 1958 – June 25, 2009) was an American singer.",
                    # chunk 1: lots of 'michael' + 'jackson' repetition → higher BM25
                    "Michael Jackson's work includes Off the Wall. Michael Jackson also "
                    "released Thriller. Jackson was the best-selling artist. "
                    "Michael Jackson won many awards. Jackson is the King of Pop.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )
    results = search_index(
        "Who is Michael Jackson?", limit=3, index_path=db
    )
    assert results, "should find michael-jackson"
    top = results[0]
    assert top["id"] == "michael-jackson"
    chunk_idx = int(top["chunk_id"].split(":")[-1])
    assert chunk_idx == 0, (
        f"identity query should surface intro chunk (0), got chunk {chunk_idx}"
    )


# ---------------------------------------------------------------------------
# Hybrid query — Cases B and C
# ---------------------------------------------------------------------------


def test_hybrid_query_case_c_standalone_list_names(tmp_path):
    """Case C: 'List the names of Michael Jackson's albums.' must find albums.

    'names' at the front is not a stopword, so it poisons the main ladder.
    The hybrid query drops it (anchor='michael jackson', post-anchor='albums')
    and fires 'michael jackson albums' which finds the discography chunk.
    """
    db = tmp_path / "mj_albums.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    "Michael Jackson was an American pop icon.",
                    "Michael Jackson released many albums including Thriller and Bad.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
            (
                "michael-jackson-discography",
                "Michael Jackson discography",
                200,
                [
                    "The albums of Michael Jackson include Off the Wall, Thriller, "
                    "Bad, Dangerous, and HIStory.",
                ],
                [("michael jackson discography", "michael-jackson-discography")],
            ),
        ],
    )
    results = search_index(
        "List the names of Michael Jackson's albums.", limit=3, index_path=db
    )
    ids = [r["id"] for r in results]
    assert "michael-jackson" in ids or "michael-jackson-discography" in ids, (
        f"Case C: should find MJ or discography article; got {ids}"
    )
    # Specifically verify that albums-related text is in the results
    texts = " ".join(r["text"] for r in results).lower()
    assert "album" in texts, f"Case C: no album text in results; ids={ids}"


def test_hybrid_query_case_b_typo_with_entity_anchor(tmp_path):
    """Case B class fix: typo before entity anchor still finds the article.

    A query with pre-anchor noise (e.g. 'whate') is rescued because:
    - anchor='michael jackson' starts at position > 0 in terms
    - hybrid drops the noise: fires 'michael jackson iconic songs'
    - even if 'iconic songs' misses, the ladder floor 'michael AND jackson' finds MJ
    """
    db = tmp_path / "mj_songs.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    "Michael Jackson is a pop icon.",
                    "Michael Jackson's iconic songs include Billie Jean and Thriller. "
                    "His solo career produced iconic singles that defined pop music.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )
    # Simulate: planner prepended entity but original typo is still in query terms
    results = search_index(
        "Michael Jackson whate iconic songs solo career", limit=3, index_path=db
    )
    ids = [r["id"] for r in results]
    assert "michael-jackson" in ids, (
        f"Case B class fix: typo query with entity anchor must find michael-jackson; got {ids}"
    )


def test_hybrid_fires_when_first_level_returns_wrong_hits(tmp_path):
    """Fix 1 regression: hybrid must fire even when the main ladder's first level
    returns plausible-but-wrong hits (non-empty), not just when it returns nothing.

    Old gate: `if hybrid_search_terms and first_level_empty` — Case C fails here
    because 'names michael jackson albums' finds popular-distractor (all 4 terms)
    as its first-level result. The gate never triggers, MJ stays out of the pool.

    New design: hybrid (`michael AND jackson AND (names OR albums)`) fires
    unconditionally when intent_terms is non-empty, adding MJ to the pool so
    entity_boost re-ranking can promote it above the distractor.
    """
    db = tmp_path / "wrong_hits_gate.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "popular-distractor",
                "Music Overview",
                80_000,
                [
                    # All four query terms present → full AND ladder finds this first.
                    # But it's NOT the right article.
                    "The names of michael jackson albums are covered in this overview "
                    "of popular music history spanning many decades.",
                ],
                [],
            ),
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    "Michael Jackson was an American pop icon.",
                    # chunk 1 has 'albums' but NOT 'names' — full AND misses it,
                    # hybrid (michael AND jackson AND (names OR albums)) finds it.
                    "Michael Jackson released many albums including Thriller and Bad.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )
    results = search_index(
        "List the names of Michael Jackson's albums.", limit=3, index_path=db
    )
    ids = [r["id"] for r in results]
    assert "michael-jackson" in ids, (
        f"hybrid must fire even when first level returns wrong hits; got {ids}"
    )


def test_chunk0_injection_identity_query(tmp_path):
    """Fix 2 regression: chunk 0 must be fetched and injected for identity
    queries when it falls outside the FTS pool.

    Simulates the live enwiki condition: 110 mid-article chunks all have dense
    entity-term repetition, so they dominate the FTS ranking and push chunk 0
    (the intro, which mentions the entity only once in its text) beyond the
    search_limit. The injection step must fetch it directly via a targeted
    FTS query, then CHUNK_INTRO_BONUS promotes it to rank 1.
    """
    db = tmp_path / "mj_chunk0_inject.sqlite3"

    # Chunk 0: sparse entity mentions in text (entity appears only in title column)
    intro_chunk = "Born in Gary, Indiana, the artist became the best-selling musician of all time."

    # 110 mid-chunks: dense entity repetition → rank above chunk 0 in FTS
    # (search_limit = min(500, max(limit*50, 100)) = 100 for limit=1 call below,
    # so 110 chunks guarantee chunk 0 is pushed below the pool threshold)
    mid_chunks = [
        f"Michael Jackson performed Michael Jackson songs. "
        f"Michael Jackson's discography includes jackson milestone {i}."
        for i in range(110)
    ]

    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [intro_chunk] + mid_chunks,
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )

    # limit=1 → search_limit=100; with 110 higher-scoring mid-chunks, chunk 0
    # is absent from the normal FTS pool and must be injected.
    results = search_index("Who is Michael Jackson?", limit=1, index_path=db)
    assert results, "should find michael-jackson"
    top = results[0]
    assert top["id"] == "michael-jackson"
    chunk_idx = int(top["chunk_id"].split(":")[-1])
    assert chunk_idx == 0, (
        f"injection + CHUNK_INTRO_BONUS should surface intro chunk (0), got chunk {chunk_idx}"
    )


def test_hybrid_degrades_gracefully_no_preanchor_noise(tmp_path):
    """When anchor is at position 0, hybrid_search_terms is None → no extra query.

    'Michael Jackson iconic songs' has entity at positions 0-1 → no pre-anchor
    noise → identical to today's behavior.
    """
    db = tmp_path / "mj_graceful.sqlite3"
    _make_meta_db(
        db,
        [
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                [
                    "Michael Jackson's iconic songs include Billie Jean and Thriller.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )
    results = search_index(
        "Michael Jackson iconic songs", limit=3, index_path=db
    )
    ids = [r["id"] for r in results]
    assert "michael-jackson" in ids, f"clean query should still find MJ; got {ids}"


# ---------------------------------------------------------------------------
# Fiction guard — holds even when hybrid fires for a fictional entity
# ---------------------------------------------------------------------------


def _make_meta_db_with_fiction(
    path: Path,
    articles: list[tuple[str, str, int, str | None, list[str], list[tuple[str, str]]]],
) -> None:
    """Like _make_meta_db but includes fiction_kind in article_meta."""
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
    for article_id, title, incoming_links, fiction_kind, chunks, redirects in articles:
        conn.execute(
            "INSERT INTO article_meta (slug, incoming_links, fiction_kind) VALUES (?, ?, ?)",
            (article_id, incoming_links, fiction_kind),
        )
        for norm, slug in redirects:
            conn.execute(
                "INSERT OR IGNORE INTO article_redirects VALUES (?, ?)",
                (norm, slug),
            )
        for i, chunk_text_val in enumerate(chunks):
            rowid += 1
            chunk_id = f"{article_id}:{i}"
            conn.execute(
                "INSERT INTO chunks (id, article_id, title, text, chunk_index) VALUES (?, ?, ?, ?, ?)",
                (chunk_id, article_id, title, chunk_text_val, i),
            )
            conn.execute(
                "INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)",
                (rowid, title, chunk_text_val),
            )

    conn.commit()
    conn.close()


def test_fiction_guard_holds_when_hybrid_fires(tmp_path):
    """Fictional entity fetched via hybrid is removed by apply_fiction_filter.

    'names Michael Jackson capital city' has pre-anchor noise ('names') so the
    hybrid fires anchor='michael jackson' + post-anchor='capital city'.  If that
    somehow surfaces a fictional article tagged fiction_kind='entity', the
    downstream filter must still return it so /chat returns 'unknown'.
    """
    from main import apply_fiction_filter

    db = tmp_path / "fiction_hybrid.sqlite3"
    _make_meta_db_with_fiction(
        db,
        [
            (
                "fictional-atlantis",
                "Atlantis (DC Comics)",
                200,
                "entity",  # fiction_kind
                [
                    "Atlantis is a fictional underwater city in DC Comics.",
                    "The capital city of Atlantis in DC Comics is Poseidonis.",
                ],
                [("atlantis dc comics", "fictional-atlantis"), ("atlantis dc", "fictional-atlantis")],
            ),
            (
                "michael-jackson",
                "Michael Jackson",
                5000,
                None,  # not fictional
                [
                    "Michael Jackson was an American pop star.",
                ],
                [("michael jackson", "michael-jackson")],
            ),
        ],
    )

    # Query with pre-anchor noise to trigger hybrid
    results = search_index(
        "names Michael Jackson capital city", limit=3, index_path=db
    )
    # Build meta dict as main.py does
    meta = {
        "fictional-atlantis": {"fiction_kind": "entity", "incoming_links": 200, "popularity_score": None},
        "michael-jackson": {"fiction_kind": None, "incoming_links": 5000, "popularity_score": None},
    }
    filtered = apply_fiction_filter(results, meta)
    fict_ids = [r["id"] for r in filtered if r["id"] == "fictional-atlantis"]
    assert not fict_ids, (
        f"fiction guard must remove fictional-atlantis even when hybrid fires; "
        f"filtered ids={[r['id'] for r in filtered]}"
    )


def test_fiction_guard_atlantis_dc_by_title(tmp_path):
    """is_fictional_source correctly identifies DC Atlantis by title parenthetical."""
    from main import is_fictional_source

    assert is_fictional_source("Atlantis (DC Comics)"), (
        "Atlantis (DC Comics) should be detected as fictional by title paren tag"
    )
    assert is_fictional_source("Atlantis (Aquaman)"), (
        "Atlantis (Aquaman) should be detected as fictional"
    )
    assert not is_fictional_source("Atlantis"), (
        "bare 'Atlantis' title without paren should not be auto-flagged as fictional"
    )
