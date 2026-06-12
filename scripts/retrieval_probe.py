#!/usr/bin/env python3
"""Diagnostic probe: traces the full retrieval path for the regression cases.

Runs without an LLM — mirrors exactly what the rule-based path does for
standalone questions (the LLM planner never fires for those).

Usage:
    cd ~/lucid-ai && backend/.venv/bin/python scripts/retrieval_probe.py
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import wiki_store

INDEX_PATH = wiki_store.WIKIPEDIA_FULL_INDEX_PATH

PROBES = [
    {
        "label": "France's leader WW2",
        "query": "France's leader WW2",
    },
    {
        "label": "DC Comics Atlantis capital",
        "query": "DC Comics Atlantis capital",
    },
    {
        "label": "Nolan — do/know phrasing (FAILING)",
        "query": "What do you know about Christopher Nolan?",
        "expect": "christopher-nolan",
    },
    {
        "label": "Nolan — tell/me phrasing (WORKING)",
        "query": "What can you tell me about Christopher Nolan?",
        "expect": "christopher-nolan",
    },
]


def probe_query(query: str, label: str, expect: str | None = None) -> None:
    print(f"\n{'='*70}")
    print(f"QUERY: {query!r}")
    print(f"LABEL: {label}")
    print(f"{'='*70}")

    terms = wiki_store.query_terms(query)
    print(f"\n  query_terms()   → {terms}")

    if not terms:
        print("  [NO TERMS — early return]")
        return

    fts_q = wiki_store.build_fts_query_from_terms(terms)
    print(f"  FTS5 query      → {fts_q!r}")

    required = wiki_store.required_title_terms(query)
    print(f"  required_title  → {required}")

    # Trace each ladder level individually
    print(f"\n  --- Ladder levels (has_meta path) ---")
    attempt_terms = list(terms)
    level = 0
    while attempt_terms:
        level += 1
        level_q = wiki_store.build_fts_query_from_terms(attempt_terms)
        limit = min(500, max(50, 100))
        import sqlite3
        try:
            conn = sqlite3.connect(f"file:{INDEX_PATH}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            rows = wiki_store.run_fts_search(conn, level_q, limit)
            conn.close()
        except Exception as e:
            print(f"  Level {level} ({attempt_terms}): DB ERROR: {e}")
            break

        print(f"\n  Level {level}  terms={attempt_terms}  fts={level_q!r}")
        print(f"    raw rows returned: {len(rows)}")
        # Show top 5 article titles
        seen_ids: set[str] = set()
        shown = 0
        for row in rows:
            aid = row["article_id"]
            if aid not in seen_ids:
                seen_ids.add(aid)
                shown += 1
                print(f"      article {shown:2d}: [{aid}]  {row['title']!r}  score={row['score']:.3f}")
                if shown >= 5:
                    break

        if len(attempt_terms) <= 2:
            break
        attempt_terms = attempt_terms[:-1]

    # Now run the full search_index and show final results
    print(f"\n  --- Final search_index() results (limit=3) ---")
    results = wiki_store.search_index(query, limit=3, index_path=INDEX_PATH)
    if not results:
        print("  [EMPTY — would return UNKNOWN_WIKIPEDIA_ANSWER]")
    else:
        for i, r in enumerate(results, 1):
            print(f"  {i}. [{r['id']}]  {r['title']!r}")
            print(f"     score={r['score']:.4f}  chunk: {r['text'][:120]!r}...")
        if expect:
            found = any(r["id"] == expect for r in results)
            print(f"\n  Expected {expect!r}: {'FOUND ✓' if found else 'MISSING ✗'}")


def main():
    if not INDEX_PATH.exists():
        print(f"ERROR: enwiki index not found at {INDEX_PATH}")
        sys.exit(1)

    print(f"Index: {INDEX_PATH}")
    print(f"Size:  {INDEX_PATH.stat().st_size / 1e9:.1f} GB")

    for probe in PROBES:
        probe_query(probe["query"], probe["label"], probe.get("expect"))

    print(f"\n{'='*70}")
    print("DONE")


if __name__ == "__main__":
    main()
