# Capataz WhatsApp — local end-to-end loop transcript (Task 8)

Run date: **2026-09-16**, 11:31–11:43 Pacific, on Koa's PC.
Executed against Task 8 of `docs/plans/2026-09-15-capataz-whatsapp.md`.

Four processes, all local. No Meta webhook, no Twilio, no Anthropic API key — the
relay runs `claude -p` on the PC's Claude Code subscription, and the WhatsApp
mailbox is a local stand-in (see §1.4).

| Component | Path | Branch / HEAD |
|---|---|---|
| API worker | `Desktop\Dev\rogue-origin-apps-harvest-whatsapp\workers` | `feat/harvest-hourly-whatsapp` @ `397286cd` |
| Capataz relay | `Desktop\Dev\capataz-bot-whatsapp` | `feat/whatsapp-channel` @ `0d9cc8d` |
| farm-bridge MCP | `Desktop\telegram-claude-bot` | `main` @ `e17f904` |
| WhatsApp mailbox | local stub (scratchpad, not committed) | n/a |

**Result: 4 of 4 scenarios passed.** Every outbound text left over the WhatsApp
stub's `/send`; **zero** Twilio references appear anywhere in the worker log.

**The headline finding — accents:** the *transport* is accent-clean end to end
(7 non-ASCII codepoints survived byte-for-byte, §3.2), but the **persona still
instructs the model to write without accents**, so relay-authored replies remain
unaccented in practice. The plumbing this feature built is correct; one more
change is needed before a WhatsApp foreman actually sees an accent. See §4.

---

## 1. Setup notes

### 1.1 Local D1 had no migration history — and never did

This is the gotcha that cost the most time, and it is **not** what the plan
predicted. The plan assumed the old SMS worktree had migrations 0001–0033
applied via `wrangler d1 migrations apply --local`, so copying its state and
applying 0034 on top would work.

It does not have that history. After copying the SMS worktree's local D1 state
into this worktree:

```
SELECT name FROM d1_migrations   ->   no such table: d1_migrations
```

The SMS worktree's local D1 was built by **hand-applying only the tables the
harvest work needed** (`harvest_*` plus `system_config`) — 10 tables total, no
migration bookkeeping. That is why Task 1's `migrations apply --local` failed on
`0002`: with no `d1_migrations` table, wrangler considers **nothing** applied and
starts from `0001`, walking straight into the long-standing `0002` bug.

**Do not run `wrangler d1 migrations apply --local` in this repo.** It will try
all 41 migrations every time.

**The fix that worked** (verify the migration file is the only delta first):

```bash
# 1. Confirm the new worktree's only extra migration is the one you want
diff <(ls ../rogue-origin-apps-harvest-hourly/workers/migrations/) <(ls workers/migrations/)
#   -> 40a41 > 0034-harvest-channel.sql      (the ONLY difference)

# 2. Stop every wrangler/workerd first (a live process can checkpoint mid-copy),
#    then copy the SMS worktree's local D1 state. Copy the .sqlite, -shm AND -wal
#    together — the source WAL was 251 KB of uncheckpointed data. Mixing a source
#    .sqlite with the destination's stale -wal yields a silently wrong database.
SRC=../rogue-origin-apps-harvest-hourly/workers/.wrangler/state/v3/d1/miniflare-D1DatabaseObject
DST=workers/.wrangler/state/v3/d1/miniflare-D1DatabaseObject
rm -f "$DST"/*.sqlite "$DST"/*.sqlite-shm "$DST"/*.sqlite-wal
cp -r "$SRC"/. "$DST"/

# 3. Apply 0034's file DIRECTLY — not via `migrations apply`
cd workers
./node_modules/.bin/wrangler d1 execute rogue-origin-db --local --file=migrations/0034-harvest-channel.sql

# 4. Verify
./node_modules/.bin/wrangler d1 execute rogue-origin-db --local --command \
  "SELECT (SELECT group_concat(name,', ') FROM pragma_table_info('harvest_foremen')) AS f,
          (SELECT group_concat(name,', ') FROM pragma_table_info('harvest_sms_inbox')) AS i;"
```

