# SCRAP — Session Handoff (June 12, 2026)

## Project snapshot
- Project: **SCRAP** (formerly Lucid AI) — local/offline voice-first assistant.
- Repo: `pixelsncodes/lucid-ai` (public GitHub). Working copy: `~/lucid-ai` on Ubuntu WSL (Windows PC).
- Backend: FastAPI + Ollama (`llama3.2:3b`), local STT (faster-whisper), Kokoro TTS (primary) + Piper (secondary), Wikipedia SQLite FTS5 knowledge bases (SimpleWiki + full enwiki, 33M chunks).
- Frontend: React/Vite, voice-first dot-matrix character UI. Dev server: `npm run dev` → localhost:5173.
- Backend Python env: **`~/lucid-ai/backend/.venv`** (hidden folder — use `.venv/bin/pip` / `.venv/bin/python`).
- Workflow: worked on directly with Claude Code in `~/lucid-ai`. Verify `git status` is clean before starting.

## Completed work — DO NOT REDO

### Personality session
1. **Identity**: `SYSTEM_PROMPT` in `backend/config.py` rewritten for SCRAP (dry wit, deadpan, salvage-bot, helpful underneath). Fixed the lingering "LUCID" intro: the KB-mode branch of `/chat` in `backend/main.py` (~line 1917) had its own inline `rag_system_prompt` saying "You are LUCID". User-facing LUCID strings updated in README, docs, `scripts/dev_status.sh`. Deliberately left: `X-LUCID-TTS-*` HTTP headers (smoke tests grep exact names; not user-visible), repo/folder name, temp file paths, archived handoff docs.
2. **Emotion tag contract** (frontend parser: `frontend/src/components/matrix/engine.js → extractReplyFace`):
   - Valid set: `:)  :(  ;)  :'(  :D  :P  :/  :|  ^-^  >:(  :O  :3  8)  -_-  O_O  T_T  :*  <3`
   - Backend `normalize_reply_tag()` in `main.py` is **the law** (the prompt is advisory with a 3B model): strips invalid trailing emoticon-like tokens, maps near-misses to valid tags (ambiguous/laughing variants like `xD` map to `:P`, **never `:D`**), appends `:)` as last resort. Applied **only** to `knowledge_base == "none"` replies — KB replies stay factual, no tag.
   - `:D` is reserved: it means "a joke was told" and triggers the frontend laugh sequence.
3. **Dad-joke corpus**: `backend/data/dad_jokes.json` (flat `{"setup", "punchline", "id"}` array; fully offline at runtime). Two joke paths: Path 1 (direct serve) for explicit triggers and idle — returns verbatim corpus joke, no LLM call, intro from `JOKE_INTROS` rotation in `config.py`. Path 2 (seeded injection) — `JOKE_RANDOM_PROBABILITY` (8%) per no-KB turn with cooldown (≥3 turns), both in `config.py`. Recently-served joke IDs tracked in-memory to avoid repeats.
4. **Laugh audio**: re-enabled via pre-recorded SFX (`backend/static/sfx/`). `ha-ha.mp3` plays on `:D` (joke told); `ba-dum-tss.mp3` plays on corpus jokes. `sfx` field on joke responses carries the clip name. Voice mode reopens mic after `RESUME_LISTEN_DELAY_MS` (420ms, in `frontend/src/App.jsx`). Constants `LAUGH_AUDIO_ENABLED` and `LAUGH_TEXT` live in `frontend/src/identity.js`.
5. **Audio/animation sync fix**: matrix speaking state driven by the audio element's `'playing'` event; ends on `'ended'`/`'error'`/`'pause'`, with a safety timeout to idle/`:/` if TTS never starts. Voice-mode listen handoff keyed on audio `'ended'`.
6. **Rolling subtitles**: word-by-word subtitle window (`subtitleWindow`) driven by `audio.currentTime` + `buildWordTimings()` in App.jsx. Char-count-weighted timing estimate, three-word window (prev/current/next), rendered in `MatrixStage.jsx`.

### VAD session — browser-side voice activity detection

