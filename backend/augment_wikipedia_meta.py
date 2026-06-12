#!/usr/bin/env python3
"""
Build or refresh article_meta / article_redirects side tables in the
wikipedia-full SQLite DB.

Streams the retained CirrusSearch dump(s) and writes per-article metadata
without touching the chunks or FTS tables.  Both passes are idempotent;
re-run freely after an interrupted attempt.

Usage:
  # Trial meta run — throwaway DB, first part-file only:
  python augment_wikipedia_meta.py --limit 50000 --db /tmp/meta_trial.sqlite3

  # Full meta pass against the real DB:
  python augment_wikipedia_meta.py

  # Redirects-only trial (article_meta already built):
  python augment_wikipedia_meta.py --redirects-only --limit 50000 --db /tmp/redirects_trial.sqlite3

  # Full redirects pass:
  python augment_wikipedia_meta.py --redirects-only
"""

import argparse
import bz2
import gzip
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from wiki_store import WIKIPEDIA_FULL_DIR, WIKIPEDIA_FULL_INDEX_PATH, slugify

_DEFAULT_DUMPS_DIR = WIKIPEDIA_FULL_DIR / "dumps"

DEFAULT_BATCH_SIZE = 5000
ENWIKI_ARTICLE_ESTIMATE = 6_800_000

# ---------------------------------------------------------------------------
# Fiction classifier
# ---------------------------------------------------------------------------

_ENTITY_LOCATION_TERMS = frozenset({
    "fictional locations",
    "fictional cities",
    "fictional countries",
    "fictional islands",
    "fictional populated places",
})

# Explicit WORK substring triggers (also caught by _FICTION_WORD_RE for the
# ones containing "fiction", but listed here for documentary clarity).
_WORK_TRIGGERS = frozenset({
    "science fiction films",
    "fantasy films",
    "fiction books",
    "fiction novels",
    "novels",
    "short stories",
    "comics titles",
    "comic strips",
    "graphic novels",
    "manga",
    "anime",
    "video games",
    "fiction television series",
    "fictional television",
    "comics albums",
})

# Words whose presence in a WORK-candidate category mean it describes
# creators/industry rather than a fictional work.
_CREATOR_WORDS = frozenset({
    "writers",
    "artists",
    "creators",
    "publishers",
    "publications",
    "novelists",
    "people",       # blocks "Marvel Comics people", "DC Comics people"
})

# If a category *starts with* "fictional " but also contains one of these
# words it describes a genre of work (e.g. "Fictional association football
# television series"), not a fictional entity — skip the entity signal.
_ENTITY_WORK_WORDS = frozenset({
    "television",
    "series",
    "films",
    "film",
    "shows",
    "show",
})

# Tightened whitelist: only the known entity-type suffixes (spec §3).
_DC_MARVEL_ENTITY_RE = re.compile(
    r"\b(dc|marvel) comics (characters|locations|objects|teams|deities)\b"
)
# Broader fallback: catches sub-types not in the whitelist (e.g. "mutants",
# "psychics").  Requires creator-exclusion check at call site.
_DC_MARVEL_RE = re.compile(r"\b(dc|marvel) comics\b")
_FICTION_WORD_RE = re.compile(r"\bfiction\b")  # does NOT match "fictional"

# Categories silenced before ANY fiction matching (no entity or work signal).
# Covers: non-fiction labels AND legal/copyright categories that merely discuss
# fictional works without the article itself being fictional.
_SILENT_TERMS = (
    "non-fiction",
    "nonfiction",
    "copyright",
    "lawsuit",
    "litigation",
    "case law",
    "legal disputes",
)

# Slugs whose metadata is printed immediately on encounter (for spot-checks).
PROBE_SLUGS = {"atlantis-aquaman", "atlantis-mystery", "albert-einstein"}


