# Production cards — PNG renders for Telegram (midday / end of day / weekly)

**Date:** 2026-10-19 · **Status:** design approved by Koa (three mock renders signed off), build starting · **Repos:** rogue-origin-apps (`cards/` worker), telegram-claude-bot (`telegram_send_photo` tool + cron)

## Problem

The Monday digest arrives as a wall of Telegram text. Koa wants a picture: "a png render or something with more visuals / important numbers", for three cadences — a midday check, an end-of-day close, and the weekly retrospective. Nothing in the stack renders images for Telegram today: the harvest daily update needs a local Chromium, the Telegram bridge has text senders only, and the API worker has no image library.

## Decisions (from the 2026-10-19 brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Where the card renders | **A separate worker, `rogue-origin-cards`**, in `cards/` of this repo | Satori + resvg add ~2 MB of wasm; keep it off the API bundle and the free-plan size limit; deploys on its own; anyone (routine, Timber, Hub) can pull a card |
| Rendering stack | **satori → SVG → resvg-wasm → PNG**, no browser | Works in Workers and in Node for tests; the cloud routine box has no Chromium |
| Data | The existing API only: `?action=dashboard`, `?action=scoreboard&date=`, `/api/supersack?action=summary` | No new definitions; the card can never drift from the dashboard the way the digest did |
| Cost lock | **Pass-through bearer.** The card worker forwards the request's `Authorization` header to the API and holds no password | Same rule as the API: no bearer → cost tiles render "locked"; the worker never leaks money |
| Target line | Per-day / per-hour **crew-adjusted target = trimmers × cultivar target rate × slot multiplier**, exactly the scoreboard's method (all-time cultivar average rate) | Card and TV agree; Koa's 7-day-window question stays open — if he picks it, the scoreboard changes and the card follows for free |
| Crew number | "Line crew" = peak trimmers + buckers + T-Zero, as the API reports it today | QC and water spider are not logged yet; a separate PR stores them, and the card label flips to "crew (all roles)" when `totalCrew` changes meaning |
| Sending | **`telegram_send_photo` tool in the bridge**: fetches the image server-side (adding the bearer only for the cards worker host, never the whole workers.dev suffix: the API worker takes the same password for write actions), uploads bytes to Telegram | No token or password in any prompt; the routine and Timber both call it; lets the plaintext bot token leave the routine later |
| Midday / EOD schedule | **Cron in the bridge**, not in the card worker | The bridge is the only thing that talks to Telegram and already holds the token and password |
| Size | 1080 × 1350 (4:5 portrait) | Reads large on a phone; all three cards share one layout system |

## The three cards

All three share: eyebrow · serif title · sub line · a crew pill; three hero tiles with chips; one bar chart with dashed gold target ticks; a quiet row of three mini tiles; up to three colour-coded flags (Act / Watch / Good); a footer naming the card, the cost definition and the generation time. Hub dark tokens; Outfit for numbers, JetBrains Mono for labels, DM Serif Display italic only on the title. Approved mocks: `docs/plans/assets/2026-10-19-card-{midday,eod,weekly}.png`.

| | Midday (`/midday`) | End of day (`/eod`) | Weekly (`/weekly`) |
|---|---|---|---|
| Title / sub | weekday · "Oct 19 · Sour Lifter '26 · through 12:00" | weekday · "Oct 16 · Sour Lifter '26 · 8.5 h logged" | "Week 42" · "Oct 12–16, 2026 · Sour Lifter '26 · 4 days" |
| Pill | line crew now: T · B · TZ | line crew peak · T · B | line crew min–max · avg |
| Hero 1 | Tops so far · % of target so far | Tops · % of target | Tops · vs prior week · % of target |
| Hero 2 | Rate so far · target rate | Rate · vs prior day | Rate · vs prior week |
| Hero 3 | Projected end of day · prior day's close | $/lb tops · vs prior day | $/lb tops · vs prior week |
| Chart | tops by hour, logged slots + a dashed "now" slot at its target | tops by hour, all slots | tops by day Mon–Fri, off days as stubs |
| Mini row | smalls so far · buckers per trimmer (band 0.70–0.75) · hours logged + sacks logged | smalls + $/lb · supersacks + raw lb + tops/sack · labor + all-in | smalls + $/lb · supersacks + raw + tops/sack · labor + all-in |
| Flags | from the day's qcNotes so far, plus "no sacks logged" when the tracker is empty after 10:00 | from the day's qcNotes; best/worst hour | from the week's notes; rate trend |

