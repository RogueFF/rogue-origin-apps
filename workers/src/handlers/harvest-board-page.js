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
  /* =====================================================================
     Tokens. The complete light palette lives on bare :root; the two dark
     blocks below redefine the same names and nothing else. Never introduce
     a colour inside a media or [data-theme] block only.
     ===================================================================== */
  :root {
    --paper:        #e8eae3;
    --surface:      #f5f6f1;
    --surface-2:    #dcdfd6;
    --line:         #c2c7ba;
    --line-soft:    #d4d8ce;
    --ink:          #171b18;
    --ink-2:        #454c49;
    --ink-3:        #626b65;
    --accent-ink:   #f7f8f4;   /* text on a solid stage/accent fill */

    --slate:        #2f5d7c;
    --slate-soft:   #d6e1e9;
    --amber:        #a9762a;
    --amber-soft:   #efe1c6;
    --leaf:         #3f6f48;
    --leaf-soft:    #d6e5d6;
    --rust:         #93392e;
    --rust-soft:    #efd8d3;

    /* Stage ramp: dormant grey -> flagged ochre -> booked slate -> cleared
       leaf -> cutting amber -> drying tobacco -> sacked deep green. Failed
       sits aside in rust. The ramp is the board's sequence, read left to
       right, so every stage gets its own hue rather than sharing. */
    --st-untested:     #8d948d;
    --st-to-schedule:  #b3892b;
    --st-scheduled:    #2f5d7c;
    --st-cleared:      #3f8a4f;
    --st-harvesting:   #c9772a;
    --st-drying:       #8a5a2c;
    --st-supersacked:  #23392b;
    --st-failed:       #93392e;

    --shadow:       0 1px 2px rgba(23, 27, 24, .10), 0 6px 16px -10px rgba(23, 27, 24, .22);
    --shadow-lift:  0 2px 4px rgba(23, 27, 24, .12), 0 12px 24px -12px rgba(23, 27, 24, .32);
    --focus:        #2f5d7c;
    --bar:          #b9bfb2;
    --bar-hover:    #98a08f;

    --col-min:      8.75rem;  /* floor before the rail starts scrolling */
    --col-max:      36rem;    /* the heaviest stage may go two cards wide */
    --spine:        2.75rem;  /* a folded or empty stage */
    --radius:       4px;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:        #131614;
      --surface:      #1b1f1c;
      --surface-2:    #262b27;
      --line:         #353b36;
      --line-soft:    #2a2f2b;
      --ink:          #e6e9e2;
      --ink-2:        #aab2ab;
      --ink-3:        #8f9a92;
      --accent-ink:   #111412;

      --slate:        #7fb0cf;
      --slate-soft:   #1e3140;
      --amber:        #d6a256;
      --amber-soft:   #3a2e19;
      --leaf:         #7fb185;
      --leaf-soft:    #1e2f21;
      --rust:         #d4796b;
      --rust-soft:    #3a221e;

      --st-untested:     #737b74;
      --st-to-schedule:  #d0a545;
      --st-scheduled:    #7fb0cf;
      --st-cleared:      #7fc38a;
      --st-harvesting:   #e39a4f;
      --st-drying:       #c2894f;
      --st-supersacked:  #a3cbb0;
      --st-failed:       #d4796b;

      --shadow:       0 1px 2px rgba(0, 0, 0, .45), 0 6px 16px -10px rgba(0, 0, 0, .7);
      --shadow-lift:  0 2px 4px rgba(0, 0, 0, .5), 0 12px 24px -12px rgba(0, 0, 0, .8);
      --focus:        #7fb0cf;
      --bar:          #3d443e;
      --bar-hover:    #555e56;
    }
  }

  :root[data-theme="dark"] {
    --paper:        #131614;
    --surface:      #1b1f1c;
    --surface-2:    #262b27;
    --line:         #353b36;
    --line-soft:    #2a2f2b;
    --ink:          #e6e9e2;
    --ink-2:        #aab2ab;
    --ink-3:        #8f9a92;
    --accent-ink:   #111412;

    --slate:        #7fb0cf;
    --slate-soft:   #1e3140;
    --amber:        #d6a256;
    --amber-soft:   #3a2e19;
    --leaf:         #7fb185;
    --leaf-soft:    #1e2f21;
    --rust:         #d4796b;
    --rust-soft:    #3a221e;

    --st-untested:     #737b74;
    --st-to-schedule:  #d0a545;
    --st-scheduled:    #7fb0cf;
    --st-cleared:      #7fc38a;
    --st-harvesting:   #e39a4f;
    --st-drying:       #c2894f;
    --st-supersacked:  #a3cbb0;
    --st-failed:       #d4796b;

    --shadow:       0 1px 2px rgba(0, 0, 0, .45), 0 6px 16px -10px rgba(0, 0, 0, .7);
    --shadow-lift:  0 2px 4px rgba(0, 0, 0, .5), 0 12px 24px -12px rgba(0, 0, 0, .8);
    --focus:        #7fb0cf;
    --bar:          #3d443e;
    --bar-hover:    #555e56;
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

  /* ---- shell ---------------------------------------------------------- */
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;   /* the mobile URL bar eats a slice of 100vh */
    min-height: 30rem;
  }

  /* ---- command bar ---------------------------------------------------- */
  header.bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .5rem .9rem;
    padding: .45rem .8rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .brand { display: flex; align-items: baseline; gap: .55rem; margin-right: auto; }

  .brand h1 {
    margin: 0;
    font-family: "Barlow Condensed", "Public Sans", sans-serif;
    font-weight: 700;
    font-size: 1.25rem;
    letter-spacing: .01em;
    white-space: nowrap;
  }

  .brand .season-tag {
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    color: var(--ink-3);
    letter-spacing: .08em;
    text-transform: uppercase;
    white-space: nowrap;
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
    letter-spacing: .08em;
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
    letter-spacing: .08em;
    color: var(--ink-2);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .38rem .75rem;
    cursor: pointer;
    transition: border-color .12s, color .12s, background-color .12s;
  }
  button.act:hover { border-color: var(--slate); color: var(--slate); }
  button.act[hidden] { display: none; }
  button.act:disabled { opacity: .55; cursor: default; }

  /* The one solid button on the page: the action most likely to be wanted. */
  button.act.primary {
    background: var(--slate);
    border-color: var(--slate);
    color: var(--accent-ink);
  }
  button.act.primary:hover { color: var(--accent-ink); filter: brightness(1.08); }

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

  /* ---- notices -------------------------------------------------------- */
  .notice {
    padding: .5rem 1rem;
    font-size: .82rem;
    border-bottom: 1px solid var(--line);
    background: var(--amber-soft);
    color: var(--ink);
  }
  .notice[hidden] { display: none; }
  .notice.bad { background: var(--rust-soft); }

  /* ---- season rail ------------------------------------------------------
     One strip that says where the season is. The bar's segments are the
     stage counts drawn to scale, in stage order; the chips beneath name and
     count them, and jump to the stage when tapped -- on a phone that is the
     way between panels. It is filled in by the app; the shell ships it empty. */
  .season {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .4rem 1.1rem;
    padding: .5rem .8rem .45rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .season:empty { display: none; }

  .season .stat {
    display: flex;
    align-items: baseline;
    gap: .35rem;
    white-space: nowrap;
  }
  .season .stat .big {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: 1.45rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: .01em;
  }
  .season .stat .of {
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  .season .track {
    flex: 1 1 14rem;
    display: flex;
    gap: 2px;
    height: 10px;
    min-width: 0;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .season .seg {
    flex: 0 0 auto;      /* width is set inline, to scale */
    min-width: 0;
    background: var(--stage, var(--line));
    cursor: pointer;
    transition: filter .12s;
  }
  .season .seg:hover { filter: brightness(1.15); }
  .season .seg.aside { margin-left: 6px; border-radius: 999px; }

  .season .chips {
    display: flex;
    gap: .3rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .season .chip {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    cursor: pointer;
    padding: .12rem .5rem .12rem .4rem;
    border: 1px solid transparent;
    border-radius: 999px;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .76rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--ink-2);
    white-space: nowrap;
    transition: background-color .12s, border-color .12s, color .12s;
  }
  .season .chip::before {
    content: "";
    width: .5rem;
    height: .5rem;
    border-radius: 999px;
    background: var(--stage, var(--line));
  }
  .season .chip .n {
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    font-size: .72rem;
    color: var(--ink-3);
  }
  .season .chip:hover { border-color: var(--line); background: var(--paper); }
  .season .chip.zero { color: var(--ink-3); }
  .season .chip.zero::before { background: transparent; box-shadow: inset 0 0 0 1.5px var(--stage, var(--line)); }
  .season .chip.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .season .chip.on .n { color: var(--paper); }
  .season .chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  /* ---- board ------------------------------------------------------------ */
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
    gap: .4rem;
    padding: .6rem .8rem .75rem;
    overflow-x: auto;
    overflow-y: hidden;
    align-items: stretch;
  }

  /* Each stage's width is its weight: the app sets flex-grow from how many
     rows the column holds, so the heavy end of the season gets the room and
     an empty stage folds to a labelled spine. The board's silhouette is the
     season's shape. */
  .col {
    flex: 1 1 0;
    min-width: var(--col-min);
    max-width: var(--col-max);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    transition: flex-basis .18s ease, min-width .18s ease, background-color .12s, border-color .12s;
  }

  .col.drop { border-color: var(--stage, var(--slate)); background: var(--slate-soft); }
  .col.aside { border-style: dashed; }
  .col.pulse { box-shadow: 0 0 0 2px var(--stage, var(--focus)); }

  .col > h2 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: .4rem;
    padding: .38rem .45rem .35rem;
    border-bottom: 1px solid var(--line-soft);
    /* stage stripe: a real sequence, so the ramp carries order */
    border-top: 3px solid var(--stage, var(--line));
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .82rem;
    text-transform: uppercase;
    letter-spacing: .06em;
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
    border-radius: 2px;
  }
  .col > h2 button.fold:hover { color: var(--slate); }
  .col > h2 button.fold:focus-visible { outline: 2px solid var(--focus); }

  .stack {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: .35rem;
    /* A wide column lays cards two abreast; a narrow one stays single. The
       floor keeps a card wide enough for a name to fit at a readable size,
       and the min() stops that floor from pushing the column wider than the
       rail gave it. */
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(10rem, 100%), 1fr));
    align-content: start;
    align-items: start;
    gap: .32rem;
  }

  /* Folded stage: a narrow spine. The roster is still a drop target, and the
     label reads down the spine so the sequence stays legible. */
  .col.folded { flex: 0 0 var(--spine); min-width: var(--spine); }
  .col.folded .stack { display: none; }
  .col.folded > h2 {
    flex-direction: column;
    gap: .55rem;
    height: 100%;
    align-items: center;
    padding: .55rem .2rem;
    cursor: pointer;
    border-bottom: 0;
  }
  .col.folded > h2:hover { color: var(--ink); }
  .col.folded > h2 .label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
  }
  .col.folded > h2 .count { margin-left: 0; }
  .col.folded > h2 .count.zero { background: transparent; color: var(--ink-3); }

  /* While a card is in the air, every spine widens so it can be hit; the one
     under the pointer opens fully. */
  .shell.lifting .col.folded { flex-basis: 4rem; min-width: 4rem; }
  .shell.lifting .col.folded.drop { flex-basis: 8rem; min-width: 8rem; }
  .shell.lifting .col.folded.drop > h2 .label { writing-mode: horizontal-tb; }

  .empty {
    grid-column: 1 / -1;
    margin: .1rem;
    padding: .9rem .5rem;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    color: var(--ink-3);
    font-size: .76rem;
    text-align: center;
    line-height: 1.4;
  }
  .empty b { display: block; font-weight: 600; color: var(--ink-2); }

  /* ---- card ------------------------------------------------------------- */
  .card {
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-left: 3px solid var(--stage, var(--line));
    border-radius: var(--radius);
    padding: .36rem .5rem .42rem;
    cursor: grab;
    display: grid;
    gap: .16rem;
    text-align: left;
    font: inherit;
    color: inherit;
    min-width: 0;
    box-shadow: var(--shadow);
    transition: border-color .12s, box-shadow .12s, transform .12s;
  }
  .card:hover { border-color: var(--line); box-shadow: var(--shadow-lift); transform: translateY(-1px); }
  .card[aria-selected="true"] { outline: 2px solid var(--focus); outline-offset: 1px; }
  .card.dragging { opacity: .4; cursor: grabbing; transform: none; }

  .card .top {
    display: flex;
    align-items: center;
    gap: .3rem;
    min-width: 0;
    min-height: 1rem;
  }

  /* The zone is the lot's address. Mono and quiet: it needs to be found, not
     to be the first thing seen. */
  .zone {
    font-family: "IBM Plex Mono", monospace;
    font-weight: 500;
    font-size: .68rem;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--ink-2);
    background: var(--surface-2);
    border-radius: 2px;
    padding: .03rem .3rem;
    white-space: nowrap;
  }

  .farm {
    font-family: "IBM Plex Mono", monospace;
    font-size: .62rem;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-left: auto;
    white-space: nowrap;
  }

  /* The name is what the eye lands on. */
  .cultivar {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: 1.02rem;
    /* Fixed, not a multiplier: fitNames() shrinks the font on long names, and
       a line box that scaled with it would give the column ragged card
       heights again. */
    line-height: 1.15rem;
    /* One line, always: a wrapped name gives the column ragged card heights
       and costs a row of scanning. A name too wide for its column is shrunk
       to fit by fitNames() rather than clipped; the ellipsis below is only a
       backstop for a name still too long at the minimum size. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The data line. Only the THC result is coloured, because only THC has a
     legal line to be on the right side of; everything else is plain figures. */
  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: .1rem .5rem;
    align-items: baseline;
    min-width: 0;
  }

  .mark {
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .7rem;
    letter-spacing: .02em;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .mark b { font-weight: 500; color: var(--ink-2); }
  .mark.thc-pass, .mark.thc-fail {
    font-weight: 500;
    border-radius: 2px;
    padding: 0 .3rem;
    margin-left: -.3rem;
  }
  .mark.thc-pass { color: var(--leaf); background: var(--leaf-soft); }
  .mark.thc-fail { color: var(--rust); background: var(--rust-soft); }
  .mark.sacks b   { color: var(--ink); }
  .mark.meta {
    font-size: .62rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .mark.meta.note { color: var(--amber); }

  /* ---- grouped duplicates ------------------------------------------------
     One cultivar in several zones is one row until you open it. The group is
     a container, not a lot: only the zone rows inside it drag. */
  .group { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }

  .card.grouphead { cursor: pointer; border-left-style: dashed; }
  .card.grouphead:hover { transform: none; }
  .group.open .card.grouphead { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }

  .caret {
    font-family: "IBM Plex Mono", monospace;
    font-size: .7rem;
    line-height: 1;
    color: var(--ink-3);
    flex: 0 0 auto;
  }

  /* A closed group previews its zones and clips what won't fit; the count
     pinned right says how many there are in all. */
  .zlist {
    display: flex;
    gap: .15rem;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent);
            mask-image: linear-gradient(90deg, #000 85%, transparent);
  }

  .zcount {
    margin-left: auto;
    flex: 0 0 auto;
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .66rem;
    letter-spacing: .02em;
    color: var(--ink-3);
    background: var(--surface-2);
    border-radius: 999px;
    padding: .05rem .4rem;
    white-space: nowrap;
  }

  .zones {
    display: flex;
    flex-direction: column;
    gap: .2rem;
    margin-left: .5rem;
    padding-left: .4rem;
    border-left: 2px solid var(--stage, var(--line-soft));
  }

  .zrow {
    display: flex;
    align-items: baseline;
    gap: .3rem .5rem;
    flex-wrap: wrap;
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    padding: .28rem .4rem;
    cursor: grab;
    transition: border-color .12s, box-shadow .12s;
  }
  .zrow:hover { border-color: var(--line); box-shadow: var(--shadow); }
  .zrow[aria-selected="true"] { outline: 2px solid var(--focus); outline-offset: 1px; }
  .zrow.dragging { opacity: .4; cursor: grabbing; }
  .zrow .marks { gap: .1rem .45rem; }

  /* ---- drawer ------------------------------------------------------------ */
  aside.drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 23rem;
    max-width: 100%;
    z-index: 4;
    box-shadow: var(--shadow-lift);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--line);
  }
  aside.drawer[hidden] { display: none; }

  .drawer .head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: .25rem .5rem;
    padding: .8rem 1rem .7rem;
    border-bottom: 1px solid var(--line-soft);
    border-top: 3px solid var(--stage, var(--line));
  }
  .drawer .head .eyebrow {
    grid-column: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: .35rem .5rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    letter-spacing: .04em;
    color: var(--ink-3);
  }
  .drawer .head h2 {
    grid-column: 1;
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 700;
    font-size: 1.5rem;
    line-height: 1.1;
    text-wrap: balance;
  }
  .drawer .head .stagepill {
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .7rem;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: var(--stage, var(--ink-2));
    border-radius: 999px;
    padding: .08rem .5rem;
  }
  .drawer .head button.close {
    all: unset;
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: start;
    cursor: pointer;
    color: var(--ink-3);
    font-family: "IBM Plex Mono", monospace;
    font-size: .95rem;
    line-height: 1;
    padding: .25rem .4rem;
    border-radius: var(--radius);
  }
  .drawer .head button.close:hover { color: var(--rust); background: var(--rust-soft); }
  .drawer .head button.close:focus-visible { outline: 2px solid var(--focus); }

  .drawer .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: .9rem 1rem 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }

  /* Sections: a small-caps heading with a rule running out to the edge. */
  .sec { display: flex; flex-direction: column; gap: .55rem; }
  .sec > .sh {
    display: flex;
    align-items: center;
    gap: .55rem;
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600;
    font-size: .78rem;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--ink-3);
  }
  .sec > .sh::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }

  .grp { display: flex; flex-direction: column; gap: .28rem; min-width: 0; }

  .grp > .lbl {
    font-family: "IBM Plex Mono", monospace;
    font-size: .64rem;
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
    padding: .4rem .5rem;
    font: inherit;
    font-size: .86rem;
  }
  .grp input[type="number"], .grp input[type="date"] {
    font-family: "IBM Plex Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size: .84rem;
  }
  .grp textarea { min-height: 5.5rem; resize: vertical; line-height: 1.5; }
  .grp input:focus, .grp select:focus, .grp textarea:focus {
    outline: none; border-color: var(--focus);
  }
  .grp .hint { font-size: .74rem; color: var(--ink-3); line-height: 1.4; }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
  .row3 { display: grid; grid-template-columns: 1.25fr 1fr 1fr; gap: .5rem; }
  .stagerow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; align-items: stretch; }
  .stagerow button.act { white-space: nowrap; }

  /* The verdict: the lab number read against the line that matters. */
  .verdict {
    display: flex;
    align-items: baseline;
    gap: .45rem;
    font-family: "IBM Plex Mono", monospace;
    font-size: .74rem;
    line-height: 1.4;
    padding: .4rem .55rem;
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--ink-2);
  }
  .verdict::before { content: ""; flex: 0 0 .5rem; width: .5rem; height: .5rem; border-radius: 999px; background: var(--line); }
  .verdict.pass { background: var(--leaf-soft); color: var(--leaf); }
  .verdict.pass::before { background: var(--leaf); }
  .verdict.fail { background: var(--rust-soft); color: var(--rust); }
  .verdict.fail::before { background: var(--rust); }

  .docs { display: flex; flex-direction: column; gap: .35rem; }

  /* Label over path, actions pinned right. The path used to sit in a flex row
     beside a long label, which squeezed it to a few pixels and -- with
     word-break: break-all -- wrapped it one character per line into an
     800px-tall card. It now gets its own row and truncates instead. */
  .doc {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: .1rem .4rem;
    background: var(--paper);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius);
    padding: .38rem .5rem;
  }
  .doc .name {
    grid-column: 1;
    font-size: .8rem;
    font-weight: 500;
    line-height: 1.25;
    min-width: 0;
  }
  .doc .ref {
    grid-column: 1;
    font-family: "IBM Plex Mono", monospace;
    font-size: .68rem;
    color: var(--ink-3);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;          /* keep the filename visible, clip the folders */
    text-align: left;
  }
  .doc .acts {
    grid-column: 2;
    grid-row: 1 / span 2;
    display: flex;
    align-items: center;
    gap: .15rem;
  }
  .doc a { color: var(--slate); }
  .doc button {
    all: unset; cursor: pointer; color: var(--ink-3);
    font-family: "Barlow Condensed", sans-serif;
    font-weight: 600; font-size: .78rem; letter-spacing: .06em;
    text-transform: uppercase;
    padding: .22rem .4rem; border-radius: var(--radius);
  }
  .doc button:hover { color: var(--slate); background: var(--slate-soft); }
  .doc button.rm:hover { color: var(--rust); background: var(--rust-soft); }
  .doc button:focus-visible { outline: 2px solid var(--focus); }
  .doc button:disabled { opacity: .5; cursor: default; }

  .drawer .meta {
    display: flex;
    flex-direction: column;
    gap: .25rem;
    padding-top: .8rem;
    border-top: 1px solid var(--line-soft);
    font-family: "IBM Plex Mono", monospace;
    font-size: .66rem;
    line-height: 1.4;
    color: var(--ink-3);
    word-break: break-all;
  }
  .drawer .meta .k {
    font-family: "Barlow Condensed", sans-serif;
    font-size: .7rem;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-right: .35rem;
  }

  .readonly .card { cursor: default; }
  .readonly .grp input,
  .readonly .grp select,
  .readonly .grp textarea { opacity: .65; }

  footer.foot {
    padding: .5rem 1rem .65rem;
    border-top: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink-3);
    font-size: .72rem;
    line-height: 1.5;
  }
  footer.foot strong { color: var(--ink-2); font-weight: 600; }
  footer.foot code {
    font-family: "IBM Plex Mono", monospace;
    font-size: .95em;
    color: var(--ink-2);
  }

  /* ---- scrollbars: the OS bar ate 16px of a 180px column ---------------- */
  .stack, .board, .drawer .body, .grp textarea, .season .chips {
    scrollbar-width: thin;
    scrollbar-color: var(--bar) transparent;
  }
  .stack::-webkit-scrollbar,
  .board::-webkit-scrollbar,
  .drawer .body::-webkit-scrollbar,
  .season .chips::-webkit-scrollbar,
  .grp textarea::-webkit-scrollbar { width: 8px; height: 8px; }

  .stack::-webkit-scrollbar-track,
  .board::-webkit-scrollbar-track,
  .drawer .body::-webkit-scrollbar-track,
  .season .chips::-webkit-scrollbar-track,
  .grp textarea::-webkit-scrollbar-track { background: transparent; }

  .stack::-webkit-scrollbar-thumb,
  .board::-webkit-scrollbar-thumb,
  .drawer .body::-webkit-scrollbar-thumb,
  .season .chips::-webkit-scrollbar-thumb,
  .grp textarea::-webkit-scrollbar-thumb {
    background: var(--bar);
    border-radius: 999px;
  }
  .stack::-webkit-scrollbar-thumb:hover,
  .board::-webkit-scrollbar-thumb:hover,
  .drawer .body::-webkit-scrollbar-thumb:hover,
  .season .chips::-webkit-scrollbar-thumb:hover,
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
    right: .55rem;
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
    background: var(--paper);
  }
  .field .sel::after { right: .1rem; }
  .field .sel select { padding-right: 1.1rem; background: transparent; }

  /* Applies to the dropdown list itself in Chromium/Windows. */
  select option,
  select optgroup {
    background: var(--surface);
    color: var(--ink);
  }


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
    gap: .75rem;
    width: min(24rem, 100%);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1.5rem 1.4rem 1.6rem;
    box-shadow: var(--shadow-lift);
    position: relative;
    overflow: hidden;
  }
  /* The stage ramp, as a stripe: the board's sequence before you're in. */
  .gate-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg,
      var(--st-untested) 0 14%, var(--st-to-schedule) 14% 28%, var(--st-scheduled) 28% 42%,
      var(--st-cleared) 42% 56%, var(--st-harvesting) 56% 70%, var(--st-drying) 70% 84%,
      var(--st-supersacked) 84% 100%);
  }
  .gate-card h1 {
    margin: 0;
    font-family: "Barlow Condensed", "Public Sans", sans-serif;
    font-weight: 700;
    font-size: 1.7rem;
    letter-spacing: .01em;
    line-height: 1.1;
  }
  .gate-card p { margin: 0; color: var(--ink-2); font-size: .86rem; line-height: 1.5; }
  .gate-card input {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .55rem .6rem;
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

  /* ---- phones: one stage per screen, swipe between them ------------------
     An 8-column rail on a 375px screen is unusable, so each populated stage
     becomes a near-full-width panel on a snap track, and an empty stage stays
     a spine that the track scrolls past without snapping. Drag-and-drop
     doesn't exist on touch anyway -- the drawer's stage controls are the way
     cards move here, and the season chips are the way between panels. */
  @media (max-width: 46rem) {
    header.bar { padding: .4rem .55rem; gap: .35rem .5rem; }
    .brand h1 { font-size: 1.1rem; }
    .brand .season-tag { display: none; }
    .controls { width: 100%; gap: .35rem; flex-wrap: nowrap; }
    .controls .field:first-child { flex: 1 1 0; min-width: 0; }
    /* The placeholder already says what the box is for. */
    .controls .field:first-child label { display: none; }
    .field { padding: .25rem .4rem; }
    .field input, .field select { min-width: 0; width: 100%; }
    /* Exporting board JSON is a desk job; on a phone it only costs a row. */
    #export { display: none; }
    .save { flex: 0 0 auto; min-width: 0; white-space: nowrap; }
    /* The footer is a reader's caveat; on a phone the rows go to the cards. */
    footer.foot { display: none; }

    .season { padding: .45rem .55rem .4rem; gap: .4rem .7rem; }
    .season .stat .big { font-size: 1.3rem; }
    .season .chips {
      flex: 1 0 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: .15rem;
      margin: 0 -.55rem;
      padding-left: .55rem;
      padding-right: .55rem;
      scrollbar-width: none;
    }
    .season .chips::-webkit-scrollbar { display: none; }
    .season .chip { font-size: .8rem; padding: .22rem .6rem .22rem .5rem; }

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

    /* A spine on the track: narrow, not a snap point, still a marker. */
    .col > h2 button.fold { display: none; }
    .col.folded {
      flex: 0 0 var(--spine);
      min-width: var(--spine);
      max-width: var(--spine);
      scroll-snap-align: none;
    }

    .col > h2 { padding: .5rem .6rem; font-size: .92rem; }
    .stack { padding: .4rem; gap: .4rem; grid-template-columns: 1fr; }

    /* Roomier tap targets, and larger type now that width is not scarce. */
    .card { padding: .5rem .6rem .55rem; gap: .2rem; }
    .card:hover { transform: none; }
    .zrow { padding: .45rem .5rem; min-height: 44px; }   /* touch target */
    .zones { margin-left: .6rem; padding-left: .5rem; }
    .zcount { font-size: .74rem; }
    .caret { font-size: .8rem; }
    .cultivar { font-size: 1.1rem; line-height: 1.3rem; }
    .zone { font-size: .76rem; }
    .mark { font-size: .76rem; }
    .mark.meta { font-size: .66rem; }
    .empty { font-size: .84rem; padding: 1.2rem .6rem; }

    aside.drawer {
      position: fixed;
      inset: auto 0 0 0;
      width: auto;
      max-width: none;
      height: 80dvh;
      border-left: 0;
      border-top: 1px solid var(--line);
      border-radius: 12px 12px 0 0;
      z-index: 5;
    }
    .drawer .head { border-radius: 12px 12px 0 0; padding-top: .95rem; position: relative; }
    .drawer .head::before {
      content: "";
      position: absolute;
      top: .35rem;
      left: 50%;
      width: 2.4rem;
      height: 4px;
      margin-left: -1.2rem;
      border-radius: 999px;
      background: var(--line);
    }
    .drawer .head button.close { font-size: 1.15rem; padding: .3rem .55rem; }
    .row3 { grid-template-columns: 1fr 1fr; }
    .row3 > :first-child { grid-column: 1 / -1; }
    .stagerow { grid-template-columns: 1fr; }
    .stagerow button.act { padding: .6rem .75rem; font-size: .95rem; }

    /* iOS zooms the page when a focused control is under 16px. */
    .field input, .field select,
    .grp input, .grp select, .grp textarea,
    .gate-card input { font-size: 16px; }
  }

  /* Touch pointers get the bigger hit areas regardless of window width. */
  @media (pointer: coarse) {
    .col > h2 button.fold { padding: .3rem .45rem; }
    .doc button { padding: .3rem .5rem; }
    .season .chip { padding: .22rem .6rem .22rem .5rem; }
  }
</style>
</head>
<body>
<div class="shell" hidden>
  <header class="bar">
    <div class="brand">
      <h1>Rogue Lot Board</h1>
      <span class="season-tag" id="season-tag">2026</span>
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

  <div class="season" id="season" aria-label="Season progress"></div>

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

<!-- The generator cuts the shell here and grafts the D1-backed app script on
     in its place (scripts/build-harvest-board-worker-page.py). Nothing below
     this marker is served. -->
<script>
(function () {
  "use strict";

  var API = "/api/harvest";
  var KEY = "rff-harvest-board-key";

  // Board order. The colours are the stage ramp from the stylesheet, one hue
  // per stage, so the same colour means the same stage on the rail, the
  // column stripe, the card edge and the drawer.
  var STAGES = [
    { id: "untested",    name: "Untested",    full: "Not yet tested",    color: "var(--st-untested)" },
    { id: "to_schedule", name: "To schedule", full: "Needs scheduling",  color: "var(--st-to-schedule)" },
    { id: "scheduled",   name: "Scheduled",   full: "Test scheduled",    color: "var(--st-scheduled)" },
    { id: "cleared",     name: "Cleared",     full: "Test cleared",      color: "var(--st-cleared)" },
    { id: "harvesting",  name: "Cutting",     full: "Harvesting",        color: "var(--st-harvesting)" },
    { id: "drying",      name: "Drying",      full: "Drying",            color: "var(--st-drying)" },
    { id: "supersacked", name: "Sacked",      full: "Supersacked",       color: "var(--st-supersacked)" },
    { id: "failed",      name: "Failed",      full: "Failed / destroyed", color: "var(--st-failed)", aside: true }
  ];
  var STAGE_BY_ID = {};
  STAGES.forEach(function (s) { STAGE_BY_ID[s.id] = s; });

  // The forward path. "failed" is off it: nothing advances into failure, it
  // is chosen on purpose from the stage picker.
  function nextStage(id) {
    var i = -1;
    for (var k = 0; k < STAGES.length; k++) { if (STAGES[k].id === id) { i = k; } }
    var n = STAGES[i + 1];
    return (i === -1 || !n || n.aside) ? null : n;
  }

  var THC_LIMIT = 0.3;   // ODA total-THC line, percent

  var lots = [];        // rows from D1, in board order
  var byId = {};
  var pass = "";
  var selected = null;
  var dragId = null;
  // Per stage: true = folded by hand, false = opened by hand, absent = automatic
  // (a stage with nothing in it folds to a spine until something lands there).
  var folded = {};
  var expanded = {};   // "<stage>|<cultivar>" -> group open

  var boardEl   = document.getElementById("board");
  var drawerEl  = document.getElementById("drawer");
  var seasonEl  = document.getElementById("season");
  var tagEl     = document.getElementById("season-tag");
  var qEl       = document.getElementById("q");
  var farmEl    = document.getElementById("farm");
  var saveEl    = document.getElementById("save");
  var noticeEl  = document.getElementById("notice");
  var exportEl  = document.getElementById("export");
  var shell     = document.querySelector(".shell");
  var phone     = window.matchMedia ? window.matchMedia("(max-width: 46rem)") : { matches: false };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(s) {
    var m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s || "");
    return m ? MONTHS[+m[2] - 1] + " " + (+m[3]) : (s || "");
  }
  function isSet(v) { return v !== null && v !== undefined && v !== ""; }

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

  // A committed COA path isn't something a browser can open, so the Worker
  // serves a copy from R2. It's fetched with the password in a header and
  // handed to the browser as a blob, so the credential never sits in a URL --
  // and the PDF opens in the built-in viewer, where Print already lives.
  function openDoc(doc, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    fetch(API + "?action=board_doc&ref=" + encodeURIComponent(doc.ref), {
      headers: { "Authorization": "Bearer " + pass }
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (j) {
          throw new Error((j && j.error) || ("HTTP " + r.status));
        }, function () { throw new Error("HTTP " + r.status); });
      }
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var w = window.open(url, "_blank");
      if (!w) {
        notify("Your browser blocked the popup — allow popups for this page to read COAs.", true);
      }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    })["catch"](function (e) {
      notify("Couldn't open that document: " + e.message, true);
    })["finally"](function () {
      btn.disabled = false;
      btn.textContent = label;
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

  // A figure with a quiet unit: "0.24 <b>THC</b>" reads as a number first.
  function figure(cls, value, unit) {
    var m = el("span", "mark " + cls);
    m.appendChild(document.createTextNode(value + " "));
    m.appendChild(el("b", null, unit));
    return m;
  }

  // The data line under a name. THC is the only coloured figure, because it
  // is the only one with a legal line to be on the right side of; CBD says
  // what the lot is worth, the date says when it was tested, and the rest
  // is small-caps housekeeping.
  function marksFor(lot) {
    var marks = el("div", "marks");
    if (isSet(lot.thc)) { marks.appendChild(figure(thcTone(lot.thc) || "", lot.thc, "THC")); }
    if (isSet(lot.cbd)) { marks.appendChild(figure("cbd", lot.cbd, "CBD")); }
    if (lot.sacks) { marks.appendChild(figure("sacks", lot.sacks, lot.sacks === 1 ? "sack" : "sacks")); }
    if (lot.test_date) { marks.appendChild(el("span", "mark date", fmtDate(lot.test_date))); }
    if (lot.docs.length) {
      marks.appendChild(el("span", "mark meta docs", lot.docs.length + " doc" + (lot.docs.length > 1 ? "s" : "")));
    }
    if ((lot.notes || "").trim()) { marks.appendChild(el("span", "mark meta note", "note")); }
    if (lot.updated_by === "timber") { marks.appendChild(el("span", "mark meta bot", "timber")); }
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
      shell.classList.add("lifting");   // folded stages widen into targets
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", lot.lot_id); } catch (e) { /* older browsers */ }
    });
    node.addEventListener("dragend", function () {
      dragId = null;
      node.classList.remove("dragging");
      shell.classList.remove("lifting");
    });
    return node;
  }

  // Zones repeat across farms, so with every farm on the board a card names
  // its farm too; filtered to one farm, the label would only be noise.
  function multiFarm() { return !farmEl.value; }

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
    if (!open) {
      // Closed, the row previews its zones; what won't fit fades out and the
      // count says how many there really are.
      var zl = el("span", "zlist");
      group.lots.forEach(function (l) { zl.appendChild(el("span", "zone", l.zone)); });
      top.appendChild(zl);
    }
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
    if (multiFarm()) { top.appendChild(el("span", "farm", lot.farm)); }
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

  // Grouped by cultivar *within this stage* — the same cultivar can sit in
  // several stages at once and must stay a separate row in each.
  function groupsOf(mine) {
    var groups = [], byName = {};
    mine.forEach(function (l) {
      var gr = byName[l.cultivar];
      if (!gr) { gr = byName[l.cultivar] = { cultivar: l.cultivar, lots: [] }; groups.push(gr); }
      gr.lots.push(l);
    });
    return groups;
  }

  function isFolded(stage, count) {
    if (folded[stage.id] === true) { return true; }
    if (folded[stage.id] === false) { return false; }
    return count === 0;
  }

  // Open a stage and bring it into view: from the season rail, or on a phone
  // where the rail is the way between panels.
  function jumpTo(stageId) {
    if (folded[stageId] !== false) { folded[stageId] = false; render(); }
    var col = boardEl.querySelector('.col[data-stage="' + stageId + '"]');
    if (!col) { return; }
    try {
      col.scrollIntoView({ behavior: "smooth", inline: phone.matches ? "center" : "nearest", block: "nearest" });
    } catch (e) { col.scrollIntoView(); }
    col.classList.add("pulse");
    setTimeout(function () { col.classList.remove("pulse"); markActive(); }, 900);
  }

  // The season rail: counts to scale, in stage order, over a one-line tally.
  function drawSeason(visible) {
    seasonEl.textContent = "";
    var total = visible.length;
    var counts = {};
    STAGES.forEach(function (s) { counts[s.id] = 0; });
    visible.forEach(function (l) { if (counts[l.stage] !== undefined) { counts[l.stage] += 1; } });

    var stat = el("div", "stat");
    stat.appendChild(el("span", "big num", String(counts.supersacked)));
    stat.appendChild(el("span", "of", "of " + total + " sacked"));
    seasonEl.appendChild(stat);

    var track = el("div", "track");
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", STAGES.map(function (s) { return s.name + " " + counts[s.id]; }).join(", "));
    STAGES.forEach(function (s) {
      var n = counts[s.id];
      if (!n) { return; }
      var seg = el("span", "seg" + (s.aside ? " aside" : ""));
      seg.style.setProperty("--stage", s.color);
      seg.style.width = (100 * n / total).toFixed(2) + "%";
      seg.title = s.name + ": " + n;
      seg.addEventListener("click", function () { jumpTo(s.id); });
      track.appendChild(seg);
    });
    seasonEl.appendChild(track);

    var chips = el("div", "chips");
    STAGES.forEach(function (s) {
      var n = counts[s.id];
      var chip = el("button", "chip" + (n ? "" : " zero"));
      chip.type = "button";
      chip.dataset.stage = s.id;
      chip.style.setProperty("--stage", s.color);
      chip.title = (s.full || s.name) + " — " + n + (n === 1 ? " lot" : " lots");
      chip.appendChild(document.createTextNode(s.name));
      chip.appendChild(el("span", "n num", String(n)));
      chip.addEventListener("click", function () { jumpTo(s.id); });
      chips.appendChild(chip);
    });
    seasonEl.appendChild(chips);

    if (tagEl) { tagEl.textContent = "2026 · " + lots.length + " lots"; }
    markActive();
  }

  // On the phone track, the chip for the panel in view is lit.
  var activeTimer = null;
  function markActive() {
    if (!phone.matches) {
      seasonEl.querySelectorAll(".chip.on").forEach(function (c) { c.classList.remove("on"); });
      return;
    }
    var cols = boardEl.querySelectorAll(".col:not(.folded)");
    var mid = boardEl.scrollLeft + boardEl.clientWidth / 2;
    var best = null, bestD = Infinity;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = c; }
    }
    seasonEl.querySelectorAll(".chip").forEach(function (chip) {
      chip.classList.toggle("on", !!best && chip.dataset.stage === best.dataset.stage);
    });
  }
  boardEl.addEventListener("scroll", function () {
    if (activeTimer) { return; }
    activeTimer = setTimeout(function () { activeTimer = null; markActive(); }, 80);
  }, { passive: true });

  function render() {
    boardEl.textContent = "";
    var visible = lots.filter(matches);
    drawSeason(visible);

    STAGES.forEach(function (stage) {
      var col = el("div", "col" + (stage.aside ? " aside" : ""));
      col.dataset.stage = stage.id;
      col.style.setProperty("--stage", stage.color);

      var mine = visible.filter(function (l) { return l.stage === stage.id; });
      var groups = groupsOf(mine);
      var fold = isFolded(stage, mine.length);
      if (fold) { col.classList.add("folded"); }

      // Width follows weight: a stage holding a dozen rows gets several times
      // the room of one holding a single card, and the heaviest may go two
      // cards abreast. Square root keeps the biggest from crowding out the
      // rest. The failed stage sits aside and never grows.
      var rows = groups.length + mine.length / 4;
      col.style.flexGrow = (fold || stage.aside) ? "0" : (0.6 + Math.sqrt(Math.min(rows, 30))).toFixed(2);

      var h = el("h2");
      var foldBtn = el("button", "fold", fold ? "▸" : "▾");
      foldBtn.type = "button";
      foldBtn.title = (fold ? "Expand " : "Collapse ") + (stage.full || stage.name);
      foldBtn.setAttribute("aria-expanded", fold ? "false" : "true");
      foldBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        folded[stage.id] = !fold;
        render();
      });
      h.appendChild(foldBtn);
      h.appendChild(el("span", "label", stage.name));
      h.appendChild(el("span", "count num" + (mine.length ? "" : " zero"), String(mine.length)));
      if (fold) {
        // The whole spine opens the stage; the arrow alone is a small target.
        h.title = "Open " + (stage.full || stage.name);
        h.addEventListener("click", function () { folded[stage.id] = false; render(); });
      }
      col.appendChild(h);

      var stack = el("div", "stack");
      if (!mine.length) {
        var empty = el("div", "empty");
        empty.appendChild(el("b", null, "No lots " + (stage.aside ? "failed" : stage.name.toLowerCase()) + "."));
        empty.appendChild(document.createTextNode(phone.matches
          ? "Set a lot's stage from its detail to move it here."
          : "Drop a card here to move it."));
        stack.appendChild(empty);
      } else {
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
        if (folded[stage.id] === true) { folded[stage.id] = false; }   // show where it went
        patch(id, { stage: stage.id });
      });

      boardEl.appendChild(col);
    });

    if (selected && byId[selected]) { drawLot(selected); }
    fitNames();
    markActive();
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

  function section(title) {
    var s = el("div", "sec");
    s.appendChild(el("div", "sh", title));
    return s;
  }

  function drawLot(id) {
    var lot = byId[id];
    var stage = STAGE_BY_ID[lot.stage] || STAGES[0];
    drawerEl.textContent = "";
    drawerEl.style.setProperty("--stage", stage.color);

    // Head: where it is, what it is, which stage it's in.
    var head = el("div", "head");
    var eyebrow = el("div", "eyebrow");
    eyebrow.appendChild(el("span", "zone", lot.zone));
    eyebrow.appendChild(document.createTextNode(lot.farm));
    var pill = el("span", "stagepill", stage.full || stage.name);
    pill.style.setProperty("--stage", stage.color);
    eyebrow.appendChild(pill);
    head.appendChild(eyebrow);
    head.appendChild(el("h2", null, lot.cultivar));
    var x = el("button", "close", "✕");
    x.type = "button";
    x.title = "Close";
    x.setAttribute("aria-label", "Close lot detail");
    x.addEventListener("click", closeDrawer);
    head.appendChild(x);
    drawerEl.appendChild(head);

    var body = el("div", "body");

    // Stage: the picker for any move, and one solid button for the move that
    // is nearly always the one wanted -- the next step along the path.
    var stageSec = section("Stage");
    var stagerow = el("div", "stagerow");
    var sel = document.createElement("select");
    STAGES.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.full || s.name;
      sel.appendChild(o);
    });
    sel.value = lot.stage;
    sel.setAttribute("aria-label", "Stage");
    sel.addEventListener("change", function () { patch(id, { stage: sel.value }); });
    var selWrap = el("span", "sel");
    selWrap.appendChild(sel);
    var selGrp = el("div", "grp");
    selGrp.appendChild(selWrap);
    stagerow.appendChild(selGrp);
    var next = nextStage(lot.stage);
    if (next) {
      var adv = el("button", "act primary", "Advance → " + next.name);
      adv.type = "button";
      adv.title = "Move to " + (next.full || next.name);
      adv.addEventListener("click", function () { patch(id, { stage: next.id }); });
      stagerow.appendChild(adv);
    }
    stageSec.appendChild(stagerow);
    if (lot.stage === "failed") {
      stageSec.appendChild(el("div", "hint", "Failed lots stay here as the record of the destroy."));
    }
    body.appendChild(stageSec);

    // The ODA test: date and the two figures off the same COA, then the
    // number read against the line.
    var testSec = section("ODA test");
    var row = el("div", "row3");
    var d = document.createElement("input");
    d.type = "date";
    d.value = lot.test_date || "";
    row.appendChild(group("Test date", bindField(d, "test_date", id)));

    var t = document.createElement("input");
    t.type = "number";
    t.step = "0.01";
    t.min = "0";
    t.placeholder = "0.00";
    t.inputMode = "decimal";
    t.value = isSet(lot.thc) ? lot.thc : "";
    row.appendChild(group("Total THC %", bindField(t, "thc", id)));

    var cb = document.createElement("input");
    cb.type = "number";
    cb.step = "0.01";
    cb.min = "0";
    cb.placeholder = "0.00";
    cb.inputMode = "decimal";
    cb.value = isSet(lot.cbd) ? lot.cbd : "";
    row.appendChild(group("Total CBD %", bindField(cb, "cbd", id)));
    testSec.appendChild(row);

    var verdict;
    if (!isSet(lot.thc)) {
      verdict = el("div", "verdict", "No result on file. The limit is " + THC_LIMIT + "% total THC.");
    } else if (parseFloat(lot.thc) > THC_LIMIT) {
      verdict = el("div", "verdict fail", lot.thc + "% total THC — over the " + THC_LIMIT + "% limit.");
    } else {
      verdict = el("div", "verdict pass", lot.thc + "% total THC — under the " + THC_LIMIT + "% limit.");
    }
    testSec.appendChild(verdict);
    body.appendChild(testSec);

    if (lot.stage === "drying" || lot.stage === "supersacked") {
      var harvestSec = section("Harvest");
      var s = document.createElement("input");
      s.type = "number";
      s.min = "0";
      s.placeholder = "0";
      s.inputMode = "numeric";
      s.value = isSet(lot.sacks) ? lot.sacks : "";
      harvestSec.appendChild(group("Supersacks", bindField(s, "sacks", id),
        "Rough count for the board. Sack tags remain the record."));
      body.appendChild(harvestSec);
    }

    var docSec = section("Documents");
    var docWrap = el("div", "docs");
    if (!lot.docs.length) { docWrap.appendChild(el("div", "hint", "No documents linked yet.")); }
    lot.docs.forEach(function (doc, i) {
      var r = el("div", "doc");
      var isUrl = /^https?:\\/\\//i.test(doc.ref || "");
      // Mirrors the server's allow-list: lab results and ODA turn-in maps.
      var isViewable = /^(raw\\/coas\\/|outputs\\/compliance\\/pdf\\/).+\\.pdf$/i.test(doc.ref || "");

      r.appendChild(el("span", "name", doc.label || "Document"));
      if (isUrl) {
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

      var acts = el("div", "acts");
      if (isViewable) {
        var open = el("button", null, "View");
        open.type = "button";
        open.title = "Open this document to read or print";
        open.addEventListener("click", function () { openDoc(doc, open); });
        acts.appendChild(open);
      }
      var del = el("button", "rm", "✕");
      del.type = "button";
      del.title = "Remove this link";
      del.setAttribute("aria-label", "Remove " + (doc.label || "document"));
      del.addEventListener("click", function () {
        var next = lot.docs.slice();
        next.splice(i, 1);
        patch(id, { docs: next });
      });
      acts.appendChild(del);
      r.appendChild(acts);
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
    var docGrp = el("div", "grp");
    docGrp.appendChild(docWrap);
    docGrp.appendChild(el("div", "hint",
      "Paste the Drive link or the repo path — the PDF itself stays where it lives."));
    docSec.appendChild(docGrp);
    body.appendChild(docSec);

    var noteSec = section("Notes");
    var n = document.createElement("textarea");
    n.value = lot.notes || "";
    n.placeholder = "What the crew saw. Log gaps honestly — don't guess a clean number.";
    n.setAttribute("aria-label", "Notes");
    var noteGrp = el("div", "grp");
    noteGrp.appendChild(bindField(n, "notes", id));
    noteSec.appendChild(noteGrp);
    body.appendChild(noteSec);

    // Housekeeping, last: who touched it and where it lives in the wiki.
    var meta = el("div", "meta");
    if (lot.updated_at) {
      var touched = el("div");
      touched.appendChild(el("span", "k", "Last touched"));
      touched.appendChild(document.createTextNode(
        lot.updated_at.slice(0, 16).replace("T", " ") + (lot.updated_by ? " by " + lot.updated_by : "")));
      meta.appendChild(touched);
    }
    var wiki = el("div");
    wiki.appendChild(el("span", "k", "Wiki"));
    wiki.appendChild(document.createTextNode("wiki/products/cultivars/" + lot.cultivar_slug + ".md"));
    meta.appendChild(wiki);
    if (lot.map) {
      var map = el("div");
      map.appendChild(el("span", "k", "Map"));
      map.appendChild(document.createTextNode("wiki/products/cultivars/images/" + lot.map));
      meta.appendChild(map);
    }
    body.appendChild(meta);

    drawerEl.appendChild(body);
  }

  // ---- controls ----------------------------------------------------------
  qEl.addEventListener("input", render);
  farmEl.addEventListener("change", render);

  // Columns are flexible, so a resize changes how much room each name has.
  var fitTimer = null;
  window.addEventListener("resize", function () {
    if (fitTimer) { clearTimeout(fitTimer); }
    fitTimer = setTimeout(function () { fitNames(); markActive(); }, 120);
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
