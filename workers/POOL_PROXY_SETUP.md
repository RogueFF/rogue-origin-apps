# Pool Inventory API Proxy Setup

This document explains how to configure the Pool Inventory API proxy in Cloudflare Workers.

## Overview

The `/api/pool` endpoint acts as a secure proxy to the external Pool Inventory API. It:
- Stores API credentials securely in Workers environment variables
- Prevents exposing the API key in client-side code
- Provides a consistent API interface

## Environment Variables Required

You need to configure two environment variables in Cloudflare Workers:

### 1. `POOL_INVENTORY_API_URL`
The base URL of the Pool Inventory Service API.

**Example:**
```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

### 2. `POOL_INVENTORY_API_KEY`
Your API key for authenticating with the Pool Inventory Service.

**Format:** Usually starts with `rp_prod_` or `rp_test_` depending on environment.

## Setup Instructions

### Option 1: Via Wrangler CLI (Recommended)

```bash
cd workers

# Set the API URL
npx wrangler secret put POOL_INVENTORY_API_URL
# When prompted, paste: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec

# Set the API key
npx wrangler secret put POOL_INVENTORY_API_KEY
# When prompted, paste your API key (e.g., rp_prod_abc123...)
```

### Option 2: Via Cloudflare Dashboard

1. Go to **Workers & Pages** in your Cloudflare dashboard
2. Select your worker: `rogue-origin-api`
3. Go to **Settings** → **Variables**
4. Click **Add variable** and add:
   - **Name:** `POOL_INVENTORY_API_URL`
   - **Value:** `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec`
   - **Type:** Secret (encrypted)
5. Click **Add variable** again and add:
   - **Name:** `POOL_INVENTORY_API_KEY`
   - **Value:** Your API key
   - **Type:** Secret (encrypted)
6. Click **Save and Deploy**

## Testing the Proxy

After setting up the environment variables, test the proxy:

### Health Check
```bash
curl https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool?action=health
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "Pool Inventory Proxy",
    "timestamp": "2026-01-26T..."
  }
}
```

### List Products
```bash
curl -X POST https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool?action=list_products \
  -H "Content-Type: application/json" \
  -d '{"poolType": "smalls"}'
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "action": "list_products",
    "poolType": "smalls",
    "environment": "production",
    "products": [...]
  }
}
```

## Supported Actions

The proxy supports three actions:

1. **`list_products`** - Get all products with pool metafields
   - Body: `{ "poolType": "smalls" | "tops" }`

2. **`update_pool`** - Update pool value for a product
   - Body: `{ "productId": "gid://...", "operation": "add" | "subtract" | "set", "amount": 100, "note": "...", "poolType": "smalls" | "tops" }`

3. **`get_recent_changes`** - Get audit log of recent changes
   - Body: `{ "count": 10, "productId": "gid://..." }`

## Frontend Integration

The frontend automatically uses the proxy:

```javascript
const POOL_API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool';

// Frontend makes requests WITHOUT the API key
const response = await fetch(`${POOL_API_URL}?action=list_products`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ poolType: 'smalls' })
});
```

The proxy automatically adds the API key from the environment variable.

## Security

- ✅ API key is stored as an encrypted secret in Cloudflare Workers
- ✅ API key is never exposed to client-side code
- ✅ All requests are validated before proxying
- ✅ Only allowed actions are proxied (list_products, update_pool, get_recent_changes)
- ✅ CORS headers are properly configured

## Troubleshooting

### Error: "Pool Inventory API URL not configured"
- Make sure `POOL_INVENTORY_API_URL` environment variable is set
- Verify the variable name is spelled correctly (case-sensitive)

### Error: "Pool Inventory API key not configured"
- Make sure `POOL_INVENTORY_API_KEY` environment variable is set
- Verify the variable name is spelled correctly (case-sensitive)

### Error: "Invalid action"
- Check that you're using one of the allowed actions: `list_products`, `update_pool`, `get_recent_changes`
- Verify the action is passed in the query string: `?action=list_products`

### Error: "External API Error"
- The external Pool Inventory API returned an error
- Check the error message for details
- Verify your API key is correct and not expired
- Verify the API URL is correct

## Deployment

After making changes to the proxy code:

```bash
cd workers
npx wrangler deploy
```

The proxy will be deployed to:
```
https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool
```

## Files

- `workers/src/handlers/pool.js` - Proxy handler implementation
- `workers/src/index.js` - Main router (includes `/api/pool` route)
- `src/js/hourly-entry/index.js` - Frontend integration (Scanner tab)
