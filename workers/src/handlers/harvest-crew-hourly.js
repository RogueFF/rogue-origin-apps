/**
 * The crew report, on the hour — the page that replaced the roster form.
 *
 * Koa, 2026-09-22: "turn this into an hour by hour format where they can submit
 * updated crew numbers, and also how much sticks were hung. each update should
 * be timestamped. Essentially, in the morning, they will take starting numbers,
 * then update on the hour for every hour."
 *
 * WRITES THE SAME ROWS THE WHATSAPP BOT WOULD. harvest_hourly already had this
 * exact shape — one row per date x hour x barn, the five role counts, racks,
 * notes and timestamps — because it was built for the Capataz bot that never
 * got a live phone on the roster. Nothing new is modelled here: the dashboard's
 * racks-per-hanger-hour, the day rollup and the bot (if it ever wakes up) all
 * keep reading one table. A second table for the same numbers would be a
 * second answer to "how many hangers at 10 AM".
 *
 * WHAT THE OLD ROSTER PAGE DID DIFFERENTLY, and why it goes:
 *   · it kept a chain of periods ("update on change, not on a timer") — the
 *     hour is now the timer, which is what was asked for;
 *   · it refused to record cutters, so the zone scan stayed the single source.
 *     Koa, same day: "It's inputted on zone entry, but it might be good to
 *     cross-reference with this. Every hour they will radio the cutters for a
 *     head count." So cutters ARE asked here, and the open zone sessions are
 *     shown beside the field. The two numbers are allowed to disagree and the
 *     disagreement is displayed rather than resolved: one is a radio call, the
 *     other is who scanned in, and a silent overwrite would lose both.
 *
 * MERGED, NOT OVERWRITTEN. The update is COALESCE per field, the way the bot's
 * path is, so a correction that fills one box cannot blank the other five.
 */
import { query, queryOne, execute } from '../lib/db.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc, parseSqliteUtc } from '../lib/pacific.js';
import { validateCounts, missingFields } from '../lib/harvest-hourly.js';
import { createError } from '../lib/errors.js';

const API = '/api/harvest';
const BARNS = ['upper', 'bottom'];

/** Barn day: nobody is hanging at 4 AM, and an hour list that long is a scroll. */
const FIRST_HOUR = 5;
const LAST_HOUR = 21;

/**
 * Asked in this order because it is the order the crew stands in: the field
 * (cutters, their water spiders, the drivers who carry it) then the barn (the
 * hangers, their water spiders) then what came of it (sticks).
 */
const FIELDS = [
  { key: 'cutters', es: 'Cortadores', en: 'Cutters', short: { es: 'Cort.', en: 'Cutters' }, where: { es: 'por radio', en: 'radio the field' } },
  { key: 'cutter_water_spiders', es: 'Water spiders de campo', en: 'Field water spiders', short: { es: 'WS campo', en: 'WS field' }, where: { es: 'cajas al trailer', en: 'bins to the trailer' } },
  { key: 'drivers', es: 'Choferes', en: 'Drivers', short: { es: 'Chof.', en: 'Drivers' }, where: { es: 'campo ↔ bodega', en: 'field ↔ barn' } },
  { key: 'hangers', es: 'Colgadores', en: 'Hangers', short: { es: 'Colg.', en: 'Hangers' }, where: { es: 'personas colgando', en: 'people hanging' } },
  { key: 'hanging_water_spiders', es: 'Water spiders de bodega', en: 'Barn water spiders', short: { es: 'WS bodega', en: 'WS barn' }, where: { es: 'cajas a los colgadores', en: 'bins to the hangers' } },
];

