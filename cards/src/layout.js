// Card model → Satori element tree. Pure: no I/O, no globals, the model is not touched.
//
// The approved mocks (docs/plans/assets/2026-10-19-card-{weekly,eod,midday}.png)
// were rendered from the HTML/CSS in docs/plans/assets/2026-10-19-card-mock-builder.py;
// every px and colour below is that CSS, one rule to one style object. Satori rules
// kept here: an element with more than one child is display flex, text nodes are
// plain strings, styles are inline with px numbers, borders are longhand.

export const CANVAS = { width: 1080, height: 1350 };
/** Bar plot height and the share of it the tallest bar or target tick reaches. */
export const PLOT = { height: 224, headroom: 0.82 };

const LOCK = '\u{1F512}'; // the model's locked-money value; no emoji font, so it renders as "locked"

const FONT = { sans: 'Outfit', mono: 'JetBrains Mono', serif: 'DM Serif Display' };
const INK = {
  card: '#1a1f1c',
  panel: '#161b18',
  bar: '#4fa06b',
  tick: '#e4aa4f',
  text: 'rgba(255,255,255,0.9)',
  title: 'rgba(255,255,255,0.92)',
  pill: 'rgba(255,255,255,0.7)',
  label: 'rgba(255,255,255,0.62)',
  unit: 'rgba(255,255,255,0.5)',
  muted: 'rgba(255,255,255,0.44)',
  foot: 'rgba(255,255,255,0.35)',
  line: 'rgba(255,255,255,0.07)',
  rule: 'rgba(255,255,255,0.14)',
  stub: 'rgba(255,255,255,0.08)',
  nowFill: 'rgba(79,160,107,0.25)',
  nowLine: 'rgba(127,191,149,0.6)',
};
const TONE = {
  good: { color: '#7fbf95', bg: 'rgba(127,191,149,0.14)' },
  bad: { color: '#e07b6b', bg: 'rgba(224,123,107,0.14)' },
  warn: { color: '#e4aa4f', bg: 'rgba(228,170,79,0.16)' },
  neutral: { color: 'rgba(255,255,255,0.62)', bg: 'rgba(255,255,255,0.07)' },
};
const tone = (kind) => TONE[kind] || TONE.neutral;

// ---------------------------------------------------------------------------
// Element helpers

/** A div. `children` may be a string, one node, or an array (nulls dropped). */
function div(style, children = [], data = {}) {
  const kids = Array.isArray(children) ? children.filter((c) => c !== null && c !== undefined && c !== false) : children;
  return { type: 'div', props: { ...data, style, children: kids } };
}

const mono = (fontSize) => ({ fontFamily: FONT.mono, fontWeight: 400, fontSize });
const pad = (top, right, bottom = top, left = right) => ({ paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left });
const border = (width, color, style = 'solid') => ({
  borderTopWidth: width, borderRightWidth: width, borderBottomWidth: width, borderLeftWidth: width,
  borderTopStyle: style, borderRightStyle: style, borderBottomStyle: style, borderLeftStyle: style,
  borderTopColor: color, borderRightColor: color, borderBottomColor: color, borderLeftColor: color,
});
const radius = (r) => ({ borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomRightRadius: r, borderBottomLeftRadius: r });
const flex1 = { flexGrow: 1, flexShrink: 1, flexBasis: 0 };
const panel = (r) => ({ backgroundColor: INK.panel, ...border(2, INK.line), ...radius(r) });

/** The locked-money value: the word in the muted mono font, sized to sit in the number's row. */
const lockText = (fontSize, height) => div({ display: 'flex', alignItems: 'center', height, ...mono(fontSize), color: INK.muted }, 'locked', { 'data-role': 'lock' });

// ---------------------------------------------------------------------------
// Sections

function head(m) {
  return div({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }, [
    div({ display: 'flex', flexDirection: 'column' }, [
      div({ ...mono(20), letterSpacing: 2.4, color: INK.muted }, m.eyebrow.toUpperCase()),
      div({ fontFamily: FONT.serif, fontStyle: 'italic', fontWeight: 400, fontSize: 84, lineHeight: 1, marginTop: 6, color: INK.title }, m.title),
      div({ fontSize: 29, color: INK.label, marginTop: 10 }, m.sub),
    ]),
    div({
      display: 'flex', alignItems: 'center', ...mono(22), color: INK.pill,
      backgroundColor: INK.panel, ...border(2, INK.rule), ...radius(999), ...pad(12, 24),
    }, m.pill),
  ], { 'data-section': 'head' });
}

