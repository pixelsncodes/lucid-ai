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
unknown_answer="I don't know from the selected Wikipedia knowledgebase."
failures=0

require_tool() {
  local tool=$1
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool"
    exit 1
  fi
}

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1"
  failures=$((failures + 1))
}

curl_json() {
  local method=$1
  local url=$2
  local data=${3:-}

  if [[ "$method" == "GET" ]]; then
    curl -fsS --max-time 20 "$url"
  else
    curl -fsS --max-time 60 \
      -H "Content-Type: application/json" \
      -X "$method" \
      --data "$data" \
      "$url"
  fi
}

run_json_check() {
  local label=$1
  local json=$2
  local check=$3

  if JSON_PAYLOAD="$json" python3 - "$check" "$unknown_answer" <<'PY'
import json
import os
import sys

check = sys.argv[1]
unknown_answer = sys.argv[2]
payload = json.loads(os.environ["JSON_PAYLOAD"])

def text_contains_paris(value):
    return "paris" in json.dumps(value, ensure_ascii=False).lower()

if check == "rag_france":
    results = payload.get("results")
    ok = isinstance(results, list) and bool(results) and text_contains_paris(results)
elif check == "rag_atlantis":
    results = payload.get("results")
    ok = isinstance(results, list) and len(results) == 0
elif check == "rag_michael_jackson":
    results = payload.get("results")
    ok = (
        isinstance(results, list)
        and bool(results)
        and results[0].get("title") == "Michael Jackson"
        and "singer" in results[0].get("text", "").lower()
    )
elif check == "chat_france":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    ok = isinstance(reply, str) and "paris" in reply.lower() and isinstance(sources, list) and bool(sources)
elif check == "chat_canada":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    ok = (
        isinstance(reply, str)
        and "ottawa" in reply.lower()
        and unknown_answer not in reply
        and "Title:" not in reply
        and isinstance(sources, list)
        and bool(sources)
    )
elif check == "chat_michael_jackson_awards":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    source_text = json.dumps(sources, ensure_ascii=False).lower()
    ok = (
        isinstance(reply, str)
        and "award" in reply.lower()
        and "michael-jackson" in source_text
        and unknown_answer not in reply
        and isinstance(sources, list)
        and bool(sources)
    )
elif check == "chat_michael_jackson_death_followup":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    source_text = json.dumps(sources, ensure_ascii=False).lower()
    ok = (
        isinstance(reply, str)
        and "june 25, 2009" in reply.lower()
        and "michael-jackson" in source_text
        and unknown_answer not in reply
        and isinstance(sources, list)
        and bool(sources)
    )
elif check == "chat_tool_other_bands_followup":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    source_text = json.dumps(sources, ensure_ascii=False).lower()
    lowered_reply = reply.lower()
    ok = (
        isinstance(reply, str)
        and ("a perfect circle" in lowered_reply or "puscifer" in lowered_reply)
        and "maynard-james-keenan" in source_text
        and unknown_answer not in reply
        and isinstance(sources, list)
        and bool(sources)
    )
elif check == "chat_canada_after_michael_jackson":
    reply = payload.get("reply", "")
    sources = payload.get("sources")
    source_text = json.dumps(sources, ensure_ascii=False).lower()
    ok = (
        isinstance(reply, str)
        and "ottawa" in reply.lower()
        and "michael-jackson" not in source_text
        and unknown_answer not in reply
        and isinstance(sources, list)
        and bool(sources)
    )
elif check == "chat_atlantis":
    reply = payload.get("reply", "")
    ok = reply == unknown_answer
    if "sources" in payload:
        ok = ok and payload["sources"] == []
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

require_tool curl
require_tool python3

cd "$repo_root"

echo "Wikipedia smoke test"
echo

if ! curl -fsS --max-time 3 "$backend_url/health" >/dev/null 2>&1; then
  echo "Backend is not running at $backend_url"
  echo "Start it with: cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000"
  exit 1
fi

rag_france=$(curl_json GET "$backend_url/rag/search?q=capital%20of%20France&limit=3" || true)
if [[ -n "$rag_france" ]]; then
  run_json_check "/rag/search France mentions Paris" "$rag_france" "rag_france"
else
  fail "/rag/search France request"
fi

rag_atlantis=$(curl_json GET "$backend_url/rag/search?q=capital%20of%20Atlantis&limit=3" || true)
if [[ -n "$rag_atlantis" ]]; then
  run_json_check "/rag/search Atlantis returns no results" "$rag_atlantis" "rag_atlantis"
else
  fail "/rag/search Atlantis request"
fi

rag_michael_jackson=$(curl_json GET "$backend_url/rag/search?q=What%20can%20you%20tell%20me%20about%20Michael%20Jackson%3F&limit=3" || true)
if [[ -n "$rag_michael_jackson" ]]; then
  run_json_check "/rag/search Michael Jackson returns article intro" "$rag_michael_jackson" "rag_michael_jackson"
else
  fail "/rag/search Michael Jackson request"
fi

chat_france_body='{"message":"What is the capital of France?","knowledge_base":"wikipedia"}'
chat_france=$(curl_json POST "$backend_url/chat" "$chat_france_body" || true)
if [[ -n "$chat_france" ]]; then
  run_json_check "/chat Wikipedia France mentions Paris" "$chat_france" "chat_france"
else
  fail "/chat Wikipedia France request"
fi

chat_canada_body='{"message":"What is the capital of Canada?","knowledge_base":"wikipedia"}'
chat_canada=$(curl_json POST "$backend_url/chat" "$chat_canada_body" || true)
if [[ -n "$chat_canada" ]]; then
  run_json_check "/chat Wikipedia Canada mentions Ottawa" "$chat_canada" "chat_canada"
else
  fail "/chat Wikipedia Canada request"
fi

chat_michael_jackson_awards_body='{"message":"How many awards did he win?","knowledge_base":"wikipedia","history":[{"role":"user","content":"Tell me about Michael Jackson."},{"role":"assistant","content":"Michael Joseph Jackson was an American singer, songwriter, dancer, and philanthropist.","source_titles":["Michael Jackson"]}]}'
chat_michael_jackson_awards=$(curl_json POST "$backend_url/chat" "$chat_michael_jackson_awards_body" || true)
if [[ -n "$chat_michael_jackson_awards" ]]; then
  run_json_check "/chat Wikipedia Michael Jackson awards follow-up" "$chat_michael_jackson_awards" "chat_michael_jackson_awards"
else
  fail "/chat Wikipedia Michael Jackson awards follow-up request"
fi

chat_michael_jackson_death_body='{"message":"When did he die?","knowledge_base":"wikipedia","history":[{"role":"user","content":"Tell me about Michael Jackson."},{"role":"assistant","content":"Michael Joseph Jackson was an American singer, songwriter, dancer, and philanthropist.","source_titles":["Michael Jackson"]},{"role":"user","content":"How many awards did he win?"},{"role":"assistant","content":"The selected Wikipedia article does not give one single total, but it says Jackson has many awards and lists 13 Grammy Awards, 6 Brit Awards, 5 Billboard Music Awards and 24 American Music Awards.","source_titles":["List of awards and nominations received by Michael Jackson"]}]}'
chat_michael_jackson_death=$(curl_json POST "$backend_url/chat" "$chat_michael_jackson_death_body" || true)
if [[ -n "$chat_michael_jackson_death" ]]; then
  run_json_check "/chat Wikipedia Michael Jackson death follow-up" "$chat_michael_jackson_death" "chat_michael_jackson_death_followup"
else
  fail "/chat Wikipedia Michael Jackson death follow-up request"
fi

chat_tool_other_bands_body='{"message":"Does he work with any other bands?","knowledge_base":"wikipedia","history":[{"role":"user","content":"Who is the singer of the band Tool?"},{"role":"assistant","content":"Maynard James Keenan is the singer of Tool.","source_titles":["Tool (band)","Kansas","Tool (band)"]}]}'
chat_tool_other_bands=$(curl_json POST "$backend_url/chat" "$chat_tool_other_bands_body" || true)
if [[ -n "$chat_tool_other_bands" ]]; then
  run_json_check "/chat Wikipedia Tool singer other bands follow-up" "$chat_tool_other_bands" "chat_tool_other_bands_followup"
else
  fail "/chat Wikipedia Tool singer other bands follow-up request"
fi

chat_canada_after_michael_jackson_body='{"message":"What is the capital of Canada?","knowledge_base":"wikipedia","history":[{"role":"user","content":"Tell me about Michael Jackson."},{"role":"assistant","content":"Michael Joseph Jackson was an American singer, songwriter, dancer, and philanthropist.","source_titles":["Michael Jackson"]}]}'
chat_canada_after_michael_jackson=$(curl_json POST "$backend_url/chat" "$chat_canada_after_michael_jackson_body" || true)
if [[ -n "$chat_canada_after_michael_jackson" ]]; then
  run_json_check "/chat Wikipedia Canada after Michael Jackson stays standalone" "$chat_canada_after_michael_jackson" "chat_canada_after_michael_jackson"
else
  fail "/chat Wikipedia Canada after Michael Jackson request"
fi

chat_atlantis_body='{"message":"What is the capital of Atlantis?","knowledge_base":"wikipedia"}'
chat_atlantis=$(curl_json POST "$backend_url/chat" "$chat_atlantis_body" || true)
if [[ -n "$chat_atlantis" ]]; then
  run_json_check "/chat Wikipedia Atlantis unknown answer" "$chat_atlantis" "chat_atlantis"
else
  fail "/chat Wikipedia Atlantis request"
fi

chat_atlantis_after_tool_body='{"message":"What is the capital of Atlantis?","knowledge_base":"wikipedia","history":[{"role":"user","content":"Tell me about Tool."},{"role":"assistant","content":"Tool is an American rock band.","source_titles":["Tool (band)"]}]}'
chat_atlantis_after_tool=$(curl_json POST "$backend_url/chat" "$chat_atlantis_after_tool_body" || true)
if [[ -n "$chat_atlantis_after_tool" ]]; then
  run_json_check "/chat Wikipedia Atlantis after Tool unknown answer" "$chat_atlantis_after_tool" "chat_atlantis"
else
  fail "/chat Wikipedia Atlantis after Tool request"
fi

echo
if (( failures > 0 )); then
  printf 'Result: %d failure(s)\n' "$failures"
  exit 1
fi

echo "Result: all checks passed"
