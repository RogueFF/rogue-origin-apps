#!/usr/bin/env node
// Usage: node scripts/grove-seed-recipes.mjs path/to/sales-by-variant.csv > recipes.sql
// Input: Shopify "Sales by product variant SKU" report (needs a "Product variant ID" column).
// Infers the bag card from the variant title / SKU and prints one INSERT OR IGNORE line per
// distinct variant id, or "-- UNMAPPED <id>" when it cannot place it. Review before applying.
import fs from 'node:fs';
import { cardFor, parseCsv } from './lib/grove-card-for.mjs';

const [,, file] = process.argv;
if (!file) { console.error('usage: node scripts/grove-seed-recipes.mjs <sales-by-variant.csv>'); process.exit(1); }

const [head = [], ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const cols = head.map(c => c.trim().toLowerCase());
const idx = n => cols.indexOf(n.toLowerCase());
const iId = idx('Product variant ID'), iProduct = idx('Product title'), iTitle = idx('Product variant title'), iSku = idx('Product variant SKU');
if (iId < 0) {
  console.error(`need a "Product variant ID" column; header was: ${head.join(' | ')}`);
  process.exit(1);
}

const seen = new Map();
for (const cells of rows) {
  const id = (cells[iId] || '').trim();
  if (!id || seen.has(id)) continue;
  const title = [cells[iTitle], cells[iSku]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  // Inference uses variant title + SKU only; the product title just helps the reviewer.
  const label = [cells[iProduct], title].filter(Boolean).join(' / ').replace(/\s+/g, ' ').trim();
  seen.set(id, { label, card: cardFor(title) });
}

for (const [id, v] of seen) {
  const sql = !/^\d+$/.test(id) ? `-- BAD ID ${id.replace(/\s+/g, ' ')}`
    : v.card ? `INSERT OR IGNORE INTO kanban_recipes (variant_id, card_id, qty) VALUES ('${id}', ${v.card}, 1);`
    : `-- UNMAPPED ${id}`;
  console.log(`${sql}  -- ${v.label}`);
}
