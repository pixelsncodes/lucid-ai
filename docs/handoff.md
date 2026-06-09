# LUCID Project Handoff

Project: LUCID, Local Unified Conversational Intelligence Desk

GitHub:
https://github.com/pixelsncodes/lucid-ai

Current setup:
- WSL Ubuntu project path: ~/lucid-ai
- Frontend: React + Vite in frontend/
- Backend: FastAPI in backend/
- Backend virtual environment: backend/.venv
- Local LLM runtime: Ollama
- Current model: llama3.2:3b
- Frontend connects to backend health endpoint.
- Frontend chat box sends messages to backend /chat.
- Backend /chat calls local Ollama at http://localhost:11434/api/chat.
- Backend model settings now live in backend/config.py.

Run backend:
cd ~/lucid-ai/backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000

Run frontend:
cd ~/lucid-ai/frontend
npm run dev

Current next task:
- Add model selection support.
- Later add local RAG, STT, TTS, and optional controlled web search.
