"""Unit tests for normalize_reply_tag in main.py."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from main import normalize_reply_tag


# ── Valid tag kept as-is ──────────────────────────────────────────────────────

def test_valid_happy_tag_kept():
    assert normalize_reply_tag("Paris is the capital. :)") == "Paris is the capital. :)"

def test_valid_deadpan_tag_kept():
    assert normalize_reply_tag("The logs are clear. :/") == "The logs are clear. :/"

def test_valid_tag_trailing_whitespace_stripped():
    # rstrip() should remove trailing spaces but keep the tag
    assert normalize_reply_tag("All good. :)   ") == "All good. :)"

def test_valid_laugh_tag_kept():
    result = normalize_reply_tag("Why? Because. :D")
    assert result == "Why? Because. :D"

def test_valid_multi_char_tag_kept():
    assert normalize_reply_tag("Good to hear. ^-^") == "Good to hear. ^-^"

def test_valid_caps_tag_kept():
    assert normalize_reply_tag("Wait, what? O_O") == "Wait, what? O_O"


# ── Bare reply (no tag) → default ────────────────────────────────────────────

def test_bare_reply_gets_default():
    assert normalize_reply_tag("That is correct.") == "That is correct. :)"

def test_joke_mode_bare_reply_gets_d():
    assert normalize_reply_tag("Why did the chicken cross the road?", joke_mode=True) == \
        "Why did the chicken cross the road? :D"

def test_empty_string_gets_default():
    assert normalize_reply_tag("") == ":)"


# ── Invalid tag stripped and mapped ──────────────────────────────────────────

def test_invalid_s_lower_mapped_to_deadpan():
    assert normalize_reply_tag("Got it. :s") == "Got it. :/"

def test_invalid_S_upper_mapped_to_deadpan():
    assert normalize_reply_tag("Got it. :S") == "Got it. :/"

def test_invalid_extended_happy_mapped():
    assert normalize_reply_tag("That works :-)") == "That works :)"

def test_invalid_extended_sad_mapped():
    assert normalize_reply_tag("Bad news :-(") == "Bad news :("

def test_invalid_extended_grin_mapped_to_p_not_d():
    # :-D must never map to :D (would trigger laugh animation without a joke)
    result = normalize_reply_tag("Ha :-D")
    assert result == "Ha :P"
    assert ":D" not in result

def test_invalid_equals_happy_mapped():
    assert normalize_reply_tag("Sure thing =)") == "Sure thing :)"

def test_invalid_equals_grin_mapped_to_p():
    result = normalize_reply_tag("=D")
    assert result == ":P"

def test_invalid_xd_mapped_to_p_not_d():
    # xD must never map to :D — no laugh animation without an actual joke
    result = normalize_reply_tag("Ha that's funny xD")
    assert result == "Ha that's funny :P"
    assert ":D" not in result

def test_invalid_XD_upper_mapped_to_p():
    result = normalize_reply_tag("Ha XD")
    assert result == "Ha :P"
    assert ":D" not in result

def test_invalid_frustration_face_mapped():
    assert normalize_reply_tag("This again. >_<") == "This again. :/"

def test_invalid_hat_caret_mapped_to_valid():
    assert normalize_reply_tag("Nice. ^_^") == "Nice. ^-^"

def test_invalid_lowercase_oo_mapped():
    assert normalize_reply_tag("Oh no o_o") == "Oh no O_O"

def test_invalid_reverse_d_face_mapped():
    assert normalize_reply_tag("D:") == ":("


# ── Invalid tag, no mapping → default ────────────────────────────────────────

def test_invalid_tag_no_mapping_gets_default():
    # =_= matches _STRAY_EMOTE_RE but has no entry in _NEAR_MISS_MAP
    assert normalize_reply_tag("Fine. =_=") == "Fine. :)"

def test_joke_mode_invalid_tag_gets_d():
    # joke_mode overrides near-miss mapping — model was told to tell a joke
    result = normalize_reply_tag("Punchline. :S", joke_mode=True)
    assert result == "Punchline. :D"
    assert ":/" not in result


# ── Double-tag scenarios (':S :)' never reaches the frontend) ─────────────────

def test_stray_before_valid_tag_stripped():
    # ":S :)" — model leaked :S then corrected to :); strip :S, keep :)
    assert normalize_reply_tag("Understood. :S :)") == "Understood. :)"

def test_valid_before_stray_stripped():
    # ":) :S" — :S is the trailing token; strip it, reveal :)
    assert normalize_reply_tag("Understood. :) :S") == "Understood. :)"

def test_multiple_strays_before_valid_all_stripped():
    # "reply :S :-) :D" — :D is valid; strip ":S :-)" before it
    assert normalize_reply_tag("reply :S :-) :D") == "reply :D"

def test_two_strays_no_valid_innermost_mapped():
    # "reply :S :-)" — both stray, rightmost (:-)) mapped to :)
    assert normalize_reply_tag("reply :S :-)") == "reply :)"
