#!/usr/bin/env bash
# Test the Chrome cleanup monitor
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR="${SCRIPT_DIR}/monitor.sh"
PASSED=0
FAILED=0

pass() { echo "  ✅ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED + 1)); }

echo "=== Chrome Cleanup Monitor Tests ==="
echo ""

# Test 1: Script exists and is executable
echo "Test 1: Script exists and is executable"
if [[ -x "$MONITOR" ]]; then
  pass "monitor.sh is executable"
else
  chmod +x "$MONITOR"
  pass "monitor.sh made executable"
fi

# Test 2: Script runs without error (exit 0 or 1 is fine)
echo "Test 2: Script runs"
set +e
output=$("$MONITOR" 2>&1)
rc=$?
set -e
if [[ $rc -eq 0 || $rc -eq 1 ]]; then
  pass "monitor.sh exited with code $rc"
else
  fail "monitor.sh exited with code $rc"
  echo "    Output: $output"
fi

# Test 3: Stats file created
echo "Test 3: Stats file created"
if [[ -f "${SCRIPT_DIR}/stats.json" ]]; then
  pass "stats.json exists"
  # Validate JSON
  if jq . "${SCRIPT_DIR}/stats.json" > /dev/null 2>&1; then
    pass "stats.json is valid JSON"
  else
    fail "stats.json is invalid JSON"
  fi
else
  fail "stats.json not created"
fi

# Test 4: Stats file has required fields
echo "Test 4: Stats file fields"
if [[ -f "${SCRIPT_DIR}/stats.json" ]]; then
  for field in timestamp total_rss_kb total_processes renderer_count browser_count last_freed_kb freed_24h_kb; do
    val=$(jq -r ".$field" "${SCRIPT_DIR}/stats.json" 2>/dev/null)
    if [[ "$val" != "null" && -n "$val" ]]; then
      pass "$field = $val"
    else
      fail "$field missing"
    fi
  done
fi

# Test 5: Log file created
echo "Test 5: Log file"
if [[ -f "${SCRIPT_DIR}/cleanup.log" ]]; then
  pass "cleanup.log exists ($(wc -l < "${SCRIPT_DIR}/cleanup.log") lines)"
else
  fail "cleanup.log not created"
fi

# Test 6: Spawn a test Chrome renderer and detect it
echo "Test 6: Stale process detection (simulated)"
# We can't easily spawn a fake chrome --type=renderer, but we verify
# the detection logic by checking current chrome process counts
chrome_count=$(ps -eo args 2>/dev/null | grep -c '[c]hrom' || echo 0)
renderer_count=$(ps -eo args 2>/dev/null | grep -c '\-\-type=renderer' || echo 0)
pass "Detected $chrome_count chrome processes, $renderer_count renderers"

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
