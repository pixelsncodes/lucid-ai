import shutil
from pathlib import Path

from kokoro_tts import kokoro_available


TTS_DEFAULT_VOICE_ID = "heart"

ESPEAK_BINARY = "espeak-ng"
MBROLA_BINARY = "mbrola"
MBROLA_DATA_DIR = Path("/usr/share/mbrola")

# Engine support for "espeak" voices remains below; add entries here
# with engine="espeak" (+ optional mbrola_data) to re-enable them.
TTS_VOICES = [
    # ── Kokoro — small neural model, best prosody (primary) ──
    {
        "id": "heart",
        "name": "Heart (Kokoro)",
        "engine": "kokoro",
        "language": "en-US",
        "kokoro_voice": "af_heart",
        "description": "Kokoro's flagship voice. The default.",
    },
    {
        "id": "bella",
        "name": "Bella (Kokoro)",
        "engine": "kokoro",
        "language": "en-US",
        "kokoro_voice": "af_bella",
        "description": "Kokoro neural voice.",
    },
    {
        "id": "jessica",
        "name": "Jessica (Kokoro)",
        "engine": "kokoro",
        "language": "en-US",
        "kokoro_voice": "af_jessica",
        "description": "Kokoro neural voice.",
    },
    {
        "id": "sky",
        "name": "Sky (Kokoro)",
        "engine": "kokoro",
        "language": "en-US",
        "kokoro_voice": "af_sky",
        "description": "Kokoro neural voice.",
    },
    {
        "id": "nicole",
        "name": "Nicole (Kokoro)",
        "engine": "kokoro",
        "language": "en-US",
        "kokoro_voice": "af_nicole",
        "description": "Kokoro neural voice — soft, close-mic whisper style.",
    },
    # ── Piper — neural, human-sounding (secondary) ──
    {
        "id": "lessac-medium",
        "name": "Lessac Medium",
        "engine": "piper",
        "language": "en-US",
        "model_path": "models/piper/en_US-lessac-medium.onnx",
        "config_path": "models/piper/en_US-lessac-medium.onnx.json",
        "description": "US English Piper voice.",
    },
    {
        "id": "amy-medium",
        "name": "Amy Medium",
        "engine": "piper",
        "language": "en-US",
        "model_path": "models/piper/en_US-amy-medium.onnx",
        "config_path": "models/piper/en_US-amy-medium.onnx.json",
        "description": "US English Piper voice.",
    },
    {
        "id": "ryan-medium",
        "name": "Ryan Medium",
        "engine": "piper",
        "language": "en-US",
        "model_path": "models/piper/en_US-ryan-medium.onnx",
        "config_path": "models/piper/en_US-ryan-medium.onnx.json",
        "description": "Default US English Piper voice.",
    },
    {
        "id": "hfc_female-medium",
        "name": "HFC Female Medium",
        "engine": "piper",
        "language": "en-US",
        "model_path": "models/piper/en_US-hfc_female-medium.onnx",
        "config_path": "models/piper/en_US-hfc_female-medium.onnx.json",
        "description": "US English female Piper voice.",
    },
    {
        "id": "alba-medium",
        "name": "Alba Medium",
        "engine": "piper",
        "language": "en-GB",
        "model_path": "models/piper/en_GB-alba-medium.onnx",
        "config_path": "models/piper/en_GB-alba-medium.onnx.json",
        "description": "British English Piper voice.",
    },
]


def _voice_paths(voice: dict[str, str], base_dir: Path) -> dict[str, Path]:
    return {
        "model_path": base_dir / voice["model_path"],
        "config_path": base_dir / voice["config_path"],
    }


def espeak_available() -> bool:
    return shutil.which(ESPEAK_BINARY) is not None


def _mbrola_voice_available(data_name: str) -> bool:
    return (
        shutil.which(MBROLA_BINARY) is not None
        and (MBROLA_DATA_DIR / data_name / data_name).is_file()
    )


def is_voice_available(voice: dict, base_dir: Path) -> bool:
    if voice["engine"] == "kokoro":
        return kokoro_available(base_dir)
    if voice["engine"] == "espeak":
        if not espeak_available():
            return False
        mbrola_data = voice.get("mbrola_data")
        if mbrola_data:
            return _mbrola_voice_available(mbrola_data)
        return True
    paths = _voice_paths(voice, base_dir)
    return paths["model_path"].is_file() and paths["config_path"].is_file()


def get_available_voices(base_dir: Path) -> list[dict]:
    return [
        voice
        for voice in TTS_VOICES
        if is_voice_available(voice, base_dir)
    ]


def get_default_voice() -> dict | None:
    return next(
        (voice for voice in TTS_VOICES if voice["id"] == TTS_DEFAULT_VOICE_ID),
        None,
    )


def _materialize(voice: dict, base_dir: Path) -> dict:
    if voice["engine"] in ("espeak", "kokoro"):
        return dict(voice)
    return {**voice, **_voice_paths(voice, base_dir)}


def resolve_voice(voice_id: str | None, base_dir: Path) -> tuple[dict | None, bool]:
    requested_voice = next(
        (voice for voice in TTS_VOICES if voice["id"] == voice_id),
        None,
    )

    if requested_voice and is_voice_available(requested_voice, base_dir):
        return _materialize(requested_voice, base_dir), False

    default_voice = get_default_voice()
    if default_voice and is_voice_available(default_voice, base_dir):
        fallback_used = bool(voice_id and voice_id != default_voice["id"])
        return _materialize(default_voice, base_dir), fallback_used

    # last resort: any available voice, so TTS keeps working even
    # when the default engine is missing (e.g. espeak-ng not installed)
    for voice in TTS_VOICES:
        if is_voice_available(voice, base_dir):
            return _materialize(voice, base_dir), True

    return None, False


def public_voice_payload(base_dir: Path) -> dict:
    return {
        "default_voice_id": TTS_DEFAULT_VOICE_ID,
        "voices": [
            {
                "id": voice["id"],
                "name": voice["name"],
                "engine": voice["engine"],
                "language": voice["language"],
                "description": voice["description"],
                "available": is_voice_available(voice, base_dir),
            }
            for voice in TTS_VOICES
        ],
    }
