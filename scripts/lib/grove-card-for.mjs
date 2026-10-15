// Shared by the Grove seed scripts (grove-seed-recipes, grove-seed-usage).
// cardFor itself lives in the worker now (workers/src/lib/grove-card-for.js) so
// the email parser and the seed scripts place a bag size the same way.
export { cardFor } from '../../workers/src/lib/grove-card-for.js';

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