Result — `channel` present on both, last column in each:

```
harvest_foremen  : phone, name, barn, active, active_since, lang, created_at, channel
harvest_sms_inbox: message_sid, from_phone, body, received_at, kind, processed,
                   delivered_at, replied_at, channel
```

The `.sqlite` filename is a hash of the database id, and it is **identical**
across both worktrees (`db35a341…`), so the copy drops straight in with no
rename.

**The other worktree was only ever read from.** Nothing in
`rogue-origin-apps-harvest-hourly` was modified or deleted.

> **For the deploy runbook:** none of this applies to production. Remote D1 *is*
> migration-tracked; `wrangler d1 migrations apply rogue-origin-db --remote` is
> still the right deploy-day command for 0034. This section is purely about the
> local dev database.

### 1.2 `orders-auth.js` is gitignored and does not come with a new worktree

`wrangler dev` failed to build immediately:

```
X [ERROR] Could not resolve "./handlers/orders-auth.js"
    src/index.js:20:31
```

`workers/src/handlers/orders-auth.js` is listed in `.gitignore` (line 67), so it
is untracked and a fresh worktree/clone simply does not have it. Fixed by
copying it from the SMS worktree:

```bash
cp ../rogue-origin-apps-harvest-hourly/workers/src/handlers/orders-auth.js \
   workers/src/handlers/orders-auth.js
```

`git status` stays clean afterwards (the file is ignored). **Any new worktree of
this repo needs this copy before `wrangler dev` will start at all** — worth
knowing before blaming the feature branch.

### 1.3 Stale wrangler trees held 8787 — again

The SMS smoke doc's §1.1 warning held. After the failed build above, the dead
wrangler tree kept `workerd` alive and bound to 8787; a second `wrangler dev`
also bound, and `netstat` showed **two** PIDs LISTENING on 8787. Requests hung
with curl exit 28 rather than failing outright, which reads like a worker bug
and is not one.

The kill sweep from the SMS doc still works and should be run **before** setup,
not only at teardown:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'wrangler' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-Process workerd | Stop-Process -Force
```

Then confirm the port is free *and* that exactly one PID listens after restart.
Starting wrangler via PowerShell `Start-Process -PassThru` (rather than a shell
`&`) gives a stable PID to kill later and avoids orphaning the tree.

### 1.4 The WhatsApp mailbox stub

No Meta webhook points at this PC and the real `riego-whatsapp-mailbox`'s
`POLL_KEY` is not available here, so a ~130-line `node:http` stand-in
(no dependencies) implemented exactly the two endpoints
`workers/src/lib/whatsapp-mailbox.js` calls, matching the real mailbox's
documented response shape (`src/index.js` `handlePoll`):

- `GET /poll?limit=N` — bearer-authed; returns `{"messages":[…]}` with
  `id`, `wa_message_id`, `from_number` (digits only, no `+`), `msg_type`,
  `text_body`, `media_id`, `media_mime`, `wa_timestamp`, `received_at`.
  **Dequeue-on-poll**, mirroring the real mailbox's mark-processed / no-redelivery
  semantics.
- `POST /send` — bearer-authed; appends the exact `{to, text}` to
  `send-log.jsonl` as UTF-8 and returns `{"ok":true,"wa_message_id":"stub-<n>"}`.
- Plus two control endpoints the real mailbox does **not** have, used only to
  drive the test: `POST /_queue` and `GET /_state`.

Auth was verified in both directions before use (no bearer → 401, correct bearer
→ 200). The stub lives in the scratchpad and is **not** committed.

Worker secrets via `workers/.dev.vars` (gitignored, `.gitignore:85`):

```
ORDERS_PASSWORD=devpass
HARVEST_TEST_MODE=true
HARVEST_SMS_KEY=devsmskey
WA_MAILBOX_URL=http://localhost:8799
WA_MAILBOX_KEY=stub-wa-key
```

**`TWILIO_*` was deliberately left unset.** That makes the Twilio check
unambiguous: had any reply been routed to SMS, `lib/sms.js` would have logged
`[sms] not configured — to +1…: <text>` and written nothing to the stub. The
worker log contains **zero** matches for `twilio|\[sms\]` across the whole run
(§3.5), and every expected text appears in the stub's send log. Both halves of
that check agree.

### 1.5 The relay's `workdir` pointed at the *other* checkout

`config/config.yaml` line 16 ships with a machine-absolute path:

```yaml
workdir: C:/Users/Koasm/Desktop/Dev/capataz-bot/workdir
```

That is the **committed** value (confirmed via `git diff` — it was not something
this run introduced), and it points at the original `capataz-bot` checkout, not
this worktree. The doctor caught it immediately:

```
[PASS] workdir_mcp: farm-bridge -> https://telegram-claude-bot.roguefamilyfarms.workers.dev/mcp
```

— the **production** farm-bridge, even though `scripts/use_local_mcp.py` had just
written `http://localhost:8788/mcp` into *this* worktree's `workdir/.mcp.json`.
Left alone, the relay would have run `claude -p` in the other repo's workdir and
called the **deployed** farm-bridge, writing to production D1.

