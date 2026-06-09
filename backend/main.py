from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

from config import OLLAMA_BASE_URL, OLLAMA_CHAT_ENDPOINT, OLLAMA_MODEL, SYSTEM_PROMPT

app = FastAPI(title="LUCID Backend")


class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = None


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {
        "name": "LUCID",
        "status": "backend running",
        "description": "Local Unified Conversational Intelligence Desk"
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/models")
def get_models():
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=10)
        response.raise_for_status()
        data = response.json()
        models = [model["name"] for model in data.get("models", []) if "name" in model]
        return {
            "default_model": OLLAMA_MODEL,
            "models": models,
        }
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return {
            "default_model": OLLAMA_MODEL,
            "models": [],
        }


@app.post("/chat")
def chat(request: ChatRequest):
    selected_model = request.model or OLLAMA_MODEL

    try:
        response = requests.post(
            OLLAMA_CHAT_ENDPOINT,
            json={
                "model": selected_model,
                "stream": False,
                "messages": [
                    {
                        "role": "system",
                        "content": SYSTEM_PROMPT,
                    },
                    {"role": "user", "content": request.message},
                ],
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return {"reply": data["message"]["content"]}
    except (requests.RequestException, KeyError, ValueError):
        return {"reply": "LUCID could not reach the local model."}
