#!/usr/bin/env python3
"""Ranking probe: test W_POP/W_TITLE tuning against wikipedia-full."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import wiki_store

INDEX_PATH = wiki_store.WIKIPEDIA_FULL_INDEX_PATH

PROBES = [
    {
        "label": "Einstein university",
        "query": "Albert Einstein university",
        "target": "albert-einstein",
    },
    {
        "label": "Einstein education",
        "query": "Albert Einstein education",
        "target": "albert-einstein",
    },
    {
        "label": "Capital of France",
        "query": "capital of France",
        "targets": ["paris", "list-of-capitals-of-france"],
        "note": "required_title_terms filters to 'france'-titled articles; France or list article expected",
    },
    {
        "label": "France WW2 leader",
        "query": "Who was France's leader during WW2",
    },
    {
        "label": "Capital of Atlantis",
        "query": "capital of Atlantis",
        "note": "atlantis-aquaman top is fine — fiction filter handles it downstream",
    },
]


def run_config(w_pop: float, w_title: float) -> dict[str, list]:
    wiki_store.W_POP = w_pop
    wiki_store.W_TITLE = w_title

    print(f"\n{'='*60}")
    print(f"W_POP={w_pop}  W_TITLE={w_title}")
    print(f"{'='*60}")

    summary = {}
    for probe in PROBES:
        query = probe["query"]
        label = probe["label"]

        results = wiki_store.search_index(query, limit=10, index_path=INDEX_PATH)
        article_ids = [r["id"] for r in results]

        print(f"\n  [{label}]  query={query!r}")
        for i, r in enumerate(results, 1):
            print(f"    {i:2d}. [{r['id']}]  {r['title']}")

        target = probe.get("target")
        if target:
            rank = next((i for i, rid in enumerate(article_ids, 1) if rid == target), None)
            tag = f"rank={rank}" if rank else "NOT IN TOP 10"
            print(f"    -> target={target!r}  {tag}")
            summary[label] = rank

        for tgt in probe.get("targets", []):
            rank = next((i for i, rid in enumerate(article_ids, 1) if rid == tgt), None)
            if rank:
                print(f"    -> target={tgt!r}  rank={rank}")
                summary[label] = rank
                break
        else:
            if probe.get("targets"):
                print(f"    -> none of {probe['targets']} in top 10")
                summary[label] = None

        note = probe.get("note")
        if note:
            print(f"    note: {note}")

    return summary


if __name__ == "__main__":
    configs = [
        (2.0, 8.0),
        (3.0, 10.0),
        (4.0, 12.0),
    ]

    all_summaries = {}
    for w_pop, w_title in configs:
        s = run_config(w_pop, w_title)
        all_summaries[(w_pop, w_title)] = s

    print(f"\n\n{'='*60}")
    print("SUMMARY  (rank of target article, lower=better)")
    print(f"{'='*60}")
    labels = [p["label"] for p in PROBES if "target" in p or "targets" in p]
    header = f"{'W_POP':>6} {'W_TITLE':>7}  " + "  ".join(f"{l[:18]:>18}" for l in labels)
    print(header)
    for (w_pop, w_title), s in all_summaries.items():
        row = f"{w_pop:>6.1f} {w_title:>7.1f}  "
        row += "  ".join(f"{str(s.get(l, '-')):>18}" for l in labels)
        print(row)
