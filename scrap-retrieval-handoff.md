# SCRAP — Retrieval Session Handoff (June 12, 2026)

## Project snapshot
- Project: **SCRAP** (formerly Lucid AI) — local/offline voice-first assistant.
- Repo: `pixelsncodes/lucid-ai` (public GitHub). Working copy: `~/lucid-ai` on Ubuntu WSL (Windows PC).
- Backend: FastAPI + Ollama (`llama3.2:3b`), local STT (faster-whisper), Kokoro TTS (primary) + Piper (secondary), Wikipedia SQLite FTS5 knowledge bases (SimpleWiki + full enwiki, 33M chunks).
- Frontend: React/Vite, voice-first dot-matrix character UI. Dev server: `npm run dev` → localhost:5173.
- Backend Python env: **`~/lucid-ai/backend/.venv`** (hidden folder — use `.venv/bin/pip` / `.venv/bin/python`).
- Workflow: this project is now worked on directly with **Claude Code** in `~/lucid-ai` (no more patch files). Verify `git status` is clean before starting — the personality session was committed as the baseline.

## Completed last session (personality) — DO NOT REDO
1. **Identity**: SYSTEM_PROMPT in `backend/config.py` rewritten for SCRAP (dry wit, deadpan, salvage-bot, helpful underneath). **Root cause of the lingering "LUCID" intro**: the KB-mode branch of `/chat` in `backend/main.py` (~line 1830) built its own inline `rag_system_prompt` saying "You are LUCID" — fixed. User-facing LUCID strings updated in README, docs, `scripts/dev_status.sh`. Deliberately left: `X-LUCID-TTS-*` HTTP headers (smoke tests grep exact names; not user-visible), repo/folder name, temp file paths, archived handoff docs.
2. **Emotion tag contract** (frontend parser: `frontend/src/components/matrix/engine.js → extractReplyFace`):
   - Valid set: `:)  :(  ;)  :'(  :D  :P  :/  :|  ^-^  >:(  :O  :3  8)  -_-  O_O  T_T  :*  <3`
   - Backend `normalize_reply_tag()` in `main.py` is **the law** (the prompt is advisory with a 3B model): strips invalid trailing emoticon-like tokens (e.g. `:S`), maps near-misses to valid tags (ambiguous/laughing variants like `xD` map to neutral tags, **never `:D`**), appends `:)` as last resort. Applied **only** to `knowledge_base == "none"` replies — KB replies stay factual, no tag.
   - `:D` is reserved: it means "a joke was told" and triggers the frontend laugh sequence.
3. **Dad-joke corpus**: `backend/data/dad_jokes.json` (flat `{"setup", "punchline"}` array; sourced from itsjonq/dad-jokes + rjzaworski/dad-jokes + filtered taivop/joke-dataset; NSFW filtered, deduped). Fully offline at runtime — the download was a one-time build step.
   - **Path 1 (direct serve)**: explicit triggers ("joke", "make me laugh", follow-ups like "another one") and idle → random corpus joke returned verbatim, no LLM call, intro from `JOKE_INTROS` rotation in `config.py` (includes `""` cold delivery), ` :D` appended. Logic in `backend/jokes.py` (`format_explicit_joke()`).
   - **Path 2 (seeded injection)**: `JOKE_RANDOM_PROBABILITY` (8%) per no-KB turn with a cooldown (≥3 turns), both config constants. Backend injects the corpus joke text into the prompt; `normalize_reply_tag(joke_mode=True)` forces the `:D` if the model drops it. Disabled in KB mode.
   - Recently-served joke IDs tracked (in-memory deque) to avoid repeats within a session.
4. **Laugh audio removed**: Kokoro mispronounced "Ha ha!"/"Ha. Ha.". Now: 200ms silent beat → 1400ms two-frame laugh animation → settle; voice mode reopens mic after `RESUME_LISTEN_DELAY_MS` (420ms). Re-enable later via `LAUGH_AUDIO_ENABLED` in `frontend/src/identity.js` (clip fetch/cache/`run.audio` path intact). `LAUGH_TEXT` constant also lives there; laugh-clip cache key includes the text. If audio is ever revisited, prefer a pre-recorded sound effect asset over TTS.
5. **Audio/animation sync fix**: matrix speaking state now driven by the audio element's `'playing'` event (thinking ripple holds through synthesis latency), ends on `'ended'`/`'error'`/`'pause'`, with a safety timeout to idle/`:/` if TTS never starts. Voice-mode listen handoff keyed on audio `'ended'`.

## Test suites — must stay green
**81 total**: 53 original pytest + 23 smoke + 5 `normalize_reply_tag` unit tests (`backend/test_*.py` + scripts). Run them after any change. Note: smoke tests hit the live backend and emit fiction-guard probes (e.g. "What is the capital of Atlantis?") into the uvicorn log — that's expected test traffic.

## THE TASK: retrieval recall regressions (explicitly deferred until now)
Three known repro cases against the full enwiki KB:
1. **"France's leader WW2"** — recall regression (from prior backend session).
2. **"DC Comics Atlantis capital"** — recall regression (from prior backend session).
3. **NEW — phrasing sensitivity**: "What do you know about Christopher Nolan?" → exact "unknown" string, but "What can you tell me about Christopher Nolan?" → correct answer. Same entity, identical search-relevant terms, different conversational framing → strongly suggests raw-sentence-to-FTS5 query construction is phrasing-sensitive (filler words like "do/know/tell" affecting matching/ranking, pushing the confidence score across the "unknown" threshold). Likely shared root cause with #1–2 in query term extraction / stopword handling / ranking threshold.

### Suggested session plan
1. Trace the full query path in `main.py`: user message → FTS5 query string → ranking → confidence threshold → "unknown" decision. Log intermediate scores for the three repro cases (both Nolan phrasings side by side).
2. Form a hypothesis: query construction (term extraction/stopwords) vs. ranking vs. threshold. Fix the class, not the instances.
3. **Hard constraints**: the fiction guard, the exact "unknown" string behavior, `article_meta` / `article_redirects` tables, and all 81 tests must survive. "Atlantis capital" must STILL return "unknown" for the fictional/DC-ambiguous case per fiction-guard rules — improving recall must not break the guard. Add regression tests for the three cases once fixed.
4. Re-run full suites + manual KB-mode spot checks (and confirm personality stays out of KB answers).

## Tuning knobs (after living with the personality for a few days — not this session unless asked)
- `JOKE_RANDOM_PROBABILITY` (currently 8%) and the joke cooldown (`backend/config.py`).
- `JOKE_INTROS` list wording.
- Possible follow-up: tighten the explicit-joke trigger if phrases like "another one" ever over-trigger in non-joke contexts (watch for it in normal use).

## Misc environment notes (carried forward)
- Piper `--sentence-silence` must be a multiple of 0.1 at 22050 Hz (0.45 corrupts WAV alignment in piper 1.4.2 — documented in `config.py`).
- Kokoro model files: `backend/models/kokoro/{kokoro-v1.0.onnx, voices-v1.0.bin}`; voices registry `backend/tts_voices.py` (heart default, then bella/jessica/sky/nicole, Piper secondaries).
- `/tts` accepts `rate` 0.5–1.5; frontend slider default 0.95×.
