# Grove Reorder Alert — Design

**Date:** 2026-08-10
**Status:** **Live** as of 2026-08-11. Apps Script relay deployed, all four
worker secrets set, first successful send verified (`notify_state = 'sent'`).

Scanning the QR on a Grove supply card should alert Damon to reorder, instead of
adding the item to the Friday cart. Grove reordering runs on its own track and
never goes through the Friday order.

> **Not to be confused with the RO Kanban Reorder Monitor** — a claude.ai
> scheduled cloud routine (cron `0 15 1,15 * *`) that emails Koa a monthly
> *propose-only* digest of Fill/Reorder sizing suggestions. That one is
> read-only, monthly, and advisory. This one is event-driven, writes a request
> row, and emails Damon. They share a domain but not a purpose — don't merge
> them.

## 1. Decisions

| Question | Decision |
|---|---|
| Friday cart on a Grove scan | **Skip entirely.** Alert only. |
| Channel | **Gmail API** via the existing Google Workspace on `rogueorigin.com` |
| Durability | **Log the request first, then email.** |
| Closing the loop | **Damon taps a link** in the email |
| Routing rule | **`supplier === 'Grove'`** |
| Recipients | **Damon, cc Koa** |

Telegram was rejected despite already being wired (`sendTelegramMessage`, proven
in `harvest-d1.js`) — Damon barely checks it. Infrastructure that exists but
isn't read is not a solution.

Carrier email-to-SMS gateways were considered and rejected as dead: AT&T shut
`txt.att.net` in June 2025, T-Mobile killed `tmomail.net` in late 2024, and
Verizon's `vtext.com` phases out through March 2027 while already dropping mail
silently. Real SMS would require a registered A2P 10DLC sender (Twilio), which
is a later step if email proves insufficient.

## 2. Flow

The QR opens the **page**, not the worker, so the chain up to the API is
unchanged:

```
scan → kanban.html?flag=<id> → handleFlagParam() → reorder(id) → POST ?action=addToCart
```

The branch is **server-side**, inside `addToCart`. Keeping it there means the
QR, the Reorder button, and any future caller all inherit the rule, rather than
each front-end needing to know which vendors are special.

```
addToCart
  ├── card.supplier !== 'Grove' → existing cart UPSERT   → { mode: 'cart', cartItem }
  └── card.supplier === 'Grove' → reorder request path   → { mode: 'reorder_request', request }
                                    ├── INSERT (awaited) — partial unique index dedups
                                    └── ctx.waitUntil(send email → update notify_state)
```

## 3. Response contract

`addToCart` returns a **discriminated shape** so the front-end can branch
safely:

```js
// cart path (unchanged from today)
{ success: true, mode: 'cart', cartItem: { cartId, cardId, qty, note, item, supplier } }

// Grove path
{ success: true, mode: 'reorder_request',
  request: { id, cardId, item, status: 'open',
             outcome: 'created' | 'already_open', requestedAt } }
```

This matters more than it looks. `reorder()` in `kanban.html` currently does an
unguarded `r.cartItem.qty`. If the worker diverted Grove without a contract
change, that dereference would throw `undefined.qty`, the `.catch` would fire,
and the person scanning would see a TypeError — **even when the email sent
fine**. The front-end switches on `mode` instead.

The card lookup in `addToCart` widens from `SELECT id` to
`SELECT id, item, supplier`, since the branch needs the supplier and the email
needs the item name.

## 4. Data model

`workers/migrations/0013-kanban-reorder-requests.sql`

```sql
CREATE TABLE IF NOT EXISTS kanban_reorder_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  requested_at  TEXT DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'open',     -- open | ordered
  notify_state  TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  notify_error  TEXT,
  close_token   TEXT NOT NULL,
  closed_at     TEXT,
  closed_by     TEXT,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_krr_one_open
  ON kanban_reorder_requests(card_id) WHERE status = 'open';
```

Two columns carry weight:

**`notify_state`** is what makes the request genuinely retryable. Logging before
sending is pointless if a failed send leaves no trace — so the row is written
and awaited, the send is attempted, and the row is then updated to `sent`, or to
`failed` with the error text.

**The partial unique index is the dedup rule**, enforced by the database rather
than by application logic. One open request per card. A re-scan cannot create a
second row; it returns `outcome: 'already_open'` instead.

**A re-scan retries a failed send.** Dedup alone would make a failed
notification a permanent dead end: the row stays open, so no later scan can ever
re-trigger it, and nobody finds out until the shelf is bare. But re-scanning is
exactly what someone does when nothing appeared to happen — which is precisely
the failed case. So on `already_open`, if `notify_state !== 'sent'` the send is
re-attempted and the response carries `retried: true`.

The retry triggers on `pending` as well as `failed`. A row can be stranded in
`pending` if the isolate dies before `waitUntil` finishes, and a duplicate email
is a far cheaper failure than a reorder that never happens.

## 5. Closing the loop

