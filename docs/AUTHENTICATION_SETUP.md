# Orders Page Authentication Setup

## Overview

The `orders.html` page is now protected with password authentication. The password is stored in a **local file that never gets committed to Git**, keeping it private even when you push code to GitHub.

---

## Setup Instructions (First Time)

### Step 1: Create Your Auth Config File

1. Navigate to your project root directory
2. Copy the template file:
   ```bash
   cp auth-config.template.js auth-config.js
   ```

   **Windows (Command Prompt):**
   ```cmd
   copy auth-config.template.js auth-config.js
   ```

3. Open `auth-config.js` in your text editor

4. Set your password:
   ```javascript
   const AUTH_CONFIG = {
     password: 'YOUR_PASSWORD_HERE',  // ⬅️ Change this
     sessionDuration: 30,
     protectedPages: ['orders.html']
   };
   ```

5. Save the file

### Step 2: Verify .gitignore

Check that `auth-config.js` is in your `.gitignore` file:

```bash
cat .gitignore | grep auth-config
```

You should see:
```
auth-config.js
```

✅ This ensures your password file **never gets committed to Git**.

### Step 3: Test the Authentication

1. Open `orders.html` in your browser
2. You should see a login screen: 🔒 **Wholesale Orders**
3. Enter your password
4. Click **Unlock**
5. The page should load normally

---

## How It Works

### Security Model

```
orders.html (public on GitHub)
    ↓ loads
auth-config.js (private, not on GitHub)
    ↓ contains
YOUR_PASSWORD (only on your local machine)
```

**What gets committed to Git:**
- ✅ `orders.html` - With authentication code (safe)
- ✅ `auth-config.template.js` - Empty template (safe)
- ❌ `auth-config.js` - Your actual password (blocked by .gitignore)

**What happens when others clone your repo:**
- They get `orders.html` with the login screen
- They DON'T get your password
- Page shows warning: "auth-config.js not found"
- They need to create their own `auth-config.js` to access

### Session Persistence

After logging in:
- Session saved to browser `localStorage`
- Stays logged in for 30 days (configurable)
- No need to re-enter password on every visit
- Click "Logout" to clear session

---

## Configuration Options

Edit `auth-config.js` to customize:

### Session Duration

How long to stay logged in:

```javascript
sessionDuration: 7,  // Stay logged in for 7 days
sessionDuration: 1,  // Stay logged in for 1 day
sessionDuration: 90, // Stay logged in for 90 days
```

### Protected Pages

Which pages require authentication:

```javascript
protectedPages: ['orders.html']                    // Just orders
protectedPages: ['orders.html', 'customers.html']  // Multiple pages
```

---

## Common Tasks

### Changing Your Password

1. Open `auth-config.js`
2. Change the `password` value
3. Save the file
4. Refresh `orders.html`
5. **Important:** You'll need to log in again (old session is invalidated)

### Sharing Access with Team Members

**Option 1: Share Password (Simple)**
- Give them your password via secure channel (Slack DM, password manager)
- They create their own `auth-config.js` with the same password

**Option 2: Separate Passwords (Secure)**
- Each person creates their own `auth-config.js` with a unique password
- Each person has their own local authentication
- No shared credentials

### Deploying to GitHub Pages

The authentication works **client-side** (in the browser), so:

1. Commit and push your code:
   ```bash
   git add .
   git commit -m "Add authentication to orders page"
   git push origin main
   ```

2. GitHub Pages will deploy `orders.html` **with** the login screen
3. Your password remains on your local machine (not deployed)
4. Anyone visiting the page sees the login screen
5. Only people with the password can access

**Security Note:** Client-side authentication can be bypassed by someone who views the page source. For truly sensitive data, consider server-side authentication.

---

## Troubleshooting

### "Page is unprotected" Warning

**Problem:** Browser console shows:
```
⚠️ auth-config.js not found. Page is unprotected!
```

**Fix:**
1. Create `auth-config.js` from template (see Step 1 above)
2. Refresh the page

---

