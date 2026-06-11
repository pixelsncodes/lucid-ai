#!/usr/bin/env python3
"""
Import Wikimedia CirrusSearch enwiki content dump into a local SQLite FTS5 index.

== Dump format ==
New location (current):
  https://dumps.wikimedia.org/other/cirrus_search_index/YYYYMMDD/index_name=enwiki_content/
  One directory per search index, containing one or more *.json.bz2 part files.

Old location (deprecated, last dump 20251229):
  https://dumps.wikimedia.org/other/cirrussearch/YYYYMMDD/
  Single enwiki-YYYYMMDD-cirrussearch-content.json.gz file.

Both locations use the same Elasticsearch bulk-format NDJSON inside:
  Line 1: {"index": ...}  — action line
  Line 2: {"title": "...", "namespace": 0, "text": "...", ...}  — document
The "text" field is already plain text.  No wikitext parsing needed.

== Input argument ==
  Single file  : a .json.bz2 or .json.gz file
  Directory    : all *.json.bz2 (and *.json.gz for old-format compatibility) files
                 are processed in sorted filename order

== Resumability — state file scheme ==
The state file stores (resume_file_index, resume_pairs_in_file):
  - resume_file_index    : index into the sorted file list.  Files before this
                           index are skipped entirely on resume (no decompression).
  - resume_pairs_in_file : number of action+doc pairs already consumed from
                           files[resume_file_index].  Pairs up to this count are
                           fast-forwarded; articles already in the DB are handled
                           safely by INSERT OR IGNORE.
  Saved after every batch commit and after completing each file.
  --skip N overrides both fields (treats the whole input as one stream from
  pair N); intended for single-file inputs or manual recovery.

== FTS build strategy: post-pass rebuild ==
During streaming we insert only into the `chunks` table (b-tree index only).
After all articles are loaded we run:
    INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')
which reads the content table in one sequential scan.  For millions of articles
this is 2-5x faster than per-row FTS maintenance during streaming.

== Download command (current, as of 2026-06-07) ==
Check https://dumps.wikimedia.org/other/cirrus_search_index/ for the latest date,
then:

  DUMP_DATE=20260607
  DEST=backend/data/wikipedia-full/dumps/enwiki-content-${DUMP_DATE}
  mkdir -p "${DEST}"

  # wget (resumable, sequential):
  wget -c -r -l1 -nd -np -A "*.json.bz2" -P "${DEST}/" \\
    "https://dumps.wikimedia.org/other/cirrus_search_index/${DUMP_DATE}/index_name=enwiki_content/"

  # aria2c (resumable, 4 parallel connections):
  aria2c -j4 -x4 -c -d "${DEST}" \\
    "https://dumps.wikimedia.org/other/cirrus_search_index/${DUMP_DATE}/index_name=enwiki_content/enwiki_content-${DUMP_DATE}-{00000..00063}.json.bz2"

Then run this script against the directory:
  python import_wikipedia_full.py "${DEST}" --limit 50000   # trial first
  python import_wikipedia_full.py "${DEST}"                 # full import
"""

import argparse
import bz2
import contextlib
import gzip
import json
import sqlite3
import sys
import time
from pathlib import Path

from wiki_store import (
    WIKIPEDIA_FULL_INDEX_PATH,
    chunk_text,
    initialize_index,
    is_useful_chunk,
    slugify,
)

DEFAULT_BATCH_SIZE = 750
DEFAULT_MAX_ARTICLE_CHARS = 10_000
ENWIKI_ARTICLE_ESTIMATE = 6_800_000


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def truncate_at_boundary(text: str, max_chars: int) -> str:
    """Truncate *text* to at most *max_chars*, never cutting mid-word.

    Preference order for the cut point: paragraph break, sentence boundary
    (. ! ?), then any whitespace.
    """
    if len(text) <= max_chars:
        return text

    pos = text.rfind("\n\n", 0, max_chars)
    if pos > max_chars // 2:
        return text[:pos].strip()

    for sep in (". ", "! ", "? "):
        pos = text.rfind(sep, 0, max_chars)
        if pos > max_chars // 2:
            return text[: pos + 1].strip()

    pos = text.rfind(" ", 0, max_chars)
    if pos > 0:
        return text[:pos].strip()

    return text[:max_chars]


