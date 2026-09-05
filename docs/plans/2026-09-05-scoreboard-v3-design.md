# Scoreboard v3 — design

Date: 2026-09-05. A sibling of `src/pages/scoreboard-v2.html`, shipped beside it.
The barn TV moves to v3 when Koa says so; v2 stays live until then.

## Why a v3 and not a redesign

A seven-lens review of v2 (56 findings, every one re-checked) split cleanly in
two. The look — one hero number in a dark room, instruments at the edges — is
right and Koa likes it. What the board *says* is not:

- Ahead/behind lives in a 14 px badge, a 10 px bar's hue and a 12%-alpha tint.
  The hero digits are cream in every state; from 20 ft a great day and a bad
  day look the same.
- The scale ring and the timer ring sit side by side and are never related.
  Nothing tells the crew "at 22:41 this bag should read 3,930 g".
- The current-hour card shows the target for the whole hour, so it cannot
  say on-track or behind until the hour is over and entered.
- The hero's "/ goal" is the target for the hours worked so far; the
  projection line uses the whole-day goal. Two goals under one label.
- TV Mode's `zoom: 0.65` makes the board smaller on the 4K panel than plain
  1080p. Caution stripes and edge glows are on most afternoons, so they
  stopped carrying information.

Four sketched replacements (stadium, broadcast tower, cockpit-evolved, three
scales) all read as templates next to v2. The decision: keep v2's UI exactly
and change only what the review proved, and change it with marks, not words.

## The rule

Every comparison is **two marks on one scale**: a fill and a tick. Where the
fill sits against the tick is the answer. Learn it once on the bag dial and it
reads the same on the hour column and the day bar.

## What changes

| v2 | v3 |
|---|---|
| Hero digits cream in every state | Hero digits take the status colour (green / gold / red) from the body class v2 already sets |
| 10 px progress bar, fill = % of target-so-far | 22 px bar cut into the ten hour slots on the day-goal axis; fill = lbs / day goal; a gold **plan now** tick that moves with the clock; the gap hatched (red behind, green ahead); a hollow **end of day** marker at the projection |
| "/ 50.1 lbs goal" (target so far) | "/ 143.0 lbs goal" (the day goal) — one goal on the board |
| Delta pill, projection sentence, AVG / BEST, vs yesterday / 7-day, momentum arrow, strain-rate subline | Removed; the bar carries them |
| Scale ring + timer ring | One dial: timer arc outside (gold), scale arc inside (cream), the wedge between the two tips shaded — red when the clock is ahead of the weight, green when the weight is ahead |
| Current-hour card: trimmers + "lbs target" | Trimmers + "~lbs so far" (bags logged this hour + what is on the scale) + a column that fills against a gold hairline that climbs with the clock; hour target at the top |
| "Target: 1.09 lbs/hr ↗" | A needle: twelve o'clock is on target, left behind, right ahead; realised rate today / target underneath |
| Caution stripes, edge glows, particles, chart value labels | Removed |

Untouched: header, clock, status badge (kept as the non-colour cue), last-hour
card, bag stats row, buttons, pause modal, morning report, past data, FAB,
help, bottom-strip chart and cycle history, i18n, TV mode, service worker.

## How it is built

- `src/pages/scoreboard-v3.html` is derived from v2 by a script of asserted
  replacements (kept in the session, not the repo). Nothing was retyped.
- `src/css/scoreboard-v3.css` is v2's stylesheet verbatim with a `V3` block
  appended at the end. The v2 file is not edited.
- **v2's JavaScript is not touched.** `scale-display.html` shares
  `config/state/dom/api/timer/scale.js` and keeps working unchanged.
- The scale ring moves inside the timer SVG at a smaller radius with
  `pathLength="597"`, so `scale.js`'s circumference math (`2π·95 ≈ 597`)
  still lands the arc where it should. `timer.js` divides by `2π·103` and
  its circle keeps `r=103`.
- `src/js/scoreboard-v3/pace-math.js` is pure (no DOM, no clock; callers pass
  "now") and pinned by `tests/scoreboard-v3-pace.test.mjs` against the
  2026-09-02 shift. `pace.js` reads `ScoreboardState` and the two ring
  offsets, wraps `ScoreboardRender.renderScoreboard` so it runs after every
  v2 render, and ticks once a second for the clock-driven marks. It never
  writes to the API.
- Day bar axis: completed hours use the target the worker graded them by
  (effective trimmers × rate × multiplier), the hour in progress uses
  `currentHourTarget`, the remaining goal is spread over future slots by
  multiplier — the same shape the worker's `dailyGoal` uses, so the last
  divider lands on the goal and the plan tick sits inside the current hour at
  exactly the elapsed fraction.
- Hour so far is an estimate and is drawn with a tilde: bag events inside the
  slot × bag weight, plus the scale reading when the scale is live. A bag that
  started before the hour is split by time — the hour is credited with the
  share of the bag's life that falls inside it — since there is no weight
  history to split it by.
- v2 nests the hourly chart's options under `data`, so the datalabels plugin
  runs on its defaults and prints a value over every bar. v3 turns that off
  through `chart.config.options` and re-resolves; `chart.options` is Chart.js's
  resolver proxy and throws on a plain-object assignment.

## Not in this pass

- The 4K zoom hack. v3 inherits `html.tv-mode { zoom: 0.65 }`; replacing it
  with a fluid scale is its own change, measured on the barn PC.
- Bag-timer target realism (26 min vs 27–67 min cycles) — a worker-side
  question about `getEffectiveTargetRate`, not a display one.
- Spanish parity of the v2 modules (timer, date, help, pause modal). The new
  labels are bilingual; the inherited gaps are unchanged.
- Polling volume (250 ms scale poll). Unchanged, so v2 and v3 behave the same
  on the wall during the A/B.