def classify_fiction(categories: list) -> str:
    """Return 'entity', 'work', or 'none' based on Wikipedia category list.

    Precedence: entity > work > none.
    Non-fiction and legal/copyright categories are silenced before any matching.
    """
    # Step a: silence categories that must never contribute a fiction signal
    lower_all = [c.lower() for c in categories]
    lower = [
        cl for cl in lower_all
        if not any(t in cl for t in _SILENT_TERMS)
    ]

    # Step b: entity checks (in order)
    for cl in lower:
        # "starts with 'fictional '" but NOT if it describes a work genre
        if cl.startswith("fictional ") and not any(w in cl for w in _ENTITY_WORK_WORDS):
            return "entity"
        if "fictional characters" in cl:
            return "entity"
        if "comics characters" in cl:
            return "entity"
        if "characters introduced in" in cl:
            return "entity"
        if any(t in cl for t in _ENTITY_LOCATION_TERMS):
            return "entity"
        # DC / Marvel Comics — tightened whitelist first, then broader fallback
        # with creator exclusion.  The two-step approach keeps "mutants",
        # "psychics", etc. as entity while blocking "people", "artists", etc.
        if _DC_MARVEL_ENTITY_RE.search(cl):
            return "entity"
        if _DC_MARVEL_RE.search(cl) and not any(w in cl for w in _CREATOR_WORDS):
            return "entity"

    # Step c: work checks
    for cl in lower:
        if any(w in cl for w in _CREATOR_WORDS):
            continue
        # General "fiction" word covers "sports fiction", "science fiction …", etc.
        if _FICTION_WORD_RE.search(cl):
            return "work"
        if any(t in cl for t in _WORK_TRIGGERS):
            return "work"
        if "dengeki comics" in cl:
            return "work"

    return "none"


# ---------------------------------------------------------------------------
# Dump reading — identical in spirit to import_wikipedia_full.py
# ---------------------------------------------------------------------------

