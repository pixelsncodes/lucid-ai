# SCRAP

**Salvaged Conversational Retro-Apocalyptic Processor**

SCRAP is a local-first AI assistant project designed for:

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
```

## Local Development

### Start the backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### Workflow checks

```bash
scripts/dev_status.sh
scripts/verify_backend.sh
scripts/wiki_smoke_test.sh
```

## Offline Wikipedia ingestion

SCRAP can use a local SQLite FTS5 Wikipedia index for Wikipedia knowledgebase mode.

Seed corpus:
- backend/data/wikipedia/articles.json

Generated local index, not committed:
- backend/data/wikipedia/wikipedia.sqlite3

Import a MediaWiki XML export or .xml.bz2 dump:

    PYTHONPATH=backend python3 backend/scripts/import_wikipedia_xml.py backend/data/wikipedia/example.xml.bz2 --output backend/data/wikipedia/imported-articles.json --limit 1000

Build the SQLite index from an imported corpus:

    PYTHONPATH=backend python3 backend/scripts/build_wikipedia_index.py --articles backend/data/wikipedia/imported-articles.json --index backend/data/wikipedia/wikipedia.sqlite3

Build the default seed corpus index:

    PYTHONPATH=backend python3 backend/scripts/build_wikipedia_index.py

Large downloaded dumps, imported corpora, and generated indexes should stay local and should not be committed.
