# AI Manager Backend Caching Issue - Solution Guide

**Problem:** Backend API requires **2x hard refresh** (Ctrl+Shift+R) before connecting
**Root Cause:** Double-layer caching (Browser Cache + Service Worker)
**Impact:** Poor user experience, appears broken on first load

---

## 🔍 Why This Happens

### Caching Layers
```
User Request
    ↓
Browser Cache (Layer 1)
    ↓
Service Worker Cache (Layer 2)
    ↓
Network Request → Apps Script Backend
```

**First Ctrl+Shift+R:**
- ✅ Clears browser cache (Layer 1)
- ❌ Service Worker cache still has old response (Layer 2)
- Result: Still fails

**Second Ctrl+Shift+R:**
- ✅ Forces service worker bypass
- ✅ Fresh network request
- Result: Works!

---

## 🛠️ Permanent Solutions

### Solution 1: Disable Service Worker for API Calls (Recommended)

**File:** Check if you have a service worker file (`sw.js` or `service-worker.js`)

If found, update it to exclude API calls:

```javascript
// In your service-worker.js or sw.js
self.addEventListener('fetch', (event) => {
  // Don't cache API calls to Apps Script
  if (event.request.url.includes('script.google.com')) {
    return; // Let it pass through to network
  }

  // Cache other resources normally
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

**If you don't have a service worker:** Great! Skip to Solution 2.

**To check if service worker exists:**
```bash
cd /c/Users/Rogue/OneDrive/Desktop/Dev/rogue-origin-apps-master
find . -name "sw.js" -o -name "service-worker.js" -o -name "serviceworker.js"
```

---

### Solution 2: Add Cache-Busting to API URL

**File:** `src/js/modules/config.js`

**Before:**
```javascript
export const API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
```

**After (Option A - Build-time cache bust):**
```javascript
// Add version parameter to force fresh requests
const API_VERSION = '20260110'; // Update when you redeploy backend
export const API_URL = `https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec?v=${API_VERSION}`;
```

**After (Option B - Runtime cache bust):**
```javascript
// Add timestamp to every request (aggressive, but guarantees no cache)
export function getAPIURL() {
  return `https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec?t=${Date.now()}`;
}
```

If using Option B, update `panels.js`:
```javascript
// In panels.js, change:
fetch(API_URL + '?action=chat', ...)

// To:
fetch(getAPIURL() + '&action=chat', ...)
```

---

### Solution 3: Add No-Cache Headers to Apps Script Response

**File:** `apps-script/production-tracking/Code.gs`

**Find the `doPost()` or response function** and add headers:

```javascript
function doPost(e) {
  // ... existing code ...

  var response = {
    success: true,
    data: result
  };

  // Add no-cache headers
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    .setHeader('Pragma', 'no-cache')
    .setHeader('Expires', '0');
}
```

**Note:** Apps Script has limited header control, so this may not work. Solutions 1 & 2 are more reliable.

---

### Solution 4: Update Frontend Fetch to Bypass Cache

**File:** `src/js/modules/panels.js` around line 250

**Find the fetch call:**
```javascript
fetch(API_URL + '?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(requestData)
})
```

**Add cache: 'no-store':**
```javascript
fetch(API_URL + '?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(requestData),
  cache: 'no-store',  // ← Add this line
  mode: 'cors'
})
```

---

## ✅ Recommended Implementation

**Best approach:** Combine Solutions 2 + 4

### Step 1: Update config.js
```javascript
// src/js/modules/config.js line 61
const API_VERSION = '1.0.0'; // Update this when backend changes
export const API_URL = `https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec?v=${API_VERSION}`;
```

### Step 2: Update panels.js fetch
```javascript
// src/js/modules/panels.js around line 250
fetch(API_URL + '&action=chat', {  // Note: & not ? (since URL has ?v= already)
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(requestData),
  cache: 'no-store'  // Prevent browser/SW caching
})
```

### Step 3: Test
```bash
# Push changes
git add src/js/modules/config.js src/js/modules/panels.js
git commit -m "fix: prevent double-refresh caching issue for AI backend"
git push

# Wait 1-2 minutes for GitHub Pages to deploy

# Test in fresh incognito window (Ctrl+Shift+N)
# Navigate to: https://rogueff.github.io/rogue-origin-apps/
# Open AI chat and send message
# Should work on FIRST TRY (no double-refresh needed)
```

---

## 🧪 Testing the Fix

### Before Fix:
1. Open site in fresh incognito
2. Send AI message → Error
3. Ctrl+Shift+R → Still error
4. Ctrl+Shift+R again → Works ✅

### After Fix:
1. Open site in fresh incognito
2. Send AI message → Works immediately ✅

---

## 🔍 Debugging Service Worker

If you want to check if a service worker is causing the issue:

```javascript
// Run in browser console:
navigator.serviceWorker.getRegistrations().then((registrations) => {
  console.log('Service Workers:', registrations);
  registrations.forEach((reg) => {
    console.log('SW Scope:', reg.scope);
    console.log('SW Active:', reg.active);
  });
});

// To unregister all service workers (for testing):
navigator.serviceWorker.getRegistrations().then((registrations) => {
  registrations.forEach((reg) => reg.unregister());
  console.log('All service workers unregistered');
});
```

---

## 📊 Cache Behavior Comparison

| Scenario | Browser Cache | SW Cache | Result |
|----------|---------------|----------|--------|
| **First Load** | Empty | Empty | ✅ Works |
| **Second Load** | Cached | Cached | ❌ Fails (stale) |
| **After 1x Ctrl+Shift+R** | Cleared | Stale | ❌ Still fails |
| **After 2x Ctrl+Shift+R** | Cleared | Bypassed | ✅ Works |
| **With cache: 'no-store'** | Not cached | Not cached | ✅ Always works |

---

## 🎯 Quick Fix (5 minutes)

**Fastest solution to try first:**

1. **Update panels.js** - Add one line:
```javascript
// Line ~250 in src/js/modules/panels.js
fetch(API_URL + '?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(requestData),
  cache: 'no-store'  // ← ADD THIS LINE
})
```

2. **Also update the Google Apps Script fetch** (line ~315):
```javascript
fetch(API_URL + '?action=feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(feedbackData),
  cache: 'no-store'  // ← ADD THIS LINE
})
```

3. **Commit and test:**
```bash
git add src/js/modules/panels.js
git commit -m "fix: add cache: 'no-store' to API requests"
git push
```

4. **Test in fresh incognito window** (wait 2 min for GitHub Pages deploy)

---

## 🚨 If Still Not Working

If the issue persists after trying all solutions:

1. **Check Apps Script Deployment:**
```
- Is the deployment URL still valid?
- Try accessing it directly in browser
- Should show some response (not error)
```

2. **Check Network Tab:**
```
- Open DevTools (F12)
- Network tab
- Send AI message
- Look for the Apps Script request
- Check: Status code, Response headers, Response body
```

3. **Check for CORS Issues:**
```
Apps Script should have:
- Execute as: Me
- Who has access: Anyone
```

---

## 📝 Summary

**Problem:** Double-refresh needed due to service worker caching

**Quick Fix:** Add `cache: 'no-store'` to fetch requests

**Best Fix:** Combine no-store + version parameter

**Test:** Fresh incognito window after deploying fix

**Expected:** Works on first try without any refresh

---

**Related Files:**
- `src/js/modules/panels.js` - Fetch calls
- `src/js/modules/config.js` - API URL
- Service worker file (if exists)

**Next Steps:** Choose a solution and implement it!
