# Ops Hub v3 — design

Date: 2026-09-01. Replaces `src/pages/index.html` (the "Operations Hub" dashboard).

## Subject and job

The hub is the foreman's view of the trim line at Rogue Origin. Its audience is
Koa and the floor leads, on a laptop in the office, a tablet in the barn, or a
phone in the field. Its one job: answer **"how is the line doing right now,
what is in the pipe, and what needs my attention"** in ten seconds, then let
the reader dig into the trend without leaving the page.

## What was wrong with v2

- Three widgets (Supply Kanban, Live Scoreboard, Trimmer Productivity) never
  populated — no JS wrote to their DOM. SOP card was hardcoded literals.
- The Muuri drag grid rendered the KPI row as one tiny card and used half the
  viewport width at 1440px.
- Hourly `notes` (crew changes, QC remarks) were fetched and never shown.
- The AI chat 401'd unless the user had unlocked on a different page; the
  model dropdown was decorative; thumbs posted to an action that does not
  exist; TTS omitted its Authorization header.
- A 700-line briefing engine was never imported. Tour/help buttons were stubs.
- Five charts, each a full-width card, for one day's data. Ten screens of
  scrolling for a single day.

## Decisions

1. **Fixed, opinionated layout** in CSS grid, ordered by how often each answer
   is needed. No drag-to-reorder. Sections collapse and the state persists.
   Reversible later, but the old grid was the source of the broken layouts.
2. **Hand-drawn SVG charts** — no Chart.js, Muuri, or Phosphor CDNs. Every
   chart has hover tooltips and a table twin (the Daily table + CSV export).
3. **Series colors follow the dataviz validator.** Tops is the point, so tops
   wears the chart green and smalls wears a neutral gray (emphasis form);
   green-vs-gold fails the red-green CVD check. Target is a gold hairline.
   Status colors (danger / warning / success) always ship with an icon and a
   label.
4. **Type**: DM Serif Display italic for the greeting and section titles,
   Outfit for UI, JetBrains Mono for every numeral. Same three faces as the
   sibling apps.
5. **Signature element: the Shift Ledger.** One column per hour of the shift,
   tops as a column, smalls as a gray column beside it, the rate marker
   against a target hairline, crew count on the baseline, and a flag on any
   hour that carries a note. The current hour is highlighted. On a multi-day
   range the same ledger becomes one column per day.
6. **Deltas replace Compare mode.** Every period figure shows its change
   against the equivalent prior period (yesterday, previous 7 days, previous
   30 days), fetched alongside the main range.
7. **Apps launcher, not iframes.** The sidebar links straight to each app.

## Sections, in order

| Section | Answers | Data |
|---|---|---|
| Right now | tops so far vs target, pace and projected finish, rate vs target, crew on line, last bag, bags today, streak | `production?action=dashboard`, `production?action=scoreboard` (timer, streak) |
| This shift | hour-by-hour ledger with notes | `dashboard.hourly` (or `dashboard.daily` for ranges) |
| In the pipe | order blocks with % done and finish date; committed vs finished shortfalls; finished tops projected from sacks on hand | `wholesale?action=getQueueBrief`, `wholesale?action=getCoverage`, `supersack?action=tops_remaining` |
| Watchlist | open complaints, open reorder requests, reorder cart items, supersack data anomalies | `complaints?action=stats`, `kanban?action=getReorderRequests&status=open`, `kanban?action=getCart`, `supersack-qa` |
| Last N days | daily tops/smalls columns vs target; daily rate with 7-day average | `dashboard.daily` |
| Cultivars | last 7 days per cultivar: lbs, tops share, rate, $/lb tops, days | `dashboard.strainSnapshot` |
| Cost and labor | labor $, operator hours, $/lb blended, tops, smalls; period totals | `dashboard.today` / `dashboard.daily` |
| Daily table | every day in range, CSV export | `dashboard.daily` |

Before the first hour is logged, Right now shows yesterday's recap
(`production?action=morningReport`).

## Range and refresh

Today (default), Yesterday, 7 days, 30 days, custom. Today refreshes the
production data every 30 s and the pipe/watchlist every 5 min; other ranges
refresh on demand. A stale render is held at reduced opacity while a refetch
runs — no skeleton flash.

## Auth

Password lives in `localStorage.ro_api_password` (shared with Wholesale and
Consignment) and is sent as `Authorization: Bearer`. The hub gets its own
unlock dialog, which validates via `orders?action=validatePassword`. Chat and
TTS both send the header.

## Ask the line (AI chat)

Kept, as a drawer: text input, browser speech-to-text, optional spoken reply.
Model selector and feedback buttons removed (neither did anything).

## Files

- `src/pages/index.html` — rewritten.
- `src/css/hub.css` — new; consumes `shared-base.css` tokens.
- `src/js/hub/` — `main.js`, `api.js`, `range.js`, `format.js`, `svg.js`,
  `ledger.js`, `sections.js`, `chat.js`, `auth.js`.
- Old `src/js/modules/`, `src/css/dashboard.css`, `src/css/ai-chat.css`,
  `src/js/shared/api-cache.js` become dead once the page ships; removed in a
  separate commit so the diff stays reviewable.
- `sw.js` `CACHE_VERSION` bumped. `npm run stamp` restamps the import map.

## Out of scope

Harvest board (auth-gated), consignment activity, irrigation, per-hour
`qcNotes` from `getProduction` (the `notes` field on `hourly[]` covers the
crew-change text; QC remarks can be added once the endpoint is public and
cheap).