# ---------------------------------------------------------------------------
# Dump reading
# ---------------------------------------------------------------------------


def _open_lines(path: Path):
    """Return a context manager yielding decoded text lines.

    Supported extensions: .json.bz2, .json.gz, .json.snappy, plain .json.
    All return an object usable with ``with ... as fh: for line in fh``.
    """
    suffix = path.suffix.lower()

    if suffix == ".bz2":
        return bz2.open(str(path), "rt", encoding="utf-8", errors="replace")

    if suffix == ".gz":
        return gzip.open(str(path), "rt", encoding="utf-8", errors="replace")

    if suffix == ".snappy":
        try:
            import cramjam  # type: ignore

            raw = path.read_bytes()
            text = cramjam.snappy.decompress_raw(raw).decode("utf-8", errors="replace")
            return contextlib.nullcontext(iter(text.splitlines(keepends=True)))
        except ImportError:
            pass
        try:
            import snappy  # type: ignore

            return snappy.open(str(path), "rt", encoding="utf-8", errors="replace")
        except ImportError:
            raise ImportError(
                f"Cannot read {path.name}: install 'cramjam' or 'python-snappy' for .snappy support"
            )

    return path.open("rt", encoding="utf-8", errors="replace")


def iter_cirrussearch_pairs(path: Path):
    """Yield (action_dict, doc_dict) pairs from one CirrusSearch NDJSON file.

    The ES bulk format alternates: action line, document line, …
    """
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


def collect_input_files(input_path: Path) -> list[Path]:
    """Return the sorted list of dump files to import.

    Single file  → [input_path]
    Directory    → all *.json.bz2 then *.json.gz, merged and sorted by name.
                   Ignores the zero-byte _SUCCESS marker file.
    """
    if input_path.is_file():
        return [input_path]

    if input_path.is_dir():
        files = sorted(
            [p for p in input_path.iterdir()
             if p.suffix.lower() in (".bz2", ".gz") and p.stat().st_size > 0],
            key=lambda p: p.name,
        )
        return files

    print(f"ERROR: Input path not found: {input_path}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# State file
# ---------------------------------------------------------------------------


def load_state(state_path: Path) -> dict:
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state_path: Path, state: dict) -> None:
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(state_path)


# ---------------------------------------------------------------------------
# Progress display
# ---------------------------------------------------------------------------


def human_size(path: Path) -> str:
    try:
        n = float(path.stat().st_size)
    except OSError:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def eta_str(elapsed: float, done: int, total: int) -> str:
    if elapsed < 5 or done <= 0 or total <= done:
        return "?"
    secs = int((total - done) * elapsed / done)
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60}m"
    h, r = divmod(secs, 3600)
    return f"{h}h {r // 60}m"


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def _flush_batch(conn: sqlite3.Connection, batch: list[tuple]) -> None:
    if batch:
        conn.executemany(
            "INSERT OR IGNORE INTO chunks (id, article_id, title, text, chunk_index)"
            " VALUES (?,?,?,?,?)",
            batch,
        )
        conn.commit()


