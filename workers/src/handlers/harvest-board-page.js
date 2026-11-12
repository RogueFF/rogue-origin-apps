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

  /* Anchors share this: the toolbar now holds a link to the cycle-time
     dashboard alongside the buttons, and it has to sit on the same baseline
     with the same weight rather than looking like stray body text. */
  button.act, a.act {
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
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    /* Buttons do not inherit line-height; anchors do. Without this the link
       stood 4px taller than the Export button next to it and sat 2px high. */
    line-height: normal;
    transition: border-color .12s, color .12s, background-color .12s;
  }
  button.act:hover, a.act:hover { border-color: var(--slate); color: var(--slate); }
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
      var(--st-untested) 0 25%, var(--st-scheduled) 25% 50%,
      var(--st-harvesting) 50% 75%, var(--st-cleared) 75% 100%);
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

  /* ---- COA chips ----
     Two per cultivar card, pre- and post-harvest. Green = on file, amber =
     missing: read from across the room before the name is. */
  .coas { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .4rem; }
  .coa {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    padding: .2rem .55rem;
    border-radius: 999px;
    font-size: .74rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }
  .coa b { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: .66rem; }
  .coa i { font-style: normal; font-weight: 500; opacity: .8; font-variant-numeric: tabular-nums; }
  .coa.have { color: var(--leaf); background: var(--leaf-soft); }
  .coa.miss { color: var(--amber); background: var(--amber-soft); }
  .coa.mini { padding: .1rem .45rem; font-size: .68rem; margin-left: auto; }
  .season .coagap { display: inline-flex; flex-wrap: wrap; gap: .3rem; margin-left: auto; }

  /* The zone lots listed inside a cultivar's detail. */
  .prelots { display: flex; flex-direction: column; gap: .25rem; margin-top: .5rem; }
  .prelots .zrow { cursor: pointer; align-items: center; }
  .prelots .zrow .farm { color: var(--ink-3); font-size: .74rem; margin: 0; letter-spacing: 0; text-transform: none; }
  .prelots .zrow .marks { margin: 0; }
  .prelots .zrow .act.mini {
    margin-left: auto;
    min-height: 0;
    height: auto;
    padding: .2rem .55rem;
    font-size: .7rem;
    line-height: 1.3;
  }

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

