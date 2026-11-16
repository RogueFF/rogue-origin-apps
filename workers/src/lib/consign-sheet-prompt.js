/**
 * Prompts and output schemas for reading a printed consignment sheet from a photo.
 * Pure: the same ctx always gives the same text. Only names in ctx reach the prompt,
 * so the handler decides what the model may see (one farm's sheet never lists another farm's).
 * The reply is still untrusted; consign-sheet.js normalizeSheetRead() bounds it.
 */

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const STR = nullable({ type: 'string' });

const weightBox = (withCheck) => obj({
  value: nullable({ type: 'number' }),
  unsure: { type: 'boolean' },
  ...(withCheck ? { check: { type: 'boolean' } } : {}),
});

export const DROPOFF_SCHEMA = obj({
  code: STR,
  farm: STR,
  date: STR,
  dropped_by: STR,
  note: STR,
  rows: {
    type: 'array',
    items: obj({
      cultivar: STR,
      cultivar_unsure: { type: 'boolean' },
      tops: weightBox(true),
      smalls: weightBox(true),
      note: STR,
    }),
  },
});

export const SCREEN_SCHEMA = obj({
  code: STR,
  rows: {
    type: 'array',
    items: obj({
      index: { type: 'integer' },
      cultivar: STR,
      type: nullable({ type: 'string', enum: ['tops', 'smalls'] }),
      pulled: weightBox(false),
      final: weightBox(false),
      to_smalls: weightBox(false),
      biomass: weightBox(false),
      mold: weightBox(false),
      finished: obj({ value: { type: 'boolean' }, unsure: { type: 'boolean' } }),
    }),
  },
});

const COMMON = `You read photos of a printed, hand-filled paper sheet for a hemp consignment ledger. The labels are printed in English with Spanish underneath. Handwriting may be in either language.

Rules for every number:
- Read only what is written. Never guess a digit. If you cannot read a box with confidence, return "value": null and "unsure": true.
- A box left empty is "value": null and "unsure": false.
- Weights are pounds. Return plain numbers (no units). A comma may be a decimal point.
- If a number was crossed out and rewritten, use the rewritten number; if you cannot tell which is final, mark it unsure.
- Copy the short code printed under the QR code (top right) into "code" exactly, or null if you cannot read it.
- Return JSON only, in the given schema.`;

/** Sheet A: one dropoff, rows of cultivar | tops lb | smalls lb | note. */
export function dropoffPrompt(ctx = {}) {
  const farms = (ctx.farms || []).map((f) => f.name);
  const cultivars = ctx.cultivars || [];
  const system = `${COMMON}

This is the DROPOFF sheet. Header boxes: Farm, Date, Dropped by. Then a table of rows: Cultivar | Tops lb | Smalls lb | Note. A footer box holds a dropoff note.
- One entry in "rows" per row that has anything written or ticked, top to bottom. Skip rows that are crossed out and rows that are completely empty.
- Some cultivar names may be printed already. Use the printed or written name. If a handwritten name is hard to read, give your best reading and set "cultivar_unsure": true.
- A check mark or tick in a weight box (no number) means the item came in but was not weighed yet: "value": null, "unsure": false, "check": true. Otherwise "check": false.
- "date" is YYYY-MM-DD when readable, else null.`;
  const user = [
    farms.length === 1
      ? `This sheet is for the farm: ${JSON.stringify(farms[0])}.`
      : `Known farm names (the farm box should be one of these): ${JSON.stringify(farms)}.`,
    cultivars.length ? `Known cultivar names for this farm: ${JSON.stringify(cultivars)}.` : 'No cultivar list is known; read names as written.',
    'Read the sheet in the photo.',
  ].join('\n');
  return { system, user, schema: DROPOFF_SCHEMA };
}

/** Sheet B: screening numbers for the open lots of one dropoff, in printed order. */
export function screenPrompt(ctx = {}) {
  const lots = (ctx.lots || []).map((l, i) => `${i + 1}. ${l.cultivar} (${l.type}), before ${l.remainder_lbs} lb`);
  const farm = (ctx.farms || [])[0];
  const system = `${COMMON}

This is the SCREENING sheet for one dropoff. Each numbered row is one lot, printed with cultivar, type and the pounds before screening. Handwritten boxes: Pulled | Final | To smalls | Biomass | Mold | Finished (a tick box).
- One entry in "rows" per printed row that has anything written or ticked. "index" is the printed row number (1, 2, 3...). Copy that row's printed cultivar and type.
- "To smalls" is greyed out on smalls rows; return null there.
- "finished.value" is true only when the Finished box is clearly ticked. If you cannot tell, value false and unsure true.
- A zero ("0") is a real number; a dash or empty box is null.
- Ignore the "weigh first" list at the bottom; it has no boxes.`;
  const user = [
    farm ? `Farm: ${JSON.stringify(farm.name)}.` : '',
    `Printed rows on this sheet:\n${lots.join('\n')}`,
    'Read the sheet in the photo.',
  ].filter(Boolean).join('\n');
  return { system, user, schema: SCREEN_SCHEMA };
}
