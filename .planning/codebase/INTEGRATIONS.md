# External Integrations

**Analysis Date:** 2026-01-29

## APIs & External Services

**Google Sheets API:**
- Production data entry, order management, SOP templates, kanban supply tracking
  - SDK/Client: Custom REST client in `workers/src/lib/sheets.js` (JWT-based)
  - Auth: Service account with private key stored in `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`
  - Scope: `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/drive.readonly`
  - Endpoint: `https://sheets.googleapis.com/v4/spreadsheets`

**Anthropic Claude API:**
- AI-powered production analysis, SOP improvements, natural language chat in dashboard
  - SDK/Client: Direct REST API calls in `workers/src/handlers/production-d1.js`, `workers/src/handlers/sop-d1.js`
  - Auth: Bearer token via `ANTHROPIC_API_KEY` environment variable
  - Model: `claude-sonnet-4-20250514`
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - API Version: `2023-06-01` (Anthropic-Version header)

**Google Cloud Text-to-Speech:**
- Voice announcements for production milestones and alerts
  - SDK/Client: Direct REST API
  - Auth: API key via `GOOGLE_TTS_API_KEY` environment variable
  - Endpoint: `https://texttospeech.googleapis.com/v1/text:synthesize`

**Shopify Inventory Management:**
- Real-time inventory tracking through Shopify webhooks
  - Webhook Type: Flow webhook (custom inventory adjustments)
  - Secret Verification: Via `WEBHOOK_SECRET` environment variable
  - Endpoint: `POST /api/production?action=webhook` (Cloudflare Workers)
  - Data Flow: Shopify Flow → Workers → D1 `inventory_adjustments` table
  - Payload Format: Nested `{ product: {}, variant: {}, inventory: {}, context: {} }` or flat structure
  - Key Fields Captured: SKU, strain name, quantity adjusted, new total, previous total, event type, flow_run_id

**Pool Inventory Service (Internal):**
- Proxy service for pool/bulk inventory management
  - SDK/Client: REST API proxy in `workers/src/handlers/pool.js`
  - Auth: API key via `POOL_INVENTORY_API_KEY` environment variable
  - Base URL: Configured in `POOL_INVENTORY_API_URL` environment variable
  - Endpoint: `POST /api/pool` (Cloudflare Workers proxy)

## Data Storage

**Databases:**

**Cloudflare D1 (Primary - SQLite):**
- Type: Edge SQLite database
- Connection: Configured in `workers/wrangler.toml` with binding name `DB`
- Database ID: `31397aa4-aa8c-47c4-965d-d51d36be8b13`
- Schema: `workers/schema.sql` (15 tables)
- Tables:
  - **Production:** `inventory_adjustments` (from Shopify webhooks), `monthly_production` (hourly snapshots), `pause_log`, `shift_adjustments`, `scale_readings`
  - **Orders:** `orders`, `customers`, `shipments`, `payments`, `payment_shipment_links`, `price_history`, `coa_index`
  - **Operations:** `kanban_cards`, `sop_requests`, `sops`, `sop_settings`
  - **Barcode:** `products`
  - **Metadata:** `data_version` (smart polling cache), `production_tracking` (legacy)

**Google Sheets (Secondary - Production Entry Only):**
- Used for: Hourly production data entry, manual tracking
- Production Sheet ID: `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is`
- Tab Names:
  - `Rogue Origin Production Tracking` - Main production log
  - `Timer Pause Log` - Break timing adjustments
  - `Shift Adjustments` - Start time corrections
  - `Data` - Reference data
  - Monthly sheets: `YYYY-MM` format for historical tracking
- Orders Sheet ID: `1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw`
- Barcode Sheet ID: `1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE`
- Kanban Sheet ID: `19UW_tWY6c53lEydXqULAqC3Ffv1C20PDZMKnV6K-byQ`
- SOP Sheet ID: `1iCIObV6YwAdNq0YSjFqJdf7V1HTaQEiJhBWv8M43kmQ`

**File Storage:**
- GitHub Pages - Static assets (HTML, CSS, JS, images)
- Cloudflare CDN - Distributed edge caching for workers and assets

**Caching:**
- Smart polling via `data_version` table in D1 (version-based cache invalidation)
- In-memory state management on frontend (modules/state.js)

## Authentication & Identity

**Auth Provider:**
- Custom implementation (no OAuth provider)

**Approach:**
- Orders app: Password-protected (`ORDERS_PASSWORD` environment variable)
- Sheets API: JWT service account (not user-based)
- Shopify webhook: Secret key verification via `WEBHOOK_SECRET`
- All other apps: Open access (deployed on GitHub Pages, protected by GitHub credentials only)

