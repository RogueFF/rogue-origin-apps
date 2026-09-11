# Harvest hourly SMS bot — Task 7 smoke transcript

Plan: `docs/plans/2026-09-11-harvest-hourly-sms-bot.md`, Task 7.
Run: 2026-09-11, ~12:25–12:31 Pacific (19:25–19:31 UTC), `wrangler dev` 4.131.1 on
`http://localhost:8787`, local D1, `HARVEST_TEST_MODE=true`, Twilio secrets unset
(so `sendSms` logs instead of sending).

Command form for every HTTP call below:

```bash
curl -s [-X POST] "http://localhost:8787/api/harvest?action=<action>" \
  -H "Authorization: Bearer devpass" -H "Content-Type: application/json" -d '<json>'
```

## BLOCKER — the three model-dependent steps did not run

`workers/.dev.vars` was created with `ORDERS_PASSWORD=devpass` and
`HARVEST_TEST_MODE=true`, but **no `ANTHROPIC_API_KEY` was available**:

- `C:\Users\Koasm\Desktop\Dev\rogue-origin-apps\workers\.dev.vars` — does not exist
  (no `.dev.vars` exists anywhere under `Desktop\Dev`).
- `ANTHROPIC_API_KEY` — unset in the Bash env, the PowerShell session env, the
  Windows User env and the Machine env.

No key was invented. Every step that needs `parseReply` is therefore **BLOCKED**
and must be re-run once a key is dropped into `workers/.dev.vars`:
plan steps E (`9am: ...`), F (`10am: cuatro cortadores...`), G (`10am: 8 1 15`),
the numeric assertions in H (`total_racks: 27`, `person_hours: 36`,
`racks_per_hanger_hour: 1.69`), the `parar` total (`27 racks`), and the three
extra cases (out-of-range correction, `9am: sin novedad`, fresh-hour
`sin novedad`).

Everything that does not call the model was exercised and passed. Step E was run
anyway to prove the route reaches the parser — see E below.

## Environment finding (pre-smoke)

The worktree's local D1 contained only the three tables from `0032`. `readDay()`
does an unconditional `SELECT ... FROM harvest_crew_roster`, so `?action=hourly`
would have 500'd. Applied the prerequisite migration locally (environment setup,
no code change):

```bash
npx wrangler d1 execute rogue-origin-db --local --file=migrations/0013-harvest-crew-roster.sql
npx wrangler d1 execute rogue-origin-db --local --file=migrations/0032-harvest-hourly.sql   # idempotent
```

Result: `harvest_crew_roster, harvest_foremen, harvest_hourly, harvest_sms_inbox`.

Also checked before wiring: `grep "case 'hourly'|'foremen'|'foreman_set'|
'hourly_simulate'|'hourly_test'" src/handlers/harvest-d1.js` → no matches, so the
`HOURLY_ACTIONS` dispatch shadows nothing in the existing harvest handler.

## Plan Step 6 — smoke script

### A. `action=hourly_test`

- Expected: `{"success":true,"message":"Harvest hourly API operational"}`
- Actual: `{"success":true,"message":"Harvest hourly API operational"}`
- **PASS**

### B. `action=foreman_set` — `{"phone":"+15415550101","name":"Test Arriba","barn":"upper"}`

- Expected: `foreman` object with `active: 0`
- Actual:
  ```json
  {"foreman":{"phone":"+15415550101","name":"Test Arriba","barn":"upper","active":0,"active_since":null,"lang":"es","created_at":"2026-09-11 19:28:45"}}
  ```
- **PASS**

### C. `hourly_simulate` — `{"from":"+15415550101","body":"4 2 3 8 1 12"}` (before EMPEZAR)

- Expected: `replies: ["Escribe EMPEZAR para comenzar el dia."]`
- Actual: `{"replies":["Escribe EMPEZAR para comenzar el dia."]}`
- **PASS**

### D. `hourly_simulate` — `{"body":"empezar"}`

