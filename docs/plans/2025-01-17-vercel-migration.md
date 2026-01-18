# Vercel Migration Plan

**Date**: 2025-01-17
**Goal**: Migrate from Google Apps Script to Vercel Functions for 50-100x faster API response times
**Approach**: Incremental, one app at a time, with rollback capability

---

## Critical Mindset

> "You're a senior dev doing a code review and you HATE this implementation. What would you criticize? What edge cases am I missing?"

Apply this lens at every step. Document what could go wrong before it does.

---

## Migration Order

| Phase | App | Risk Level | Why This Order |
|-------|-----|------------|----------------|
| 0 | Setup & Tooling | Low | Foundation first |
| 1 | Barcode | Low | Simplest app, learn the pattern |
| 2 | Kanban | Low | Simple CRUD, no auth |
| 3 | SOP Manager | Medium | Media uploads, more complex |
| 4 | Orders | Medium | Auth, financial data, must be bulletproof |
| 5 | Production + Scoreboard | High | Shared backend, AI chat, most complex |

---

## Phase 0: Setup & Tooling

### Tasks

- [ ] Initialize npm project in repo root
- [ ] Install dependencies (googleapis, etc.)
- [ ] Create `api/_lib/` shared utilities
- [ ] Set up ESLint + Prettier
- [ ] Create `vercel.json` configuration
- [ ] Set up Google Service Account for Sheets API
- [ ] Configure environment variables locally
- [ ] Test basic "hello world" endpoint deploys

### Critical Review Questions

| Question | Why It Matters |
|----------|----------------|
| Is the service account least-privilege? | Don't give write access if only reading |
| Are secrets in `.env.local` and `.gitignore`? | Leaked credentials = game over |
| Does CORS config allow only your domains? | Open CORS = anyone can call your API |
| Is there rate limiting? | No limits = abuse potential |

### Edge Cases to Handle

- What if Google Sheets API is down?
- What if env vars are missing at runtime?
- What if request body is malformed JSON?
- What if request body is 100MB? (need size limits)

---

## Phase 1: Barcode App (Pilot)

### Current Apps Script Functions

```
apps-script/barcode-manager/Code.gs
- doGet(e) → routes by action param
- doPost(e) → handles writes
- getBarcodes() → read all
- createBarcode() → generate new
- validateBarcode() → format check
```

### Migration Steps

1. **Audit existing code**
   - [ ] List all endpoints/actions
   - [ ] Document request/response shapes
   - [ ] Identify validation rules
   - [ ] Note any side effects (emails, webhooks)

2. **Write Vercel function**
   - [ ] Create `api/barcode/index.js`
   - [ ] Implement each action
   - [ ] Add input validation
   - [ ] Add error handling
   - [ ] Add logging

3. **Testing**
   - [ ] Unit tests for each action
   - [ ] Integration test against real Sheets
   - [ ] Load test (10 concurrent requests)
   - [ ] Error scenario tests

4. **Deploy & Verify**
   - [ ] Deploy to Vercel preview
   - [ ] Test all endpoints manually
   - [ ] Compare responses to Apps Script
   - [ ] Check response times

5. **Cutover**
   - [ ] Update frontend API_URL
   - [ ] Deploy frontend
   - [ ] Monitor for errors
   - [ ] Keep Apps Script running (rollback)

6. **Stabilize**
   - [ ] Monitor for 48 hours
   - [ ] Fix any issues found
   - [ ] Document lessons learned
   - [ ] Delete Apps Script deployment (after 1 week stable)

### Critical Review Questions

| Question | Why It Matters |
|----------|----------------|
| Does validation match Apps Script exactly? | Different validation = different bugs |
| Are error messages identical? | Frontend may parse error text |
| Is the response shape identical? | `{data: [...]}` vs `[...]` breaks things |
| What if barcode already exists? | Duplicate handling |
| What if Sheet is locked for editing? | Concurrent access |

### Edge Cases

- Empty barcode string
- Barcode with special characters (`=`, `+`, `/`)
- Very long barcode (1000+ chars)
- Non-ASCII characters (Spanish text)
- Sheet at row limit (10M cells)
- Request during Sheet compaction

---

## Testing Protocol

### For Every Endpoint

```
1. HAPPY PATH
   - Valid input → expected output
   - Verify data written to Sheet correctly

2. VALIDATION ERRORS
   - Missing required fields → 400 + clear message
   - Wrong types → 400 + clear message
   - Out of range values → 400 + clear message

3. AUTH ERRORS (if applicable)
   - No password → 401
   - Wrong password → 401
   - Expired token → 401

4. EXTERNAL FAILURES
   - Sheets API down → 502 + retry guidance
   - Sheets API slow (>10s) → timeout handling
   - Sheets API rate limit → 429 + backoff

5. EDGE CASES
   - Empty arrays/objects
   - Unicode/emoji
   - Very large payloads
   - Concurrent writes to same row
   - Request during deploy

6. SECURITY
   - SQL/formula injection attempts
   - XSS in input fields
   - Path traversal in IDs
   - CORS from unauthorized origin
```

