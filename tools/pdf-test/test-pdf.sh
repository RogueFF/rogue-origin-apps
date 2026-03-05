#!/bin/bash
set -e

# PDF Visual QA Test Script
# Orchestrates HTTP server + Puppeteer automation for PDF generation testing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
SERVER_PORT="${SERVER_PORT:-8765}"
SERVER_PID=""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        log_info "Stopping HTTP server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        log_success "Server stopped"
    fi
}

trap cleanup EXIT INT TERM

# Header
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  PDF Visual QA Pipeline"
echo "  Rogue Origin SOP Manager - Layout Edge Case Testing"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check dependencies
log_info "Checking dependencies..."

if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    exit 1
fi
log_success "Node.js: $(node --version)"

if ! command -v chromium-browser &> /dev/null && ! [ -f /usr/bin/chromium-browser ]; then
    log_error "Chromium not found at /usr/bin/chromium-browser"
    exit 1
fi
log_success "Chromium: found"

if ! command -v python3 &> /dev/null; then
    log_error "Python3 is not installed (needed for HTTP server)"
    exit 1
fi
log_success "Python3: $(python3 --version)"

# Check Node modules
log_info "Checking Node.js dependencies..."
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    log_warn "Node modules not found, installing..."
    npm install puppeteer-core pdf-lib
fi
log_success "Node modules ready"

# Prepare output directory
log_info "Preparing output directory..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
log_success "Output dir: $OUTPUT_DIR"

# Start HTTP server
log_info "Starting HTTP server on port $SERVER_PORT..."
cd "$PROJECT_ROOT"

python3 -m http.server $SERVER_PORT &> /dev/null &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

if ! kill -0 $SERVER_PID 2>/dev/null; then
    log_error "Failed to start HTTP server"
    exit 1
fi

# Test server
if ! curl -s "http://localhost:$SERVER_PORT/src/pages/sop-manager.html" > /dev/null; then
    log_error "Server is running but SOP manager page not accessible"
    log_error "Check that sop-manager.html exists at: $PROJECT_ROOT/src/pages/sop-manager.html"
    exit 1
fi

log_success "HTTP server running (PID: $SERVER_PID)"
echo ""

# Run PDF generation
log_info "Running PDF generation script..."
echo ""

cd "$SCRIPT_DIR"
SERVER_URL="http://localhost:$SERVER_PORT" node generate.js

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    log_error "PDF generation failed with exit code $EXIT_CODE"
    exit $EXIT_CODE
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Visual QA Checklist - Manual Review Required"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Review the generated screenshots in:"
echo "  $OUTPUT_DIR"
echo ""
echo "Check for:"
echo "  • No overflow (text clipping into footer)"
echo "  • No orphan pages (1 step alone with 80%+ whitespace)"
echo "  • QR codes present where refs exist"
echo "  • Bilingual text renders when present"
echo "  • Header/footer on every page"
echo "  • No gold/amber decorative lines"
echo "  • Safety badges (red) on safety steps"
echo "  • Quality badges (gold) on QC steps"
echo "  • Multi-line descriptions wrap correctly"
echo "  • Video QR codes appear for YouTube steps"
echo ""

# Generate file listing
log_info "Generated files:"
ls -lh "$OUTPUT_DIR" | tail -n +2 | while read -r line; do
    filename=$(echo "$line" | awk '{print $NF}')
    size=$(echo "$line" | awk '{print $5}')
    echo "  • $filename ($size)"
done

echo ""
log_success "Pipeline complete! Review screenshots for visual QA."
echo ""
