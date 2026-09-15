# Shell, slice 1: the Hub's frame becomes shared

Date: 2026-09-15. Step 1 of `2026-09-15-apps-ui-overhaul-design.md`.

## Goal

Lift the Ops Hub's frame into shared modules and run the Hub on them, with no
visible change except the nav fix Koa asked for.

## In this slice

- [x] Capture the Hub before any change: element rects and colours, dark and
      light at 1440, and the phone menu at 390.
- [x] `src/ui/tokens.css`: the Hub's surface, ink, line, status, chart and rail
      tokens, moved out of `hub.css`.
- [x] `src/ui/components.css`: `.mono`, `.num`, `.eyebrow`, `.muted`,
      `.hidden`, `.tb-btn`, `.tb-spacer`, `.icon-btn`, `.chips`, `.chip`,
      `.card`, `.pulse-dot`, moved out of `hub.css`.
- [x] `src/shell/nav.js`: one list of apps, and a pure function that finds the
      current one from the URL. Pinned by `tests/shell-nav.test.mjs`.
- [x] `src/shell/shell.js` and `shell.css`: rail, topbar frame, phone menu,
      theme button, Pacific clock, status pill and rail dot.
- [x] The Hub mounts the shell: `index.html` keeps only its own topbar
      controls, `hub/main.js` calls `mountShell`, and `hub.css` loses the moved
      rules.
- [x] Nav: "Supply Kanban" opens `kanban.html`; "Tag Desk (beta)" opens
      `tag-desk.html`.
- [x] Verify: the same capture after the change matches except the two nav
      entries; lint, unit tests and the hash check pass.

## Result

Before and after captures of the Hub match at 1440 px in dark and light and
at 390 px with the phone menu: every rect, colour, padding and theme icon. The
only difference is the two Kanban nav entries. 5 nav tests added; unit tests,
lint and the hash check pass.

## Later slices

- The unlock dialog moves into the shell.
- The EN/ES switch, off for the Hub until it has Spanish labels.
- Self-hosted fonts.
- `shared-base.css` re-exports `tokens.css` so the TV boards pick it up.

## Rules for this worktree

Files are checked out with LF endings so the stamp hook hashes the same bytes
CI does. Any checkout, rebase or reset here runs as
`git -c core.autocrlf=false …`, and new files are written with LF.
