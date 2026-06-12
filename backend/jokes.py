import json
import random
from collections import deque
from pathlib import Path

from config import JOKE_INTROS

_JOKES_PATH = Path(__file__).parent / "data" / "dad_jokes.json"

_jokes: list[dict] = []
_recent_ids: deque[int] = deque(maxlen=50)


def _load():
    global _jokes
    if not _JOKES_PATH.exists():
        return
    try:
        data = json.loads(_JOKES_PATH.read_text(encoding="utf-8"))
        _jokes = [
            j for j in data
            if isinstance(j, dict)
            and isinstance(j.get("setup"), str) and j["setup"].strip()
            and isinstance(j.get("punchline"), str) and j["punchline"].strip()
        ]
    except Exception:
        _jokes = []


_load()


def corpus_size() -> int:
    return len(_jokes)


def get_random_joke() -> dict | None:
    if not _jokes:
        return None
    recent = set(_recent_ids)
    available = [j for j in _jokes if j.get("id") not in recent]
    if not available:
        available = _jokes
    joke = random.choice(available)
    _recent_ids.append(joke.get("id", -1))
    return joke


def format_explicit_joke(joke: dict) -> str:
    """Return a pre-formatted SCRAP-voice reply; no LLM needed."""
    intro = random.choice(JOKE_INTROS)
    body = f"{joke['setup']} {joke['punchline']}"
    return f"{intro} {body} :D" if intro else f"{body} :D"


def build_explicit_joke_response(joke: dict) -> dict:
    """Build the /chat response dict for a corpus joke (Path 1 direct serve)."""
    return {"reply": format_explicit_joke(joke), "sfx": "badumtss"}


# Keywords that trigger explicit joke delivery
_JOKE_KEYWORDS = (
    "tell me a joke",
    "tell a joke",
    "say a joke",
    "give me a joke",
    "make me laugh",
    "make me smile",
    "cheer me up",
    "i need a joke",
    "want a joke",
    "want to hear a joke",
    "got any jokes",
    "know any jokes",
    "funny joke",
    "say something funny",
    "tell me something funny",
    "be funny",
    "crack a joke",
)


def is_explicit_joke_request(message: str) -> bool:
    lowered = message.lower()
    return any(kw in lowered for kw in _JOKE_KEYWORDS)