function chip(c) {
  const t = tone(c.kind);
  return div({
    display: 'flex', alignItems: 'center', ...mono(18), ...pad(7, 12), ...radius(999),
    whiteSpace: 'nowrap', color: t.color, backgroundColor: t.bg,
  }, c.text, { 'data-role': 'chip' });
}

function tile(t) {
  const locked = t.value === LOCK;
  const value = locked
    ? lockText(40, 76)
    : div({ fontSize: 76, fontWeight: 600, lineHeight: 1, letterSpacing: -1.52 }, t.value);
  return div({ ...flex1, display: 'flex', flexDirection: 'column', ...panel(24), ...pad(22, 28, 20) }, [
    div({ fontSize: 24, color: INK.label }, t.label),
    div({ display: 'flex', alignItems: 'baseline', marginTop: 8, whiteSpace: 'nowrap' }, [
      value,
      t.unit && !locked ? div({ fontSize: 28, color: INK.unit, marginLeft: 10 }, t.unit) : null,
    ]),
    div({ display: 'flex', gap: 8, marginTop: 16 }, (t.chips || []).slice(0, 2).map(chip)),
  ], { 'data-role': 'tile' });
}

function tiles(m) {
  return div({ display: 'flex', gap: 18, marginTop: 28 }, m.tiles.map(tile), { 'data-section': 'tiles' });
}

/** px per lb so the tallest bar or target tick reaches PLOT.headroom of the plot. */
function scaleOf(cols) {
  const max = Math.max(0, ...cols.map((c) => Math.max(Number(c.lbs) || 0, Number(c.target) || 0)));
  return max > 0 ? (PLOT.height * PLOT.headroom) / max : 0;
}

const clampPlot = (px) => Math.min(PLOT.height, Math.max(0, px));

function column(c, ppl, barWidth) {
  const target = Number(c.target) || 0;
  const tickPx = target > 0 ? clampPlot(Math.round(target * ppl)) : 0;
  const cap = (text, bottom, color = INK.text) => div({
    position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center',
    ...mono(24), color,
  }, text, { 'data-role': 'cap' });
  const tick = target > 0
    ? div({
      position: 'absolute', left: 10, right: 10, bottom: tickPx, height: 0,
      borderTopWidth: 3, borderTopStyle: 'dashed', borderTopColor: INK.tick,
    }, [], { 'data-role': 'tick' })
    : null;

  let body;
  if (c.kind === 'off') {
    body = [
      cap('off', 18, INK.muted),
      div({ width: barWidth, height: 8, backgroundColor: INK.stub, borderTopLeftRadius: 10, borderTopRightRadius: 10 }, [], { 'data-role': 'bar' }),
    ];
  } else if (c.kind === 'now') {
    const h = clampPlot(Math.max(10, tickPx));
    body = [
      cap('now', h + 10, INK.muted),
      div({
        boxSizing: 'border-box', width: barWidth, height: h, backgroundColor: INK.nowFill,
        borderTopWidth: 2, borderRightWidth: 2, borderBottomWidth: 0, borderLeftWidth: 2,
        borderTopStyle: 'dashed', borderRightStyle: 'dashed', borderBottomStyle: 'dashed', borderLeftStyle: 'dashed',
        borderTopColor: INK.nowLine, borderRightColor: INK.nowLine, borderBottomColor: INK.nowLine, borderLeftColor: INK.nowLine,
        borderTopLeftRadius: 10, borderTopRightRadius: 10,
      }, [], { 'data-role': 'bar' }),
    ];
  } else {
    const h = clampPlot(Math.max(6, Math.round((Number(c.lbs) || 0) * ppl)));
    body = [
      cap(String(Math.round(Number(c.lbs) || 0)), Math.max(h, tickPx) + 10),
      div({ width: barWidth, height: h, backgroundColor: INK.bar, borderTopLeftRadius: 10, borderTopRightRadius: 10 }, [], { 'data-role': 'bar' }),
    ];
  }
  return div({
    position: 'relative', ...flex1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-end', height: PLOT.height,
  }, [tick, ...body], { 'data-role': 'col', 'data-kind': c.kind });
}

