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

## Test suites — must stay green
**~128 pytest** (8 files: `test_fiction_meta` 19, `test_redirect_augment` 16, `test_fiction_guard` 14, `test_entity_boost` 4, `test_normalize_reply_tag` 28, `test_jokes` 6, `test_retrieval_regression` 27, `test_stt_vad_filter` 1; parameterized expansion accounts for the balance) + **23 wiki smoke checks** in `scripts/wiki_smoke_test.sh` + **17 TTS smoke checks** in `scripts/tts_smoke_test.sh`. The wiki and TTS smoke scripts hit the live backend; run them with the backend up.

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

1. **Cross-encoder reranker + retrieval diagnostics table** — a lightweight cross-encoder pass over the top-N FTS5 hits before the confidence threshold check; add a debug/diagnostics table (query → terms → candidate scores → final result) to make future regressions easier to diagnose.
3. **Arcade integration** — wire arcade into main chat UI (trigger phrase or `/games` command), connect semantic game events (`scrap_scored`, `scrap_won`, etc.) to SCRAP's personality responses.
4. **Backlog**:
   - WW2 vocabulary gap: "France's leader WW2" and similar era-specific queries still miss due to sparse enwiki coverage on some WW2-era article titles — investigate chunk coverage vs. redirect tables.
   - Chunk-1 ranking: chunk-0 injection helps identity queries, but second-chunk answers (e.g. biographical details in the second paragraph) can still rank poorly — may need a soft positional prior.
   - PDF document mode: load a user-supplied PDF as a session-scoped knowledge base (in addition to or instead of the always-on wiki KBs).

## Hard constraints
- The **fiction guard** must survive all retrieval changes: "Atlantis capital" must still return "unknown" for the fictional/DC-ambiguous case. The guard logic is in `main.py`; the 14 tests in `test_fiction_guard.py` are the regression suite.
- The exact **"unknown" string behavior** (KB mode returns a specific string, not a generic LLM reply) must be preserved.
- `article_meta` / `article_redirects` tables must remain the source of truth for entity resolution.
- All ~127 pytest + 23 wiki smoke + 17 TTS smoke tests must stay green after any change.
- KB-mode replies must stay factual — no emotion tag, no joke injection.

## Misc environment notes (carried forward)
- Piper `--sentence-silence` must be a multiple of 0.1 at 22050 Hz (0.45 corrupts WAV alignment in piper 1.4.2 — documented in `config.py`).
- Kokoro model files: `backend/models/kokoro/{kokoro-v1.0.onnx, voices-v1.0.bin}`; voices registry `backend/tts_voices.py` (heart default, then bella/jessica/sky/nicole, Piper secondaries).
- `/tts` accepts `rate` 0.5–1.5; frontend slider default 0.95×.