`@ricky0123/vad-web` (Silero VAD via onnxruntime-web) triggers end-of-speech in conversation mode. Tap-to-stop in draft mode is unchanged.

**How it works**: `MicVAD.new()` is created non-blocking after each 'send' recording starts. It shares the existing `getUserMedia` stream via `getStream: async () => stream` (one mic capture; VAD owns a separate AudioContext). `onSpeechEnd` → `recorder.stop()` → existing blob → transcribe → auto-send, untouched. `onSpeechStart` clears the no-speech safety timer. `destroyVad()` is called in `recorder.onstop`, the getUserMedia error path, and unmount — VAD can never outlive the recording.

**Constants in `frontend/src/App.jsx`** (next to `RESUME_LISTEN_DELAY_MS`):
- `VAD_SILENCE_MS = 800` — maps to `redemptionMs` (ms of silence after speech end before `onSpeechEnd` fires)
- `VAD_SPEECH_THRESHOLD = 0.3` — `positiveSpeechThreshold`; library default
- `VAD_NO_SPEECH_TIMEOUT_MS = 10000` — if no `onSpeechStart` within 10 s, recorder stops on the discard path; conversation exits silently

**Offline assets** at `frontend/public/vad/` (survives clean installs via `postinstall` in `package.json`):
- `vad.worklet.bundle.min.js` — AudioWorklet bundle
- `silero_vad_legacy.onnx` — Silero VAD model
- `ort-wasm-simd-threaded.wasm` + `ort-wasm-simd-threaded.asyncify.wasm` — ONNX runtime WASM

`baseAssetPath` and `onnxWASMBasePath` both point to `/vad/`. No CDN required at runtime.

**Backend**: `vad_filter=True` on `model.transcribe()` in `/stt` endpoint strips leading/trailing non-speech from recordings (which now include silence before speech starts).

### Retrieval session — all three repro cases FIXED
Root causes were in FTS5 query construction (filler-word stopwords), plural/suffix handling, and score threshold behavior on short chunks. Fixes are unconditional (no feature flags).

1. **Phrasing sensitivity** ("What do you know about X?" vs "What can you tell me about X?"): fixed by **position-independent hybrid intent split** — query term extraction now strips conversational-verb stopwords regardless of position (previously only stripped leading ones), so both phrasings produce identical FTS5 queries.
2. **Identity / chunk-0 injection**: "What is X?" style queries that hit a known entity now unconditionally inject the article's first chunk (chunk-0) before ranked results, preventing the "unknown" false negative that occurred when the top-scoring chunk happened to be a later section.
3. **Regression tests**: live-condition tests added in `backend/test_retrieval_regression.py` (27 tests) covering all three original repro cases plus related variants. Previously there were no live-KB regression tests.
4. Earlier fixes from the enwiki FTS pipeline pass: conversational-verb stopwords, e-ending plural variant, tail-term fallback search (13 regression tests from that session are included in the 27).

### Reranker session — cross-encoder reranking + retrieval diagnostics

**Cross-encoder reranker** (`backend/reranker.py`): ms-marco-MiniLM-L-6-v2 (ONNX, fully offline). Model vendored at `backend/models/reranker/` (5 files: model.onnx ~91 MB, tokenizer.json, tokenizer_config.json, special_tokens_map.json, config.json). No torch required at runtime — uses `onnxruntime` + `tokenizers` already in the venv. Lazy-loaded on first query.

**Placement** (`backend/wiki_store.py → search_index`): After the FTS5 adjusted-score sort, candidates are split into:
- **Pinned** chunk-0: identity queries with entity_boost ≥ 2 → stays at position 0 unconditionally.
- **Entity-anchored** (entity_boost ≥ 1): articles with at least one query-term redirect match — kept in their FTS5-adjusted order to preserve entity disambiguation. Critically, this prevents the cross-encoder from promoting a topically-adjacent article (e.g. "Alfred Einstein") above the entity-targeted one ("Albert Einstein") when the user says "Einstein" and the redirect maps "einstein" → albert-einstein.
- **Rerank pool** (entity_boost = 0): freely reranked by cross-encoder. These are generic candidates with no entity signal, where semantic reranking adds value.