Since the plan forbids touching the `capataz-bot` checkout, the fix was to point
this worktree's `workdir` at itself (reverted at teardown, §5):

```yaml
workdir: C:/Users/Koasm/Desktop/Dev/capataz-bot-whatsapp/workdir
```

After which:

```
[PASS] config: api_base=http://localhost:8787, key set, chunk=150
[PASS] workdir_mcp: farm-bridge -> http://localhost:8788/mcp
Doctor: OK          (all nine PASS, claude_cli 2.1.273)
```

**Run `python -m claude_relay.doctor` before starting the relay, and read the
`workdir_mcp` URL rather than just the PASS.** A worktree inherits this absolute
path and it will be wrong every time. It is the cheapest available detector for
"the relay is about to talk to production."

### 1.6 Other setup facts

- Relay deps (`httpx`, `pyyaml`, `portalocker`) are present in system Python
  3.14.2; no venv was needed in this worktree.
- `config/secrets.json` (gitignored) created with `{"sms_key":"devsmskey"}`.
  `HARVEST_SMS_KEY=devsmskey` matches across all three processes — worker,
  farm-bridge, relay.
- `telegram-claude-bot` needed **no** changes: already on `main` with
  `log_hourly_crew`, clean tree, and a `.dev.vars` already pointing
  `HARVEST_API_BASE` at `http://localhost:8787`.
- Pre-start hygiene: `data/` did not exist, so no stale session could resume
  with an old system prompt.
- **Clock cross-check.** The worker stamped `created_at: 2026-09-16 18:37:24`
  (UTC) while the host clock read 11:37 Pacific — UTC−7, consistent. Worth doing
  once at setup; a mismatch breaks hour-classification in ways that read like a
  persona defect.

### 1.7 Test foreman

Registered on `bottom` (the SMS test used `upper`, so the two never collide):

```bash
curl -s -X POST "http://localhost:8787/api/harvest?action=foreman_set" \
  -H "Authorization: Bearer devpass" -H "Content-Type: application/json" \
  -d '{"phone":"+15415559999","name":"Test WhatsApp","barn":"bottom","channel":"whatsapp"}'
```

```json
{"foreman":{"phone":"+15415559999","name":"Test WhatsApp","barn":"bottom",
 "active":0,"active_since":null,"lang":"es",
 "created_at":"2026-09-16 18:37:24","channel":"whatsapp"}}
```

**Read `channel` back from the response body before firing anything.** The
drain's lookup is `WHERE phone = ? AND channel = 'whatsapp'`; if the field had
not persisted, every scenario would have silently no-opped with zero errors.

