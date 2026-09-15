# Shell, slice 2: unlock dialog, EN/ES switch, self-hosted fonts

Date: 2026-09-15. Follows `2026-09-15-shell-slice-1.md`.

## In this slice

- [x] Capture the Hub first: text-sensitive rects, loaded font faces, and the
      unlock dialog opened from the chat lock.
- [x] `src/shell/unlock.js`: the shared-password dialog builds itself on first
      use, validates against `/api/orders?action=validatePassword`, and takes an
      optional `reason`. `src/js/hub/auth.js` and the Hub's dialog markup and
      CSS are gone; the Hub passes its own sentence word for word.
- [x] `src/shell/labels.js`: every shell string in English and Spanish, with
      English app names taken from `NAV`. Pinned by
      `tests/shell-labels.test.mjs`.
- [x] `mountShell({ lang: true })` adds an EN/ES button and translation hooks
      on the rail. Off by default; the Hub keeps it off until its own labels
      have Spanish.
- [x] `src/ui/fonts.css` and `src/assets/fonts/`: Outfit and JetBrains Mono as
      variable fonts, DM Serif Display regular and italic, Latin subsets from
      Fontsource 5.3.0 with their OFL licences. The Hub makes no Google
      requests.
- [x] `src/pages/ui-examples.html`: the shell with the language switch on,
      buttons, status, cards and the unlock dialog. Not in the rail.

## Result

The Hub before and after match to 0.1 px on every measured element, the unlock
dialog matches in size, wording, focus and errors, and fonts load from
`src/assets/fonts/` with zero Google requests. On the examples page the switch
turns the rail, aria labels, `<html lang>` and the unlock dialog Spanish, keeps
a page-set status, and switches back.

## To confirm with Koa

Three Spanish app names had no existing translation in the apps and were
chosen here: Mayoreo (Wholesale), Kanban de Insumos (Supply Kanban) and
Procedimientos (SOP) (SOP Manager). The rest reuse names the apps already show.

## Still open for the shell

- ~~`shared-base.css` re-exports `tokens.css` so the TV boards pick it up.~~
  Dropped; see `2026-09-15-floor-manager-ledger.md`.
- Other pages move to `fonts.css` as they join the shell.
