# Production Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Design: `docs/plans/2026-10-19-production-cards-design.md`. Approved renders: `docs/plans/assets/2026-10-19-card-*.png`. Reference builder (HTML/CSS the Satori layout must reproduce): `docs/plans/assets/2026-10-19-card-mock-builder.py`.

**Goal:** A `rogue-origin-cards` Cloudflare Worker that returns 1080×1350 PNG cards (`/midday`, `/eod`, `/weekly`) built from the production API, plus a `telegram_send_photo` tool and midday/EOD crons in the Telegram bridge.

**Architecture:** Pure functions turn API JSON into a card model, the model into a Satori element tree, and Satori + resvg-wasm turn the tree into PNG. The worker forwards the caller's bearer to the API so cost tiles lock exactly as the API locks them. The bridge is the only thing that talks to Telegram: a tool fetches a card URL and uploads the bytes; a cron does the same twice a day.

**Tech Stack:** Cloudflare Workers (wrangler, ES modules, wasm imports), `satori@0.63` (its `standalone` entry + `layout.wasm`, plus `src/harfbuzz-shim.js` for its bundled HarfBuzz in Workers), `@resvg/resvg-wasm@2.6`, `node --test` (`*.test.mjs`), TypeScript in the bridge (`node --test test/*.test.ts`, `@modelcontextprotocol/sdk`, `zod`).

**Worktrees:** apps → `C:\Users\Koasm\Desktop\Dev\roa-cards` (branch `feat/production-cards`). Bridge → `C:\Users\Koasm\Desktop\telegram-claude-bot-photo` (branch `feat/telegram-send-photo`). Baselines: apps `workers` tests 0 failures, root tests 1190/1192 (two pre-existing failures unrelated to `cards/`); bridge 8/8 + `tsc --noEmit` clean.

**Conventions to keep:** no `python`, only Node here. Tests are `node --test`. Commit after every task with a conventional message. Never run `wrangler deploy` for the bridge during active tagging hours; the cards worker is new and may be deployed freely. The cost password is never written to a file or a prompt.

---

## Part A — cards worker (apps repo, `cards/`)

### Task A1: Package, wrangler config, fonts, fixtures (already staged — verify and commit)

**Files:**
- Create: `cards/package.json`
- Create: `cards/wrangler.toml`
- Exists: `cards/fonts/{Outfit-Medium,Outfit-SemiBold,JetBrainsMono-Regular,DMSerifDisplay-Italic}.ttf`
- Exists: `cards/test/fixtures/*.json` (captured 2026-10-19 from the live API; `dashboard-2026-W42.unlocked.json` has cost keys, synthetic since 2026-10-29, the `.locked.json` files do not)
- Modify: `.gitignore` → add `cards/node_modules/` and `cards/.wrangler/`

**Step 1: write `cards/package.json`**

```json
{
  "name": "rogue-origin-cards",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "size": "wrangler deploy --dry-run --outdir dist && node -e \"const fs=require('fs');let t=0;for(const f of fs.readdirSync('dist'))t+=fs.statSync('dist/'+f).size;console.log('bundle bytes',t)\"",
    "test": "node --test test/*.test.mjs"
  },
  "dependencies": {
    "@resvg/resvg-wasm": "2.6.2",
    "satori": "0.63.0"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

**Step 2: write `cards/wrangler.toml`**

```toml
name = "rogue-origin-cards"
main = "src/index.js"
compatibility_date = "2024-09-23"

[vars]
API_BASE = "https://rogue-origin-api.roguefamilyfarms.workers.dev/api"

[[rules]]
type = "Data"
globs = ["**/*.ttf"]
fallthrough = true

