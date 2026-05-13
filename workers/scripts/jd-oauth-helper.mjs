// JD OAuth helper — one-shot local script to obtain a refresh token.
//
// Usage (from workers/ dir):
//
//   JD_CLIENT_ID=xxxx JD_CLIENT_SECRET=yyyy node scripts/jd-oauth-helper.mjs
//
// On Windows PowerShell:
//
//   $env:JD_CLIENT_ID = "xxxx"
//   $env:JD_CLIENT_SECRET = "yyyy"
//   node scripts/jd-oauth-helper.mjs
//
// Opens a browser to the JD auth page; once you approve, the script
// captures the auth code on http://localhost:9090/callback and exchanges
// it for a refresh token. Prints the refresh token to stdout — DO NOT
// log this anywhere persistent.
//
// Next step: stash the printed refresh_token in CF Worker secrets:
//   npx wrangler secret put JD_REFRESH_TOKEN
//   (paste the value when prompted)
//
// Phase 1, Task 4 of 11.
// Companion: docs/plans/2026-05-13-field-ops-tracking-design.md

import http from 'node:http';
import { URL } from 'node:url';

const CLIENT_ID = process.env.JD_CLIENT_ID;
const CLIENT_SECRET = process.env.JD_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set JD_CLIENT_ID and JD_CLIENT_SECRET as env vars before running.');
  console.error('Get these from your app at https://developer.deere.com/');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:9090/callback';
const AUTH_ENDPOINT = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize';
const TOKEN_ENDPOINT = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token';

// Broad read scopes — refine after first prod-data observation if needed.
// `offline_access` is required to get a refresh_token back.
const SCOPES = 'ag1 ag2 ag3 eq1 eq2 offline_access';

const state = Math.random().toString(36).slice(2);

const authUrl = new URL(AUTH_ENDPOINT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('state', state);

console.log('\n1. Open this URL in your browser and authorize:\n');
console.log('   ' + authUrl.toString() + '\n');
console.log('2. After approving, JD will redirect to http://localhost:9090/callback');
console.log('   (this script is listening for that callback)\n');
console.log('Waiting...\n');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:9090');
  if (u.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }

  const code = u.searchParams.get('code');
  const returnedState = u.searchParams.get('state');
  const errorParam = u.searchParams.get('error');

  if (errorParam) {
    console.error('\nJD returned an error:', errorParam, u.searchParams.get('error_description') || '');
    res.writeHead(400).end(`Error: ${errorParam}`);
    server.close();
    process.exit(1);
  }

  if (!code || returnedState !== state) {
    res.writeHead(400).end('missing code or state mismatch');
    console.error('\nMissing code or state mismatch in callback.');
    server.close();
    process.exit(1);
  }

  const tokenResp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const data = await tokenResp.json();
  if (!tokenResp.ok) {
    console.error('\nToken exchange failed:', JSON.stringify(data, null, 2));
    res.writeHead(500).end('Token exchange failed — see terminal');
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Token obtained. You can close this tab and return to the terminal.');

  console.log('\n=== SUCCESS ===\n');
  console.log('refresh_token (copy this):\n');
  console.log('  ' + data.refresh_token + '\n');
  console.log('access_token (short-lived, for debug only):');
  console.log('  ' + data.access_token + '\n');
  console.log(`expires_in: ${data.expires_in} seconds`);
  console.log(`scope: ${data.scope}\n`);
  console.log('Next steps — store secrets in CF Worker:\n');
  console.log('  npx wrangler secret put JD_CLIENT_ID');
  console.log('  npx wrangler secret put JD_CLIENT_SECRET');
  console.log('  npx wrangler secret put JD_REFRESH_TOKEN');
  console.log('  npx wrangler secret put JD_ENV          # type: sandbox');
  console.log('\nThen run scripts/jd-list-orgs.mjs to find your org ID, and:');
  console.log('  npx wrangler secret put JD_ORG_ID\n');

  server.close();
});

server.listen(9090, () => {
  // server up; main flow blocks until callback arrives
});
