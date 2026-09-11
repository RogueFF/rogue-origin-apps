# Harvest hourly SMS bot — runbook

One Spanish text per barn per hour to its foreman; one free-form reply, parsed by
Claude, stored as one `harvest_hourly` row per barn-hour and echoed back.

- **Design:** `RogueFamilyFarms/wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md`
- **Plan:** `docs/plans/2026-09-11-harvest-hourly-sms-bot.md` · **Smoke transcript:** `docs/plans/2026-09-11-harvest-hourly-smoke.md`
- **Code:** `workers/src/handlers/harvest-hourly-d1.js` (D1 + network), `workers/src/lib/harvest-hourly*.js`, `workers/src/lib/sms.js`, `workers/src/lib/pacific.js`
- **API base:** `https://rogue-origin-api.roguefamilyfarms.workers.dev`

---

## Deploy (first time)

**1. Check drift before anything ships.**

```bash
git rev-list --left-right --count master...origin/master   # must be 0	0
```

A stale tree silently reverts other people's shipped worker code.

**2. Apply the migration to remote D1 — by hand.**

`wrangler.toml` has no `migrations_dir`, so `wrangler d1 migrations apply` does nothing.

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0032-harvest-hourly.sql
npx wrangler d1 execute rogue-origin-db --remote \
  --command="SELECT name FROM sqlite_master WHERE name LIKE 'harvest_%' ORDER BY name"
```

Expect `harvest_foremen`, `harvest_hourly`, `harvest_sms_inbox` among the results.
If the file fails atomically with `{"D1_RESET_DO":true}`, run each `CREATE` statement
on its own with `--command`.

**3. Set the secrets** (from `workers/`, one prompt each):

```bash
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER              # E.164, e.g. +18885551234
npx wrangler secret put TELEGRAM_HARVEST_HOURLY_CHAT_ID # optional
```

- `ANTHROPIC_API_KEY` is already a worker secret — do not re-set it.
- `TELEGRAM_HARVEST_HOURLY_CHAT_ID` is optional; unset, missed-hour alerts fall back
  to `TELEGRAM_TEST_CHAT_ID`. With neither set, `sendTelegramMessage` returns `false`
  and nothing else breaks.
- `TWILIO_WEBHOOK_URL` — **leave unset on `*.workers.dev`.** Twilio signs the URL it
  was configured with; behind a custom domain or a proxy that is no longer
  `request.url` and every inbound signature fails. Only then set it, to the exact
  string configured in the Twilio console.
- `HARVEST_HOURLY_MODEL` — optional var, overrides the parse model
  (default `claude-opus-5`). It must be a model that accepts `output_config.effort`
  **and** `fallbacks`: Sonnet 5 does, Haiku 4.5 does not. A model that rejects them
  makes every parse a 400 and every reply comes back "No entendi".
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
- `https://rogue-origin-api.roguefamilyfarms.workers.dev/sms/inbound`

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

## Rehearsal, and the test-mode flag

`is_test` is `1` on every row **unless** `HARVEST_TEST_MODE === "false"`.

> **`workers/wrangler.toml` currently commits `HARVEST_TEST_MODE = "false"`** (flipped
> for the real harvest capture). So a rehearsal done today writes **live** rows that
> the `is_test = 1` cleanup below will not touch.

To rehearse against test rows, flip it and put it back:

1. Edit `[vars]` in `workers/wrangler.toml` to `HARVEST_TEST_MODE = "true"`, commit, and
   `npx wrangler deploy` from `workers/`.
2. Rehearse: text `EMPEZAR` from a registered phone, wait for the next top of hour,
   answer the prompt, then check `?action=hourly`.
3. Flip back to `"false"`, commit, deploy — **before the first real cut.** Every crew
   screen shows a red band while this is `"true"`, so the state is visible on a phone.

Cleaning up rehearsal data (mirrors the `harvest_scan_log` / `harvest_sacks` cleanup
in `migrations/0009` and `0010`):

```sql
DELETE FROM harvest_hourly WHERE is_test = 1;
DELETE FROM harvest_sms_inbox;
UPDATE harvest_foremen SET active = 0, active_since = NULL;
```

`harvest_sms_inbox` is a Twilio-redelivery dedupe ledger and `harvest_foremen` is the
roster — neither carries `is_test`, so clear them explicitly rather than by flag.

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

**The hourly cycle** runs off the every-5-minute cron, driven by row state, so a late
or doubled tick never texts twice:

| When | What |
|---|---|
| Top of the hour | Prompt: `12:00 Granero Arriba. Responde en un mensaje: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas.` |
| +15 min, no answer | Nudge: `Recordatorio Granero Arriba: faltan los numeros de 11-12. Ejemplo: 4 2 3 8 1 12 sin novedad` |
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

**Future hours are refused.** An hour that has not ended yet is never created —
`5: ...` sent at 10 AM means 17:00, and the reply is `Esa hora todavia no termina.`

**`AYUDA`** (or `HELP`) returns the full field list and the `EMPEZAR` / `PARAR` reminder.

**An inactive foreman can still answer an open row** — that is how the reply to the
19:00 prompt lands after the auto-stop. Only with nothing open does he get
`Escribe EMPEZAR para comenzar el dia.`

---

## Reading the data

```bash
curl -s "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=hourly&date=2026-10-15" \
  -H "Authorization: Bearer <pw>"
```

