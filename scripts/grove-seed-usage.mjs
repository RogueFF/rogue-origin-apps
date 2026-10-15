#!/usr/bin/env node
// Usage: node scripts/grove-seed-usage.mjs path/to/sales-by-variant-monthly.csv > /tmp/seed.sql
// Input: Shopify "Sales by product variant SKU" report exported BY MONTH. Needs a month column
// (Month / Day / Week / Date), Product variant ID, Product variant title, Product variant SKU and a
// quantity column (Net quantity / Net items sold / Quantity ordered / Ordered item quantity).
// Prints the header and exits 1 if any is missing.
//
// Emits one INSERT OR IGNORE per (month, variant) into kanban_usage with source='shopify:seed',
// dated the 15th at 12:00Z. 'shopify:seed' counts toward the season rate (rateSeason reads
// source NOT LIKE '%unmapped') but not toward "days of live ledger" (source='shopify').
// Unmapped / bad rows and a per-card monthly summary go to stderr; eyeball it
// (1 oz ~ 600/mo, ~1,000 in Nov) before applying.
//
// Apply:  cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=/tmp/seed.sql
// Safe to re-run: INSERT OR IGNORE + the unique index on (source, ref, card_id, variant_id) skip
// rows already there. (So a corrected CSV will NOT overwrite them: delete source='shopify:seed' first.)
import fs from 'node:fs';
import { parseCsv } from './lib/grove-card-for.mjs';
import { pickColumn, seedRows, monthlyTotals } from './lib/grove-seed-usage-lib.mjs';

const [,, file] = process.argv;
if (!file) { console.error('usage: node scripts/grove-seed-usage.mjs <sales-by-variant-monthly.csv>'); process.exit(1); }

const [head = [], ...lines] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const COLS = {
  month: ['Month', 'Day', 'Week', 'Date'],
  variantId: ['Product variant ID'],
  title: ['Product variant title'],
  sku: ['Product variant SKU'],
  qty: ['Net quantity', 'Net items sold', 'Quantity ordered', 'Ordered item quantity'],
};
const idx = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, pickColumn(head, c)]));
const missing = Object.keys(COLS).filter(k => idx[k] < 0).map(k => COLS[k].join(' / '));
if (missing.length) {
  console.error(`missing column(s): ${missing.join('; ')}\nheader was: ${head.join(' | ')}`);
  process.exit(1);
}

const records = lines
  .filter(cells => cells.some(c => c.trim()))
  .map(cells => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, cells[i] ?? ''])));
const { rows, unmapped, bad } = seedRows(records);

for (const b of bad) {
  const what = b.reason === 'id' ? 'ID' : b.reason.toUpperCase();
  console.log(`-- BAD ${what} ${b.variantId.replace(/\s+/g, ' ')}  -- ${b.title.replace(/\s+/g, ' ')}`);
}
for (const r of rows) console.log(r.sql);
for (const u of unmapped) console.error(`-- UNMAPPED ${u.variantId} ${u.title}`);

const NAMES = { 21: '1 oz', 56: '1/4&1/2 oz', 54: '1 lb', 99: '10 lb' };
console.error(`\n${rows.length} rows, ${unmapped.length} unmapped variants, ${bad.length} bad rows`);
for (const [month, cards] of Object.entries(monthlyTotals(rows))) {
  console.error(`${month}  ${Object.entries(cards).map(([c, q]) => `${NAMES[c] || c}: ${q}`).join('  ')}`);
}
