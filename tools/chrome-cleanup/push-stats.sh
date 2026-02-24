#!/usr/bin/env bash
# Push chrome cleanup stats to Mission Control API
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATS_FILE="${SCRIPT_DIR}/stats.json"
MC_API="${MC_API_URL:-https://mission-control-api.roguefamilyfarms.workers.dev}"

if [[ ! -f "$STATS_FILE" ]]; then
  echo "No stats.json found — skipping push"
  exit 0
fi

curl -sf -X POST "${MC_API}/api/chrome-status" \
  -H "Content-Type: application/json" \
  -d @"$STATS_FILE" --max-time 10 2>/dev/null && \
  echo "Stats pushed to MC API" || \
  echo "Failed to push stats (non-critical)"
