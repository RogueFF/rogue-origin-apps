/**
 * The six shift-miss reasons and the qcNotes grammar that carries them.
 *
 * qcNotes is one free-text field on the wire, but it holds three different
 * kinds of thing stacked in a fixed order: a reason line, the manager's own
 * words, and bracketed system notes like a crew-change record. The reason
 * line is ALWAYS written in English regardless of the active language —
 * hub/format.js's noteLines() and the weekly digest both strip `[Reason: …]`
 * and `[…]` lines back out downstream, and they only know the English
 * labels. Parsing is tolerant of either language (a manager who typed a
 * note in Spanish before this rule existed should not lose it), but
 * composing is not.
 */

export const REASONS = [
  { id: 'machine', en: 'machine down', es: 'máquina parada' },
  { id: 'wet', en: 'wet material', es: 'material húmedo' },
  { id: 'break', en: 'break ran long', es: 'descanso largo' },
  { id: 'cultivar', en: 'cultivar change', es: 'cambio de cultivar' },
  { id: 'crew', en: 'short crew', es: 'falta personal' },
  { id: 'new', en: 'new trimmers', es: 'podadores nuevos' },
];

const REASON_LINE_RE = /^\[\s*reason\s*:\s*(.*)\]$/i;
const BRACKET_LINE_RE = /^\[.*\]$/;

function findReasonId(label) {
  const norm = label.trim().toLowerCase();
  if (!norm) return null;
  const found = REASONS.find((r) => r.en.toLowerCase() === norm || r.es.toLowerCase() === norm);
  return found ? found.id : null;
}

/**
 * qcNotes -> { reasons, text, brackets }. Only the FIRST `[Reason: …]` line
 * found is treated as the reason line; a later one (should it ever occur)
 * is left alone as an ordinary bracket line rather than merged or dropped —
 * silently combining two reason lines would rewrite history nobody asked
 * this parser to touch.
 */
export function parseNotes(qcNotes) {
  const lines = String(qcNotes ?? '').split('\n');
  const reasonIds = [];
  const textLines = [];
  const brackets = [];
  let reasonLineSeen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!reasonLineSeen) {
      const m = REASON_LINE_RE.exec(line);
      if (m) {
        reasonLineSeen = true;
        for (const part of m[1].split(',')) {
          const id = findReasonId(part);
          if (id && !reasonIds.includes(id)) reasonIds.push(id);
        }
        continue;
      }
    }

    if (BRACKET_LINE_RE.test(line)) {
      brackets.push(line);
      continue;
    }

    textLines.push(line);
  }

  // Always report reason ids in REASONS order, not the order they appeared
  // in the note — the reason chips render in that fixed order too.
  const reasons = REASONS.filter((r) => reasonIds.includes(r.id)).map((r) => r.id);
  return { reasons, text: textLines.join('\n'), brackets };
}

/** { reasons, text, brackets } -> qcNotes. Reason line first, then free text, then other brackets. */
export function composeNotes({ reasons = [], text = '', brackets = [] } = {}) {
  const lines = [];
  if (reasons && reasons.length) {
    const labels = REASONS.filter((r) => reasons.includes(r.id)).map((r) => r.en);
    if (labels.length) lines.push(`[Reason: ${labels.join(', ')}]`);
  }
  for (const t of String(text ?? '').split('\n')) {
    if (t.trim()) lines.push(t);
  }
  for (const b of brackets || []) {
    if (b) lines.push(b);
  }
  return lines.join('\n');
}
