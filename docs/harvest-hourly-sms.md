# Harvest hourly SMS bot — runbook

One Spanish text per barn per hour to its foreman; a conversational reply in
Spanish; one `harvest_hourly` row per barn-hour.

**Two processes, and the split is the whole architecture.** The worker
(`rogue-origin-api`) is the mailbox and the state machine: it keeps the clock,
the rows, the Twilio credentials, and it answers `EMPEZAR` / `PARAR` / `AYUDA`
itself, deterministically — the day never starts or stops on a model. **The
worker never calls a model.** Every other inbound text is queued in
`harvest_sms_inbox` as `kind='chat', processed=0` and left there.

**Capataz** is a `claude -p` relay running on FERN on Koa's subscription
(`Desktop\Dev\capataz-bot`, a copy of the `riego-bot` kit). It polls the worker
every 2.5 s for queued texts, runs one resumable session per foreman phone with
a Spanish persona, writes the numbers back through the farm-bridge MCP tool
`log_hourly_crew` → `POST ?action=hourly_set`, and sends its replies through
`POST ?action=sms_send`. It never touches Twilio.

**If Capataz is down, nothing is lost.** Texts wait in the inbox, the worker's
own clock keeps prompting and nudging, and the tick Telegrams Koa after three
minutes. When the relay comes back it drains the queue and answers.

- **Design:** `RogueFamilyFarms/wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md` (read the "v2 — Capataz" section)
- **Plans:** `docs/plans/2026-09-11-capataz-v2.md` (v2) · `docs/plans/2026-09-11-harvest-hourly-sms-bot.md` (v1, still the reference for the clock and the rows)
- **Smoke transcripts:** `docs/plans/2026-09-11-harvest-hourly-smoke.md` (v1) · `docs/plans/2026-09-11-capataz-smoke.md` (v2 loop)
- **Code:** `workers/src/handlers/harvest-hourly-d1.js` (D1 + network), `workers/src/lib/harvest-hourly.js`, `workers/src/lib/sms.js`, `workers/src/lib/pacific.js`
- **API base:** `https://rogue-origin-api.roguefamilyfarms.workers.dev`

### One secret name, three places

`HARVEST_SMS_KEY` — **spelled exactly that, everywhere.** It is the bearer for
`sms_poll`, `sms_send` and `hourly_set`, and it is **not** the farm password: a
key that lives on a bot host must not also unlock orders. The same value goes
on the API worker (secret), on the farm-bridge MCP worker (secret, used by
`log_hourly_crew`), and in `capataz-bot/config/secrets.json` as `sms_key`.
Locally it is `HARVEST_SMS_KEY=devsmskey` in `workers/.dev.vars`.

> The wiki design record calls this `HARVEST_SMS_POLL_KEY` in one paragraph.
> That name is stale and was never used in the code.

---

## Deploy (first time)

**1. Check drift before anything ships.**

```bash
git rev-list --left-right --count master...origin/master   # must be 0	0
```

A stale tree silently reverts other people's shipped worker code.

**2. Apply the migrations to remote D1 — by hand, BEFORE the worker deploys.**

`wrangler.toml` has no `migrations_dir`, so `wrangler d1 migrations apply` does nothing.

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0032-harvest-hourly.sql
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0033-harvest-sms-queue.sql
npx wrangler d1 execute rogue-origin-db --remote \
  --command="SELECT name FROM sqlite_master WHERE name LIKE 'harvest_%' ORDER BY name"
npx wrangler d1 execute rogue-origin-db --remote \
  --command="PRAGMA table_info(harvest_sms_inbox)"
