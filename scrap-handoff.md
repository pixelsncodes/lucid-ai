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

**46 vitest** (5 test files: snake 9, breakout 10, invaders 9, tetris 8, frogger 9, pong 1) run headless with `npm test` from `frontend/`. Added in this session.

Note: smoke tests emit fiction-guard probes (e.g. "What is the capital of Atlantis?") into the uvicorn log — that's expected test traffic.

## Arcade track — renderer migration IN PROGRESS

Standalone sandbox at `/arcade` route. Not yet wired into the main SCRAP chat UI.

### Renderer system (Session 1, June 2026)

The contract now supports two rendering paths via `meta.renderer`:

- **`'matrix'` (default)** — existing dot-grid renderer. Game draws via `api.setDot()` / `api.clearGrid()` inside `tick()`. Unchanged; all five matrix games stay on this path.
- **`'canvas'`** — new Canvas 2D path. Game implements an optional `render(ctx, { w, h })` called by the console each frame after `tick()`. `ctx` is pre-scaled to logical coordinates via `setTransform`. `tick()` is pure game logic — no drawing.

**New files:**
- `GameCanvas.jsx` — `forwardRef` canvas component. DevicePixelRatio-aware: `ResizeObserver` keeps the backing store in sync with `displaySize × dpr`. `ref.getCtx()` returns `{ ctx, w, h }` with the logical-to-physical transform already applied.
- `games/pong.test.js` — 19 tests for canvas pong (logic + events, no canvas ctx needed).

**Contract additions (additive — matrix games unaffected):**

```
meta: {
  renderer?:      'matrix' | 'canvas'   // default 'matrix'
  logicalWidth?:  number                // canvas games only (e.g. 640)
  logicalHeight?: number                // canvas games only (e.g. 384)
}

render?(ctx, { w, h }): void
  // Canvas games only. Draw in logical coordinates (0..w, 0..h).
  // Called by the console each frame after tick(). Do not call setDot.
```

For canvas games, `mouse_y` / `touch_y` events deliver a logical Y coordinate (0..logicalHeight) instead of a grid row. `ArcadeSandbox.toRow()` branches on `meta.renderer` to compute the right value.

### Files: `frontend/src/arcade/`

- `GameGrid.jsx` — NxM dot-matrix canvas component. Imperative rendering: parent calls `ref.setDots(flat Uint8Array)` each frame to avoid 60fps React re-renders. Dot states: `0=OFF`, `1=DIM`, `2=LIT`. Uses the same visual constants as the face matrix (DOT_COLOR, DOT_SIZE 22px, DOT_GAP 14px).
- `GameCanvas.jsx` — **NEW**. DPI-aware `<canvas>` for canvas-renderer games. `ref.getCtx()` returns `{ ctx, w, h }` with pre-applied logical-to-physical transform.
- `gameConsole.js` — factory + **game-console contract**. Extended: accepts `getCanvasCtx` option; after each tick batch, if `game.render` and `getCanvasCtx` both exist, calls `game.render(ctx, {w, h})` instead of `onDraw(dots)`. Matrix path unchanged. Fixed timestep: 60fps / ~16.67ms tick.
- `constants.js` — shared visual constants for matrix games (`DOT_COLOR`, `DOT_SIZE`, `DOT_GAP`, `OP_OFF/DIM/LIT`, flat-buffer `OFF/DIM/LIT`).
- `ArcadeSandbox.jsx` / `ArcadeSandbox.css` — standalone `/arcade` route. All 6 games wired in. Tab cycles forward, Shift+Tab cycles back, keys 1–6 jump directly. Renderer-conditional: renders `<GameCanvas>` for `renderer='canvas'` games, `<GameGrid>` for matrix games. `getCanvasCtx` / `onDraw` callbacks wired accordingly.

### Games

- **`games/pong.js` — Game 1. CANVAS VERSION (session 1).** 640×384 logical, white-on-black. Square ball (10px), paddles (10×64, 18px from walls). Dashed center net. Monospace score top-center. Mouse Y / arrow keys move player; AI right side capped at **3.7 px/frame** so it's beatable at high rally speeds. Ball speeds up 1.035× per hit. First to 7. Esc quits (`game_quit`), Space/Enter restarts. `near_miss` fires when the ball exits past a paddle edge within 10px.
- `games/snake.js` — Game 2. 24×14 grid, wall/self-collision = `scrap_won`, food = `player_scored`, 180° reversal blocked.
- `games/breakout.js` — Game 3. 24×16 grid, 3 lives, 5 brick rows. Ball speed bumps on each brick. `near_miss` on paddle-edge hits, `scrap_won` on last life, `scrap_lost` on all bricks cleared. Mouse↕ remapped to horizontal paddle position.
- `games/invaders.js` — Game 4. 24×16 grid, 5×3 army. Invasion check fires on every army step (not only on edge drops). `near_miss` on each non-final life lost, `scrap_won` on invasion or last life, `scrap_lost` on all kills.
- `games/tetris.js` — Game 5. 10×20 grid. 7 tetrominoes, 4-rotation wall-kick, hard drop, soft drop, line scoring (classic Tetris scale × level). `player_scored` per line clear, `scrap_won` on board full.
- `games/frogger.js` — Game 6. 16×13 grid. Frogger suits the coarse dot-matrix well because its core elements (frog, logs, cars) each occupy 1–2 dots and the traffic/river pattern reads clearly even at low resolution. Logs drift continuously (frog rides them as a float offset), cars are integer-collision. 5 lily-pad goal strip. `player_scored` per pad, `scrap_lost` when all 5 filled, `scrap_won` on last life, `near_miss` on non-final life loss.

### Test counts (frontend vitest)

**65 tests across 6 test files** (19 pong canvas, 9 snake, 10 breakout, 9 invaders, 8 tetris, 9 frogger). All pass headless with mock GameAPI (`environment: 'node'`). Canvas render path is not tested (not pixel-testable) — tests cover game state transitions and emitted events only.

### Session 2 scope (pending human review)

Port the remaining five matrix games (snake, breakout, invaders, tetris, frogger) to the canvas renderer. Pattern is established by pong: keep game logic in `tick()`, move all drawing to `render(ctx, {w,h})`, update `meta.renderer = 'canvas'`.

**Contract extensions from implementation:**
- `_setSnake/setBall/setBullet/setFrog` pattern: test helpers mutate internal state directly (not via copies) so that physics checks in the same tick see the updated state. This is the established pattern for all subsequent games.
- Mouse_y remapped to horizontal axis in Breakout (row fraction → paddle column) — deviation from pong's vertical use. Noted in per-game help text.
- `near_miss` in single-player games = "life lost but not last" (not a near-miss on a paddle). Consistent across Breakout, Invaders, Frogger.

**Integration pending**: wire the arcade into the main SCRAP UI — probably via a trigger phrase or `/games` command in chat that swaps the face matrix panel for the GameGrid/GameCanvas.

## Roadmap (priority order)

1. **Arcade integration** — wire arcade into main chat UI (trigger phrase or `/games` command), connect semantic game events (`scrap_scored`, `scrap_won`, etc.) to SCRAP's personality responses. All 6 games complete and tested; sandbox cycling works.
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
