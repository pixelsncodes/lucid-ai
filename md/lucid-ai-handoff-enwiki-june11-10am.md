# Lucid AI — Session Handoff (Full English Wikipedia import)

**Repo:** `pixelsncodes/lucid-ai` (GitHub) · local at `~/lucid-ai` (Ubuntu WSL)
**Git identity for this repo:** commit author should be `pixelsncodes@gmail.com` (per-repo, not global)
**⚠️ Commit status unknown:** Claude Code modified files this session. FIRST ACTION next
session: `git -C ~/lucid-ai status` and commit/clean up before new work.

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
```

## Knowledgebases (now two)

| KB enum value     | Content                          | Size                                   | Role |
|-------------------|----------------------------------|----------------------------------------|------|
| `wikipedia`       | Simple English Wikipedia         | 247,035 articles / 484,691 chunks      | Fast dev/test target; smoke tests run against this |
| `wikipedia-full`  | Full English Wikipedia (NEW)     | 7,188,195 articles / 33,235,539 chunks | Real knowledgebase |

- Full index path: `backend/data/wikipedia-full/wikipedia-full.sqlite3` (~32 GB after
  streaming; check final size with `ls -lh`, expected ~40 GB with FTS index)
- SimpleWiki index path unchanged: `backend/data/wikipedia/wikipedia.sqlite3`
- Source dump (KEEP for now, do NOT delete yet): 64 bz2 part files in
  `backend/data/wikipedia-full/dumps/enwiki-content-20260607/` (~37 GB).
  Keep until next session confirms no re-import with different filters is wanted
  (e.g. excluding fictional-universe articles — see Atlantis regression below).
- All generated files (dumps, *.sqlite3, import state) are gitignored. Verify
  nothing large is staged before committing.

## Hard constraints (do not break)

- Unknown answers return EXACTLY: `I don't know from the selected Wikipedia knowledgebase.`
  with empty sources. Canonical test: `What is the capital of Atlantis?`
  **⚠️ THIS CURRENTLY FAILS on wikipedia-full — see regression below.**
- Answers must be grounded in retrieved Wikipedia sources; final LLM must not
  answer from general model memory in Wikipedia mode.
- Do not weaken the unknown fallback to make anything else work.
- SimpleWiki KB and all 23 smoke tests (both planner modes) must stay green.

---

## What was completed this session

### 1. Importer: `backend/import_wikipedia_full.py` (new)
- Fully streaming — never loads whole dump or intermediate JSON into memory.
- Input: single file OR directory; globs `*.json.bz2` + `*.json.gz` sorted by
  filename, ignores `_SUCCESS` marker. Dispatches bz2/gzip/snappy by extension.
- Parses Elasticsearch bulk format (action line + document line pairs),
  namespace 0 only, skips empty text.
- `--max-article-chars` (default 10000): truncates article text at last
  paragraph/sentence boundary before chunking. This is why the DB is ~40 GB
  instead of 60–100 GB.
- Shares chunking with SimpleWiki (imports `chunk_text`, `is_useful_chunk`,
  `slugify` from `wiki_store.py` — no copy-paste).
- FTS5 **external content** table (text stored once in `chunks`, index built via
  `INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')` post-pass — 2–5× faster
  than inline FTS maintenance, index adds only ~36% size overhead).
- Build pragmas: `journal_mode=OFF`, `synchronous=OFF`, large cache during
  import; restored to WAL/NORMAL on completion.
- Resumable: file-indexed state (`resume_file_index` + `resume_pairs_in_file`)
  in `wikipedia-full.import_state.json`, saved every batch commit; completed
  files skipped without decompression on resume. `--skip N` manual override.
- `--limit N` for trial runs; progress log every 10k articles; prints
  dump-deletion reminder after a successful full import.

### 2. Backend wiring
- `knowledge_base` enum extended with `wikipedia-full`; all retrieval paths
  (search_index, search_index_multi, planner, fallback) route per-KB.
- Planner layer, grounding/relevance validation, fallback logic untouched and
  shared across both KBs.

### 3. Import executed successfully
- Streaming: 7,188,195 articles / 33,235,539 chunks in 6,006 s (**1,197 art/s**,
  ~100 min). FTS post-pass rebuild completed after (~10–25 min). Total < 2.5 h.
- ~4.6 chunks/article (vs ~2 for SimpleWiki) — richer content as intended.
- Disk: 900 GB free on `/dev/sdd`; space is a non-issue.

### Download lessons learned (for future refreshes)
- Old dump location `dumps.wikimedia.org/other/cirrussearch/` is DEPRECATED
  (ended 20251229). New: `dumps.wikimedia.org/other/cirrus_search_index/<date>/index_name=enwiki_content/`
  — bzip2, one directory per index, multiple part files, same inner format.