def run_import(
    input_path: Path,
    index_path: Path,
    state_path: Path,
    skip: int,
    limit: int | None,
    max_article_chars: int,
    batch_size: int,
) -> None:
    files = collect_input_files(input_path)
    if not files:
        print(f"ERROR: no .json.bz2 or .json.gz files found in {input_path}", file=sys.stderr)
        sys.exit(1)

    # ------------------------------------------------------------------
    # Resolve resume position from state file (or --skip override)
    # ------------------------------------------------------------------
    state = load_state(state_path)

    if skip > 0:
        # Manual override: treat as single-stream skip from file 0
        resume_file_idx = 0
        resume_pairs_in_file = skip
        # Carry forward counters from state so resume keeps accumulating
        total_articles = state.get("articles_imported", 0)
        total_chunks = state.get("chunks_imported", 0)
    else:
        resume_file_idx = state.get("resume_file_index", 0)
        resume_pairs_in_file = state.get("resume_pairs_in_file", 0)
        total_articles = state.get("articles_imported", 0)
        total_chunks = state.get("chunks_imported", 0)

    # ------------------------------------------------------------------
    # DB setup
    # ------------------------------------------------------------------
    index_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(index_path))
    conn.row_factory = sqlite3.Row
    # Fast bulk-insert pragmas; WAL is restored on success.
    conn.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA cache_size=-131072;
        PRAGMA temp_store=MEMORY;
        PRAGMA mmap_size=2147483648;
    """)
    initialize_index(conn)

    batch: list[tuple] = []
    start = time.monotonic()
    effective_total = limit or ENWIKI_ARTICLE_ESTIMATE

    print(f"  Index:  {index_path}")
    print(
        f"  Files:  {len(files)} part(s)"
        + (f", resuming from file {resume_file_idx} pair {resume_pairs_in_file}" if resume_file_idx or resume_pairs_in_file else "")
    )
    print(f"  limit={limit or 'none'}  max_article_chars={max_article_chars}  batch_size={batch_size}")
    print()

    done = False  # set when --limit is reached

    for file_idx, file_path in enumerate(files):
        if done:
            break

        # Skip files already fully processed
        if file_idx < resume_file_idx:
            print(f"  Skipping (already imported): {file_path.name}", flush=True)
            continue

        pairs_to_skip_in_file = resume_pairs_in_file if file_idx == resume_file_idx else 0
        pairs_in_file = 0

        file_label = f"[{file_idx + 1}/{len(files)}] {file_path.name}"
        if pairs_to_skip_in_file:
            print(f"  {file_label}  (fast-forwarding {pairs_to_skip_in_file:,} pairs)", flush=True)
        else:
            print(f"  {file_label}", flush=True)

        for _action, doc in iter_cirrussearch_pairs(file_path):
            pairs_in_file += 1

            # Fast-forward to resume point within this file
            if pairs_in_file <= pairs_to_skip_in_file:
                if pairs_in_file % 200_000 == 0:
                    print(
                        f"    fast-forwarding … {pairs_in_file:,} / {pairs_to_skip_in_file:,}",
                        flush=True,
                    )
                continue

            if not isinstance(doc, dict):
                continue
            if doc.get("namespace") != 0:
                continue

            title = str(doc.get("title", "")).strip()
            text = str(doc.get("text") or "").strip()
            if not title or not text:
                continue

            text = truncate_at_boundary(text, max_article_chars)
            article_id = slugify(title)

            chunks = [c for c in chunk_text(text) if is_useful_chunk(c)]
            if not chunks:
                continue

            for chunk_index, chunk in enumerate(chunks):
                batch.append(
                    (f"{article_id}:{chunk_index}", article_id, title, chunk, chunk_index)
                )

            total_articles += 1
            total_chunks += len(chunks)

            if total_articles % batch_size == 0:
                _flush_batch(conn, batch)
                batch = []
                save_state(
                    state_path,
                    {
                        "resume_file_index": file_idx,
                        "resume_pairs_in_file": pairs_in_file,
                        "articles_imported": total_articles,
                        "chunks_imported": total_chunks,
                        "fts_built": False,
                    },
                )

            if total_articles % 10_000 == 0:
                elapsed = time.monotonic() - start
                rate = total_articles / elapsed if elapsed > 0 else 0
                print(
                    f"  [{total_articles:>8,} articles | {total_chunks:>10,} chunks |"
                    f" {rate:>6.0f} art/s | ETA: {eta_str(elapsed, total_articles, effective_total)} |"
                    f" DB: {human_size(index_path)}]",
                    flush=True,
                )

            if limit is not None and total_articles >= limit:
                done = True
                break

        # Completed this file — advance resume pointer to next file
        _flush_batch(conn, batch)
        batch = []
        save_state(
            state_path,
            {
                "resume_file_index": file_idx + 1,
                "resume_pairs_in_file": 0,
                "articles_imported": total_articles,
                "chunks_imported": total_chunks,
                "fts_built": False,
            },
        )

    # Flush any leftover batch (only reached when done=True mid-file)
    _flush_batch(conn, batch)

    elapsed = time.monotonic() - start
    rate_str = f"{total_articles / elapsed:.0f} art/s" if elapsed > 0 else "?"
    print(
        f"\n  Streaming done: {total_articles:,} articles, {total_chunks:,} chunks"
        f" in {elapsed:.1f}s ({rate_str})",
        flush=True,
    )

    # ------------------------------------------------------------------
    # Post-pass FTS5 rebuild
    # ------------------------------------------------------------------
    print("  Building FTS5 index (post-pass rebuild) …", flush=True)
    fts_t0 = time.monotonic()
    conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
    conn.commit()
    print(f"  FTS5 index built in {time.monotonic() - fts_t0:.1f}s", flush=True)

    # Restore safe WAL mode for concurrent reads by the API server
    conn.executescript("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
    conn.close()

    save_state(
        state_path,
        {
            "resume_file_index": len(files),
            "resume_pairs_in_file": 0,
            "articles_imported": total_articles,
            "chunks_imported": total_chunks,
            "fts_built": True,
        },
    )

    total_elapsed = time.monotonic() - start
    print(f"\n  Import complete in {total_elapsed:.0f}s")
    print(f"  Index:  {index_path}  ({human_size(index_path)})")
    print(f"  State:  {state_path}")

    if limit is None:
        print(
            "\n"
            "  *** FULL IMPORT SUCCEEDED — dump files can now be deleted. ***\n"
            f"  The dump directory {input_path}\n"
            "  is no longer needed and can be removed to reclaim ~40 GB:\n"
            f"      rm -rf {input_path}\n"
            "  (Not done automatically — your call.)"
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "input",
        type=Path,
        help=(
            "Path to a single dump file (.json.bz2 or .json.gz) OR a directory"
            " containing *.json.bz2 part files (new format) or *.json.gz (old format)."
        ),
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=WIKIPEDIA_FULL_INDEX_PATH,
        help=f"Output SQLite path (default: {WIKIPEDIA_FULL_INDEX_PATH})",
    )
    parser.add_argument(
        "--state",
        type=Path,
        default=None,
        help="State file path (default: <index-stem>.import_state.json)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Stop after N accepted articles — for trial runs",
    )
    parser.add_argument(
        "--skip",
        type=int,
        default=0,
        metavar="N",
        help=(
            "Skip first N raw document pairs from the start of the stream."
            " Overrides the state file.  Intended for single-file inputs or"
            " manual recovery; for directory inputs, re-running without --skip"
            " auto-resumes via the state file."
        ),
    )
    parser.add_argument(
        "--max-article-chars",
        type=int,
        default=DEFAULT_MAX_ARTICLE_CHARS,
        metavar="N",
        help=(
            f"Truncate article text to N chars before chunking"
            f" (default: {DEFAULT_MAX_ARTICLE_CHARS})"
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        metavar="N",
        help=f"Commit every N accepted articles (default: {DEFAULT_BATCH_SIZE})",
    )
    args = parser.parse_args()

    index_path: Path = args.index
    state_path: Path = (
        args.state
        or index_path.parent / (index_path.stem + ".import_state.json")
    )

    # Auto-resume from state file unless --skip is explicitly given
    effective_skip = args.skip
    if not args.skip:
        state = load_state(state_path)
        if state.get("fts_built"):
            arts = state.get("articles_imported", "?")
            chunks = state.get("chunks_imported", "?")
            print(f"State file shows a completed import ({arts:,} articles, {chunks:,} chunks).")
            print(
                "To re-import from scratch, delete the state file and the index:\n"
                f"  rm {state_path} {index_path}"
            )
            sys.exit(0)
        resume_file_idx = state.get("resume_file_index", 0)
        resume_pairs = state.get("resume_pairs_in_file", 0)
        if resume_file_idx or resume_pairs:
            arts = state.get("articles_imported", 0)
            print(
                f"Resuming: {arts:,} articles already imported."
                f"  Will skip to file {resume_file_idx}, pair {resume_pairs}."
            )
        # effective_skip stays 0; run_import reads state directly

    run_import(
        input_path=args.input,
        index_path=index_path,
        state_path=state_path,
        skip=effective_skip,
        limit=args.limit,
        max_article_chars=args.max_article_chars,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
