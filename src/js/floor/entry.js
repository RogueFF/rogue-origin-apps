/**
 * The hour's form: what it holds, what it becomes on the wire, and the
 * arithmetic that judges it.
 *
 * Everything here is pure. The legacy page read `document.getElementById` in
 * the middle of its save path, which is why its payload shape was only ever
 * verifiable by clicking the page; `formToPayload` below is the whole
 * addProduction body as data, so tests/floor-entry.test.mjs can pin it.
 *
 * Field values arrive from DOM inputs, so every numeric read goes through the
 * same coercion the legacy `collectFormData` used (index.js:1452). A form value
 * is a string until proven otherwise.
 */
import { rowHasRecordedData } from './slots.js';

/** Enter-key walk order. `note` is the free-text input; the legacy id was `qcNotes`. */
export const FIELD_ORDER = [
  'buckers1', 'trimmers1', 'tzero1',
  'qcperson',
  'cultivar1',
  'tops1', 'smalls1',
  'buckers2', 'trimmers2', 'tzero2',
  'cultivar2',
  'tops2', 'smalls2',
  'note',
];

/** Skipped by the Enter walk while line 2 is collapsed. */
export const LINE2_FIELDS = ['buckers2', 'trimmers2', 'tzero2', 'cultivar2', 'tops2', 'smalls2'];

/** The headcount fields a crew-change note reports on (index.js:368). */
export const CREW_FIELDS = [
  'buckers1', 'trimmers1', 'tzero1', 'qcperson', 'cultivar1',
  'buckers2', 'trimmers2', 'tzero2', 'cultivar2',
];

/**
 * How each form key is read back. Crew counts are whole people, pounds are
 * decimal, cultivars and notes are text — the same split the worker validates
 * on (validateCrewCount vs validateLbs).
 */
const FIELD_KIND = {
  buckers1: 'int', trimmers1: 'int', tzero1: 'int', qcperson: 'int',
  buckers2: 'int', trimmers2: 'int', tzero2: 'int',
  tops1: 'float', smalls1: 'float', tops2: 'float', smalls2: 'float',
  cultivar1: 'text', cultivar2: 'text', qcNotes: 'text',
};

const FORM_KEYS = Object.keys(FIELD_KIND);

const intOf = (v) => parseInt(v, 10) || 0;
const floatOf = (v) => parseFloat(v) || 0;
const textOf = (v) => String(v ?? '');

const readField = (form, key) => {
  const kind = FIELD_KIND[key];
  if (kind === 'int') return intOf(form?.[key]);
  if (kind === 'float') return floatOf(form?.[key]);
  return textOf(form?.[key]);
};

const numOr = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

/**
 * A saved row as the editor's starting values (port of populateForm,
 * index.js:1034).
 *
 * `tzero1`, `tzero2` and `qcperson` default to 1 rather than 0: one T-Zero and
 * one QC person is the floor's normal staffing, and typing the exception is
 * cheaper than typing the rule. This is a load-time UI default only — the wire
 * default in `formToPayload` stays `|| 0`, because a genuinely empty field must
 * not invent a person on the server.
 */
export function rowToForm(row) {
  const data = row || {};
  return {
    buckers1: data.buckers1 || 0,
    trimmers1: data.trimmers1 || 0,
    tzero1: data.tzero1 ?? 1,
    qcperson: data.qcperson ?? 1,
    cultivar1: data.cultivar1 || '',
    tops1: data.tops1 || 0,
    smalls1: data.smalls1 || 0,
    buckers2: data.buckers2 || 0,
    trimmers2: data.trimmers2 || 0,
    tzero2: data.tzero2 ?? 1,
    cultivar2: data.cultivar2 || '',
    tops2: data.tops2 || 0,
    smalls2: data.smalls2 || 0,
    qcNotes: data.qcNotes || '',
  };
}

/**
 * The addProduction request body, exactly (index.js:1452).
 *
 * This object IS the backend contract: the worker replaces the whole row for
 * (date, timeSlot), so a key missing here is a column silently zeroed. Adding,
 * renaming or dropping a key is a backend change, not a refactor —
 * tests/floor-entry.test.mjs asserts the key set, not just key presence.
 *
 * `qcperson` stays even though the worker's destructure never reads it: the
 * body is the contract, and a future handler reading it must find it.
 */