### Test Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- api/barcode.test.js

# Run tests matching pattern
npm test -- -t "validation"

# Watch mode during development
npm test -- --watch
```

### Manual Smoke Test Checklist

Before every cutover:

```
[ ] Create new record → appears in Sheet
[ ] Read record → matches Sheet data
[ ] Update record → Sheet reflects change
[ ] Delete record → removed from Sheet
[ ] Invalid input → clear error message
[ ] No auth (if required) → 401 response
[ ] Wrong auth → 401 response
[ ] Response time < 500ms (warm)
[ ] Response time < 3s (cold start)
```

---

## Debugging Protocol

### Local Development

```bash
# Start local server
vercel dev

# Watch logs in real-time
# (logs appear in terminal automatically)

# Test endpoint
curl -X POST http://localhost:3000/api/barcode \
  -H "Content-Type: application/json" \
  -d '{"action": "test"}'
```

### Production Debugging

```bash
# Stream live logs
vercel logs --follow

# View recent errors
vercel logs --level error

# View specific deployment
vercel logs [deployment-url]

# Get deployment info
vercel inspect [deployment-url]
```

### Debug Checklist

When something breaks:

```
1. REPRODUCE
   [ ] Can you reproduce locally?
   [ ] What exact request causes it?
   [ ] Does it happen every time or intermittently?

2. ISOLATE
   [ ] Is it the API or the frontend?
   [ ] Is it Vercel or Google Sheets?
   [ ] Is it code or configuration?

3. LOGS
   [ ] Check Vercel function logs
   [ ] Check browser console
   [ ] Check Network tab for request/response

4. COMPARE
   [ ] Does the same request work on Apps Script?
   [ ] Did it work before? What changed?

5. FIX
   [ ] Fix in local first
   [ ] Write a test that catches the bug
   [ ] Deploy to preview, verify fix
   [ ] Deploy to production
```

### Common Gotchas

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Works locally, fails in prod | Missing env var | Check Vercel dashboard |
| 502 errors | Sheets API failure | Add retry logic |
| Slow cold starts | Large dependencies | Reduce bundle size |
| CORS errors | Missing headers | Check vercel.json |
| Auth always fails | Env var has quotes | Remove surrounding quotes |
| Data mismatch | Sheet column order changed | Use column headers, not indices |

---

## Linting Protocol

### ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Errors (must fix)
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',

    // Security
    'no-new-func': 'error',

    // Code quality
    'no-var': 'error',
    'prefer-const': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',

    // Async
    'no-async-promise-executor': 'error',
    'no-await-in-loop': 'warn',
    'require-await': 'error',
  },
};
```

### Lint Commands

```bash
# Check for errors
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Check specific file
npx eslint api/barcode/index.js

# Check with verbose output
npx eslint api/ --format stylish
```

### Pre-Commit Hook

```bash
# Install husky
npm install --save-dev husky lint-staged

# Setup hooks
npx husky install
npx husky add .husky/pre-commit "npx lint-staged"
```

```json
// package.json
{
  "lint-staged": {
    "api/**/*.js": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

### Lint Checklist

Before every commit:

```
[ ] npm run lint passes with no errors
[ ] No TODO comments without issue links
[ ] No commented-out code blocks
[ ] No hardcoded secrets or IDs
[ ] No console.log (use proper logging)
[ ] All functions have error handling
[ ] All inputs are validated
```

---

## Rollback Protocol

If migration fails:

### Immediate (< 5 min)

1. Update frontend `API_URL` back to Apps Script
2. Deploy frontend: `git push`
3. Verify site works

### Root Cause (same day)

1. Check Vercel logs for errors
2. Reproduce issue locally
3. Document what went wrong
4. Fix and add regression test

### Re-attempt (next day)

1. Deploy fix to Vercel preview
2. Test thoroughly
3. Try cutover again with monitoring

---

## Success Criteria

### Per-Endpoint

- [ ] Response time < 500ms (warm)
- [ ] Response time < 3s (cold start)
- [ ] All tests passing
- [ ] No lint errors
- [ ] Error handling for all failure modes
- [ ] Logging for debugging
- [ ] Input validation complete

### Per-App

- [ ] All endpoints migrated
- [ ] Frontend updated and deployed
- [ ] 48 hours stable in production
- [ ] Response times documented
- [ ] Rollback tested
- [ ] Team notified of new URLs

### Overall

- [ ] All 5 apps migrated
- [ ] Apps Script deployments removed
- [ ] Documentation updated
- [ ] Total response time improvement measured

---

## Lessons Learned

*Update this section after each phase*

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

## Timeline

No time estimates - work through phases sequentially. Each phase is complete when all success criteria are met, regardless of calendar time.

**Current Phase**: 0 - Setup & Tooling
**Last Updated**: 2025-01-17
