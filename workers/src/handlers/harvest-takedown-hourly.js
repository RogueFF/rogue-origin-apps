/**
 * The takedown report, on the hour (?action=bajada).
 *
 * Koa, 2026-10-05: "a digital one they can fill out with their phones. You
 * should be able to capture bags per hour through the supersack tag printer,
 * and they can manually fill out the other columns." It is the phone version
 * of the paper "Bajada por hora" sheet (outputs/sop/takedown-worksheet.pdf in
 * the wiki repo): SAME ROLES, SAME ORDER, SAME WORDS, so a sheet filled in by
 * hand types straight in.
 *
 * TAKEDOWN IS ITS OWN CREW (Koa, same day), so it has its own table rather than
 * sharing harvest_hourly with the hanging crew page, the Capataz bot and the
 * dashboard. Nothing on the tagging path reads this table: a missing migration
 * or a bug here can break this page and nothing else.
 *
 * SACKS ARE NOT TYPED. Every printed tag already stamps a sack, so the sacks per
 * hour (and the lot and bay they came from) are counted from harvest_sacks when
 * the page loads, voided tags left out. There is one answer to "how many sacks
 * at 10 AM" and it is the tags.
 *
 * Same rules as the crew page (harvest-crew-hourly.js): the update merges per
 * field, notes append, the crew carries to the next hour and the sticks never do.
 */
import { query, queryOne, execute } from '../lib/db.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc, parseSqliteUtc } from '../lib/pacific.js';
import { createError } from '../lib/errors.js';

const API = '/api/harvest';

/** The barn day, as on the crew page. */
const FIRST_HOUR = 5;
const LAST_HOUR = 21;

/** The paper sheet's columns, in its order. */
const ROLES = [
  { key: 'takedown', es: 'Bajada', en: 'Takedown', hint: { es: 'bajando racks y embolsando', en: 'racks down, bagging' } },
  { key: 'drivers', es: 'Choferes', en: 'Drivers', hint: { es: 'manejando', en: 'driving' } },
  { key: 'water_spiders', es: 'Water spiders', en: 'Water spiders', hint: { es: 'WS', en: 'WS' } },
  { key: 'weight_checkers', es: 'Pesador', en: 'Weight checker', hint: { es: 'en la báscula', en: 'at the scale' } },
  { key: 'stick_removers', es: 'Quita palos', en: 'Stick remover', hint: { es: 'sacando palos', en: 'pulling sticks' } },
  { key: 'hangers', es: 'Colgadores', en: 'Hangers', hint: { es: 'colgando', en: 'hanging' } },
];

const STICKS = { key: 'sticks_down', es: 'Palos bajados esta hora', en: 'Sticks taken down this hour' };

const COUNT_MAX = 50;
const STICKS_MAX = 600;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isHour = (h) => /^([01]\d|2[0-3]):00$/.test(String(h || ''));
const hh = (n) => `${String(n).padStart(2, '0')}:00`;

/** 'HH:00' → '9-10', the way the crew says an hour. */
const hourSpan = (h) => {
  const n = Number(String(h).slice(0, 2));
  const twelve = (x) => ((x + 11) % 12) + 1;
  return `${twelve(n)}-${twelve(n + 1)}`;
};

