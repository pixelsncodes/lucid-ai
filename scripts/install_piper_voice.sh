#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPER_DIR="${REPO_ROOT}/backend/models/piper"
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"
FORCE=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/install_piper_voice.sh [--force] VOICE_ID

Downloads a Piper .onnx model and matching .onnx.json config into:
  backend/models/piper/

Known voice IDs:
  lessac-medium
  en_US-lessac-medium
  en_US-amy-medium
  en_US-ryan-medium
  en_US-hfc_female-medium
  en_GB-alba-medium

Existing files are not overwritten unless --force is provided.
USAGE
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

download_file() {
  local url="$1"
  local destination="$2"

  if [[ -n "${DOWNLOADER_CURL:-}" ]]; then
    curl --fail --location --show-error --silent --output "$destination" "$url"
  else
    wget --quiet --output-document="$destination" "$url"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      fail "Unknown option: $1"
      ;;
    *)
      if [[ -n "${VOICE_ID:-}" ]]; then
        fail "Only one VOICE_ID may be provided."
      fi
      VOICE_ID="$1"
      shift
      ;;
  esac
done

[[ -n "${VOICE_ID:-}" ]] || {
  usage
  exit 1
}

if command -v curl >/dev/null 2>&1; then
  DOWNLOADER_CURL=1
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER_WGET=1
else
  fail "curl or wget is required."
fi

case "$VOICE_ID" in
  lessac-medium|en_US-lessac-medium)
    FILE_ID="en_US-lessac-medium"
    SOURCE_PATH="en/en_US/lessac/medium"
    ;;
  en_US-amy-medium)
    FILE_ID="en_US-amy-medium"
    SOURCE_PATH="en/en_US/amy/medium"
    ;;
  en_US-ryan-medium)
    FILE_ID="en_US-ryan-medium"
    SOURCE_PATH="en/en_US/ryan/medium"
    ;;
  en_US-hfc_female-medium)
    FILE_ID="en_US-hfc_female-medium"
    SOURCE_PATH="en/en_US/hfc_female/medium"
    ;;
  en_GB-alba-medium)
    FILE_ID="en_GB-alba-medium"
    SOURCE_PATH="en/en_GB/alba/medium"
    ;;
  *)
    fail "Unknown voice ID: ${VOICE_ID}. Run with --help to list supported voices."
    ;;
esac

MODEL_FILE="${FILE_ID}.onnx"
CONFIG_FILE="${FILE_ID}.onnx.json"
MODEL_URL="${BASE_URL}/${SOURCE_PATH}/${MODEL_FILE}"
CONFIG_URL="${BASE_URL}/${SOURCE_PATH}/${CONFIG_FILE}"
MODEL_PATH="${PIPER_DIR}/${MODEL_FILE}"
CONFIG_PATH="${PIPER_DIR}/${CONFIG_FILE}"

mkdir -p "$PIPER_DIR"

if [[ "$FORCE" -ne 1 ]]; then
  [[ ! -e "$MODEL_PATH" ]] || fail "${MODEL_PATH} already exists. Use --force to overwrite."
  [[ ! -e "$CONFIG_PATH" ]] || fail "${CONFIG_PATH} already exists. Use --force to overwrite."
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TMP_MODEL="${TMP_DIR}/${MODEL_FILE}"
TMP_CONFIG="${TMP_DIR}/${CONFIG_FILE}"

echo "Installing Piper voice: ${VOICE_ID}"
echo "Downloading model..."
download_file "$MODEL_URL" "$TMP_MODEL" || fail "Model download failed: ${MODEL_URL}"

echo "Downloading config..."
download_file "$CONFIG_URL" "$TMP_CONFIG" || fail "Config download failed: ${CONFIG_URL}"

[[ -s "$TMP_MODEL" ]] || fail "Downloaded model is missing or empty."
[[ -s "$TMP_CONFIG" ]] || fail "Downloaded config is missing or empty."

mv "$TMP_MODEL" "$MODEL_PATH"
mv "$TMP_CONFIG" "$CONFIG_PATH"

[[ -f "$MODEL_PATH" ]] || fail "Model was not installed: ${MODEL_PATH}"
[[ -f "$CONFIG_PATH" ]] || fail "Config was not installed: ${CONFIG_PATH}"

echo "Piper voice installed successfully."
echo "Model:  ${MODEL_PATH}"
echo "Config: ${CONFIG_PATH}"
