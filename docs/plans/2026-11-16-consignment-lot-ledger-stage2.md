# Consignment Lot Ledger, Stage 2 (Paper Sheet + Photo Upload) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Staff can print a paper sheet, fill it by hand at the dock or the screening table, photograph it, and have the numbers read into the existing consignment screens for a person to check and save.

**Architecture:** Two printable letter-size sheets rendered by the consign page itself (print CSS, vendored QR generator). One new worker action, `readSheet`, sends a downscaled photo to the Claude API and returns numbers; it never writes to the database. The browser puts the returned numbers into the existing dropoff form, or into a new multi-lot screening review, and saving goes through the stage 1 actions unchanged.

**Tech Stack:** Same as stage 1 (Workers + D1, no-build ES modules, `node:test` + `node:sqlite`, Playwright). New: Claude Messages API with an image block, called from the worker with the existing `ANTHROPIC_API_KEY` secret.

**Design:** `docs/plans/2026-11-16-consignment-lot-ledger-design.md` section 10. **Stage 1 plan** (conventions, rules, API contract): `docs/plans/2026-11-16-consignment-lot-ledger-stage1.md`. Read both first.

**Worktree:** `C:\Users\Koasm\Desktop\Dev\roa-consignment`, branch `feat/consign-paper-photo` (cut from master after the colour change, PR #188).

---

## What exists already (read before writing anything)

- Stage 1 is live: `src/pages/consign.html`, `src/js/consign/*` (`main.js` routes, `views/dropoff.js`, `views/screen.js`, `save.js` `submit()`, `api.js` `call()`), `workers/src/handlers/consign-d1.js`, `workers/src/lib/consign-ledger.js`, `tests/consign*.test.mjs`, `tests/consign.spec.js`.
- **There is no photo-reading code in this repo.** Design section 10 says "reuses the crew board photo pipeline"; that pipeline does not exist here (crew sheets are read outside the app). `readSheet` is new.
- Claude API calls to copy the shape from (text only): `workers/src/handlers/sop-d1.js` `webImport()` and `workers/src/handlers/production/chat.js`. Both use raw `fetch` to `https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version`.
- Client-side image downscale: `compressImageToBlob()` in `src/pages/sop-manager.html` (FileReader → canvas → JPEG). Inputs with `accept="image/*" capture="environment"` are there too.
- QR in the browser: `src/js/vendor/qrcode-generator.js`, loaded as a plain script in `tag-desk.html`, used in `src/js/tag-desk/render.js` (`window.qrcode(0, 'M')` → `createSvgTag`). Do **not** copy the `api.qrserver.com` pattern from `sop-manager.html` or `kanban.html`.
- Print: `src/css/tag-desk.css` (`#printArea`, `@page { size: letter }`, `print-color-adjust: exact`) and `printCards()` in `src/js/tag-desk/render.js` (fill print area, wait for images, `window.print()`, clean up on `afterprint`).
- Fetch stub pattern for tests: `workers/test/battery.test.mjs` (swap `globalThis.fetch`, restore in `finally`).
- `saveDropoff` already accepts `source: 'paper'`; the dropoff view does not send it yet.

## Rules (in addition to every stage 1 rule)

- No farm names, buyer names or real prices in the repo. Fixtures use `Farm A`, `Alpha`, `Beta`.
- Do not push, deploy, or call the real Claude API from tests. Stop at ready-to-ship.
- **`readSheet` never writes.** No insert, update or history row. A test pins this.
- **The photo is not stored** anywhere (not R2, not D1, not logs). `media-r2.js` serves files publicly, so it must not be used. Do not log the image or the model's raw reply.
- Nothing read from a photo is saved without a person pressing Save on a screen that shows every number.
- The colours are now black, white and one green (`src/css/consign.css` top block). New UI uses the same variables. An "unsure" number is marked with the red attention colour plus a word, never colour alone.
- Before writing the Claude API call, load the `claude-api` skill and follow it for the request shape (image content block, model id, structured output). Default model `claude-sonnet-5-5`, overridable with the D1 config key `consign.sheet_model` if a shared `getConfig` helper is importable; otherwise a module constant.
- A secret-scan note: new `localStorage` key names can trip gitleaks. Do not add new storage keys in this stage. Do not edit `.gitleaks.toml`.

---

## The two sheets

Both are US letter, portrait, black on white, bilingual on the same sheet (English label with the Spanish under it in smaller type), boxes large enough for handwriting (row height at least 0.42 in). Each has a title, a QR code top right, and a short code line under the QR that the reader can also pick up.

**Sheet A, Dropoff** (`#/print/dropoff` or `#/print/dropoff/<farmId>`)

- Header fields: Farm, Date, Dropped by.
- Table, 12 rows: Cultivar | Tops lb | Smalls lb | Note. With a farm chosen, the farm name is printed and that farm's priced cultivars are pre-printed in the first rows (rest blank). Without a farm, all blank.
- Footer: Dropoff note (two lines). A one-line instruction: "Leave a box empty if it was not weighed. Cross out a row that was not brought."
- **No prices on the sheet.**
- QR target: the page URL with `#/photo/dropoff` (plus `/<farmId>` when printed for a farm). Code line: `DROP` or `DROP-F<farmId>`.
- More than 12 priced cultivars: continue on a second page with the header repeated.

**Sheet B, Screening** (`#/print/screen/<dropoffId>`)

- Header: farm name, dropoff date, dropped by (printed).
- One row per open lot of that dropoff (not voided, not closed, weighed): Cultivar | Type | Before lb (printed; "left to screen" when partly screened) | Pulled | Final | To smalls (greyed out and unused on smalls rows) | Biomass | Mold | Finished ☐.
- Lots not yet weighed are listed at the bottom as "weigh first", with no boxes.
- QR target: `#/photo/screen/<dropoffId>`. Code line: `SCREEN-D<dropoffId>`.
- More than 10 lots: second page, header repeated.

---

## Task 0: Baseline

`npm ci` if needed, then `npm run lint`, `npm test`, `npm run stamp:check`, `npx playwright test tests/consign.spec.js --project=chromium`. Expected: all green before any change. If not, stop and report.

---

## Task 1: Pure normaliser for a sheet read

**Files:** Create `workers/src/lib/consign-sheet.js`, `tests/consign-sheet.test.mjs`.

The model's reply is untrusted text. One pure function turns it into safe, bounded data; everything downstream trusts only its output.

```js
/**
 * normalizeSheetRead(kind, raw, ctx) -> { kind, farm_id, dropped_by, note, date, rows, warnings }
 *   kind: 'dropoff' | 'screen'
 *   raw:  whatever JSON.parse gave back from the model (may be anything)
 *   ctx:  { farms: [{id, name}], cultivars: [string], lots: [{id, cultivar, type, intake_lbs, remainder_lbs}] }
 */
```

Rules to implement and test (write each test first):

1. Non-object `raw`, or missing `rows` array → `{ rows: [], warnings: ['unreadable'] }`. Never throws.
2. A weight is kept only if it is a finite number, `> 0` and `<= 5000`; it is rounded to one decimal. Anything else becomes `null` with `unsure: true`. Strings like `"100"` and `"100.5 lb"` are parsed; `"1OO"` is not.
3. Each number field is returned as `{ value, unsure }`. `unsure` is true when the model said so, when the value was dropped by rule 2, or when the text was not purely numeric.
4. Dropoff rows: `{ cultivar, cultivar_known, tops: {value, unsure, on}, smalls: {value, unsure, on}, note }`. `cultivar` is trimmed and capped at 60 characters; a case-insensitive match against `ctx.cultivars` replaces it with the known spelling and sets `cultivar_known: true`. `on` is true when the box had a weight or the model marked the box as ticked-but-empty ("not weighed yet"). Rows with no cultivar and no numbers are dropped. At most 30 rows.
5. Dropoff farm: matched to `ctx.farms` by exact case-insensitive name, else by a `DROP-F<id>` code the model read; otherwise `farm_id: null` (the person picks).
6. Screen rows: only lots in `ctx.lots` are returned, matched by the printed order index or by cultivar + type; unknown rows are dropped with a warning. Each: `{ lot_id, pulled, final, to_smalls, biomass, mold, finishes: {value: bool, unsure} }`. `to_smalls` is forced to 0 on a smalls lot.
7. Free text (`note`, `dropped_by`) is trimmed, stripped of control characters and capped at 300 characters.
8. The function output never contains a key it did not define (no pass-through of model keys).

Run `node --test tests/consign-sheet.test.mjs`; commit `feat(consign): normalise an AI sheet read into bounded data`.

---

## Task 2: `readSheet` worker action

**Files:** Modify `workers/src/handlers/consign-d1.js`; create `workers/src/lib/consign-sheet-prompt.js`; modify `tests/consign-handler.test.mjs` (or a new `tests/consign-readsheet.test.mjs` with the same helpers).

Request (shared password, like every action):
`{ kind: 'dropoff'|'screen', image_b64, media_type: 'image/jpeg'|'image/png'|'image/webp', farm_id?, dropoff_id? }`

Behaviour:

1. Validate: `kind`; `media_type` in the list; `image_b64` is base64 and decodes to at most 4 MB (check the string length before decoding: `length * 3 / 4`); `screen` requires an existing, non-voided `dropoff_id`. Errors are `VALIDATION_ERROR` with a plain message.
2. If `env.ANTHROPIC_API_KEY` is missing → `INTERNAL_ERROR` "Sheet reading is not set up".
3. Build `ctx`: active farms (id, name); for `dropoff` with a farm, that farm's priced cultivars; for `screen`, the dropoff's open lots via the existing `loadLots`.
4. Call the Claude API once with the image and a prompt from `consign-sheet-prompt.js` (two exported builders, `dropoffPrompt(ctx)` and `screenPrompt(ctx)`). The prompt states the sheet layout, lists the known farm and cultivar names or the lot rows in printed order, asks for JSON only in the schema Task 1 expects, and tells the model to return `null` plus `unsure: true` for any box it cannot read confidently and to never guess a digit. Use structured output as the `claude-api` skill describes for the chosen model; keep the `JSON.parse` + regex fallback from `webImport()`.
5. Timeouts and failures: abort after 25 s; a non-200 from the API or unparsable output → `INTERNAL_ERROR` "Could not read the sheet. Enter the numbers by hand." Do not include the upstream error body in the response.
6. Return `{ read: normalizeSheetRead(kind, parsed, ctx) }`.

Tests (stub `globalThis.fetch`; no real API):

- Happy path for each kind: the stub returns a model reply; the handler returns normalised rows. Assert the outgoing request has one image block with the given media type, the right model id, and that the system/user text contains the cultivar names from the database.
- **No writes:** snapshot `SELECT COUNT(*)` for all eight `cl_` tables before and after; identical.
- Auth required; oversize image refused before any fetch (assert the stub was not called); bad media type refused; `screen` with an unknown or voided dropoff refused.
- Missing API key → the "not set up" error, no fetch.
- Upstream 500, upstream garbage text, and a fetch that never resolves (use a stub that rejects on `AbortSignal`) → the friendly error, and the response body does not contain the upstream text.
- The prompt builders are pure: given `ctx`, the output contains every name and nothing from another farm.

Commit `feat(consign): readSheet action reads a sheet photo, never writes`.

---

## Task 3: Printable sheets

**Files:** Create `src/js/consign/views/print.js`, `src/js/consign/sheets.js` (pure HTML builders for Sheet A and B, so they can be unit-tested), `tests/consign-sheets.test.mjs`. Modify `src/js/consign/main.js` (routes `print/dropoff(/<farmId>)?`, `print/screen/<dropoffId>`), `src/pages/consign.html` (a `#printArea` element; the vendored QR script tag exactly as `tag-desk.html` loads it), `src/css/consign.css` (sheet + print rules), `src/js/consign/labels.js`, and the views that link to print: Home (a "Print dropoff sheet" button), dropoff farm step ("Print a sheet for this farm"), farm page dropoff cards ("Print screening sheet").

- `sheets.js` exports `dropoffSheet({ farm, cultivars, qrSvg, code })` and `screenSheet({ dropoff, lots, qrSvg, code })`, returning HTML strings; pagination (12 dropoff rows, 10 screening rows per page) lives here. All text goes through the existing escape helper.
- Unit tests: 0, 1, 12 and 13 cultivars (one page, one page, one page, two pages with a repeated header); 1, 10 and 11 lots; a smalls row has no "to smalls" box; unweighed lots land in "weigh first"; no price appears anywhere in either sheet's HTML; names with `<` are escaped.
- The print view shows an on-screen preview of the sheet(s) at reduced scale and a large Print button; printing follows `printCards()` (fill `#printArea`, `window.print()`, clean up on `afterprint`).
- Print CSS: `@page { size: letter; margin: 0.4in; }`, hide everything except `#printArea`, `print-color-adjust: exact` on anything shaded, `break-inside: avoid` on rows, `break-after: page` between pages, table borders in solid black at 1pt or more.
- The QR must be an inline SVG from the vendored generator, at least 1 in square on paper.

Commit `feat(consign): printable dropoff and screening sheets with QR`.

---

## Task 4: Photo capture and upload

**Files:** Create `src/js/consign/photo.js` (pick + downscale + call), `src/js/consign/views/photo.js`. Modify `main.js` (routes `photo/dropoff(/<farmId>)?`, `photo/screen/<dropoffId>`), `labels.js`, `consign.css`, Home (a "Photo of a sheet" button beside New dropoff), the dropoff view (a "Fill from a photo" button on step 1), and the screening entry points.

- Two large buttons: **Take photo** (`capture="environment"`) and **Choose photo**.
- Downscale in the browser to a 2000 px long edge, JPEG quality 0.85 (port `compressImageToBlob`; handwriting needs more pixels than a thumbnail). Convert to base64 and call `readSheet`. Show the photo and a "Reading the sheet…" state; the request can take 10 to 20 seconds.
- Failure of any kind (no signal, server error, unreadable) shows the server's message and one clear way forward: "Enter by hand" opens the normal form. A photo read is never put in the held queue.
- `photo.js` must not keep the image after the read resolves (release object URLs).

Commit `feat(consign): photo capture and sheet read`.

---

## Task 5: Dropoff prefill from a read

**Files:** Modify `src/js/consign/views/dropoff.js` (accept a prefill), `views/photo.js`.

- After a dropoff read, open the dropoff form with: farm selected when `farm_id` came back (otherwise the farm step, with the read kept), one row per read row, boxes ticked per `on`, weights filled, notes filled, dropped-by filled when the read has it.
- A banner at the top: "Filled from a photo. Check every number before saving." It stays until Save.
- Every `unsure` box, and every cultivar with `cultivar_known: false`, is outlined in the attention colour with the word "Check" beside it; the mark clears when the person edits or taps "OK" on that box. **Save is disabled while any box is still marked.**
- The saved body carries `source: 'paper'`. Terms default to the farm default as usual; splits are done by hand.
- Everything else (summary step, held queue on no signal, validation messages) is the stage 1 behaviour, untouched.

Commit `feat(consign): prefill the dropoff form from a sheet photo`.

---

## Task 6: Screening review for a whole dropoff

**Files:** Create `src/js/consign/views/screen-review.js`. Modify `main.js`, `labels.js`, `consign.css`.

- After a screening read, show one card per lot in printed order: cultivar, type, Before, then editable boxes for Pulled, Final, To smalls (tops only), Biomass, Mold, a Finished tick, and the same live "Adds up / Off by X lb" bar as the single screening screen (reuse its check function; do not write a third copy of the tolerance rule).
- Lots the sheet left blank are shown collapsed as "not screened" and are skipped.
- Unsure boxes are marked as in Task 5. **Save all** is disabled while any card is marked or does not add up.
- Save all calls `saveScreenRun` once per filled lot, in order, each with its own `client_key` made when the review opened. Progress is shown per card (saving, saved, refused with the server's reason). A refusal on one lot does not stop the others; refused cards stay editable with their own Save. A network failure hands the remaining lots to the held queue through the existing `submit()`.

Commit `feat(consign): review and save screening numbers for a whole dropoff from one photo`.

---

## Task 7: Browser spec

**Files:** Modify `tests/consign.spec.js` (or add `tests/consign-paper.spec.js` with the same context-level guards; `*.workers.dev` blocked at the context level, `readSheet` answered by the in-memory fake, never the real API).

1. **Print sheet A** for a farm with 3 priced cultivars: `page.emulateMedia({ media: 'print' })`, the print area is the only visible content, the QR `svg` exists, no `$` appears in the sheet, and `page.pdf({ format: 'Letter' })` yields exactly 1 page. With 13 cultivars: 2 pages.
2. **Print sheet B** for a dropoff with 11 open lots: 2 pages; a smalls row has no to-smalls box.
3. **Photo → dropoff:** upload a fixture image (`setInputFiles` with a tiny generated JPEG); the fake `readSheet` returns two rows with one unsure weight and one unknown cultivar. The form is prefilled, Save is disabled, both marks show the word "Check"; after confirming both, Save posts a body with `source: 'paper'` and the edited values.
4. **Photo → screening review:** three lots, one left blank, one off by 3 lb. Save all is disabled until the off lot is fixed; then exactly two `saveScreenRun` calls go out with distinct `client_key`s and `finishes_lot` as ticked.
5. **Read fails:** the fake returns the friendly error; the page shows it with "Enter by hand", and no save request is made.
6. The uploaded image posted to `readSheet` is at most 2000 px on its long edge (decode the posted base64 in the test) and under 4 MB.
7. Screenshots (375 and 1024, EN and ES) of: sheet A preview, sheet B preview, prefilled dropoff with marks, screening review. Save PDFs of both sheets into `test-results/consign-shots/`.

Commit `test(consign): browser spec for sheets, photo read and review`.

---

## Task 8: Ready-to-ship gate

1. `npm run lint`, `npm test`, `npm run stamp:check`, and the Playwright specs: all green.
2. `cd workers && npm run deploy -- --dry-run` lists `env.DB`. Do not deploy.
3. Diff check against `origin/master`: no real names or prices, no image data or fixtures larger than 50 KB, no new storage keys, `.gitleaks.toml` untouched.
4. superpowers:requesting-code-review on the branch diff, with two extra lenses: (a) can any path save numbers from a photo without a person confirming; (b) can `readSheet` be made to write, leak another farm's names into a prompt, or echo upstream errors. Fix findings; re-run step 1.
5. Stop. Report to the hub: branch, commits, test counts, deviations from this plan, the screenshots and the two sheet PDFs. Do not push.

## Ship (hub only, on Koa's yes)

Push, PR, CI, merge, `cd workers && npm run deploy` (no migration in this stage; the `ANTHROPIC_API_KEY` secret already exists). Then Koa prints both sheets, fills them by hand, photographs them and checks the read against the paper; accuracy on real handwriting is not proven until that trial.

## Left out on purpose

- Storing the photo.
- Reading a sheet that was not printed from the app.
- Splitting a line across terms on paper (done on the form).
- Payments on paper.
