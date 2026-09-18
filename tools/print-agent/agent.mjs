#!/usr/bin/env node
/**
 * Harvest print agent — runs on the barn PC, drains the print queue.
 *
 * WHY THIS EXISTS
 * Tag printing used to be `window.print()` in the crew's browser. That needs a
 * print dialog, a paper size and a margins setting. Chrome on the barn PC has
 * all three; iOS has none of them — WebKit ignores `@page`, so an iPhone cannot
 * print the edge-to-edge 4x2 tag at all. The crew runs a mixed iPhone/Android
 * fleet, so iOS is the case that has to work.
 *
 * So the phone stopped printing. It asks the server to print; the server queues
 * a job; this drains the queue and drives the printer. The phone only ever
 * makes a web request, which every handset does identically.
 *
 * Design + the options rejected (AirPrint, Zebra Weblink):
 *   wiki/operations/plans/2026-09-18-wireless-tag-printer.md
 *
 * RUN
 *   node agent.mjs
 * Configured by environment (see README.md):
 *   HARVEST_API           https://rogue-origin-api.roguefamilyfarms.workers.dev
 *   HARVEST_PRINT_TOKEN   shared secret, matches the Worker's
 *   HARVEST_PRINTER       exact Windows queue name, e.g. "Rollo X1040"
 *   HARVEST_PRINT_DPI     203 (default)
 *   HARVEST_AGENT_ID      barn-pc (default)
 */

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelUrl, tagRender, nextBackoff } from './lib.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const API = process.env.HARVEST_API || 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
const TOKEN = process.env.HARVEST_PRINT_TOKEN || '';
const PRINTER = process.env.HARVEST_PRINTER || '';
const DPI = parseInt(process.env.HARVEST_PRINT_DPI || '203', 10);
const AGENT_ID = process.env.HARVEST_AGENT_ID || 'barn-pc';

/** Quiet poll. Fast enough that the crew never notices; light on the Worker. */
const POLL_MS = 1500;

if (!TOKEN) die('HARVEST_PRINT_TOKEN is not set.');
if (!PRINTER) die('HARVEST_PRINTER is not set (exact Windows queue name).');

function die(msg) {
  console.error(`[print-agent] ${msg}`);
  process.exit(1);
}
function log(...a) {
  console.log(`[print-agent ${new Date().toISOString()}]`, ...a);
}

async function api(action, body) {
  const r = await fetch(`${API}/api/harvest?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: TOKEN, agent_id: AGENT_ID, printer: PRINTER }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    throw new Error(data.error?.message || data.error || `HTTP ${r.status}`);
  }
  return data;
}

/**
 * Render one tag at exactly the printer's dot count and print it.
 *
 * The page is the real `sack_label` page — the same one the browser would have
 * printed — so there is never a second tag design to keep in sync.
 */
async function printTag(browser, sackId, workDir, printerName) {
  const r = tagRender(DPI);
  const page = await browser.newPage({
    viewport: { width: r.viewportWidth, height: r.viewportHeight },
    deviceScaleFactor: r.deviceScaleFactor,
  });
  try {
    await page.goto(labelUrl(API, sackId), { waitUntil: 'networkidle', timeout: 30000 });

    // Clip to the label itself: the page also carries a toolbar and (on the
    // examples page) more than one tag. `.label` is one physical tag.
    const label = page.locator('.label').first();
    await label.waitFor({ state: 'visible', timeout: 15000 });

    // The QR is fetched from api.qrserver.com at render time. `networkidle`
    // does NOT mean the image resolved — a 404 or a slow response still
    // screenshots, and the result is a clean-looking tag with a blank square
    // that gets wire-tied to a sack and discovered at scan time, in a barn,
    // weeks later. Fail the job instead: a tag that did not print is
    // recoverable, a tag that printed wrong is not.
    const qrOk = await label.locator('img.qr').first()
      .evaluate(img => img.complete && img.naturalWidth > 0)
      .catch(() => false);
    if (!qrOk) throw new Error('QR image did not load — refusing to print a tag with a blank QR');

    const file = path.join(workDir, `${sackId.replace(/[^\w.-]/g, '_')}.png`);
    await label.screenshot({ path: file, scale: 'device' });

    // System.Drawing is Windows-only and has no Node binding worth the weight,
    // so the print leg is PowerShell. It does a 1:1 blit — see print-image.ps1.
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(HERE, 'print-image.ps1'),
      '-ImagePath', file,
      '-PrinterName', printerName,
      '-PaperWidth', '400', '-PaperHeight', '200',
    ], { timeout: 60000 });
    if (!String(stdout).includes('printed')) {
      throw new Error(`print-image.ps1 did not confirm: ${String(stdout).trim() || '(no output)'}`);
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  log(`starting — api=${API} printer="${PRINTER}" dpi=${DPI} agent=${AGENT_ID}`);
  const browser = await chromium.launch();
  const workDir = await mkdtemp(path.join(tmpdir(), 'harvest-tags-'));
  let failures = 0;
  let stopping = false;
  let lastTarget = PRINTER;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log('stopping…');
    await browser.close().catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      // The pull doubles as the heartbeat: an agent asking for work is alive by
      // definition, so it can never be printing and reading "offline" at once.
      const { jobs, printer } = await api('print_pull', {});
      failures = 0;

      // The farm can point the agent at a different queue without touching this
      // PC — so when the Rollo dies mid-takedown the spare Zebra is one settings
      // line away, not a walk to the barn and a service restart.
      const target = printer || PRINTER;
      if (target !== lastTarget) {
        log(`printing to "${target}"`);
        lastTarget = target;
      }

      for (const job of jobs || []) {
        try {
          await printTag(browser, job.sack_id, workDir, target);
          await api('print_ack', { job_id: job.id, ok: true });
          log(`printed ${job.sack_id} (job ${job.id})`);
        } catch (e) {
          // Ack the FAILURE rather than staying silent. The crew screen is
          // waiting on this: a tag that did not come out must say so, because
          // the serial is already spent and the Shopify count already moved.
          await api('print_ack', { job_id: job.id, ok: false, error: e.message })
            .catch(ackErr => log(`could not report failure for job ${job.id}:`, ackErr.message));
          log(`FAILED ${job.sack_id} (job ${job.id}):`, e.message);
        }
      }

      if (!jobs || jobs.length === 0) await sleep(POLL_MS);
    } catch (e) {
      failures += 1;
      const wait = nextBackoff(failures);
      log(`poll failed (${failures}):`, e.message, `— retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

main().catch(e => die(e.stack || e.message));
