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

### WW2 vocabulary gap — synonym expansion (June 12)

**Root cause fixed**: FTS5 dead-term "ww2" / "wwii" — Wikipedia uses "World War II". Added `QUERY_SYNONYMS` dict in `backend/wiki_store.py` (just above `FTS_STOP_WORDS`).

**How it works** (`query_terms()` in `wiki_store.py`): when an abbreviation from `QUERY_SYNONYMS` is encountered, its expanded tokens are inserted *before* the abbreviation in the terms list. The AND ladder then drops the unrecognised abbreviation last and falls through to the spelled-out tokens (e.g. "France leader WW2" → terms `['france', 'leader', 'world', 'war', 'ii', 'ww2']`; ladder level 2 drops `ww2` and queries `france AND leader AND world AND war AND ii` → "France during World War II" article retrieved).

**Expansion is additive, never replacing**: the original abbreviation stays in the list so it matches any source that does use the abbreviated form.

**Table** (`QUERY_SYNONYMS`):
- `ww2` / `wwii` → `["world", "war", "ii"]`
- `ww1` / `wwi` → `["world", "war"]`

**New tests** (`backend/test_retrieval_regression.py`, +8 → now 35 total):
1. `test_query_synonyms_table_exists` — core keys and expected tokens present in `QUERY_SYNONYMS`
2. `test_query_terms_ww2_expands_and_keeps_abbreviation` — "ww2" in output AND world/war/ii also added
3. `test_query_terms_wwii_expands_and_keeps_abbreviation` — same for "wwii"
4. `test_query_terms_ww1_expands_and_keeps_abbreviation` — "ww1" keeps original, adds world/war
5. `test_query_terms_expansion_order_abbreviation_last` — expanded tokens appear before abbreviation
6. `test_query_terms_no_expansion_for_spelled_out_query` — non-abbreviated queries unchanged
7. `test_ww2_abbreviation_finds_world_war_ii_article` — integration: "France leader WW2" surfaces WW2 France article
8. `test_spelled_out_ww2_query_finds_same_article` — control: "France leader world war ii" still works

## Test suites — must stay green
**127 pytest** (9 files: `test_fiction_meta` 19, `test_redirect_augment` 16, `test_fiction_guard` 14, `test_entity_boost` 4, `test_normalize_reply_tag` 28, `test_jokes` 6, `test_retrieval_regression` 35, `test_stt_vad_filter` 1, `test_reranker` 4) + **23 wiki smoke checks** in `scripts/wiki_smoke_test.sh` + **17 TTS smoke checks** in `scripts/tts_smoke_test.sh`. The wiki and TTS smoke scripts hit the live backend; run them with the backend up.

**80 vitest** (6 test files: pong 19, snake 12, breakout 13, invaders 12, tetris 12, frogger 12) run headless with `npm test` from `frontend/`. All test file names end in `.test.js`. Mock API is canvas-only (`emit` only; no setDot/clearGrid).

Note: smoke tests emit fiction-guard probes (e.g. "What is the capital of Atlantis?") into the uvicorn log — that's expected test traffic.

## Arcade track — canvas renderer COMPLETE (Sessions 1+2, June 2026)

Standalone sandbox at `/arcade` route. Not yet wired into the main SCRAP chat UI.

### Renderer system

All six games use `meta.renderer = 'canvas'`. The dot/matrix path has been fully retired.

**Canvas contract:**
```
meta: {
  renderer:      'canvas'
  logicalWidth:  number    // e.g. 640
  logicalHeight: number    // e.g. 384
}

render(ctx, { w, h }): void
  // Draw in logical coordinates (0..w, 0..h). ctx pre-scaled by dpr.
  // Called once per frame after tick(). tick() is pure logic — no drawing.
```

`mouse_y` / `touch_y` events deliver a logical Y coordinate (0..logicalHeight).
Breakout's mouse input re-maps vertical mouse position to horizontal paddle column (deviation from Pong's vertical paddle use — intentional).

### Files: `frontend/src/arcade/`

