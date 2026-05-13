/**
 * John Deere Operations Center API client
 *
 * Wraps OAuth 2.0 refresh-token flow + authenticated REST calls.
 * Used by the JD telemetry ingest cron (workers/src/handlers/jd-ingest.js)
 * and one-shot scripts (workers/scripts/jd-*.mjs).
 *
 * Phase 1 of the Field Ops Tracking system.
 * Companion design: docs/plans/2026-05-13-field-ops-tracking-design.md (wiki repo).
 *
 * Auth endpoints reference:
 *   https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/{authorize,token}
 */

const BASE_URLS = {
  sandbox: 'https://sandboxapi.deere.com/platform',
  production: 'https://partnerapi.deere.com/platform',
};

const TOKEN_ENDPOINT = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token';

export class JDApi {
  constructor(env) {
    const jdEnv = env.JD_ENV || 'sandbox';
    this.baseUrl = BASE_URLS[jdEnv];
    if (!this.baseUrl) throw new Error(`Unknown JD_ENV: ${jdEnv}`);

    this.clientId = env.JD_CLIENT_ID;
    this.clientSecret = env.JD_CLIENT_SECRET;
    this.refreshToken = env.JD_REFRESH_TOKEN;
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new Error('JDApi: missing JD_CLIENT_ID / JD_CLIENT_SECRET / JD_REFRESH_TOKEN');
    }

    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async refresh() {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`JD token refresh failed ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    this.accessToken = data.access_token;
    // 60s safety margin before actual expiry
    this.accessTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    // JD may rotate the refresh token; respect the new one if returned
    if (data.refresh_token) this.refreshToken = data.refresh_token;
  }

  async ensureFreshToken() {
    if (!this.accessToken || Date.now() >= this.accessTokenExpiresAt) {
      await this.refresh();
    }
  }

  async get(path, params = {}) {
    await this.ensureFreshToken();

    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.deere.axiom.v3+json',
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`JD GET ${path} failed ${resp.status}: ${text}`);
    }
    return resp.json();
  }
}
