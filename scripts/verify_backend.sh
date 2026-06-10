#!/usr/bin/env bash
set -euo pipefail

find_repo_root() {
  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    printf '%s\n' "$git_root"
    return 0
  fi

  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  printf '%s\n' "$(cd -- "$script_dir/.." && pwd)"
}

repo_root=$(find_repo_root)
backend_dir="$repo_root/backend"
python_bin="$backend_dir/.venv/bin/python"

if [[ ! -x "$python_bin" ]]; then
  python_bin=$(command -v python3 || true)
fi

if [[ -z "$python_bin" ]]; then
  echo "FAIL python3 is not available"
  exit 1
fi

tmp_index=$(mktemp /tmp/lucid-wikipedia-test.XXXXXX.sqlite3)
trap 'rm -f "$tmp_index" "$tmp_index-shm" "$tmp_index-wal"' EXIT

run_step() {
  local label=$1
  shift

  printf 'RUN  %s\n' "$label"
  "$@"
  printf 'PASS %s\n' "$label"
}

cd "$backend_dir"

echo "Backend verification"
echo
printf 'Python: %s\n' "$python_bin"
echo

run_step "compile backend files" "$python_bin" -m py_compile \
  main.py \
  wiki_store.py \
  scripts/import_wikipedia_xml.py \
  scripts/build_wikipedia_index.py

run_step "sqlite FTS5 available" "$python_bin" - <<'PY'
import sqlite3

with sqlite3.connect(":memory:") as conn:
    conn.execute("CREATE VIRTUAL TABLE fts_check USING fts5(title, text)")
    conn.execute("INSERT INTO fts_check(title, text) VALUES (?, ?)", ("France", "Paris is the capital"))
    row = conn.execute("SELECT title FROM fts_check WHERE fts_check MATCH ?", ("paris",)).fetchone()
    if row != ("France",):
        raise SystemExit("FTS5 query did not return expected row")
PY

run_step "build Wikipedia seed index in /tmp" env PYTHONPATH="$backend_dir${PYTHONPATH:+:$PYTHONPATH}" \
  "$python_bin" scripts/build_wikipedia_index.py \
  --articles data/wikipedia/articles.json \
  --index "$tmp_index"

echo
echo "Result: backend verification passed"