- Wikimedia allows only **2 connections per IP** (429s beyond that).
- aria2c needs `-Z` or it treats multiple URLs as mirrors of ONE file
  (corrupting-range errors). Working command:
  ```
  aria2c -Z -j2 -x1 -c --retry-wait=10 -m 0 -d "$DEST" \
    "https://dumps.wikimedia.org/other/cirrus_search_index/${DUMP_DATE}/index_name=enwiki_content/enwiki_content-${DUMP_DATE}-"{00000..00063}.json.bz2
  ```
  (brace range must be OUTSIDE quotes or bash won't expand it; ~9 MB/s
  aggregate, ~1 h for the full dump)
- Part-file count (64) and naming verified against the live listing; spot-check
  one URL with `curl -sI ... | head -3` before launching.

---

## Validation results on wikipedia-full (the honest scorecard)

| Test | Result | Notes |
|------|--------|-------|
| "Who was France's leader during WW2?" | ✅ Correct (de Gaulle) | But top-ranked chunk was "Frances Perkins" — answer leaned on noisy ranking; right article came 2nd |
| "What university did Einstein attend?" | ❌ Fallback (wrong reason) | Article exists; BM25 over 33M chunks surfaced "Albert Einstein International School of San Pedro Sula" etc. Real article buried. This is the predicted FTS-at-scale noise problem |
| "What is the capital of Atlantis?" | ❌ **REGRESSION** | Returns "Poseidonis" sourced from "Atlantis (Aquaman)" (DC Comics). Full enwiki contains fictional-universe articles SimpleWiki lacked; grounding guard accepts the fictional chunk because it textually supports the claim. **Violates the hard constraint** |
| Same Atlantis query on 50k trial DB | ✅ exact fallback, empty sources | Proves pipeline/guard logic itself is intact; the regression is data-driven |
| Retrieval + relevance guard sanity (trial: "What is an aardvark?" → only Aardvark-Vanaheim in subset → fallback) | ✅ | Guard correctly rejects irrelevant matches instead of hallucinating |

---

## NEXT TASK (two parts, in priority order)

### Part 1 — Fix the Atlantis fallback regression (correctness; do first)
The hard constraint is violated: a question with no real-world answer now gets a
confident answer from a fictional-universe article. Investigate why the
grounding/relevance guard accepts "Atlantis (Aquaman)" as answering a
real-world factual question. Candidate directions (evaluate, don't assume):
- Detect fiction-context sources: Cirrus docs carry category/template metadata
  that could mark fictional-universe articles at import time; or detect at
  answer time from the source title/content.
- Distinguish "the only sources are about fiction and the question is not
  asking about fiction" → fallback.
- Consider whether the user should be able to ASK about fiction explicitly
  ("In DC Comics, what is the capital of Atlantis?" should arguably answer) —
  don't make fiction unreachable, make it non-default for real-world questions.
- A re-import with article filtering is an option (dump retained for this), but
  prefer a retrieval/guard fix — filtering at import loses legitimate content.
HARD RULES: do not weaken the fallback; "What is the capital of Atlantis?" on
wikipedia-full must return the exact unknown string with empty sources; all 23
SimpleWiki smoke tests stay green; add Atlantis-on-full to the smoke/manual
test set.

### Part 2 — Retrieval ranking at scale (quality; the Einstein problem)
BM25 over 33M chunks rewards short title-dense matches; canonical articles get
buried. The handoff already anticipated this as the point where hybrid
FTS + embeddings becomes justifiable. Entry points before going full embeddings:
- Strengthen title-aware ranking: exact-title match ("Albert Einstein") should
  dominate partial-title matches ("Albert Einstein International School of...").
- Consider popularity signals: Cirrus docs include `incoming_links` /
  popularity_score — these were NOT imported. Importing them as a ranking
  column may be the cheapest big win (would require re-import or an
  augmentation pass; dump retained).
- Then evaluate hybrid embeddings as a separate, larger feature.
Acceptance: "What university did Einstein attend?" answers correctly (ETH
Zurich / Zurich Polytechnic) with the Albert Einstein article in sources.

### Deferred (unchanged)
- Two-hop retrieval ("Did her daughter win one too?" — Marie Curie case).
- Full embeddings layer.
- Personal docs, memory, cyberdeck build.

---

## Housekeeping checklist for next session start
1. `git -C ~/lucid-ai status` — commit this session's work if Claude Code didn't.
2. `ls -lh ~/lucid-ai/backend/data/wikipedia-full/wikipedia-full.sqlite3` — record final DB size.
3. Confirm smoke tests green (both planner modes) before touching anything.
4. Dump deletion decision (`rm -rf backend/data/wikipedia-full/dumps/enwiki-content-20260607`,
   reclaims ~37 GB) — only after Part 1/Part 2 decisions rule out re-import.
