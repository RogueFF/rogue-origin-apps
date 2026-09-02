/**
 * Formatting helpers for the Ops Hub. Pure functions, no DOM.
 */

export const PT = 'America/Los_Angeles';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 118.9 -> "118.9", 1250 -> "1,250", null -> "—" */
export function num(v, digits = 1) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 0 : digits;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function int(v) {
  return isNum(v) ? Math.round(v).toLocaleString('en-US') : '—';
}

export function money(v, digits = 0) {
  if (!isNum(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v, digits = 0) {
  return isNum(v) ? `${v.toFixed(digits)}%` : '—';
}

/**
 * Relative change between two values.
 * Returns null when either side is missing or the base is zero.
 */
export function delta(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev === 0) return null;
  const r = (cur - prev) / Math.abs(prev);
  const dir = Math.abs(r) < 0.005 ? 'flat' : r > 0 ? 'up' : 'down';
  const sign = dir === 'up' ? '+' : dir === 'down' ? '−' : '';
  return { dir, r, text: `${sign}${Math.abs(r * 100).toFixed(Math.abs(r) < 0.1 ? 1 : 0)}%` };
}

/**
 * Delta chip HTML. `upIsGood=false` flips the color (costs, cycle times).
 */
export function deltaChip(cur, prev, { upIsGood = true, vs = '' } = {}) {
  const d = delta(cur, prev);
  if (!d) return '';
  const cls = d.dir === 'flat' ? 'flat' : d.dir === 'up' ? (upIsGood ? 'up' : 'up is-bad') : (upIsGood ? 'down' : 'down is-good');
  const glyph = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•';
  return `<span class="delta ${cls}" title="vs ${esc(vs)}">${glyph} ${d.text}</span>${vs ? `<span class="muted">vs ${esc(vs)}</span>` : ''}`;
}

/** "7:00 AM – 8:00 AM" -> "7a"; "12:30 PM – 1:00 PM" -> "12:30p" */
export function hourShort(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(label || ''));
  if (!m) return String(label || '').slice(0, 6);
  const mm = m[2] === '00' ? '' : `:${m[2]}`;
  return `${m[1]}${mm}${m[3].toLowerCase()[0]}`;
}

/** "7:00 AM – 8:00 AM" -> "7:00 AM" (survives mojibake dashes) */
export function hourStart(label) {
  const m = /^(\d{1,2}:\d{2}\s*(?:AM|PM))/i.exec(String(label || ''));
  return m ? m[1] : String(label || '');
}

/** "2025 - Lifter / Sungrown" -> { name: "Lifter", grow: "Sungrown", year: "2025" } */
export function cultivarParts(s) {
  const str = String(s || '').trim();
  const m = /^(\d{4})\s*-\s*(.+?)(?:\s*\/\s*(.+))?$/.exec(str);
  if (!m) return { name: str || '—', grow: '', year: '' };
  return { year: m[1], name: m[2].trim(), grow: (m[3] || '').trim() };
}

export function cultivarShort(s) {
  const p = cultivarParts(s);
  return p.grow ? `${p.name} · ${p.grow}` : p.name;
}

/** seconds -> "48s", "12m", "1h 05m", "7h 45m" */
export function dur(seconds) {
  if (!isNum(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function minutes(seconds) {
  return isNum(seconds) ? `${Math.round(seconds / 60)} min` : '—';
}

/** ISO -> "4:06 PM" in Pacific time */
export function clockTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { timeZone: PT, hour: 'numeric', minute: '2-digit' });
}

/** "2026-09-01" -> "Tue, Sep 1" */
export function dayLabel(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...opts });
}

export function dayShort(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

export function weekday(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short' });
}

/**
 * Split the hourly `notes` text into readable lines.
 * "[Crew change 10:06 AM: Trimmers : 12 → 10, Cultivar : A → B]\n[…]" -> ["10:06 AM · Trimmers 12 → 10 · Cultivar A → B", …]
 */
export function noteLines(notes) {
  const raw = String(notes || '').trim();
  if (!raw) return [];
  const parts = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => {
    const m = /^\[Crew change\s+([^:]+):\s*(.+)\]$/i.exec(p);
    if (!m) return p.replace(/^\[|\]$/g, '');
    const changes = m[2].split(/,\s*(?=[A-Z][a-z]+\s*:)/).map((c) => c.replace(/\s*:\s*/, ' ').replace(/\s*(→|â†’)\s*/g, ' → ').trim());
    return `${m[1]} · ${changes.join(' · ')}`;
  });
}

export function greeting(d = new Date()) {
  const h = Number(d.toLocaleTimeString('en-US', { timeZone: PT, hour: 'numeric', hour12: false }));
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Round a max value up to a "nice" tick ceiling and step. */
export function niceScale(max, ticks = 4) {
  const m = isNum(max) && max > 0 ? max : 1;
  const rough = m / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { step, max: Math.ceil(m / step) * step };
}