Flag text is rule-based, not AI: a note containing mold/gusano/humed → Watch; "echar a perder" / spoil → Act; the best hour or rising rate → Good. Spanish notes are shown translated by a small phrase table (the words the floor uses: mold, gusanos, humedo, hoja, costal, volsa/bolsa, colgar) and otherwise verbatim.

## Architecture

```
cards/                       rogue-origin-cards worker (this repo)
  wrangler.toml              name, main, compatibility_flags global_fetch_strictly_public, [[rules]] Data **/*.ttf + CompiledWasm **/*.wasm, no bindings, no secrets
  package.json               satori 0.63.0 (standalone + layout.wasm), harfbuzzjs 0.10.0 (hb.wasm), @resvg/resvg-wasm; test = node --test test/*.test.mjs
  fonts/                     Outfit-Medium/SemiBold, JetBrainsMono-Regular, DMSerifDisplay-Italic (TTF)
  src/index.js               router: /weekly /eod /midday /health, cache, bearer pass-through, format=json
  src/data.js                fetch dashboard / scoreboard / supersack summary (+ prior period); injectable fetch
  src/model.js               PURE: API JSON → card model {title, pill, tiles[], chart{cols[], ticks}, minis[], flags[], foot}
  src/layout.js              PURE: card model → satori element tree (flex only, inline styles, px numbers)
  src/render.js              satori(tree, fonts) → svg → resvg → png; wasm + font loading abstracted for Node vs Workers
  src/fonts.js               font registry (name, weight, style, bytes loader)
  test/                      model, layout, render (real satori+resvg in Node), routes (mocked upstream)
  test/fixtures/             real API JSON captured 2026-10-19 (W42 dashboard with and without costs, scoreboards, sack summaries)

telegram-claude-bot/         bridge
  src/telegram.ts            + sendPhoto(env, bytes, {caption, filename}) multipart to sendPhoto
  src/cards.ts               fetchCard(url, env) adds the bearer only when the host equals the cards worker host, redirect: manual, streamed 10 MB cap, png/jpeg/webp only
  src/mcp.ts                 + tool telegram_send_photo({url, caption?})
  src/index.ts               + scheduled(): midday + eod crons with a Pacific-hour guard; skip when the card worker says 204
  wrangler.jsonc             + triggers.crons, + CARDS_URL var
```

**Request flow.** `GET /eod?date=2026-10-16` → parse + validate → cache lookup (key = URL + "#auth" when a bearer is present) → `data.js` fetches scoreboard(date), dashboard(date..date), dashboard(prior day), supersack summary(date) in parallel, forwarding the bearer to the dashboard calls → `model.js` builds the card model (costsLocked when the dashboard omitted cost keys) → `layout.js` → `render.js` → `image/png`, `Cache-Control: public, max-age=86400` for finished periods, `max-age=120` for today → stored in cache only when (bearer present ⇔ costs unlocked), so a wrong password can never poison the unlocked key.

**No data** (no production rows for the day / week) → `204 No Content`, so a scheduled sender has nothing to post. **Bad input** → `400` with a one-line JSON error. **Upstream failure** → `502` with the upstream status, never a half-rendered card.

