// Floor notes → card flags. The crew writes short Spanish notes into the hourly
// log; the card shows the ones it can classify, translated by a small phrase
// table. Rule-based on purpose: no AI, the same note always gives the same flag.
//
// All matching runs on accent-folded text (NFC, then combining marks stripped),
// so "húmedo", "humedo" and "hu" + combining acute + "medo" are the same word and
// the table needs one unaccented row per phrase. Translated output is spliced
// from the original text, so words the table does not know keep their accents.

// Phrase table: unaccented Spanish (lower case, single-spaced) → English. Longer
// phrases win over the words inside them. A leading ", " marks a phrase that
// starts a new clause, since the floor runs clauses together without punctuation.
const PHRASES = {
  'piensen que se va aser porque se pueden echar a perder': ', spoilage risk, need a plan',
  'piensen que se va a hacer porque se pueden echar a perder': ', spoilage risk, need a plan',
  'hubo movimiento de personal a ultima hora': 'staff moved at the last minute',
  'no se esta pasando por el costal': 'not going through the sack',
  'porque se pueden echar a perder': ', spoilage risk',
  'se pueden echar a perder': ', spoilage risk',
  'se echan a perder': ', spoiling',
  'se van a echar a perder': ', spoilage risk',
  'se va a echar a perder': ', spoilage risk',
  'se van a perder': ', spoilage risk',
  'se va a perder': ', spoilage risk',
  'echar a perder': 'spoil',
  'piensen que se va aser': ', need a plan',
  'piensen que se va a hacer': ', need a plan',
  'que quedaron a vajo': 'stored below',
  'que quedaron abajo': 'stored below',
  'estan muy humedas': 'are very wet',
  'esta muy humedo': 'is very wet',
  'trae un poquito de': 'a bit of',
  'un poquito de': 'a bit of',
  'algunos': 'some',
  'mucha hoja': 'a lot of leaf',
  'mucho hoja': 'a lot of leaf',
  'mucho mold': 'a lot of mold',
  'mucho gusano': 'a lot of worms',
  'muchos gusanos': 'a lot of worms',
  'mucho': 'a lot of',
  'mucha': 'a lot of',
  'muchos': 'a lot of',
  'muchas': 'a lot of',
  'gusanos': 'worms',
  'gusano': 'worm',
  'humedo': 'wet',
  'humeda': 'wet',
  'humedos': 'wet',
  'humedas': 'wet',
  'umedo': 'wet',
  'umeda': 'wet',
  'umedos': 'wet',
  'umedas': 'wet',
  'mojado': 'wet',
  'mojada': 'wet',
  'mojados': 'wet',
  'mojadas': 'wet',
  'moho': 'mold',
  'hojas': 'leaves',
  'hoja': 'leaf',
  'costal': 'sack',
  'volsas': 'bags',
  'bolsas': 'bags',
  'volsa': 'bag',
  'bolsa': 'bag',
  'colgar': 'hang',
  'trae': 'has',
  'tiene': 'has',
  'producto': 'product',
  'y': 'and',
  'porque': 'because',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A global, case-insensitive regex for whole words/phrases (Unicode-aware boundaries). */
const words = (source) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'giu');

// One pass, longest phrase first, so English output is never matched again.
const PHRASE_RE = words(Object.keys(PHRASES).sort((a, b) => b.length - a.length).map(escapeRe).join('|'));

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Accent-fold: canonical decomposition, then drop the combining marks. */
const fold = (text) => String(text ?? '').normalize('NFC').normalize('NFD').replace(/\p{M}/gu, '');

/**
 * The squashed NFC text, its folded twin, and `at[i]` = the index in `text`
 * that folded character `i` came from (plus one entry for the end), so a match
 * found in `folded` can be cut out of `text`.
 */
function foldAligned(input) {
  const text = squash(input).normalize('NFC');
  let folded = '';
  const at = [];
  let index = 0;
  for (const ch of text) {
    const base = fold(ch);
    for (let k = 0; k < base.length; k += 1) at.push(index);
    folded += base;
    index += ch.length;
  }
  at.push(text.length);
  return { text, folded, at };
}

