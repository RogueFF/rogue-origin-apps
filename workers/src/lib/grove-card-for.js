/**
 * Bag size → kanban card id. Shared by the Grove seed scripts (scripts/lib/
 * grove-card-for.mjs re-exports it) and the email parser (lib/grove-mail.js).
 * Card ids are the kanban bag cards: 21 = 1 oz, 56 = 1/4–1/2 oz, 54 = 1 LB,
 * 69 = 1 LB blank, 99 = 10 LB.
 */

// Not preceded by a digit or a fraction ("1/"): keeps "1/4oz" off "4oz" and "11oz" off "1oz".
const NOT_AFTER_DIGIT = String.raw`(?<!\d)(?<!\d/)`;
const LADDER = [
  // Most specific first.
  [99, new RegExp(`${NOT_AFTER_DIGIT}10(lb|lbs|pound)`)],
  // 1/4 & 1/2 lb assumed to use the 1 LB bag — open question, see design §12
  [54, new RegExp(`1/4(lb|pound)|1/2(lb|pound)|quarterpound|halfpound|${NOT_AFTER_DIGIT}(4|8)(oz|ounce)`)],
  [54, new RegExp(`${NOT_AFTER_DIGIT}1(lb|lbs|pound)|${NOT_AFTER_DIGIT}16(oz|ounce)`)],
  [56, new RegExp(`1/4(oz|ounce)|1/2(oz|ounce)|${NOT_AFTER_DIGIT}7g|${NOT_AFTER_DIGIT}14g|quarter(oz|ounce)|half(oz|ounce)`)],
  [21, new RegExp(`oneounce|${NOT_AFTER_DIGIT}1(oz|ounce)|${NOT_AFTER_DIGIT}28g`)],
];

/** The 1 LB card is the printed one; "blank" / "unprinted" 1 lb bags are card 69. */
const BLANK = /blank|unprinted|plain|nolabel|no-label|stock(?!ing)/;

/** Bag card id for a variant title / SKU / packing-slip line, or 0 when it cannot be placed. */
export function cardFor(title) {
  const s = String(title || '').toLowerCase().replace(/\s+/g, '');
  for (const [card, re] of LADDER) {
    if (!re.test(s)) continue;
    return card === 54 && BLANK.test(s) ? 69 : card;
  }
  return 0;
}