```

Expect `harvest_foremen`, `harvest_hourly`, `harvest_sms_inbox` among the tables, and
`kind`, `processed`, `delivered_at`, `replied_at` among the inbox columns.
If a file fails atomically with `{"D1_RESET_DO":true}`, run each statement on its own
with `--command`.

> **0033 must land before this worker version ships.** The `?action=hourly` read now
> selects on `harvest_sms_inbox.kind` for its `pending_sms` count, so a worker deployed
> against a pre-0033 database 500s on the dashboard's own first fetch. 0033 is
> `ALTER TABLE ADD COLUMN` and is **not** idempotent — re-running it errors on
> "duplicate column name", which is harmless but means "already applied", not "failed".

**3. Set the secrets** (from `workers/`, one prompt each):

```bash
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER              # E.164, e.g. +18885551234
npx wrangler secret put HARVEST_SMS_KEY                 # the Capataz bearer
npx wrangler secret put TELEGRAM_HARVEST_HOURLY_CHAT_ID # optional
```

- `HARVEST_SMS_KEY` — generate once (`openssl rand -hex 32`) and set **the same value**
  on the farm-bridge worker and in `capataz-bot/config/secrets.json` as `sms_key`.
  Unset on the worker, all three host endpoints return `INTERNAL_ERROR`
  `HARVEST_SMS_KEY not configured` rather than silently accepting anything.
- `ANTHROPIC_API_KEY` is already a worker secret and is **not** used by the hourly bot
  any more — `production/chat.js` and `sop-d1.js` still need it. Do not re-set it, and
  do not remove it.
- `TELEGRAM_HARVEST_HOURLY_CHAT_ID` is optional; unset, missed-hour and Capataz-stale
  alerts fall back to `TELEGRAM_TEST_CHAT_ID`. With neither set, `sendTelegramMessage`
  returns `false` and nothing else breaks.
- `TWILIO_WEBHOOK_URL` — **leave unset on `*.workers.dev`.** Twilio signs the URL it
  was configured with; behind a custom domain or a proxy that is no longer
  `request.url` and every inbound signature fails. Only then set it, to the exact
  string configured in the Twilio console.
- With the three `TWILIO_*` secrets unset, `sendSms` logs
  `[sms] not configured — to <phone>: <text>` instead of sending. That is the
  local-dev path, not a production state.

**4. Deploy the worker.**

```bash
cd workers && npx wrangler deploy
```

Never the root `npm run deploy` — the root config ships a bindingless assets worker.

**5. Point Twilio at the webhook.**

Twilio console → the toll-free number → Messaging → "A message comes in":

- Webhook, **HTTP POST**
- exactly `https://rogue-origin-api.roguefamilyfarms.workers.dev/sms/inbound`

Type the URL exactly as written. A trailing slash is tolerated since the latest fix,
but anything else Twilio signs a different string than the worker verifies, and every
inbound POST 403s.

**Toll-free verification must be approved before carriers deliver anything.** Until
then outbound texts are accepted by Twilio and silently dropped by the carriers —
the worker log will look perfectly healthy.

**6. Register the foremen** (farm password as bearer):

```bash
curl -s -X POST "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=foreman_set" \
  -H "Authorization: Bearer <pw>" -H "Content-Type: application/json" \
  -d '{"phone":"+15415551234","name":"Juan","barn":"upper"}'

curl -s "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=foremen" \
  -H "Authorization: Bearer <pw>"
```

- `barn` is `upper` (Granero Arriba) or `bottom` (Granero Abajo).
- `phone` must match `+1` followed by exactly 10 digits — **US/Canada numbers only**;
  anything else is rejected at registration.
- **One active foreman per barn.** Registering with `"active": true`, or a foreman
  texting `EMPEZAR`, deactivates the other phone on that barn. Two active phones
  would mean two prompts for one hour and two half-answers racing for one row.
- A new foreman starts `active: 0`; he activates himself by texting `EMPEZAR`.

---

## Rehearsal

> **Do not touch `HARVEST_TEST_MODE`.** It is `"false"` because the live 2026 harvest
> is being tracked right now; flipping it to `"true"` would turn real zone scans into
> test rows (`workers/wrangler.toml` carries the history). `is_test` on `harvest_hourly`
> rows simply follows the same flag as everything else — there is no hourly-only switch.

Rehearse against production instead, then delete exactly what you wrote.
`hourly_simulate` runs against whatever worker you call it on — on production it writes
real rows and flips real foremen; use it locally.

1. Pick a **non-harvest day, or a barn that is not running.** Register a rehearsal
   phone on that barn (`foreman_set`), text `EMPEZAR`, wait for the next top of hour,
   answer the prompt, then check `?action=hourly&date=<date>`.
