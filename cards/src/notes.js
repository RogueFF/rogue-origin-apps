// Floor notes → card flags. The crew writes short Spanish notes into the hourly
// log; the card shows the ones it can classify, translated by a small phrase
// table. Rule-based on purpose: no AI, the same note always gives the same flag.

// Phrase table: Spanish (lower case, single-spaced) → English. Longer phrases
// win over the words inside them. A leading ", " marks a phrase that starts a
// new clause, since the floor runs clauses together without punctuation.
const PHRASES = {
  'piensen que se va aser porque se pueden echar a perder': ', spoilage risk, need a plan',
  'piensen que se va a hacer porque se pueden echar a perder': ', spoilage risk, need a plan',
  'no se está pasando por el costal': 'not going through the sack',
  'no se esta pasando por el costal': 'not going through the sack',
  'porque se pueden echar a perder': ', spoilage risk',
  'se pueden echar a perder': ', spoilage risk',
  'echar a perder': 'spoil',
  'piensen que se va aser': ', need a plan',
  'piensen que se va a hacer': ', need a plan',
  'que quedaron a vajo': 'stored below',
  'que quedaron abajo': 'stored below',
  'estan muy humedas': 'are very wet',
  'están muy húmedas': 'are very wet',
  'esta muy humedo': 'is very wet',
  'está muy húmedo': 'is very wet',
  'trae un poquito de': 'a bit of',
  'un poquito de': 'a bit of',
  'algunos': 'some',
  'mucha hoja': 'a lot of leaf',
  'mucho hoja': 'a lot of leaf',
  'mucho mold': 'a lot of mold',
  'mucho gusano': 'a lot of worms',
  'muchos gusanos': 'a lot of worms',
  'gusanos': 'worms',
  'gusano': 'worm',
  'humedo': 'wet',
  'húmedo': 'wet',
  'humedas': 'wet',
  'húmedas': 'wet',
  'humeda': 'wet',
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

// One pass, longest phrase first, whole words only (Unicode-aware, so "húmedo"
// is one word), so English output is never matched again.
const PHRASE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.keys(PHRASES).sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
);

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Spanish floor note → readable English. Unknown words are kept as written. */
export function translate(text) {
  let s = squash(text).replace(PHRASE_RE, (m) => PHRASES[m.toLowerCase()] ?? m);
  s = s
    .replace(/\s+,/g, ',') // "wet , spoilage" → "wet, spoilage"
    .replace(/,(?:\s*,)+/g, ',') // ", ," → ","
    .replace(/,(?=[^\s\d])/gu, ', ') // ",Tiene" → ", Tiene" (leaves "1,5" alone)
    .replace(/(?:^|[\s,]+)because[\s,.]*$/i, '') // a "because" with nothing after it
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/^(?:el|la|las|los)\s+/i, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const THEMES = [
  ['mold', /mold/iu],
  ['worms', /gusano|worm/iu],
  ['moisture', /humed|húmed|wet/iu],
  ['leaf', /hoja|leaf/iu],
];

/** The themes a note touches, always in the order mold, worms, moisture, leaf. */
export function themes(text) {
  const s = String(text ?? '');
  return THEMES.filter(([, re]) => re.test(s)).map(([name]) => name);
}

const CREW_CHANGE = /\[Crew change[^\]]*\]/gi;

/**
 * A note → `{ kind: 'bad' | 'warn', text }`, or null when it is empty, only
 * crew-change markers, or nothing the card knows how to flag.
 */
export function classifyNote(text) {
  if (!text) return null;
  const stripped = squash(String(text).replace(CREW_CHANGE, ' ')).replace(/^[\s,]+|[\s,]+$/g, '');
  if (!stripped) return null;
  if (/echar a perder|spoil/i.test(stripped)) return { kind: 'bad', text: translate(stripped) };
  if (themes(stripped).length) return { kind: 'warn', text: translate(stripped) };
  return null;
}
