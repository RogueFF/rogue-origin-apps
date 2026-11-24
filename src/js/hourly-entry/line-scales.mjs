/**
 * Line trimmer scales on Hourly entry (Koa 2026-11-24, migration 0074). Each
 * trimmer seat's scale measures the tops each person made in each hour
 * (?action=lineScaleHours). Hourly entry shows them beside the typed line tops:
 * a chip on each hour in the day view, and a per-trimmer table in the hour's
 * editor. A per-day switch (off by default: only some seats have scales) lets
 * the scales fill the hour's tops; typed tops always win.
 *
 * Pure HTML builders, so they are unit-tested (tests/hourly-line-scales.test.mjs).
 */
// Off for now (Koa 2026-11-24: "leave this out of the hourly-entry for now (keep
// the feature, just turn it off if possible)"). Off: no chip, no per-trimmer
// panel, no fill switch, and no lineScaleHours fetch. The seat screens, their
// hourly storage, Mis números and the fill API keep running; flip to true to
// bring the panel back.
export const SHOW_TRIMMER_SCALES = false;

export const LINE_KEYS = ['7-8', '8-9', '9-10', '10-11', '11-12', '12-1', '1-2', '2-3', '3-4', '4-4:30'];

const L = {
  en: {
    title: 'Trimmer scales', seat: 'Seat', trimmer: 'Trimmer', cultivar: 'Cultivar', lb: 'lb', min: 'min',
    noName: '(no name tapped)', total: 'Scales total', typed: 'Typed tops', none: 'No scale weight this hour yet.',
    filled: 'The tops above come from the scales.', hand: 'Typed tops win: the scales stay beside them.',
    ready: 'Switch on: the tops fill from the scales.', noCrew: 'Type the crew first: the scales fill the tops once the hour has crew.',
    noRow: 'Type the crew first: the scales fill the tops once the hour has crew.',
    off: 'Not filling: the switch is off for this day.',
    switchLabel: 'Fill tops from the trimmer scales this day (test)',
    switchHint: 'Only when every trimmer seat has a scale. Typed tops are never overwritten.',
    chip: 'scales',
  },
  es: {
    title: 'Básculas de trimmers', seat: 'Puesto', trimmer: 'Trimmer', cultivar: 'Variedad', lb: 'lb', min: 'min',
    noName: '(sin nombre)', total: 'Total de básculas', typed: 'Tops escritos', none: 'Todavía no hay peso de báscula esta hora.',
    filled: 'Los tops de arriba vienen de las básculas.', hand: 'Ganan los tops escritos: las básculas quedan al lado.',
    ready: 'Interruptor encendido: los tops se llenan de las básculas.', noCrew: 'Escriba el personal primero: las básculas llenan los tops cuando la hora tiene personal.',
    noRow: 'Escriba el personal primero: las básculas llenan los tops cuando la hora tiene personal.',
    off: 'No se llena: el interruptor está apagado este día.',
    switchLabel: 'Llenar los tops con las básculas de trimmers este día (prueba)',
    switchHint: 'Solo cuando cada puesto tiene báscula. Los tops escritos nunca se borran.',
    chip: 'básculas',
  },
};
export const scaleLabels = (lang) => L[lang === 'es' ? 'es' : 'en'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortCv = (c) => String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim();
const seatNo = (id) => (String(id || '').match(/\d+/) || [id])[0];

/** The scale hour for Hourly entry's slot index (0..9), or null. */
export function scaleHourAt(scales, index) {
  const key = LINE_KEYS[index];
  return (scales?.slots || []).find((s) => s.slot === key) || null;
}

/** "⚖ 3.4 lb" for the day view, or ''. */
export function chipHtml(hour, lang) {
  if (!hour || !(hour.lb > 0)) return '';
  return `<span class="slot-scale" title="${esc(scaleLabels(lang).title)}">⚖ ${hour.lb.toFixed(1)} lb</span>`;
}

/**
 * The editor's per-trimmer table: a row per seat, person and cultivar, the
 * scales' total beside the typed tops, what the fill does with this hour, and
 * the day's switch.
 */
export function panelHtml(hour, { lang, fillOn, typedTops = 0 }) {
  const l = scaleLabels(lang);
  const rows = (hour?.rows || []).slice().sort((a, b) => String(a.stationId).localeCompare(String(b.stationId), undefined, { numeric: true }));
  const body = rows.length
    ? `<table class="scale-table"><thead><tr><th>${l.seat}</th><th>${l.trimmer}</th><th>${l.cultivar}</th><th class="n">${l.lb}</th><th class="n">${l.min}</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(seatNo(r.stationId))}</td><td>${r.name ? esc(r.name) : `<i>${l.noName}</i>`}</td><td>${esc(shortCv(r.cultivar)) || '—'}</td><td class="n">${(r.lb || 0).toFixed(2)}</td><td class="n">${Math.round(r.min || 0)}</td></tr>`).join('')
    }</tbody></table>`
    : `<p class="scale-none">${l.none}</p>`;
  const total = hour ? hour.lb || 0 : 0;
  const diff = hour && Math.abs(total - (Number(typedTops) || 0)) >= 0.05;
  const state = !hour ? '' : !fillOn ? 'off' : hour.fill;
  const note = state && l[state] ? `<p class="scale-note ${state}">${l[state]}</p>` : '';
  return `
    <h3 class="section-label">${l.title}</h3>
    ${body}
    <div class="scale-sum${diff ? ' differs' : ''}">
      <span>${l.total}: <b>${total.toFixed(2)} lb</b></span>
      <span>${l.typed}: <b>${(Number(typedTops) || 0).toFixed(1)} lb</b></span>
    </div>
    ${note}
    <label class="scale-switch"><input type="checkbox" id="line-scale-fill" ${fillOn ? 'checked' : ''}> <span>${l.switchLabel}</span></label>
    <small class="scale-hint">${l.switchHint}</small>`;
}
