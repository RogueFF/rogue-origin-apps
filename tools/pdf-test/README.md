# PDF Visual QA Pipeline

Automated testing pipeline for Rogue Origin SOP Manager PDF generation. This tool exercises every layout edge case to ensure PDFs render correctly without overflow, orphan pages, or missing elements.

## Overview

The pipeline consists of three components:

1. **Test Fixture** (`fixture-sop.json`) - Comprehensive SOP with 10 steps covering:
   - Very short step (1 line)
   - Very long step (5+ lines)
   - Bilingual EN+ES text
   - Single QR reference code
   - Multiple QR codes (3 refs)
   - Image reference
   - Safety badge + video QR
   - Quality badge + multiple refs
   - Combined safety + quality badges
   - Final verification step

2. **Automation Script** (`generate.js`) - Node.js + Puppeteer automation that:
   - Loads SOP Manager page
   - Injects fixture data
   - Calls `generatePDF()` programmatically
   - Captures generated PDF
   - Converts each page to PNG screenshot

3. **Orchestration Script** (`test-pdf.sh`) - Bash wrapper that:
   - Starts HTTP server
   - Runs automation
   - Cleans up resources
   - Prints summary and checklist

## Usage

### Quick Start

```bash
cd rogue-origin-apps/tools/pdf-test
./test-pdf.sh
```

This will:
1. Check dependencies (Node.js, Chromium, Python3)
2. Install npm packages if needed
3. Start HTTP server on port 8765
4. Generate PDF and screenshots
5. Save output to `tools/pdf-test/output/`

### Manual Steps

If you prefer to run components separately:

```bash
# 1. Start HTTP server
cd rogue-origin-apps
python3 -m http.server 8765

# 2. In another terminal, run generator
cd rogue-origin-apps/tools/pdf-test
npm install
SERVER_URL=http://localhost:8765 node generate.js
```

## Output

Generated files in `output/`:
- `SOP-QA-TEST-001.pdf` - Full PDF document
- `page-1.png` - Screenshot of page 1
- `page-2.png` - Screenshot of page 2
- (etc. for all pages)

## Visual QA Checklist

Review screenshots for:

- [ ] **No overflow** - Text must not clip into footer areas
- [ ] **No orphan pages** - Single step with 80%+ whitespace is wasteful
- [ ] **QR codes present** - Every step with refs should show QR badges
- [ ] **Bilingual text** - Both English and Spanish render with proper styling
- [ ] **Header/footer** - Present on every page with correct page numbers
- [ ] **Safety badges** - Red badge on safety-critical steps
- [ ] **Quality badges** - Gold QC badge on quality checkpoint steps
- [ ] **Video QR codes** - YouTube/video steps show "Scan to Watch" QR
- [ ] **Multi-line wrapping** - Long descriptions wrap without overflow
- [ ] **Reference mentions** - Inline #REF-XXX codes display as styled badges

## Edge Cases Tested

| Step | Edge Case | Expected Behavior |
|------|-----------|-------------------|
| 1 | Very short (1 line) | Minimal height, no whitespace waste |
| 2 | Very long (5+ lines) | Multi-line wrap, no overflow into footer |
| 3 | Bilingual EN+ES | Both languages render, ES in italic |
| 4 | Single QR ref | QR badge appears below step description |
| 5 | Multiple QR refs (3) | Three QR badges in horizontal row |
| 6 | Image reference | Image displays inline without layout break |
| 7 | Safety + video QR | Red badge + video QR on right side |
| 8 | Quality + multi-refs | Gold badge + two QR badges |
| 9 | Safety + quality | Both badges render without conflict |
| 10 | Final QC step | Quality badge, standard layout |

## Configuration

Environment variables:

- `SERVER_PORT` - HTTP server port (default: 8765)
- `SERVER_URL` - Full server URL for generate.js (default: http://localhost:8765)

## Dependencies

- **Node.js** v14+ (v22 recommended)
- **Chromium** at `/usr/bin/chromium-browser`
- **Python3** for HTTP server
- **npm packages**: puppeteer-core, pdf-lib

## Troubleshooting

### Server won't start
- Check if port 8765 is already in use: `lsof -i :8765`
- Change port: `SERVER_PORT=9000 ./test-pdf.sh`

### Chromium not found
- Install: `sudo apt-get install chromium-browser`
- Or set custom path in `generate.js`

### PDF generation fails
- Check browser console in `generate.js` output
- Verify `sop-manager.html` has `generatePDF()` function
- Ensure all required libraries (html2pdf, jspdf) load correctly

### Screenshots are blank
- pdf.js may not be loading - check network in headless mode
- Try increasing wait time in `generate.js` after render

## Design Notes

This pipeline tests the **landscape A4 layout (1123×794px)** with:
- Full header (240px bilingual, 200px single-lang) on page 1
- Compact header (55px) on pages 2+
- Footer (40px) on every page
- Safety margin (30px) to prevent overflow
- Dynamic step card height calculation based on content

The fixture exercises the **buildPDFHTML** function's page-packing algorithm to ensure it correctly:
- Estimates step heights
- Prevents orphan pages
- Handles bilingual text expansion
- Places QR codes without overflow
- Renders badges in correct colors

## License

MIT - Internal tool for Rogue Origin quality assurance.
