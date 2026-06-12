# Lucid AI — Session Handoff (Fiction guard + ranking overhaul complete)

**Repo:** `pixelsncodes/lucid-ai` (GitHub) · local at `~/lucid-ai` (Ubuntu WSL)
**Git identity for this repo:** commit author should be `pixelsncodes@gmail.com` (per-repo, not global)
**Commit status:** clean — all work committed and pushed this session.

---

## What Lucid is

Local/offline personal AI assistant. Backend FastAPI + local LLM via Ollama
(`llama3.2:3b`), React/Vite frontend, local STT, Piper TTS (default voice
`ryan-medium`). Knowledgebases are Wikipedia indexes in SQLite FTS5. Goal: useful
local desktop assistant first; personal docs, memory, and a portable cyberdeck
build come later.

**Run backend:** `cd ~/lucid-ai/backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000`
(if port 8000 is busy: `fuser -k 8000/tcp` first)
**Run frontend:** `cd ~/lucid-ai/frontend && npm run dev`
**Validate:**
```
cd ~/lucid-ai
backend/.venv/bin/python -m py_compile backend/wiki_store.py backend/main.py backend/import_wikipedia_full.py
bash -n scripts/wiki_smoke_test.sh
scripts/wiki_smoke_test.sh            # needs backend + Ollama running; 23 tests, BOTH planner modes
backend/.venv/bin/pytest backend/test_fiction_guard.py backend/test_fiction_meta.py \
  backend/test_redirect_augment.py backend/test_entity_boost.py -v   # 53 tests; 2 live (skip if no backend)
python3 scripts/rank_probe.py         # ranking sanity across 3 weight configs
```

---

## Previous NEXT TASK — BOTH DONE

### Part 1 — Atlantis fallback regression ✅ DONE
`"What is the capital of Atlantis?"` on wikipedia-full now returns the exact
unknown string with empty sources. Fiction guard is metadata-driven:
- **article_meta** side table (see below) carries `fiction_kind ∈ {entity, work, none}`
  derived from CirrusSearch category lists at augmentation time.
- `apply_fiction_filter` drops any result whose `fiction_kind='entity'` (fictional
  character/place) when the question is NOT explicitly fiction-scoped.
- Heuristic title/text fallback retained for articles without metadata.
- Fiction scope detection (`question_is_fiction_scoped`) gates DC/Marvel questions:
  "In DC Comics, what is the capital of Atlantis?" is fiction-scoped and NOT
  forced to unknown (though retrieval recall for that case is still weak — see scorecard).

### Part 2 — Retrieval ranking at scale ✅ DONE (Einstein acceptance passes)
`"What university did Einstein attend?"` now answers correctly (University of
Zurich / ETH Zurich) with the Albert Einstein article in sources.
- **Re-ranking formula** (active only when article_meta exists):
  `adjusted_score = bm25_score - W_POP·log1p(incoming_links) - W_TITLE·[title_covered] - W_ENTITY·ngram_count`
  with `W_POP=2.0`, `W_TITLE=8.0`, `W_ENTITY=12.0`.
- **Merged relaxation ladder:** all levels (full query down to 2-term floor)
  pooled into one merged set (cap 800 rows), deduped by chunk, then re-ranked.
  Prevents topic-article chunks from falling out of the window when an intent
  term ("attend") doesn't co-occur in the same chunk as the topic term ("Einstein").
- **Entity boost via article_redirects:** redirect aliases (own-title + all
  namespace-0 redirect titles from the Cirrus dump) are stored in `article_redirects`.
  At query time, contiguous n-grams of query terms (n=1..4) are matched against
  `name_norm` in that table; the best matching n-gram length drives `ngram_count`,
  which subtracts `W_ENTITY·ngram_count` from the adjusted score (lower = higher rank).
  `"einstein"` → `albert-einstein` is a 1-gram match (boost = 12.0), enough to
  leapfrog articles with higher incoming_links.

---

## Knowledgebases

| KB enum value     | Content                          | Chunks       | Role |
|-------------------|----------------------------------|--------------|------|
| `wikipedia`       | Simple English Wikipedia         | 484,691      | Fast dev/test; smoke tests use this |
| `wikipedia-full`  | Full English Wikipedia           | 33,235,539   | Real knowledgebase |

**All ranking/fiction-guard features are gated on `article_meta` presence.**
SimpleWiki path is completely untouched — it has no `article_meta` and uses the
original BM25 + title-rank sort.

---

## New tables in wikipedia-full.sqlite3

### article_meta
7,170,257 rows. Schema:
```sql
CREATE TABLE article_meta (
    slug             TEXT PRIMARY KEY,
    title            TEXT,
    page_id          INTEGER,
    incoming_links   INTEGER,
    popularity_score REAL,
    fiction_kind     TEXT CHECK(fiction_kind IN ('entity','work','none'))
);
```
Built by `augment_wikipedia_meta.py` (no `--redirects-only` flag). Streams all
64 CirrusSearch part files; idempotent (INSERT OR REPLACE). Albert Einstein:
`incoming_links=10998, fiction_kind='none'`.

### article_redirects (+ idx_redirects_name_norm)
18,104,490 alias rows. Schema:
```sql
CREATE TABLE article_redirects (
    name_norm TEXT,
    slug      TEXT,
    PRIMARY KEY (name_norm, slug)
);
CREATE INDEX idx_redirects_name_norm ON article_redirects(name_norm);
```
Built by `augment_wikipedia_meta.py --redirects-only`. Each article contributes
its own-title alias plus all namespace-0 redirect titles, normalized to lowercase
with collapsed whitespace. `~2.53 aliases/article` on average. Idempotent
(INSERT OR IGNORE). Takes ~70–80 min to populate all 64 part files.