export function formToPayload(form, { date, slot, effective } = {}) {
  const eff = effective || {};
  return {
    date,
    timeSlot: slot,
    buckers1: intOf(form?.buckers1),
    trimmers1: intOf(form?.trimmers1),
    tzero1: intOf(form?.tzero1),
    cultivar1: textOf(form?.cultivar1),
    tops1: floatOf(form?.tops1),
    smalls1: floatOf(form?.smalls1),
    buckers2: intOf(form?.buckers2),
    trimmers2: intOf(form?.trimmers2),
    tzero2: intOf(form?.tzero2),
    cultivar2: textOf(form?.cultivar2),
    tops2: floatOf(form?.tops2),
    smalls2: floatOf(form?.smalls2),
    qcperson: intOf(form?.qcperson),
    qcNotes: textOf(form?.qcNotes),
    effectiveTrimmers1: numOr(eff.effectiveTrimmers1, 0),
    effectiveTrimmers2: numOr(eff.effectiveTrimmers2, 0),
  };
}

/** Anyone trimming at all? Only trimmers count — the target is per trimmer. */
export function hasCrew(form) {
  return intOf(form?.trimmers1) + intOf(form?.trimmers2) > 0;
}

/** Smalls are a byproduct; only tops count as production (index.js:1326). */
export function hasProduction(form) {
  return floatOf(form?.tops1) + floatOf(form?.tops2) > 0;
}

/** Tops on a saved row, both lines. */
export function rowTops(row) {
  return (row?.tops1 || 0) + (row?.tops2 || 0);
}

/** Did this hour actually run a second line? */
export function rowHasLine2(row) {
  return (row?.trimmers2 || 0) > 0 || (row?.tops2 || 0) > 0;
}

/**
 * Seed the crew log for a slot (index.js:1069).
 *
 * An hour that opens with crew already on it is one segment starting at the top
 * of the hour; an hour that opens empty has no segments until someone is
 * entered, so a crew added at :20 is not credited with the first twenty
 * minutes.
 */
export function startCrewLog(row, slotStartMinutes, nowMinutes) {
  const trimmers1 = row?.trimmers1 || 0;
  const trimmers2 = row?.trimmers2 || 0;
  if (trimmers1 <= 0 && trimmers2 <= 0) return [];
  return [{
    minutesMark: slotStartMinutes || nowMinutes,
    trimmers1,
    trimmers2,
  }];
}

/**
 * Append a segment when the trimmer count moved (index.js:1210).
 *
 * Returns the same array when nothing changed, so callers can use identity to
 * decide whether anything needs re-rendering.
 */
export function recordCrewChange(log, form, nowMinutes) {
  const list = Array.isArray(log) ? log : [];
  const trimmers1 = intOf(form?.trimmers1);
  const trimmers2 = intOf(form?.trimmers2);

  const last = list[list.length - 1];
  if (last && last.trimmers1 === trimmers1 && last.trimmers2 === trimmers2) return list;

  return [...list, { minutesMark: nowMinutes, trimmers1, trimmers2 }];
}

/**
 * Time-weighted trimmers for an hour (port of getEffectiveTrimmers,
 * index.js:1233).
 *
 * Twelve trimmers for half an hour and ten for the rest is eleven trimmers'
 * worth of hour, and the target has to be built on that number or every
 * mid-hour crew move reads as a miss.
 *
 * Precedence: a server-computed `effectiveTrimmers1` on the row wins for every
 * hour that is NOT being edited live, because the row is what the other
 * consumers (scoreboard, digest) already agree on; then the live log for the
 * open slot; then raw counts.
 *
 * The gate on that first clause is the whole point. Legacy drew the same line
 * at the call site: collectFormData (index.js:1456) and the open-slot branch of
 * updateStepGuide passed no saved data, while the cumulative loop passed the
 * row. main.js writes the sent payload straight back into dayData, so the open
 * hour's row carries an `effectiveTrimmers1` from its own first autosave —
 * honouring it here would freeze the hour on that number and make the weighting
 * below unreachable in the one case it exists for, a crew change mid-hour.
 * "Live" is `isOpen && form`, so a caller that hands over the row for the open
 * slot (as main.js does) still gets live numbers, and a ribbon reading a past
 * hour with no form of its own still gets the server's value.
 */
