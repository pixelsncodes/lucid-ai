from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

app = FastAPI(title="LUCID Backend")


class ChatRequest(BaseModel):
    message: str

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


@app.post("/chat")
def chat(request: ChatRequest):
    try:
        response = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "llama3.2:3b",
                "stream": False,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are LUCID, a helpful local assistant.",
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
