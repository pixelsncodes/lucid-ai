# SCRAP — Personality Session Handoff (June 12, 2026)

## Project snapshot
- Project: **SCRAP** (formerly Lucid AI) — local/offline voice-first assistant.
- Repo: `pixelsncodes/lucid-ai` (public GitHub). User's working copy: `~/lucid-ai` on Ubuntu WSL (Windows PC).
- Backend: FastAPI + Ollama (`llama3.2:3b`), local STT (faster-whisper), TTS (see below), Wikipedia SQLite FTS5 knowledge bases (SimpleWiki + full enwiki, 33M chunks).
- Frontend: React/Vite, fully redesigned this week (voice-first, dot-matrix character UI). Dev server: `npm run dev` → localhost:5173.
- Backend Python env: **`~/lucid-ai/backend/.venv`** (hidden folder — use `.venv/bin/pip` / `.venv/bin/python`).
- User workflow: assistant produces git patches; user saves them into `~/lucid-ai` and runs `git apply <file>.patch`. **As of this handoff the user was asked to commit all applied work** (`git add -A && git commit`) so the next session starts from a clean committed baseline. Verify with `git status` before generating patches.

## Identity
- Name: **SCRAP — Salvaged Conversational Retro-Apocalyptic Processor**. Tagline: "rebuilt · offline · unimpressed".
- Lore: a sarcastic machine rebuilt from salvage after the collapse — explains the dot-matrix face, offline-only design, dry humor, dad jokes.
- Frontend identity constants: `frontend/src/identity.js` (one-line rename).
- **The backend system prompt still says LUCID** — updating it to SCRAP is part of the personality task.

## THE TASK: personality
User wants SCRAP to be witty, sarcastic, dry-humored, and to tell random dad jokes sometimes. Components:

1. **System prompt rewrite** (`backend/config.py` → `SYSTEM_PROMPT`, currently "You are LUCID, the Local Unified Conversational Intelligence Desk…"). New personality: dry wit, deadpan sarcasm, post-apocalyptic salvage-bot flavor, helpful underneath. NOTE: KB-mode chat may build its own prompt in `main.py` — inspect how `SYSTEM_PROMPT` vs KB retrieval prompts interact before editing; personality must not degrade retrieval answers or fiction-guard behavior.
2. **Emotion tag contract (frontend already built and tested — backend must comply):**
   - A reply may END with exactly one emoticon from this set:
     `:)  :(  ;)  :'(  :D  :P  :/  :|  ^-^  >:(  :O  :3  8)  -_-  O_O  T_T  :*  <3`
   - Frontend (`frontend/src/components/matrix/engine.js → extractReplyFace`) strips it from displayed text and TTS, and shows that face on the dot matrix (lingers ~6s after speech).
   - **`:D` means "I told a joke"**: frontend then pauses ~0.4s, plays a TTS "Ha ha!" clip, and runs the two-frame laughing animation. Already wired in `App.jsx` (`playLaughClip`) + `MatrixStage.jsx` (`LAUGH_FRAMES`).
   - llama3.2:3b is small — tag compliance may be inconsistent. Consider a backend fallback (e.g., light post-processing to append/normalize a tag, or few-shot examples in the prompt). Design decision for the session.
3. **Dad-joke corpus (~10k jokes)**: source a clean dataset, store offline (SQLite or JSON in `backend/data/`), and decide the injection strategy — e.g., backend occasionally instructs the model to work a joke in, or a random-joke behavior when the user is idle/asks. Jokes delivered as replies should end with `:D` to trigger the laugh.

## Hard constraints (from prior backend handoff — must stay intact)
- Fiction guard, ranking, `article_meta` / `article_redirects` tables, the exact "unknown" string behavior.
- Test suites must stay green: **53 pytest + 23 smoke tests** (`backend/test_*.py` + scripts).
- Known recall regressions ("France's leader WW2", "DC Comics Atlantis capital") are a SEPARATE task — do not touch retrieval this session.

## Current TTS state (done this week — don't redo)
- **Kokoro (kokoro-onnx 0.5.0) is the primary engine**, in-process lazy singleton (`backend/kokoro_tts.py`), model files at `backend/models/kokoro/{kokoro-v1.0.onnx, voices-v1.0.bin}`.
- Voices (registry `backend/tts_voices.py`): **heart (default)**, bella, jessica, sky, nicole → then Piper secondaries (ryan etc.). Engine plumbing for espeak/MBROLA retained but no entries registered.
- `/tts` accepts optional `rate` (0.5–1.5, clamped); frontend has a speech-rate slider (default 0.95×). Kokoro maps rate→speed natively.
- Piper path uses `--sentence-silence 0.4` — **must yield whole samples at 22050 Hz (multiples of 0.1); 0.45 corrupts the WAV byte alignment in piper 1.4.2** (documented in `config.py`).
- Laugh clip "Ha ha!" is TTS-generated and cached per (voice, rate) in the frontend.

## Frontend state (done — context only)
- Voice-first UI: click matrix = hands-free conversation loop (listen → think → speak → listen; Esc or "end conversation" stops). Click chat input = chat mode; click blank space collapses back to voice.
- Dot-matrix character: boot ticker H→I, idle `:)` with random blinks, audio-reactive EQ with peak-hold while listening, diamond ripple thinking, EQ-mouth speaking, breathing `Z` sleep after 45s, startled `O_O` wake, `:/ ` on errors, laugh cycle on `:D`.
- Settings drawer (gear, top-left): model, voice, KB, temperature, context, speech rate, voice-mode toggles.
- Design tokens from the user's dot-matrix-builder.html (bg `#0c0c0f`, warm text `#e4e2da`, Inter + Fira Code via fontsource).

## Suggested session plan
1. Read `backend/config.py` SYSTEM_PROMPT + how `main.py` builds messages in both `knowledge_base == "none"` and KB modes.
2. Draft the SCRAP personality prompt with the emotion-tag instruction and few-shot examples; keep KB answers factual (personality light when citing sources).
3. Add dad-joke corpus + delivery mechanism.
4. Test against llama3.2:3b via Ollama (user runs locally; provide test prompts), verify tags parse with `extractReplyFace`, run pytest.
5. Ship as a single git patch against the committed baseline.