export function effectiveTrimmers({
  row = null,
  form = null,
  log = [],
  slotStart,
  slotEnd,
  nowMinutes = 0,
  isOpen = false,
} = {}) {
  const live = isOpen && form;

  if (!live && row && row.effectiveTrimmers1 != null) {
    return {
      effectiveTrimmers1: row.effectiveTrimmers1,
      effectiveTrimmers2: row.effectiveTrimmers2 || 0,
    };
  }

  const rawForm = () => ({
    effectiveTrimmers1: intOf(form?.trimmers1),
    effectiveTrimmers2: intOf(form?.trimmers2),
  });

  if (isOpen && Array.isArray(log) && log.length > 1) {
    if (slotStart === undefined || slotStart === null) return rawForm();

    const end = (slotEnd ?? slotStart + 60);
    // Never credit an hour that has not happened yet: weight only up to now.
    const endMark = Math.min(nowMinutes, end);

    let weighted1 = 0;
    let weighted2 = 0;
    let total = 0;

    for (let i = 0; i < log.length; i++) {
      const entry = log[i];
      const segStart = Math.max(entry.minutesMark, slotStart);
      const segEnd = (i + 1 < log.length) ? Math.min(log[i + 1].minutesMark, endMark) : endMark;
      const duration = Math.max(0, segEnd - segStart);

      weighted1 += entry.trimmers1 * duration;
      weighted2 += entry.trimmers2 * duration;
      total += duration;
    }

    if (total > 0) {
      return {
        effectiveTrimmers1: Math.round((weighted1 / total) * 10) / 10,
        effectiveTrimmers2: Math.round((weighted2 / total) * 10) / 10,
      };
    }
  }

  if (isOpen) return rawForm();

  if (row) {
    return {
      effectiveTrimmers1: row.trimmers1 || 0,
      effectiveTrimmers2: row.trimmers2 || 0,
    };
  }

  return { effectiveTrimmers1: 0, effectiveTrimmers2: 0 };
}

/** Pounds of tops this hour should produce. */
export function hourTarget({ trimmers = 0, targetRate = 0, multiplier = 1 } = {}) {
  return trimmers * targetRate * multiplier;
}

/**
 * How the ribbon paints one hour.
 *
 * Taste call: `near` does not exist on the legacy page, which only knew met and
 * missed. Ninety percent is the line below which the hour is clearly missed
 * rather than nearly made — painting a 9.6-of-10 hour the same red as a 2-of-10
 * hour trains the floor to ignore the colour.
 *
 * Tops are entered at the END of an hour, so the open slot spends most of its
 * life with crew and no pounds; it reads `open`, never `short`.
 */
export function tickState({ row, target = 0, isOpen = false } = {}) {
  const tops = rowTops(row);

  if (tops > 0) {
    if (target <= 0) return 'met';
    if (tops >= target) return 'met';
    if (tops >= 0.9 * target) return 'near';
    return 'short';
  }

  if (isOpen) return 'open';
  if (!rowHasRecordedData(row)) return 'none';
  return 'short';
}

/**
 * Human-readable crew diffs (port of getCrewChanges, index.js:1170).
 *
 * The strings are data, not display: src/js/hub/format.js noteLines() and the
 * weekly digest parse them back out of the `[Crew change …]` bracket on a split
 * of the colon and its surrounding whitespace. Line 1's label is the empty
 * string, which is why line 1 reads
 * "Trimmers : 12 → 10" with a space before the colon. Do not tidy that space.
 */
