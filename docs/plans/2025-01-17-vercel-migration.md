# Vercel Migration Plan

**Goal**: Migrate from Google Apps Script to Vercel Functions for faster API response times
**Approach**: Incremental, one app at a time, with rollback capability

---

## Migration Order

| Phase | App | Complexity | Notes |
|-------|-----|------------|-------|
| 0 | Setup & Tooling | Low | Foundation |
| 1 | Barcode | Low | Pilot - learn the pattern |
| 2 | Kanban | Low | Simple CRUD |
| 3 | SOP Manager | Medium | Media uploads |
| 4 | Orders | Medium | Auth required |
| 5 | Production + Scoreboard | High | Shared backend, AI chat |

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

- [ ] Response time < 500ms (vs 10-15s on Apps Script)
- [ ] All endpoints working
- [ ] 1 week stable before removing Apps Script

---

## Lessons Learned

### Phase 0: Setup
- *TBD*

### Phase 1: Barcode
- *TBD*

### Phase 2: Kanban
- *TBD*

### Phase 3: SOP Manager
- *TBD*

### Phase 4: Orders
- *TBD*

### Phase 5: Production + Scoreboard
- *TBD*

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
- **Next**: Phase 1 - Barcode app migration

---

**Current Phase**: 1 - Barcode App
**Last Updated**: 2025-01-18
