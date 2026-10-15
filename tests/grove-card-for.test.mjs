import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFor, parseCsv } from '../scripts/lib/grove-card-for.mjs';

const CASES = [
  ['Sour Lifter / 1 oz', 21],
  ['Lifter 1 OZ', 21],
  ['28g', 21],
  ['One Ounce', 21],
  ['Lifter 1/4 oz', 56],
  ['1/2 oz', 56],
  ['7g', 56],
  ['14 g', 56],
  ['Quarter', 56],
  ['Half Ounce', 56],
  ['Lifter 1 LB', 54],
  ['16 oz', 54],
  ['1/4 lb', 54],
  ['Half Pound', 54],
  ['4 oz', 54],
  ['8oz', 54],
  ['10 lbs', 99],
  ['Bulk 10 LB', 99],
  ['Sticker Pack', 0],
  ['1/8 oz', 0],
  ['17g', 0],
];
for (const [title, card] of CASES) {
  test(`cardFor(${JSON.stringify(title)}) → ${card}`, () => assert.equal(cardFor(title), card));
}

test('parseCsv handles quoted fields with commas, escaped quotes and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""",3\r\n,,\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', '3'], ['', '', '']]);
});
test('parseCsv handles a newline inside a quoted field', () => {
  assert.deepEqual(parseCsv('a\n"line1\nline2"\n'), [['a'], ['line1\nline2']]);
});