2. Delete the rehearsal rows by date and barn — never by `is_test`:

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote \
  --command="DELETE FROM harvest_hourly WHERE harvest_date = '<date>' AND barn = '<barn>';"
npx wrangler d1 execute rogue-origin-db --remote \
  --command="DELETE FROM harvest_sms_inbox WHERE received_at < '<date> 23:59:59' AND from_phone = '<phone>';"
npx wrangler d1 execute rogue-origin-db --remote \
  --command="UPDATE harvest_foremen SET active = 0, active_since = NULL WHERE phone = '<phone>';"
npx wrangler d1 execute rogue-origin-db --remote \
  --command="DELETE FROM harvest_foremen WHERE phone = '<phone>';"
```

`harvest_sms_inbox` is both the Twilio-redelivery dedupe ledger and the Capataz work
queue — clear the rehearsal phone's rows or the watchdog keeps counting them (they
join `harvest_foremen`, so deleting the roster row alone hides them from the alert but
leaves them queued forever). `harvest_foremen` is the
roster; neither carries `is_test`, so both are cleared by phone.

Deleting the rehearsal roster row is not the end of it: the barn's **real** foreman has
to text `EMPEZAR` again, because the rehearsal `EMPEZAR` deactivated them.

---

## Daily operation

**The day.** Foreman texts `EMPEZAR` to start, `PARAR` to end. `PARAR` replies with the
barn's rack total: `Ok, paramos. Hoy Granero Arriba: 27 racks. Gracias.`

**Auto-stop** fires on either condition, and sends `Paramos por hoy. Escribe EMPEZAR manana.`:

- the last **three finalized hours in a row are all `missing`** (a `complete` hour in
  that window resets it; the window is scoped to hours asked since the current
  `EMPEZAR`, so re-starting the day does not inherit the previous run's misses), or
- the Pacific clock hour is **20 or later** — and the 20:00 tick still asks for the
  19:00 hour first, so nothing is dropped at the end of the day.

**After 8 PM the bot sends no reminders and asks for no new hours.** The 20:00 tick is
the one exception: it still sends the 19:00 prompt and then the `Paramos por hoy`
sign-off, back to back. Open rows still age to `missing` and reach Telegram, so an
evening alert is the log catching up.

**The hourly cycle** runs off the every-5-minute cron, driven by row state, so a late
or doubled tick never texts twice:

| When | What |
|---|---|
| Top of the hour | Prompt: `12:00 Granero Arriba. Responde en un mensaje: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas.` |
| +15 min, no answer (before 8 PM) | Nudge: `Recordatorio Granero Arriba: faltan los numeros de 11-12. Ejemplo: 4 2 3 8 1 12 sin novedad` |
| +30 min, still nothing | Row flagged `missing`, and Telegram gets `⏰ Sin respuesta: Granero Arriba 11:00 (Juan)` |

**Answering.** Six numbers in order — cutters, field waterspiders, drivers, hangers,
barn waterspiders, racks — plus anything else as a note:
`4 2 3 8 1 12 se rompio un rack` → `Ok 11-12 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack`.
A partial answer gets `Falta: colgadores, waterspiders granero, racks. Cuantos de 11 a 12?`;
the next bare numbers fill the still-missing fields **in order**.

**Backfill** an earlier hour with a prefix: `9am: 4 2 3 8 1 12`, `9: ...`, `1pm - ...`.
A bare hour below 6 is read as PM (the barn is never open at 1 AM).

**Corrections overwrite counts and append notes.** A later reply for the same hour
replaces the counts it carries and leaves the rest alone; its note is appended to the
existing one with `; ` — an earlier note is never erased. An out-of-range number
(counts 0–50, racks 0–200) is refused per field with
`Numero fuera de rango: cortadores. Se mantiene el valor anterior.` and the old value survives.

**`sin novedad` is not a note.** `sin novedad(es)`, `nada`, `todo bien`, `ok`,
`nothing`, `none`, `no notes` (any trailing `.!,;` ignored) all normalize to null, so
the day summary is not padded with copies of "nothing to report".

**Three ways a write is refused**, all of them HTTP 200 with `ok:false`, a `reason`,
and a ready Spanish `reply` the relay sends verbatim. A refused hour is a normal
conversational outcome, not an error — only auth and validation faults throw.

| `reason` | When | Reply |
|---|---|---|
| `future_hour` | The named hour has not ended. `5: ...` sent at 10 AM means 17:00 (a bare hour below 6 is PM), and creating that row would give the day a future hour that swallows every later un-prefixed answer. | `Esa hora todavia no termina.` |
| `not_started` | No hour was named, nothing is open, and the foreman is not active. | `Escribe EMPEZAR para comenzar el dia.` |
| `no_hour_yet` | No hour was named, nothing is open, he *is* active, and no hour has ended yet today (the 00:xx hour). | `Todavia no hay hora que reportar.` |

The `not_started` check comes first on purpose: during the 00:xx hour an inactive
foreman should be told to text `EMPEZAR`, not that there is no hour yet.

**`AYUDA`** (or `HELP`) returns the full field list and the `EMPEZAR` / `PARAR` reminder.

**An inactive foreman can still answer an open row** — that is how the reply to the
19:00 prompt lands after the auto-stop. Only with nothing open does he get
`Escribe EMPEZAR para comenzar el dia.`

**`raw_reply` is never erased.** It holds the foreman's own words, and `raw_text` is
optional on `hourly_set` — so the column is written with `COALESCE(?, raw_reply)`:
a tool call that omits it leaves whatever an earlier call stored. (In v1 the inbound
path always had the text to hand and overwrote unconditionally.) When a row's numbers
look wrong, `raw_reply` is what the foreman actually sent.

---

## Reading the data

```bash
curl -s "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=hourly&date=2026-10-15" \
  -H "Authorization: Bearer <pw>"
