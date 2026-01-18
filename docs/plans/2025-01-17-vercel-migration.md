# Vercel Migration Plan

**Goal**: Migrate from Google Apps Script to Vercel Functions for faster API response times
**Approach**: Incremental, one app at a time, with rollback capability

---

## Migration Order

| Phase | App | Complexity | Notes |
|-------|-----|------------|-------|
| 0 | Setup & Tooling | Low | Foundation |
| 1 | Barcode | Low | ✅ Complete |
| 2 | Kanban | Low | ✅ Complete |
| 3 | SOP Manager | Medium | ✅ Complete |
| 4 | Orders | Medium | ✅ Complete |
| 5 | Production + Scoreboard | High | ✅ Complete |

---

## Phase 0: Setup & Tooling

- [x] Set up Google Service Account for Sheets API
- [x] Configure environment variables in Vercel dashboard
- [x] Test basic endpoint deploys
- [x] Run `npm install` in api/ folder

---

## Per-App Migration Steps

Repeat for each app:

### 1. Audit
- [ ] List all endpoints/actions in current Apps Script
- [ ] Document request/response shapes
- [ ] Note any side effects (emails, webhooks)

### 2. Build
- [ ] Create `api/{app}/index.js`
- [ ] Implement each action
- [ ] Add input validation
- [ ] Add error handling

### 3. Test
- [ ] Test each endpoint locally (`vercel dev`)
- [ ] Compare responses to Apps Script
- [ ] Check response times

### 4. Deploy
- [ ] Deploy to Vercel
- [ ] Update frontend `API_URL`
- [ ] Monitor for errors

### 5. Stabilize
- [ ] Keep Apps Script running for 1 week (rollback option)
- [ ] Document any issues in Lessons Learned

---

## Testing Checklist

Before each cutover:

```
[ ] Create → appears in Sheet
[ ] Read → matches Sheet data
[ ] Update → Sheet reflects change
[ ] Delete → removed from Sheet
[ ] Invalid input → clear error message
[ ] Response time < 500ms (warm)
```

---

## Debugging

### Local
```bash
vercel dev                    # Start local server
curl http://localhost:3000/api/barcode?action=test
```

### Production
```bash
vercel logs --follow          # Stream live logs
vercel logs --level error     # View errors only
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Works locally, fails in prod | Check env vars in Vercel dashboard |
| 502 errors | Sheets API failure - check logs |
| CORS errors | Check vercel.json headers |

---

## Rollback

If something breaks:

1. Update frontend `API_URL` back to Apps Script URL
2. `git push`
3. Done - Apps Script is still running

---

## Linting

```bash
npm run lint          # Check for errors
npm run lint:fix      # Auto-fix
```

Run before committing. Catches common bugs.

---

## Success Criteria

- [x] Response time < 500ms (vs 10-15s on Apps Script)
- [x] All endpoints working
- [ ] 1 week stable before removing Apps Script (monitoring period)

---

## Lessons Learned

### Phase 0: Setup
- Use `printf` not `echo` when setting env vars (avoids trailing newlines)
- Double-escaped newlines in private key need regex replacement: `key.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n')`

### Phase 1: Barcode
- Response format: Vercel wrapper `{success, data}` needs unwrapping in frontend
- Changed Content-Type from `text/plain` to `application/json` (Vercel handles CORS properly)

### Phase 2: Kanban
- Sheet names with special characters (dots, spaces) work fine without escaping
- Auto-fill from URL feature implemented with basic HTML parsing
- Added supplier detection from URL hostname (Amazon, Walmart, etc.)

### Phase 3: SOP Manager
- 12 endpoints: getSOPs, getRequests, getSettings, test, createSOP, updateSOP, deleteSOP, createRequest, updateRequest, deleteRequest, saveSettings, anthropic
- AI features use shared ANTHROPIC_API_KEY env var
- Steps stored as JSON in single column (not separate sheet)

### Phase 4: Orders
- 21 endpoints: validatePassword, getCustomers, getMasterOrders, getShipments, getPayments, getOrderFinancials, getPriceHistory, getCOAIndex, syncCOAIndex, getCOAsForStrains, test, saveCustomer, deleteCustomer, saveMasterOrder, deleteMasterOrder, saveShipment, deleteShipment, savePayment, deletePayment, updateOrderPriority
- Auth uses ORDERS_PASSWORD env var
- Sheet ID uses ORDERS_SHEET_ID env var (sheet: `1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw`)
- COA features use Drive API (same service account) - folder ID: `1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO`
- Changed Content-Type from `text/plain` to `application/json` for POST requests

