#!/usr/bin/env python3
"""Check De Gaulle article terms and atlantis-aquaman content."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wiki_store

INDEX = wiki_store.WIKIPEDIA_FULL_INDEX_PATH

with wiki_store.connect(INDEX) as conn:
    # 1. Charles de Gaulle
    rows = conn.execute(
        "SELECT id, text FROM chunks WHERE article_id='charles-de-gaulle'"
    ).fetchall()
    print(f"charles-de-gaulle: {len(rows)} chunks")
    for r in rows[:6]:
        t = r["text"].lower()
        flags = {k: (k in t) for k in ["wwii","ww2","world war","leader","france"]}
        print(f"  {r['id']}  {flags}")
        print(f"  {r['text'][:160]!r}")

    # 2. Search with ww2 expanded to wwii
    print("\n--- FTS: (france OR frances) AND (leader OR leaders) AND wwii ---")
    try:
        rows2 = conn.execute("""
            SELECT chunks.article_id, chunks.title, bm25(chunks_fts,5,1) AS score
            FROM chunks_fts
            JOIN chunks ON chunks_fts.rowid = chunks.rowid
            WHERE chunks_fts MATCH '(france OR frances) AND (leader OR leaders) AND wwii'
            ORDER BY score LIMIT 10
        """).fetchall()
        for r in rows2:
            print(f"  [{r['article_id']}]  {r['title']!r}  score={r['score']:.3f}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # 3. atlantis-aquaman content
    print("\n--- atlantis-aquaman chunks ---")
    rows3 = conn.execute(
        "SELECT id, text FROM chunks WHERE article_id='atlantis-aquaman'"
    ).fetchall()
    print(f"Total chunks: {len(rows3)}")
    for r in rows3:
        t = r["text"].lower()
        print(f"  {r['id']}  capital={'capital' in t}  dc={'dc' in t}  comics={'comics' in t}")
        print(f"  {r['text'][:180]!r}")
