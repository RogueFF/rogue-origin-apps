/**
 * Cell scale watch (Koa 2026-11-09: "rather than an alert on their end, i was
 * thinking something that gets sent to me -- possibly through telegram").
 *
 * Runs on the 5-minute cron. A table scale that posted during today's shift and
 * has been silent for SILENT_MIN minutes gets one Telegram message; when it posts
 * again, one more saying it's back and how long it was down. Nothing is sent
 * outside working hours (Mon–Sat 6:00–4:20 pm Pacific), and a scale that hasn't
 * posted today (switched off, table not in use) is never reported.
 *
 * State lives in scale_stations.down_since (migration 0053): the time of the
 * last post before the outage, set when the alert goes out, cleared when the
 * scale comes back. The node's heartbeat is 30 s, so 3 minutes is six missed
 * heartbeats: a real outage, not a slow post.
 *
 * Chat: TELEGRAM_CELL_ALERT_CHAT_ID (same bot as TELEGRAM_BOT_TOKEN). Unset =
 * nothing is sent and nothing is marked, so it starts working the moment the
 * secret is set.
 */
import { HARVEST_TZ, pacificDay, pacificParts } from './pacific.js';
import { sendTelegramMessage } from './telegram.js';

export const SILENT_MIN = 3;
const SHIFT_FROM_MIN = 6 * 60;
const SHIFT_TO_MIN = 16 * 60 + 20;   // 4:20 pm cleanup: scales get switched off after

const parseUtc = s => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null);
const minutesOfDay = d => { const p = pacificParts(d); return p.hour * 60 + p.minute; };
const weekday = d => d.toLocaleDateString('en-US', { timeZone: HARVEST_TZ, weekday: 'short' });
const clock = d => d.toLocaleTimeString('en-US', { timeZone: HARVEST_TZ, hour: 'numeric', minute: '2-digit' }).toLowerCase();

export function inShift(now) {
  const m = minutesOfDay(now);
  return weekday(now) !== 'Sun' && m >= SHIFT_FROM_MIN && m < SHIFT_TO_MIN;
}

/**
 * Pure decision.
 * @param {Array<{stationId:string,label:string,updatedAt:string|null,weightKg:number|null,downSince:string|null}>} rows
 * @param {Date} now
 * @returns {{down: object[], back: object[]}}
 */
export function scaleWatch(rows, now) {
  const down = [];
  const back = [];
  const today = pacificDay(now);
  const shift = inShift(now);
  for (const r of rows) {
    const last = parseUtc(r.updatedAt);
    const downSince = parseUtc(r.downSince);
    if (downSince !== null) {
      // Reported down: it's back once a post lands after the one we last saw.
      if (last !== null && last > downSince) back.push({ ...r, downMin: Math.max(1, Math.round((last - downSince) / 60000)) });
      continue;
    }
    if (!shift || last === null) continue;
    const lastDate = new Date(last);
    if (pacificDay(lastDate) !== today || minutesOfDay(lastDate) < SHIFT_FROM_MIN) continue;   // not in use today
    const silentMin = (now - last) / 60000;
    if (silentMin >= SILENT_MIN) down.push({ ...r, silentMin: Math.floor(silentMin), lastAt: lastDate });
  }
  return { down, back };
}

export function downText(r) {
  const w = r.weightKg == null ? '' : ` Last weight ${(r.weightKg * 1000).toFixed(2)} g.`;
  return `⚠️ *${r.label}* scale disconnected: no reading since ${clock(r.lastAt)} (${r.silentMin} min).${w}`;
}
export function backText(r) {
  return `✅ *${r.label}* scale back after ${r.downMin} min.`;
}

export async function runScaleWatch(env, now = new Date()) {
  const rows = ((await env.DB.prepare(
    `SELECT s.station_id, COALESCE(c.label, s.label, s.station_id) AS label,
            sr.updated_at, sr.weight, s.down_since
     FROM scale_stations s
     LEFT JOIN scale_readings sr ON sr.station_id = s.station_id
     LEFT JOIN cell_roster c ON c.station_id = s.station_id
     WHERE s.kind = 'table' AND s.active = 1`
  ).all()).results || []).map(r => ({
    stationId: r.station_id, label: r.label, updatedAt: r.updated_at, weightKg: r.weight, downSince: r.down_since,
  }));
  const { down, back } = scaleWatch(rows, now);
  const chatId = env.TELEGRAM_CELL_ALERT_CHAT_ID;
  const sent = { down: [], back: [] };
  for (const r of down) {
    // Marked only once Telegram took it, so an unset chat or a failed send retries next run.
    const ok = await sendTelegramMessage(env, { chatId, text: downText(r) }).catch(e => { console.error('[scale-watch]', e); return false; });
    if (!ok) continue;
    await env.DB.prepare(`UPDATE scale_stations SET down_since = ? WHERE station_id = ?`).bind(r.updatedAt, r.stationId).run();
    sent.down.push(r.stationId);
  }
  for (const r of back) {
    await sendTelegramMessage(env, { chatId, text: backText(r) }).catch(e => { console.error('[scale-watch]', e); return false; });
    await env.DB.prepare(`UPDATE scale_stations SET down_since = NULL WHERE station_id = ?`).bind(r.stationId).run();
    sent.back.push(r.stationId);
  }
  return sent;
}
