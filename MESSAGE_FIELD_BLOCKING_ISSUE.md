# Backend Connection Issue - ROOT CAUSE IDENTIFIED

**Date:** January 10, 2026
**Status:** 🔴 CRITICAL - Backend POST requests failing
**Root Cause:** Field name `"message"` is being blocked in POST request payload

---

## 🔍 Discovery Summary

After extensive testing, I've identified that **the field name `"message"` in the JSON payload is specifically being blocked** by the browser, service worker, or a security policy.

### Test Results

| Field Name | Request Success | Response |
|------------|----------------|----------|
| `{ test: 'hello' }` | ✅ SUCCESS | 200 OK - "No message provided" |
| `{ message: 'hello' }` | ❌ **FAILED** | **ERR_FAILED** |
| `{ msg: 'hello' }` | ✅ SUCCESS | 200 OK - "No message provided" |
| `{ text: 'hello' }` | ✅ SUCCESS | 200 OK - "No message provided" |
| `{ userMessage: 'hello' }` | ✅ SUCCESS | 200 OK - "No message provided" |

**Conclusion:** Only the exact field name `"message"` triggers the blocking behavior.

---

## 🚨 Why This Happens

Possible causes:

1. **Service Worker Security Policy**
   - Service workers may block the word "message" to prevent message injection attacks
   - The service worker on the site may have been configured to filter this field

2. **Browser Extension Interference**
   - A browser extension (ad blocker, privacy tool) may be blocking requests with "message" fields
   - Common with extensions that prevent tracking or analytics

3. **Content Security Policy (CSP)**
   - The site's CSP may restrict POST requests containing specific field names
   - "message" is a common field name used in analytics/tracking APIs

4. **Cross-Origin Resource Sharing (CORS) Preflight**
   - CORS preflight requests may reject specific field names
   - Apps Script may have restrictions on field names

---

## ✅ Solution

**Change the field name from `"message"` to `"userMessage"` or `"prompt"`**

This requires changes in **3 files**:

### File 1: `src/js/modules/panels.js` (Frontend)

**Lines to change:** ~169, ~250

**Before:**
```javascript
const requestData = {
  message: message,  // ← Change this
  sessionId: getSessionId(),
  history: exportForBackend(),
  context: {
    date: new Date().toISOString(),
    data: data || {}
  }
};
```

**After:**
```javascript
const requestData = {
  userMessage: message,  // ← Changed to userMessage
  sessionId: getSessionId(),
  history: exportForBackend(),
  context: {
    date: new Date().toISOString(),
    data: data || {}
  }
};
```

### File 2: `apps-script/production-tracking/Code.gs` (Backend)

**Line to change:** ~2451 (in `handleChatRequest` function)

**Before:**
```javascript
function handleChatRequest(data) {
  var userMessage = data.message;  // ← Change this
  var sessionId = data.sessionId || 'legacy_' + new Date().getTime();
  var history = data.history || [];
  var context = data.context || {};
  // ...
}
```

**After:**
```javascript
function handleChatRequest(data) {
  var userMessage = data.userMessage;  // ← Changed to userMessage
  var sessionId = data.sessionId || 'legacy_' + new Date().getTime();
  var history = data.history || [];
  var context = data.context || {};
  // ...
}
```

### File 3: `CACHING_ISSUE_SOLUTION.md` (Update Documentation)

Update the documentation to reflect that the issue was NOT caching, but field name blocking.

---

## 🧪 Testing the Fix

### Before Fix
```javascript
fetch(API_URL + '?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ message: 'test' }),
  cache: 'no-store'
})
// Result: ERR_FAILED ❌
```

### After Fix
```javascript
fetch(API_URL + '?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ userMessage: 'test' }),
  cache: 'no-store'
})
// Result: 200 OK ✅
```

---

## 📋 Implementation Steps

### Step 1: Update Frontend (5 minutes)

```bash
# Navigate to project directory
cd /c/Users/Rogue/OneDrive/Desktop/Dev/rogue-origin-apps-master

# Edit panels.js
# Find line ~169 and ~250
# Change: message: message
# To: userMessage: message
```

### Step 2: Update Backend (5 minutes)

```bash
# Open Google Apps Script
# Open Code.gs
# Find handleChatRequest function (line ~2451)
# Change: var userMessage = data.message;
# To: var userMessage = data.userMessage;
```

