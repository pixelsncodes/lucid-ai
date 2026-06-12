#!/usr/bin/env python3
"""Deep-dive: score breakdown, entity boosts, and redirect lookups for cases 1 & 2."""

import sys, os, math, sqlite3
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import wiki_store

INDEX_PATH = wiki_store.WIKIPEDIA_FULL_INDEX_PATH
W_POP   = wiki_store.W_POP
W_TITLE = wiki_store.W_TITLE
W_ENTITY= wiki_store.W_ENTITY


def adjusted_score(fts_score: float, links: int, title_covered: bool,
                   entity_boost: int) -> float:
    return (fts_score
            - W_POP    * math.log1p(links)
            - (W_TITLE if title_covered else 0.0)
            - W_ENTITY * entity_boost)


def probe_full(query: str, label: str, targets: list[str] = ()) -> None:
    print(f"\n{'='*72}")
    print(f"QUERY: {query!r}   ({label})")
    print(f"W_POP={W_POP}  W_TITLE={W_TITLE}  W_ENTITY={W_ENTITY}")
    print(f"{'='*72}")

    terms = wiki_store.query_terms(query)
    query_term_set = set(terms)
    print(f"  query_terms: {terms}")

    ngrams = wiki_store._build_alias_ngrams(terms)
    print(f"  alias ngrams: {[p for p,_ in ngrams]}")

    with sqlite3.connect(f"file:{INDEX_PATH}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row

        # Entity boosts
        entity_map = wiki_store._load_entity_boosts(conn, ngrams)
        print(f"\n  entity_boost_map (top 10 by count):")
        for slug, count in sorted(entity_map.items(), key=lambda x: -x[1])[:10]:
            print(f"    {slug!r:50s} count={count}")

        # Check targets specifically
        for t in targets:
            b = entity_map.get(t, 0)
            print(f"  target {t!r} entity_boost={b}")

        # Build merged rows (replicate has_meta ladder)
        attempt_terms = list(terms)
        is_first_level = True
        search_limit = min(500, max(50, 100))
        relaxed_limit = min(800, max(search_limit * 3, 300))
        seen_chunk_ids: set = set()
        merged_rows = []
        level = 0
        while attempt_terms:
            level += 1
            fts_q = wiki_store.build_fts_query_from_terms(attempt_terms)
            lim = search_limit if is_first_level else relaxed_limit
            rows = wiki_store.run_fts_search(conn, fts_q, lim)
            for row in rows:
                if row["id"] not in seen_chunk_ids:
                    seen_chunk_ids.add(row["id"])
                    merged_rows.append(row)
            is_first_level = False
            if len(merged_rows) >= 800 or len(attempt_terms) <= 2:
                break
            attempt_terms = attempt_terms[:-1]

        print(f"\n  merged_rows after ladder: {len(merged_rows)}")

        # Check if targets appear in merged_rows
        target_rows = {t: [] for t in targets}
        for row in merged_rows:
            for t in targets:
                if row["article_id"] == t:
                    target_rows[t].append(dict(row))
        for t in targets:
            rows_for_t = target_rows[t]
            print(f"  target {t!r} in merged_rows: {len(rows_for_t)} chunk(s)")
            for r in rows_for_t[:2]:
                print(f"    chunk {r['id']!r}  fts_score={r['score']:.3f}")
                print(f"    text: {r['text'][:100]!r}")

        # Load incoming_links
        distinct_slugs = list({r["article_id"] for r in merged_rows})
        links_map = wiki_store._load_incoming_links(conn, distinct_slugs)

    # Score all rows
    results = []
    for row in merged_rows:
        row = dict(row)
        art_id = row["article_id"]
        links = links_map.get(art_id, 0)
        covered = wiki_store._title_covered(row["title"], query_term_set)
        eb = entity_map.get(art_id, 0)
        adj = adjusted_score(row["score"], links, covered, eb)
        results.append({
            "id": art_id,
            "title": row["title"],
            "fts": row["score"],
            "links": links,
            "covered": covered,
            "entity_boost": eb,
            "adj": adj,
            "text": row["text"],
        })
    results.sort(key=lambda r: r["adj"])

    print(f"\n  Top 10 after scoring:")
    for i, r in enumerate(results[:10], 1):
        flag = " ← TARGET" if r["id"] in targets else ""
        print(f"  {i:2d}. [{r['id']}]{flag}")
        print(f"      title={r['title']!r}")
        print(f"      fts={r['fts']:.3f}  links={r['links']}  covered={r['covered']}  "
              f"entity_boost={r['entity_boost']}  adj={r['adj']:.3f}")

    # Show where targets rank
    for t in targets:
        rank = next((i for i, r in enumerate(results, 1) if r["id"] == t), None)
        print(f"\n  Target {t!r} rank: {rank if rank else 'NOT IN RESULTS'}")


if __name__ == "__main__":
    probe_full(
        "France's leader WW2",
        "Case 1",
        targets=["charles-de-gaulle", "france", "charles-de-gaulle-prime-minister",
                 "vichy-france", "free-france", "occupation-of-france"],
    )
    probe_full(
        "DC Comics Atlantis capital",
        "Case 2",
        targets=["atlantis-aquaman", "atlantis-dc-comics", "dc-comics",
                 "poseidonis", "atlantis-in-comics"],
    )
