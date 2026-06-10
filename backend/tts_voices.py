from pathlib import Path


TTS_DEFAULT_VOICE_ID = "lessac-medium"

TTS_VOICES = [
    {
        "id": "lessac-medium",
        "name": "Lessac Medium",
        "engine": "piper",
        "language": "en-US",
        "model_path": "models/piper/en_US-lessac-medium.onnx",
        "config_path": "models/piper/en_US-lessac-medium.onnx.json",
        "description": "Default US English Piper voice.",
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
        "description": "US English Piper voice.",
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


def is_voice_available(voice: dict[str, str], base_dir: Path) -> bool:
    paths = _voice_paths(voice, base_dir)
    return paths["model_path"].is_file() and paths["config_path"].is_file()


def get_available_voices(base_dir: Path) -> list[dict[str, str]]:
    return [
        voice
        for voice in TTS_VOICES
        if is_voice_available(voice, base_dir)
    ]


def get_default_voice() -> dict[str, str] | None:
    return next(
        (voice for voice in TTS_VOICES if voice["id"] == TTS_DEFAULT_VOICE_ID),
        None,
    )


def resolve_voice(voice_id: str | None, base_dir: Path) -> tuple[dict[str, str] | None, bool]:
    requested_voice = next(
        (voice for voice in TTS_VOICES if voice["id"] == voice_id),
        None,
    )
    default_voice = get_default_voice()

    if requested_voice and is_voice_available(requested_voice, base_dir):
        return {
            **requested_voice,
            **_voice_paths(requested_voice, base_dir),
        }, False

    if default_voice and is_voice_available(default_voice, base_dir):
        fallback_used = bool(voice_id and voice_id != default_voice["id"])
        return {
            **default_voice,
            **_voice_paths(default_voice, base_dir),
        }, fallback_used

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
