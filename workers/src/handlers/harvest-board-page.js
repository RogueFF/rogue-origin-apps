/**
 * Harvest Lot Board — page markup.
 *
 * GENERATED FILE — do not edit.
 * Source:    rogue-farm-wiki/scripts/harvest-board-template.html
 * Generator: rogue-farm-wiki/scripts/build-harvest-board-worker-page.py
 *
 * The page ships no lot data: it renders empty, asks for the farm
 * password, then pulls everything from D1 via /api/harvest?action=board.
 */

export const BOARD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>Rogue 2026 Lot Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Public+Sans:wght@400;500;600&display=swap">

<style>
  /* ---- tokens: complete light palette on bare :root ---- */
  :root {
    --paper:        #e8eae3;
    --surface:      #f4f6f0;
    --surface-2:    #dee1d8;
    --line:         #c6cabd;
    --line-soft:    #d6d9cf;
    --ink:          #191d1a;
    --ink-2:        #4b5250;
    --ink-3:        #5c655f;

    --slate:        #2f5d7c;
    --slate-soft:   #d7e2ea;
    --amber:        #a9762a;
    --amber-soft:   #efe1c6;
    --leaf:         #42704a;
    --leaf-soft:    #d8e6d8;
    --rust:         #93392e;
    --rust-soft:    #efd8d3;

    --shadow:       0 1px 2px rgba(25, 29, 26, .10), 0 6px 16px -10px rgba(25, 29, 26, .22);
    --focus:        #2f5d7c;
    --bar:          #b9bfb2;
    --bar-hover:    #98a08f;

    --col-min:      8.5rem;   /* floor before the rail starts scrolling */
    --col-max:      20rem;    /* stop columns ballooning on a wide screen */
    --radius:       3px;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:      #141715;
      --surface:    #1c201d;
      --surface-2:  #262b27;
      --line:       #343a35;
      --line-soft:  #2a2f2b;
      --ink:        #e6e9e2;
      --ink-2:      #a8b0a9;
      --ink-3:      #98a29a;

      --slate:      #7fb0cf;
      --slate-soft: #1e3140;
      --amber:      #d6a256;
      --amber-soft: #3a2e19;
      --leaf:       #7fb185;
      --leaf-soft:  #1e2f21;
      --rust:       #d4796b;
      --rust-soft:  #3a221e;

      --shadow:     0 1px 2px rgba(0, 0, 0, .45), 0 6px 16px -10px rgba(0, 0, 0, .7);
      --focus:      #7fb0cf;
      --bar:        #3d443e;
      --bar-hover:  #555e56;
    }
  }

  :root[data-theme="dark"] {
    --paper:      #141715;
    --surface:    #1c201d;
    --surface-2:  #262b27;
    --line:       #343a35;
    --line-soft:  #2a2f2b;
    --ink:        #e6e9e2;
    --ink-2:      #a8b0a9;
    --ink-3:      #98a29a;

    --slate:      #7fb0cf;
    --slate-soft: #1e3140;
    --amber:      #d6a256;
    --amber-soft: #3a2e19;
    --leaf:       #7fb185;
    --leaf-soft:  #1e2f21;
    --rust:       #d4796b;
    --rust-soft:  #3a221e;

    --shadow:     0 1px 2px rgba(0, 0, 0, .45), 0 6px 16px -10px rgba(0, 0, 0, .7);
    --focus:      #7fb0cf;
    --bar:        #3d443e;
    --bar-hover:  #555e56;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: "Public Sans", ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    font-size: 14px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  :where(button, input, select, textarea, a, [tabindex]):focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  .num  { font-variant-numeric: tabular-nums; }

  .cond {
    font-family: "Barlow Condensed", "Public Sans", ui-sans-serif, sans-serif;
    font-weight: 600;
    letter-spacing: .02em;
  }

  /* ---- shell ---- */
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;   /* the mobile URL bar eats a slice of 100vh */
    min-height: 30rem;
  }

  /* ---- command bar ---- */
  header.bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .5rem .9rem;
    padding: .45rem .7rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .brand { display: flex; align-items: baseline; gap: .55rem; margin-right: auto; }

  .brand h1 {
    margin: 0;
    font-family: "Barlow Condensed", "Public Sans", sans-serif;
    font-weight: 700;
    font-size: 1.2rem;
    letter-spacing: .01em;
    white-space: nowrap;
  }

  .brand .season {
    font-family: "IBM Plex Mono", monospace;
    font-size: .7rem;
    color: var(--ink-3);
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }

  .field {
    display: flex;
    align-items: center;
    gap: .4rem;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .3rem .5rem;
  }

  .field label {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .78rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--ink-3);
  }

  .field input, .field select {
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: .82rem;
    min-width: 6rem;
  }
  .field input:focus, .field select:focus { outline: none; }
  .field:focus-within { border-color: var(--focus); }

  button.act {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .85rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--ink-2);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .38rem .7rem;
    cursor: pointer;
  }
  button.act:hover { border-color: var(--slate); color: var(--slate); }
  button.act[hidden] { display: none; }

  .save {
    font-family: "IBM Plex Mono", monospace;
    font-size: .7rem;
    letter-spacing: .04em;
    color: var(--ink-3);
    min-width: 5rem;
    text-align: right;
  }
  .save[data-tone="working"] { color: var(--amber); }
  .save[data-tone="ok"]      { color: var(--leaf); }
  .save[data-tone="bad"]     { color: var(--rust); }

  /* ---- notices ---- */
  .notice {
    padding: .5rem 1rem;
    font-size: .82rem;
    border-bottom: 1px solid var(--line);
    background: var(--amber-soft);
    color: var(--ink);
  }
  .notice[hidden] { display: none; }
  .notice.bad { background: var(--rust-soft); }

  /* ---- board ---- */
  main {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;   /* the drawer overlays, so columns keep full width */
  }

  .board {
    flex: 1;
    /* without this a flex child won't shrink under its content, so the columns
       would push the page sideways instead of scrolling inside the rail */
    min-width: 0;
    display: flex;
    gap: .35rem;
    padding: .55rem .7rem .7rem;
    overflow-x: auto;
    overflow-y: hidden;
    align-items: stretch;
  }

  .col {
    /* Every stage shares the rail so all 7 fit without sideways scrolling;
       below --col-min the rail scrolls rather than crushing the cards. */
    flex: 1 1 0;
    min-width: var(--col-min);
    max-width: var(--col-max);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
  }

  .col.drop { border-color: var(--slate); background: var(--slate-soft); }
  .col.aside { flex: 0 1 9rem; border-style: dashed; }

  .col > h2 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: .5rem;
    padding: .35rem .4rem;
    border-bottom: 1px solid var(--line-soft);
    /* stage stripe: a real sequence, so the ramp carries order */
    border-top: 3px solid var(--stage, var(--line));
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
  }

  .col > h2 .label { overflow: hidden; text-overflow: ellipsis; }

  .col > h2 .count {
    margin-left: auto;
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .74rem;
    font-weight: 500;
    color: var(--ink-3);
    background: var(--surface-2);
    border-radius: 999px;
    padding: .05rem .45rem;
  }

  .col > h2 button.fold {
    all: unset;
    cursor: pointer;
    color: var(--ink-3);
    font-family: "IBM Plex Mono", monospace;
    font-size: .8rem;
    line-height: 1;
    padding: .15rem .25rem;
  }
  .col > h2 button.fold:hover { color: var(--slate); }
  .col > h2 button.fold:focus-visible { outline: 2px solid var(--focus); }

  .stack {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: .3rem;
    display: flex;
    flex-direction: column;
    gap: .3rem;
  }

  /* collapsed column: narrow spine, roster still reachable */
  .col.folded { flex: 0 0 2.6rem; min-width: 2.6rem; }
  .col.folded .stack { display: none; }
  .col.folded > h2 {
    flex-direction: column;
    gap: .6rem;
    height: 100%;
    align-items: center;
    padding: .6rem .2rem;
  }
  .col.folded > h2 .label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
  }
  .col.folded > h2 .count { margin-left: 0; }

  .empty {
    color: var(--ink-3);
    font-size: .78rem;
    font-style: italic;
    padding: .5rem .3rem;
  }

  /* ---- card ---- */
  .card {
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-left: 3px solid var(--stage, var(--line));
    border-radius: var(--radius);
    padding: .35rem .45rem .4rem;
    cursor: grab;
    display: grid;
    gap: .2rem;
    text-align: left;
    font: inherit;
    color: inherit;
    box-shadow: var(--shadow);
  }
  .card:hover { border-color: var(--line); }
  .card[aria-selected="true"] { outline: 2px solid var(--focus); outline-offset: 1px; }
  .card.dragging { opacity: .4; cursor: grabbing; }

  .card .top { display: flex; align-items: center; gap: .4rem; }

  .zone {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: .7rem;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--slate);
    background: var(--slate-soft);
    border-radius: var(--radius);
    padding: .05rem .35rem;
    white-space: nowrap;
  }

  .farm {
    font-family: "IBM Plex Mono", monospace;
    font-size: .64rem;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-left: auto;
  }

  .cultivar {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .95rem;
    /* Fixed, not a multiplier: fitNames() shrinks the font on long names, and
       a line box that scaled with it would give the column ragged card
       heights again. */
    line-height: 1.05rem;
    /* One line, always: a wrapped name gives the column ragged card heights
       and costs a row of scanning. A name too wide for its column is shrunk
       to fit by fitNames() rather than clipped; the ellipsis below is only a
       backstop for a name still too long at the minimum size. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .marks { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }

  .mark {
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .66rem;
    letter-spacing: .02em;
    border-radius: var(--radius);
    padding: .05rem .3rem;
    border: 1px solid transparent;
  }
  .mark.thc-pass { color: var(--leaf); background: var(--leaf-soft); }
  .mark.thc-fail { color: var(--rust); background: var(--rust-soft); }
  .mark.date     { color: var(--ink-3); background: var(--surface-2); }
  .mark.doc      { color: var(--slate); background: var(--slate-soft); }
  .mark.note     { color: var(--amber); background: var(--amber-soft); }
  .mark.cbd      { color: var(--slate); background: var(--slate-soft); }


  /* ---- grouped duplicates ------------------------------------------------
     One cultivar in several zones is one row until you open it. The group is
     a container, not a lot: only the zone rows inside it drag. */
  .group { display: flex; flex-direction: column; gap: .25rem; }

  .card.grouphead { cursor: pointer; border-left-style: dashed; }
  .group.open .card.grouphead { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }

  .caret {
    font-family: "IBM Plex Mono", monospace;
    font-size: .7rem;
    line-height: 1;
    color: var(--ink-3);
  }

  .zcount {
    margin-left: auto;
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .66rem;
    letter-spacing: .02em;
    color: var(--ink-3);
    background: var(--surface-2);
    border-radius: 999px;
    padding: .05rem .35rem;
    white-space: nowrap;
  }

  .zones {
    display: flex;
    flex-direction: column;
    gap: .2rem;
    margin-left: .5rem;
    padding-left: .4rem;
    border-left: 1px solid var(--line-soft);
  }

  .zrow {
    display: flex;
    align-items: center;
    gap: .3rem;
    flex-wrap: wrap;
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    padding: .25rem .35rem;
    cursor: grab;
  }
  .zrow:hover { border-color: var(--line); }
  .zrow[aria-selected="true"] { outline: 2px solid var(--focus); outline-offset: 1px; }
  .zrow.dragging { opacity: .4; cursor: grabbing; }
  .zrow .marks { gap: .2rem; }

  /* ---- drawer ---- */
  aside.drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 21rem;
    max-width: 100%;
    z-index: 4;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--line);
  }
  aside.drawer[hidden] { display: none; }

  .drawer .head {
    display: flex;
    align-items: flex-start;
    gap: .5rem;
    padding: .75rem .9rem .6rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .drawer .head h2 {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: 1.3rem;
    line-height: 1.1;
    text-wrap: balance;
  }
  .drawer .head .sub {
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    color: var(--ink-3);
    letter-spacing: .03em;
    display: block;
    margin-top: .15rem;
  }
  .drawer .head button {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    color: var(--ink-3);
    font-family: "IBM Plex Mono", monospace;
    padding: .1rem .3rem;
  }
  .drawer .head button:hover { color: var(--rust); }
  .drawer .head button:focus-visible { outline: 2px solid var(--focus); }

  .drawer .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: .8rem .9rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: .9rem;
  }

  .grp { display: flex; flex-direction: column; gap: .3rem; }

  .grp > .lbl {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .8rem;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--ink-3);
  }

  .grp input[type="text"],
  .grp input[type="date"],
  .grp input[type="number"],
  .grp select,
  .grp textarea {
    width: 100%;
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .38rem .45rem;
    font: inherit;
    font-size: .85rem;
  }
  .grp textarea { min-height: 6.5rem; resize: vertical; line-height: 1.5; }
  .grp input:focus, .grp select:focus, .grp textarea:focus {
    outline: none; border-color: var(--focus);
  }
  .grp .hint { font-size: .72rem; color: var(--ink-3); }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }

  .docs { display: flex; flex-direction: column; gap: .3rem; }

  .doc {
    display: flex;
    align-items: baseline;
    gap: .4rem;
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    padding: .3rem .4rem;
  }
  .doc .name { font-size: .8rem; font-weight: 500; }
  .doc .ref {
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    color: var(--ink-3);
    word-break: break-all;
    flex: 1;
  }
  .doc a { color: var(--slate); }
  .doc button {
    all: unset; cursor: pointer; color: var(--ink-3);
    font-family: "IBM Plex Mono", monospace; font-size: .8rem; padding: 0 .2rem;
  }
  .doc button:hover { color: var(--rust); }
  .doc button:focus-visible { outline: 2px solid var(--focus); }

  .readonly .card { cursor: default; }
  .readonly .grp input,
  .readonly .grp select,
  .readonly .grp textarea { opacity: .65; }

  footer.foot {
    padding: .55rem 1rem .7rem;
    border-top: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink-3);
    font-size: .74rem;
    line-height: 1.5;
  }
  footer.foot strong { color: var(--ink-2); font-weight: 600; }
  footer.foot code {
    font-family: "IBM Plex Mono", monospace;
    font-size: .95em;
    color: var(--ink-2);
  }


  /* ---- scrollbars: the OS bar ate 16px of a 180px column ---- */
  .stack, .board, .drawer .body, .grp textarea {
    scrollbar-width: thin;
    scrollbar-color: var(--bar) transparent;
  }
  .stack::-webkit-scrollbar,
  .board::-webkit-scrollbar,
  .drawer .body::-webkit-scrollbar,
  .grp textarea::-webkit-scrollbar { width: 8px; height: 8px; }

  .stack::-webkit-scrollbar-track,
  .board::-webkit-scrollbar-track,
  .drawer .body::-webkit-scrollbar-track,
  .grp textarea::-webkit-scrollbar-track { background: transparent; }

  .stack::-webkit-scrollbar-thumb,
  .board::-webkit-scrollbar-thumb,
  .drawer .body::-webkit-scrollbar-thumb,
  .grp textarea::-webkit-scrollbar-thumb {
    background: var(--bar);
    border-radius: 999px;
  }
  .stack::-webkit-scrollbar-thumb:hover,
  .board::-webkit-scrollbar-thumb:hover,
  .drawer .body::-webkit-scrollbar-thumb:hover,
  .grp textarea::-webkit-scrollbar-thumb:hover { background: var(--bar-hover); }

  .stack::-webkit-scrollbar-corner,
  .board::-webkit-scrollbar-corner { background: transparent; }

  /* ---- selects: the native popup inherited a transparent option
     background, which renders as unreadable pale-on-white on Windows.
     Paint the control and every option explicitly, and draw our own caret. ---- */
  .sel { position: relative; display: block; }
  .sel::after {
    content: "";
    position: absolute;
    right: .5rem;
    top: 50%;
    width: 0;
    height: 0;
    margin-top: -1px;
    pointer-events: none;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--ink-3);
  }
  .sel select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    width: 100%;
    padding-right: 1.5rem;
    cursor: pointer;
  }
  .field .sel::after { right: .1rem; }
  .field .sel select { padding-right: 1.1rem; }

  /* Applies to the dropdown list itself in Chromium/Windows. */
  select option,
  select optgroup {
    background: var(--surface);
    color: var(--ink);
  }

  /* ---- small text was down at 10.5px; nudge the floor up ---- */
  .mark { font-size: .7rem; }
  .col > h2 .count { font-size: .76rem; }
  .grp .hint { font-size: .74rem; }


  /* ---- password gate ---- */
  .gate {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--paper);
  }
  .gate-card {
    display: flex;
    flex-direction: column;
    gap: .7rem;
    width: min(24rem, 100%);
    background: var(--surface);
    border: 1px solid var(--line);
    border-top: 3px solid var(--slate);
    border-radius: var(--radius);
    padding: 1.4rem 1.3rem 1.5rem;
    box-shadow: var(--shadow);
  }
  .gate-card h1 {
    margin: 0;
    font-family: "Barlow Condensed", "Public Sans", sans-serif;
    font-weight: 700;
    font-size: 1.6rem;
    letter-spacing: .01em;
  }
  .gate-card p { margin: 0; color: var(--ink-2); font-size: .86rem; line-height: 1.5; }
  .gate-card input {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .5rem .55rem;
    font: inherit;
  }
  .gate-card input:focus { outline: none; border-color: var(--focus); }
  .gate-card button { align-self: flex-start; }
  .gate-err { color: var(--rust); font-size: .82rem; }
  .gate-err[hidden] { display: none; }
  .shell[hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }

  /* ---- phones: one stage per screen, swipe between them ----------------
     A 7-column rail on a 375px screen is unusable, so each stage becomes a
     near-full-width panel on a snap track. Drag-and-drop doesn't exist on
     touch anyway -- the drawer's stage picker is the way cards move here. */
  @media (max-width: 46rem) {
    header.bar { padding: .4rem .5rem; gap: .35rem .5rem; }
    .brand h1 { font-size: 1.1rem; }
    .brand .season { display: none; }
    .controls { width: 100%; gap: .35rem; flex-wrap: nowrap; }
    .controls .field:first-child { flex: 1 1 auto; min-width: 0; }
    .field { padding: .25rem .4rem; }
    .field input, .field select { min-width: 0; }
    /* Exporting board JSON is a desk job; on a phone it only costs a row. */
    #export { display: none; }
    .save { min-width: 0; white-space: nowrap; }

    .board {
      gap: .5rem;
      padding: .5rem;
      scroll-snap-type: x mandatory;
      overscroll-behavior-x: contain;
    }
    .col, .col.aside {
      flex: 0 0 86vw;
      min-width: 86vw;
      max-width: 86vw;
      scroll-snap-align: center;
    }

    /* Folding is a desktop affordance; full-width panels have nothing to gain
       from it, and a folded panel would break the snap track. */
    .col > h2 button.fold { display: none; }
    .col.folded { flex: 0 0 86vw; min-width: 86vw; max-width: 86vw; }
    .col.folded .stack { display: flex; }
    .col.folded > h2 { flex-direction: row; height: auto; padding: .45rem .55rem; }
    .col.folded > h2 .label { writing-mode: horizontal-tb; }
    .col.folded > h2 .count { margin-left: auto; }

    .col > h2 { padding: .45rem .55rem; font-size: .9rem; }
    .stack { padding: .4rem; gap: .4rem; }

    /* Roomier tap targets, and larger type now that width is not scarce. */
    .card { padding: .5rem .6rem .55rem; }
    .zrow { padding: .45rem .5rem; min-height: 44px; }   /* touch target */
    .zones { margin-left: .6rem; padding-left: .5rem; }
    .zcount { font-size: .74rem; }
    .caret { font-size: .8rem; }
    .cultivar { font-size: 1.05rem; line-height: 1.25rem; }
    .zone { font-size: .78rem; }
    .mark { font-size: .74rem; }

    aside.drawer {
      position: fixed;
      inset: auto 0 0 0;
      width: auto;
      max-width: none;
      height: 78dvh;
      border-left: 0;
      border-top: 1px solid var(--line);
      z-index: 5;
    }
    .drawer .head button { font-size: 1.15rem; padding: .25rem .5rem; }

    /* iOS zooms the page when a focused control is under 16px. */
    .field input, .field select,
    .grp input, .grp select, .grp textarea,
    .gate-card input { font-size: 16px; }
  }

  /* Touch pointers get the bigger hit areas regardless of window width. */
  @media (pointer: coarse) {
    .col > h2 button.fold { padding: .3rem .45rem; }
    .doc button { padding: .2rem .45rem; }
  }