function chart(m) {
  const { cols } = m.chart;
  const ppl = scaleOf(cols);
  const barWidth = m.kind === 'weekly' ? 72 : 48;
  return div({ display: 'flex', flexDirection: 'column', marginTop: 18, ...panel(24), ...pad(22, 30, 18) }, [
    div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }, [
      div({ fontSize: 28, fontWeight: 500 }, m.chart.title),
      div({ display: 'flex', alignItems: 'center', gap: 10, ...mono(18), color: INK.muted }, [
        div({ width: 28, height: 0, borderTopWidth: 3, borderTopStyle: 'dashed', borderTopColor: INK.tick }, []),
        div({}, `${m.chart.legend} ·`),
        div({ fontSize: 20 }, m.chart.sub),
      ]),
    ]),
    div({
      display: 'flex', alignItems: 'flex-end', height: PLOT.height, marginTop: 34,
      borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: INK.rule,
    }, cols.map((c) => column(c, ppl, barWidth))),
    div({ display: 'flex', marginTop: 12 }, cols.map((c) => div({ ...flex1, display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      div({ fontSize: 24, color: INK.label }, c.label),
      div({ ...mono(20), color: INK.muted, marginTop: 2 }, c.rate),
    ], { 'data-role': 'axis' }))),
  ], { 'data-section': 'chart' });
}

function mini(x) {
  const locked = x.value === LOCK;
  const value = locked ? lockText(30, 44) : div({}, x.value);
  // Under a lock the model's "locked" sub would only repeat it.
  const sub = locked && x.sub === 'locked' ? '' : x.sub || '';
  return div({ ...flex1, display: 'flex', flexDirection: 'column', ...panel(20), ...pad(16, 24, 14) }, [
    div({ fontSize: 22, color: INK.label }, x.label),
    div({ display: 'flex', alignItems: 'baseline', ...mono(36), marginTop: 4, color: INK.text, whiteSpace: 'nowrap' }, [
      value,
      x.unit && !locked ? div({ fontSize: 20, color: INK.unit, marginLeft: 8 }, x.unit) : null,
    ]),
    div({ ...mono(20), color: INK.muted, marginTop: 4 }, sub),
  ], { 'data-role': 'mini' });
}

function minis(m) {
  return div({ display: 'flex', gap: 18, marginTop: 18 }, m.minis.map(mini), { 'data-section': 'minis' });
}

function flag(f) {
  const t = tone(f.kind);
  return div({ flexShrink: 0, display: 'flex', alignItems: 'center', ...radius(16), ...pad(12, 20), fontSize: 24, backgroundColor: t.bg }, [
    div({ flexShrink: 0, width: 14, height: 14, ...radius(7), marginRight: 16, backgroundColor: t.color }, []),
    div({ flexShrink: 0, ...mono(19), letterSpacing: 1.52, marginRight: 18, width: 74, color: t.color }, f.tag.toUpperCase()),
    // Floor notes are free text: two lines at most, so one long note cannot push the foot off.
    div({ flexShrink: 1, minWidth: 0, lineClamp: 2 }, f.text),
  ], { 'data-role': 'flag' });
}

// Vertical give when floor notes run long. The mock leaves 17 px under the flags
// on the eod and weekly cards; one two-line flag needs 30. The foot gives way first:
// it slides up to FOOT_GIVE px into the bottom padding (its shrink factor dwarfs the
// flags' so it takes ~all of the overflow until it is down to its one line). Only
// then does the flags section shrink and clip its last, least urgent flag. The foot
// never leaves the card. (A flags factor below 1 would not work: CSS distributes
// only that fraction of the overflow once the foot is frozen.)
const BOTTOM_PAD = 40;
const FOOT_GIVE = 28;
const FOOT_LINE = 22; // one 17 px JetBrains Mono line
const FOOT_SHRINK = 1e6;

function flags(m) {
  return div({
    display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, flexShrink: 1, minHeight: 0, overflow: 'hidden',
  }, (m.flags || []).map(flag), { 'data-section': 'flags' });
}

function foot(m) {
  // FOOT_GIVE px of the card's bottom padding live inside the foot box, under its line.
  return div({
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 'auto',
    height: FOOT_LINE + FOOT_GIVE, minHeight: FOOT_LINE, flexShrink: FOOT_SHRINK, ...mono(17), color: INK.foot,
  }, [
    div({}, m.foot.left),
    div({}, m.foot.right),
  ], { 'data-section': 'foot' });
}

/** The whole card: a 1080×1350 column of head, tiles, chart, minis, flags and foot. */
export function cardTree(m) {
  return div({
    width: CANVAS.width, height: CANVAS.height, boxSizing: 'border-box', ...pad(52, 56, BOTTOM_PAD - FOOT_GIVE),
    display: 'flex', flexDirection: 'column', backgroundColor: INK.card, color: INK.text,
    fontFamily: FONT.sans, fontWeight: 500,
  }, [head(m), tiles(m), chart(m), minis(m), flags(m), foot(m)]);
}