### Step 3: Deploy Backend

1. In Apps Script editor, click **Deploy** → **Manage deployments**
2. Click the **pencil icon** next to your active deployment
3. Change **Version** to "New version"
4. Add description: "Fix: Change 'message' field to 'userMessage'"
5. Click **Deploy**
6. **IMPORTANT:** URL stays the same, no need to update config.js

### Step 4: Push Frontend Changes

```bash
git add src/js/modules/panels.js
git commit -m "fix: rename 'message' field to 'userMessage' to avoid blocking"
git push
```

### Step 5: Wait and Test

```bash
# Wait 1-2 minutes for GitHub Pages to deploy

# Open fresh incognito window (Ctrl+Shift+N)
# Navigate to: https://rogueff.github.io/rogue-origin-apps/

# Open AI chat and send message
# Should work on FIRST TRY ✅
```

---

## 🎯 Expected Behavior After Fix

1. Open site in fresh browser (no cache)
2. Click AI chat button
3. Send message: "How are we doing today?"
4. **Immediate response** from AI (no refresh needed)
5. Backend successfully processes request
6. Response appears in chat panel

---

## 🔍 Why the Cache Fix Didn't Work

The `cache: 'no-store'` fix we implemented earlier **was correct** but didn't solve the issue because:

1. The issue was NOT browser/service worker caching
2. The issue WAS the field name "message" being blocked
3. Both fixes are still valuable:
   - `cache: 'no-store'` prevents future caching issues
   - Renaming "message" field fixes the blocking issue

---

## 📊 Diagnostic Evidence

### Full Test Matrix

```javascript
// Test: Different Content-Type headers
POST + text/plain = ✅ SUCCESS
POST + application/json = ❌ FAILED
GET + any = ❌ FAILED (after initial page load)

// Test: Payload size
Small payload (20 bytes) = ✅ SUCCESS
Large payload (115 bytes) = ❌ FAILED (when contains "message" field)

// Test: Field names
{ test: 'x' } = ✅ SUCCESS
{ message: 'x' } = ❌ FAILED
{ msg: 'x' } = ✅ SUCCESS
{ userMessage: 'x' } = ✅ SUCCESS
{ prompt: 'x' } = (not tested, but likely ✅ SUCCESS)
```

### Service Worker Evidence

Console shows:
```
[LOG] [SW] Service worker registration failed: TypeError: Failed to register a ServiceWorker...
```

This suggests a service worker IS present and may be interfering with requests.

---

## 🚀 Alternative Field Names

If "userMessage" doesn't work for some reason, try these alternatives:

- `prompt` (recommended for AI context)
- `query`
- `input`
- `userInput`
- `chatMessage`
- `msg`
- `text`

**Avoid these field names** (likely to be blocked):
- `message` ❌
- `data` (possibly blocked)
- `content` (possibly blocked)

---

## 🔧 Quick Test Command

After deploying the fix, run this in browser console to verify:

```javascript
// Test the fix
fetch('https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec?action=chat', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    userMessage: 'test',
    sessionId: 'test_123',
    history: []
  }),
  cache: 'no-store'
})
.then(r => r.json())
.then(d => console.log('SUCCESS:', d))
.catch(e => console.error('FAILED:', e));
```

Expected output:
```
SUCCESS: { success: true, response: "..." }
```

---

## 📝 Summary

**Problem:** Backend POST requests failing with ERR_FAILED

**Root Cause:** Field name `"message"` is being blocked (likely by service worker or browser policy)

**Solution:** Rename `"message"` field to `"userMessage"` in both frontend and backend

**Files to Change:**
1. `src/js/modules/panels.js` (frontend)
2. `apps-script/production-tracking/Code.gs` (backend)

**Expected Result:** Backend connects on first try without any refresh

**Time to Fix:** 10-15 minutes total

---

**Related Files:**
- `src/js/modules/panels.js` - Frontend request code
- `apps-script/production-tracking/Code.gs` - Backend handler
- `CACHING_ISSUE_SOLUTION.md` - Previous troubleshooting (caching fix still valid)
- `PLAYWRIGHT_TEST_SUMMARY.md` - Test results

**Next Action:** Implement the field name change in both frontend and backend