</style>
</head>
<body>
<div class="shell" hidden>
  <header class="bar">
    <div class="brand">
      <h1>Rogue Lot Board</h1>
      <span class="season">2026 &middot; 82 lots</span>
    </div>

    <div class="controls">
      <div class="field">
        <label for="q">Find</label>
        <input id="q" type="search" placeholder="cultivar or zone" autocomplete="off">
      </div>
      <div class="field">
        <label for="farm">Farm</label>
        <span class="sel">
          <select id="farm">
            <option value="">All</option>
            <option value="Rogue">Rogue</option>
            <option value="Gary">Gary</option>
            <option value="McLoughlin">McLoughlin</option>
          </select>
        </span>
      </div>
      <button class="act" id="export" type="button">Export</button>
      <span class="save" id="save">&nbsp;</span>
    </div>
  </header>

  <div class="notice" id="notice" hidden></div>

  <main>
    <div class="board" id="board"></div>
    <aside class="drawer" id="drawer" hidden aria-label="Lot detail"></aside>
  </main>

  <footer class="foot">
    <strong>This board is the stage overlay, not the yield record.</strong>
    Weights, bins and sack tags stay in <code>wiki/seasons/2026/harvest.md</code>, built from the
    QR scan data &mdash; if the two ever disagree, the scans win. PDFs of record live in
    <code>raw/compliance/2026/</code> and the compliance Drive; cards hold the link, not the file.
  </footer>