**DB size:** main file `~52 GB`, WAL `~6 GB` (will checkpoint; on-disk total
after checkpoint ≈ 52–58 GB). Source dump retained separately — see below.

---

## Test suite

| File | Tests | Type | Notes |
|------|-------|------|-------|
| `test_fiction_guard.py` | 14 | Unit + 2 live | Heuristic detection, filter logic, Atlantis live gate, Einstein acceptance gate |
| `test_fiction_meta.py` | 19 | Unit | `classify_fiction` across entity/work/none cases; creator-exclusion; DC/Marvel edge cases |
| `test_redirect_augment.py` | 16 | Unit | `normalize_alias`, alias extraction logic, namespace filtering |
| `test_entity_boost.py` | 4 | Unit (synthetic DB) | Boost math, n-gram priority, no-table fallback |
| **Total** | **53** | | All pass: `backend/.venv/bin/pytest backend/test_*.py -v` |

Live tests (`test_chat_atlantis_capital_falls_back_live`,
`test_chat_einstein_university_answered_live`) skip cleanly if the backend or
wikipedia-full DB is unavailable.

**Smoke tests:** 23 tests, both planner modes, run against SimpleWiki — all green.
`rank_probe.py`: checks W_POP/W_TITLE/W_ENTITY configs across Einstein and France probes;
now includes the "What university did Einstein attend?" acceptance phrasing probe.

---

## Honest scorecard (wikipedia-full)

| Query | Result | Notes |
|-------|--------|-------|
| "What is the capital of Atlantis?" | ✅ Unknown, empty sources | Hard gate — passes |
| "What university did Einstein attend?" | ✅ University of Zurich / Albert Einstein in sources | Acceptance gate — passes |
| "What is the capital of France?" | ✅ Paris | Passes |
| "In DC Comics, what is the capital of Atlantis?" | ⚠️ Unknown | Fiction is reachable in principle (Poseidonis); retrieval recall fails for this verbose phrasing — top candidates are Atlantis (Aquaman) but fiction filter allows fiction-scoped questions. Retrieval-recall bug: the article appears in retrieval but the reply falls back. **Not a regression from the constraint; tracked for next session.** |
| "Who was France's leader during WW2?" | ⚠️ Unknown | **Regression from prior session** (was: de Gaulle). The re-ranking/relaxation changes altered which chunks surface. Short stopword-heavy queries ("who was", "during") are harder after the ladder merge. Retrieval recall gap for verbose factual questions — tracked for next session. |

Both gaps are **retrieval-recall problems for verbose phrasings**, not correctness
regressions (no wrong answer is given; fallback is correct). The de Gaulle case
is the priority since it was previously working.

---

## Dump decision

**KEEP** `backend/data/wikipedia-full/dumps/enwiki-content-20260607/` (~37 GB).
The dump was used twice this session (article_meta pass + article_redirects pass).
Future work may need it: re-chunk with different `max_chars`, re-augment with new
metadata fields, or a porter-stemming FTS rebuild. Space is not a constraint.

---

## Candidate next tasks (priority order)

1. **Fix "Who was France's leader during WW2?" recall gap** — previously answered
   correctly (de Gaulle); now falls back. Likely caused by merged relaxation ladder
   diluting the query. Profile which FTS candidates surface; consider whether
   planner multi-query (fan out to "France World War II leader", "de Gaulle") helps
   standalone factual questions.

2. **Fix "In DC Comics, what is the capital of Atlantis?" recall** — fiction-scoped
   questions are allowed through the guard; the problem is retrieval isn't surfacing
   the right article chunk with the answer. "Poseidonis" appears in Atlantis
   (Aquaman); check why it doesn't reach the LLM.

3. **Porter-stemming FTS rebuild evaluation** — the FTS index has no stemming;
   "attend"/"attended" are different tokens. A porter-stemmer tokenizer rebuild
   might fix the verbose-phrasing recall class of problems at the retrieval layer.
   Would require re-importing ~33M chunks — evaluate whether gain is worth the time.

4. **Planner multi-query for standalone factual questions** — the planner currently
   fans out only on follow-up entity resolution. Extending it to rewrite verbose
   queries ("Who was France's leader during WW2?") into multiple targeted queries
   could recover recall without a full FTS rebuild.

### Deferred (unchanged)
- Two-hop retrieval ("Did her daughter win one too?" — Marie Curie case).
- Full embeddings layer.
- Personal docs, memory, cyberdeck build.

---

## Hard constraints (unchanged)

- Unknown answers return EXACTLY: `I don't know from the selected Wikipedia knowledgebase.`
  with empty sources.
- Answers must be grounded in retrieved Wikipedia sources; LLM must not answer
  from general model memory in Wikipedia mode.
- Do not weaken the unknown fallback to make anything else work.
- SimpleWiki KB and all 23 smoke tests (both planner modes) must stay green.
- `"What is the capital of Atlantis?"` on wikipedia-full must return exact unknown
  with empty sources.
- `"What university did Einstein attend?"` on wikipedia-full must name
  ETH Zurich / Zurich Polytechnic / Swiss Federal and cite Albert Einstein article.

---

## Housekeeping checklist for next session start

1. `git -C ~/lucid-ai status` — should be clean.
2. `ls -lh backend/data/wikipedia-full/wikipedia-full.sqlite3` — note size (WAL
   may have checkpointed; final on-disk size ≈ 52–58 GB).
3. Confirm smoke tests and pytest green before touching anything.
4. Check if WAL file is large: `ls -lh backend/data/wikipedia-full/*.sqlite3-wal`
   — if >2 GB, checkpoint it:
   `sqlite3 backend/data/wikipedia-full/wikipedia-full.sqlite3 'PRAGMA wal_checkpoint(FULL);'`