**Latency**: batched ONNX inference, ~28ms for top-20 candidates on CPU. Well under the 500ms budget.

**Config constants** (in `backend/config.py`):
- `RERANKER_ENABLED = True` — set False to bypass without a revert.
- `RERANK_TOP_N = 20` — number of rerank-pool candidates passed to the cross-encoder.

**Feature flag**: `RERANKER_ENABLED` in `config.py`, imported as a name in `wiki_store.py`. To disable at runtime: set `ws.RERANKER_ENABLED = False` via monkeypatch (see `test_reranker.py`) or edit config.py and restart.

**Diagnostics endpoint**: `GET /debug/retrieval?q=...&kb=enwiki` (read-only, no LLM call). Returns: query, terms (post-stopword), candidates list (article, chunk_index, chunk_id, fts5_score, reranker_score), chunk0_injected, threshold_passed, final_outcome (retrieved/unknown/fiction-guard). Not wired into chat UI.

**New tests** (`backend/test_reranker.py`, 4 tests):
1. Reranker reorders semantically — Paris capital chunk rises above generic France text for "What is the capital of France?"
2. Chunk-0 pin survives reranking — identity query "Who is Michael Jackson?" keeps michael-jackson:0 at position 0 even when the cross-encoder prefers michael-jackson:1.
3. RERANKER_ENABLED=False bypass — monkeypatching disables the pass; all debug candidates have reranker_score=None.
4. `/debug/retrieval` endpoint shape — verifies all required JSON keys are present.

## Test suites — must stay green
**119 pytest** (9 files: `test_fiction_meta` 19, `test_redirect_augment` 16, `test_fiction_guard` 14, `test_entity_boost` 4, `test_normalize_reply_tag` 28, `test_jokes` 6, `test_retrieval_regression` 27, `test_stt_vad_filter` 1, `test_reranker` 4) + **23 wiki smoke checks** in `scripts/wiki_smoke_test.sh` + **17 TTS smoke checks** in `scripts/tts_smoke_test.sh`. The wiki and TTS smoke scripts hit the live backend; run them with the backend up.

Note: smoke tests emit fiction-guard probes (e.g. "What is the capital of Atlantis?") into the uvicorn log — that's expected test traffic.

## Arcade track — IN PROGRESS, integration pending

Standalone sandbox at `/arcade` route. Not yet wired into the main SCRAP chat UI.

**Files:** `frontend/src/arcade/`
- `GameGrid.jsx` — NxM dot-matrix canvas component. Imperative rendering: parent calls `ref.setDots(flat Uint8Array)` each frame to avoid 60fps React re-renders. Dot states: `0=OFF`, `1=DIM`, `2=LIT`. Uses the same visual constants as the face matrix (DOT_COLOR, DOT_SIZE 22px, DOT_GAP 14px).
- `gameConsole.js` — factory + **game-console contract**. Every game must implement `{ meta, init(api), input(event), tick(dt), destroy() }`. `GameAPI`: `setDot(col, row, state)`, `clearGrid()`, `emit(name, data)`. Semantic events games must emit: `game_start`, `scrap_scored`, `player_scored`, `near_miss`, `scrap_won`, `scrap_lost`, `game_quit`. Fixed timestep: 60fps / ~16.67ms tick.
- `constants.js` — shared visual constants (`DOT_COLOR`, `DOT_SIZE`, `DOT_GAP`, `OP_OFF/DIM/LIT`, flat-buffer `OFF/DIM/LIT` state values).
- `ArcadeSandbox.jsx` / `ArcadeSandbox.css` — standalone `/arcade` route, wires console to GameGrid, handles keyboard + mouse_y + touch_y input.
- `games/pong.js` — **first game, implemented**. 24×14 grid, AI opponent (SCRAP), score pips, countdown, ball speed progression.

**Remaining:** 5 more games (Snake, Tetris, Breakout, Space Invaders, and one TBD). Each follows the game-console contract.

**Integration pending**: wire the arcade into the main SCRAP UI — probably via a trigger phrase or `/games` command in chat that swaps the face matrix panel for the GameGrid.

