# Harvest print agent

Lets the crew print a supersack tag **from any phone** — iPhone or Android — by
taking the phone out of the printing business entirely.

The phone taps PRINT TAG, which it already does. The server queues a job. This
agent, on the barn PC, renders the tag and drives the printer. The phone only
ever makes a web request.

**Why:** iOS cannot print the tag. WebKit ignores `@page`, so the edge-to-edge
4 × 2 label comes out wrong on an iPhone no matter which printer is attached.
Full reasoning, and the options rejected (AirPrint, Zebra Weblink):
`wiki/operations/plans/2026-09-18-wireless-tag-printer.md` in the wiki repo.

---

## Setup

### 1. Worker secret

```bash
cd workers
npx wrangler secret put HARVEST_PRINT_AGENT_TOKEN
```

Use a long random string. **If this is unset the agent endpoints refuse every
request** — deliberately, so a forgotten secret fails loudly in setup rather
than quietly leaving the queue open.

### 2. Migration

```bash
cd workers
npx wrangler d1 execute <DB> --remote --file migrations/0038-harvest-print-queue.sql
```

This changes nothing on its own. Printing stays in the browser until step 5.

### 3. Barn PC

Node 18+ and Playwright's Chromium:

```bash
cd tools/print-agent
npm i playwright
npx playwright install chromium
```

### 4. Run it

```bash
set HARVEST_API=https://rogue-origin-api.roguefamilyfarms.workers.dev
set HARVEST_PRINT_TOKEN=<the same secret>
set HARVEST_PRINTER=Rollo X1040
node agent.mjs
```

`HARVEST_PRINTER` must be the **exact Windows queue name** — copy it from
Settings → Printers & Scanners, spaces and all. (The Zebra driver installs as
`Zebra  ZP 450-200 dpi`, with *two* spaces.)

Optional: `HARVEST_PRINT_DPI` (default `203`), `HARVEST_AGENT_ID` (default
`barn-pc`).

Check it is seen:

```
https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest?action=print_status
```

`agent_online: true` means the Worker can see it.

### 5. Flip printing to the agent

Only after step 4 reports `agent_online: true`:

```sql
INSERT INTO harvest_settings (key, value) VALUES ('print_mode', 'agent')
  ON CONFLICT(key) DO UPDATE SET value = 'agent';
```

Back to the browser at any time — this is the rollback, and it is instant:

```sql
UPDATE harvest_settings SET value = 'browser' WHERE key = 'print_mode';
```

### 6. Start it automatically

Task Scheduler → **At log on**, action `node`, arguments the full path to
`agent.mjs`, "Start in" this folder. Set the environment variables as **system**
variables so the task inherits them.

**Leave the barn PC awake.** Settings → System → Power → Screen and sleep →
*Sleep: Never*. A sleeping PC is a stopped agent.

### Falling back to the Zebra

**The old Zebra stays installed and is the spare.** Three ways back to it, in
increasing order of how much is broken:

**1. Switch which printer the agent drives** — one line, from anywhere, no trip
to the barn and no restart. The agent picks it up on its next poll:

```sql
INSERT INTO harvest_settings (key, value)
VALUES ('print_printer', 'Zebra  ZP 450-200 dpi')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
```

(Two spaces in that name. That is genuinely how the Zebra driver installs.)

**2. Turn the agent off entirely** — back to the browser printing exactly as it
does today, crew picking the destination in Chrome's dialog:

```sql
UPDATE harvest_settings SET value = 'browser' WHERE key = 'print_mode';
```

**3. Do nothing.** If the agent stops or the PC sleeps, `resolvePrintVia` sees no
heartbeat and **falls back to the browser on its own**. Tags keep printing from
the barn PC. This needs no intervention and is why a dead agent cannot swallow
a tag.

> ⚠️ **If you ever set Chrome's `--kiosk-printing`** (still open on the harvest
> checklist), there is no dialog and jobs go to Chrome's *default* printer. With
> two printers installed, make sure that default is the one you mean — otherwise
> the browser fallback silently prints to the wrong machine, which is the exact
> failure the SOP already warns about.