function localTime(ts) {
  if (!ts) return null;
  const p = pacificParts(parseSqliteUtc(ts));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** The just-ended hour, except the day's first report, which is the hour they are standing in. */
function defaultHour(now, anyRowsToday) {
  const p = pacificParts(now);
  const ended = justEndedHour(now);
  const hour = (!anyRowsToday || !ended) ? hh(p.hour) : ended.hour_start;
  return hh(Math.min(Math.max(Number(hour.slice(0, 2)), FIRST_HOUR), LAST_HOUR));
}

/** A whole number in range, or null for blank. Anything else is dropped, not guessed. */
function count(v, max) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/**
 * Tags printed on a Pacific day, bucketed by the Pacific hour they printed.
 * The UTC window is a day wide on each side and the day is decided in JS, so
 * DST and the UTC/Pacific date split cannot move a tag into the wrong day.
 * (A sack's own harvest_date is a UTC date, so it is never used here.)
 */
export async function sacksByHour(db, day, isTest) {
  const start = new Date(`${day}T00:00:00Z`);
  const lo = sqliteUtc(new Date(start.getTime() - 86400000));
  const hi = sqliteUtc(new Date(start.getTime() + 2 * 86400000));
  const tags = await query(db, `
    SELECT printed_at, cultivar, zone, cut_number, bay FROM harvest_sacks
    WHERE is_test = ? AND voided_at IS NULL AND printed_at >= ? AND printed_at < ?
    ORDER BY printed_at
  `, [isTest, lo, hi]);

  const byHour = new Map();
  for (const t of tags) {
    const p = pacificParts(parseSqliteUtc(t.printed_at));
    if (p.day !== day) continue;
    const h = hh(p.hour);
    if (!byHour.has(h)) byHour.set(h, { sacks: 0, lots: new Map() });
    const b = byHour.get(h);
    b.sacks += 1;
    const k = `${t.cultivar}|${t.zone}|${t.cut_number}|${t.bay}`;
    if (!b.lots.has(k)) b.lots.set(k, { cultivar: t.cultivar, zone: t.zone, cut: t.cut_number, bay: t.bay, n: 0 });
    b.lots.get(k).n += 1;
  }
  return byHour;
}

export async function loadTakedownHourly(db, env, params, isTest, now = new Date()) {
  const day = pacificDay(now);
  const rows = await query(db, `
    SELECT * FROM harvest_takedown_hourly WHERE harvest_date = ? AND is_test = ? ORDER BY hour_start
  `, [day, isTest]);
  const tags = await sacksByHour(db, day, isTest);

  const answered = rows.filter(r => r.answered_at);
  const hour = isHour(params.hour) ? params.hour : defaultHour(now, answered.length > 0);
  const existing = rows.find(r => r.hour_start === hour) || null;
  // Carry the crew, never the sticks — a pre-filled 30 would be filed as another 30.
  // Each role carries its own latest number: the update merges per field, so an
  // hour where only Bajada was sent must not blank the other five next hour.
  const before = answered.filter(r => r.hour_start < hour);
  const source = before.length ? before : answered;
  const carried = existing || (source.length
    ? Object.fromEntries(ROLES.map(r => [r.key,
        [...source].reverse().map(x => x[r.key]).find(v => v !== null && v !== undefined) ?? null]))
    : null);
  const carriedFrom = !existing && source.length ? source.at(-1).hour_start : null;

  // Every hour that has a report or a tag, in order.
  const keys = [...new Set([...answered.map(r => r.hour_start), ...tags.keys()])].sort();
  const hours = keys.map(h => {
    const t = tags.get(h);
    return {
      hour_start: h,
      row: answered.find(r => r.hour_start === h) || null,
      sacks: t ? t.sacks : 0,
      lots: t ? [...t.lots.values()] : [],
    };
  });

  // Sticks per sack only over hours that have BOTH a stick count and tags. A
  // skipped hour's sacks would otherwise sit under sticks nobody reported, and
  // this is the figure that replaces the working 3 sticks/sack in the outlook.
  const both = hours.filter(h => h.row && h.row.sticks_down !== null && h.row.sticks_down !== undefined && h.sacks > 0);
  const matched = {
    hours: both.length,
    sticks: both.reduce((s, h) => s + Number(h.row.sticks_down), 0),
    sacks: both.reduce((s, h) => s + h.sacks, 0),
  };

  return {
    day, hour, existing, hours, matched,
    first: answered.length === 0,
    prefill: carried,
    carriedFrom,
    totalSacks: hours.reduce((s, h) => s + h.sacks, 0),
    totalSticks: answered.reduce((s, r) => s + (Number(r.sticks_down) || 0), 0),
  };
}

export async function submitTakedownHourly(db, env, body, isTest, now = new Date()) {
  const hour = String(body.hour || '').trim();
  if (!isHour(hour)) {
    throw createError('VALIDATION_ERROR', 'Escoge la hora / Pick the hour.');
  }
  const day = pacificDay(now);
  const stamp = sqliteUtc(now);

  await execute(db, `
    INSERT OR IGNORE INTO harvest_takedown_hourly (season, harvest_date, hour_start, is_test)
    VALUES (?, ?, ?, ?)
  `, [Number(day.slice(0, 4)), day, hour, isTest]);
  const row = await queryOne(db, `
    SELECT * FROM harvest_takedown_hourly WHERE harvest_date = ? AND hour_start = ? AND is_test = ?
  `, [day, hour, isTest]);

  const v = Object.fromEntries(ROLES.map(r => [r.key, count(body[r.key], COUNT_MAX)]));
  const sticks = count(body.sticks_down, STICKS_MAX);
  const note = String(body.notes || '').trim().slice(0, 300) || null;

  await execute(db, `
    UPDATE harvest_takedown_hourly SET
      takedown = COALESCE(?, takedown),
      drivers = COALESCE(?, drivers),
      water_spiders = COALESCE(?, water_spiders),
      weight_checkers = COALESCE(?, weight_checkers),
      stick_removers = COALESCE(?, stick_removers),
      hangers = COALESCE(?, hangers),
      sticks_down = COALESCE(?, sticks_down),
      notes = CASE WHEN ? IS NULL THEN notes WHEN notes IS NULL THEN ? ELSE notes || '; ' || ? END,
      reported_by = ?, answered_at = ?
    WHERE id = ?
  `, [v.takedown, v.drivers, v.water_spiders, v.weight_checkers, v.stick_removers, v.hangers,
      sticks, note, note, note, body.reported_by || 'web', stamp, row.id]);

  return { row: await queryOne(db, 'SELECT * FROM harvest_takedown_hourly WHERE id = ?', [row.id]) };
}

// ─── the page ────────────────────────────────────────────────────────

function stepper(key, label, hint, value, max, big = false) {
  return `
  <label for="${key}">${esc(label)} <span class="hint">${esc(hint)}</span></label>
  <div class="crew-stepper${big ? ' big' : ''}">
    <button type="button" data-field="${key}" data-step="-1" aria-label="−">−</button>
    <input id="${key}" name="${key}" type="number" min="0" max="${max}"
           inputmode="numeric" value="${value === null || value === undefined ? '' : value}">
    <button type="button" data-field="${key}" data-step="1" aria-label="+">+</button>
  </div>`;
}

const dash = (v) => (v === null || v === undefined ? '—' : v);

export function takedownHourlyBody(ui, data, flash = null) {
  const es = ui.lang === 'es';
  const L = (en, sp) => (es ? sp : en);
  const { hour, existing, first, hours } = data;

  const opts = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const v = hh(h);
    opts.push(`<option value="${v}"${v === hour ? ' selected' : ''}>${hourSpan(v)}</option>`);
  }

  // What the tags say for the hour being reported — shown, never typed.
  const cur = hours.find(h => h.hour_start === hour);
  const lotText = (l) => `${esc(l.cultivar || '?')} (${esc(l.zone)}${l.cut ? ` · ${L('cut', 'corte')} ${l.cut}` : ''})${
    l.bay ? ` · ${L('Bay', 'Bahía')} ${l.bay}` : ''}`;
  const tagLine = cur && cur.sacks
    ? `<p class="note">${L('Tags printed this hour', 'Etiquetas impresas esta hora')}: <strong>${cur.sacks}</strong> ${L('sacks', 'bolsas')} — ${
        cur.lots.map(l => `${l.n} · ${lotText(l)}`).join('; ')}. ${L('Counted from the tags, nothing to type.', 'Se cuentan de las etiquetas, no hay que escribirlas.')}</p>`
    : `<p class="note">${L('No tags printed in this hour yet. Sacks are counted from the tags automatically.',
        'Todavía no hay etiquetas en esta hora. Las bolsas se cuentan solas de las etiquetas.')}</p>`;

  const carriedNote = data.carriedFrom ? `<p class="note">${
    L(`Crew carried from ${hourSpan(data.carriedFrom)} — change whatever is different. Sticks always start empty.`,
      `Cuadrilla traída de ${hourSpan(data.carriedFrom)} — cambia lo que sea distinto. Los palos siempre empiezan vacíos.`)
  }</p>` : '';

  const fields = ROLES.map(r => stepper(r.key, es ? r.es : r.en, es ? r.hint.es : r.hint.en,
    data.prefill ? data.prefill[r.key] : null, COUNT_MAX)).join('');

  const per = (h) => {
    const n = h.row ? Number(h.row.takedown) : 0;
    return n > 0 && h.sacks ? String(Math.round((h.sacks / n) * 10) / 10) : '—';
  };

  const log = hours.length ? `
<div class="hourly-wrap"><table class="hourly-log">
  <thead><tr><th>${L('Hour', 'Hora')}</th><th>${L('Takedown', 'Bajada')}</th><th>${L('Sticks', 'Palos')}</th>
    <th>${L('Sacks', 'Bolsas')}</th><th>${L('Sacks / person', 'Bolsas / persona')}</th><th>${L('Lot · bay', 'Lote · bahía')}</th>
    <th>${L('Crew', 'Cuadrilla')}</th><th>${L('Sent', 'Enviado')}</th></tr></thead>
  <tbody>${hours.map(h => `<tr><td><strong>${hourSpan(h.hour_start)}</strong></td><td>${dash(h.row?.takedown)}</td><td class="sticks">${dash(h.row?.sticks_down)}</td><td class="sacks">${h.sacks}</td><td class="per">${per(h)}</td>
    <td style="white-space:normal;min-width:11em">${h.lots.map(l => `${l.n} · ${lotText(l)}`).join('<br>') || '—'}</td>
    <td>${h.row ? ROLES.slice(1).map(r => `${esc(es ? r.es : r.en)}&nbsp;${dash(h.row[r.key])}`).join('<br>') : '—'}</td>
    <td>${esc(localTime(h.row?.answered_at) || '')}${h.row?.notes ? ` <span class="hint">${esc(h.row.notes)}</span>` : ''}</td></tr>`).join('')}</tbody>
</table></div>
<p class="note">${L('Sacks today', 'Bolsas hoy')}: <strong>${data.totalSacks}</strong> · ${L('Sticks today', 'Palos hoy')}: <strong>${data.totalSticks}</strong> · ${L('sticks per sack', 'palos por bolsa')} ${
    data.matched.hours
      ? `<strong>${Math.round((data.matched.sticks / data.matched.sacks) * 10) / 10}</strong> (${data.matched.hours} ${
          data.matched.hours === 1 ? L('hour with sticks', 'hora con palos') : L('hours with sticks', 'horas con palos')})`
      : '—'}</p>`
    : `<p class="note">${L('Nothing yet today. The first report is the morning head count.',
        'Todavía nada hoy. El primer reporte es el conteo de la mañana.')}</p>`;

  return `
<h1>${flash ? `✅ ${esc(flash)}` : L('Hourly takedown report', 'Bajada por hora')}</h1>
<p class="sub">${first
    ? L('First report today — the starting numbers.', 'Primer reporte de hoy — los números de arranque.')
    : L('People by role and sticks taken down, on the hour. Sacks come from the tags.',
        'Personas por puesto y palos bajados, cada hora. Las bolsas salen de las etiquetas.')}</p>

<form method="POST" action="${API}?action=bajada_set&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
  <label for="hour">${L('Which hour?', '¿Cuál hora?')} <span class="hint">${L('pick it first — changing it reloads the form', 'escógela primero — al cambiarla se recarga')}</span></label>
  <select id="hour" name="hour" onchange="location.href='${API}?action=bajada&lang=${ui.lang}&hour='+encodeURIComponent(this.value)">${opts.join('')}</select>
  ${existing && existing.answered_at ? `<p class="note">${L('This hour was already sent at', 'Esta hora ya se envió a las')} ${esc(localTime(existing.answered_at))} — ${L('saving again updates it.', 'al guardar otra vez se actualiza.')}</p>` : ''}

  ${tagLine}
  ${carriedNote}
  <p class="note"><strong>${L('People by role', 'Personas por puesto')}</strong></p>
  ${fields}
  ${stepper(STICKS.key, es ? STICKS.es : STICKS.en, L('only this hour', 'solo de esta hora'),
    existing ? existing.sticks_down : null, STICKS_MAX, true)}

  <label for="notes">${L('Notes', 'Notas')} <span class="hint">${L('only if something happened', 'solo si pasó algo')}</span></label>
  <input id="notes" name="notes" maxlength="200" autocomplete="off">
  <button class="btn" type="submit">${L('Save this hour', 'Guardar esta hora')}</button>
</form>

<h2>${L('Today', 'Hoy')}</h2>
${log}
<div class="footer"><a href="${API}?action=sack_print&lang=${ui.lang}">${L('Print sack tags', 'Imprimir etiquetas')}</a> · <a href="${API}?action=hub&lang=${ui.lang}">${L('All tools', 'Herramientas')}</a></div>
<script>document.querySelectorAll('.crew-stepper button').forEach(function(b){b.addEventListener('click',function(){var i=document.getElementById(b.dataset.field);var max=Number(i.max||50);i.value=Math.max(0,Math.min(max,Number(i.value||0)+Number(b.dataset.step)));});});</script>`;
}