---

## 2. Transcript

Inbound messages were queued on the stub and the tick fired with:

```bash
curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"     # -> "Ran scheduled event"
```

Accented payloads were written and read **only** through Node with explicit
UTF-8 — never through a shell heredoc or pipe. The SMS doc's Windows warning
(Git Bash mangles non-ASCII on the way in, making `gsmSafe` look broken when it
is the console) applies to every accented body, and a mangled *read* produces a
false negative indistinguishable from a real strip.

### Scenario 1 — `EMPEZAR`

Queued one message; fired the tick at 18:37:41.

Stub `/poll` returned 1 message; stub `/send` #1 at `18:37:41.421Z`:

> `Listo. Te pregunto cada hora en punto. PARAR para terminar el dia.`

66 chars. Latency **sub-second** (tick → send, same wall-clock second). **PASS**

Confirmed:

| check | result |
|---|---|
| foreman `active` | `1`, `active_since = 2026-09-16 18:37:41` |
| inbox row | `wamid.stub1`, `kind='command'`, `processed=1`, **`channel='whatsapp'`** |
| reply transport | stub `/send` — **not** Twilio |
| worker log `twilio\|[sms]` matches | **0** |
| tick line | `[Cron] Harvest hourly: 1 action(s)` |

**On ordering — stated narrowly, not over-claimed.** The drain ran inside the
tick and the activation committed within it (`active_since` is stamped at the
tick's own timestamp, and the tick reports the drain's action). No hourly prompt
was sent in the same tick, and that is **correct**: the foreman activated at
11:37, after the just-ended hour had already closed, so there was no hour the
bot had prompted for and none to ask about. This run therefore does **not**
demonstrate the "activation *and* prompt in one tick" case — that case is
covered by Task 4's unit test against the fake DB, which asserts the call
sequence directly. Forcing it here would have meant bending the clock.

### Scenario 2a — accented text, deterministic (no model)

Before involving the model, the worker's outbound path was isolated with a
direct `sms_send` to the WhatsApp foreman — this is a *stronger* test of the
worker half than the relay round trip, because nothing between the input and the
assertion can rewrite the text.

Body written as UTF-8 by Node, posted with `--data-binary @accent-body.json`:

> `Ok 9-10 Abajo: café, ¿cuántos racks más? Señor Muñoz rompió un rack.`

API response: `{"sent":true,"text":"Ok 9-10 Abajo: café, ¿cuántos racks más? Señor Muñoz rompió un rack.","segments":1}`

Stub `/send` #2 at `18:38:12.369Z`, asserted at the codepoint level:

```
non-ASCII (7): é=U+e9  ¿=U+bf  á=U+e1  á=U+e1  ñ=U+f1  ñ=U+f1  ó=U+f3
```

**All 7 survived byte-for-byte.** `gsmSafe` was correctly skipped for the
`channel='whatsapp'` foreman, and `segments: 1` (rather than an SMS segment
count) confirms the WhatsApp branch of `sendToForeman` ran. **PASS**

### Scenario 2b — full six-count report through the live relay

Queued (accents inbound):

> `9am: 4 2 3 8 1 12 se rompió un rack, ¿todo bien?`

Tick fired 18:40:54. Relay log:

```
11:40:55,844  drained 1 text(s) from the inbox
11:41:07,267  turn sms:+15415559999 resume=no duration=11.4s rc=0
11:41:07,286  sms sent to +15415559999 (65 chars)
```

Stub `/send` #3 at `18:41:07.280Z`:

> `Ok 9-10 Abajo: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack`

65 chars. End-to-end latency **~13 s** (tick → foreman has an answer); the
`claude -p` turn itself was **11.4 s** (cold, new session, MCP handshake).
**PASS** — the pipeline works: drain → classify → queue → relay → `log_hourly_crew`
→ reply → WhatsApp.

Confirmed:

