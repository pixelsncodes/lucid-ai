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
backend_url=${BACKEND_URL:-http://127.0.0.1:8000}
frontend_url=${FRONTEND_URL:-http://127.0.0.1:5173}
wiki_dir="$repo_root/backend/data/wikipedia"
index_path="$wiki_dir/wikipedia.sqlite3"

print_file_size() {
  local label=$1
  local path=$2

  if [[ -f "$path" ]]; then
    printf '  %-18s %s\n' "$label:" "$(du -h "$path" | awk '{print $1}')"
  else
    printf '  %-18s missing\n' "$label:"
  fi
}

check_url() {
  local url=$1

  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl unavailable'
    return 1
  fi

  if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
    printf 'running'
  else
    printf 'not detected'
  fi
}

print_tts_voice_status() {
  local voices_json=$1

  python3 - "$voices_json" <<'PY'
import json
import sys

try:
    payload = json.loads(sys.argv[1])
except json.JSONDecodeError:
    print("  unavailable")
    raise SystemExit(0)

voices = payload.get("voices")
if not isinstance(voices, list):
    voices = []

available_count = sum(
    1
    for voice in voices
    if isinstance(voice, dict) and voice.get("available") is True
)

print(f"  default:   {payload.get('default_voice_id') or 'unknown'}")
print(f"  available: {available_count}/{len(voices)}")
PY
}

cd "$repo_root"

echo "SCRAP dev status"
echo
printf 'Repo:    %s\n' "$repo_root"
printf 'Branch:  %s\n' "$(git branch --show-current 2>/dev/null || printf 'unknown')"
echo "Git:"
git status --short --branch
echo

backend_status=$(check_url "$backend_url/health")
printf 'Backend:  %s (%s)\n' "$backend_status" "$backend_url"
printf 'Frontend: %s (%s)\n' "$(check_url "$frontend_url")" "$frontend_url"
echo

if [[ "$backend_status" == "running" ]] && command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  voices_json=$(curl -fsS --max-time 2 "$backend_url/tts/voices" 2>/dev/null || true)
  if [[ -n "$voices_json" ]]; then
    echo "TTS voices:"
    print_tts_voice_status "$voices_json"
    echo
  fi
fi

echo "Wikipedia files:"
print_file_size "seed articles" "$wiki_dir/articles.json"
print_file_size "imported corpus" "$wiki_dir/imported-simplewiki-full.json"
print_file_size "sqlite index" "$index_path"
print_file_size "simplewiki dump" "$wiki_dir/dumps/simplewiki-latest-pages-articles.xml.bz2"
echo

echo "Wikipedia index:"
printf '  path:             %s\n' "$index_path"
if [[ ! -f "$index_path" ]]; then
  echo "  status:           missing"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$index_path" <<'PY'
import sqlite3
import sys
from pathlib import Path

index_path = Path(sys.argv[1])
try:
    with sqlite3.connect(index_path) as conn:
        article_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
        chunk_count = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    print("  status:           ready")
    print(f"  articles:         {article_count}")
    print(f"  chunks:           {chunk_count}")
except sqlite3.Error as exc:
    print(f"  status:           unreadable ({exc})")
PY
else
  echo "  status:           present (python3 unavailable, counts skipped)"
fi