---

## How it behaves when things go wrong

| Situation | What happens |
|---|---|
| Agent stopped / PC asleep | `resolvePrintVia` sees no recent heartbeat and **falls back to the browser**. Tags still print from the barn PC's Chrome. Nothing is swallowed. |
| Printer jammed or offline | The job is acked as **failed with the reason**, and the crew screen polls for that and shows it — *"⚠ Tag 26-SLIFT-142 did not print: … — use Reprint"*. The serial is already spent, so **Reprint** (same serial) is the recovery, never a new tag. |
| Reprint in agent mode | Goes through the queue (`print_reprint`), not a browser link — a browser link is the path WebKit breaks on iPhone, and a jam is the most time-critical recovery there is. Same serial, no new sack row. |
| QR image fails to load | The agent **refuses to print** rather than emitting a tag with a blank square. A tag that did not print is recoverable; one that printed wrong gets wire-tied to a sack and found weeks later at scan time. |
| Agent crashed mid-job | Its rows sit `claimed` and would never print. Every pull requeues claims older than 5 minutes. |
| Rollo dies mid-takedown | Point the agent at the spare Zebra with one settings line — see *Falling back to the Zebra*. No restart, no trip to the barn PC. |
| Reprint on a freshly loaded screen | The client always asks the server which way to print rather than answering from a page variable. A screen that has allocated nothing has no local answer worth trusting, and guessing would send jam recovery down the iPhone-broken path. |
| Barn internet drops | The agent backs off (0.5 s doubling, capped at 30 s) and resumes on its own. The crew screen would not load either, which is a pre-existing gap. |
| Two tags from one tap | Should be impossible: `sack_alloc` returns `print_via` **per allocation**, and the browser skips its iframe when the server says `agent`. A page loaded an hour ago still obeys the server's answer for *that* tap. |

---

## What is proven, and what is not

**Proven — `node --test`, 44 tests (137 in the full suite):** the queue (enqueue
in-transaction, claim, ack, heartbeat, `print_via` resolution, the auth gate,
reprint, per-sack status, stale-claim requeue) and the agent's decisions (label
URL escaping, 812 × 406 dots at 203 dpi, backoff growth and cap, render
sanity bounds).

**Proven 2026-09-18 — the RENDER half.** Run against the live API on the barn
PC: the real `sack_label` page renders with the QR resolved and the design
intact, at 812 × 408 dots against a 812 × 406 target (the label lays out about
one CSS pixel taller than 2 in). That overshoot is absorbed by the 1:1 blit onto
the exact 4 × 2 page, and `renderSaneEnough` now fails the job if a render is
ever more than 5 % off — a page that did not lay out as a tag must not become a
physical object tied to a sack.

**Proven 2026-09-18 — the `PrintDocument` half, at the software level.** The
rendered bitmap was sent through `print-image.ps1` to the real **Zebra ZP 450**
(USB008): the script returned `printed`, the job left the spooler, and the
printer stayed `Normal` — no error, which matters given the LPT1 trap that once
made every Zebra job read Error.

**Still needs a human's eyes: whether the physical tag is CORRECT.** A job that
spools cleanly is not a tag that is the right size, dark enough, and aligned on
the stock. Compare a printed example tag against a known-good one before
trusting the agent with a takedown — and on the Rollo, repeat it, because
darkness on synthetic stock is set in the Rollo Portal, not the Windows driver.

First run, in this order:

1. Print **example tags** from the barn PC's Chrome — no agent involved. Confirms
   the printer and paper size. `?action=sack_label&examples=1`
2. Start the agent, confirm `print_status` shows `agent_online: true`.
3. **With `print_mode` still `browser`**, print one real tag. The browser prints
   it; a queue row is written and drained by the agent. **Two tags should come
   out** — that is expected here and confirms the agent's leg works end to end
   without risking a missed tag.
4. Flip `print_mode` to `agent`. From here one tap gives one tag.

Step 3 is the only safe way to prove the print leg without a window where a tag
could go missing mid-takedown.