- `GameCanvas.jsx` — DPI-aware `<canvas>`. `ref.getCtx()` returns `{ ctx, w, h }` with pre-applied logical-to-physical transform.
- `gameConsole.js` — factory + game-console contract. Fixed 60fps timestep; calls `game.render(ctx, {w, h})` after each tick batch. Removed: setDot, clearGrid, onDraw, dots buffer.
- `constants.js` — board cell states only: `OFF=0`, `DIM=1`, `LIT=2` (used by tetris.js for board tracking and tetris.test.js assertions).
- `ArcadeSandbox.jsx` / `ArcadeSandbox.css` — standalone `/arcade` route. All 6 games wired in. Tab cycles forward, Shift+Tab cycles back, keys 1–6 jump directly. Always renders `<GameCanvas>`.
- **Removed:** `GameGrid.jsx`, `GameGrid.css` (dot-matrix renderer, retired).

### Games — all on canvas renderer

| Game | Logical canvas | Grid | Cell | Notes |
|------|---------------|------|------|-------|
| `pong.js`     | 640×384  | —      | —    | Continuous physics. Dashed net, monospace score. AI capped 3.7px/frame. |
| `snake.js`    | 480×280  | 24×14  | 20px | Grid-logical stepping. Pip score strip row 0. Blinking food. |
| `breakout.js` | 480×320  | 24×16  | 20px | Continuous ball/paddle. Physics in grid coords, scaled in render. |
| `invaders.js` | 480×320  | 24×16  | 20px | Continuous bullets/bombs. Blocky invader glyphs. |
| `tetris.js`   | 240×480  | 10×20  | 24px | Portrait. Board uses OFF/DIM. Score/level HUD overlay at bottom. |
| `frogger.js`  | 320×260  | 16×13  | 20px | Hybrid: discrete row hops, continuous lane traffic. |

**Events unchanged** from original matrix implementations. `near_miss` in single-player games = "life lost but not last".

### Test counts (frontend vitest)

**80 tests across 6 test files** (19 pong, 12 snake, 13 breakout, 12 invaders, 12 tetris, 12 frogger). All pass headless (`environment: 'node'`). Canvas render path not pixel-tested — tests cover logic and emitted events only.

**Integration pending**: wire the arcade into the main SCRAP UI — probably via a trigger phrase or `/games` command in chat that swaps the face matrix panel for the GameCanvas.

## Roadmap (priority order)

1. **Arcade integration** — wire arcade into main chat UI (trigger phrase or `/games` command), connect semantic game events (`scrap_scored`, `scrap_won`, etc.) to SCRAP's personality responses. All 6 games on canvas renderer, sandbox cycling works, dot renderer retired.
2. **Backlog**:
   - Chunk-1 ranking: chunk-0 injection helps identity queries, but second-chunk answers (e.g. biographical details in the second paragraph) can still rank poorly — may need a soft positional prior.
   - PDF document mode: load a user-supplied PDF as a session-scoped knowledge base (in addition to or instead of the always-on wiki KBs).
   - Abbreviation coverage: `QUERY_SYNONYMS` in `wiki_store.py` is seeded with ww1/ww2/wwi/wwii — extend conservatively as new dead-term gaps are diagnosed.

## Hard constraints
- The **fiction guard** must survive all retrieval changes: "Atlantis capital" must still return "unknown" for the fictional/DC-ambiguous case. The guard logic is in `main.py`; the 14 tests in `test_fiction_guard.py` are the regression suite.
- The exact **"unknown" string behavior** (KB mode returns a specific string, not a generic LLM reply) must be preserved.
- `article_meta` / `article_redirects` tables must remain the source of truth for entity resolution.
- All 127 pytest + 23 wiki smoke + 17 TTS smoke tests must stay green after any change.
- KB-mode replies must stay factual — no emotion tag, no joke injection.

## Misc environment notes (carried forward)
- Piper `--sentence-silence` must be a multiple of 0.1 at 22050 Hz (0.45 corrupts WAV alignment in piper 1.4.2 — documented in `config.py`).
- Kokoro model files: `backend/models/kokoro/{kokoro-v1.0.onnx, voices-v1.0.bin}`; voices registry `backend/tts_voices.py` (heart default, then bella/jessica/sky/nicole, Piper secondaries).
- `/tts` accepts `rate` 0.5–1.5; frontend slider default 0.95×.
