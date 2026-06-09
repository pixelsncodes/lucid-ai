# LUCID

**Local Unified Conversational Intelligence Desk**

LUCID is a local-first AI assistant project designed for:

- Offline LLM-powered conversation
- Voice chat using local speech-to-text and text-to-speech
- Local RAG over project folders, documents, and images
- Optional controlled internet search in future phases

## Project Structure

```text
lucid-ai/
  frontend/     React + Vite interface
  backend/      FastAPI backend
  rag/          Local retrieval and document processing
  docs/         Project notes and documentation
  models/       Local model notes and configs
  experiments/  Prototypes and tests

## Local Development

### Start the backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
