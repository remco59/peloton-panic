#!/usr/bin/env bash
# Installs rany2/edge-tts into ./.venv so the server can synthesise commentator voices.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade edge-tts
.venv/bin/edge-tts --version
echo "edge-tts installed in .venv"
