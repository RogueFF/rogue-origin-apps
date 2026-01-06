# Orders Page Authentication Setup (Server-Side)

## Overview

The `orders.html` page is protected with **server-side authentication**. The password is stored securely in Google Apps Script **Script Properties** (not in code or Git), similar to how your Claude API key is stored.

This approach ensures:
- ✅ **Password is never visible in source code**
- ✅ **No password files committed to Git**
- ✅ **Only you have access** (password stored in your Apps Script project)
- ✅ **Works on both local and GitHub Pages** automatically

---

## Setup Instructions (One-Time)

### Step 1: Set Password in Apps Script

1. Open your **Wholesale Orders** Apps Script project:
   - Go to [script.google.com](https://script.google.com)
   - Open your wholesale-orders project

2. Navigate to **Project Settings** (gear icon ⚙️ in left sidebar)

3. Scroll down to **Script Properties**

4. Click **"Add script property"**

5. Enter the following:
   - **Property**: `ORDERS_PASSWORD`
   - **Value**: Your chosen password (e.g., `MySecurePassword123!`)

6. Click **"Save script properties"**

**That's it!** Your password is now securely stored server-side.

---

### Step 2: Deploy/Update Apps Script

If you haven't deployed your Apps Script web app yet:

1. In Apps Script, click **Deploy** → **New deployment**
2. Select type: **Web app**
3. Set **Execute as**: "Me"
4. Set **Who has access**: "Anyone"
5. Click **Deploy**
6. Copy the web app URL (it starts with `https://script.google.com/macros/s/...`)

If you already deployed, you need to **create a new deployment** to include the authentication code:

1. Click **Deploy** → **New deployment**
2. Same settings as above
3. Click **Deploy**
4. **Copy the new URL** - it will be different!

---

### Step 3: Update orders.html with Apps Script URL

1. Open `orders.html` in your editor

2. Find line ~1745 (search for `AUTH_API_URL`):
   ```javascript
   const AUTH_API_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
   ```

3. Replace `YOUR_DEPLOYMENT_ID` with your actual deployment URL from Step 2

4. Save the file

---

### Step 4: Test Authentication

1. Open `orders.html` in your browser (locally or on GitHub Pages)

2. You should see the login screen: 🔒 **Wholesale Orders**

3. Enter your password (the one you set in Script Properties)

4. Click **Unlock**

5. If successful, the page loads and you're logged in for 30 days

---

## How It Works

### Security Model

```
┌─────────────────────────────────────────┐
│ orders.html                             │
│ (public on GitHub Pages)                │
│                                         │
│ [User enters password] ──┐              │
└──────────────────────────┼──────────────┘
                           │
                           │ POST /validatePassword
                           ▼
┌─────────────────────────────────────────┐
│ Apps Script Backend                     │
│ (your Google account)                   │
│                                         │
│ Script Properties:                      │
│   ORDERS_PASSWORD: "your-secure-pass"   │
│                                         │
│ Validates password ──┐                  │
└──────────────────────┼──────────────────┘
                       │
                       │ Returns session token
                       ▼
┌─────────────────────────────────────────┐
│ User's Browser                          │
│                                         │
│ localStorage:                           │
│   sessionToken: "abc123..."             │
│   timestamp: 1704567890                 │
│   expiresIn: 2592000000 (30 days)      │
└─────────────────────────────────────────┘
```

**What's Public (on GitHub):**
- ✅ orders.html with login screen
- ✅ Apps Script deployment URL
- ❌ **Password is NOT public** (stored in Script Properties)

**What's Private:**
- 🔒 Password in Apps Script Script Properties
- 🔒 Only accessible from your Google account
- 🔒 Never visible in source code or Git history

---

## Changing Your Password

1. Open your Apps Script project
2. Go to **Project Settings** → **Script Properties**
3. Find `ORDERS_PASSWORD`
4. Click the edit icon (pencil)
5. Enter new password
6. Click **Save**
7. **Done!** All users will need to log in again with the new password

No code changes needed. No Git commits needed.

---

## Sharing Access with Others

**Option 1: Share Your Password (Simple)**
- Give them your password via secure channel (password manager, Signal, etc.)
- They enter it on the login screen
- Both of you use the same password

**Option 2: Create Separate Apps Script Project (Advanced)**
- They fork/copy your repo
- They deploy their own Apps Script project
- They set their own password in Script Properties
- Each person has independent authentication

---

## Troubleshooting

### "Connection error. Please try again."

**Problem:** Browser can't reach Apps Script

**Fix:**
1. Check that `AUTH_API_URL` in orders.html matches your deployment URL
2. Verify Apps Script deployment is set to "Anyone" access
3. Try opening the Apps Script URL directly in browser - should show JSON

---

### "Password not configured in Script Properties"

**Problem:** Script Property `ORDERS_PASSWORD` not set

**Fix:**
1. Open Apps Script → Project Settings → Script Properties
2. Add property: `ORDERS_PASSWORD` = your password
3. Deploy a **new deployment** (not just saving code)
4. Update `AUTH_API_URL` in orders.html with new deployment URL

---

### "Invalid password" (but you know it's correct)

**Problem:** Possible caching or deployment issue

**Fix:**
1. In Apps Script, create a **new deployment** (Deploy → New deployment)
2. Update `AUTH_API_URL` in orders.html with the new URL
3. Clear browser localStorage: Open DevTools → Application → Local Storage → Delete `orders_auth_session`
4. Try logging in again

---

### Session Expired Message

**Problem:** More than 30 days have passed since login

**Fix:**
1. Just log in again
2. Session will be renewed for another 30 days

To change session duration:
1. Open Apps Script `Code.gs`
2. Find `expiresIn: 30 * 24 * 60 * 60 * 1000` (line ~128)
3. Change `30` to desired days (e.g., `90` for 90 days)
4. Deploy new deployment
5. Update orders.html with new deployment URL

---

## Security Considerations

### What This Protects Against

✅ **Source code inspection** - Password never in code
✅ **Git history leaks** - Password never committed
✅ **Casual access** - Login screen blocks visitors
✅ **Search engines** - Login screen prevents indexing

### What This Does NOT Protect Against

❌ **Someone with your Google account access** - They can see Script Properties
❌ **Apps Script platform compromise** - Trust in Google's security
❌ **Network interception without HTTPS** - Always use HTTPS (GitHub Pages does this automatically)

### Best Practices

1. **Use HTTPS:** GitHub Pages automatically uses HTTPS ✅
2. **Strong Password:** Use long, random password with mix of characters
3. **Secure Sharing:** Share password via password manager or encrypted channel
4. **Regular Changes:** Change password every 6-12 months
5. **Monitor Sessions:** Check who has access by monitoring Apps Script execution logs

---

## Comparison with Previous Setup

| Feature | Old (auth-config.js) | New (Server-Side) |
|---------|---------------------|-------------------|
| Password visibility | Visible in source code (production) | **Never visible** ✅ |
| Git commits | Template committed | **Nothing committed** ✅ |
| Setup complexity | Copy file, edit password | Set Script Property |
| Security level | Client-side (weak) | **Server-side (strong)** ✅ |
| Password changes | Edit file, commit, push | **Change property only** ✅ |
| Works on GitHub Pages | Yes (but password visible) | **Yes (password hidden)** ✅ |

---

## Advanced: Multiple Environments

If you want different passwords for dev/staging/production:

**Option 1: Different Script Properties Projects**
- Create separate Apps Script projects for each environment
- Each has its own `ORDERS_PASSWORD` property
- Point orders.html to appropriate deployment URL

**Option 2: Environment-Based Properties**
- Use properties: `ORDERS_PASSWORD_DEV`, `ORDERS_PASSWORD_PROD`
- Modify Apps Script to check environment parameter
- Pass environment in login request

---

## Files Involved

After server-side setup:

- ✅ `orders.html` - Login screen, calls Apps Script
- ✅ `apps-script/wholesale-orders/Code.gs` - Authentication endpoint
- ✅ `.gitignore` - Lists removed auth-config files
- ❌ `auth-config.js` - **Deleted** (no longer used)
- ❌ `auth-config.production.js` - **Deleted** (no longer used)
- ❌ `auth-config.template.js` - **Deleted** (no longer used)

---

## FAQ

**Q: Can someone see my password by viewing source code?**
A: No! Password is stored in Apps Script Script Properties, never in code.

**Q: What if I forget my password?**
A: Open Apps Script → Project Settings → Script Properties → View `ORDERS_PASSWORD`

**Q: Can I disable authentication temporarily?**
A: Yes, comment out the login check in orders.html (not recommended for production)

**Q: Is my password encrypted in Script Properties?**
A: Google encrypts Script Properties at rest. You access them through your Google account authentication.

**Q: What happens if someone guesses my Apps Script deployment URL?**
A: They can call the endpoint, but still need the correct password to authenticate. Failed attempts don't reveal the password.

**Q: Can I see who logged in?**
A: Check Apps Script execution logs (Extensions → Apps Script → Executions) to see when `validatePassword` was called. No individual user tracking by default.

**Q: Why is the session token stored in localStorage?**
A: So you don't have to log in on every page load. Session expires after 30 days or when you logout.

**Q: Can I use this for multiple pages?**
A: Yes! The same authentication session works across all pages in the same domain that check for the session token.

---

## Next Steps

1. ✅ Set `ORDERS_PASSWORD` in Script Properties
2. ✅ Deploy Apps Script web app (or create new deployment)
3. ✅ Update `AUTH_API_URL` in orders.html
4. ✅ Test login on local/GitHub Pages
5. 📝 Save password in your password manager
6. 🔒 Enjoy secure, Git-safe authentication!

---

**Last Updated:** January 6, 2026
**Version:** 2.0 (Server-Side Authentication)
**Migration:** This replaces the previous client-side auth-config.js system
