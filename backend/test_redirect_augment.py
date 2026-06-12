"""Unit tests for redirect extraction / normalization in augment_wikipedia_meta.

No DB, no file I/O — synthetic docs only.
"""

import pytest
from augment_wikipedia_meta import normalize_alias


# ---------------------------------------------------------------------------
# normalize_alias
# ---------------------------------------------------------------------------

def test_normalize_alias_lowercases():
    assert normalize_alias("Albert Einstein") == "albert einstein"


def test_normalize_alias_collapses_whitespace():
    assert normalize_alias("Albert  \t Einstein") == "albert einstein"


def test_normalize_alias_strips_edges():
    assert normalize_alias("  Einstein  ") == "einstein"


def test_normalize_alias_already_lower():
    assert normalize_alias("einstein") == "einstein"


def test_normalize_alias_unicode_preserved():
    # Unicode letters survive; only case and whitespace are touched.
    assert normalize_alias("Café au Lait") == "café au lait"


# ---------------------------------------------------------------------------
# Redirect extraction logic (replicated inline to keep tests free of DB deps)
# ---------------------------------------------------------------------------

def extract_aliases(doc: dict) -> list[tuple[str, str]]:
    """Mirrors the alias-extraction logic in run_redirects — no DB needed."""
    from wiki_store import slugify

    if doc.get("namespace") != 0:
        return []
    title = str(doc.get("title", "")).strip()
    if not title:
        return []

    slug = slugify(title)
    result = [(normalize_alias(title), slug)]

    for redir in (doc.get("redirect") or []):
        if not isinstance(redir, dict):
            continue
        if redir.get("namespace") != 0:
            continue
        rtitle = str(redir.get("title", "")).strip()
        if rtitle:
            result.append((normalize_alias(rtitle), slug))

    return result


# ---------------------------------------------------------------------------
# Namespace-0 filtering
# ---------------------------------------------------------------------------

def test_non_ns0_article_ignored():
    doc = {"namespace": 4, "title": "Wikipedia:Sandbox", "redirect": []}
    assert extract_aliases(doc) == []


def test_ns0_redirect_with_non_ns0_entry_filtered():
    doc = {
        "namespace": 0,
        "title": "Foo",
        "redirect": [
            {"namespace": 1, "title": "Talk:Foo"},
            {"namespace": 0, "title": "F.O.O."},
        ],
    }
    aliases = extract_aliases(doc)
    norms = [a[0] for a in aliases]
    assert "talk:foo" not in norms
    assert "f.o.o." in norms


# ---------------------------------------------------------------------------
# Own-title inclusion
# ---------------------------------------------------------------------------

def test_own_title_always_included():
    doc = {"namespace": 0, "title": "Albert Einstein", "redirect": []}
    aliases = extract_aliases(doc)
    assert ("albert einstein", "albert-einstein") in aliases


def test_own_title_included_alongside_redirects():
    doc = {
        "namespace": 0,
        "title": "Albert Einstein",
        "redirect": [{"namespace": 0, "title": "Einstein"}],
    }
    aliases = extract_aliases(doc)
    norms = [a[0] for a in aliases]
    assert "albert einstein" in norms
    assert "einstein" in norms


# ---------------------------------------------------------------------------
# Redirect normalization
# ---------------------------------------------------------------------------

def test_redirect_title_lowercased():
    doc = {
        "namespace": 0,
        "title": "ZZX",
        "redirect": [{"namespace": 0, "title": "ZZX (Disambiguation)"}],
    }
    aliases = extract_aliases(doc)
    norms = [a[0] for a in aliases]
    assert "zzx (disambiguation)" in norms


def test_redirect_whitespace_collapsed():
    doc = {
        "namespace": 0,
        "title": "Foo Bar",
        "redirect": [{"namespace": 0, "title": "Foo  Bar"}],
    }
    aliases = extract_aliases(doc)
    norms = [a[0] for a in aliases]
    assert "foo bar" in norms


def test_empty_redirect_title_skipped():
    doc = {
        "namespace": 0,
        "title": "Foo",
        "redirect": [{"namespace": 0, "title": ""}],
    }
    aliases = extract_aliases(doc)
    # Only own-title alias should appear
    assert len(aliases) == 1


def test_null_redirect_field_ok():
    doc = {"namespace": 0, "title": "Foo", "redirect": None}
    assert extract_aliases(doc) == [("foo", "foo")]


def test_missing_redirect_field_ok():
    doc = {"namespace": 0, "title": "Foo"}
    assert extract_aliases(doc) == [("foo", "foo")]


def test_non_dict_redirect_entries_skipped():
    doc = {
        "namespace": 0,
        "title": "Foo",
        "redirect": ["not-a-dict", None, {"namespace": 0, "title": "Bar"}],
    }
    aliases = extract_aliases(doc)
    norms = [a[0] for a in aliases]
    assert "foo" in norms
    assert "bar" in norms
    assert len(norms) == 2


# ---------------------------------------------------------------------------
# Slug correctness
# ---------------------------------------------------------------------------

def test_all_aliases_share_same_slug():
    doc = {
        "namespace": 0,
        "title": "Albert Einstein",
        "redirect": [
            {"namespace": 0, "title": "Einstein"},
            {"namespace": 0, "title": "A. Einstein"},
        ],
    }
    aliases = extract_aliases(doc)
    slugs = {s for _, s in aliases}
    assert slugs == {"albert-einstein"}