| check | result |
|---|---|
| inbox row | `wamid.stub2`, `kind='chat'`, `processed=1`, `channel='whatsapp'` |
| **inbound accents into D1** | `body` = `9am: 4 2 3 8 1 12 se rompió un rack, ¿todo bien?` — preserved |
| farm-bridge tool call | 5 × `POST /mcp`; `log_hourly_crew` wrote the row |
| D1 `harvest_hourly` 09:00 | `complete`, C4 WSc2 Ch3 Col8 WSg1 **R12** |
| **`notes` stored in D1** | `se rompió un rack` — **accent preserved** |
| outbound transport | stub `/send` — not Twilio |

**Deviation from the task's literal input, deliberately.** The task suggested
the bare `"4 2 3 8 1 12 se rompió un rack, ¿todo bien?"`. A `9am:` prefix was
added so the report lands on a determinate hour and actually exercises
`log_hourly_crew` (the task's own requirement that the crew count be written).
Bare numbers with no asked hour would have invited a "which hour?" clarification
— still a valid round trip, but it would not have written a row. This mirrors the
SMS smoke test's step 2 exactly, with accents added.

**The outbound reply contains no accents — and that is not a strip.** See §4;
this is the run's most important finding.

### Scenario 3 — two messages from one foreman in one drain batch

Relay **stopped** for this scenario, deliberately: both texts classify as chat,
and a live relay would have burned two `claude -p` turns and produced replies
that muddy the record. The scenario is about the drain loop's claim/release, so
the assertion is on D1 rows.

Queued as two entries in one array; the stub returned **both in a single
`/poll` response** — the case Task 4's unit test fakes:

```
[stub] 18:42:37.437Z GET /poll?limit=100 -> 2 message(s): "4 2 3" | "8 1 12"
```

| rowid | message_sid | body | kind | processed | channel |
|---|---|---|---|---|---|
| 3 | `wamid.stub3` | `4 2 3` | chat | 0 | whatsapp |
| 4 | `wamid.stub4` | `8 1 12` | chat | 0 | whatsapp |

Both persisted, **in order**, both queued for the relay, both tagged
`channel='whatsapp'`. Neither row's claim-then-release interfered with the
other's. Tick reported `[Cron] Harvest hourly: 2 action(s)` — both counted.
**PASS**

### Scenario 4 — `PARAR`

Queued; tick fired 18:43:09.588. Stub `/send` #4 at `18:43:09.841Z`:

> `Ok, paramos. Hoy Granero Abajo: 12 racks. Gracias.`

50 chars. Latency **~250 ms** (inline worker reply, no relay involvement).
Day total 12 racks matches the single 09:00 row. Foreman `active` → `0`.
**PASS**

---

## 3. Assertions across the whole run

### 3.1 Everything that left the system

Four sends, all through the stub's `/send`:

| # | at (UTC) | len | text | non-ASCII |
|---|---|---|---|---|
| 1 | 18:37:41.421 | 66 | `Listo. Te pregunto cada hora en punto. PARAR para terminar el dia.` | none |
| 2 | 18:38:12.369 | 68 | `Ok 9-10 Abajo: café, ¿cuántos racks más? Señor Muñoz rompió un rack.` | **7** |
| 3 | 18:41:07.280 | 65 | `Ok 9-10 Abajo: C4 WSc2 Ch3 Col8 WSg1 R12. Nota: se rompio un rack` | none |
| 4 | 18:43:09.841 | 50 | `Ok, paramos. Hoy Granero Abajo: 12 racks. Gracias.` | none |

#1 and #4 are the worker's own canned strings, authored unaccented on purpose —
correctly so. #2 is the deterministic accent proof. #3 is discussed in §4.

### 3.2 Accents — where they survive today

| hop | accented? | evidence |
|---|---|---|
| stub → worker (inbound) | **yes** | D1 `body` = `…se rompió un rack, ¿todo bien?` |
| worker → D1 (`log_hourly_crew` note) | **yes** | `notes` = `se rompió un rack` |
| worker → stub (`sendToForeman`, no model) | **yes** | 7 codepoints, §2 scenario 2a |
| relay sanitizer (`prepare_whatsapp_reply`) | **yes** | verified live, §4 |
| model's own composition | **no** | persona forbids it, §4 |

### 3.3 Tick accounting

```
[Cron] Harvest hourly: 1 action(s)     # S1 EMPEZAR
[Cron] Harvest hourly: 1 action(s)     # S2b report
[Cron] Harvest hourly: 2 action(s)     # S3 two messages
[Cron] Harvest hourly: 1 action(s)     # S4 PARAR
```

Every drained message produced exactly one action. Zero `[whatsapp-drain]`
error lines across the run.

### 3.4 Mailbox dequeue semantics

Every `/poll` returned the queued messages and then went empty, and no message
was ever redelivered — the no-redelivery contract `drainWhatsappInbound` is
written against.

### 3.5 Twilio

`grep -icE "twilio|\[sms\]"` over the complete worker log: **0**. With `TWILIO_*`
unset, an accidental SMS route would have logged `[sms] not configured` and
produced no stub send. Neither happened for any of the four sends.

---

## 4. The accent finding — the transport is clean; the persona is not

This is the run's most important result and the one thing the feature still
needs before a foreman sees an accent.

Scenario 2b's outbound reply came back as `Nota: se rompio un rack` — **no
accent** — even though D1 stored the very same note as `se rompió un rack`. Two
explanations had to be separated, because one of them would mean the feature is
broken:

1. the relay stripped it (feature broken), or
2. the model composed it unaccented (feature fine, persona stale).

**It is (2).** Three independent pieces of evidence:

**a. The worker really does hand the relay the channel.** Called `sms_poll`
directly against the live worker and read the context Task 5's `buildPollContext`
builds:

```
--- "4 2 3"     context.foreman.channel = "whatsapp"
--- "8 1 12"    context.foreman.channel = "whatsapp"
```

So Task 7's `dispatch_sms_message` reads `foreman.get("channel") == "whatsapp"`
and selects `prepare_whatsapp_reply`. The SMS sanitizer was not on this path.

**b. The WhatsApp sanitizer demonstrably does not strip.** Run live against the
exact reply text:

```python
raw = "Ok 9-10 Abajo: … Nota: se rompió un rack"
prepare_whatsapp_reply(raw)  ->  "ó" in result  ==  True     # preserved
prepare_sms_reply(raw)       ->  "ó" in result  ==  False    # stripped
```

**c. The persona tells the model not to use accents.**
`capataz-bot-whatsapp/prompts/persona.md`:

- line 7: *"esta persona esta escrita sin acentos a proposito. Todo lo que sale
  por SMS tiene que ir sin acentos … y tu escribes como lees."*
- line 106: *"**Sin acentos. Sin enes con tilde. Sin emojis. Sin markdown…**"*

The model followed its instructions. It produced the same unaccented string the
SMS smoke test recorded for the equivalent step, which is exactly what a persona
rule — not a regex — looks like from the outside.

**d. Decisively: the model *knew* it was on WhatsApp and wrote unaccented
anyway.** The relay's HEAD commit (`0d9cc8d`, "the prompt tells the model which
channel a text arrived on") makes `build_prompt` emit
`[From <name>, in WhatsApp]` for a `channel='whatsapp'` foreman. So scenario
2b's turn was explicitly labelled WhatsApp in the prompt header, and the reply
still came back flat. That removes the last alternative explanation — the
channel is plumbed all the way into the prompt, and the **only** thing still
producing unaccented Spanish is the persona's unconditional
*"Sin acentos. Sin enes con tilde."* rule, which no longer has a transport
reason to exist for WhatsApp foremen.

**What this means.** Tasks 5–7 removed the *mechanical* stripping on both sides
(`gsmSafe` on the worker, `sms_safe` on the relay), and that work is correct and
proven — scenario 2a puts 7 accented codepoints through the real worker path
untouched. But the persona still *instructs* the model to write unaccented
Spanish on every channel, so relay-authored replies to WhatsApp foremen will
keep arriving unaccented until the persona becomes channel-aware.

**This was deliberately not fixed in this run.** Task 8 is a test task; the
persona is the relay's behavioural contract and editing it mid-smoke-test would
invalidate the transcript and was not in scope. It is a small, well-understood
change — make the "sin acentos" rules conditional on channel, the same way Task 7
made the sanitizer conditional — but it needs its own change, its own test, and
Koa's eye on the Spanish. **Recommend it as the immediate follow-up before
deploy**, otherwise the feature's user-visible payoff does not land even though
every line of plumbing beneath it works.

Note the split that already works today: the `notes` **stored in D1** keep their
accents (the foreman's own words, relayed verbatim through `log_hourly_crew`),
so the accented record is being captured correctly right now. It is only the
bot's *composed* reply that is flattened.

---

## 5. Teardown

Performed in this order:

1. Relay stopped (`python -m claude_relay`); `data/bot.lock` released.
2. Both wrangler dev trees stopped (parent node first, then `workerd` sweep);
   ports 8787 and 8788 confirmed free.
3. Stub server stopped; port 8799 free.
4. `scripts/use_prod_mcp.py` — `workdir/.mcp.json` back to the deployed farm-bridge.
5. `config/config.yaml` reverted (`api_base` **and** the `workdir` path from §1.5).
6. `config/secrets.json` deleted (gitignored, local-only).
7. Test rows deleted: `harvest_hourly` for 2026-09-16, all of
   `harvest_sms_inbox`, the test foreman.
8. **`data/` deleted** (gitignored). It held a live session for the test
   foreman — `sms:+15415559999` → `claude_session_id
   cfa34026-…`, `message_count 1` — plus `bot.lock`, `transcripts/` and
   `incoming/`. Left in place, the next run would `--resume` that session and
   inherit this run's system prompt, which is precisely the pre-start hygiene
   failure §1.6 relies on being absent. Deleting it restores the clean slate
   this run started from. **Clear `data/` before any re-run.**
9. `git status` clean in `capataz-bot-whatsapp` — **no local-testing config is
   committed**, in either repo.
10. Both suites re-run green after teardown: worker `npm test` **91/91**,
    relay `python -m pytest -q` **99/99** — matching the pre-test baselines,
    so nothing this run touched altered either repo's behaviour.

`workers/.dev.vars`, the stub script, and `orders-auth.js` are all gitignored or
scratchpad-only and were intentionally left in place for the next local run.

**Left behind on purpose:** this worktree's local D1 is now a copy of the SMS
worktree's Sep-11 state plus migration 0034. That is the working baseline —
anyone re-running this test inherits it and does **not** need to repeat §1.1.

---

## 6. What did not work / worth keeping

1. **`migrations apply --local` is a trap in this repo** (§1.1). The local D1 has
   no `d1_migrations` table and never did, so wrangler restarts from `0001` and
   dies on the pre-existing `0002` bug. Apply new migration files directly with
   `d1 execute --file`. Remote/production is unaffected.
2. **A fresh worktree will not build** until gitignored `orders-auth.js` is
   copied in (§1.2).
3. **The relay's committed `workdir` points at the other checkout** (§1.5) — left
   alone it silently targets the **production** farm-bridge. The doctor reveals
   it, but only if you read the URL instead of the PASS.
4. **Stale wrangler trees still hold 8787** (§1.3). Symptom this time was a curl
   *hang* (exit 28), not a bind error, because two PIDs were listening at once.
5. **The relay now logs turn duration** — `turn sms:… resume=no duration=11.4s
   rc=0`. This closes item 3 of the SMS smoke doc's §7; durations here are
   observed, not derived.
6. **Not covered by this run**, stated so the pass is not over-read:
   - a real `riego-whatsapp-mailbox` round trip (stubbed — but Task 2's tests
     cover the wire contract against the mailbox's documented shape);
   - a real Meta/Graph send, and therefore the 24-hour-window rejection (131047);
   - the activation-and-prompt-in-one-tick ordering case (§2 scenario 1 —
     unit-tested, not reproduced live);
   - media/non-text WhatsApp messages;
   - two WhatsApp foremen texting concurrently;
   - the WhatsApp 4096-char cap rejecting an over-long `sms_send`.

---

## 7. Deploy-day runbook notes

**The foreman always sends the first message of the day; the bot never initiates
cold.** WhatsApp's 24-hour messaging window means the worker can only text a
foreman who has messaged it within the last 24 hours — outside that window Meta
rejects the send with error **131047** unless it is a pre-approved template,
which this feature does not use. A foreman texting `EMPEZAR` each morning
re-opens the window before any prompt goes out, so this is a non-issue in normal
operation. But a newly-registered foreman who has never texted the number will
get **no reply** to the tick's first attempted prompt, and nothing in the worker
log will look wrong. Register, then have them text `EMPEZAR` before expecting
anything outbound.

**Production D1:** use `wrangler d1 migrations apply rogue-origin-db --remote`
for 0034 as normal — §1.1's workaround is local-only.

**Before deploy, fix the persona (§4)** or accept that WhatsApp replies will be
unaccented despite the transport supporting them.

---

## 8. Verdict

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | `EMPEZAR` | activates, canned reply over WhatsApp, no Twilio | **PASS** |
| 2a | accented `sms_send` (no model) | all 7 codepoints survive `gsmSafe` skip | **PASS** |
| 2b | accented six-count report via live relay | drain → relay → `log_hourly_crew` → reply | **PASS** |
| 3 | two messages, one drain batch | both rows, in order, `channel='whatsapp'` | **PASS** |
| 4 | `PARAR` | day-total reply over WhatsApp | **PASS** |

**4/4 scenarios pass (5/5 counting 2a and 2b separately).** Every outbound text
left over the WhatsApp stub; nothing touched Twilio. The worker's channel-aware
dispatch, the tick's mailbox drain, the inbox `channel` provenance, the poll
context's `channel` exposure, and the relay's channel-aware sanitizer selection
all behaved in a live run exactly as their unit tests claimed.

The one gap is not in this feature's code: **the persona still tells the model to
write without accents** (§4). Fix that and the round trip is accent-clean from
the foreman's thumb to the foreman's screen.

## 9. Addendum (2026-09-16): persona fix verified live

`prompts/persona.md` was updated (commit `239d0f5`, after this transcript's relay
HEAD `0d9cc8d`) to make the "sin acentos" rule conditional on the `[From <name>,
in SMS]` / `in WhatsApp` label already in every prompt. That fix landed **after**
the run above and was only unit-tested — a review flagged that literal
instruction-following by the model can't be proven by a unit test, and this
feature's whole premise was exactly that kind of failure (the persona *said*
"in WhatsApp" the whole time in §4 and the model still stripped accents).

Re-verified live against current relay HEAD with a minimal direct `CCSession`
call (small talk, no tool call, so the reply is the model's own composed
Spanish rather than a worker-authored `confirmText()` echo, which stays
unaccented by design on both channels regardless of persona wording):

> `[From Test Arriba, in WhatsApp]` ... `buenos dias, como andamos?`
>
> **Reply:** `Buenos días, aquí andamos. Todavía no hay hora abierta; cuando
> tengas los números de la primera hora, mándamelos.`

Five accented codepoints (í, í, í, ú, á), confirmed via `[hex(ord(c)) for c in
reply if ord(c) > 127]` written to a UTF-8 file rather than trusting a terminal
echo (the first attempt printed mangled `�` glyphs from a console codepage
mismatch — the underlying string was correct the whole time, the display
wasn't). **The persona fix works as intended.**