## Roadmap (priority order)

1. **Arcade integration** — wire arcade into main chat UI (trigger phrase or `/games` command), connect semantic game events (`scrap_scored`, `scrap_won`, etc.) to SCRAP's personality responses.
2. **Backlog**:
   - WW2 vocabulary gap — see diagnosis below. Fix path identified; not yet implemented.
   - Chunk-1 ranking: chunk-0 injection helps identity queries, but second-chunk answers (e.g. biographical details in the second paragraph) can still rank poorly — may need a soft positional prior.
   - PDF document mode: load a user-supplied PDF as a session-scoped knowledge base (in addition to or instead of the always-on wiki KBs).

## WW2 gap diagnosis (stretch, June 12)

Investigated via `/debug/retrieval` for "France leader WW2" and variants.

**Root cause: FTS5 vocabulary mismatch — "ww2" not in the enwiki index.**

Wikipedia uses "World War II" (spelled out), not "ww2". The FTS5 token "ww2" matches almost nothing in the 33M-chunk enwiki index. The top FTS5 hits for "france leader ww2" are completely irrelevant articles (e.g. "Atme", a Syrian village) that happen to co-occur the individual terms.

**Detailed trace** for "France leader WW2" (terms: ['france', 'leader', 'ww2']):
- 'ww2' → no redirect, no article with "ww2" in title → effectively a dead query term
- Remaining 2-term AND query ('france' AND 'leader') returns articles like "Liberation of France" chunk 12 (reranker=0.14), "Congress of Vienna" chunk 1 (reranker=0.07) — all scored low by the cross-encoder, none answers the question
- Final outcome: retrieved (3 chunks pass the filter) but LLM sees no useful context → returns "unknown"

**What works:**
- "de gaulle france WW2" → terms include 'de gaulle' → entity match → Charles de Gaulle article surfaces correctly
- "who was the leader of france during world war 2" → terms include 'world', 'war' → "France during World War II" article retrieved (reranker=0.998)
- "vichy france leader" → Vichy France article retrieved

**Fix path (not yet implemented):**
1. **Query expansion in `query_terms` or `fts_term_variants`**: map "ww2" / "wwii" → ["world war ii", "world war 2", "wwii"] OR add as synonym to fts_term_variants. This is the smallest targeted fix.
2. Alternatively, add era-specific synonym pairs to a lookup dict in `wiki_store.py` (e.g. `{"ww2": "world war", "wwii": "world war", "ww1": "world war"}`).
3. The "who was France's leader" ambiguity (De Gaulle = Free France; Pétain = Vichy) is a separate problem that would require the LLM to disambiguate from context — not a retrieval fix.

**Scope note:** "France's leader WW2" is the symptom; the root is that any abbreviation-vs-spelled-out mismatch will fail similarly (e.g. "USA president" vs "United States president" would have a similar gap if articles only used one form).

## Hard constraints
- The **fiction guard** must survive all retrieval changes: "Atlantis capital" must still return "unknown" for the fictional/DC-ambiguous case. The guard logic is in `main.py`; the 14 tests in `test_fiction_guard.py` are the regression suite.
- The exact **"unknown" string behavior** (KB mode returns a specific string, not a generic LLM reply) must be preserved.
- `article_meta` / `article_redirects` tables must remain the source of truth for entity resolution.
- All 119 pytest + 23 wiki smoke + 17 TTS smoke tests must stay green after any change.
- KB-mode replies must stay factual — no emotion tag, no joke injection.

## Misc environment notes (carried forward)
- Piper `--sentence-silence` must be a multiple of 0.1 at 22050 Hz (0.45 corrupts WAV alignment in piper 1.4.2 — documented in `config.py`).
- Kokoro model files: `backend/models/kokoro/{kokoro-v1.0.onnx, voices-v1.0.bin}`; voices registry `backend/tts_voices.py` (heart default, then bella/jessica/sky/nicole, Piper secondaries).
- `/tts` accepts `rate` 0.5–1.5; frontend slider default 0.95×.
