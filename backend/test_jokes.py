"""Unit tests for jokes.py helpers."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from jokes import build_explicit_joke_response, format_explicit_joke


_SAMPLE = {"id": 1, "setup": "Why did the chicken cross the road?", "punchline": "To get to the other side."}


def test_format_explicit_joke_ends_with_d():
    result = format_explicit_joke(_SAMPLE)
    assert result.endswith(":D")


def test_format_explicit_joke_contains_setup_and_punchline():
    result = format_explicit_joke(_SAMPLE)
    assert _SAMPLE["setup"] in result
    assert _SAMPLE["punchline"] in result


def test_format_explicit_joke_no_space_collision():
    # setup and punchline should be separated by a space in the body
    joke = {"setup": "Setup.", "punchline": "Punchline."}
    result = format_explicit_joke(joke)
    assert "Setup. Punchline." in result


def test_build_explicit_joke_response_sfx_field():
    resp = build_explicit_joke_response(_SAMPLE)
    assert resp["sfx"] == "badumtss"


def test_build_explicit_joke_response_reply_field():
    resp = build_explicit_joke_response(_SAMPLE)
    assert "reply" in resp
    assert resp["reply"].endswith(":D")


def test_build_explicit_joke_response_reply_matches_format():
    # reply must be identical to what format_explicit_joke would return for the
    # same joke; randomness in JOKE_INTROS is OK as long as the tail is :D
    resp = build_explicit_joke_response(_SAMPLE)
    assert _SAMPLE["setup"] in resp["reply"]
    assert _SAMPLE["punchline"] in resp["reply"]
