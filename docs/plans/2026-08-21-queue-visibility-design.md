# Queue visibility — the dashboard widget and the hourly-entry banner

**Date:** 2026-08-21
**Status:** designed, approved
**Surfaces:** `src/pages/index.html` (Ops Hub dashboard), `src/pages/hourly-entry.html`
**Backend:** `workers/src/handlers/wholesale-d1.js`

The wholesale order board answers *"when can I promise this order?"* Nobody outside the board
can see the answer. This puts two read-only views of the queue where the work actually happens:
a burn-down widget on the dashboard, and a now/next banner on the hourly entry.

Both are **read-only**. Neither can reorder the queue, change a status, or write an order.

---

## The API — `getQueueBrief`

One new action on `/api/wholesale`. It calls the same `computeQueue()` the board uses and
projects a smaller shape, so the derivation is never duplicated.

```js
{
  headline: {
    mode: 'now' | 'next' | 'clear',
    cultivarId, cultivarName, form,
    orderId, orderRef, nickname,
    doneLbs, totalLbs, pct
  },
  next: { /* same shape */ } | null,
  blocks: [                       // capped at 4
    { orderId, orderRef, nickname, cultivarName, form,
      doneLbs, totalLbs, pct, finish: { date, minutes } }
  ],
  blocksTotal: 7,                 // uncapped count, for the "+N more" row
  queueAliases: ['2025 - Purple Frosty / Sungrown', '2025 - Lifter / Sungrown']
}
```

Deliberately **not** carried over from `getQueue`: the `unallocated` array (27 rows on
2026-08-21 and growing with the 60-day replay window), full pass geometry, crew basis, rate
fallbacks. None of it is readable on a phone widget, and `unallocated` alone is most of the
payload.

### The `mode` rule

Pinned against live data rather than assumed. On 2026-08-21, block `MO-2026-002` has
`start = { date: '2026-08-21', minutes: 991 }` — 16:31, *past* the 16:20 productive end. A
clock-based "now trimming" would have been a lie on the first day it shipped.

Mode is decided by **work state**, not by the clock:

| mode    | condition                                              | headline reads   |
|---------|--------------------------------------------------------|------------------|
| `now`   | first unfinished block has `doneLbs > 0`                | "Now trimming"   |
| `next`  | work exists, nothing started yet                       | "Next up"        |
| `clear` | no unfinished blocks                                   | "Queue is clear" |

The headline pass is the **first pass with `remainingLbs > 0`, in queue order** — not simply
pass 0. On 2026-08-21 `MO-2026-002` has pass 0 (Purple Frosty) at 0% and pass 1 (Berry Bliss)
at 100%, because allocation matches by cultivar rather than by pass order. The rule correctly
skips the finished pass and names Purple Frosty.

`next` is the following unfinished pass, spilling into the next block when the current block
has none left.

### No caching

The dashboard rides its existing refresh cycle; the banner fetches on editor open and on slot
change, never on a timer. That is roughly one extra call per refresh — a cache layer would be
premature.

---

## The vocabulary problem (why `queueAliases` exists)

The queue and the hourly entry do not speak the same language, and the gap is invisible if you
get it wrong.

- Queue returns `cultivarId: 'purple-frosty'`, `cultivarName: 'Purple Frosty'`
- The hourly-entry dropdown holds `'2025 - Purple Frosty / Sungrown'`

Measured against live data on 2026-08-21:

| matching strategy                                   | matches  |
|-----------------------------------------------------|----------|
| naive `option.replace(/^\d{4}\s*/, '') === name`     | **0 / 23** |
| hand-tuned regex stripping `YYYY - ` and ` / Form`   | 21 / 23  |

The naive match — the obvious one to reach for — scores **zero** and would float nothing,
ever, while looking exactly like a working feature. The tuned regex still misses precisely the
two alias cases, `Lifter (Early Harvest)` and `Sugar Cookez (Cookies)`, which is what the
78-row alias table exists to resolve.

**The resolution therefore stays server-side.** `cultivar_aliases.alias` already holds the
dropdown string verbatim — it is joined directly onto `monthly_production.cultivar1`
(`wholesale-d1.js:397`, `:524`, `:597`, `:621`). So `getQueueBrief` returns the alias rows for
the current crop year and the client matches with `===`. No parsing, no normalization, no
second copy of a mapping the worker already owns.

This codebase has been bitten twice by a client-side second copy of a server-side mapping.
Not a third time.

---

## Surface 1 — the hourly entry

### The banner

A read-only block at the top of the editor view, above the crew grid — the first thing the
lead sees when opening a slot.

```
┌─────────────────────────────────┐
│ NOW  Purple Frosty · tops       │
│      50/100 lb  ▓▓▓▓░░░░  50%   │
│ NEXT Lifter · tops — Ashanti    │
└─────────────────────────────────┘
```

No controls. Fetched on editor open and slot change. `mode: 'clear'` renders one quiet line,
not an empty box.

### Float-to-top

