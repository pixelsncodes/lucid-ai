from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
    return {"reply": f"LUCID received: {request.message}"}