/** Spanish floor note → readable English. Unknown words are kept as written. */
export function translate(input) {
  const { text, folded, at } = foldAligned(input);
  let s = '';
  let last = 0;
  for (const m of folded.matchAll(PHRASE_RE)) {
    s += text.slice(last, at[m.index]) + PHRASES[m[0].toLowerCase()];
    last = at[m.index + m[0].length];
  }
  s += text.slice(last);
  s = s
    .replace(/\s+,/g, ',') // "wet , spoilage" → "wet, spoilage"
    .replace(/,(?:\s*,)+/g, ',') // ", ," → ","
    .replace(/,(?=[^\s\d])/gu, ', ') // ",Tiene" → ", Tiene" (leaves "1,5" alone)
    .replace(/(?:^|[\s,]+)because[\s,.]*$/i, '') // a "because" with nothing after it
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/^(?:el|la|las|los)\s+/i, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A note is read clause by clause, on squashed, folded text: punctuation and
// the conjunctions y / pero / e end a clause, and a negation or reassurance
// only speaks for its own clause.
const CLAUSE_BREAK = /[,.;]|\s(?:y|pero|e)\s/iu;
const clausesOf = (text) => fold(squash(text)).split(CLAUSE_BREAK);

// A negator cancels a marker at most two words after it ("no tiene nada de
// mold"), and "ni" carries it on ("no hay mold ni gusanos"). "sin embargo"
// means "however" and negates nothing.
const NEGATORS = 'no hay|no tiene|no trae|ya no|ni|sin(?! embargo(?!\\p{L}))';
const negatedBy = (negators) => new RegExp(`(?<!\\p{L})(?:${negators}) (?:[\\p{L}\\p{N}]+ ){0,2}$`, 'iu');
const NEGATED = negatedBy(NEGATORS);

// After a marker, in the same clause, these say the thing is fine ("la humedad
// del cuarto esta bien", "humedad normal") unless they are negated themselves
// ("no esta bien", "no es normal"). A bare "bien" counts only at the end of the
// clause: before another word it means "very" ("bien humedo"). "seco" (dry)
// speaks for moisture only ("hojas secas" is still leaf).
const FINE = 'estan? bien|bien(?= *$)|normal|ok';
const reassured = (terms) => new RegExp(`(?<!\\p{L})(?<!(?<!\\p{L})no (?:(?:esta|estan|es|son) )?)(?:${terms})(?!\\p{L})`, 'iu');
const REASSURED = reassured(FINE);
const REASSURED_DRY = reassured(`${FINE}|sec[oa]s?`);

// Theme markers, whole words on folded text, so "moldura" and "deshojando" are
// not markers. "umedo" is "humedo" with the h dropped, as the floor writes it.
const THEMES = [
  ['mold', words('molds?|moldy|moho'), REASSURED],
  ['worms', words('gusanos?|gusanitos?|worms?'), REASSURED],
  ['moisture', words('humed[oa]s?|humedad|umed[oa]s?|mojad[oa]s?|wet'), REASSURED_DRY],
  ['leaf', words('hojas?|leaf|leaves'), REASSURED],
];

/** True when some match of `re` in the clause is neither negated before it nor reassured after it. */
function live(clause, re, negated, reassuredAfter) {
  return [...clause.matchAll(re)].some(
    (m) => !negated.test(clause.slice(0, m.index)) && !reassuredAfter?.test(clause.slice(m.index + m[0].length)),
  );
}

/** The themes a note touches, always in the order mold, worms, moisture, leaf. */
export function themes(text) {
  const clauses = clausesOf(text);
  return THEMES.filter(([, re, fine]) => clauses.some((clause) => live(clause, re, NEGATED, fine))).map(([name]) => name);
}

// Spoilage needs the reflexive: "se echan a perder", "se va(n) a perder",
// "se van a echar a perder", or "(se) pueden echar a perder"; "la gente va a
// perder tiempo" is not spoilage. A plain "no" in front cancels it too.
const SPOILAGE = words('se (?:\\p{L}+ ){0,2}(?:ech\\p{L}*|van?) a perder|pueden? echar a perder|spoil\\p{L}*');
const SPOILAGE_NEGATED = negatedBy(`${NEGATORS}|no|nunca`);

const CREW_CHANGE = /\[Crew change[^\]]*\]/gi;

/**
 * A note → `{ kind: 'bad' | 'warn', text }`, or null when it is empty, only
 * crew-change markers, or nothing the card knows how to flag.
 */
export function classifyNote(text) {
  if (!text) return null;
  const stripped = squash(String(text).replace(CREW_CHANGE, ' ')).replace(/^[\s,]+|[\s,]+$/g, '');
  if (!stripped) return null;
  if (clausesOf(stripped).some((clause) => live(clause, SPOILAGE, SPOILAGE_NEGATED))) {
    return { kind: 'bad', text: translate(stripped) };
  }
  if (themes(stripped).length) return { kind: 'warn', text: translate(stripped) };
  return null;
}