### Phase 5: Production + Scoreboard
- 17 endpoints: test, scoreboard, dashboard, getOrders, getOrder, getScoreboardOrderQueue, setShiftStart, getShiftStart, morningReport, logBag, logPause, logResume, chat, feedback, tts, saveOrder, deleteOrder
- Sheet ID uses PRODUCTION_SHEET_ID env var (sheet: `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is`)
- AI chat uses ANTHROPIC_API_KEY env var (model: claude-sonnet-4-20250514)
- TTS uses GOOGLE_TTS_API_KEY env var for Google Cloud Text-to-Speech
- Scoreboard calculations ported: time slot multipliers, projections, targets, crew tracking
- Bag timer with cycle history, break detection, carryover bag support
- Complex date math for work schedule (7:00 AM - 4:30 PM, with breaks)
- Frontend files updated: scoreboard.html, scoreboard/api.js, scoreboard/config.js, modules/config.js, modules/api.js, modules/panels.js, modules/voice.js
- Response pattern: Vercel wrapper `{success, data}` unwrapped with `raw.data || raw`

---

## Documentation Protocol

After every session or major step:

1. **Update this file**
   - Check off completed tasks
   - Update "Current Phase" and "Last Updated"
   - Add to "Lessons Learned" if anything notable

2. **Update CLAUDE.md** (if relevant)
   - New API URLs
   - New environment variables
   - Changed architecture

3. **Update api/README.md** (if relevant)
   - New endpoints
   - Changed setup steps

4. **Commit with clear message**
   ```bash
   git add -A && git commit -m "docs: update migration progress - Phase X complete"
   ```

---

## Session Log

### 2025-01-17: Initial Setup
- Created api/ folder structure
- Added shared utilities (_lib/)
- Created migration plan
- Set up ESLint config

### 2025-01-18: Phase 0 Complete
- Installed Vercel CLI, logged in
- Created Vercel project, deployed hello endpoint
- Set up Google Service Account (`rogue-origin-vercel@rogue-origin-tts.iam.gserviceaccount.com`)
- Configured env vars (fixed trailing newline issues)
- Verified Sheets API connection works
- **Lesson**: Use `printf` not `echo` when setting env vars (avoids trailing newlines)

### 2025-01-18: Phase 1 Complete - Barcode App
- Audited Apps Script endpoints: products, test, add, update, delete, import
- Created `api/barcode/index.js` with full validation and error handling
- Deployed to Vercel: `https://rogue-origin-apps-master.vercel.app/api/barcode`
- Updated `src/pages/barcode.html` to use new API
- Fixed response unwrapping (`data.data || data` pattern)
- **Response times**: ~200-400ms (vs 10-15s on Apps Script)

### 2025-01-18: Phase 2 Complete - Kanban App
- Created `api/kanban/index.js` with 6 endpoints: cards, test, add, update, delete, fetchProduct
- Added `KANBAN_SHEET_ID` env var (sheet: `12.12 Supplies`)
- Updated `kanban-script.js` to use Vercel API
- Implemented auto-fill feature (fetches product info from URLs)

### 2025-01-18: Phase 3 Complete - SOP Manager
- Created `api/sop/index.js` with 12 endpoints including AI features
- Added `SOP_SHEET_ID` and `ANTHROPIC_API_KEY` env vars
- Sheet tabs: SOPs, SOP_Requests, SOP_Settings
- Updated `sop-manager.html` to use Vercel API
- **Next**: Phase 4 - Orders migration

### 2026-01-17: Phase 4 Complete - Orders
- Created `api/orders/index.js` with 21 endpoints
- Endpoints: validatePassword, getCustomers, getMasterOrders, getShipments, getPayments, getOrderFinancials, getPriceHistory, getCOAIndex, syncCOAIndex, getCOAsForStrains, test, saveCustomer, deleteCustomer, saveMasterOrder, deleteMasterOrder, saveShipment, deleteShipment, savePayment, deletePayment, updateOrderPriority
- Updated `orders.html` to use Vercel API
- Changed Content-Type from `text/plain` to `application/json`
- Added env vars: `ORDERS_SHEET_ID`, `ORDERS_PASSWORD`
- Added Drive API for COA features (uses same service account, folder shared with service account)
- **Next**: Phase 5 - Production + Scoreboard migration

### 2026-01-17: Phase 5 Complete - Production + Scoreboard
- Audited Apps Script endpoints (17 total actions)
- Created `api/production/index.js` (~1300 lines) with all endpoints
- Added env vars: `PRODUCTION_SHEET_ID`, `ANTHROPIC_API_KEY`, `GOOGLE_TTS_API_KEY`
- Ported complex scoreboard calculations (time slots, projections, targets)
- Ported bag timer logic with cycle history and break handling
- Ported AI chat with Anthropic API integration
- Ported TTS with Google Cloud Text-to-Speech
- Updated frontend files to use Vercel API:
  - `src/pages/scoreboard.html`
  - `src/js/scoreboard/api.js`
  - `src/js/scoreboard/config.js`
  - `src/js/modules/config.js`
  - `src/js/modules/api.js`
  - `src/js/modules/panels.js`
  - `src/js/modules/voice.js`
- Changed Content-Type from `text/plain` to `application/json`
- **Response times**: ~200-500ms (vs 10-15s on Apps Script cold starts)
- **Migration Complete**: All 5 phases finished

---

**Current Phase**: Complete (all phases migrated)
**Last Updated**: 2026-01-17