[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
fallthrough = true
```

**Step 3:** `cd cards && npm install` → expect a lockfile and the three deps. Run `npm test` → expect "no test files" style output (0 tests) — that proves the runner wiring, not a failure.

**Step 4: commit**

```bash
git add cards/package.json cards/package-lock.json cards/wrangler.toml cards/fonts cards/test/fixtures .gitignore docs/plans/2026-10-19-production-cards-design.md docs/plans/2026-10-19-production-cards-plan.md docs/plans/assets
git commit -m "feat(cards): scaffold the production cards worker — config, fonts, API fixtures, design"
```

---

### Task A2: `periods.js` — Pacific dates, ISO weeks, slot labels (pure)

**Files:**
- Create: `cards/src/periods.js`
- Test: `cards/test/periods.test.mjs`

**Step 1: failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pacificDate, lastCompleteWeek, weekRange, slotLabel, slotEnd, weekdayName } from '../src/periods.js';

test('pacificDate renders a UTC instant as a Pacific YYYY-MM-DD', () => {
  assert.equal(pacificDate(new Date('2026-10-20T03:30:00Z')), '2026-10-19'); // 8:30 PM PDT Oct 19
  assert.equal(pacificDate(new Date('2026-10-19T13:10:00Z')), '2026-10-19');
});

test('weekRange maps an ISO week to its Monday..Friday', () => {
  assert.deepEqual(weekRange('2026-W42'), { start: '2026-10-12', end: '2026-10-16', week: 42, year: 2026 });
  assert.throws(() => weekRange('2026-W99'), /week/);
  assert.throws(() => weekRange('garbage'), /week/);
});

test('lastCompleteWeek is the previous Mon–Fri on Mon–Sun alike', () => {
  assert.equal(lastCompleteWeek('2026-10-19'), '2026-W42'); // a Monday
  assert.equal(lastCompleteWeek('2026-10-17'), '2026-W42'); // Saturday after W42
  assert.equal(lastCompleteWeek('2026-10-16'), '2026-W41'); // Friday still inside W42
});

test('slot labels and ends', () => {
  assert.equal(slotLabel('7:00 AM – 8:00 AM'), '7');
  assert.equal(slotLabel('12:30 PM – 1:00 PM'), '12½');
  assert.equal(slotLabel('4:00 PM – 4:30 PM'), '4');
  assert.equal(slotEnd('12:30 PM – 1:00 PM'), '13:00');
  assert.equal(slotEnd('11:00 AM – 12:00 PM'), '12:00');
});

test('weekdayName', () => {
  assert.equal(weekdayName('2026-10-16'), 'Friday');
  assert.equal(weekdayName('2026-10-19'), 'Monday');
});
```

The API's time slots use an en dash or a hyphen between times (`"7:00 AM – 8:00 AM"`); the fixtures show the exact string — parse with `/(\d+):(\d+)\s*([AP]M)/g` and take the first and second matches.

**Step 2:** `npm test` → FAIL (module not found).

**Step 3: implement** `cards/src/periods.js` with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit' })` for `pacificDate`; ISO week math on UTC-noon dates (never local time); `weekRange` validates `^(\d{4})-W(\d{2})$` and 1 ≤ week ≤ 53; `lastCompleteWeek(ymd)` = the ISO week of `ymd` minus one when `ymd` is Mon–Fri, the ISO week of `ymd`'s Monday when Sat/Sun (so Saturday after W42 → W42; check the expected values above and make the arithmetic match them, they are the spec); `slotLabel` → start hour, `½` when start minute is 30; `slotEnd` → `HH:MM` 24-hour of the slot end.

**Step 4:** `npm test` → PASS. **Step 5:** `git commit -m "feat(cards): period helpers — Pacific dates, ISO weeks, slot labels"`.

---

### Task A3: `data.js` — upstream fetches with bearer pass-through (injectable fetch)

**Files:**
- Create: `cards/src/data.js`
- Test: `cards/test/data.test.mjs`

**Step 1: failing tests** (use a recording fake `fetch`; load fixtures with `fs.readFileSync(new URL('./fixtures/x.json', import.meta.url))`)

```js
test('fetchDashboard forwards the bearer and parses JSON', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return new Response(fixture('dashboard-2026-W42.unlocked.json'), { status: 200 }); };
  const api = makeApi({ base: 'https://api.example/api', fetchFn, bearer: 'secret' });
  const d = await api.dashboard('2026-10-12', '2026-10-16');
  assert.equal(calls[0].url, 'https://api.example/api/production?action=dashboard&start=2026-10-12&end=2026-10-16');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(d.daily.length, 4);
});
test('no bearer → no Authorization header', ...);
test('scoreboard(date) and supersackSummary(start,end) hit the right actions without a bearer', ...);   // supersack + scoreboard never need it
test('upstream non-200 throws UpstreamError with the status', ...);                                       // err.status === 502-worthy
test('fetch aborts after the timeout', ...);                                                              // pass timeoutMs: 10 and a fetch that never resolves → rejects
```

**Step 2:** FAIL. **Step 3: implement** `makeApi({ base, fetchFn = globalThis.fetch, bearer, timeoutMs = 8000 })` returning `{ dashboard(start,end), scoreboard(date), supersackSummary(start,end) }`; `AbortController` timeout; `class UpstreamError extends Error { constructor(status, url) }`. **Step 4:** PASS. **Step 5:** commit `feat(cards): API client with bearer pass-through and timeouts`.

---

### Task A4: `model.js` — shared pieces: costs lock detection, deltas, chips, flags from notes (pure)

**Files:**
- Create: `cards/src/model.js` (grows in A5–A7)
- Create: `cards/src/notes.js` (phrase table + flag rules)
- Test: `cards/test/notes.test.mjs`, `cards/test/model-shared.test.mjs`

**Step 1: failing tests**

```js
// notes.test.mjs
test('classifies floor notes', () => {
  assert.deepEqual(classifyNote('las volsas que quedaron a vajo estan muy humedas piensen que se va aser porque se pueden echar a perder'),
    { kind: 'bad', text: 'Bags stored below are very wet, spoilage risk, need a plan' });
  assert.deepEqual(classifyNote('trae un poquito de mold y algunos gusanos'), { kind: 'warn', text: 'A bit of mold and some worms' });
  assert.equal(classifyNote('[Crew change 11:30 AM: Buckers : 11 → 9]'), null);   // crew-change markers are not flags
  assert.equal(classifyNote(''), null);
});
test('translate keeps unknown words and maps the floor vocabulary', () => {
  assert.equal(translate('el producto esta muy humedo y tiene mucha hoja'), 'Product is very wet and has a lot of leaf');
});

// model-shared.test.mjs
test('costsLocked is true when the dashboard day has no topsCostPerLb', () => { ... locked fixture → true; unlocked → false });
test('delta chip: direction, sign, good/bad polarity', () => {
  assert.deepEqual(deltaChip(1.34, 1.20, { fmt: v => v.toFixed(2), upIsGood: true, vs: 'W41' }), { kind: 'good', text: '▲ +0.14 vs W41' });
  assert.deepEqual(deltaChip(22.78, 26.33, { fmt: v => '$' + v.toFixed(2), upIsGood: false, vs: 'W41' }), { kind: 'good', text: '▼ −$3.55 vs W41' });
  assert.deepEqual(deltaChip(100, 100, { fmt: String, upIsGood: true, vs: 'Thu' }), { kind: 'neutral', text: '= vs Thu' });
  assert.equal(deltaChip(5, null, {...}), null);
});
test('pctChip', () => assert.deepEqual(pctChip(497.2, 508.3), { kind: 'warn', text: '98% target' }));   // ≥100 good, 90–99 warn, <90 bad
test('hourTarget is the scoreboard method: effectiveTrimmers × row.target × multiplier, summing to todayTarget', () => { /* for each scoreboard fixture: Σ hourTarget(row) over hourlyRates ≈ scoreboard.todayTarget within 0.01 */ });
```

Phrase table (minimum): mold→mold, gusano(s)→worm(s), húmedo/humedo/humedas→wet, hoja→leaf, costal→sack, volsa/bolsa→bag, colgar→hang, echar a perder→spoil, no se está pasando por el costal→not going through the sack, trae→has, mucho/mucha→a lot of. The translation is a word/phrase substitution plus capitalising the first letter; it does not need to be grammatical, it needs to be readable. `classifyNote` rules: contains "echar a perder"/"spoil" → `bad`; contains mold/gusano/humed/hoja → `warn`; otherwise `null` (the card only shows flags it can classify; Good flags come from numbers, not notes).

**Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(cards): note classifier and shared card-model helpers`.

---

### Task A5: `model.js` — weekly card model

**Files:**
- Modify: `cards/src/model.js` → export `weeklyModel({ week, dashboard, prior, scoreboards, sacks, generatedAt })`
- Test: `cards/test/model-weekly.test.mjs`

**Step 1: failing tests** (fixtures: `dashboard-2026-W42.unlocked.json`, `dashboard-2026-W41.locked.json` as `prior`, the four `scoreboard-2026-10-1x.json`, `supersack-2026-W42.json`)

```js
const m = weeklyModel({ week: '2026-W42', dashboard, prior, scoreboards: { '2026-10-13': sb13, ... }, sacks, generatedAt: new Date('2026-10-19T13:05:00Z') });
test('header', () => {
  assert.equal(m.kind, 'weekly');
  assert.equal(m.title, 'Week 42');
  assert.equal(m.sub, "Oct 12–16, 2026 · Sour Lifter '26 · 4 days");
  assert.equal(m.pill, 'Line crew 18–27 · avg 22');
});
test('hero tiles', () => {
  assert.deepEqual(m.tiles[0], { label: 'Tops', value: '497', unit: 'lb', chips: [{ kind: 'good', text: '▲ +261% vs W41' }, { kind: 'warn', text: '98% target' }] });
  assert.equal(m.tiles[1].value, '1.34');
  assert.deepEqual(m.tiles[2], { label: '$ per lb tops', value: '$22.78', unit: '', chips: [{ kind: 'good', text: '▼ −$3.55 vs W41' }] });
});
test('chart has five weekday columns, Monday off, ticks from the scoreboard targets', () => {
  assert.equal(m.chart.cols.length, 5);
  assert.deepEqual(m.chart.cols[0], { label: 'Mon', rate: '—', lbs: 0, target: 0, kind: 'off' });
  assert.equal(m.chart.cols[1].lbs, 110.8);
  assert.ok(Math.abs(m.chart.cols[1].target - 124.7) < 0.2);     // scoreboard-2026-10-13 todayTarget
  assert.equal(m.chart.cols[4].rate, '1.62');
});
test('mini row', () => {
  assert.deepEqual(m.minis[0], { label: 'Smalls', value: '429', unit: 'lb', sub: '$10.10/lb' });
  assert.deepEqual(m.minis[1], { label: 'Supersacks', value: '88', unit: 'opened', sub: '3,080 lb raw · 5.6 tops/sack' });
  assert.deepEqual(m.minis[2], { label: 'Labor', value: '$15,660', unit: '', sub: 'all-in $31.50/lb' });
});
test('flags: at most three, Act first', () => {
  assert.equal(m.flags[0].kind, 'bad');
  assert.ok(m.flags.length <= 3);
});
test('locked costs blank the money', () => {
  const l = weeklyModel({ ...sameArgs, dashboard: lockedFixture, prior: lockedPrior });
  assert.equal(l.costsLocked, true);
  assert.equal(l.tiles[2].value, '🔒');
  assert.equal(l.tiles[2].chips.length, 0);
  assert.equal(l.minis[2].value, '🔒');
});
test('foot', () => assert.deepEqual(m.foot, { left: 'cards/weekly · dashboard allocation · $/lb tops', right: 'generated Mon Oct 19 · 06:05 PT' }));
```

Rules the implementation must follow (they are the approved mock):
- Weighted averages: rate = Σ tops ÷ Σ trimmerHours; $/lb tops = Σ(topsCostPerLb × tops) ÷ Σ tops; smalls likewise; all-in = Σ laborCost ÷ Σ tops.
- Prior week deltas use the same formulas on `prior.daily`. Tops delta as a percentage (`+261%`), rate as `+0.14`, cost as `−$3.55`; `upIsGood` false for cost.
- `% target` = Σ tops ÷ Σ scoreboard `todayTarget` of the worked days; chip kind: ≥100 good, 90–99 warn, else bad.
- Cultivar short name: dominant `cultivar` across days; strip a leading `YYYY - `, strip ` / Sungrown`; append `'YY` from the leading year; more than one cultivar → main one + ` +1` per extra.
- Days: Monday..Friday of the week; a weekday missing from `daily` (or `totalTops` 0) is `kind: 'off'`.
- Sacks: `sum(periods[].total_sacks)`, raw = `sum(total_raw)`, tops/sack = Σ tops ÷ sacks (1 decimal); no periods → `{ value: '—', sub: 'tracker empty' }`.
- Flags: Act = the latest `bad` note across the week (prefix with the weekday: "Fri: …"); Watch = one line summarising `warn` notes ("Mold, worms and moisture flagged Tue–Thu" — generated as `<themes joined> flagged <firstDay>–<lastDay>`, themes from the matched words: mold, worms, moisture); Good = "Rate rose all week" when the daily rate trend is up Tue→Fri, else the best day: "Best day Wed, 140 lb at 1.38". Order: bad, warn, good; cap 3.
- Locked: `value: '🔒'`, no chips, sub 'locked' on the cost minis; nothing else changes.

**Step 2:** FAIL. **Step 3:** implement (keep helpers in `model.js`; formatting helpers `fmtInt`, `fmtMoney`, `fmt1`, `fmt2` with `Intl.NumberFormat('en-US')`). **Step 4:** PASS. **Step 5:** commit `feat(cards): weekly card model`.

---

### Task A6: `model.js` — end-of-day card model

**Files:**
- Modify: `cards/src/model.js` → export `eodModel({ date, dashboard, priorDay, scoreboard, sacks, generatedAt })`
- Test: `cards/test/model-eod.test.mjs` (fixtures: `dashboard-2026-10-16.locked.json` + an unlocked copy built in the test by adding the known cost keys `laborCost 3500, costPerLb 16.66, topsCostPerLb 20.50, smallsCostPerLb 11.53`; prior `dashboard-2026-10-15.locked.json` with `topsCostPerLb 23.65` added; `scoreboard-2026-10-16.json`; `supersack-2026-10-16.json`)

**Tests (same shape as A5):**
- title `Friday`, sub `Oct 16 · Sour Lifter '26 · 8.5 h logged` (hours = scoreboard `effectiveHours` to 1 decimal), pill `Line crew peak 18 · 8 T · 9 B` (peak = `totalCrew`; T/B = the max trimmers / max buckers across hourlyRates).
- tiles: Tops `120` lb chip `▲ 112% of target` (todayPercentage, kind by the same bands); Rate `1.62` chip `▲ +0.34 vs Thu`; `$ per lb tops` `$20.50` chip `▼ −$3.15 vs Thu`.
- chart: one column per `hourlyRates` row sorted by slot start; `lbs`, `rate` 2 decimals, `target = hourTarget(row)` (effectiveTrimmers × row.target × multiplier, the scoreboard method), `label = slotLabel`.
- minis: Smalls `90` lb `$11.53/lb`; Supersacks `20` opened `700 lb raw · 6.0 tops/sack`; Labor `$3,500` `all-in $29.14/lb`.
- flags: Act from the day's bad note with the slot start prefix ("2 PM: …"), Good = `Best hour 3–4 at 2.21` or, when the day's rate beats the prior day, `Best rate since <prior day>` — keep it simple: Good = best hour line; Watch = warn note or, if none, a crew drop ("Crew fell 8 → 5 trimmers after 2 PM") when the last hour's trimmers are < 70% of the peak.
- no rows (`hourlyRates` empty) → the function returns `null` (the route turns that into 204).
- locked variant → 🔒 as in A5.

Commit `feat(cards): end-of-day card model`.

---

### Task A7: `model.js` — midday card model

**Files:**
- Modify: `cards/src/model.js` → export `middayModel({ date, scoreboard, dashboardToday, priorDay, sacks, generatedAt })`
- Test: `cards/test/model-midday.test.mjs` (fixtures: `scoreboard-2026-10-19.json`, `dashboard-2026-10-19.locked.json`, prior `dashboard-2026-10-16.locked.json`, `supersack-2026-10-19.json` which is empty)

**Tests:**
- title `Monday`, sub `Oct 19 · Sour Lifter '26 · through 13:00` (end of the last logged slot via `slotEnd`), pill `Line crew 8 T · 6 B · 1 TZ` (last row's trimmers/buckers; TZ from `dashboardToday.today.tzero || 1`).
- tiles: `Tops so far` = Σ lbs (0 decimals) chip `▲ 120% of target` from `todayPercentage`; `Rate` = Σ lbs ÷ Σ(effectiveTrimmers × multiplier) chip `▲ target 1.59` (kind good when rate ≥ target else bad); `Projected end of day` = `projectedTotal` chip neutral `Fri closed at 120` (prior day's tops, weekday name).
- chart: logged rows + one `kind: 'now'` column when `currentHourTarget > 0` (label from `currentTimeSlot`, `target = currentHourTarget`).
- minis: `Smalls so far`; `Buckers per trimmer` = last row buckers ÷ trimmers (2 decimals) sub `band 0.70–0.75, fed` when within 0.65–0.85 else `band 0.70–0.75, short` / `, idle`; `Hours logged` `effectiveHours` of 8.5, sub `sacks logged: N` (0 when the tracker is empty).
- flags: Good when every logged hour's rate ≥ target: `Every hour above target so far, best 2.14 at 9–10`; Watch from warn notes; Watch `No supersacks logged on the tracker yet today` when sacks = 0 and the last slot ends at or after 10:00.
- no rows → `null`.

Commit `feat(cards): midday card model`.

---

### Task A8 step 0: runtime spike before any layout work

Before A8/A9, prove the render path in the real runtime: a throwaway `cards/src/index.js` that imports `satori/standalone` + `satori/layout.wasm` + `@resvg/resvg-wasm` + its `index_bg.wasm`, initialises both once, renders one text node in Outfit to a 1080×1350 PNG and returns it. `npx wrangler dev --port 8790` + `curl -o /tmp/spike.png -w "%{http_code}"` → 200 and a real PNG. Then `npm run deploy` the spike as `rogue-origin-cards` and curl the deployed URL: a 1102 "exceeded CPU" error means the account is on Workers Free (10 ms CPU) and Koa decides on the Paid plan before continuing; a 200 means rendering fits (the bridge's Durable Object already needs the Paid plan, so a 200 is expected). Keep the spike's wasm/font wiring as `runtime-workers.js` in A10. Commit `chore(cards): render spike — satori standalone + resvg in the Workers runtime`.

### Task A8: `layout.js` — card model → Satori element tree (pure)

**Files:**
- Create: `cards/src/layout.js` → `export function cardTree(model)`; `export const CANVAS = { width: 1080, height: 1350 }`
- Test: `cards/test/layout.test.mjs`

Satori takes React-like objects: `{ type: 'div', props: { style: {...}, children: [...] } }`. Only flexbox: **every element with more than one child must have `display: 'flex'`**; text nodes are plain strings; no CSS variables, no classes, no `gap` shorthand problems (gap is supported); `position: 'absolute'` is supported; `border` must be given as `borderWidth/borderStyle/borderColor` or the shorthand string — use the longhand; `borderRadius` number; fonts by `fontFamily: 'Outfit' | 'JetBrains Mono' | 'DM Serif Display'` with `fontWeight` 500/600 and `fontStyle: 'italic'` for the title. Reproduce the mock CSS in `docs/plans/assets/2026-10-19-card-mock-builder.py` one-to-one (same px, same colours: card `#1a1f1c`, tile `#161b18`, lines `rgba(255,255,255,0.07)`, bar `#4fa06b`, tick `#e4aa4f`, good `#7fbf95`, bad `#e07b6b`, warn `#e4aa4f`).

**Step 1: failing tests**

```js
test('tree is 1080x1350 with the five sections in order', () => {
  const t = cardTree(weeklyFixtureModel);
  assert.equal(t.props.style.width, 1080); assert.equal(t.props.style.height, 1350);
  const kinds = t.props.children.map(c => c.props['data-section']);
  assert.deepEqual(kinds, ['head', 'tiles', 'chart', 'minis', 'flags', 'foot']);
});
test('every element with 2+ children is display flex', () => walk(t, el => { if (Array.isArray(el.props.children) && el.props.children.length > 1) assert.equal(el.props.style.display, 'flex'); }));
test('no NaN or undefined in any style value', () => walk(t, el => Object.values(el.props.style || {}).forEach(v => assert.ok(v !== undefined && !(typeof v === 'number' && Number.isNaN(v))))));
test('bars and ticks stay inside the plot', () => { /* every bar height ≤ 224, every tick bottom ≤ 224 */ });
test('chart scale uses 82% of the plot for the tallest of bar or tick', () => { /* max(height, tick) === round(224*0.82) ±1 */ });
test('locked model renders the lock glyph and no chips on cost tiles', ...);
test('an off column renders the stub and "off" cap; a now column renders the dashed box', ...);
```

Write `walk(tree, fn)` in the test helper `cards/test/helpers.mjs` (also exports `fixture(name)` and `models()` that builds the three models from fixtures — reuse in A9/A10).

**Step 2:** FAIL. **Step 3:** implement `layout.js` as small functions: `head(m)`, `tiles(m)`, `chart(m)`, `minis(m)`, `flags(m)`, `foot(m)`, each returning a node with `'data-section'`. Chips: `white-space: nowrap` has no effect in Satori — keep chip text short as the models already do. The chart: `plot` is `position: relative`, columns `position: relative`, tick `position: absolute, left 10, right 10, bottom: tickPx, borderTopWidth 3, borderTopStyle 'dashed', borderTopColor '#e4aa4f'`, cap label `position: absolute, bottom: max(barPx, tickPx) + 10, left 0, right 0, display flex, justifyContent center`. **Step 4:** PASS. **Step 5:** commit `feat(cards): Satori layout for the three cards`.

---

### Task A9: `render.js` + `fonts.js` — Satori → SVG → resvg → PNG, in Node first

**Files:**
- Create: `cards/src/fonts.js` → `export const FONT_SPECS = [{ name:'Outfit', weight:500, style:'normal', file:'Outfit-Medium.ttf' }, { name:'Outfit', weight:600, style:'normal', file:'Outfit-SemiBold.ttf' }, { name:'JetBrains Mono', weight:400, style:'normal', file:'JetBrainsMono-Regular.ttf' }, { name:'DM Serif Display', weight:400, style:'italic', file:'DMSerifDisplay-Italic.ttf' }]; export function fontsFrom(loader) { return FONT_SPECS.map(s => ({ name: s.name, weight: s.weight, style: s.style, data: loader(s.file) })); }`
- Create: `cards/src/render.js` → `export async function renderPng(tree, { fonts, satori, resvg })` where `satori` is the satori function (already initialised) and `resvg` is the `Resvg` class (wasm already initialised). Returns `Uint8Array` PNG. `satori(tree, { width: 1080, height: 1350, fonts })` → svg string; `new Resvg(svg, { fitTo: { mode: 'width', value: 1080 }, background: '#1a1f1c' }).render().asPng()`.
- Create: `cards/src/runtime-node.mjs` → `export async function nodeRuntime()`: `import satori from 'satori'` (Node entry, bundles yoga itself), `import { Resvg, initWasm } from '@resvg/resvg-wasm'`, `initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))` once (guard a module-level promise), fonts via `fs.readFileSync(new URL('../fonts/' + file, import.meta.url))`. Returns `{ satori, Resvg, fonts }`.
- Test: `cards/test/render.test.mjs`

**Step 1: failing test**

```js
import { nodeRuntime } from '../src/runtime-node.mjs';
import { renderPng } from '../src/render.js';
import { cardTree } from '../src/layout.js';
import { models } from './helpers.mjs';
import { pngSize } from './helpers.mjs'; // parses the 8-byte signature + IHDR

for (const [name, model] of Object.entries(models())) {
  test(`renders the ${name} card as a 1080x1350 PNG in under 5s`, async () => {
    const rt = await nodeRuntime();
    const t0 = Date.now();
    const png = await renderPng(cardTree(model), { fonts: rt.fonts, satori: rt.satori, resvg: rt.Resvg });
    assert.ok(Date.now() - t0 < 5000);
    assert.deepEqual(pngSize(png), { width: 1080, height: 1350 });
    fs.writeFileSync(new URL(`./out/${name}.png`, import.meta.url), png);   // out/ is gitignored; look at these
  });
}
test('renders the locked weekly card', ...);
```

**Step 2:** FAIL. **Step 3:** implement; add `cards/test/out/` to `.gitignore`. **Step 4:** PASS; then **open `cards/test/out/weekly.png`, `eod.png`, `midday.png` and compare against `docs/plans/assets/2026-10-19-card-*.png`** — same sections, same numbers, labels not overlapping ticks, nothing cut off at the bottom. Fix layout until they match (Satori's text metrics differ slightly from Chromium; adjust font sizes by ≤2px, never structure). **Step 5:** commit `feat(cards): render pipeline (satori + resvg) with Node runtime and render tests`.

---

### Task A10: `index.js` — routes, defaults, cache, 204/400/502, Workers runtime

**Files:**
- Create: `cards/src/runtime-workers.js` → `export async function workersRuntime()`: `import satori, { init as initSatori } from 'satori/standalone'; import layoutWasm from 'satori/layout.wasm'; import { Resvg, initWasm } from '@resvg/resvg-wasm'; import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';` — **already built in A8 step 0 (commit 2d7ff875); A10 reuses it unchanged.** Its first import is `./harfbuzz-shim.js`, which must evaluate before satori: satori 0.63 ships `./standalone` + `./layout.wasm`, but its standalone build still compiles HarfBuzz from base64 at run time, which Workers refuse (see the design doc's Workers specifics; satori 0.32, the last release without HarfBuzz, was tried and rejected 2026-10-19). No module in the worker other than `runtime-workers.js` imports satori. `initSatori(layoutWasm)` takes the compiled module from the CompiledWasm rule. The spike deploy returned 200 (Workers Paid). + the four font imports (`import outfitMedium from '../fonts/Outfit-Medium.ttf'` → ArrayBuffer via the Data rule). Initialise once per isolate behind a module-level promise; `initWasm` throws if called twice — catch "already initialized".
- Create: `cards/src/app.js` → `export function makeApp({ api, runtime, now = () => new Date(), cache })` returning `{ fetch(request) }` — all logic here, pure of globals, so tests can drive it.
- Create: `cards/src/index.js` → `export default { async fetch(request, env, ctx) { const app = makeApp({ api: makeApi({ base: env.API_BASE, bearer: bearerOf(request) }), runtime: await workersRuntime(), cache: caches.default }); return app.fetch(request); } }` (build the api per request because the bearer is per request).
- Test: `cards/test/routes.test.mjs` — drive `makeApp` with the Node runtime and a fake api/fetch; a fake `cache` object `{ match, put }` recording keys.

**Routes and rules** (write each as a test first):
- `GET /health` → `200 {"ok":true}`.
- `GET /weekly` → default `lastCompleteWeek(pacificDate(now()))`; `?week=2026-W42` explicit; bad → `400 {"error":"week must look like 2026-W42"}`.
- `GET /eod` → default today Pacific; `?date=YYYY-MM-DD`; bad → 400.
- `GET /midday` → same as eod.
- Data fetches per route: weekly = dashboard(week range) + dashboard(prior week) + scoreboard(each weekday, in parallel) + supersackSummary(week); eod = dashboard(date..date) + dashboard(prior weekday) + scoreboard(date) + supersackSummary(date); midday = scoreboard(date) + dashboard(date..date) + dashboard(prior weekday) + supersackSummary(date). "Prior weekday" = the previous Mon–Fri date (Friday for a Monday).
- `dashboard.fallback?.active === true` for the requested period, or a model that comes back `null` → `204` with no body.
- `?format=json` → `200 application/json` with the model (`costsLocked` included).
- PNG: `200 image/png`, `Cache-Control: public, max-age=86400` when the period ends before today Pacific, else `max-age=120`; header `X-Card: weekly|eod|midday`, `X-Costs: locked|unlocked`.
- Cache: key = `new Request(url.toString() + (bearer ? '#auth' : ''))` (fragment is fine for `caches` keys when you build the Request yourself — if the runtime rejects fragments, append `&_auth=1` instead); on a hit, return it; on a miss, render and `cache.put` only when `(bearer present) === (model.costsLocked === false)`.
- `UpstreamError` → `502 {"error":"upstream 500 at <url>"}`; anything else thrown → `500 {"error": message}`; errors are never cached.
- Unknown path → `404`.

**Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS (`npm test` — whole suite). **Step 5:** commit `feat(cards): routes, defaults, cache and the Workers runtime`.

---

### Task A11: Bundle, dev run, visual check, deploy

**Step 1:** `cd cards && npm run size` → the script gzips the dry-run output; the gzip total must be < 2,800,000 (the 3 MB Workers limit is on the compressed size; raw will be ~4 MB and is irrelevant). Expected ≈1.7 MB gzipped.

**Step 2:** `npx wrangler dev --port 8790` in the background, then `curl -s -o /tmp/w.png -w "%{http_code} %{content_type}\n" "http://localhost:8790/weekly?week=2026-W42"` → `200 image/png`; same for `/eod?date=2026-10-16` and `/midday?date=2026-10-19`; `curl -s "http://localhost:8790/eod?date=2026-10-10" -w "%{http_code}"` → `204` (a Saturday, no rows); with a bearer header `-H "Authorization: Bearer <the ops password, typed by Koa, never stored>"` → `X-Costs: unlocked`. Open the three PNGs and compare with the approved mocks. The Workers runtime is the only path not covered by node tests — this is the step that proves wasm + fonts load in the real runtime.

**Step 3:** `npm run deploy` → note the `*.workers.dev` URL; `curl -I "https://rogue-origin-cards.roguefamilyfarms.workers.dev/weekly?week=2026-W42"` → 200 + `X-Costs: locked`.

**Step 4:** commit anything that changed (`fix(cards): …`), push the branch, open PR "feat(cards): production cards worker (midday / eod / weekly PNG)" with the three PNGs attached in the description and the design doc linked. Body ends with the Claude Code attribution line.

---

## Part B — Telegram bridge (`C:\Users\Koasm\Desktop\telegram-claude-bot-photo`)

### Task B1: `sendPhoto` in `telegram.ts`

**Files:**
- Modify: `src/telegram.ts` → add `export async function sendPhoto(env, bytes: Uint8Array, opts: { caption?: string; filename?: string }): Promise<{ ok: boolean; error?: string }>`
- Modify: `src/types.ts` → add `CARDS_URL?: string` to `Env`
- Test: `test/telegram-photo.test.ts`

**Step 1: failing test** (stub `globalThis.fetch`, capture the `FormData`)

```ts
import test from 'node:test'; import assert from 'node:assert/strict';
import { sendPhoto } from '../src/telegram.ts';
test('sendPhoto posts multipart with chat_id, photo and caption', async () => {
  let captured: { url: string; body: FormData } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => { captured = { url, body: init.body as FormData }; return new Response('{"ok":true}', { status: 200 }); }) as any;
  const r = await sendPhoto({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42' } as any, new Uint8Array([137, 80, 78, 71]), { caption: 'Week 42 card', filename: 'week-42.png' });
  assert.equal(r.ok, true);
  assert.equal(captured!.url, 'https://api.telegram.org/bott/sendPhoto');
  assert.equal(captured!.body.get('chat_id'), '42');
  assert.equal(captured!.body.get('caption'), 'Week 42 card');
  const f = captured!.body.get('photo') as File; assert.equal(f.name, 'week-42.png'); assert.equal(f.type, 'image/png');
});
test('Telegram error text comes back', async () => { /* 400 {"ok":false,"description":"Bad Request: PHOTO_INVALID_DIMENSIONS"} → { ok:false, error: 'Bad Request: PHOTO_INVALID_DIMENSIONS' } */ });
test('caption is cut to 1024 chars', ...);
```

**Step 2:** `npm test` → the package's test script only runs `test/harvest-summary.test.ts`: change it to `node --test test/*.test.ts` first (that is part of this task), then FAIL. **Step 3:** implement with `new FormData()`, `fd.append('photo', new Blob([bytes], { type: 'image/png' }), filename ?? 'card.png')`. **Step 4:** PASS, `npx tsc --noEmit` clean. **Step 5:** commit `feat(telegram): sendPhoto multipart upload`.

---

### Task B2: `cards.ts` — fetch a card URL safely

**Files:**
- Create: `src/cards.ts` → `export async function fetchCard(url: string, env: Env, fetchFn = fetch): Promise<{ status: 'ok'; bytes: Uint8Array; contentType: PhotoType } | { status: 'empty' } | { status: 'error'; message: string }>  // PhotoType = 'image/png' | 'image/jpeg' | 'image/webp'`
- Test: `test/cards.test.ts`

Rules (one test each): only `https:`; the `Authorization: Bearer ${env.ORDERS_PASSWORD}` header is added only when the parsed hostname equals the cards worker host exactly (`new URL(env.CARDS_URL || DEFAULT_CARDS_URL).hostname`) — never on a suffix match, because the API worker on the same suffix accepts the same password for write actions; with a bearer the fetch uses `redirect: "manual"`; the body is read as a stream and cancelled past 10 MB; only image/png, image/jpeg, image/webp are accepted; 204 → `empty`; non-2xx → `error` with status; `content-type` not starting with `image/` → `error`; body over 10 MB (check `content-length` first, then the byte length) → `error`; `export function cardUrl(env, kind: 'weekly'|'eod'|'midday', params: Record<string,string>)` builds `${env.CARDS_URL || 'https://rogue-origin-cards.roguefamilyfarms.workers.dev'}/${kind}?${query}`.

Commit `feat(telegram): fetchCard with bearer-for-our-host and size guards`.

---

### Task B3: `telegram_send_photo` tool

**Files:**
- Modify: `src/mcp.ts` → register after `telegram_send_markdown`:

```ts
this.server.registerTool(
  "telegram_send_photo",
  {
    title: "Send Telegram Photo",
    description:
      "Send an image to the farm Telegram chat from a URL. Fetches the image server-side (adds the ops password only for the production cards worker, so cards render with costs) and uploads it. Production cards: " +
      "https://rogue-origin-cards.roguefamilyfarms.workers.dev/weekly?week=2026-W42 · /eod?date=YYYY-MM-DD · /midday?date=YYYY-MM-DD (date defaults to today Pacific). " +
      "Returns 'No card for that period' when the line did not run.",
    inputSchema: { url: z.string().url().max(500), caption: z.string().max(1024).optional() },
  },
  async ({ url, caption }) => {
    const card = await fetchCard(url, this.env);
    if (card.status === "empty") return { content: [{ type: "text" as const, text: "No card for that period (no production logged)." }] };
    if (card.status === "error") return { content: [{ type: "text" as const, text: `Could not fetch image: ${card.message}` }] };
    const r = await sendPhoto(this.env, card.bytes, { caption, contentType: card.contentType });
    return { content: [{ type: "text" as const, text: r.ok ? "Photo sent." : `Telegram rejected the photo: ${r.error}` }] };
  }
);
```

- Test: `test/send-photo-tool.test.ts` — the agent class is a Durable Object; test the handler logic by extracting it into `src/send-photo.ts` → `export async function sendPhotoFromUrl(env, url, caption, deps = { fetchCard, sendPhoto })` and have the tool call that. Tests: empty → the "No card" text and `sendPhoto` never called; error → message; ok → "Photo sent."

Commit `feat(telegram): telegram_send_photo tool`.

---

### Task B4: midday / EOD crons

**Files:**
- Modify: `wrangler.jsonc` → add `"triggers": { "crons": ["35 19 * * MON-FRI", "35 20 * * MON-FRI", "5 0 * * TUE-SAT", "5 1 * * TUE-SAT"] }` (Cloudflare numbers weekdays 1 = Sunday … 7 = Saturday, so numeric `1-5` would be Sun–Thu; use names) and `"vars": { "CARDS_URL": "https://rogue-origin-cards.roguefamilyfarms.workers.dev" }` (merge with existing vars if any).
- Create: `src/scheduled.ts` → `export function pickCard(nowUtc: Date): { kind: 'midday'|'eod'; date: string } | null` — Pacific wall clock via `Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false, weekday: 'short' })` plus the `en-CA` date trick: returns `midday` when the Pacific hour is 12 and weekday Mon–Fri, `eod` when the hour is 17 and weekday Mon–Fri, else `null`. `export async function runScheduled(env, nowUtc, deps)` → `pickCard` → `fetchCard(cardUrl(env, kind, { date }))` → empty → log + return; ok → `sendPhoto` with caption `Midday · <Weekday Mon D>` / `End of day · <Weekday Mon D>`.
- Modify: `src/index.ts` → `export default { fetch: …existing…, async scheduled(event, env, ctx) { ctx.waitUntil(runScheduled(env, new Date(event.scheduledTime))); } }`.
- Test: `test/scheduled.test.ts`: `pickCard(new Date('2026-10-20T19:35:00Z'))` → midday 2026-10-20 (PDT); `pickCard(new Date('2026-11-03T20:35:00Z'))` → midday 2026-11-03 (PST, the other cron fires); `pickCard(new Date('2026-11-03T19:35:00Z'))` → null; `pickCard(new Date('2026-10-21T00:05:00Z'))` → eod 2026-10-20; Saturday → null; `runScheduled` with a fake fetchCard returning empty never calls sendPhoto; ok path sends once with the right caption.

Commit `feat(telegram): midday and end-of-day card crons with a Pacific-hour guard`.

---

### Task B5: Verify, deploy the bridge, push, PR

**Step 1:** `npm test` all green, `npx tsc --noEmit` clean.
**Step 2:** Deploy only outside active tagging hours and only after Koa's go-ahead in chat: `npm run deploy`. Then from this session call the farm-bridge tool `telegram_send_photo` with `https://rogue-origin-cards.roguefamilyfarms.workers.dev/eod?date=2026-10-16` and caption "End of day card test" → "Photo sent." and Koa sees it on the phone with costs unlocked.
**Step 3:** Push `feat/telegram-send-photo`, open PR "feat: telegram_send_photo tool + midday/EOD card crons". The PR body states the four cron lines, that CARDS_URL is a var not a secret, and that no new secrets are needed.

---

## Part C — wiring and wiki (after both PRs)

- Routine prompt (Koa approves the RemoteTrigger update): Step 3 gains the `telegram_send_photo` call for `/weekly?week=<YEAR>-W<WEEK_NUM>` after the text message.
- Wiki (`C:\Users\Koasm\Documents\RogueFamilyFarms`): `operations/second-brain-architecture.md` and `operations/bot-server.md` get the cards worker, the tool and the crons; `log.md` lines; journal entry.
- Proposed follow-up (own card): remove the plaintext bot token from the routine prompt now that the bridge sends photos and text.