## Monitoring & Observability

**Error Tracking:**
- Not integrated - Manual error review via browser console and Cloudflare Workers logs

**Logs:**
- Cloudflare Workers tail: `wrangler tail` command
- Browser console: For frontend debugging
- No external log aggregation (Datadog, LogRocket, etc.)

## CI/CD & Deployment

**Hosting:**
- Frontend: GitHub Pages (https://rogueff.github.io/rogue-origin-apps/)
- Backend: Cloudflare Workers (https://rogue-origin-api.roguefamilyfarms.workers.dev/api)

**CI Pipeline:**
- GitHub Actions: Auto-deploys frontend on push to main
- Manual: `wrangler deploy` for Cloudflare Workers
- Manual: Deployment via Google Apps Script editor for legacy production tracking

**Deployment Scripts:**
```bash
# Frontend: Auto-deployed by GitHub Actions on push
# Backend: Manual deployment
cd workers && npx wrangler deploy

# D1 schema (one-time setup)
npx wrangler d1 execute rogue-origin-db --remote --file=schema.sql
```

## Environment Configuration

**Required Environment Variables (Cloudflare Workers):**

| Variable | Purpose | Sensitive |
|----------|---------|-----------|
| `ANTHROPIC_API_KEY` | Claude API access | Yes |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Sheets auth | No |
| `GOOGLE_PRIVATE_KEY` | Google Sheets JWT signing | Yes |
| `GOOGLE_TTS_API_KEY` | Google Cloud text-to-speech | Yes |
| `WEBHOOK_SECRET` | Shopify webhook verification | Yes |
| `POOL_INVENTORY_API_KEY` | Pool Inventory Service proxy | Yes |
| `PRODUCTION_SHEET_ID` | Google Sheets ID | No |
| `ORDERS_SHEET_ID` | Google Sheets ID | No |
| `BARCODE_SHEET_ID` | Google Sheets ID | No |
| `KANBAN_SHEET_ID` | Google Sheets ID | No |
| `SOP_SHEET_ID` | Google Sheets ID | No |
| `ORDERS_PASSWORD` | Orders app authentication | Yes |

**Frontend Configuration:**
- API endpoint: `https://rogue-origin-api.roguefamilyfarms.workers.dev/api` (in `src/js/modules/config.js`)
- Fallback: `https://rogue-origin-apps-master.vercel.app/api` (Vercel Functions, commented out)

**Secrets Location:**
- Cloudflare: Via `wrangler secret put VARIABLE_NAME` (stored in Cloudflare dashboard)
- Production: `.env.production` (for Vercel deployment, not used in primary flow)

## Webhooks & Callbacks

**Incoming:**

**Shopify Inventory Webhook:**
- Path: `POST /api/production?action=webhook`
- Trigger: Inventory adjustments in Shopify
- Secret: `WEBHOOK_SECRET` environment variable
- Payload: JSON with product, variant, inventory, and context fields
- Processing:
  - Verification: Compares request header/param secret with `WEBHOOK_SECRET`
  - Storage: Dual-writes to D1 `inventory_adjustments` table and Google Sheets `Rogue Origin Production Tracking`
  - Normalization: Extracts strain name, calculates weights, timestamps from flow_run_id
  - Deduplication: Uses `flow_run_id` UNIQUE constraint to prevent duplicate records

**Outgoing:**
- Not implemented - No webhooks sent to external services
- Potential future: Shopify order creation webhook listener

## Feature Flags

**Migration Status (in `workers/src/index.js`):**
```javascript
const USE_D1_BARCODE = true;      // ✅ Using D1
const USE_D1_KANBAN = true;       // ✅ Using D1
const USE_D1_SOP = true;          // ✅ Using D1
const USE_D1_ORDERS = true;       // ✅ Using D1
const USE_D1_PRODUCTION = true;   // ✅ Using D1 for hourly entry reads/writes
```

## CORS & Network

**CORS Configuration (in `workers/wrangler.toml`):**
```
ALLOWED_ORIGINS = "https://rogueff.github.io,http://localhost:3000,http://localhost:5500"
```

**Content-Type Workaround:**
- POST requests use `text/plain` to avoid CORS preflight (browser quirk workaround)
- Actual data: JSON in request body

## API Rate Limits

- **Cloudflare Workers:** 100,000 free requests/day, unlimited paid
- **Google Sheets API:** 500 requests/min (10,000 unique users/day)
- **Anthropic Claude:** Rate limited by API key quota
- **Google Cloud TTS:** Per-project quotas (billing-based)

---

*Integration audit: 2026-01-29*
