#!/usr/bin/env python3
"""Check if charles-de-gaulle appears in wider level-2 search and probe atlantis timing."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wiki_store

INDEX = wiki_store.WIKIPEDIA_FULL_INDEX_PATH

with wiki_store.connect(INDEX) as conn:
    # Check france AND leader with wider limits
    for limit in [100, 300, 450]:
        rows = wiki_store.run_fts_search(conn, "(france OR frances) AND (leader OR leaders)", limit)
        ids = [r["article_id"] for r in rows]
        found = "charles-de-gaulle" in ids
        rank = ids.index("charles-de-gaulle") + 1 if found else None
        print(f"france AND leader (limit={limit}): charles-de-gaulle rank={rank or 'NOT FOUND'}")

    # Try wwii variant
    for q in [
        "(france OR frances) AND (leader OR leaders) AND wwii",
        "(france OR frances) AND (leader OR leaders) AND (wwii OR ww2 OR war)",
    ]:
        rows2 = wiki_store.run_fts_search(conn, q, 300)
        ids2 = [r["article_id"] for r in rows2]
        found = "charles-de-gaulle" in ids2
        rank = ids2.index("charles-de-gaulle") + 1 if found else None
        qshort = repr(q)[:60]
        print(f"  {qshort}  → De Gaulle rank={rank or 'NOT FOUND'}  total={len(rows2)}")

    # Try atlantis AND capital directly
    print("\n--- atlantis AND capital ---")
    rows3 = wiki_store.run_fts_search(conn, "(atlantis OR atlanti) AND (capital OR capitals)", 20)
    for r in rows3[:5]:
        print(f"  [{r['article_id']}]  {r['title']!r}  score={r['score']:.3f}")

    # And atlantis AND capital AND dc/comics
    print("\n--- atlantis AND capital (full search_index call) ---")
    results = wiki_store.search_index("atlantis capital", limit=3, index_path=INDEX)
    for r in results:
        print(f"  [{r['id']}]  {r['title']!r}")
