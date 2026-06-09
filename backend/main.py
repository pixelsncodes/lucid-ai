import ctypes
import site
import subprocess
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import requests

from config import (
    DEFAULT_NUM_CTX,
    DEFAULT_TEMPERATURE,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_ENDPOINT,
    OLLAMA_MODEL,
    STT_COMPUTE_TYPE,
    STT_DEVICE,
    STT_LANGUAGE,
    STT_MODEL,
    SYSTEM_PROMPT,
    TTS_MAX_TEXT_LENGTH,
    TTS_MODEL_PATH,
)

app = FastAPI(title="LUCID Backend")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, value):
        trimmed_content = value.strip()
        if not trimmed_content:
            raise ValueError("history content must not be empty")
        if len(trimmed_content) > 2000:
            raise ValueError("history content must be 2000 characters or fewer")
        return trimmed_content


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    model: Optional[str] = None
    temperature: float = Field(default=DEFAULT_TEMPERATURE, ge=0.0, le=2.0, allow_inf_nan=False)
    num_ctx: int = Field(default=DEFAULT_NUM_CTX, ge=512, le=32000)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value):
        trimmed_message = value.strip()
        if not trimmed_message:
            raise ValueError("message must not be empty")
        if len(trimmed_message) > 2000:
            raise ValueError("message must be 2000 characters or fewer")
        return trimmed_message

    @field_validator("history", mode="before")
    @classmethod
    def default_history(cls, value):
        return [] if value is None else value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value):
        if value is None:
            return value

        trimmed_model = value.strip()
        if not trimmed_model:
            raise ValueError("model must not be empty")
        return trimmed_model

    @field_validator("temperature", mode="before")
    @classmethod
    def default_temperature(cls, value):
        return DEFAULT_TEMPERATURE if value is None else value

    @field_validator("num_ctx", mode="before")
    @classmethod
    def default_num_ctx(cls, value):
        return DEFAULT_NUM_CTX if value is None else value


class TTSRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, value):
        trimmed_text = value.strip()
        if not trimmed_text:
            raise ValueError("text must not be empty")
        if len(trimmed_text) > TTS_MAX_TEXT_LENGTH:
            raise ValueError(f"text must be {TTS_MAX_TEXT_LENGTH} characters or fewer")
        return trimmed_text


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



def load_cuda_libraries():
    for base in site.getsitepackages():
        for lib_dir in (
            Path(base) / "nvidia" / "cublas" / "lib",
            Path(base) / "nvidia" / "cudnn" / "lib",
        ):
            if lib_dir.exists():
                for lib in sorted(lib_dir.glob("*.so*")):
                    try:
                        ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass

_stt_model = None


def get_stt_model():
    global _stt_model

    if _stt_model is None:
        load_cuda_libraries()

        from faster_whisper import WhisperModel

        _stt_model = WhisperModel(
            STT_MODEL,
            device=STT_DEVICE,
            compute_type=STT_COMPUTE_TYPE,
        )

    return _stt_model


@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an audio file.")

    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    audio_bytes = await audio.read()

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    with NamedTemporaryFile(delete=True, suffix=suffix) as temp_audio:
        temp_audio.write(audio_bytes)
        temp_audio.flush()

        model = get_stt_model()
        segments, _info = model.transcribe(
            temp_audio.name,
            language=STT_LANGUAGE,
            beam_size=5,
        )

        text = " ".join(segment.text.strip() for segment in segments).strip()

    return {"text": text}


@app.post("/tts")
def text_to_speech(request: TTSRequest):
    model_path = Path(TTS_MODEL_PATH)
    if not model_path.exists():
        raise HTTPException(status_code=500, detail=f"TTS model file is missing: {TTS_MODEL_PATH}")

    temp_wav_path = None
    try:
        with NamedTemporaryFile(delete=False, suffix=".wav") as temp_wav:
            temp_wav_path = Path(temp_wav.name)

        result = subprocess.run(
            [sys.executable, "-m", "piper", "-m", TTS_MODEL_PATH, "-f", str(temp_wav_path)],
            input=request.text,
            text=True,
            capture_output=True,
            check=False,
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Piper exited with a non-zero status."
            raise HTTPException(status_code=500, detail=f"TTS generation failed: {error}")

        wav_bytes = temp_wav_path.read_bytes()
        return Response(content=wav_bytes, media_type="audio/wav")
    finally:
        if temp_wav_path is not None:
            temp_wav_path.unlink(missing_ok=True)


@app.post("/chat")
def chat(request: ChatRequest):
    selected_model = request.model or OLLAMA_MODEL
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        *[
            {
                "role": history_message.role,
                "content": history_message.content,
            }
            for history_message in request.history
        ],
        {"role": "user", "content": request.message},
    ]

    try:
        response = requests.post(
            OLLAMA_CHAT_ENDPOINT,
            json={
                "model": selected_model,
                "stream": False,
                "options": {
                    "temperature": request.temperature,
                    "num_ctx": request.num_ctx,
                },
                "messages": messages,
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        return {"reply": data["message"]["content"]}
    except (requests.RequestException, KeyError, ValueError):
        return {"reply": "LUCID could not reach the local model."}