- Expected: `replies: ["Listo. Te pregunto cada hora en punto. PARAR para terminar el dia."]`
- Actual: `{"replies":["Listo. Te pregunto cada hora en punto. PARAR para terminar el dia."]}`
- **PASS**

### E. `hourly_simulate` — `{"body":"9am: 4 2 3 8 1 12 se rompio un rack"}`

- Expected: `replies: ["Ok 9-10 Arriba: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack"]`
- Actual:
  ```json
  {"replies":["No entendi. Manda los numeros en orden: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks. Ejemplo: 4 2 3 8 1 12 sin novedad"]}
  ```
  Server log: `X [ERROR] [hourly-parse] ANTHROPIC_API_KEY unset`
- **BLOCKED (no API key).** The value of running it: the request reached
  `handleHarvestHourly` → `processInbound` → `answer` → `parseReply`, the `09:00`
  row was created with `asked_at NULL` (the backfill rule), and the failure is
  exactly and only the missing key. The routing under test is proven; the parse
  is not.

### F. `hourly_simulate` — `{"body":"10am: cuatro cortadores, 2 ws, 3 choferes"}`

- Expected: `replies: ["Falta: colgadores, waterspiders granero, racks. Cuantos de 10 a 11?"]`
- **NOT RUN — BLOCKED (no API key).** Would return the `No entendi` text as in E.

### G. `hourly_simulate` — `{"body":"10am: 8 1 15"}`

- Expected: `replies: ["Ok 10-11 Arriba: C4 WSc2 Ch3 Col8 WSg1 R15"]`
- **NOT RUN — BLOCKED (no API key).**

### H. `GET ?action=hourly`

- Expected: `barns.upper.rows` has two complete rows (09:00, 10:00),
  `total_racks: 27`, `person_hours: 36`, `racks_per_hanger_hour: 1.69`
- Actual (with only the null-valued `09:00` row from E):
  ```json
  {"date":"2026-09-11","is_test":1,"roster":null,"barns":{"upper":{"label":"Granero Arriba","rows":[{"id":1,"season":2026,"harvest_date":"2026-09-11","hour_start":"09:00","barn":"upper","cutters":null,"cutter_water_spiders":null,"drivers":null,"hangers":null,"hanging_water_spiders":null,"racks":null,"notes":null,"raw_reply":null,"reported_by":null,"status":"pending","asked_at":null,"nudged_at":null,"answered_at":null,"is_test":1,"created_at":"2026-09-11 19:29:00"}],"total_racks":0,"person_hours":0,"racks_per_hanger_hour":null,"missing_hours":[],"latest":null},"bottom":{"label":"Granero Abajo","rows":[],"total_racks":0,"person_hours":0,"racks_per_hanger_hour":null,"missing_hours":[],"latest":null}}}
  ```
- **PARTIAL PASS.** The endpoint, the shape, the barn split, the summary fields
  and `roster` all work — `readDay` does not throw once `harvest_crew_roster`
  exists. The three numeric assertions are **BLOCKED** because E/F/G could not
  fill the rows.
- For Task 8: `roster` is `null` here (the local `harvest_crew_roster` table is
  empty), and `latest` is `null` while no row is `complete`.

### I. `hourly_simulate` — `{"body":"parar"}`

- Expected: `replies: ["Ok, paramos. Hoy Granero Arriba: 27 racks. Gracias."]`
- Actual: `{"replies":["Ok, paramos. Hoy Granero Arriba: 0 racks. Gracias."]}`
- **PARTIAL PASS.** Sentence and the `active = 0` write are correct; the `27` is
  `0` only because no counts were parsed. Confirmed by `?action=foremen`
  afterwards: `"active":0`.

### J. `hourly_simulate` from an unregistered number — `{"from":"+15415550999","body":"hola"}`

- Expected: `replies: []`
- Actual: `{"replies":[]}`
  Server log: `[sms] ignored text from unregistered +15415550999: hola`
- **PASS**

## Additional cases

### K. `ayuda`, sent twice in a row (duplicate simulate)