export function crewChanges(original, current, labels = {}) {
  // No snapshot means the hour was never loaded, so nothing can have changed
  // from it — without this every non-zero field reads as a change from zero and
  // an untouched hour writes a crew-change note nobody caused (index.js:1170).
  if (!original) return [];

  const l = labels;
  const fieldLabels = {
    buckers1: `${l.buckers} ${l.line1 ?? ''}`,
    trimmers1: `${l.trimmers} ${l.line1 ?? ''}`,
    tzero1: `${l.tzero} ${l.line1 ?? ''}`,
    qcperson: l.qcperson,
    cultivar1: `${l.cultivar} ${l.line1 ?? ''}`,
    buckers2: `${l.buckers} ${l.line2}`,
    trimmers2: `${l.trimmers} ${l.line2}`,
    tzero2: `${l.tzero} ${l.line2}`,
    cultivar2: `${l.cultivar} ${l.line2}`,
  };

  const changes = [];
  for (const field of CREW_FIELDS) {
    const was = readField(original, field);
    const now = readField(current, field);
    if (was === now) continue;
    changes.push(`${fieldLabels[field]}: ${was} → ${now}`);
  }
  return changes;
}

/** The bracket line the digest looks for (index.js:1563). */
export function crewChangeNote(changes, timeStr) {
  return `[Crew change ${timeStr}: ${changes.join(', ')}]`;
}

/**
 * Has anything actually been typed since load?
 *
 * The legacy page posted on every blur whether or not a value moved, which is
 * how an hour nobody touched ended up as a row of zeros on the server. Form
 * values are strings and the snapshot from `rowToForm` holds numbers, so this
 * compares each key in its own kind — a string compare here would report dirty
 * on load and put the zero rows straight back.
 */
export function isDirty(form, snapshot) {
  for (const key of FORM_KEYS) {
    if (readField(form, key) !== readField(snapshot, key)) return true;
  }
  return false;
}

/** The next input the Enter key should land on; null at the end of the hour. */
export function nextField(currentId, { line2 = false } = {}) {
  const start = FIELD_ORDER.indexOf(currentId);
  if (start === -1) return null;

  for (let i = start + 1; i < FIELD_ORDER.length; i++) {
    const id = FIELD_ORDER[i];
    if (!line2 && LINE2_FIELDS.includes(id)) continue;
    return id;
  }
  return null;
}

/**
 * The day so far (port of updateTimelineSummary, index.js:2046).
 *
 * `excludeSlot` is the live hour: its pounds are entered at the end of the
 * hour, so counting it in progress makes the day look behind all day.
 */
export function dayTotals({ slots = [], dayData = {}, excludeSlot = null } = {}) {
  let tops = 0;
  let hoursLogged = 0;

  for (const slot of slots) {
    if (slot === excludeSlot) continue;
    const rowT = rowTops(dayData[slot]);
    if (rowT <= 0) continue;
    tops += rowT;
    hoursLogged++;
  }

  return { tops, hoursLogged };
}

/**
 * Actual against target, for the hours the day has actually reached
 * (index.js:1398).
 *
 * The walk stops at the last hour with production rather than at the current
 * hour: an hour still in progress has no pounds yet, and charging its full
 * target against an empty actual would report the floor as behind at the top of
 * every hour. Hours in the middle with no production still carry their target —
 * a skipped hour is a real miss, not an absent row.
 */
export function paceSummary({
  slots = [],
  dayData = {},
  targetFor = () => 0,
  liveSlot = null,
  liveTops = 0,
  isVisible = () => true,
} = {}) {
  const topsFor = (slot) => (slot === liveSlot ? liveTops : rowTops(dayData[slot]));

  let last = -1;
  for (let i = 0; i < slots.length; i++) {
    if (!isVisible(slots[i])) continue;
    if (topsFor(slots[i]) > 0) last = i;
  }

  if (last < 0) return { actual: 0, target: 0, diff: 0 };

  let actual = 0;
  let target = 0;
  for (let i = 0; i <= last; i++) {
    const slot = slots[i];
    if (!isVisible(slot)) continue;
    target += targetFor(slot) || 0;
    actual += topsFor(slot);
  }

  return { actual, target, diff: actual - target };
}
