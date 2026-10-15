// Shared by the Grove seed scripts (grove-seed-recipes, and later grove-seed-usage).
// Card ids are the kanban bag cards: 21 = 1 oz, 56 = 1/4–1/2 oz, 54 = 1 LB, 99 = 10 LB.

// Not preceded by a digit or a fraction ("1/"): keeps "1/4oz" off "4oz" and "11oz" off "1oz".
const B = String.raw`(?<!\d)(?<!\d/)`;
const LADDER = [
  // Most specific first.
  [99, new RegExp(`${B}10(lb|lbs|pound)`)],
  // 1/4 & 1/2 lb use the 1 LB bag — CONFIRM with Koa
  [54, new RegExp(`1/4(lb|pound)|1/2(lb|pound)|quarterpound|halfpound|${B}4oz|${B}8oz`)],
  [54, new RegExp(`${B}1(lb|lbs|pound)|${B}16oz`)],
  [56, new RegExp(`1/4(oz|ounce)|1/2(oz|ounce)|${B}7g|${B}14g|quarter|half`)],
  [21, new RegExp(`${B}1oz|${B}28g|ounce`)],
];

/** Bag card id for a variant title / SKU string, or 0 when it cannot be placed. */
export function cardFor(title) {
  const s = String(title || '').toLowerCase().replace(/\s+/g, '');
  for (const [card, re] of LADDER) if (re.test(s)) return card;
  return 0;
}

/** RFC 4180-ish CSV → array of rows (quoted fields, "" escapes, CRLF, newlines in quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