### Can't Access Page (Forgot Password)

**Problem:** You forgot your password and can't log in

**Fix:**
1. Open `auth-config.js` on your computer
2. Look at the `password` field
3. That's your password!

---

### Session Expired

**Problem:** Page shows login screen even though you logged in recently

**Cause:** Session duration expired

**Fix:**
1. Log in again
2. Or increase `sessionDuration` in `auth-config.js`

---

### Password Showing in Git History

**Problem:** You accidentally committed `auth-config.js` to Git

**Fix:**
1. Remove from Git history:
   ```bash
   git rm --cached auth-config.js
   git commit -m "Remove auth config from Git"
   git push origin main
   ```

2. Change your password in `auth-config.js`

3. Verify it's in `.gitignore`:
   ```bash
   cat .gitignore | grep auth-config
   ```

---

## Advanced: Multiple Environments

If you have different passwords for development vs production:

**Development:**
```javascript
// auth-config.js (local)
const AUTH_CONFIG = {
  password: 'dev-password-123',
  sessionDuration: 90  // Long session for dev
};
```

**Production:**
```javascript
// auth-config.production.js (on production server)
const AUTH_CONFIG = {
  password: 'strong-prod-password-456',
  sessionDuration: 7  // Shorter session for security
};
```

Update `orders.html`:
```html
<!-- Load appropriate config based on environment -->
<script src="auth-config.js"></script>
<!-- or -->
<script src="auth-config.production.js"></script>
```

---

## Security Considerations

### Client-Side Limitations

⚠️ **Important:** This authentication happens in the browser (client-side):

**What it protects against:**
- ✅ Casual visitors browsing your site
- ✅ Accidental access by non-technical users
- ✅ Search engine indexing (login screen blocks crawlers)

**What it does NOT protect against:**
- ❌ Someone viewing page source and bypassing the login
- ❌ Intercepting data in transit (use HTTPS)
- ❌ Determined attackers with browser dev tools

**For truly sensitive data:**
- Use server-side authentication (Apps Script, OAuth, etc.)
- Don't store sensitive data client-side
- Consider the Shopify webhook approach (server validates requests)

### Best Practices

1. **Use HTTPS:** Always access via `https://` (GitHub Pages does this automatically)
2. **Strong Password:** Use a long, random password
3. **Regular Changes:** Change password every 3-6 months
4. **Secure Sharing:** Share passwords via password manager, not email
5. **Monitor Access:** Check browser localStorage if you suspect unauthorized access

---

## File Checklist

After setup, you should have:

- ✅ `auth-config.template.js` - Template file (committed to Git)
- ✅ `auth-config.js` - Your password file (NOT in Git)
- ✅ `.gitignore` - Contains `auth-config.js`
- ✅ `orders.html` - Has login screen (committed to Git)

Verify:
```bash
# Should show auth-config.js
ls auth-config.js

# Should NOT show auth-config.js in Git
git status | grep auth-config
```

---

## FAQ

**Q: Can I disable authentication?**
A: Yes, just delete or rename `auth-config.js`. The page will load without authentication (and show a console warning).

**Q: What happens if I lose auth-config.js?**
A: Just create a new one from the template with a new password.

**Q: Can I use the same password across multiple pages?**
A: Yes, all pages can load the same `auth-config.js` file.

**Q: Is my password encrypted?**
A: No, it's stored in plain text in `auth-config.js`. This file should never be shared or committed to Git.

**Q: Can I see who logged in?**
A: No, this system doesn't track login history. For audit trails, use server-side authentication.

**Q: What if someone views the page source?**
A: They'll see the authentication code but NOT your password (it's in a separate file). However, a technical person could potentially bypass the login. For high-security needs, use server-side auth.

---

## Next Steps

1. ✅ Create `auth-config.js` from template
2. ✅ Set a strong password
3. ✅ Test the login screen
4. 📝 Save password in your password manager
5. 🔒 Commit and push to GitHub (password stays local)

---

**Last Updated:** January 6, 2026
**Version:** 1.0