def _open_lines(path: Path):
    suffix = path.suffix.lower()
    if suffix == ".bz2":
        return bz2.open(str(path), "rt", encoding="utf-8", errors="replace")
    if suffix == ".gz":
        return gzip.open(str(path), "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def iter_cirrussearch_pairs(path: Path):
    """Yield (action_dict, doc_dict) pairs from one CirrusSearch NDJSON file."""
    with _open_lines(path) as fh:
        pending = None
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                pending = None
                continue
            if not isinstance(obj, dict):
                pending = None
                continue
            if pending is None:
                if "index" in obj or "create" in obj or "update" in obj:
                    pending = obj
            else:
                yield pending, obj
                pending = None


def collect_input_files(input_path: Path) -> list:
    """Return sorted list of dump files.

    Accepts a single file, a directory of *.json.bz2/*.json.gz files, or a
    parent directory whose first sorted subdirectory contains such files
    (handles the dumps/enwiki-content-YYYYMMDD/ nesting).
    """
    if input_path.is_file():
        return [input_path]

    if not input_path.is_dir():
        print(f"ERROR: Input path not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    def _bz2gz(directory: Path) -> list:
        return sorted(
            [p for p in directory.iterdir()
             if p.suffix.lower() in (".bz2", ".gz") and p.stat().st_size > 0],
            key=lambda p: p.name,
        )

    files = _bz2gz(input_path)
    if files:
        return files

    # No files directly — try the first sorted subdirectory (e.g. enwiki-content-YYYYMMDD/)
    subdirs = sorted([p for p in input_path.iterdir() if p.is_dir()], key=lambda p: p.name)
    for subdir in subdirs:
        files = _bz2gz(subdir)
        if files:
            print(f"  Using dump directory: {subdir}", flush=True)
            return files

    return []


# ---------------------------------------------------------------------------
# Redirect alias normalization
# ---------------------------------------------------------------------------

def normalize_alias(title: str) -> str:
    """Lowercase and collapse whitespace — used as the lookup key in article_redirects."""
    return re.sub(r"\s+", " ", title.strip()).lower()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _human_size(path: Path) -> str:
    try:
        n = float(path.stat().st_size)
    except OSError:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def init_meta_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS article_meta (
            slug             TEXT PRIMARY KEY,
            title            TEXT,
            page_id          INTEGER,
            incoming_links   INTEGER,
            popularity_score REAL,
            fiction_kind     TEXT CHECK(fiction_kind IN ('entity','work','none'))
        )
    """)
    conn.commit()


_INSERT_SQL = (
    "INSERT OR REPLACE INTO article_meta"
    " (slug, title, page_id, incoming_links, popularity_score, fiction_kind)"
    " VALUES (?,?,?,?,?,?)"
)

_INSERT_REDIRECT_SQL = (
    "INSERT OR IGNORE INTO article_redirects (name_norm, slug) VALUES (?,?)"
)


def init_redirects_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS article_redirects (
            name_norm TEXT,
            slug      TEXT,
            PRIMARY KEY (name_norm, slug)
        )
    """)
    conn.commit()


def _flush(conn: sqlite3.Connection, batch: list) -> None:
    if batch:
        conn.executemany(_INSERT_SQL, batch)
        conn.commit()


def _flush_redirects(conn: sqlite3.Connection, batch: list) -> None:
    if batch:
        conn.executemany(_INSERT_REDIRECT_SQL, batch)
        conn.commit()


# ---------------------------------------------------------------------------
# Augmentation pass
# ---------------------------------------------------------------------------

def run_augment(
    input_path: Path,
    db_path: Path,
    limit: int | None,
    batch_size: int,
) -> None:
    files = collect_input_files(input_path)
    if not files:
        print(f"ERROR: no .json.bz2/.json.gz files found under {input_path}", file=sys.stderr)
        sys.exit(1)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA cache_size=-131072;
        PRAGMA temp_store=MEMORY;
        PRAGMA mmap_size=2147483648;
    """)
    init_meta_table(conn)

    print(f"  DB:     {db_path}")
    print(f"  Input:  {input_path}")
    print(f"  Files:  {len(files)} part(s)")
    print(f"  limit={limit or 'none'}  batch_size={batch_size}")
    print()

    batch: list = []
    total = 0
    start = time.monotonic()
    done = False

    for file_idx, file_path in enumerate(files):
        if done:
            break

        print(f"  [{file_idx + 1}/{len(files)}] {file_path.name} ...", flush=True)
        file_articles = 0

        for _action, doc in iter_cirrussearch_pairs(file_path):
            if not isinstance(doc, dict):
                continue
            if doc.get("namespace") != 0:
                continue

            title = str(doc.get("title", "")).strip()
            if not title:
                continue

            slug = slugify(title)
            page_id = doc.get("page_id")
            incoming_links = doc.get("incoming_links")
            popularity_score = doc.get("popularity_score")
            categories = doc.get("category") or []
            fiction_kind = classify_fiction(categories)

            if slug in PROBE_SLUGS:
                print(
                    f"PROBE: {slug} -> fiction_kind={fiction_kind}"
                    f" incoming_links={incoming_links}"
                    f" popularity_score={popularity_score}",
                    flush=True,
                )

            batch.append((slug, title, page_id, incoming_links, popularity_score, fiction_kind))
            total += 1
            file_articles += 1

            if len(batch) >= batch_size:
                _flush(conn, batch)
                batch = []

            if total % 50_000 == 0:
                elapsed = time.monotonic() - start
                rate = total / elapsed if elapsed > 0 else 0
                print(
                    f"  [{total:>8,} articles | {rate:>6.0f} art/s"
                    f" | DB: {_human_size(db_path)}]",
                    flush=True,
                )

            if limit is not None and total >= limit:
                done = True
                break

        _flush(conn, batch)
        batch = []
        print(f"    {file_articles:,} articles from this file", flush=True)

    conn.close()

    elapsed = time.monotonic() - start
    rate_str = f"{total / elapsed:.0f} art/s" if elapsed > 0 else "?"
    print(f"\n  Done: {total:,} articles in {elapsed:.1f}s ({rate_str})")
    print(f"  DB:   {db_path}  ({_human_size(db_path)})")


# ---------------------------------------------------------------------------
# Redirects augmentation pass
# ---------------------------------------------------------------------------

def run_redirects(
    input_path: Path,
    db_path: Path,
    limit: int | None,
    batch_size: int,
) -> None:
    files = collect_input_files(input_path)
    if not files:
        print(f"ERROR: no .json.bz2/.json.gz files found under {input_path}", file=sys.stderr)
        sys.exit(1)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA cache_size=-131072;
        PRAGMA temp_store=MEMORY;
        PRAGMA mmap_size=2147483648;
    """)
    init_redirects_table(conn)

    print(f"  DB:     {db_path}")
    print(f"  Input:  {input_path}")
    print(f"  Files:  {len(files)} part(s)")
    print(f"  limit={limit or 'none'}  batch_size={batch_size}")
    print()

    batch: list = []
    total_articles = 0
    total_aliases = 0
    start = time.monotonic()
    done = False

    for file_idx, file_path in enumerate(files):
        if done:
            break

        print(f"  [{file_idx + 1}/{len(files)}] {file_path.name} ...", flush=True)
        file_articles = 0

        for _action, doc in iter_cirrussearch_pairs(file_path):
            if not isinstance(doc, dict):
                continue
            if doc.get("namespace") != 0:
                continue

            title = str(doc.get("title", "")).strip()
            if not title:
                continue

            slug = slugify(title)

            # Own-title alias
            own_norm = normalize_alias(title)
            batch.append((own_norm, slug))
            alias_count = 1

            # Namespace-0 redirect aliases
            for redir in (doc.get("redirect") or []):
                if not isinstance(redir, dict):
                    continue
                if redir.get("namespace") != 0:
                    continue
                rtitle = str(redir.get("title", "")).strip()
                if not rtitle:
                    continue
                batch.append((normalize_alias(rtitle), slug))
                alias_count += 1

            if slug in PROBE_SLUGS:
                probe_aliases = [normalize_alias(r["title"]) for r in (doc.get("redirect") or [])
                                 if isinstance(r, dict) and r.get("namespace") == 0 and r.get("title")]
                print(
                    f"PROBE: {slug} -> own_norm={own_norm!r}"
                    f" redirect_aliases={probe_aliases}",
                    flush=True,
                )

            total_aliases += alias_count
            total_articles += 1
            file_articles += 1

            if len(batch) >= batch_size:
                _flush_redirects(conn, batch)
                batch = []

            if total_articles % 50_000 == 0:
                elapsed = time.monotonic() - start
                rate = total_articles / elapsed if elapsed > 0 else 0
                print(
                    f"  [{total_articles:>8,} articles | {total_aliases:>10,} aliases"
                    f" | {rate:>6.0f} art/s | DB: {_human_size(db_path)}]",
                    flush=True,
                )

            if limit is not None and total_articles >= limit:
                done = True
                break

        _flush_redirects(conn, batch)
        batch = []
        print(f"    {file_articles:,} articles from this file", flush=True)

    print("  Building index on name_norm ...", flush=True)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_redirects_name_norm"
        " ON article_redirects(name_norm)"
    )
    conn.commit()
    conn.close()

    elapsed = time.monotonic() - start
    rate_str = f"{total_articles / elapsed:.0f} art/s" if elapsed > 0 else "?"
    ratio = total_aliases / total_articles if total_articles else 0
    print(f"\n  Done: {total_articles:,} articles, {total_aliases:,} alias rows"
          f" ({ratio:.2f} aliases/article) in {elapsed:.1f}s ({rate_str})")
    print(f"  DB:   {db_path}  ({_human_size(db_path)})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=WIKIPEDIA_FULL_INDEX_PATH,
        help=f"Target SQLite path (default: {WIKIPEDIA_FULL_INDEX_PATH})",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=_DEFAULT_DUMPS_DIR,
        help=f"Dump file or directory (default: {_DEFAULT_DUMPS_DIR})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Stop after N namespace-0 articles (for trial runs)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        metavar="N",
        help=f"Commit every N rows (default: {DEFAULT_BATCH_SIZE})",
    )
    parser.add_argument(
        "--redirects-only",
        action="store_true",
        help="Write only article_redirects; skip article_meta work",
    )
    args = parser.parse_args()

    if args.redirects_only:
        run_redirects(
            input_path=args.input,
            db_path=args.db,
            limit=args.limit,
            batch_size=args.batch_size,
        )
    else:
        run_augment(
            input_path=args.input,
            db_path=args.db,
            limit=args.limit,
            batch_size=args.batch_size,
        )


if __name__ == "__main__":
    main()
