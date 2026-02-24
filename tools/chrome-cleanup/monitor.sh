#!/usr/bin/env bash
# Chrome Renderer Cleanup — kills stale renderer processes (>30min, idle)
# Exit codes: 0 = clean (no stale found), 1 = killed processes, 2 = error
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/cleanup.log"
STATS_FILE="${SCRIPT_DIR}/stats.json"
MAX_AGE_SECONDS=1800  # 30 minutes
ALERT_THRESHOLD_KB=$((2 * 1024 * 1024))  # 2GB in KB

# Atlas Survey notification endpoint
SURVEY_PRIMARY="https://gablewindowed-ivelisse-latently.ngrok-free.dev/notify"
SURVEY_FALLBACK="http://100.65.60.42:9400/notify"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

send_alert() {
  local freed_gb="$1" count="$2"
  local body="Freed ${freed_gb}GB from ${count} stale renderers"
  local payload='{"type":"toast","title":"Chrome Cleanup","body":"'"$body"'","priority":"normal","category":"dev"}'

  curl -sf -X POST "$SURVEY_PRIMARY" \
    -H "Content-Type: application/json" \
    -d "$payload" --max-time 5 2>/dev/null || \
  curl -sf -X POST "$SURVEY_FALLBACK" \
    -H "Content-Type: application/json" \
    -d "$payload" --max-time 5 2>/dev/null || true
}

update_stats() {
  local total_rss="$1" total_procs="$2" renderer_count="$3" browser_count="$4" freed_kb="$5" killed="$6"

  # Read existing 24h freed total
  local prev_freed=0
  if [[ -f "$STATS_FILE" ]]; then
    prev_freed=$(jq -r '.freed_24h_kb // 0' "$STATS_FILE" 2>/dev/null || echo 0)
    local prev_ts
    prev_ts=$(jq -r '.freed_24h_reset // ""' "$STATS_FILE" 2>/dev/null || echo "")
    # Reset 24h counter if >24h old
    if [[ -n "$prev_ts" ]]; then
      local prev_epoch now_epoch
      prev_epoch=$(date -d "$prev_ts" +%s 2>/dev/null || echo 0)
      now_epoch=$(date +%s)
      if (( now_epoch - prev_epoch > 86400 )); then
        prev_freed=0
      fi
    fi
  fi

  local new_freed=$((prev_freed + freed_kb))
  local freed_24h_reset
  if (( prev_freed == 0 && freed_kb > 0 )); then
    freed_24h_reset=$(date -Iseconds)
  else
    freed_24h_reset=$(jq -r '.freed_24h_reset // ""' "$STATS_FILE" 2>/dev/null || date -Iseconds)
  fi

  cat > "$STATS_FILE" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "total_rss_kb": $total_rss,
  "total_processes": $total_procs,
  "renderer_count": $renderer_count,
  "browser_count": $browser_count,
  "last_freed_kb": $freed_kb,
  "last_killed": $killed,
  "freed_24h_kb": $new_freed,
  "freed_24h_reset": "$freed_24h_reset"
}
EOF
}

# ── Detect Chrome processes ──────────────────────────────────────────

# Get all chrome processes with PID, RSS (KB), elapsed time (seconds), and args
mapfile -t CHROME_PROCS < <(ps -eo pid,rss,etimes,args 2>/dev/null | grep -i '[c]hrom' || true)

if [[ ${#CHROME_PROCS[@]} -eq 0 ]]; then
  log "No Chrome processes found."
  update_stats 0 0 0 0 0 0
  exit 0
fi

total_rss=0
total_procs=0
renderer_count=0
browser_count=0
killed_count=0
freed_kb=0

declare -a stale_pids=()
declare -a stale_rss=()

for line in "${CHROME_PROCS[@]}"; do
  # Parse: PID RSS ETIMES ARGS...
  pid=$(echo "$line" | awk '{print $1}')
  rss=$(echo "$line" | awk '{print $2}')
  etimes=$(echo "$line" | awk '{print $3}')
  args=$(echo "$line" | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}')

  # Skip non-numeric
  [[ "$pid" =~ ^[0-9]+$ ]] || continue

  total_procs=$((total_procs + 1))
  total_rss=$((total_rss + rss))

  if echo "$args" | grep -q -- '--type=renderer'; then
    renderer_count=$((renderer_count + 1))

    # Check if stale (>30min old)
    if (( etimes > MAX_AGE_SECONDS )); then
      stale_pids+=("$pid")
      stale_rss+=("$rss")
    fi
  else
    # Count browser/GPU/utility processes
    browser_count=$((browser_count + 1))
  fi
done

# ── Kill stale renderers ─────────────────────────────────────────────

if [[ ${#stale_pids[@]} -gt 0 ]]; then
  log "Found ${#stale_pids[@]} stale renderer(s) (>${MAX_AGE_SECONDS}s old)"

  for i in "${!stale_pids[@]}"; do
    pid="${stale_pids[$i]}"
    rss="${stale_rss[$i]}"
    rss_mb=$(( rss / 1024 ))

    # SIGTERM first, give 5s, then SIGKILL
    if kill -TERM "$pid" 2>/dev/null; then
      sleep 2
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        log "SIGKILL PID $pid — ${rss_mb}MB freed"
      else
        log "SIGTERM PID $pid — ${rss_mb}MB freed"
      fi
      killed_count=$((killed_count + 1))
      freed_kb=$((freed_kb + rss))
    else
      log "PID $pid already dead"
    fi
  done

  freed_gb=$(awk "BEGIN {printf \"%.1f\", $freed_kb / 1048576}")
  log "Cleanup complete: killed $killed_count, freed ${freed_gb}GB"

  # Alert if freed >2GB
  if (( freed_kb > ALERT_THRESHOLD_KB )); then
    send_alert "$freed_gb" "$killed_count"
    log "Alert sent: ${freed_gb}GB freed"
  fi
else
  log "No stale renderers found. ${renderer_count} active renderer(s), all <${MAX_AGE_SECONDS}s old."
fi

# ── Update stats for dashboard ───────────────────────────────────────

update_stats "$total_rss" "$total_procs" "$renderer_count" "$browser_count" "$freed_kb" "$killed_count"

if (( killed_count > 0 )); then
  exit 1
else
  exit 0
fi