**Defaults.** `/weekly` = the last complete Mon–Fri week in Pacific time. `/eod` = today in Pacific time. `/midday` = today; its "through HH:MM" is the end of the last logged slot. `format=json` returns the card model instead of the PNG, for tests and for Timber if it wants numbers.

**Workers specifics.** Wasm: `import layoutWasm from 'satori/layout.wasm'` and `import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'` (wrangler's CompiledWasm rule bundles `.wasm` as compiled modules); `init(layoutWasm)` from `satori/standalone`; `initWasm(resvgWasm)` once per isolate. Workers refuse to compile wasm from bytes at runtime ("Wasm code generation disallowed by embedder"), so only module imports work — and that is **not enough for satori ≥ 0.33**: it shapes text with HarfBuzz (harfbuzzjs 0.10, an Emscripten build) and even its standalone build carries `hb.wasm` as base64 compiled at run time, plus a 34-byte callback trampoline that Emscripten's `addFunction` compiles when hbjs starts. Without help the first render fails with `TypeError: Cannot read properties of undefined (reading 'href')` and then hangs. `src/harfbuzz-shim.js` fixes that: imported **first** in `runtime-workers.js` (before satori evaluates — no other module in the worker may import satori; `render.js` takes it as a parameter), it hands Emscripten the same two binaries precompiled by wrangler (`harfbuzzjs/hb.wasm`, pinned as a direct dependency, and `src/wasm/hb-trampoline-vi.wasm`) for exactly those two byte strings, instantiating synchronously because satori starts HarfBuzz in global scope; every other wasm call falls through untouched. `test/harfbuzz-bytes.test.mjs` pins both byte strings against the installed packages, so a satori or harfbuzzjs bump fails a test instead of hanging a request. *Why not downgrade:* satori 0.32.0 (2026-08-20) is the last release without HarfBuzz and it works in Workers with just `yoga.wasm`, but it lays out with Yoga instead of 0.63's browser-like Taffy engine; tried 2026-10-19, it broke the approved layout (equal-width tiles with no min-content sizing — the Tops chips overlap and run off the tile — dashed target ticks painted under the bars, a 16 px taller chart header that leaves 1 px under the flags), each needing an engine-specific workaround in `layout.js`. The shim is two byte-string substitutions behind a guard test; keeping 0.63 keeps the mock CSS one-to-one. CPU: rendering a 1080×1350 PNG costs far more than the 10 ms CPU of Workers Free; the account is on Workers Paid (the 2026-10-19 spike deploy returned 200 five times). Upstream: the API is a sibling worker on the same `roguefamilyfarms.workers.dev` subdomain, and Cloudflare refuses a worker-to-worker `fetch()` there (`error code: 1042`, served as a 404; `wrangler dev` does not show it because it fetches from outside), so `wrangler.toml` sets `compatibility_flags = ["global_fetch_strictly_public"]`, which routes the fetch over the public internet; a service binding would avoid the hop but needs the API running locally under `wrangler dev`. Fonts via `[[rules]] type="Data"` imports. Budget: measured 2026-10-19 at **1.93 MB gzipped** (5.2 MB raw) — resvg ≈ 0.96 MB, the worker script with satori and its inline base64 HarfBuzz ≈ 0.46 MB, layout.wasm ≈ 0.21 MB, hb.wasm ≈ 0.16 MB, fonts ≈ 0.15 MB (HarfBuzz ships twice: inline and as the precompiled module) — under the 3 MB compressed Workers limit; `npm run size` gzips the dry-run output (source map excluded, it is not uploaded) and exits 1 above 2.8 MB.

**Node test path.** The same `render.js` runs in Node with the same `satori/standalone` build, `init`ialised from `fs.readFileSync(require.resolve('satori/layout.wasm'))` (Node compiles wasm from bytes, so no shim), and resvg initialised from `fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))`; fonts read from `cards/fonts/`. So every test runs with `node --test`, no wrangler, no network.

## Sending

**Bridge tool `telegram_send_photo`** — input `{ url: https URL, caption?: ≤1024 chars }`. Fetches the URL with `Authorization: Bearer ORDERS_PASSWORD` only when the host is exactly the cards worker host (from `CARDS_URL`), with `redirect: manual` and a streamed 10 MB cap; rejects non-https, non-image responses and bodies over 10 MB; on 204 returns "No card for that period (no production logged)." without calling Telegram; otherwise posts multipart `sendPhoto` (chat_id, photo as `card.png`, caption) and returns "Photo sent." or the Telegram error text. The tool description tells Timber the three card URLs so "send me today's card" works without a prompt change.

**Routine.** Step 3 of the Weekly Digest routine (trig_01S7HyPtDWWBP7gEA2DN55F6) gains one line after the text message: `telegram_send_photo({ url: "https://rogue-origin-cards.roguefamilyfarms.workers.dev/weekly?week=<YEAR>-W<WEEK_NUM>", caption: "Week <N> card" })`. Koa updates the routine (standing config) once the worker is live.

**Crons (bridge `scheduled`).** Midday 12:35 PT and end of day 17:05 PT, Monday–Friday. Crons are UTC and Pacific shifts in November, so each slot registers two UTC crons (19:35 + 20:35, 00:05 + 01:05) and the handler sends only when the Pacific wall-clock hour matches. The handler fetches `/midday` or `/eod` for the Pacific date, skips on 204, and sends with a one-line caption.

## Error handling

- Card worker: any thrown error → 500 with a JSON `{error}`; never cache errors; upstream timeouts at 8 s per call.
- Bridge: a failed card fetch or Telegram error logs and returns the error text to the caller; the cron swallows errors after logging (never retries into a double send).
- Fonts or wasm failing to initialise is a deploy-time failure, caught by the render test and the dry-run size check.

## Testing

- `cards/test/model.test.mjs` — fixtures → model: numbers, % of target, deltas, locked costs, flags from notes, off-day columns, "now" slot, default-week math at known dates.
- `cards/test/layout.test.mjs` — every text node has a font + size, no NaN/undefined in styles, tick heights never exceed the plot, chips never exceed two per tile.
- `cards/test/render.test.mjs` — real satori + resvg in Node: PNG signature, IHDR 1080×1350, renders each of the three fixtures under 5 s, and the locked variant renders.
- `cards/test/routes.test.mjs` — the fetch handler with a mocked upstream: 200 png, 400 on a bad week/date, 204 when no rows, 502 on upstream 500, bearer forwarded only to the API host, cache keys separate for auth/no-auth, format=json returns the model.
- bridge `test/send-photo.test.ts` — multipart body carries chat_id/photo/caption; bearer only for the cards host, none for the API host or look-alikes; manual redirects; streamed 10 MB and content-type rejections; 204 → no Telegram call; scheduled guard fires at 12 PT / 17 PT only.
- Manual before PR: `wrangler dev` + curl the three routes and look at the PNGs; after deploy, send one `/eod?date=2026-10-16` through the bridge tool and confirm it renders in Telegram.

## Deployment

1. Cards worker: `cd cards && npm run deploy` (new worker, nothing depends on it). Custom route none; `*.workers.dev` URL.
2. Bridge: `npm run deploy` from the bridge repo — **not during active tagging hours**; Timber picks up the new tool immediately.
3. Routine prompt: Koa pastes the one-line tool call into Step 3 (or approves the RemoteTrigger update).
4. Wiki: `operations/second-brain-architecture.md` and `operations/bot-server.md` get the new worker, the tool and the crons; log lines.

## Out of scope / later

- QC and water spider headcount (separate PR; flips the crew label).
- Light theme, Hub embedding of the cards, a per-cultivar card, the harvest daily update moving onto this renderer.
- Removing the plaintext bot token from the routine prompt (possible once the tool sends photos and text).
