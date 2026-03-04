#!/usr/bin/env bash
# wire-reddit cron runner — daily Reddit sentiment scan
# Runs: 5:00 AM PST (before Wire 5:30 AM run)
# Usage: cron.sh [--dry-run] [--skip-scoring] [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE="${LOG_DIR}/cron-$(date +%Y%m%d-%H%M).log"

echo "[${TIMESTAMP}] wire-reddit cron starting" | tee -a "$LOG_FILE"

# Run the scan
node "${SCRIPT_DIR}/scan.js" "$@" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] wire-reddit cron complete — exit code ${EXIT_CODE}" | tee -a "$LOG_FILE"

exit "$EXIT_CODE"
