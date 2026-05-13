// One-shot: list JD orgs to find your sandbox/prod org ID.
//
// Usage (from workers/):
//
//   JD_CLIENT_ID=... JD_CLIENT_SECRET=... JD_REFRESH_TOKEN=... node scripts/jd-list-orgs.mjs
//
// On Windows PowerShell:
//
//   $env:JD_CLIENT_ID = "..."
//   $env:JD_CLIENT_SECRET = "..."
//   $env:JD_REFRESH_TOKEN = "..."
//   node scripts/jd-list-orgs.mjs
//
// Defaults JD_ENV to "sandbox". Pass JD_ENV=production to hit live.
//
// Once you find your org ID, stash it:
//   npx wrangler secret put JD_ORG_ID

import { JDApi } from '../src/lib/jd-api.js';
import { listOrganizations } from '../src/lib/jd-endpoints.js';

const env = {
  JD_ENV: process.env.JD_ENV || 'sandbox',
  JD_CLIENT_ID: process.env.JD_CLIENT_ID,
  JD_CLIENT_SECRET: process.env.JD_CLIENT_SECRET,
  JD_REFRESH_TOKEN: process.env.JD_REFRESH_TOKEN,
};

const api = new JDApi(env);
const orgs = await listOrganizations(api);

console.log(`\nFound ${orgs.length} org(s) on ${env.JD_ENV}:\n`);
for (const o of orgs) {
  console.log(`  id: ${o.id}    name: ${o.name}    type: ${o.type}`);
}
console.log('');