**The close link must not be a state-changing GET.** Gmail and Outlook prefetch
and security-scan links on delivery, so a GET that closes the request can fire
before Damon ever opens the message — the request closes, nobody ordered, and it
silently reopens on the next scan.

- `GET  ?action=reorderRequest&token=<t>` — renders a confirmation page. Changes
  nothing.
- `POST ?action=closeReorderRequest` `{ token }` — performs the close.

`close_token` is 32 random hex chars, not the row id, so links aren't guessable
by counting. Anyone holding the link can close the request; that is acceptable
inside a supply-closet workflow and avoids putting a login in front of Damon.

## 6. What the scanner sees

| Case | Toast |
|---|---|
| Non-Grove | `Added 2× Sharpies to Friday cart (now 3)` — unchanged |
| Grove, new request | `Reorder requested — Damon is being notified` |
| Grove, already open, notified | `Already requested Aug 3 — reorder still open` |
| Grove, already open, retrying | `Already requested Aug 3 — retrying the alert to Damon` |

None of these claim the mail was delivered. The send is fire-and-forget and its
outcome lands in `notify_state`, not in the response the scanner sees.

`refreshCartBadge()` is not called on the Grove path; nothing entered the cart.

## 7. Prerequisites (blocking)

The code ships inert: with no transport configured, sends throw and rows land
in `notify_state = 'failed'` rather than disappearing.

**Chosen transport: the Apps Script relay.** Setup lives in
`apps-script/mail-relay/README.md`. Summary:

1. Create the Apps Script project as the account the mail should come *from*,
   set a `RELAY_SECRET` script property, deploy as a web app with
   **Execute as: Me** / **Who has access: Anyone**.
2. Set `MAIL_RELAY_URL`, `MAIL_RELAY_SECRET`, `DAMON_EMAIL`, and optionally
   `REORDER_CC` via `wrangler secret put`. Not in the repo, not in the wiki.

Setting `MAIL_RELAY_URL` is what selects the transport, so no redeploy is
needed to switch it on.

**Why not domain-wide delegation** (the `lib/gmail.js` path, still wired):
every existing Google integration in this repo reads and writes Sheets that are
**shared directly with the service account** — which is why no `createJWT` in
the codebase carries a `sub` claim. A service account holds file-sharing
relationships but **has no mailbox**, so sending as a person requires
impersonation, and impersonation requires a super-admin domain-wide delegation
grant. Existing credentials cannot confer it. Apps Script sidesteps the whole
question by running as the script owner.

To switch to delegation later: enable the Gmail API in the service account's
Cloud project, grant its numeric client ID the
`https://www.googleapis.com/auth/gmail.send` scope at admin.google.com →
Security → Access and data control → API controls → Domain-wide delegation,
then set `GMAIL_SEND_AS` and `MAIL_TRANSPORT=gmail`. Note `gmail.send` is a
*sensitive* scope, not a *restricted* one — the broader `https://mail.google.com/`
scope would require a CASA Tier 2 assessment.

## 8. Mail transports

`lib/mailer.js` is the single entry point and picks a transport from config:

| Transport | Sends as | Needs |
|---|---|---|
| `relay` (`lib/mail-relay.js` → Apps Script) | the script owner's address | nothing beyond deploying the script |
| `gmail` (`lib/gmail.js`) | any mailbox in the domain | super-admin domain-wide delegation |

`MAIL_TRANSPORT` forces one explicitly; otherwise `MAIL_RELAY_URL` wins over
`GMAIL_SEND_AS`, so a leftover `GMAIL_SEND_AS` can't silently route through a
transport nobody authorised. With neither set, `sendEmail` **throws** — a
silent no-op would let an alert vanish without reaching `notify_state`, which
is the exact failure this feature exists to prevent.

### Why a new `gmail.js` rather than reusing `sheets.js`

The worker already signs Google service-account JWTs with RS256 in production
(`lib/sheets.js`, and a near-duplicate in `handlers/orders/shared.js`). But
`createJWT` / `getAccessToken` there are module-private, the scope is hardcoded
to `spreadsheets`, and `tokenCache` is a single module-level slot keyed to
nothing — a Gmail token would collide with the Sheets token in that cache.

So `lib/gmail.js` gets its own scope-aware cache and adds the `sub:`
impersonation claim that domain-wide delegation requires. That is a third copy
of the JWT dance. Consolidating all three into one `lib/google-auth.js` is
worth doing, but as separate cleanup — refactoring live Sheets and Orders code
does not belong inside a new feature.

## 9. Testing

`buildMimeMessage` and `isReorderAlertVendor` are pure and unit-tested under
`node --test`. The DB and Gmail paths are integration surface: verify after the
§7 prerequisites are granted, by scanning one Grove card and confirming the row
plus the delivered mail.

One path remains unexercised: the live `?flag=` round-trip (page load → cart
add) has never been run against production, because doing so writes a real cart
line. This design makes that path load-bearing, so scan one Grove card once the
branch is deployed.