- Actual, both times, identical:
  ```json
  {"replies":["Granero Arriba. Cada hora te pregunto: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas. Responde con los numeros en ese orden. Ejemplo: 4 2 3 8 1 12 sin novedad. EMPEZAR / PARAR para el dia."]}
  ```
- **PASS.** The second call processed rather than deduping, as expected:
  `hourly_simulate` mints `SIM-${Date.now()}` per call, so the
  `harvest_sms_inbox` primary key never collides. Simulate cannot exercise the
  redelivery guard — `/sms/inbound` can, see M.

### L. `GET /sms/inbound`

- Actual: `405` (body `Method not allowed`)
- **PASS**

### M. `POST /sms/inbound` twice with the same `MessageSid` (Twilio redelivery)

```bash
curl -s -X POST "http://localhost:8787/sms/inbound" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "From=+15415550101" --data-urlencode "Body=ayuda" \
  --data-urlencode "MessageSid=SM-smoke-1"
```

- Actual, both calls: `200` + `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
- Server log, first call:
  ```
  ▲ [WARNING] [sms] TWILIO_AUTH_TOKEN unset — inbound is unauthenticated
  [wrangler:info] POST /sms/inbound 200 OK (5ms)
  [sms] not configured — to +15415550101: Granero Arriba. Cada hora te pregunto: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas. Responde con los numeros en ese orden. Ejemplo: 4 2 3 8 1 12 sin novedad. EMPEZAR / PARAR para el dia.
  ```
- Server log, second call: the warning and the `200`, and **no** `[sms] not
  configured` line — the reply was not re-sent.
- `SELECT COUNT(*) FROM harvest_sms_inbox WHERE message_sid='SM-smoke-1'` → `1`
- **PASS.** This is the route Task 7 adds, and the only path that can exercise
  the `INSERT OR IGNORE` dedupe. The reply is delivered through `sendSms`
  (`deliver: true`), unlike simulate.

### N. Out-of-range correction on a complete hour — `{"body":"9am: 99 2 3 8 1 12"}`

- Expected: reply prefixed `Numero fuera de rango: cortadores` with the old
  `cutters` value kept
- **NOT RUN — BLOCKED (no API key).**

### O. `{"body":"9am: sin novedad"}`

- Task expectation: notes stay null, confirm has no `Nota:`
- **NOT RUN — BLOCKED (no API key).**
- **Note the expectation is wrong as written.** By the time this step runs the
  `09:00` row already carries `se rompio un rack` from step E, and Task 6's first
  behavior note ("a later reply never erases an earlier note") means the confirm
  *will* read `... R12. Nota: se rompio un rack`. That is the append rule working,
  not a `normalizeNotes` failure. The test that actually isolates
  `normalizeNotes` is a fresh hour, e.g. `7am: 4 2 3 8 1 6 sin novedad` → confirm
  with no `Nota:` and `notes IS NULL` in D1. Both should be run when the key is
  available.

## Plan Step 7 — cron tick

The 5-minute cron was triggered with
`curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` against a dev
server started as `npx wrangler dev --config wrangler.toml --env="" --test-scheduled`.
Every tick also fires the JD-ingest and wholesale crons, which fail on this
machine for unrelated reasons and are expected noise:

```
X [ERROR] [Cron] JD ingest failed: JDApi: missing JD_CLIENT_ID / JD_CLIENT_SECRET / JD_REFRESH_TOKEN
X [ERROR] [Cron] Wholesale cron failed: D1_ERROR: no such table: order_items: SQLITE_ERROR
```

### Pass 1 — fresh `active_since` (as the plan writes it)

`parar`, then `foreman_set` with `"active": true` →
`active_since: "2026-09-11 19:29:54"` (12:29 PT). Then `__scheduled`:

```
[sms] not configured — to +15415550101: Recordatorio Granero Arriba: faltan los numeros de 9-10. Ejemplo: 4 2 3 8 1 12 sin novedad
[Cron] Harvest hourly: 1 action(s)
[wrangler:info] GET /__scheduled 200 OK (16ms)
```

- **PASS on wiring** — `[Cron] Harvest hourly: 1 action(s)` proves
  `runHarvestHourlyTick` is reached from the `isFiveMinCron` block, and a text
  went out through `sendSms`.
- **The text is a nudge, not the hourly prompt**, and no `11:00` row was created:
  ```
  hour_start=09:00  status=nudged  asked_at=NULL  nudged_at=2026-09-11 19:29:54
  ```
  The prompt is suppressed by design, and the reason is not the one the task
  guessed. `tickDecision(null, ...)` calls `endedBeforeActivation`: the hour that
  just ended (`11:00`, ending at 12:00 PT) ended *before* the foreman activated
  at 12:29 PT, so he was not working it and is never asked about it. A freshly
  activated foreman can therefore **never** produce an ask on the same tick —
  the ask only appears on a tick in a clock hour later than the activation hour.
  This is correct behavior, not a defect.
- **Quirk worth recording:** the nudge that *did* fire is the `09:00` backfill
  row from step E. Backfill rows carry `asked_at NULL` on purpose (Task 6
  behavior note 3), and `msSince(null) = Infinity`, so `tickDecision` treats them
  as immediately overdue. An incomplete backfill is therefore nudged on the very
  next 5-minute tick with no 15-minute grace, and flagged `missing` (with a
  Telegram ping) 15 minutes after that. Smoke step F is exactly such a row.

### Pass 2 — `active_since` backdated to 10:00 PT, to exercise the ask path

```bash
npx wrangler d1 execute rogue-origin-db --local \
  --command="UPDATE harvest_foremen SET active_since='2026-09-11 17:00:00' WHERE phone='+15415550101'"
curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

```
[sms] not configured — to +15415550101: 12:00 Granero Arriba. Responde en un mensaje: cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas.
[Cron] Harvest hourly: 1 action(s)
```

```
hour_start=09:00  status=nudged   asked_at=NULL                 nudged_at=2026-09-11 19:29:54
hour_start=11:00  status=pending  asked_at=2026-09-11 19:30:24  nudged_at=NULL
```

- **PASS.** The hourly prompt for the just-ended `11:00` hour was sent
  (`hourEnd('11:00')` = `12:00`) and its row inserted with `asked_at` stamped.
  Only the foreman's `active_since` was moved — no handler or lib code was
  touched.

### Pass 3 — doubled tick immediately after

`__scheduled` again, with no time passing: **no** `[sms]` line and **no**
`[Cron] Harvest hourly:` line — `acted` was 0 and nothing was texted. The guarded
writes make a doubled tick a no-op, as designed. **PASS**

### Reset

`parar` → `{"replies":["Ok, paramos. Hoy Granero Arriba: 0 racks. Gracias."]}`,
foreman back to `active: 0`. Afterwards the local test data was cleared
(`DELETE FROM harvest_hourly; DELETE FROM harvest_sms_inbox;
UPDATE harvest_foremen SET active=0, active_since=NULL`) so the blocked steps can
be re-run from a clean slate once an API key is available.

## Dispatch fall-through — the other half of the ternary

Every step above uses an hourly action. The regression surface of the
`/api/harvest` edit is the *other* branch: a non-hourly action must still reach
`handleHarvestD1`. The discriminator is the error text — `Unknown hourly action:`
comes from `handleHarvestHourly`, `Acción desconocida:` from `handleHarvestD1`.

| Request | Actual | Verdict |
|---|---|---|
| `?action=harvest_dash` | `<!doctype html> … <title>Harvest Cycle Times</title>` | PASS — the real dashboard page from `handleHarvestD1` |
| `/api/harvest` (no action) | `{"success":false,"error":"Acción desconocida: null","code":"NOT_FOUND"}` | PASS |
| `?action=zzz_not_a_real_action` | `{"success":false,"error":"Acción desconocida: zzz_not_a_real_action","code":"NOT_FOUND"}` | PASS |
| `?action=day` | `{"success":false,"error":"Acción desconocida: day","code":"NOT_FOUND"}` | PASS |

