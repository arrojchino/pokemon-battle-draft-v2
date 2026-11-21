#!/usr/bin/env bash
# macOS/Linux equivalent of start-backend.ps1
set -euo pipefail
cd "$(dirname "$0")/../backend"
[ -d node_modules ] || npm install
npm run build
PORT="${PORT:-8787}" ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-http://127.0.0.1:5173}" npm start
