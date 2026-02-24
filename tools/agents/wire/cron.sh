#!/usr/bin/env bash
# Wire cron runner — reads ticker universe from config instead of hardcoded list
# Usage: cron.sh [--dry-run] [--verbose]
#
# Previously: TICKERS="SPY QQQ NVDA TSLA AMD" (5 tickers, hardcoded)
# Now: reads from universe.json (90+ tickers, configurable)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIVERSE_FILE="${SCRIPT_DIR}/universe.json"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"

DRY_RUN=false
VERBOSE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --verbose) VERBOSE=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Load ticker universe from config
# ---------------------------------------------------------------------------
if [[ ! -f "$UNIVERSE_FILE" ]]; then
  echo "[ERROR] Universe file not found: $UNIVERSE_FILE" >&2
  echo "[ERROR] Falling back to legacy hardcoded tickers" >&2
  TICKERS="SPY QQQ NVDA TSLA AMD"
else
  # Read flat ticker array from universe.json using node (jq alternative)
  TICKERS=$(node -e "
    const u = require('${UNIVERSE_FILE}');
    console.log((u.flat || []).join(' '));
  " 2>/dev/null)

  if [[ -z "$TICKERS" ]]; then
    echo "[ERROR] Failed to parse universe.json — falling back to legacy" >&2
    TICKERS="SPY QQQ NVDA TSLA AMD"
  fi
fi

TICKER_COUNT=$(echo "$TICKERS" | wc -w)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if $VERBOSE; then
  echo "[${TIMESTAMP}] Wire cron starting — ${TICKER_COUNT} tickers loaded from universe.json"
fi

# ---------------------------------------------------------------------------
# Run Wire scan
# ---------------------------------------------------------------------------
SCAN_SCRIPT="${SCRIPT_DIR}/scan.js"

if [[ ! -f "$SCAN_SCRIPT" ]]; then
  echo "[WARN] scan.js not found at ${SCAN_SCRIPT} — skipping scan" >&2
  # Still pass tickers to stdin for any downstream consumer
  if $DRY_RUN; then
    echo "[DRY RUN] Would scan ${TICKER_COUNT} tickers: ${TICKERS}"
    exit 0
  fi
  echo "$TICKERS"
  exit 0
fi

if $DRY_RUN; then
  echo "[DRY RUN] Would scan ${TICKER_COUNT} tickers:"
  echo "$TICKERS" | tr ' ' '\n' | head -20
  echo "... (${TICKER_COUNT} total)"
  exit 0
fi

# Pass tickers to scan.js via stdin (scan.js already accepts this)
echo "$TICKERS" | node "$SCAN_SCRIPT" "$@" 2>&1 | tee "${LOG_DIR}/wire-$(date +%Y%m%d-%H%M).log"

EXIT_CODE=${PIPESTATUS[1]:-0}

if $VERBOSE; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Wire cron complete — exit code ${EXIT_CODE}"
fi

exit "$EXIT_CODE"
