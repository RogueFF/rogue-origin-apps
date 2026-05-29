// One-shot diagnostic for the 403 ext_authz_denied on /organizations.
// Mints an access token from JD_REFRESH_TOKEN, then dumps the FULL API-root
// catalog and the current-user resource so we can read JD's own authoritative
// 'connections' link (HATEOAS) instead of constructing one by hand.
//
// Usage (PowerShell, from workers/ — reuses the env vars already set):
//   node scripts/jd-debug-token.mjs
//
// Safe to delete once the 403 is resolved.

const TOKEN_ENDPOINT = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token';
const BASE = 'https://sandboxapi.deere.com/platform';

const clientId = process.env.JD_CLIENT_ID;
const clientSecret = process.env.JD_CLIENT_SECRET;
const refreshToken = process.env.JD_REFRESH_TOKEN;

if (!clientId || !clientSecret || !refreshToken) {
  console.error('Set JD_CLIENT_ID, JD_CLIENT_SECRET, JD_REFRESH_TOKEN env vars first.');
  process.exit(1);
}

const tokenResp = await fetch(TOKEN_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }),
});

const token = await tokenResp.json();
if (!tokenResp.ok) {
  console.error('Refresh failed:', tokenResp.status, JSON.stringify(token, null, 2));
  process.exit(1);
}
console.log('client_id in use:', clientId);
console.log('');

async function probe(path) {
  const resp = await fetch(BASE + path, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Accept': 'application/vnd.deere.axiom.v3+json',
    },
  });
  const body = await resp.text();
  console.log(`=== GET ${path || '/'}  ->  ${resp.status} (${resp.headers.get('response-code-details') || 'n/a'}) ===`);
  console.log(body);
  console.log('');
}

await probe('');                       // full API root catalog — look for a 'connections' rel
await probe('/users/@currentUser');    // current user resource + its links
await probe('/organizations');         // the call that 403s