```

`date` defaults to today (Pacific). The response is
`{ date, is_test, roster, pending_sms, barns: { upper: {...}, bottom: {...} } }`,
each barn carrying
`label`, `rows` (every row for the day), `total_racks`, `person_hours`,
`racks_per_hanger_hour`, `missing_hours`, and `latest` (the newest `complete` row).

Two deliberately different denominators:

- **`total_racks` = every row for the barn, any status.** One definition, shared by the
  `PARAR` reply and the day read — a rack hung is a rack hung even if the crew counts
  never came in. If the two ever disagree, one of them stopped using `sumRacks`.
- **`person_hours` and `racks_per_hanger_hour` cover `complete` rows only.** A rate
  needs a whole hour to divide by.

`pending_sms` is the **queue depth right now**, not a count for the date being read —
`harvest_sms_inbox` has no `harvest_date`, and what the number reports is "texts
Capataz has not picked up yet", which is a right-now fact whatever day you are
looking at. A healthy relay keeps it at 0 or 1; a steady non-zero means the relay is
down, and the tick says so on Telegram after three minutes.

The **harvest dashboard** (`?action=harvest_dash`, farm password) shows the same data
as an "Hourly crew log" card: one line per hour per barn, the day summary, and a
"Roster differs on: …" line when the standing crew roster disagrees with the latest
hourly counts. `roster` is `null` when `harvest_crew_roster` is empty, and `latest` is
`null` until a row reaches `complete`; the card guards both. When `pending_sms > 0` the
card carries one extra line under the heading: **"N texts waiting for Capataz"**.

### The host endpoints (Capataz only)

All three take `Authorization: Bearer $HARVEST_SMS_KEY`. A wrong or missing key is a
`401 UNAUTHORIZED`; an unset secret on the worker is a `500 INTERNAL_ERROR`.

| Endpoint | Contract |
|---|---|
| `GET ?action=sms_poll&limit=N` | Queued chat texts, oldest first (default 20, capped 100). Each carries a `context` object: the foreman, the open row and what is still missing on it, `just_ended_hour`, today's totals and rows, `now_pacific`. **Rows are claimed as they go out** (`processed=1, delivered_at`), so two overlapping polls cannot hand one text to two sessions and answer the foreman twice. A row whose sender is not a registered foreman is skipped and left queued. |
| `POST ?action=sms_send {to,text}` | Registered foreman phones only (`404` otherwise). The text is run through `gsmSafe` — NFD, combining marks dropped, `¿¡` removed, whitespace folded, then everything still outside printable ASCII stripped — and refused over 480 characters. Returns `{sent, text, segments}`; `sent:false` means Twilio is unconfigured (local dev). Also stamps `replied_at` on that phone's delivered rows. |
| `POST ?action=hourly_set {phone, hour_start?, …six counts…, notes?, raw_text?}` | The `log_hourly_crew` tool's endpoint. Returns `{ok:true, row, missing, invalid, reply}` or `{ok:false, reason, reply}` — **200 either way**. `hour_start` is `HH:00` or omitted (target the open hour). A call carrying no counts and no notes is a `400`: it would stamp `answered_at` and silently cancel that hour's nudge without a single number having been reported. |

---

## Local development — the whole loop on one PC

No FERN, no Twilio, no API key. Three processes, all local; the relay uses the PC's
own Claude Code on the subscription.

**1. `workers/.dev.vars`** (gitignored — confirm with `git check-ignore -v .dev.vars`):

```
ORDERS_PASSWORD=devpass
HARVEST_TEST_MODE=true
HARVEST_SMS_KEY=devsmskey
```

Leave the Twilio secrets unset: `sendSms` then logs
`[sms] not configured — to <phone>: <text>`, and **those log lines are the replies** —
they are how you read what Capataz said without a phone.

**2. Apply the harvest migrations to the local D1.** A fresh local DB has none of
them, and `?action=harvest_metrics` (what the dashboard fetches first) 500s until the
older harvest tables exist:

```bash
cd workers
for f in migrations/00*-harvest*.sql; do
  npx wrangler d1 execute rogue-origin-db --local --file="$f"