const RACKS = { key: 'racks', es: 'Palos colgados esta hora', en: 'Sticks hung this hour' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const barnLabel = (barn, es) => barn === 'upper'
  ? (es ? 'Granero Arriba' : 'Upper Barn')
  : (es ? 'Granero Abajo' : 'Bottom Barn');

const isHour = (h) => /^([01]\d|2[0-3]):00$/.test(String(h || ''));

/** 'HH:00' → '9-10', the way the crew says an hour. */
const hourSpan = (h) => {
  const n = Number(String(h).slice(0, 2));
  const twelve = (x) => ((x + 11) % 12) + 1;
  return `${twelve(n)}-${twelve(n + 1)}`;
};

/** A stored UTC stamp as the Pacific wall clock, 'HH:MM'. */
function localTime(ts) {
  if (!ts) return null;
  const p = pacificParts(parseSqliteUtc(ts));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * The hour to offer. The just-ended hour is the answer during the day — at
 * 10:07 they are reporting 9-10 — EXCEPT on the day's first report, which is
 * the morning head count taken as the crew arrives, and belongs to the hour
 * they are standing in rather than the one before they got there.
 */
function defaultHour(now, anyRowsToday) {
  const p = pacificParts(now);
  const ended = justEndedHour(now);
  const hour = (!anyRowsToday || !ended) ? `${String(p.hour).padStart(2, '0')}:00` : ended.hour_start;
  const n = Math.min(Math.max(Number(hour.slice(0, 2)), FIRST_HOUR), LAST_HOUR);
  return `${String(n).padStart(2, '0')}:00`;
}

export async function loadCrewHourly(db, env, params, isTest, now = new Date()) {
  const day = pacificDay(now);
  const rows = await query(db, `
    SELECT * FROM harvest_hourly WHERE harvest_date = ? AND is_test = ? ORDER BY hour_start, barn
  `, [day, isTest]);

  // What the zone scans say right now, to sit beside the radioed cutter count.
  const openZones = await query(db, `
    SELECT zone, cultivar, headcount FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at
  `, [isTest]);

  const answered = rows.filter(r => r.answered_at);
  const lastFor = (b) => [...answered].reverse().find(r => r.barn === b) || null;
  const barn = BARNS.includes(params.barn) ? params.barn : null;
  const hour = isHour(params.hour) ? params.hour : defaultHour(now, answered.length > 0);

  const existing = rows.find(r => r.hour_start === hour && r.barn === barn) || null;
  // Carry the crew forward. The counts rarely move hour to hour, and retyping
  // five numbers every hour is how an hour ends up skipped entirely. STICKS
  // ARE NEVER CARRIED — they are what happened in THIS hour, and a pre-filled
  // 14 would be filed as another 14 by anyone tapping straight through.
  const carried = existing || (barn ? lastFor(barn) : null);

  return {
    day, rows, answered, openZones, barn, hour, existing,
    first: answered.length === 0,
    prefill: carried,
    carriedFrom: !existing && carried ? carried.hour_start : null,
  };
}

/**
 * Save one barn-hour. Barn and hour are asked every time (Koa's call): one
 * person can cover both barns in a shift, and a remembered barn is the kind of
 * wrong that nobody notices until the numbers are already filed.
 */
export async function submitCrewHourly(db, env, body, isTest, now = new Date()) {
  const barn = String(body.barn || '').trim();
  if (!BARNS.includes(barn)) {
    throw createError('VALIDATION_ERROR', 'Escoge el granero / Pick the barn.');
  }
  const hour = String(body.hour || '').trim();
  if (!isHour(hour)) {
    throw createError('VALIDATION_ERROR', 'Escoge la hora / Pick the hour.');
  }

  const day = pacificDay(now);
  const season = Number(day.slice(0, 4));
  const stamp = sqliteUtc(now);

  // OR IGNORE, then re-read: the bot's tick can have created this barn-hour
  // already, and the loser of that race wants the winner's row either way.
  await execute(db, `
    INSERT OR IGNORE INTO harvest_hourly (season, harvest_date, hour_start, barn, status, is_test)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `, [season, day, hour, barn, isTest]);
  const row = await queryOne(db, `
    SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?
  `, [day, hour, barn, isTest]);

  const { values, invalid } = validateCounts(body);
  const note = String(body.notes || '').trim().slice(0, 300) || null;

  // COALESCE per field so a correction that carries one number leaves the rest
  // alone, and notes append rather than replace — same rule as the bot's path.
  await execute(db, `
    UPDATE harvest_hourly SET
      cutters = COALESCE(?, cutters),
      cutter_water_spiders = COALESCE(?, cutter_water_spiders),
      drivers = COALESCE(?, drivers),
      hangers = COALESCE(?, hangers),
      hanging_water_spiders = COALESCE(?, hanging_water_spiders),
      racks = COALESCE(?, racks),
      notes = CASE WHEN ? IS NULL THEN notes WHEN notes IS NULL THEN ? ELSE notes || '; ' || ? END,
      reported_by = ?, answered_at = ?
    WHERE id = ?
  `, [values.cutters, values.cutter_water_spiders, values.drivers, values.hangers,
      values.hanging_water_spiders, values.racks, note, note, note,
      body.reported_by || 'web', stamp, row.id]);

  const fresh = await queryOne(db, `SELECT * FROM harvest_hourly WHERE id = ?`, [row.id]);
  const still = missingFields(fresh);
  // Never backwards: a row the bot already completed stays complete.
  await execute(db, `UPDATE harvest_hourly SET status = ? WHERE id = ? AND status <> 'complete'`,
    [still.length ? 'pending' : 'complete', row.id]);

  return { row: fresh, missing: still, invalid, existed: !!row.answered_at };
}

// ─── the page ────────────────────────────────────────────────────────

function stepper(key, label, hint, value, big = false) {
  return `
  <label for="${key}">${esc(label)} <span class="hint">${esc(hint)}</span></label>
  <div class="crew-stepper${big ? ' big' : ''}">
    <button type="button" data-field="${key}" data-step="-1" aria-label="−">−</button>
    <input id="${key}" name="${key}" type="number" min="0" max="${key === 'racks' ? 200 : 50}"
           inputmode="numeric" value="${value === null || value === undefined ? '' : value}">
    <button type="button" data-field="${key}" data-step="1" aria-label="+">+</button>
  </div>`;
}

export function crewHourlyBody(ui, data, flash = null) {
  const es = ui.lang === 'es';
  const L = (en, sp) => (es ? sp : en);
  const { rows, answered, openZones, barn, hour, existing, first } = data;

  const barnButtons = BARNS.map(b => `
    <a class="btn cvbtn${b === barn ? ' sel' : ''}" aria-pressed="${b === barn}"
       href="${API}?action=crew&lang=${ui.lang}&barn=${b}&hour=${encodeURIComponent(hour)}">${esc(barnLabel(b, es))}</a>`).join('');

  const hours = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const v = `${String(h).padStart(2, '0')}:00`;
    hours.push(`<option value="${v}"${v === hour ? ' selected' : ''}>${hourSpan(v)}</option>`);
  }

  // The cross-reference, not a correction: what scanned in, beside what the
  // radio says. Shown even when it matches, so a match is visible evidence.
  const scanned = openZones.reduce((s, z) => s + (Number(z.headcount) || 0), 0);
  const zoneLine = openZones.length
    ? `<p class="note">${L('Open zones now', 'Zonas abiertas ahora')}: ${
        openZones.map(z => `<strong>${esc(z.zone)}</strong> ${esc(z.cultivar || '?')} ${z.headcount ?? '—'}`).join(' · ')
      } = <strong>${scanned}</strong> ${L('cutters by scan', 'cortadores por escaneo')}</p>`
    : `<p class="note">${L('No zone is open right now — the cutter count here is the only one today.',
        'No hay zona abierta ahora — el conteo de cortadores aquí es el único de hoy.')}</p>`;

  const fields = FIELDS.map(f => stepper(f.key, es ? f.es : f.en, es ? f.where.es : f.where.en,
    data.prefill ? data.prefill[f.key] : null)).join('');

  // A number already in the box reads as fact, so the page says where it came
  // from when it is last hour's crew rather than this hour's answer.
  const carriedNote = data.carriedFrom ? `<p class="note">${
    L(`Crew carried from ${hourSpan(data.carriedFrom)} — change whatever is different. Sticks always start empty.`,
      `Cuadrilla traída de ${hourSpan(data.carriedFrom)} — cambia lo que sea distinto. Los palos siempre empiezan vacíos.`)
  }</p>` : '';

  const log = answered.length ? `
<div class="hourly-wrap"><table class="hourly-log">
  <thead><tr><th>${L('Hour', 'Hora')}</th><th>${L('Sticks', 'Palos')}</th><th>${L('Barn', 'Granero')}</th>
    ${FIELDS.map(f => `<th>${esc(es ? f.short.es : f.short.en)}</th>`).join('')}
    <th>${L('Sent', 'Enviado')}</th></tr></thead>
  <tbody>${answered.map(r => `<tr>
    <td><strong>${hourSpan(r.hour_start)}</strong></td>
    <td class="sticks">${r.racks ?? '—'}</td>
    <td>${esc(es ? (r.barn === 'upper' ? 'Arriba' : 'Abajo') : (r.barn === 'upper' ? 'Upper' : 'Bottom'))}</td>
    ${FIELDS.map(f => `<td>${r[f.key] ?? '—'}</td>`).join('')}
    <td>${esc(localTime(r.answered_at) || '')}${r.notes ? ` <span class="hint">${esc(r.notes)}</span>` : ''}</td>
  </tr>`).join('')}</tbody>
</table></div>
<p class="note">${L('Total sticks today', 'Palos hoy')}: <strong>${answered.reduce((s, r) => s + (Number(r.racks) || 0), 0)}</strong></p>`
    : `<p class="note">${L('No reports yet today. The first one is the morning head count.',
        'Todavía no hay reportes hoy. El primero es el conteo de la mañana.')}</p>`;

  return `
<h1>${flash ? `✅ ${esc(flash)}` : L('Hourly crew report', 'Reporte de cuadrilla por hora')}</h1>
<p class="sub">${first
    ? L('First report today — the starting numbers.', 'Primer reporte de hoy — los números de arranque.')
    : L('Crew numbers and sticks hung, on the hour.', 'Números de la cuadrilla y palos colgados, cada hora.')}</p>

<p class="note">${L('Which barn?', '¿Cuál granero?')}</p>
<div class="cvgrid">${barnButtons}</div>

${barn ? `
<form method="POST" action="${API}?action=crew_set&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
  <input type="hidden" name="barn" value="${barn}">
  <label for="hour">${L('Which hour?', '¿Cuál hora?')}</label>
  <select id="hour" name="hour">${hours.join('')}</select>
  ${existing && existing.answered_at ? `<p class="note">${L('This hour was already sent at', 'Esta hora ya se envió a las')} ${esc(localTime(existing.answered_at))} — ${L('saving again updates it.', 'al guardar otra vez se actualiza.')}</p>` : ''}

  ${zoneLine}
  ${carriedNote}
  ${fields}
  ${stepper(RACKS.key, es ? RACKS.es : RACKS.en, L('one stick = one rack', 'un palo = un rack'),
    existing ? existing.racks : null, true)}

  <label for="notes">${L('Notes', 'Notas')} <span class="hint">${L('only if something happened', 'solo si pasó algo')}</span></label>
  <input id="notes" name="notes" maxlength="200" autocomplete="off">
  <button class="btn" type="submit">${L('Save this hour', 'Guardar esta hora')}</button>
</form>` : `<p class="note">${L('Pick a barn to start.', 'Escoge un granero para empezar.')}</p>`}

<h2>${L('Today', 'Hoy')}</h2>
${log}
<div class="footer"><a href="${API}?action=hub&lang=${ui.lang}">${L('All tools', 'Herramientas')}</a></div>
<script>document.querySelectorAll('.crew-stepper button').forEach(function(b){b.addEventListener('click',function(){var i=document.getElementById(b.dataset.field);var max=Number(i.max||50);i.value=Math.max(0,Math.min(max,Number(i.value||0)+Number(b.dataset.step)));});});</script>`;
}