`date` defaults to today (Pacific). The response is
`{ date, is_test, roster, barns: { upper: {...}, bottom: {...} } }`, each barn carrying
`label`, `rows` (every row for the day), `total_racks`, `person_hours`,
`racks_per_hanger_hour`, `missing_hours`, and `latest` (the newest `complete` row).

Two deliberately different denominators:

- **`total_racks` = every row for the barn, any status.** One definition, shared by the
  `PARAR` reply and the day read — a rack hung is a rack hung even if the crew counts
  never came in. If the two ever disagree, one of them stopped using `sumRacks`.
- **`person_hours` and `racks_per_hanger_hour` cover `complete` rows only.** A rate
  needs a whole hour to divide by.

The **harvest dashboard** (`?action=harvest_dash`, farm password) shows the same data
as an "Hourly crew log" card: one line per hour per barn, the day summary, and a
"Roster differs on: …" line when the standing crew roster disagrees with the latest
hourly counts. `roster` is `null` when `harvest_crew_roster` is empty, and `latest` is
`null` until a row reaches `complete`; the card guards both.

---

## Local development

**1. `workers/.dev.vars`** (gitignored — confirm with `git check-ignore -v .dev.vars`):

```
ORDERS_PASSWORD=devpass
HARVEST_TEST_MODE=true
ANTHROPIC_API_KEY=<a real key>
```

Leave the Twilio secrets unset: `sendSms` then logs
`[sms] not configured — to <phone>: <text>`, which is what the smoke test reads.
A real `ANTHROPIC_API_KEY` is required for the two parse-dependent smoke steps —
without it every answer comes back `No entendi` and the log says
`[hourly-parse] ANTHROPIC_API_KEY unset`.

**2. Apply the harvest migrations to the local D1.** A fresh local DB has none of
them, and `?action=harvest_metrics` (what the dashboard fetches first) 500s until the
older harvest tables exist:

```bash
cd workers
for f in migrations/00*-harvest*.sql; do
  npx wrangler d1 execute rogue-origin-db --local --file="$f"
done
```

Every harvest migration is `IF NOT EXISTS` / additive, so re-running the loop is free.
`?action=hourly` alone needs only `0013-harvest-crew-roster.sql` and
`0032-harvest-hourly.sql`.

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

**5. `npm test`** (from `workers/`) — 41 passing, 0 failing. `node --test`, no D1
harness: `harvest-hourly-d1.js` is covered end to end through `hourly_simulate`, not
by unit tests.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[sms] bad Twilio signature (verified against <url>)`, inbound 403s | The URL in the log is not the URL configured in the Twilio console. Fix the console entry, or set `TWILIO_WEBHOOK_URL` to the exact configured string (custom domain / proxy only). |
| `[sms] TWILIO_AUTH_TOKEN unset — inbound is unauthenticated` | The secret is missing in production. Anyone can POST `/sms/inbound`. Set it. |
| Every reply comes back `No entendi`, log says `[hourly-parse] ANTHROPIC_API_KEY unset` | The key is not on the worker. `npx wrangler secret list` from `workers/`. |
| `[hourly-parse] Anthropic 400: …` on every reply | Usually `HARVEST_HOURLY_MODEL` set to a model that rejects `output_config.effort` / `fallbacks` (e.g. Haiku 4.5). Unset it to fall back to `claude-opus-5`. |
| `[hourly-parse] no JSON: stop_reason=… model=…` or `refused: …` | The call succeeded but produced nothing usable. `stop_reason` says whether it was a refusal, a truncation, or something new. The foreman got `No entendi`; ask him to resend the numbers. |
| `Error temporal. Manda los numeros de nuevo.` | The parse call itself failed — network fault or the 20 s timeout, not a reply the model could not read. Look for `[hourly] parse call failed for <phone>: …`. |
| `[hourly-tick] <phone>: <error>` or `[hourly-tick] <barn> <hour>: <error>` | One barn's send or write failed; the other barn and the other rows continued. Usually a bad phone number or a Twilio error (the message names the status and the recipient). |
| `[hourly-tick] no foreman registered for barn <barn> — <hour> left open` | An open row on a barn with no roster entry at all. Register a foreman; the row stays open until someone can be texted about it. |
| A foreman keeps getting `No entendi` | Read the row: `SELECT hour_start, raw_reply, status FROM harvest_hourly WHERE harvest_date = '<date>' AND barn = '<barn>' ORDER BY hour_start`. `raw_reply` is his text verbatim, and it is what the parse actually saw. |
| A backfill hour is nudged seconds after it was sent, with no 15-minute grace | Expected when the backfill's **first** reply failed to parse: the row exists with both `asked_at` and `answered_at` null (the bot never prompted for it, and nothing was written), so the tick reads it as infinitely overdue — nudge on the next tick, `missing` 15 minutes later. A backfill that parsed takes its grace from `answered_at`. |
| A freshly activated foreman gets no prompt on the next tick | By design. An hour that ended **before** he texted `EMPEZAR` is never asked about — he was not working it. The first ask appears on a tick in a clock hour after the activation hour. |
| No texts arrive at all, but the log looks clean | Toll-free verification is not approved yet, or the three `TWILIO_*` secrets are unset (look for `[sms] not configured`). |

---

## Costs

SMS ~$0.0083 per segment, 2–4 texts per barn-hour. Model: one Opus 5 low-effort
Messages call per inbound reply.