/* Harvest family styling; retain stage colors and the full board interaction. */
:root { --paper:#f6f5ef; --surface:#fff; --surface-2:#e9eedf; --line:#c8d2be; --line-soft:#d9dfd1; --ink:#263f32; --ink-2:#455b43; --ink-3:#60715d; }
.bar { padding-top:20px; padding-bottom:20px; }
.brand h1 { letter-spacing:-.03em; }
.act { min-height:44px; border-radius:8px; }
.gate-card { border-radius:16px; }
.foot { font-size:13px; }
@media(max-width:600px) { .board { gap:12px; } .doc button { min-height:44px; } }

</style>
</head>
<body>
<div class="shell" hidden>
  <header class="bar">
    <div class="brand">
      <h1>Rogue Lot Board</h1>
      <span class="season-tag" id="season-tag">2026</span>
    </div>

    <div class="controls"><a class="act" href="/api/harvest?action=hub">All tools</a>
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
      <!-- The daily action, so it sits first. Absolute path, not a bare
           \`?action=\`: the board is served from /api/harvest?action=board_page
           today, where a relative query string happens to resolve — and that is
           the exact assumption that silently lost every cutter count and
           trailer logged from a scanned QR code on 2026-09-04. -->
      <a class="act" id="printtags" href="/api/harvest?action=sack_print">Print tags</a>
      <a class="act" id="cycletimes" href="/api/harvest?action=harvest_dash">Cycle times</a>
      <button class="act" id="export" type="button">Export</button>
      <span class="save" id="save">&nbsp;</span>
    </div>
  </header>

  <div class="notice" id="notice" hidden></div>

  <div class="season" id="season" aria-label="Season progress"></div>

  <main>
    <div class="board" id="board"></div>
    <aside class="drawer" id="drawer" hidden aria-label="Cultivar detail"></aside>
  </main>

  <footer class="foot">
    Follow each cultivar from photos to the website. Green and amber chips show which COAs are on file; open a card for its COAs, zone lots and stage.
    For rack status, crew rates and scan history, open the <a href="/api/harvest?action=harvest_dash">harvest dashboard</a>.
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

  // Board order. Everything is harvested, so the board follows each CULTIVAR
  // after harvest: photos, then the website. One hue per stage, so the same
  // colour means the same stage on the rail, the column stripe, the card edge
  // and the drawer. "failed" is not a step: it holds the lots destroyed before
  // harvest, as the record.
  var STAGES = [
    { id: "not_sent",    name: "Not sent",    full: "Not sent for photos", color: "var(--st-untested)" },
    { id: "sent",        name: "Sent",        full: "Sent for photos",     color: "var(--st-scheduled)" },
    { id: "photos_done", name: "Photos done", full: "Photos done",         color: "var(--st-harvesting)" },
    { id: "on_website",  name: "On website",  full: "On website",          color: "var(--st-cleared)" },
    { id: "failed",      name: "Failed",      full: "Failed / destroyed lots", color: "var(--st-failed)", aside: true }
  ];
  var STAGE_BY_ID = {};
  STAGES.forEach(function (s) { STAGE_BY_ID[s.id] = s; });

  // The forward path. Nothing advances into "failed".
  function nextStage(id) {
    var i = -1;
    for (var k = 0; k < STAGES.length; k++) { if (STAGES[k].id === id) { i = k; } }
    var n = STAGES[i + 1];
    return (i === -1 || !n || n.aside) ? null : n;
  }

  var THC_LIMIT = 0.3;   // ODA total-THC line, percent (pre-harvest only)

  var cards = [];       // cultivar rows from D1, by name
  var cardBy = {};      // slug -> card
  var lots = [];        // the ODA pre-harvest lots
  var byId = {};        // lot_id -> lot
  var lotsBy = {};      // slug -> its lots
  var pass = "";
  // What the drawer shows: "c:<slug>" for a cultivar card, "l:<lot_id>" for
  // one of its pre-harvest lots.
  var selected = null;
  var dragKey = null;
  // Per stage: true = folded by hand, false = opened by hand, absent = automatic
  // (a stage with nothing in it folds to a spine until something lands there).
  var folded = {};

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
      "2026 cultivars after harvest: photos, website and COAs. This board carries test results, so it needs the farm password."));
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
        fitNames();
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
  function parseDocs(v) {
    if (Array.isArray(v)) { return v; }
    try { return JSON.parse(v || "[]"); } catch (e) { return []; }
  }

  function adopt(data) {
    lots = data.lots || [];
    cards = data.cultivars || [];
    byId = {};
    cardBy = {};
    lotsBy = {};
    cards.forEach(function (c) {
      c.docs = parseDocs(c.docs);
      cardBy[c.cultivar_slug] = c;
    });
    lots.forEach(function (l) {
      l.docs = parseDocs(l.docs);
      byId[l.lot_id] = l;
      (lotsBy[l.cultivar_slug] = lotsBy[l.cultivar_slug] || []).push(l);
    });
  }

  function load() {
    setSave("loading…", "working");
    return call("board", {}).then(function (data) {
      adopt(data);
      setSave("ready", "ok");
      notify("");
      render();
    });
  }

  function rowOf(key) {
    var id = key.slice(2);
    return key.charAt(0) === "c" ? cardBy[id] : byId[id];
  }

  // One write path for both kinds of row: change it on screen, send it, and
  // put it back if the save fails.
  function patch(key, fields) {
    var row = rowOf(key);
    var isCard = key.charAt(0) === "c";
    var id = key.slice(2);
    var before = {};
    Object.keys(fields).forEach(function (k) { before[k] = row[k]; });
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    render();

    setSave("saving…", "working");
    var payload = isCard ? { cultivar: id } : { lot: id };
    Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
    if (payload.docs) { payload.docs = JSON.stringify(payload.docs); }

    return call("board_set", payload).then(function (data) {
      var fresh = data && (isCard ? data.cultivar : data.lot);
      if (fresh) {
        fresh.docs = parseDocs(fresh.docs);
        Object.keys(fresh).forEach(function (k) { row[k] = fresh[k]; });
        render();
      }
      setSave("saved", "ok");
    })["catch"](function (e) {
      Object.keys(before).forEach(function (k) { row[k] = before[k]; });
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

  // Mirrors the server's allow-list: lab results and ODA turn-in maps.
  function isViewable(doc) {
    return /^(raw\\/coas\\/|outputs\\/compliance\\/pdf\\/).+\\.pdf$/i.test((doc && doc.ref) || "");
  }

  // ---- COAs --------------------------------------------------------------
  // A COA is a linked document labelled as one, or filed under raw/coas/.
  // Turn-in maps, CWD forms and photo folders are documents but not COAs --
  // and a Drive link is never judged by its address, which is random letters.
  function isCoa(doc) {
    return /coa/i.test((doc && doc.label) || "") || /^raw\\/coas\\//i.test((doc && doc.ref) || "");
  }
  function coaOf(docs) {
    for (var i = 0; i < docs.length; i++) { if (isCoa(docs[i])) { return docs[i]; } }
    return null;
  }

  // Pre-harvest COAs belong to the zone lots (one ODA test each); the
  // post-harvest COA belongs to the cultivar.
  function coaState(card) {
    var mine = lotsBy[card.cultivar_slug] || [];
    var pre = 0;
    mine.forEach(function (l) { if (coaOf(l.docs)) { pre += 1; } });
    return { lots: mine, pre: pre, post: !!coaOf(card.docs) };
  }

  function coaChip(label, have, detail) {
    var c = el("span", "coa " + (have ? "have" : "miss"));
    c.appendChild(el("b", null, label));
    c.appendChild(document.createTextNode(have ? "✓" : "missing"));
    if (detail) { c.appendChild(el("i", null, detail)); }
    c.title = label + (have ? " on file" : " not on file") + (detail ? " (" + detail + " zone lots)" : "");
    return c;
  }

  // ---- render ------------------------------------------------------------
  function lotMatches(lot) {
    if (farmEl.value && lot.farm !== farmEl.value) { return false; }
    var q = qEl.value.trim().toLowerCase();
    if (!q) { return true; }
    return (lot.cultivar + " " + lot.zone + " " + lot.farm).toLowerCase().indexOf(q) !== -1;
  }

  // A card shows when any of its lots does: filtering to a farm gives that
  // farm's cultivars, and searching a zone finds what was planted there.
  function cardMatches(card) {
    var mine = lotsBy[card.cultivar_slug] || [];
    if (!mine.length) {
      return !farmEl.value && card.cultivar.toLowerCase().indexOf(qEl.value.trim().toLowerCase()) !== -1;
    }
    for (var i = 0; i < mine.length; i++) { if (lotMatches(mine[i])) { return true; } }
    return false;
  }

  function thcTone(v) {
    var n = parseFloat(v);
    if (isNaN(n)) { return null; }
    return n > THC_LIMIT ? "thc-fail" : "thc-pass";
  }

  // A figure with a quiet unit: "0.24 <b>THC</b>" reads as a number first.
  function figure(cls, value, unit) {
    var m = el("span", "mark " + cls);
    m.appendChild(document.createTextNode(value + " "));
    m.appendChild(el("b", null, unit));
    return m;
  }

  // The data line for one pre-harvest lot. THC is the only coloured figure,
  // because pre-harvest it is the only one with a legal line.
  function marksFor(lot) {
    var marks = el("div", "marks");
    if (lot.stage === "failed") { marks.appendChild(el("span", "mark thc-fail", "failed")); }
    if (isSet(lot.thc)) { marks.appendChild(figure(thcTone(lot.thc) || "", lot.thc, "THC")); }
    if (isSet(lot.cbd)) { marks.appendChild(figure("cbd", lot.cbd, "CBD")); }
    if (lot.test_date) { marks.appendChild(el("span", "mark date", fmtDate(lot.test_date))); }
    if (lot.docs.length) {
      marks.appendChild(el("span", "mark meta docs", lot.docs.length + " doc" + (lot.docs.length > 1 ? "s" : "")));
    }
    if ((lot.notes || "").trim()) { marks.appendChild(el("span", "mark meta note", "note")); }
    return marks.childNodes.length ? marks : null;
  }

  function wireOpen(node, key, title) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-selected", selected === key ? "true" : "false");
    if (title) { node.title = title; }
    node.addEventListener("click", function () { openDrawer(key); });
    node.addEventListener("keydown", function (ev) {
      if (ev.target !== node) { return; }
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openDrawer(key); }
    });
    return node;
  }

  // One card per cultivar. The name is the hero; under it, the two COAs as
  // chips you can read from across the room: green = on file, amber = missing.
  // (Names no cultivar in this source -- the file is served pre-auth and the
  // public shell must carry no lot data. test-harvest-board.mjs asserts it.)
  function makeCard(card) {
    var key = "c:" + card.cultivar_slug;
    var st = coaState(card);
    var node = wireOpen(el("div", "card"), key,
      card.cultivar + " — " + st.lots.map(function (l) { return l.zone; }).join(", "));
    node.draggable = true;
    node.dataset.id = key;
    node.addEventListener("dragstart", function (ev) {
      dragKey = key;
      node.classList.add("dragging");
      shell.classList.add("lifting");   // folded stages widen into targets
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", key); } catch (e) { /* older browsers */ }
    });
    node.addEventListener("dragend", function () {
      dragKey = null;
      node.classList.remove("dragging");
      shell.classList.remove("lifting");
    });

    var top = el("div", "top");
    var zl = el("span", "zlist");
    st.lots.forEach(function (l) { zl.appendChild(el("span", "zone", l.zone)); });
    top.appendChild(zl);
    if (st.lots.length > 1) { top.appendChild(el("span", "zcount", st.lots.length + " zones")); }
    node.appendChild(top);
    node.appendChild(el("div", "cultivar", card.cultivar));

    var coas = el("div", "coas");
    coas.appendChild(coaChip("Pre COA", st.pre > 0,
      st.lots.length > 1 ? st.pre + "/" + st.lots.length : ""));
    coas.appendChild(coaChip("Post COA", st.post, ""));
    node.appendChild(coas);

    var marks = el("div", "marks");
    if (isSet(card.post_cbd)) { marks.appendChild(figure("cbd", card.post_cbd, "CBD")); }
    if (card.url) { marks.appendChild(el("span", "mark meta docs", "listed")); }
    if ((card.notes || "").trim()) { marks.appendChild(el("span", "mark meta note", "note")); }
    if (card.updated_by === "timber") { marks.appendChild(el("span", "mark meta bot", "timber")); }
    if (marks.childNodes.length) { node.appendChild(marks); }

    return node;
  }

  // A failed lot, in the aside lane: opens, never drags.
  function makeLotCard(lot) {
    var node = wireOpen(el("div", "card"), "l:" + lot.lot_id,
      lot.cultivar + " — " + lot.zone + ", " + lot.farm);
    var top = el("div", "top");
    top.appendChild(el("span", "zone", lot.zone));
    top.appendChild(el("span", "farm", lot.farm));
    node.appendChild(top);
    node.appendChild(el("div", "cultivar", lot.cultivar));
    var marks = marksFor(lot);
    if (marks) { node.appendChild(marks); }
    return node;
  }

  // ---- fit long names -----------------------------------------------------
  // A name wider than its column is shrunk until it fits rather than clipped,
  // so nothing is lost to an ellipsis. Reads and writes are batched: measuring
  // one element at a time while also setting styles would force a reflow per
  // card.
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

  // What sits in a stage: cultivar cards on the path, failed lots in the aside.
  function inStage(stage, vCards, vFailed) {
    if (stage.aside) { return vFailed; }
    return vCards.filter(function (c) { return c.stage === stage.id; });
  }

  // The season rail: counts to scale, in stage order, over a one-line tally,
  // then how many of the cards on screen still lack each COA.
  function drawSeason(vCards, vFailed) {
    seasonEl.textContent = "";
    var total = vCards.length;
    var counts = {};
    STAGES.forEach(function (s) { counts[s.id] = inStage(s, vCards, vFailed).length; });

    var stat = el("div", "stat");
    stat.appendChild(el("span", "big num", String(counts.on_website)));
    stat.appendChild(el("span", "of", "of " + total + " on website"));
    seasonEl.appendChild(stat);

    var track = el("div", "track");
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", STAGES.map(function (s) { return s.name + " " + counts[s.id]; }).join(", "));
    STAGES.forEach(function (s) {
      var n = counts[s.id];
      if (!n || s.aside || !total) { return; }
      var seg = el("span", "seg");
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
      chip.title = (s.full || s.name) + " — " + n;
      chip.appendChild(document.createTextNode(s.name));
      chip.appendChild(el("span", "n num", String(n)));
      chip.addEventListener("click", function () { jumpTo(s.id); });
      chips.appendChild(chip);
    });

    var noPre = 0, noPost = 0;
    vCards.forEach(function (c) {
      var st = coaState(c);
      if (!st.pre) { noPre += 1; }
      if (!st.post) { noPost += 1; }
    });
    var gap = el("span", "coagap");
    gap.appendChild(coaChip("Pre COA", !noPre, noPre ? noPre + " missing" : "all in"));
    gap.appendChild(coaChip("Post COA", !noPost, noPost ? noPost + " missing" : "all in"));
    chips.appendChild(gap);
    seasonEl.appendChild(chips);

    if (tagEl) { tagEl.textContent = "2026 · " + cards.length + " cultivars · " + lots.length + " lots"; }
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
    var vCards = cards.filter(cardMatches);
    var vFailed = lots.filter(function (l) { return l.stage === "failed" && lotMatches(l); });
    drawSeason(vCards, vFailed);

    STAGES.forEach(function (stage) {
      var col = el("div", "col" + (stage.aside ? " aside" : ""));
      col.dataset.stage = stage.id;
      col.style.setProperty("--stage", stage.color);

      var mine = inStage(stage, vCards, vFailed);
      var fold = isFolded(stage, mine.length);
      if (fold) { col.classList.add("folded"); }

      // Width follows weight: a stage holding a dozen cards gets several times
      // the room of one holding a single card, and the heaviest may go two
      // cards abreast. Square root keeps the biggest from crowding out the
      // rest. The failed lane sits aside and never grows.
      col.style.flexGrow = (fold || stage.aside) ? "0" : (0.6 + Math.sqrt(Math.min(mine.length, 30))).toFixed(2);

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
        if (stage.aside) {
          empty.appendChild(el("b", null, "No lots failed."));
        } else {
          empty.appendChild(el("b", null, "Nothing " + stage.name.toLowerCase() + "."));
          empty.appendChild(document.createTextNode(phone.matches
            ? "Set a cultivar's stage from its detail to move it here."
            : "Drop a card here to move it."));
        }
        stack.appendChild(empty);
      } else {
        mine.forEach(function (row) {
          stack.appendChild(stage.aside ? makeLotCard(row) : makeCard(row));
        });
      }
      col.appendChild(stack);

      // Only the path takes drops: nothing is dragged into "failed".
      if (!stage.aside) {
        col.addEventListener("dragover", function (ev) {
          if (!dragKey) { return; }
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          col.classList.add("drop");
        });
        col.addEventListener("dragleave", function () { col.classList.remove("drop"); });
        col.addEventListener("drop", function (ev) {
          col.classList.remove("drop");
          ev.preventDefault();
          var key = dragKey || ev.dataTransfer.getData("text/plain");
          var row = key && key.charAt(0) === "c" ? rowOf(key) : null;
          if (!row || row.stage === stage.id) { return; }
          if (folded[stage.id] === true) { folded[stage.id] = false; }   // show where it went
          patch(key, { stage: stage.id });
        });
      }

      boardEl.appendChild(col);
    });

    if (selected && rowOf(selected)) { drawSelected(); }
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

  function openDrawer(key) {
    selected = key;
    drawerEl.hidden = false;
    render();
    drawerEl.scrollTop = 0;
  }

  function drawSelected() {
    if (selected.charAt(0) === "c") { drawCard(selected); }
    else { drawLot(selected); }
  }

  function group(label, node, hint) {
    var g = el("div", "grp");
    g.appendChild(el("div", "lbl", label));
    g.appendChild(node);
    if (hint) { g.appendChild(el("div", "hint", hint)); }
    return g;
  }

  function bindField(node, field, key) {
    node.addEventListener("change", function () {
      var v = node.value;
      var f = {};
      f[field] = v === "" ? null : v;
      patch(key, f);
    });
    return node;
  }

  function section(title) {
    var s = el("div", "sec");
    s.appendChild(el("div", "sh", title));
    return s;
  }

  function numberInput(value, step) {
    var n = document.createElement("input");
    n.type = "number";
    n.step = step;
    n.min = "0";
    n.placeholder = "0.00";
    n.inputMode = "decimal";
    n.value = isSet(value) ? value : "";
    return n;
  }

  function closeButton() {
    var x = el("button", "close", "✕");
    x.type = "button";
    x.title = "Close";
    x.setAttribute("aria-label", "Close detail");
    x.addEventListener("click", closeDrawer);
    return x;
  }

  // The linked documents of a card or a lot: view, remove, add.
  function docList(key, row, emptyText, labelHint, defaultLabel) {
    var docWrap = el("div", "docs");
    if (!row.docs.length) { docWrap.appendChild(el("div", "hint", emptyText)); }
    row.docs.forEach(function (doc, i) {
      var r = el("div", "doc");
      var isUrl = /^https?:\\/\\//i.test(doc.ref || "");

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
      if (isViewable(doc)) {
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
        var next = row.docs.slice();
        next.splice(i, 1);
        patch(key, { docs: next });
      });
      acts.appendChild(del);
      r.appendChild(acts);
      docWrap.appendChild(r);
    });

    var addRow = el("div", "row2");
    var lab = document.createElement("input");
    lab.type = "text";
    lab.placeholder = labelHint;
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
      patch(key, { docs: row.docs.concat([{ label: lab.value.trim() || defaultLabel, ref: v }]) });
    });
    docWrap.appendChild(add);

    var docGrp = el("div", "grp");
    docGrp.appendChild(docWrap);
    docGrp.appendChild(el("div", "hint",
      "Paste the Drive link or the repo path — the PDF itself stays where it lives."));
    return docGrp;
  }

  function noteSection(key, row, placeholder) {
    var noteSec = section("Notes");
    var n = document.createElement("textarea");
    n.value = row.notes || "";
    n.placeholder = placeholder;
    n.setAttribute("aria-label", "Notes");
    var noteGrp = el("div", "grp");
    noteGrp.appendChild(bindField(n, "notes", key));
    noteSec.appendChild(noteGrp);
    return noteSec;
  }

  function touchedLine(row) {
    if (!row.updated_at) { return null; }
    var touched = el("div");
    touched.appendChild(el("span", "k", "Last touched"));
    touched.appendChild(document.createTextNode(
      row.updated_at.slice(0, 16).replace("T", " ") + (row.updated_by ? " by " + row.updated_by : "")));
    return touched;
  }

  // ---- a cultivar card ---------------------------------------------------
  function drawCard(key) {
    var card = rowOf(key);
    var st = coaState(card);
    var stage = STAGE_BY_ID[card.stage] || STAGES[0];
    drawerEl.textContent = "";
    drawerEl.style.setProperty("--stage", stage.color);

    var head = el("div", "head");
    var eyebrow = el("div", "eyebrow");
    eyebrow.appendChild(document.createTextNode(
      st.lots.length + (st.lots.length === 1 ? " zone lot" : " zone lots")));
    var pill = el("span", "stagepill", stage.full || stage.name);
    pill.style.setProperty("--stage", stage.color);
    eyebrow.appendChild(pill);
    head.appendChild(eyebrow);
    head.appendChild(el("h2", null, card.cultivar));
    head.appendChild(closeButton());
    drawerEl.appendChild(head);

    var body = el("div", "body");

    // Stage: the picker for any move, and one solid button for the move that
    // is nearly always the one wanted -- the next step along the path.
    var stageSec = section("Photos and website");
    var stagerow = el("div", "stagerow");
    var sel = document.createElement("select");
    STAGES.forEach(function (s) {
      if (s.aside) { return; }
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.full || s.name;
      sel.appendChild(o);
    });
    sel.value = card.stage;
    sel.setAttribute("aria-label", "Stage");
    sel.addEventListener("change", function () { patch(key, { stage: sel.value }); });
    var selWrap = el("span", "sel");
    selWrap.appendChild(sel);
    var selGrp = el("div", "grp");
    selGrp.appendChild(selWrap);
    stagerow.appendChild(selGrp);
    var next = nextStage(card.stage);
    if (next) {
      var adv = el("button", "act primary", "Advance → " + next.name);
      adv.type = "button";
      adv.title = "Move to " + (next.full || next.name);
      adv.addEventListener("click", function () { patch(key, { stage: next.id }); });
      stagerow.appendChild(adv);
    }
    stageSec.appendChild(stagerow);

    var u = document.createElement("input");
    u.type = "url";
    u.placeholder = "https://…";
    u.value = card.url || "";
    stageSec.appendChild(group("Product page", bindField(u, "url", key),
      "The listing's link, once it is on the website."));
    if (card.url) {
      var go = document.createElement("a");
      go.className = "act";
      go.href = card.url;
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      go.textContent = "Open the listing";
      stageSec.appendChild(go);
    }
    body.appendChild(stageSec);

    // Post-harvest: one dried-flower potency COA for the cultivar.
    var postSec = section("Post-harvest COA");
    postSec.appendChild(el("div", "verdict" + (st.post ? " pass" : ""),
      st.post ? "Post-harvest COA on file." : "No post-harvest COA on file yet."));
    var row = el("div", "row3");
    var d = document.createElement("input");
    d.type = "date";
    d.value = card.post_date || "";
    row.appendChild(group("Reported", bindField(d, "post_date", key)));
    row.appendChild(group("Total THC %", bindField(numberInput(card.post_thc, "0.001"), "post_thc", key)));
    row.appendChild(group("Total CBD %", bindField(numberInput(card.post_cbd, "0.1"), "post_cbd", key)));
    postSec.appendChild(row);
    postSec.appendChild(docList(key, card, "No post-harvest COA linked yet.",
      "Post-harvest COA", "Post-harvest COA"));
    body.appendChild(postSec);

    // Pre-harvest: one ODA test per zone lot. Each row opens its lot.
    var preSec = section("Pre-harvest COA");
    preSec.appendChild(el("div", "verdict" + (st.pre ? " pass" : ""),
      st.pre + " of " + st.lots.length + (st.lots.length === 1 ? " zone lot has" : " zone lots have") +
      " a pre-harvest COA on file."));
    var zones = el("div", "prelots");
    st.lots.forEach(function (lot) {
      var zrow = wireOpen(el("div", "zrow"), "l:" + lot.lot_id, "Open " + lot.zone + ", " + lot.farm);
      zrow.appendChild(el("span", "zone", lot.zone));
      zrow.appendChild(el("span", "farm", lot.farm));
      var m = marksFor(lot);
      if (m) { zrow.appendChild(m); }
      var coa = coaOf(lot.docs);
      if (coa && isViewable(coa)) {
        var view = el("button", "act mini", "View COA");
        view.type = "button";
        view.addEventListener("click", function (ev) { ev.stopPropagation(); openDoc(coa, view); });
        zrow.appendChild(view);
      } else if (!coa) {
        zrow.appendChild(el("span", "coa miss mini", "no COA"));
      }
      zones.appendChild(zrow);
    });
    preSec.appendChild(zones);
    body.appendChild(preSec);

    body.appendChild(noteSection(key, card, "Who has the sample, when photos are due, what the listing still needs."));

    var meta = el("div", "meta");
    var touched = touchedLine(card);
    if (touched) { meta.appendChild(touched); }
    var wiki = el("div");
    wiki.appendChild(el("span", "k", "Wiki"));
    wiki.appendChild(document.createTextNode("wiki/products/cultivars/" + card.cultivar_slug + ".md"));
    meta.appendChild(wiki);
    body.appendChild(meta);

    drawerEl.appendChild(body);
  }

  // ---- one pre-harvest lot -----------------------------------------------
  function drawLot(key) {
    var lot = rowOf(key);
    var failed = lot.stage === "failed";
    var parent = cardBy[lot.cultivar_slug];
    var stage = failed ? STAGE_BY_ID.failed : (STAGE_BY_ID[parent && parent.stage] || STAGES[0]);
    drawerEl.textContent = "";
    drawerEl.style.setProperty("--stage", stage.color);

    var head = el("div", "head");
    var eyebrow = el("div", "eyebrow");
    eyebrow.appendChild(el("span", "zone", lot.zone));
    eyebrow.appendChild(document.createTextNode(lot.farm));
    var pill = el("span", "stagepill", failed ? "Failed / destroyed" : "Pre-harvest lot");
    pill.style.setProperty("--stage", stage.color);
    eyebrow.appendChild(pill);
    head.appendChild(eyebrow);
    head.appendChild(el("h2", null, lot.cultivar));
    head.appendChild(closeButton());
    drawerEl.appendChild(head);

    var body = el("div", "body");

    if (parent) {
      var back = el("button", "act", "← Back to the cultivar");
      back.type = "button";
      back.addEventListener("click", function () { openDrawer("c:" + parent.cultivar_slug); });
      body.appendChild(back);
    }
    if (failed) {
      body.appendChild(el("div", "hint", "Failed lots stay here as the record of the destroy."));
    }

    // The ODA test: date and the two figures off the same COA, then the
    // number read against the line.
    var testSec = section("ODA pre-harvest test");
    var row = el("div", "row3");
    var d = document.createElement("input");
    d.type = "date";
    d.value = lot.test_date || "";
    row.appendChild(group("Test date", bindField(d, "test_date", key)));
    row.appendChild(group("Total THC %", bindField(numberInput(lot.thc, "0.01"), "thc", key)));
    row.appendChild(group("Total CBD %", bindField(numberInput(lot.cbd, "0.01"), "cbd", key)));
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

    var docSec = section("Documents");
    docSec.appendChild(docList(key, lot, "No documents linked yet.",
      "Pre-harvest COA, CWD form…", "Pre-harvest COA"));
    body.appendChild(docSec);

    body.appendChild(noteSection(key, lot, "What the crew saw. Log gaps honestly — don't guess a clean number."));

    // Housekeeping, last: who touched it and where it lives in the wiki.
    var meta = el("div", "meta");
    var touched = touchedLine(lot);
    if (touched) { meta.appendChild(touched); }
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
    var payload = JSON.stringify({
      season: 2026, exported: new Date().toISOString(), cultivars: cards, lots: lots
    }, null, 2);
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
  function stamp(rows, idKey) {
    return rows.map(function (r) { return r[idKey] + "|" + r.stage + "|" + (r.updated_at || ""); }).join("\\n");
  }
  setInterval(function () {
    if (!pass || selected) { return; }   // don't yank a card out from under an open drawer
    call("board", {}).then(function (data) {
      var same = stamp(data.cultivars || [], "cultivar_slug") === stamp(cards, "cultivar_slug") &&
                 stamp(data.lots || [], "lot_id") === stamp(lots, "lot_id");
      if (same || selected) { return; }
      adopt(data);
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
      fitNames();
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
