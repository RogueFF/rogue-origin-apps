# Mail Relay — setup

Lets the Cloudflare worker send email without domain-wide delegation.

Apps Script runs as **the Google account that owns the script**, so
`MailApp.sendEmail` works with no admin-console grant. The worker POSTs here
with a shared secret; this script sends the mail.

Whoever creates the script is who the mail comes **from**. Create it as the
account you want Damon to see as the sender.

---

## 1. Create the script

1. Go to <https://script.google.com> → **New project**
2. Rename it `RO Mail Relay`
3. Replace the contents of `Code.gs` with this folder's `Code.gs`
4. Save

## 2. Set the shared secret

Generate one (any long random string):

```bash
openssl rand -hex 24
```

In the Apps Script editor: **Project Settings** (gear icon) → **Script
Properties** → **Add script property**

| Property | Value |
|---|---|
| `RELAY_SECRET` | the string you just generated |

Keep it — you'll paste the same value into the worker in step 4.

## 3. Deploy as a web app

**Deploy** → **New deployment** → gear → **Web app**

| Setting | Value |
|---|---|
| Execute as | **Me** (this is what grants mail-sending rights) |
| Who has access | **Anyone** |

"Anyone" sounds alarming but is required — Cloudflare can't authenticate as a
Google user. The shared secret is the actual access control, which is why step 2
matters.

Google will prompt for authorization the first time, including an "unverified
app" warning for your own script. Advanced → Go to RO Mail Relay.

Copy the **/exec** URL.

> Re-deploying: use **Manage deployments → edit → New version**, not New
> deployment, or the `/exec` URL changes and the worker breaks.

## 4. Point the worker at it

```bash
cd workers && npx wrangler secret put MAIL_RELAY_URL
```
```bash
cd workers && npx wrangler secret put MAIL_RELAY_SECRET
```
```bash
cd workers && npx wrangler secret put DAMON_EMAIL
```
```bash
cd workers && npx wrangler secret put REORDER_CC
```

`MAIL_RELAY_URL` is the `/exec` URL. `MAIL_RELAY_SECRET` is the `RELAY_SECRET`
value. `REORDER_CC` is optional — your copy of each alert.

Setting `MAIL_RELAY_URL` is what selects this transport (see
`workers/src/lib/mailer.js`), so no redeploy is needed.

## 5. Verify

Health check — should return `{"success":true,"service":"mail-relay","ok":true}`:

```bash
curl -sL "<YOUR_EXEC_URL>"
```

Then scan a Grove card and check the request row flipped to `sent`:

```bash
curl -s "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=getReorderRequests&status=all"
```

## Quota

`MailApp` allows 1,500 recipients/day on Workspace (100/day on a consumer
account). Grove alerts run a handful a month, so quota is not a real constraint.
`remainingQuota` comes back on every successful send if you want to watch it.

## Troubleshooting

| Symptom in `notifyError` | Cause |
|---|---|
| `returned non-JSON` | Deployment isn't "Anyone", or the `/exec` URL is stale |
| `Unauthorized` | `MAIL_RELAY_SECRET` ≠ `RELAY_SECRET` |
| `RELAY_SECRET not configured` | Step 2 was skipped |
| `No mail transport configured` | `MAIL_RELAY_URL` isn't set on the worker |
