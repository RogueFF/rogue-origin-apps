#!/usr/bin/env node
/**
 * PDF Visual QA Pipeline - Generate & Screenshot
 * 
 * Loads the SOP manager, calls buildPDFHTML() to get the rendered HTML,
 * then uses puppeteer's page.pdf() to generate a PDF and screenshots.
 * 
 * VISUAL CHECKLIST:
 * - No overflow (text clipping into footer)
 * - No orphan pages (1 step alone with 80%+ whitespace)
 * - QR codes present where refs exist
 * - Bilingual text renders when present
 * - Header/footer on every page
 * - No gold/amber decorative lines
 */

const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const CHROMIUM = '/usr/bin/chromium-browser';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8765';
const FIXTURE_PATH = path.resolve(__dirname, 'fixture-sop.json');
const OUTPUT_DIR = path.resolve(__dirname, 'output');

async function generatePDF() {
  console.log('\n🚀 PDF Visual QA Pipeline Starting...\n');
  
  // Load fixture
  console.log('📄 Loading test fixture:', FIXTURE_PATH);
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  console.log('   ✓ Loaded SOP:', fixture.title_en || fixture.title);
  console.log('   ✓ Steps:', fixture.steps.length, '\n');
  
  // Ensure output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-software-rasterizer']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Navigate to SOP manager
    console.log('📖 Loading SOP Manager page...');
    await page.goto(`${SERVER_URL}/src/pages/sop-manager.html`, { 
      waitUntil: 'networkidle0', 
      timeout: 30000 
    });
    console.log('   ✓ Page loaded\n');
    
    // Inject fixture and call buildPDFHTML to get the rendered HTML
    console.log('⚙️  Building PDF HTML via buildPDFHTML()...');
    
    let pdfHtml = await page.evaluate(async (fixtureData) => {
      // Set up globals — include dummy linked SOPs so ref QR codes generate
      const dummyRefs = [];
      for (const step of fixtureData.steps) {
        for (const ref of (step.refs || [])) {
          if (!dummyRefs.find(d => d.id === ref.sopId)) {
            dummyRefs.push({
              id: ref.sopId,
              title: ref.title || 'Referenced SOP',
              title_en: ref.title || 'Referenced SOP',
              docNum: ref.sopId.toUpperCase(),
              steps: []
            });
          }
        }
      }
      // sops is declared with `let` in script scope — must assign directly, not window.sops
      sops = [fixtureData, ...dummyRefs];
      window.sops = sops; // also set on window for any code that checks there
      currentSopId = fixtureData.id;
      
      const sop = fixtureData;
      const options = {
        lang: 'en',
        includeQR: true,
        includeImages: true,
        includeRelated: true,
        bilingual: true,
      };
      
      // Fetch assets (logo, QR codes, images)
      let assets = {};
      try {
        if (typeof fetchPDFAssets === 'function') {
          assets = await fetchPDFAssets(sop, options);
        }
      } catch(e) {
        console.warn('fetchPDFAssets failed, continuing without assets:', e.message);
        assets = { logo: null, qrCodes: {}, images: {} };
      }
      
      // Build the HTML
      const html = buildPDFHTML(sop, assets, options);
      
      // Debug info
      const debug = {
        refQRs: assets.refQRs || {},
        sopsCount: window.sops.length,
        getSopByIdRef001: !!getSopById('ref-001'),
        refQRKeys: Object.keys(assets.refQRs || {}),
      };
      
      return { html, debug };
    }, fixture);
    
    const debug = pdfHtml.debug;
    pdfHtml = pdfHtml.html;
    console.log('   ✓ HTML built (' + (pdfHtml.length / 1024).toFixed(1) + ' KB)');
    console.log('   Ref QR keys:', debug.refQRKeys.length ? debug.refQRKeys.join(', ') : 'none');
    console.log('');
    
    // Open a new page with the PDF HTML and render to PDF
    console.log('📥 Rendering PDF...');
    const pdfPage = await browser.newPage();
    await pdfPage.setContent(pdfHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Wait for fonts to load
    await pdfPage.evaluate(() => {
      return document.fonts.ready;
    });
    await new Promise(r => setTimeout(r, 1000)); // settle time
    
    // Generate PDF - landscape A4
    const pdfBuffer = await pdfPage.pdf({
      width: '297mm',
      height: '210mm',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    
    const pdfPath = path.join(OUTPUT_DIR, 'SOP-QA-TEST-001.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    console.log('   ✓ PDF saved:', pdfPath, `(${(pdfBuffer.length / 1024).toFixed(1)} KB)\n`);
    
    // Get page count
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    console.log(`🖼️  Converting ${pageCount} pages to PNG screenshots...\n`);
    
    // Render each page by re-opening the PDF HTML and using page breaks
    // Simpler approach: screenshot the full HTML content directly per page
    const renderPage = await browser.newPage();
    // Landscape A4 at 2x for crisp screenshots
    await renderPage.setViewport({ width: 1123, height: 794 });
    
    // Load the PDF HTML into a page and screenshot each "page" section
    await renderPage.setContent(pdfHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    await renderPage.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 500));
    
    // Screenshot the full rendered content
    const fullPath = path.join(OUTPUT_DIR, 'full-render.png');
    await renderPage.screenshot({ path: fullPath, fullPage: true });
    console.log(`   Full render: ${fullPath} (${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB)`);
    
    // Also screenshot individual viewport-sized chunks (approximate pages)
    const bodyHeight = await renderPage.evaluate(() => document.body.scrollHeight);
    const pageHeight = 794; // A4 landscape height in px
    const totalPages = Math.ceil(bodyHeight / pageHeight);
    
    for (let i = 0; i < totalPages; i++) {
      const pageNum = i + 1;
      process.stdout.write(`   Page ${pageNum}/${totalPages}... `);
      
      const ssPath = path.join(OUTPUT_DIR, `page-${pageNum}.png`);
      await renderPage.screenshot({
        path: ssPath,
        clip: { x: 0, y: i * pageHeight, width: 1123, height: Math.min(pageHeight, bodyHeight - i * pageHeight) }
      });
      
      const ssSize = (fs.statSync(ssPath).size / 1024).toFixed(1);
      console.log(`✓ (${ssSize} KB)`);
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════');
    console.log('  📊 Summary');
    console.log('═══════════════════════════════════════════');
    console.log(`  PDF:   ${pdfPath}`);
    console.log(`  PDF Pages: ${pageCount}`);
    console.log(`  Rendered Pages: ${totalPages}`);
    console.log(`  Size:  ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
    console.log('  Screenshots:');
    for (let i = 1; i <= totalPages; i++) {
      const p = path.join(OUTPUT_DIR, `page-${i}.png`);
      console.log(`    page-${i}.png (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
    }
    console.log('═══════════════════════════════════════════\n');
    
    console.log('🔍 VISUAL QA CHECKLIST:');
    console.log('  □ No overflow (text clipping into footer)');
    console.log('  □ No orphan pages (1 step with 80%+ whitespace)');
    console.log('  □ QR codes present where refs exist');
    console.log('  □ Bilingual text renders when present');
    console.log('  □ Header/footer on every page');
    console.log('  □ No gold/amber decorative lines');
    console.log('');
    
  } finally {
    await browser.close();
  }
}

generatePDF().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
