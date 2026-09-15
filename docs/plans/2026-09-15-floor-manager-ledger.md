# Floor Manager: the Ledger look, inside the shell

Date: 2026-09-15. Follows `2026-09-15-shell-slice-2.md`. Design:
`2026-09-15-apps-ui-overhaul-design.md` (step 2) on top of the September engine
in `2026-09-02-floor-manager-overhaul-design.md`.

## In this slice

- [x] Promote the Hub's shared vocabulary into `src/ui/components.css`, rule for
      rule: `.page-head` (was the Hub's `.greeting`), `.sec` and `.sec-head`,
      `.card-title`, `.tile` and `.value`, `.delta`, `.status`, `.meter`,
      `.empty`, `.err`. A rule-by-rule comparison of `hub.css` plus
      `components.css` before and after finds the same 243 rules, with only
      the `.greeting` to `.page-head` rename differing. The Hub renders the same.
- [x] `src/pages/floor.html` mounts the shell with the language switch on. The
      page's date, shift and drawer controls go in the topbar slots; its own
      home link, wordmark, EN/ES switch and theme button are gone. Every id the
      engine's modules read is still there, checked by script.
- [x] `src/css/floor.css` is a page layer now, not a second design system. It
      names no token the shared layer names, redefines no shared component, and
      derives its six `--fl-` tokens from shared ones. It styles only the ledger
      columns, the hour editor, the two instruments and the drawer.
- [x] `src/js/floor/strip.js` renders Ledger columns. Each shows the hour, the
      cultivar in the display serif, a bar scaled to the larger of pounds and
      target with a gold target mark, tops against target, and smalls. The day
      total stays tops only. The tick states, `.half`, focus carry-over and
      arrow keys are unchanged.
- [x] `src/js/floor/main.js` calls `mountShell` before it builds `els`, so the
      shell's own ids are in the map. It redraws on `ro:langchange` and writes
      the connection pill from the version poll: live, offline, or loading.
- [x] Reason toggles are `.rchip`, so they no longer collide with the shared
      segmented `.chip`. `tests/floor.spec.js` follows the rename and the
      shell's language button.
- [x] The rail lists "Floor Manager (new)" beside the original, which stays the
      default until the crew has run real shifts on the new one. `sw.js`
      precaches `floor.html` and `ui-examples.html`.

## Result

Checked against the live API at 1440 and 1280 wide, dark and light, English and
Spanish, and at 375 wide on a phone. The ledger shows all ten hours with the
lunch break, the open hour outlined in gold, and a near-target hour filled gold.
Switching language turns the rail, title, headings, reasons, tiles, drawer and
status pill Spanish. The page never scrolls sideways; below about 900 px the
ledger card scrolls inside itself. No console errors apart from the local
server's missing service-worker path. The floor and shell unit tests and lint
pass.

Nothing was typed into an hour during the check, because the page writes to
production.

## Decided along the way

- **TV boards keep their own tokens.** Slice 2 left open a plan for
  `shared-base.css` to re-export `tokens.css` so the TV boards would pick it up.
  Dropped: Scoreboard v2/v3 and Scale Display do not read these tokens, and Tag
  Desk defines `--surface`, `--line` and others under `[data-theme="dark"]`,
  which `:root[data-theme="dark"]` in `tokens.css` would override.
- **The shell's touch floor is designed to, not fought.** Steppers, selects and
  the Line 2 button are 44 px, the height `shared-base.css` already enforces on
  touch screens.

## Before the crew switches

- A shift of real entry on the new page, then point the rail's Floor Manager
  entry at `floor.html` and retire the "(new)" entry.
- Playwright run of `tests/floor.spec.js` against a test date.