done
```

The older harvest migrations are `IF NOT EXISTS` / additive, so re-running the loop is
free — except `0033-harvest-sms-queue.sql`, which is `ALTER TABLE ADD COLUMN` and errors
with "duplicate column name" once applied. That error means "already applied".
`?action=hourly` alone needs `0013-harvest-crew-roster.sql`, `0032-harvest-hourly.sql`
and `0033-harvest-sms-queue.sql`.

**2b. The other two processes** (only needed for the full conversational loop; the
worker endpoints can be exercised with `curl` alone):

```bash
# farm-bridge MCP — Desktop\telegram-claude-bot, branch feat/log-hourly-crew
# .dev.vars: HARVEST_SMS_KEY=devsmskey  and  HARVEST_API_BASE=http://localhost:8787
npx wrangler dev --port 8788

# Capataz relay — Desktop\Dev\capataz-bot
# config.yaml  sms.api_base: http://localhost:8787
# secrets.json sms_key: devsmskey
# workdir/.mcp.json swapped to the local farm-bridge (workdir/.mcp.local.json)
python -m claude_relay
```

**3. Run the dev server with the scheduled handler exposed:**

```bash
npx wrangler dev --config wrangler.toml --env="" --test-scheduled
curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"      # fire one tick
```

Every tick also fires the JD-ingest and wholesale crons, which fail locally for
unrelated reasons (`missing JD_CLIENT_ID…`, `no such table: order_items`) — expected noise.
`[Cron] Harvest hourly: N action(s)` is the line that matters.

**4. `hourly_simulate` is the no-Twilio path** — it runs the full inbound pipeline and
returns the replies instead of texting them:

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_simulate" \
  -H "Authorization: Bearer devpass" -H "Content-Type: application/json" \
  -d '{"from":"+15415550101","body":"9am: 4 2 3 8 1 12 se rompio un rack"}'
```

It mints a fresh `SIM-<timestamp>` message id per call, so it can never exercise the
redelivery dedupe. For that, POST `/sms/inbound` twice with the same `MessageSid` —
the second call replies `200` with the empty `<Response/>` and sends nothing.

**The response tells you which path the text took.** A command is answered inline:

```json
{"replies":["Listo. Te pregunto cada hora en punto. PARAR para terminar el dia."],
 "queued":false,"message_sid":"SIM-1789168952075"}
```

A chat text is queued and the relay answers it — the worker says nothing:

```json
{"replies":[],"queued":true,"message_sid":"SIM-1789168952106"}
```

**4b. Drive the host endpoints by hand** (bearer `devsmskey`, not the farm password):

```bash
curl -s "http://localhost:8787/api/harvest?action=sms_poll&limit=20" \
  -H "Authorization: Bearer devsmskey"

curl -s -X POST "http://localhost:8787/api/harvest?action=sms_send" \
  -H "Authorization: Bearer devsmskey" -H "Content-Type: application/json" \
  -d '{"to":"+15415550101","text":"Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12"}'

curl -s -X POST "http://localhost:8787/api/harvest?action=hourly_set" \
  -H "Authorization: Bearer devsmskey" -H "Content-Type: application/json" \
  -d '{"phone":"+15415550101","hour_start":"09:00","cutters":4,"cutter_water_spiders":2,
       "drivers":3,"hangers":8,"hanging_water_spiders":1,"racks":12,"notes":"se rompio un rack"}'
```

> On Windows, send non-ASCII bodies from a file with `--data-binary @body.json`.
> Git Bash mangles accented characters on the way in, which makes `gsmSafe` look
> broken (`Cuántos` arriving as `Cuntos`) when it is the console, not the code.

**5. `npm test`** (from `workers/`) — 46 passing, 0 failing. `node --test`, no D1
harness: `harvest-hourly-d1.js` is covered end to end through `hourly_simulate` and
`curl`, not by unit tests. The pure helpers (`gsmSafe`, `smsSegments`,
`buildPollContext`, the message text, the tick decisions) are.

---

## Capataz on FERN

The relay lives at `Desktop\Dev\capataz-bot` — a copy of the `riego-bot` kit with the
WhatsApp transport replaced by `claude_relay/sms.py`. Text only: no Whisper, no TTS,
no media.

**Install** (on FERN):

1. Copy the folder to FERN, then `pip install -r requirements.txt`.
2. `config/secrets.json` from `config/secrets.example.json`: `sms_key` = the same
   `HARVEST_SMS_KEY` value the two workers hold.
3. `config/config.yaml`: `sms.api_base` = the production API base, `sms.enabled: true`.
4. `data/sessions.json` starts as `{}`.
5. Startup shortcut **`RogueFarm-Capataz`** → `scripts/run_bot.vbs` in the Startup
   folder, and a watchdog entry alongside Timber's and Riego's.

**Session keys are `sms:<e164>`** — one resumable conversation per foreman phone, so
"8 1 15" lands on the fields the previous text left missing. **After any change to the
prompt or the tool schema, reset `data/sessions.json` to `{}`** — resumed sessions
carry the old persona and will keep behaving like it.

**`bot.lock`** guarantees one relay per machine. A second `python -m claude_relay`
exits immediately; if the process died hard, delete the lock.

**If Capataz misbehaves — asks "¿así quedó bien?", sends two messages, uses accents —
fix `prompts/persona.md`, not the worker.** The worker's job is the clock and the
rows; the wording and the conversational manners are the persona's. `gsmSafe` on
`sms_send` is a backstop against accents reaching a phone, not the fix.

### The watchdog

Pass (d) of the every-5-minute tick asks two questions, both joined to
`harvest_foremen` so a deleted foreman cannot make the relay look stalled:

- **Stale** — `kind='chat' AND processed=0`, and the oldest has been waiting **over 3
  minutes**. Nobody is polling: the relay is down or cannot reach the worker.
- **Unanswered** — `delivered_at IS NOT NULL AND replied_at IS NULL` for over **5
  minutes**. The relay took the text and never replied: a session is wedged, the tool
  call failed, or `sms_send` is rejecting the key.

Either one alone fires the alert (a relay that polls and then dies leaves nothing
queued and everything unanswered), and both counts go into one Telegram line:

```
⚠️ Capataz no esta drenando SMS (3 pendientes, el mas viejo 7 min, 1 sin respuesta)
```

**At most one every 30 minutes.** The high-water mark is `system_config` key
`capataz_stale_alert_at`, claimed *before* the send so a doubled tick cannot double
the alert. To re-arm it by hand after a fix:

