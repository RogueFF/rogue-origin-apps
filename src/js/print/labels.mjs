/**
 * Bag labels, OFF by default (Koa 2026-11-11). Today each bag gets a blank label
 * and the cultivar is written on it in Sharpie. "What we'd like eventually is
 * potentially a printing machine that could take our blank 4.75 x 1 label, and
 * run it through a printer (one at a time) that could print the cultivar text
 * onto it." Until that printer is picked, this lays the labels out for a 4 in
 * thermal printer feeding the 4.75 x 1 in stock lengthwise (1 in across, 4.75 in
 * along the feed), with the text running along the label (vertical writing mode).
 * Cultivar text only: no THC %, lot or compliance fields unless Koa asks.
 * Pure, so it's unit-tested (tests/print-labels.test.mjs).
 */

export const LABEL = { acrossIn: 1, alongIn: 4.75 };

/** One label per bag: every open flower line's cultivar, repeated by its bag count. */
export function bagLabels(lines = []) {
  const out = [];
  for (const l of lines) {
    if (!l.cultivar || !(l.form === 'tops' || l.form === 'smalls')) continue;
    const n = Math.max(0, Math.floor(Number(l.qty) || 0));
    for (let i = 0; i < n; i++) out.push(l.cultivar);
  }
  return out;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A print document with one page per label, sized to the label stock. */
export function labelSheetHtml(names = []) {
  const { acrossIn: w, alongIn: h } = LABEL;
  const pages = names.map(n => `<section class="l"><span>${esc(n)}</span></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bag labels</title><style>
@page { size: ${w}in ${h}in; margin: 0; }
html, body { margin: 0; padding: 0; }
.l { width: ${w}in; height: ${h}in; display: flex; align-items: center; justify-content: center; overflow: hidden;
  page-break-after: always; break-after: page; }
.l:last-child { page-break-after: auto; break-after: auto; }
.l span { display: block; writing-mode: vertical-rl; white-space: nowrap; font: 800 22pt Arial, Helvetica, sans-serif;
  max-height: ${h - 0.3}in; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>${pages}</body></html>`;
}
