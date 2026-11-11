/**
 * Practice / demo mode (Koa 2026-11-11: "build our side out using mock data from
 * the last 90 days ... leave the scheduling for him for now").
 *
 * ISOLATION: a separate D1 database, bound as DEMO_DB (rogue-origin-demo). Pages
 * opened with ?demo=1 call /api/demo/production; the Worker runs the very same
 * production handlers with DB swapped for DEMO_DB. So mock rows can never land in
 * a table the dashboard, scoreboard, hourly log or Shopify sync reads: those all
 * read env.DB, the live database, which a demo request never sees. No demo flags
 * leak into live queries, and the demo exercises the real code, not a copy.
 *
 * A demo request also gets: no Shopify (no SHOPIFY_* secrets), no Telegram, our
 * stand-in auto-assign ON, and only the floor actions in DEMO_ACTIONS.
 */
export const DEMO_ACTIONS = new Set([
  // the floor screens
  'scaleWeight', 'setCellState', 'scaleMark', 'cellBoard', 'collectPickup', 'getCultivars',
  'cellQueue', 'orderQueue', 'orderSync', 'orderAction', 'jobDone',
  // the practice driver (handlers/production/demo.js)
  'demoLoad', 'demoTick', 'demoControl', 'demoState', 'demoFulfill',
]);

const STRIP = /^(SHOPIFY_|TELEGRAM_|TWILIO_|POOL_INVENTORY_|ANTHROPIC_|GOOGLE_|MAIL_|GMAIL_|HARVEST_|JD_)/;

export const DEMO_MARKER = 'rogue-origin-demo';
let verified = null;   // the DEMO_DB already checked in this isolate

/**
 * Is DEMO_DB really the practice database? Its schema (migrations-demo/demo-schema.sql)
 * writes a marker row; the live database has none. So a binding pasted with the wrong
 * id makes demo mode "not set up", never mock rows in live tables.
 */
export async function verifyDemoDb(db) {
  if (!db) return false;
  if (verified === db) return true;
  try {
    const r = await db.prepare(`SELECT value FROM demo_state WHERE key = 'database'`).first();
    if (r && r.value === DEMO_MARKER) { verified = db; return true; }
  } catch { /* no demo_state table: not the practice database */ }
  return false;
}

/** The env a demo request runs with, or null when DEMO_DB isn't bound. */
export function demoEnv(env) {
  if (!env || !env.DEMO_DB) return null;
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!STRIP.test(k) && k !== 'DB' && k !== 'MEDIA_BUCKET') out[k] = v;
  out.DB = env.DEMO_DB;
  out.DEMO = '1';
  out.ORDER_AUTO_ASSIGN = '1';
  return out;
}
