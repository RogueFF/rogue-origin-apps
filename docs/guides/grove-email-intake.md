# Grove email intake: setup

Grove's own order confirmation and shipping emails drive the Grove lanes, so a
delivery is received without anyone opening the Desk. Design:
`docs/plans/2026-10-14-grove-bins-design.md` §9b / §10b. Code:
`workers/src/handlers/grove-intake.js`, parser `workers/src/lib/grove-mail.js`,
poller `apps-script/grove-mail-poller/Code.gs`.

The chain:

```
Grove email → Gmail filter (label Grove/Orders) → Apps Script poller (every 5 min)
  → POST /api/kanban?action=groveMail → request row + kanban_orders + 17TRACK registration
17TRACK webhook (Delivered) → POST /api/kanban?action=trackingEvent → receive + baseline → one line to Koa
daily cron → requests past expected + 3 days with no delivery → one line to Koa
```

## 1. Worker

- [ ] **Migration 0047 on remote:**
  `cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0047-grove-mail-intake.sql`
- [ ] **Secrets** (`cd workers && npx wrangler secret put <NAME>`):

  | Secret | Value |
  |---|---|
  | `WEBHOOK_SECRET` | already bound (Shopify Flow); the poller sends the same value |
  | `TRACK17_KEY` | the 17TRACK API security key (step 3) — used to register numbers **and** to verify webhook signatures |
  | `TELEGRAM_KOA_CHAT_ID` | Koa's chat with the farm bot (`TELEGRAM_BOT_TOKEN`); falls back to `TELEGRAM_CHAT_ID`, then `TELEGRAM_TEST_CHAT_ID` |
  | `KOA_EMAIL` | optional — where the line goes by mail relay when Telegram is not bound (falls back to `REORDER_CC`) |

- [ ] **Deploy** from `workers/` (`npx wrangler deploy`), never during tagging hours.

## 2. Gmail filter (farm Gmail)

Grove sends to the farm address. Give those emails a label the poller can
find. Either forward Grove's mail to the plus address or match the sender:

1. Gmail → Settings → **Filters and Blocked Addresses** → **Create a new filter**.
2. `To:` `roguefamilyfarms+grove@gmail.com` (if Grove is given that address), **or** `From:` Grove's order address (`orders@grovebags.com` or whatever the real one is — check a recent email).
3. **Create filter** → tick **Apply the label** → new label **`Grove/Orders`**. Leave it unread (do **not** tick "Mark as read").
4. Optional: tick **Skip the Inbox** once the loop is proven.

Only messages under `Grove/Orders` are ever read. A forwarded email from Damon
("here's the Grove order") can be dragged onto the label by hand; the parser
reads the forwarded body the same way.

## 3. 17TRACK account

1. Sign up at <https://www.17track.net/en/api> (free tier: 200 registrations, one per tracking number; status updates cost nothing). Grove ships ~26 times a year.
2. Dashboard → **Settings → Security key**: copy it into `TRACK17_KEY`.
3. Dashboard → **Webhook**: URL `https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=trackingEvent`, API version **v2.2+** (the push carries `event` + `data.track_info`). 17TRACK signs each push with a `sign` header = SHA-256 hex of `<raw body>/<security key>`; the worker refuses anything else.
4. Test from the dashboard's "send test webhook" if offered, or by hand with the manual form (no 17TRACK involved):

   ```bash
   curl -s -X POST "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=trackingEvent" -H "X-Webhook-Secret: $WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{"number":"1Z999AA10123456784","status":"Delivered"}'
   ```

   `{"matched":false}` means no request carries that number — the right answer for a made-up one.

Why 17TRACK: AfterShip puts webhooks on its $119/mo Pro plan; UPS and FedEx
have free tracking APIs but no push, and would be two more developer accounts
to keep alive. If 17TRACK ever lapses, the daily overdue check and the Desk's
Receive button still cover the lane, and `trackingEvent` accepts a manual
`{number, status: "Delivered"}` with the webhook secret from any bot.

## 4. Apps Script poller

Same Google account as the Mail Relay (`apps-script/mail-relay/README.md`).

1. <https://script.google.com> → **New project** → name it `RO Grove Mail Poller` → paste `apps-script/grove-mail-poller/Code.gs` over `Code.gs` → save.
2. **Project Settings → Script Properties:**

   | Property | Value |
   |---|---|
   | `WORKER_URL` | `https://rogue-origin-api.roguefamilyfarms.workers.dev` |
   | `WEBHOOK_SECRET` | the worker's `WEBHOOK_SECRET` |

3. Run `testWorkerReachable` once from the editor (authorise Gmail + external requests when asked; Advanced → Go to RO Grove Mail Poller).
4. **Triggers** (clock icon) → **Add trigger**: function `pollGroveMail`, event source **Time-driven**, type **Minutes timer**, **every 5 minutes**. Save.
5. Drag one real Grove email onto `Grove/Orders`, wait five minutes, check **Executions** for `-> applied` and the Desk → Grove tile for the order line.

Labels the script creates on first run: `Grove/Applied` (worker took it) and
`Grove/Review` (the worker could not place size, quantity or tracking — Koa
also gets a Telegram line, and the Desk's Grove tab lists it with **Mark as
handled**).

## 5. What the worker does with a mail

| Mail | Result |
|---|---|
| Order confirmation, sizes + quantities readable | one request per size (closes the open Damon request if there is one, otherwise attaches to the request Damon closed by link, otherwise creates one closed as ordered by `email`); `qty_ordered`, `vendor_ref`, `expected_at` = received + lane lead days; a `kanban_orders` row with the real quantity |
| Shipping notice with tracking | tracking number + carrier + ship date on the same requests (by Grove order number, else by line item); `expected_at` from the carrier estimate, else ship date + 7; number registered with 17TRACK |
| Anything missing (size the ladder cannot place, line with no quantity, shipping notice with neither items nor an order number) | stored as `needs_review`, Koa told, nothing applied |
| Same Gmail message again | `duplicate`, nothing changes |

On **Delivered**: if nobody has logged a Receive since the ship date, the
worker logs the same receive the Desk would (leftover bins = the ledger
estimate, boxes = quantity ÷ bags per box, by `tracking`, lot = Grove order
number), sets `delivered_at`, and sends one line with the lane's new count and
a Desk link. A receive already logged by hand just sets `delivered_at`.

Daily at 6 AM PT: any order past `expected_at` + 3 days with no delivery and
no receive gets one line to Koa, once; the Desk tile reads **OVERDUE** in red
until it lands.

## 6. Checking it

```bash
curl -s "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=getBinStatus" | python3 -c "import json,sys; d=json.load(sys.stdin); print([(l['item'], l.get('order')) for l in d['lanes']]); print(d.get('review'))"
```

```bash
cd workers && npx wrangler d1 execute rogue-origin-db --remote --command "SELECT id, received_at, subject, status, request_id FROM kanban_inbound_mail ORDER BY id DESC LIMIT 10"
```

## 7. Fixtures

The parser is tuned against real Grove emails in `tests/fixtures/grove-mail/`
(`real-*.txt`, expectations in `expected.json`). The `synthetic-*.txt` files
are placeholders in Shopify's notification shape. When a real email parses
wrong: drop it in as a fixture, add its expectation, fix the rule, run
`node --test tests/grove-mail-parser.test.mjs`.