```bash
npx wrangler d1 execute rogue-origin-db --remote \
  --command="DELETE FROM system_config WHERE key = 'capataz_stale_alert_at'"
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[sms] bad Twilio signature (verified against <url>)`, inbound 403s | The URL in the log is not the URL configured in the Twilio console. Fix the console entry, or set `TWILIO_WEBHOOK_URL` to the exact configured string (custom domain / proxy only). |
| `[sms] TWILIO_AUTH_TOKEN unset — inbound is unauthenticated` | The secret is missing in production. Anyone can POST `/sms/inbound`. Set it. |
| Telegram: `⚠️ Capataz no esta drenando SMS (N pendientes, el mas viejo M min)` | The relay is not polling. On FERN: is the process up, is `bot.lock` held by a dead process, can it reach the API base? Texts are safe in the inbox and get answered when it comes back. |
| The same alert with `… sin respuesta` | The relay *is* polling but never replies. Usually `sms_send` returning `401` (key mismatch) or the `log_hourly_crew` tool failing. Check the relay log, then `npx wrangler tail` for `[AUTH] Failed HARVEST_SMS_KEY attempt`. |
| `sms_poll` / `sms_send` / `hourly_set` return `401 Invalid bearer token` | `HARVEST_SMS_KEY` differs between the API worker, the farm-bridge worker and `capataz-bot/config/secrets.json`. It is one value in three places. |
| Any of the three returns `500 HARVEST_SMS_KEY not configured` | The secret was never set on that worker. `npx wrangler secret list`. |
| Relay logs `bot.lock` held / exits immediately | A second instance, or a previous one that died hard. One relay per machine; delete the lock if no process owns it. |
| Capataz asks for confirmation, sends two texts, or uses accents | Persona drift. Fix `prompts/persona.md` and reset `data/sessions.json` to `{}` — resumed sessions keep the old prompt. Never fix this in the worker. |
| `pending_sms` climbs steadily on the dashboard | Same cause as the stale alert. One or two is normal in-flight traffic. |
| `[hourly-tick] <phone>: <error>` or `[hourly-tick] <barn> <hour>: <error>` | One barn's send or write failed; the other barn and the other rows continued. Usually a bad phone number or a Twilio error (the message names the status and the recipient). |
| `[capataz-watchdog] <error>` | The watchdog itself faulted; the tick's prompts and nudges still ran (it is wrapped). Usually a missing 0033 column — check `PRAGMA table_info(harvest_sms_inbox)`. |
| Dashboard 500s right after a deploy | 0033 was not applied to remote D1 first. The `hourly` read selects `harvest_sms_inbox.kind`. Apply it, no redeploy needed. |
| `[hourly-tick] no foreman registered for barn <barn> — <hour> left open` | An open row on a barn with no roster entry at all. Register a foreman; the row stays open until someone can be texted about it. |
| A row's numbers look wrong | `SELECT hour_start, raw_reply, reported_by, status FROM harvest_hourly WHERE harvest_date = '<date>' AND barn = '<barn>' ORDER BY hour_start` — `raw_reply` is the foreman's own words, and it is never erased (COALESCEd, see above). Corrections overwrite: a later `hourly_set` for the same hour replaces the counts it carries. |
| A freshly activated foreman gets no prompt on the next tick | By design. An hour that ended **before** he texted `EMPEZAR` is never asked about — he was not working it. The first ask appears on a tick in a clock hour after the activation hour. |
| Foreman texted `STOP` (English) | Twilio's carrier-level opt-out unsubscribed the number; every send to them fails with Twilio error 21610 (`[hourly-tick] +1…: Twilio 400…`). Recovery: they text `START` or `UNSTOP` to the bot number, then `EMPEZAR`. Tell foremen to use `PARAR`, never STOP. |
| No texts arrive at all, but the log looks clean | Toll-free verification is not approved yet, or the three `TWILIO_*` secrets are unset (look for `[sms] not configured`). |

---

## Costs

SMS ~$0.0083 per segment, 2–4 texts per barn-hour — the only metered cost. **There is
no API spend:** the worker calls no model, and Capataz runs on Koa's Claude Code
subscription on FERN. That is the whole reason for the v2 split.
