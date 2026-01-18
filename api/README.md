# Vercel Functions API

Backend API endpoints migrated from Google Apps Script to Vercel Functions.

## Architecture

```
Frontend (GitHub Pages)  →  Vercel Functions  →  Google Sheets API
     src/pages/*.html          /api/*               Sheets as DB
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create `.env.local` for local development:

```env
# Google Sheets API
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Sheet IDs (from CLAUDE.md)
PRODUCTION_SHEET_ID=1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is
BARCODE_SHEET_ID=1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE
ORDERS_SHEET_ID=1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw

# Auth
API_PASSWORD=your-password-here
ANTHROPIC_API_KEY=sk-ant-...
```

Set these in Vercel Dashboard → Project → Settings → Environment Variables.

### 3. Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Run locally (mirrors production)
vercel dev
```

### 4. Deployment

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

## Folder Structure

```
api/
├── barcode/           # Barcode label printing
│   └── index.js       # → /api/barcode
├── kanban/            # Task board
│   └── index.js       # → /api/kanban
├── sop/               # Standard Operating Procedures
│   └── index.js       # → /api/sop
├── orders/            # Wholesale orders
│   └── index.js       # → /api/orders
├── production/        # Production tracking + AI (last to migrate)
│   └── index.js       # → /api/production
├── _lib/              # Shared utilities
│   ├── sheets.js      # Google Sheets client
│   ├── auth.js        # Password validation
│   ├── errors.js      # Error handling
│   └── validate.js    # Input validation
└── README.md
```

## API Conventions

### Request/Response Format

```javascript
// All endpoints accept POST with JSON body
// or GET with query params

// Success response
{ "success": true, "data": { ... } }

// Error response
{ "success": false, "error": "Human-readable message", "code": "ERROR_CODE" }
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid password |
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `NOT_FOUND` | 404 | Resource not found |
| `SHEETS_ERROR` | 502 | Google Sheets API failure |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Input Validation

All endpoints validate input before processing:

```javascript
// Example: orders endpoint
const schema = {
  orderID: { type: 'string', pattern: /^MO-\d{4}-\d{3}$/ },
  customerName: { type: 'string', maxLength: 100 },
  commitment: { type: 'number', min: 0 }
};
```

## Testing

### Run Tests

```bash
# All tests
npm test

# Specific endpoint
npm test -- api/barcode

# Watch mode
npm test -- --watch
```

### Test Structure

```
tests/
├── api/
│   ├── barcode.test.js
│   ├── kanban.test.js
│   └── ...
├── _lib/
│   ├── sheets.test.js
│   └── validate.test.js
└── fixtures/
    └── mock-data.js
```

### Manual Testing

```bash
# Test locally running endpoint
curl -X POST http://localhost:3000/api/barcode \
  -H "Content-Type: application/json" \
  -d '{"action": "test"}'
```

## Debugging

### Local Logs

```bash
# Vercel dev shows logs in terminal
vercel dev

# Verbose mode
DEBUG=* vercel dev
```

### Production Logs

```bash
# Stream production logs
vercel logs --follow

# View specific deployment logs
vercel logs [deployment-url]
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `GOOGLE_PRIVATE_KEY` error | Newlines escaped wrong | Use double quotes, literal `\n` |
| 401 on all requests | Env var not set in Vercel | Check Dashboard → Settings |
| CORS errors | Missing headers | Check `vercel.json` config |
| Cold starts slow | First request after idle | Use `vercel.json` regions config |

## Linting

```bash
# Run ESLint
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

ESLint config enforces:
- No unused variables
- Consistent error handling
- Input validation on all endpoints
- No console.log in production (use structured logging)

## Migration Status

| App | Status | Endpoint | Notes |
|-----|--------|----------|-------|
| Barcode | Pending | `/api/barcode` | Pilot migration |
| Kanban | Pending | `/api/kanban` | |
| SOP Manager | Pending | `/api/sop` | |
| Orders | Pending | `/api/orders` | |
| Production | Pending | `/api/production` | Shared with Scoreboard, AI chat |

## Rollback

If migration fails, revert frontend to Apps Script URL:

```javascript
// In frontend code
const API_URL = 'https://script.google.com/...'; // Old Apps Script
// const API_URL = 'https://yoursite.vercel.app/api'; // New Vercel
```

No backend changes needed - Apps Script stays deployed.