</div>
<script>
(function () {
  "use strict";

  var API = "/api/harvest";
  var KEY = "rff-harvest-board-key";

  var STAGES = [
    { id: "untested",    name: "Untested",   full: "Not yet tested", color: "var(--line)" },
    { id: "scheduled",   name: "Scheduled",  full: "Test scheduled", color: "var(--slate)" },
    { id: "cleared",     name: "Cleared",    full: "Test cleared",   color: "var(--leaf)" },
    { id: "harvesting",  name: "Cutting",    full: "Harvesting",     color: "var(--amber)" },
    { id: "drying",      name: "Drying",     full: "Drying",         color: "var(--amber)" },
    { id: "supersacked", name: "Sacked",     full: "Supersacked",    color: "var(--ink-2)" },
    { id: "failed",      name: "Failed",     full: "Failed / destroyed", color: "var(--rust)", aside: true }
  ];

  var lots = [];        // rows from D1, in board order
  var byId = {};
  var pass = "";
  var selected = null;
  var dragId = null;
  var folded = {};
  var expanded = {};   // "<stage>|<cultivar>" -> group open

  var boardEl   = document.getElementById("board");
  var drawerEl  = document.getElementById("drawer");
  var qEl       = document.getElementById("q");
  var farmEl    = document.getElementById("farm");
  var saveEl    = document.getElementById("save");
  var noticeEl  = document.getElementById("notice");
  var exportEl  = document.getElementById("export");
  var shell     = document.querySelector(".shell");

  function setSave(text, tone) {
    saveEl.textContent = text;
    if (tone) { saveEl.setAttribute("data-tone", tone); }
    else { saveEl.removeAttribute("data-tone"); }
  }

  function notify(text, bad) {
    noticeEl.textContent = text || "";
    noticeEl.classList.toggle("bad", !!bad);
    noticeEl.hidden = !text;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }

  // ---- api ---------------------------------------------------------------
  function call(action, payload) {
    return fetch(API + "?action=" + action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + pass
      },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.success === false) {
          // The API returns { success:false, error:"<string>", code } — not a
          // nested error object. Accept both shapes so a message never gets lost.
          var m = j && (typeof j.error === "string" ? j.error
                        : (j.error && j.error.message));
          var err = new Error(m || ("HTTP " + r.status));
          err.status = r.status;
          throw err;
        }
        return j.data !== undefined ? j.data : j;
      });
    });
  }

  // ---- gate --------------------------------------------------------------
  function showGate(message) {
    shell.hidden = true;
    var old = document.getElementById("gate");
    if (old) { old.remove(); }

    var g = el("div", "gate");
    g.id = "gate";
    var card = el("form", "gate-card");
    card.appendChild(el("h1", null, "Rogue Lot Board"));
    card.appendChild(el("p", null,
      "2026 pre-harvest lots. This board carries ODA test results, so it needs the farm password."));
    var input = document.createElement("input");
    input.type = "password";
    input.placeholder = "Farm password";
    input.autocomplete = "current-password";
    card.appendChild(input);
    var btn = el("button", "act", "Open board");
    btn.type = "submit";
    card.appendChild(btn);
    var err = el("div", "gate-err", message || "");
    err.hidden = !message;
    card.appendChild(err);

    card.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = input.value;
      if (!v) { input.focus(); return; }
      btn.disabled = true;
      btn.textContent = "Checking…";
      pass = v;
      load().then(function () {
        try { localStorage.setItem(KEY, v); } catch (e) { /* private window */ }
        g.remove();
        shell.hidden = false;
      })["catch"](function (e) {
        pass = "";
        btn.disabled = false;
        btn.textContent = "Open board";
        err.textContent = e.status === 401 ? "Wrong password." : ("Couldn't load: " + e.message);
        err.hidden = false;
        input.select();
      });
    });

    g.appendChild(card);
    document.body.appendChild(g);
    input.focus();
  }

  // ---- load / save -------------------------------------------------------
  function load() {
    setSave("loading…", "working");
    return call("board", {}).then(function (data) {
      lots = data.lots || [];
      byId = {};
      lots.forEach(function (l) {
        l.docs = parseDocs(l.docs);
        byId[l.lot_id] = l;
      });
      setSave("ready", "ok");
      notify("");
      render();
    });
  }

  function parseDocs(v) {
    if (Array.isArray(v)) { return v; }
    try { return JSON.parse(v || "[]"); } catch (e) { return []; }
  }

  function patch(id, fields) {
    var lot = byId[id];
    var before = {};
    Object.keys(fields).forEach(function (k) { before[k] = lot[k]; });
    Object.keys(fields).forEach(function (k) { lot[k] = fields[k]; });
    render();

    setSave("saving…", "working");
    var payload = { lot: id };
    Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
    if (payload.docs) { payload.docs = JSON.stringify(payload.docs); }

    return call("board_set", payload).then(function (data) {
      if (data && data.lot) {
        var fresh = data.lot;
        fresh.docs = parseDocs(fresh.docs);
        byId[id] = fresh;
        for (var i = 0; i < lots.length; i++) {
          if (lots[i].lot_id === id) { lots[i] = fresh; break; }
        }
        render();
      }
      setSave("saved", "ok");
    })["catch"](function (e) {
      Object.keys(before).forEach(function (k) { lot[k] = before[k]; });
      render();
      setSave("not saved", "bad");
      if (e.status === 401) {
        notify("Your session expired. Reload and enter the password again.", true);
      } else {
        notify("That change did not save (" + e.message + "). It has been rolled back — try again.", true);
      }
    });
  }

  // ---- render ------------------------------------------------------------
  function matches(lot) {
    if (farmEl.value && lot.farm !== farmEl.value) { return false; }
    var q = qEl.value.trim().toLowerCase();
    if (!q) { return true; }
    return (lot.cultivar + " " + lot.zone + " " + lot.farm).toLowerCase().indexOf(q) !== -1;
  }

  function thcTone(v) {
    var n = parseFloat(v);
    if (isNaN(n)) { return null; }
    return n > 0.3 ? "thc-fail" : "thc-pass";
  }

  function marksFor(lot) {
    var marks = el("div", "marks");
    if (lot.test_date) { marks.appendChild(el("span", "mark date", lot.test_date)); }
    if (lot.thc !== null && lot.thc !== undefined && lot.thc !== "") {
      marks.appendChild(el("span", "mark " + (thcTone(lot.thc) || "date"), lot.thc + "% THC"));
    }
    // CBD carries no limit, so it gets no pass/fail colour -- it says what the
    // lot is worth, next to the number that says whether it is legal.
    if (lot.cbd !== null && lot.cbd !== undefined && lot.cbd !== "") {
      marks.appendChild(el("span", "mark cbd", lot.cbd + "% CBD"));
    }
    if (lot.sacks) { marks.appendChild(el("span", "mark date", lot.sacks + " sacks")); }
    if (lot.docs.length) {
      marks.appendChild(el("span", "mark doc", lot.docs.length + " doc" + (lot.docs.length > 1 ? "s" : "")));
    }
    if ((lot.notes || "").trim()) { marks.appendChild(el("span", "mark note", "note")); }
    if (lot.updated_by === "timber") { marks.appendChild(el("span", "mark bot", "timber")); }
    return marks.childNodes.length ? marks : null;
  }

  // Drag and open behave identically on a whole card and on a zone row inside
  // an expanded group, so both are wired here.
  function wireLot(node, lot) {
    node.tabIndex = 0;
    node.draggable = true;
    node.dataset.id = lot.lot_id;
    node.setAttribute("role", "button");
    node.setAttribute("aria-selected", selected === lot.lot_id ? "true" : "false");
    node.title = lot.cultivar + " — " + lot.zone + ", " + lot.farm;
    node.addEventListener("click", function () { openDrawer(lot.lot_id); });
    node.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDrawer(lot.lot_id); }
    });
    node.addEventListener("dragstart", function (ev) {
      dragId = lot.lot_id;
      node.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", lot.lot_id); } catch (e) { /* older browsers */ }
    });
    node.addEventListener("dragend", function () {
      dragId = null;
      node.classList.remove("dragging");
    });
    return node;
  }

  // One cultivar planted across several zones collapses to a single row; the
  // biggest such group is well over a dozen lots. Expanding picks the zone.
  // The group header is deliberately not draggable: moving a dozen compliance
  // lots in one gesture is not something anyone should do by accident.
  // (Deliberately names no cultivar -- this file is served pre-auth, and the
  // public shell must carry no lot data. test-harvest-board.mjs asserts it.)
  function makeGroup(stage, group) {
    var key = stage.id + "|" + group.cultivar;
    var open = !!expanded[key];
    var wrap = el("div", "group" + (open ? " open" : ""));

    var head = el("div", "card grouphead");
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-expanded", open ? "true" : "false");

    var top = el("div", "top");
    top.appendChild(el("span", "caret", open ? "▾" : "▸"));
    top.appendChild(el("span", "zcount", group.lots.length + " zones"));
    head.appendChild(top);
    head.appendChild(el("div", "cultivar", group.cultivar));
    head.title = group.cultivar + " — " +
      group.lots.map(function (l) { return l.zone; }).join(", ");

    function toggle() { expanded[key] = !expanded[key]; render(); }
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
    wrap.appendChild(head);

    if (open) {
      var zones = el("div", "zones");
      group.lots.forEach(function (lot) {
        var row = wireLot(el("div", "zrow"), lot);
        row.appendChild(el("span", "zone", lot.zone));
        var m = marksFor(lot);
        if (m) { row.appendChild(m); }
        zones.appendChild(row);
      });
      wrap.appendChild(zones);
    }
    return wrap;
  }

  function makeCard(lot) {
    var card = wireLot(el("div", "card"), lot);

    var top = el("div", "top");
    top.appendChild(el("span", "zone", lot.zone));
    card.appendChild(top);
    card.appendChild(el("div", "cultivar", lot.cultivar));

    var marks = marksFor(lot);
    if (marks) { card.appendChild(marks); }

    return card;
  }


  // ---- fit long names -----------------------------------------------------
  // A name wider than its column is shrunk until it fits rather than clipped,
  // so nothing is lost to an ellipsis. Reads and writes are batched: measuring
  // one element at a time while also setting styles would force a reflow per
  // card, 82 times per render.
  var NAME_MIN = 11;   // px — below this it stops shrinking and clips

  function fitNames() {
    var els = boardEl.querySelectorAll(".cultivar");
    if (!els.length) { return; }
    var i, e, over = [], scales = [];

    // Clear first, then measure: the CSS base size differs between the desktop
    // and phone layouts, so it is read per element rather than assumed.
    for (i = 0; i < els.length; i++) { els[i].style.fontSize = ""; }
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (e.scrollWidth > e.clientWidth && e.clientWidth > 0) {
        over.push(e);
        scales.push(parseFloat(getComputedStyle(e).fontSize) * (e.clientWidth / e.scrollWidth));
      }
    }
    if (!over.length) { return; }
    for (i = 0; i < over.length; i++) {
      over[i].style.fontSize = Math.max(NAME_MIN, scales[i]).toFixed(2) + "px";
    }

    // Glyph widths don't scale perfectly linearly, so one corrective pass
    // catches the hair of overflow that rounding leaves behind.
    var still = [], again = [];
    for (i = 0; i < over.length; i++) {
      e = over[i];
      if (e.scrollWidth > e.clientWidth) {
        still.push(e);
        again.push(parseFloat(e.style.fontSize) * (e.clientWidth / e.scrollWidth));
      }
    }
    for (i = 0; i < still.length; i++) {
      still[i].style.fontSize = Math.max(NAME_MIN, again[i]).toFixed(2) + "px";
    }
  }

  function render() {
    boardEl.textContent = "";
    var visible = lots.filter(matches);

    STAGES.forEach(function (stage) {
      var col = el("div", "col" + (stage.aside ? " aside" : ""));
      col.style.setProperty("--stage", stage.color);
      var isFolded = !!folded[stage.id];
      if (isFolded) { col.classList.add("folded"); }

      var mine = visible.filter(function (l) { return l.stage === stage.id; });

      var h = el("h2");
      var fold = el("button", "fold", isFolded ? "▸" : "▾");
      fold.type = "button";
      fold.title = (isFolded ? "Expand " : "Collapse ") + (stage.full || stage.name);
      fold.setAttribute("aria-expanded", isFolded ? "false" : "true");
      fold.addEventListener("click", function (ev) {
        ev.stopPropagation();
        folded[stage.id] = !folded[stage.id];
        render();
      });
      h.appendChild(fold);
      h.appendChild(el("span", "label", stage.name));
      h.appendChild(el("span", "count num", String(mine.length)));
      col.appendChild(h);

      var stack = el("div", "stack");
      if (!mine.length) {
        stack.appendChild(el("div", "empty", "Nothing here."));
      } else {
        // Grouped by cultivar *within this stage* — the same cultivar can sit
        // in several stages at once and must stay a separate row in each.
        var groups = [], byName = {};
        mine.forEach(function (l) {
          var gr = byName[l.cultivar];
          if (!gr) { gr = byName[l.cultivar] = { cultivar: l.cultivar, lots: [] }; groups.push(gr); }
          gr.lots.push(l);
        });
        groups.forEach(function (gr) {
          stack.appendChild(gr.lots.length === 1 ? makeCard(gr.lots[0]) : makeGroup(stage, gr));
        });
      }
      col.appendChild(stack);

      col.addEventListener("dragover", function (ev) {
        if (!dragId) { return; }
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        col.classList.add("drop");
      });
      col.addEventListener("dragleave", function () { col.classList.remove("drop"); });
      col.addEventListener("drop", function (ev) {
        col.classList.remove("drop");
        ev.preventDefault();
        var id = dragId || ev.dataTransfer.getData("text/plain");
        if (!id || !byId[id] || byId[id].stage === stage.id) { return; }
        patch(id, { stage: stage.id });
      });

      boardEl.appendChild(col);
    });

    if (selected && byId[selected]) { drawLot(selected); }
    fitNames();
  }

  // ---- drawer ------------------------------------------------------------
  function closeDrawer() {
    selected = null;
    drawerEl.hidden = true;
    drawerEl.textContent = "";
    render();
  }

  function openDrawer(id) {
    selected = id;
    drawerEl.hidden = false;
    render();
    var first = drawerEl.querySelector("select, input, textarea");
    if (first) { first.focus(); }
  }

  function group(label, node, hint) {
    var g = el("div", "grp");
    g.appendChild(el("div", "lbl", label));
    g.appendChild(node);
    if (hint) { g.appendChild(el("div", "hint", hint)); }
    return g;
  }

  function bindField(node, key, id) {
    node.addEventListener("change", function () {
      var v = node.value;
      var f = {};
      f[key] = v === "" ? null : v;
      patch(id, f);
    });
    return node;
  }

  function drawLot(id) {
    var lot = byId[id];
    drawerEl.textContent = "";

    var head = el("div", "head");
    var title = el("div");
    title.appendChild(el("h2", null, lot.cultivar));
    var sub = el("span", "sub", lot.zone + " · " + lot.farm);
    if (lot.updated_at) {
      sub.textContent += " · last touched " + lot.updated_at.slice(0, 16).replace("T", " ") +
        (lot.updated_by ? " by " + lot.updated_by : "");
    }
    title.appendChild(sub);
    head.appendChild(title);
    var x = el("button", null, "✕");
    x.type = "button";
    x.title = "Close";
    x.setAttribute("aria-label", "Close lot detail");
    x.addEventListener("click", closeDrawer);
    head.appendChild(x);
    drawerEl.appendChild(head);

    var body = el("div", "body");

    var sel = document.createElement("select");
    STAGES.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.full || s.name;
      sel.appendChild(o);
    });
    sel.value = lot.stage;
    sel.addEventListener("change", function () { patch(id, { stage: sel.value }); });
    var selWrap = el("span", "sel");
    selWrap.appendChild(sel);
    body.appendChild(group("Stage", selWrap, "Drag the card, or set it here on a phone."));

    var row = el("div", "row2");
    var d = document.createElement("input");
    d.type = "date";
    d.value = lot.test_date || "";
    row.appendChild(group("ODA test date", bindField(d, "test_date", id)));

    var t = document.createElement("input");
    t.type = "number";
    t.step = "0.01";
    t.min = "0";
    t.placeholder = "0.00";
    t.value = (lot.thc === null || lot.thc === undefined) ? "" : lot.thc;
    row.appendChild(group("Total THC %", bindField(t, "thc", id)));
    body.appendChild(row);

    var cannabinoids = el("div", "row2");
    var cb = document.createElement("input");
    cb.type = "number";
    cb.step = "0.01";
    cb.min = "0";
    cb.placeholder = "0.00";
    cb.value = (lot.cbd === null || lot.cbd === undefined) ? "" : lot.cbd;
    cannabinoids.appendChild(group("Total CBD %", bindField(cb, "cbd", id),
      "Both come off the same COA."));
    body.appendChild(cannabinoids);

    if (lot.stage === "drying" || lot.stage === "supersacked") {
      var s = document.createElement("input");
      s.type = "number";
      s.min = "0";
      s.placeholder = "0";
      s.value = (lot.sacks === null || lot.sacks === undefined) ? "" : lot.sacks;
      body.appendChild(group("Supersacks", bindField(s, "sacks", id),
        "Rough count for the board. Sack tags remain the record."));
    }

    var docWrap = el("div", "docs");
    if (!lot.docs.length) { docWrap.appendChild(el("div", "hint", "No documents linked yet.")); }
    lot.docs.forEach(function (doc, i) {
      var r = el("div", "doc");
      r.appendChild(el("span", "name", doc.label || "Document"));
      if (/^https?:\\/\\//i.test(doc.ref || "")) {
        var a = document.createElement("a");
        a.className = "ref";
        a.href = doc.ref;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = doc.ref;
        r.appendChild(a);
      } else {
        r.appendChild(el("span", "ref", doc.ref));
      }
      var del = el("button", null, "✕");
      del.type = "button";
      del.title = "Remove this link";
      del.setAttribute("aria-label", "Remove " + (doc.label || "document"));
      del.addEventListener("click", function () {
        var next = lot.docs.slice();
        next.splice(i, 1);
        patch(id, { docs: next });
      });
      r.appendChild(del);
      docWrap.appendChild(r);
    });

    var addRow = el("div", "row2");
    var lab = document.createElement("input");
    lab.type = "text";
    lab.placeholder = "COA, CWD form…";
    var ref = document.createElement("input");
    ref.type = "text";
    ref.placeholder = "Drive link or repo path";
    addRow.appendChild(lab);
    addRow.appendChild(ref);
    docWrap.appendChild(addRow);

    var add = el("button", "act", "Add link");
    add.type = "button";
    add.addEventListener("click", function () {
      var v = ref.value.trim();
      if (!v) { ref.focus(); return; }
      patch(id, { docs: lot.docs.concat([{ label: lab.value.trim() || "Document", ref: v }]) });
    });
    docWrap.appendChild(add);
    body.appendChild(group("Documents", docWrap,
      "Paste the Drive link or the repo path — the PDF itself stays where it lives."));

    var n = document.createElement("textarea");
    n.value = lot.notes || "";
    n.placeholder = "What the crew saw. Log gaps honestly — don't guess a clean number.";
    body.appendChild(group("Notes", bindField(n, "notes", id)));

    var links = el("div", "grp");
    links.appendChild(el("div", "lbl", "In the wiki"));
    links.appendChild(el("div", "hint", "wiki/products/cultivars/" + lot.cultivar_slug + ".md"));
    if (lot.map) {
      links.appendChild(el("div", "hint", "wiki/products/cultivars/images/" + lot.map));
    }
    body.appendChild(links);

    drawerEl.appendChild(body);
  }

  // ---- controls ----------------------------------------------------------
  qEl.addEventListener("input", render);
  farmEl.addEventListener("change", render);

  // Columns are flexible, so a resize changes how much room each name has.
  var fitTimer = null;
  window.addEventListener("resize", function () {
    if (fitTimer) { clearTimeout(fitTimer); }
    fitTimer = setTimeout(fitNames, 120);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && selected) { closeDrawer(); }
  });

  exportEl.addEventListener("click", function () {
    var payload = JSON.stringify({ season: 2026, exported: new Date().toISOString(), lots: lots }, null, 2);
    var blob = new Blob([payload], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "harvest-board-2026.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // Timber writes to the same D1 rows, so pick its changes up without a reload.
  setInterval(function () {
    if (!pass || selected) { return; }   // don't yank a card out from under an open drawer
    call("board", {}).then(function (data) {
      var fresh = data.lots || [];
      var changed = fresh.length !== lots.length;
      if (!changed) {
        for (var i = 0; i < fresh.length; i++) {
          var mine = byId[fresh[i].lot_id];
          if (!mine || mine.stage !== fresh[i].stage || mine.updated_at !== fresh[i].updated_at) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) { return; }
      lots = fresh;
      byId = {};
      lots.forEach(function (l) { l.docs = parseDocs(l.docs); byId[l.lot_id] = l; });
      render();
    })["catch"](function () { /* transient; the next tick retries */ });
  }, 30000);

  // ---- boot --------------------------------------------------------------
  var saved = "";
  try { saved = localStorage.getItem(KEY) || ""; } catch (e) { saved = ""; }

  if (saved) {
    pass = saved;
    shell.hidden = true;
    load().then(function () {
      shell.hidden = false;
    })["catch"](function (e) {
      pass = "";
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
      showGate(e.status === 401 ? "That saved password no longer works." : null);
    });
  } else {
    showGate(null);
  }
})();
</script>
</body>
</html>
`;
