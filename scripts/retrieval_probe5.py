#!/usr/bin/env python3
"""Check if fixing fts_term_variants (no false plural for france) helps Case 1.
Also verify atlantis+capital path for Case 2."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wiki_store

INDEX = wiki_store.WIKIPEDIA_FULL_INDEX_PATH

with wiki_store.connect(INDEX) as conn:
    # Case 1: france (without frances) AND leader
    for q in [
        "france AND (leader OR leaders)",
        "france AND (leader OR leaders) AND (ww2 OR wwii)",
        # Try each term pair that could appear in the De Gaulle article
        "france AND war",
        "(charles OR gaulle) AND france",
    ]:
        rows = wiki_store.run_fts_search(conn, q, 300)
        ids = [r["article_id"] for r in rows]
        found = "charles-de-gaulle" in ids
        rank = ids.index("charles-de-gaulle") + 1 if found else None
        qs = repr(q)[:55]
        print(f"  {qs:55s}  charles-de-gaulle={rank or 'NOTFOUND'}  total={len(ids)}")

    print()
    # Check what redirects exist for 'ww2', 'ww2 france', 'france leader'
    try:
        rows2 = conn.execute("""
            SELECT name_norm, slug FROM article_redirects
            WHERE name_norm IN ('ww2','wwii','france','leader','france leader','ww2 france')
        """).fetchall()
        print("article_redirects for key ngrams:")
        for r in rows2:
            print(f"  name_norm={r['name_norm']!r:20s}  slug={r['slug']!r}")
    except Exception as e:
        print(f"redirects error: {e}")

    print()
    # Case 2: verify atlantis capital path without dc/comics context
    # What does full search_index look like for "DC Comics Atlantis capital"
    # if we ALSO add a secondary "atlantis capital" query?
    r1 = wiki_store.search_index("DC Comics Atlantis capital", limit=3, index_path=INDEX)
    print("search_index('DC Comics Atlantis capital', limit=3):")
    for r in r1: print(f"  [{r['id']}]  {r['title']!r}")

    r2 = wiki_store.search_index("atlantis capital", limit=3, index_path=INDEX)
    print("\nsearch_index('atlantis capital', limit=3):")
    for r in r2: print(f"  [{r['id']}]  {r['title']!r}")

    # Merge (dedup by chunk_id)
    seen = set()
    merged = []
    for r in r1 + r2:
        if r["chunk_id"] not in seen:
            seen.add(r["chunk_id"])
            merged.append(r)
    print("\nMerged top 3 (deduplicated):")
    for r in merged[:3]: print(f"  [{r['id']}]  {r['title']!r}")
