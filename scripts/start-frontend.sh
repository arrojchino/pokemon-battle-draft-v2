#!/usr/bin/env bash
# macOS/Linux equivalent of start-frontend.ps1
set -euo pipefail
cd "$(dirname "$0")/../frontend"
[ -d node_modules ] || npm install
VITE_BACKEND_URL="${VITE_BACKEND_URL:-ws://127.0.0.1:8787}" npm run dev