No response anywhere said `Unknown hourly action:`, so `HOURLY_ACTIONS` captures
only its five names and nothing else was shadowed.

`GET /` health check is unchanged — `/sms/inbound` is deliberately **not** in the
`endpoints` array (that list is `/api/*` only), per Task 7 Step 3:

```json
{"success":true,"message":"Rogue Origin API - Cloudflare Workers","version":"1.0.0","endpoints":["/api/production","/api/orders","/api/kanban","/api/sop","/api/consignment","/api/complaints","/api/supersack","/api/pool","/api/media","/api/irrigation","/api/harvest","/api/wholesale"]}
```

## For Task 8 (dashboard panel)

- `?action=harvest_metrics` — what `load()` fetches — returns **500** on this
  machine: `{"success":false,"error":"An unexpected error occurred","code":"INTERNAL_ERROR"}`.
  The worktree's local D1 holds only `harvest_crew_roster, harvest_foremen,
  harvest_hourly, harvest_sms_inbox`. Task 8 Step 4 ("open `harvest_dash`, enter
  devpass, confirm the card") will fail on the main dashboard read long before
  the hourly card renders. Walk `migrations/` and apply whatever `harvest_metrics`
  reads (`harvest_scan_log`, `harvest_sacks`, …) locally first.
- The hourly card does **not** need the Anthropic key. Two complete rows inserted
  straight into D1 produce the plan's 27 racks / 36 person-hrs / 1.69 card:
  ```bash
  npx wrangler d1 execute rogue-origin-db --local --command="INSERT INTO harvest_hourly (season,harvest_date,hour_start,barn,cutters,cutter_water_spiders,drivers,hangers,hanging_water_spiders,racks,notes,status,is_test) VALUES (2026,'2026-09-11','09:00','upper',4,2,3,8,1,12,'se rompio un rack','complete',1),(2026,'2026-09-11','10:00','upper',4,2,3,8,1,15,NULL,'complete',1)"
  ```
- `?action=hourly` returns `roster: null` whenever `harvest_crew_roster` is empty,
  and `barns.<b>.latest` is `null` until a row reaches `complete`. `cardHourly`
  already guards both (`if (h.roster && x.latest)`), but the mismatch line will
  simply never render locally.

## Unit tests

```
$ npm test
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

## Summary

| Step | Result |
|---|---|
| A `hourly_test` | PASS |
| B `foreman_set` | PASS |
| C answer before EMPEZAR | PASS |
| D `empezar` | PASS |
| E `9am: ...` | BLOCKED (no `ANTHROPIC_API_KEY`) — route verified, parse not |
| F `10am: cuatro cortadores...` | BLOCKED |
| G `10am: 8 1 15` | BLOCKED |
| H `?action=hourly` | PARTIAL — endpoint/shape PASS, the 27/36/1.69 numbers BLOCKED |
| I `parar` | PARTIAL — text and deactivation PASS, the `27 racks` figure BLOCKED |
| J unregistered number | PASS |
| K duplicate simulate (`ayuda` ×2) | PASS (fresh sid per call, so no dedupe — by design) |
| L `GET /sms/inbound` | PASS (405) |
| M `POST /sms/inbound` ×2, same sid | PASS (200 + XML both, reply sent once, 1 inbox row) |
| N out-of-range correction | BLOCKED |
| O `sin novedad` | BLOCKED (and the stated expectation is wrong — see above) |
| Tick pass 1 (fresh activation) | PASS on wiring; ask correctly suppressed |
| Tick pass 2 (backdated activation) | PASS — prompt sent, row inserted |
| Tick pass 3 (doubled tick) | PASS — no-op |
| Dispatch fall-through (4 non-hourly actions) | PASS — all reach `handleHarvestD1` |
| `GET /` health check | PASS — `endpoints` unchanged |
| `npm test` | PASS — 40/40 |
