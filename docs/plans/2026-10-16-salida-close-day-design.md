# Cerrar día on /salida — end-of-day weights in the scan-out app

Design, 2026-10-16. Decided with Koa in brainstorming. Builds on
`2026-10-06-sack-scan-out-design.md` (the scan-out screen) and replaces its §8
(end of day) for 2026 strains.

## 1. What this is for

The only end-of-day numbers that exist nowhere else are **Biomass #2** and
**Premium #1 Trim**. Sack counts already come from the day's scans; tops and
smalls are already typed hourly on the production sheet, and the wholesale
queue burns orders down from those hourly entries. Today the floor opens a
second app (`supersack-entry.html`) at 4:20 PM and retypes tops and smalls
alongside the two weights. Yesterday's retyped tops (123.0) matched the hourly
total exactly, so the retype adds nothing but a second number that can drift.

After this change the water spider closes the day on the same `/salida` screen
he scanned on: two boxes, one button.

## 2. Decisions locked (Koa, 2026-10-16)

| # | Decision |
|---|----------|
| 1 | Bio and trim are weighed **once at end of day, in one batch** — not per bag. |
| 2 | The `/salida` step **replaces** the supersack entry form for 2026+ strains. The form stays for 2025 strains only. |
| 3 | On a day with more than one cultivar, the crew weighs **one pile**; the app **splits by sacks scanned per cultivar**. No per-cultivar boxes. |
| 4 | Tops and smalls come from the **hourly log**, read-only. Nothing about them is typed at end of day. |
| 5 | Approach A: a panel on `/salida`, phone and desktop. No new screen. |

## 3. The panel

Under today's list, a block headed **Cerrar día / Close day**:

```
Cerrar día · jueves 16 oct
  Sour Lifter · 1er corte     22 sacos   tops 123.0   smalls 110   (del registro por hora)
  Biomass #2   [ 330 ] lbs
  Premium #1   [  50 ] lbs
  [ CERRAR DÍA ]
```

- One read-only line per (season, cultivar, cut, harvest type) scanned today:
  sack count from the scans; tops and smalls summed from the hourly entries for
  that date and cultivar. If two cuts of one cultivar were scanned, the pounds
  sit on the first cut and the second shows "(libras en 1er corte)", exactly
  as the form does today.
- Two number boxes, 56 px targets, `inputmode=decimal`. Premium #1 greater
  than Biomass #2 is refused on the client with the same message the API uses
  ("check which box is which"), before anything is sent.
- Hidden until at least one 2026 sack has been scanned that day. With no
  scans there is nothing to close here; 2025 days keep using the form.
- Spanish first, existing toggle, same strings table as the rest of `/salida`.
- The desk computer sees it in the right column under the list. The phone
  scrolls to it.

**After submit** the panel turns into the day's yield, the same lines the form
shows now (`day_yield`): per group, sacks, tops, smalls, bio, trim per sack,
plus any mismatch between sacks scanned and the hourly log. A second submit
the same day overwrites the same rows and is how a weight gets corrected.

**Late hourly entries.** The weigh often happens before the 4 PM hour is
logged. The panel shows the hourly total as of now, says "4 horas registradas"
next to it, and the nightly allocation cron replays the day, so the row picks
up the last hour on its own. Reopening the panel later and pressing the button
again does the same thing immediately.

## 4. Data flow

New action **`sack_out_close_day`** in `harvest-sack-out.js` (POST, same
`SACK_OUT_ACTIONS` gate, same test-mode refusal as `sack_out`).

Input: `{ date, biomass_lbs, trim_lbs }`. Date defaults to the Pacific day.

1. **Groups.** The 2026+ sacks opened that day, grouped by
   (season, cultivar, cut, harvest type) — the same grouping `handleAllocate`
   uses, so every row we write has bags to land on.
2. **Hourly pounds.** Tops and smalls from `monthly_production` for that date,
   per cultivar id through `cultivar_aliases` (the same join `computeQueue`
   uses). Matched to groups through `cultivarIdsFor`. Pounds go on the first
   cut of a cultivar; later cuts get 0.
3. **Split.** `biomass_lbs` and `trim_lbs` are shared across groups in
   proportion to sacks scanned (`sacks / totalSacks`), the rule the form's
   day-total path already applies.
4. **Write.** One `supersack_entries` row per group, keyed on
   (date, `variantTitle(season, cultivar, harvestType, cut)`), through the
   same upsert `supersack-d1.js` uses: sacks, tops, smalls, bio, trim,
   `raw = sacks × fullSackLbs(season)`, waste as the remainder. The
   premium-vs-biomass check runs server-side on the stored values, as now.
   **No Shopify write.** The scans already took the sacks out.
5. **Yield.** Call the existing `day_yield` path (which runs `handleAllocate`
   for the date and reports mismatches) and return its payload.

Output: `{ date, rows: [...written], yield: <day_yield payload> }`.

Also new, GET **`sack_out_close_day_preview`** (or a field on
`sack_out_today`): the groups with their hourly tops and smalls and the
hours-logged count, so the panel can render before anything is typed. Adding
it to `sack_out_today` is simpler and keeps one poll; prefer that unless the
payload gets heavy.

## 5. The form

`supersack-entry.html`, for a 2026+ strain row: no inputs. The row reads
"Se cierra en /salida" with a link, and shows the saved values if a row exists
for that date. Submit skips those rows entirely. The 2025 path is untouched.
This removes the form's scan-count, no-scans warning and day-yield code for
2026 rows; it stays for nothing else, so delete rather than hide.

## 6. What this leaves out

- Per-bag weighing during the day (decision 1).
- Per-cultivar weight boxes on multi-cultivar days (decision 3). If the floor
  starts keeping piles apart by cultivar, add boxes per group then.
- Editing tops or smalls at end of day. That is the hourly log's job; fix it
  there.
- Waste as a typed number. It stays the remainder.

## 7. Risks

- **Hourly log not yet mapped.** A 2026 strain title on the production sheet
  with no `cultivar_aliases` row sums to 0 tops here, as it already does in
  the queue (see memory: cultivar-alias-cut-titles). The panel shows "0 tops
  (sin alias)" in red rather than silently writing 0.
- **Weighed before the last hour is logged.** Handled by the cron replay and
  by re-submit; the panel says how many hours it is reading.
- **Two cuts, one pile of tops.** Same limitation the form has today; the
  pounds land on the first cut.

## 8. Build plan

1. Server: `sack_out_today` gains `close_day` (groups, hourly tops/smalls,
   hours logged, existing row if any). Tests in `harvest-salida.test.mjs`.
2. Server: `sack_out_close_day` — groups, split, upsert, `day_yield`,
   premium-vs-biomass refusal, test-mode refusal. Tests: single cultivar; two
   cultivars split by sacks; two cuts pounds-on-first; no 2026 scans → refused;
   trim > bio → refused; re-submit overwrites.
3. Client: the panel in `harvest-salida-client.js` and strings in
   `harvest-salida-strings.js`, EN + ES. Yield view after submit.
4. Form: 2026 rows become read-only pointers; remove the 2026-only code.
5. Deploy worker (`cd workers && npm run deploy`), push pages, verify on the
   station desktop and a phone with a real day's scans.