`populateCultivarSelects()` gains two `<optgroup>`s driven by `queueAliases`:

```
── in queue ──
  2025 - Purple Frosty / Sungrown
  2025 - Lifter / Sungrown
── all ──
  2025 - Berry Bliss / Sungrown
  …
```

Three rules keep it safe:

1. **Reorder only, never invent.** An alias with no match in `cultivarOptions` is skipped
   silently. The dropdown can only offer strings the production API already accepts —
   otherwise a float could write a value that 400s on save.
2. **No default is written.** The existing `select.value = currentValue` preserve-on-rebuild
   behavior is untouched. Empty stays empty. The queue's prediction must never become recorded
   fact by nobody touching the field — the burn-down reads these entries back, and would then
   be feeding on its own guess.
3. Applies to `cultivar1` and `cultivar2` alike.

**The optgroup labels are load-bearing, not decoration.** With no divergence warning (below), a
silently reordered list would make mis-tapping the queue's guess *easier*. The labels are what
make this a reordering rather than a nudge.

### Bilingual

New keys in both label blocks (`index.js` ~131 EN / ~229 ES). This is the floor lead's screen —
the one surface where Spanish is not optional.

| key            | en               | es                        |
|----------------|------------------|---------------------------|
| `queueNow`     | Now trimming     | Podando ahora             |
| `queueNext`    | Next up          | Siguiente                 |
| `queueClear`   | Queue is clear   | No hay pedidos en cola    |
| `queueInQueue` | in queue         | en cola                   |
| `queueAll`     | all              | todos                     |
| `queueReady`   | ready            | listo                     |

---

## Surface 2 — the dashboard widget

`kanbanTotal` (`index.html:295`) is declared in markup and **never written by any JS** — the
Supply Kanban and Live Scoreboard integration cards have shown `—` in all three rows since they
were built. The integration-card pattern is the dead one; this widget follows the live
`updateDataWidgets` path instead.

- New `widget-queue` in the Muuri container, registered in `widgetDefinitions`
  (`config.js:25`) as
  `{ id: 'queue', label: 'Production Queue', icon: 'ph-duotone ph-list-numbers', color: 'green', default: true, visible: true }`
- Rendered by `renderQueueWidget()` in `widgets.js`, called from `index.js:362`
- Does its own `getQueueBrief` fetch (different API than the dashboard's `/api/production`
  payload), so it is `async` and **failure-isolated** — a wholesale outage renders the error
  state and never breaks the dashboard refresh
- Whole card taps through to `wholesale.html`

### Three states, built together

Per `lessons.md#2026-05-28` (test variable-content layouts at min and max volume), all three
ship at once rather than the happy path first:

- **Populated** — up to 4 rows: order ref / nickname, binding cultivar + form, burn-down bar,
  `doneLbs/totalLbs`, pct, `ready <day> <time>`. First unfinished block carries a `▶`.
- **Overflow** — `blocksTotal > 4` renders `+N more on the board` as the last row. This is why
  the API returns `blocksTotal` rather than letting the client count a truncated array.
- **Empty** — `mode: 'clear'` renders "Queue is clear — nothing scheduled", not a blank card.

`showWidgetHelp` stays the existing stub (it toasts "Help coming soon" for every widget today);
real help content is a separate change.

---

## Testing

`tests/wholesale-queue-brief.test.mjs`, alongside the existing suite:

- the three `mode` branches, against fixtures matching today's live shape — finished pass
  *before* an unfinished one, `start` in the future, empty queue
- the 4-block cap reports the uncapped `blocksTotal`
- **`queueAliases` exact-matches real production dropdown values** — the test that actually
  protects the feature, given a naive match scores 0/23 and fails invisibly

---

## Accepted tradeoffs

**No divergence warning.** Koa's call, made deliberately. When the floor trims something the
queue did not expect, nothing surfaces it — the banner will confidently name the queue's
cultivar while the floor works on another. This is live today: the board says Purple Frosty
while 297.8 lb of Lifter, Passion Fruit OG and Berry Bliss recorded on 08-20/08-21 sit
`unallocated`. Recorded here so it is not rediscovered as a bug in three weeks.

**The `startsWith('2025')` hardcode is not fixed here.** `loadCultivars()`
(`hourly-entry/index.js:1668`) filters the dropdown to 2025 cultivars. After the crop-year
rollover the queue's cultivars will not be in the dropdown at all, so float-to-top will float
nothing. Separate change, separate blast radius, already tracked by the
`unmatchedSpellings()` rollover todo.

**Dead integration-card stats are not fixed here.** `kanbanTotal`, `scoreboardStatus` et al.
remain unwired. Noted while reading the markup; out of scope.

---

## Related

- `wiki/operations/wholesale-order-board.md` — what the board is and how it schedules
- `wiki/seasons/2026/journal/2026-08-20` — the queue model
- `wiki/seasons/2026/journal/2026-08-21` — the board's UI pass, burn-down, and bell
