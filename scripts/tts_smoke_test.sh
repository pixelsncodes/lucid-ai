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
default_voice_id="heart"
kokoro_model_file="models/kokoro/kokoro-v1.0.onnx"
kokoro_voices_file="models/kokoro/voices-v1.0.bin"
failures=0
temp_files=()

cleanup() {
  if ((${#temp_files[@]} > 0)); then
    rm -f "${temp_files[@]}"
  fi
}
trap cleanup EXIT

require_tool() {
  local tool=$1
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
}

make_temp() {
  local path
  path=$(mktemp)
  temp_files+=("$path")
  printf '%s\n' "$path"
}

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1"
  failures=$((failures + 1))
}

check_status() {
  local label=$1
  local actual=$2
  local expected=$3

  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

check_nonempty_file() {
  local label=$1
  local path=$2

  if [[ -s "$path" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

check_header_contains() {
  local label=$1
  local headers_path=$2
  local header_name=$3
  local expected_value=$4

  if python3 - "$headers_path" "$header_name" "$expected_value" <<'PY'
from pathlib import Path
import sys

headers_path = Path(sys.argv[1])
header_name = sys.argv[2].lower()
expected_value = sys.argv[3].lower()

for line in headers_path.read_text(encoding="utf-8", errors="replace").splitlines():
    if ":" not in line:
        continue
    name, value = line.split(":", 1)
    if name.strip().lower() == header_name and expected_value in value.strip().lower():
        raise SystemExit(0)

raise SystemExit(1)
PY
  then
    pass "$label"
  else
    fail "$label"
  fi
}

check_voices_json() {
  local label=$1
  local body_path=$2
  local check=$3
  local require_available=$4
  local expected_default_id=$5

  if python3 - "$body_path" "$check" "$require_available" "$expected_default_id" <<'PY'
import json
from pathlib import Path
import sys

body_path = Path(sys.argv[1])
check = sys.argv[2]
require_available = sys.argv[3] == "true"
expected_default_id = sys.argv[4]

payload = json.loads(body_path.read_text(encoding="utf-8"))
voices = payload.get("voices")

if check == "default_voice_id":
    ok = payload.get("default_voice_id") == expected_default_id
elif check == "has_voice":
    ok = isinstance(voices, list) and len(voices) >= 1
elif check == "has_default":
    ok = isinstance(voices, list) and any(
        isinstance(voice, dict) and voice.get("id") == expected_default_id
        for voice in voices
    )
elif check == "default_available":
    default_voice = next(
        (
            voice
            for voice in voices or []
            if isinstance(voice, dict) and voice.get("id") == expected_default_id
        ),
        None,
    )
    ok = bool(default_voice and default_voice.get("available") is True) if require_available else True
else:
    raise SystemExit(f"unknown check: {check}")

raise SystemExit(0 if ok else 1)
PY
  then
    pass "$label"
  else
    fail "$label"
  fi
}

curl_request() {
  local method=$1
  local url=$2
  local headers_path=$3
  local body_path=$4
  local data=${5:-}

  if [[ "$method" == "GET" ]]; then
    curl -sS --max-time 20 -D "$headers_path" -o "$body_path" -w '%{http_code}' "$url" || true
  else
    curl -sS --max-time 60 \
      -H "Content-Type: application/json" \
      -X "$method" \
      --data "$data" \
      -D "$headers_path" \
      -o "$body_path" \
      -w '%{http_code}' \
      "$url" || true
  fi
}

run_tts_post_check() {
  local label=$1
  local data=$2
  local require_voice_header=$3
  local require_fallback_header=$4

  local headers_path
  local body_path
  local status
  headers_path=$(make_temp)
  body_path=$(make_temp)
  status=$(curl_request POST "$backend_url/tts" "$headers_path" "$body_path" "$data")

  check_status "$label HTTP 200" "$status" "200"
  check_header_contains "$label audio/wav" "$headers_path" "Content-Type" "audio/wav"
  check_nonempty_file "$label non-empty body" "$body_path"

  if [[ "$require_voice_header" == "true" ]]; then
    check_header_contains "$label voice $default_voice_id" "$headers_path" "X-LUCID-TTS-Voice-Id" "$default_voice_id"
  fi

  if [[ "$require_fallback_header" == "true" ]]; then
    check_header_contains "$label fallback true" "$headers_path" "X-LUCID-TTS-Fallback" "true"
  fi
}

require_tool curl
require_tool python3

cd "$repo_root"

echo "TTS smoke test"
echo

if ! curl -fsS --max-time 3 "$backend_url/health" >/dev/null 2>&1; then
  echo "Backend is not running at $backend_url"
  echo "Start it with: cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000"
  exit 1
fi

voice_headers=$(make_temp)
voice_body=$(make_temp)
voice_status=$(curl_request GET "$backend_url/tts/voices" "$voice_headers" "$voice_body")
check_status "/tts/voices HTTP 200" "$voice_status" "200"

if [[ "$voice_status" == "200" ]]; then
  require_default_available=false
  if [[ -f "$repo_root/backend/$kokoro_model_file" && -f "$repo_root/backend/$kokoro_voices_file" ]]; then
    require_default_available=true
  fi

  check_voices_json "/tts/voices default $default_voice_id" "$voice_body" "default_voice_id" false "$default_voice_id"
  check_voices_json "/tts/voices has voices" "$voice_body" "has_voice" false "$default_voice_id"
  check_voices_json "/tts/voices includes $default_voice_id" "$voice_body" "has_default" false "$default_voice_id"
  check_voices_json "/tts/voices $default_voice_id available when kokoro model files exist" "$voice_body" "default_available" "$require_default_available" "$default_voice_id"
else
  fail "/tts/voices response body"
fi

run_tts_post_check \
  "/tts default voice" \
  '{"text":"Lucid TTS smoke test."}' \
  true \
  false

run_tts_post_check \
  "/tts selected voice" \
  '{"text":"Lucid selected voice smoke test.","voice_id":"lessac-medium"}' \
  false \
  false

run_tts_post_check \
  "/tts invalid voice fallback" \
  '{"text":"Lucid fallback voice smoke test.","voice_id":"invalid-test-voice"}' \
  true \
  true

echo
if (( failures > 0 )); then
  printf 'Result: %d failure(s)\n' "$failures"
  exit 1
fi

echo "Result: all checks passed"
