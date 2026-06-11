import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from pathlib import Path

import pytest

from main import is_fictional_source, question_is_fiction_scoped

_WIKIPEDIA_FULL_DB = Path(__file__).parent / "data" / "wikipedia-full" / "wikipedia-full.sqlite3"
_BACKEND_URL = "http://127.0.0.1:8000"


def _require_live_backend():
    if not _WIKIPEDIA_FULL_DB.exists():
        pytest.skip(f"wikipedia-full KB not found: {_WIKIPEDIA_FULL_DB}")
    try:
        import requests
        requests.get(f"{_BACKEND_URL}/health", timeout=2).raise_for_status()
    except Exception:
        pytest.skip("backend not reachable at http://127.0.0.1:8000")


def test_atlantis_aquaman_fictional():
    assert is_fictional_source(
        "Atlantis (Aquaman)",
        "Atlantis is a fictional city in the DC Universe; its capital is Poseidonis.",
    ) is True


def test_tool_band_not_fictional():
    assert is_fictional_source("Tool (band)", "Tool is an American rock band.") is False


def test_come_as_you_are_song_not_fictional():
    assert is_fictional_source("Come as You Are (Nirvana song)", "...") is False


def test_undertow_album_not_fictional():
    assert is_fictional_source("Undertow (Tool album)", "...") is False


def test_national_capital_region_not_fictional():
    assert is_fictional_source("National Capital Region (Canada)", "...") is False


def test_mercury_planet_not_fictional():
    assert is_fictional_source("Mercury (planet)", "...") is False


def test_plain_atlantis_question_not_fiction_scoped():
    assert question_is_fiction_scoped("What is the capital of Atlantis?") is False


def test_dc_comics_atlantis_question_fiction_scoped():
    assert question_is_fiction_scoped("In DC Comics, what is the capital of Atlantis?") is True


def test_chat_atlantis_capital_falls_back_live():
    """Real-world Atlantis capital question must fall back, not answer from fictional articles."""
    _require_live_backend()
    import requests
    resp = requests.post(
        f"{_BACKEND_URL}/chat",
        json={"message": "What is the capital of Atlantis?", "knowledge_base": "wikipedia-full", "history": []},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    assert data["reply"] == "I don't know from the selected Wikipedia knowledgebase.", (
        f"Expected fallback reply, got: {data['reply']!r}"
    )
    assert data.get("sources") == [], f"Expected empty sources, got: {data.get('sources')!r}"
