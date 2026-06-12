import io
import wave
from pathlib import Path
from threading import Lock

import numpy as np

KOKORO_MODEL_RELATIVE_PATH = "models/kokoro/kokoro-v1.0.onnx"
KOKORO_VOICES_RELATIVE_PATH = "models/kokoro/voices-v1.0.bin"

_kokoro_instance = None
_kokoro_lock = Lock()


def kokoro_model_paths(base_dir: Path) -> tuple[Path, Path]:
    return (
        base_dir / KOKORO_MODEL_RELATIVE_PATH,
        base_dir / KOKORO_VOICES_RELATIVE_PATH,
    )


def kokoro_importable() -> bool:
    try:
        import kokoro_onnx  # noqa: F401
    except Exception:
        return False
    return True


def kokoro_available(base_dir: Path) -> bool:
    model_path, voices_path = kokoro_model_paths(base_dir)
    return kokoro_importable() and model_path.is_file() and voices_path.is_file()


def _get_kokoro(base_dir: Path):
    """Lazy-loaded singleton — the model stays warm between requests."""
    global _kokoro_instance
    if _kokoro_instance is None:
        with _kokoro_lock:
            if _kokoro_instance is None:
                from kokoro_onnx import Kokoro

                model_path, voices_path = kokoro_model_paths(base_dir)
                _kokoro_instance = Kokoro(str(model_path), str(voices_path))
    return _kokoro_instance


def synthesize_wav_bytes(
    base_dir: Path,
    text: str,
    voice: str,
    speed: float = 1.0,
) -> bytes:
    kokoro = _get_kokoro(base_dir)
    samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    samples = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    pcm = (samples * 32767.0).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return buffer.getvalue()
