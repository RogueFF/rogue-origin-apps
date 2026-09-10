/** Self-contained scan-page theme, inlined for barn connectivity. */
export const SACK_DETAIL_STYLE = `
  body:has(.sd) { background: #f5f7f4; color: #243d32; padding: 28px 24px 40px; }
  body:has(.sd) > .lang { display: none; }
  .sd-language { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px;
    align-items: center; font: 13px system-ui, sans-serif; letter-spacing: 0; }
  .sd-language a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none;
    box-sizing: border-box; padding: 8px 18px; background: #ffffff; border: 1px solid #cfD4c7;
    color: #284c39; font: 600 14px system-ui, sans-serif; }
  body.testmode:has(.sd) .lang { top: 76px; }
  .sd { max-width: 1120px; margin: 0 auto; color: #243d32; font-variant-numeric: tabular-nums;
    --card: #ffffff; --raised: #e7ebdf; --line: #dce0d3; --ink2: #344c3f; --muted: #5d6d5f;
    --straw: #c99f38; --tops: #28563d; --smalls: #88a86b; --biomass: #7b9fba; --trim: #ce9f43;
    --waste: #a8afa1; --lift: none; }
  .sd-brand { display: flex; align-items: center; gap: 12px; min-height: 48px; margin: 0 0 24px;
    font-size: 13px; letter-spacing: .16em; font-weight: 800; }
  .sd-mark { display: grid; place-items: center; width: 44px; height: 44px; flex: none;
    border: 1px solid #355b43; border-radius: 50%; font: italic 32px 'Karla', Arial, sans-serif; letter-spacing: -.08em; }
  .sd-brand-sub { display: block; margin-top: 5px; font: italic 14px 'Karla', Arial, sans-serif; letter-spacing: 0; color: var(--muted); }
  .sd .sd-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px 40px;
    border: 0; border-top: 1px solid #aab7a4; border-bottom: 1px solid #aab7a4;
    border-radius: 0; background: transparent; padding: 30px 0; box-shadow: none; }
  .sd-eyebrow { grid-column: 1; grid-row: 1; color: var(--muted); font-size: 12px;
    text-transform: uppercase; letter-spacing: .18em; font-weight: 700; }
  .sd-head .sd-state { grid-column: 1; grid-row: 4; margin: 6px 0 0; justify-content: flex-start; }
  .sd-head h1 { grid-column: 1; grid-row: 2; color: #244332; font: 500 clamp(32px, 4vw, 52px)/1.12 'Karla', Arial, sans-serif;
    text-transform: none; letter-spacing: -.035em; max-width: 800px; margin: 0; }
  .sd-head h1 .code { display: block; color: var(--muted); font: 600 12px/1.4 ui-monospace, monospace;
    letter-spacing: .12em; margin-top: 14px; }
  .sd-head .serial { grid-column: 2; grid-row: 1 / 5; align-self: center; display: grid; place-items: center;
    min-width: 156px; min-height: 150px; padding: 12px; box-sizing: border-box;
    border: 1px solid #bbc5b2; border-radius: 4px; outline: 5px solid #f5f7f4;
    box-shadow: 0 0 0 6px #d6dccd; background: #eaf0e8; color: #31543c;
    font: 500 clamp(42px, 5vw, 66px)/1 'Karla', Arial, sans-serif; letter-spacing: -.06em; margin: 6px; }
  .sd-head .fullid { grid-column: 1; grid-row: 3; margin: 0; color: var(--muted);
    font: 13px ui-monospace, monospace; letter-spacing: .04em; }
  .sd .badge { font: 700 11px/1.2 system-ui, sans-serif; letter-spacing: .08em;
    padding: 8px 12px; border-radius: 999px; border: 1px solid transparent; }
  .sd .badge.ok { background: #e4eddd; color: #285039; border-color: #bccdae; }
  .sd .badge.neutral { background: #eaece2; color: #4b5b43; border-color: #c9d0bd; }
  .sd .badge.bad { background: #f7e4df; color: #923f32; border-color: #ddb3a9; }
  .sd .badge.warn { background: #f7eacb; color: #795015; border-color: #e5cca0; }
  .sd .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 0;
    padding: 24px 0; border-bottom: 1px solid #cbd3c2; }
  .sd .tile { padding: 0 28px; border: 0; border-right: 1px solid #cbd3c2; border-radius: 0;
    background: transparent; box-shadow: none; color: #243d32; justify-content: flex-start; }
  .sd .tile:first-child { padding-left: 0; }
  .sd .tile:last-child { border-right: 0; }
  .sd .tile .tl { font-size: 11px; letter-spacing: .13em; color: var(--muted); }
  .sd .tile .tv { font: 500 34px/1.15 'Karla', Arial, sans-serif; margin: 8px 0 4px; color: #244332; }
  .sd .tile .ts { font-size: 13px; color: var(--muted); }
  .sd-columns { display: grid; grid-template-columns: 1.05fr 1fr; gap: 24px; margin-top: 28px; align-items: start; }
  .sd-panel { min-width: 0; padding: 28px; background: var(--card); border: 1px solid #e0e3d6; border-radius: 16px; }
  .sd .sd-panel h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 26px; padding: 0;
    border: 0; color: #304b37; font: 500 22px/1.25 'Karla', Arial, sans-serif; text-transform: none; letter-spacing: -.02em; }
  .sd .sd-panel h2::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #82966c; }
  .sd .sd-panel > .card { padding: 0; background: transparent; color: #243d32; border: 0; box-shadow: none; }
  .sd .wtop { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin-bottom: 24px; }
  .sd .wtop .tv { font: 500 48px/1.1 'Karla', Arial, sans-serif; letter-spacing: -.045em; color: #244332; }
  .sd .wtop .hint { grid-column: 1; grid-row: 2; font-size: 14px; }
  .sd .wtop .badge { grid-column: 2; grid-row: 1 / 3; align-self: center; margin: 0; }
  .sd .wbar { height: 24px; gap: 0; border-radius: 6px; box-shadow: none; background: #e8ecdf; }
  .sd .seg { min-width: 0; }
  .sd .seg.waste, .sd .sw.waste { background: repeating-linear-gradient(45deg, #b7beae 0 3px, #e6e9df 3px 6px); }
  .sd .wscale { margin-top: 9px; font: 12px ui-monospace, monospace; color: var(--muted); }
  .sd .legend { display: grid; gap: 0; margin-top: 20px; font-size: 14px; }
  .sd .weight-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; align-items: center;
    gap: 12px; padding: 14px 0; border-bottom: 1px solid #e4e7dd; }
  .sd .legend .sw { width: 9px; height: 9px; border-radius: 2px; vertical-align: 0; margin-right: 10px; }
  .sd .legend strong { color: #243d32; font-weight: 650; }
  .sd .weight-share { color: var(--muted); text-align: right; font: 12px ui-monospace, monospace; }
  .sd .hint { color: var(--muted); font-size: 13px; line-height: 1.65; }
  .sd .note { color: #344c3f; font-size: 16px; line-height: 1.6; }
  .sd .card > p.hint { padding: 14px 16px; background: #f0f3e9; border-radius: 8px; }
  .sd .journey { margin: 0; }
  .sd .journey li { grid-template-columns: 20px 1fr; column-gap: 14px; }
  .sd .journey .node { font-size: 14px; padding: 4px 0; }
  .sd .journey .node > span { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .sd .journey .node strong { color: #294c36; font-weight: 650; }
  .sd .journey .node .when { font-size: 12px; color: var(--muted); }
  .sd .journey .dot { width: 10px; height: 10px; background: #4b7147; box-shadow: 0 0 0 4px #e9efdf; }
  .sd .journey .dot.open { background: #ffffff; border: 2px solid #a47837; box-shadow: 0 0 0 4px #f4ecd8; }
  .sd .journey .dot.none { background: transparent; border: 1px solid #809272; box-shadow: none; }
  .sd .journey .span { min-height: 63px; }
  .sd .journey .line { width: 1px; background: #c9d5bd; }
  .sd .journey .span .dur { font-size: 13px; color: var(--muted); padding: 12px 0; }
  .sd .journey .span .dur strong { font-size: 14px; color: #36533b; font-weight: 650; }
  .sd .kv { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; margin-top: 24px;
    padding-top: 18px; border-top: 1px solid #dce0d3; font-size: 13px; color: #344c3f; }
  .sd .lotmeta { color: var(--muted); }
  .sd-notes { margin-top: 24px; }
  .sd .notecard { padding: 14px 0; border: 0; border-bottom: 1px solid #e4e7dd; margin: 0;
    border-radius: 0; background: transparent; color: #344c3f; box-shadow: none; font-size: 14px; }
  .sd .notecard .hint { margin-top: 6px; font: 11px ui-monospace, monospace; }
  .sd .batch { border: 0; margin: 16px 0 0; padding: 0; color: #344c3f; background: transparent; }
  .sd .batch summary { font-size: 14px; font-weight: 650; min-height: 44px; box-sizing: border-box; padding: 12px 0; }
  .sd .batch input { background: #fff; color: #243d32; border: 1px solid #b4c0a9; border-radius: 8px; }
  .sd .bigbtn, .sd .btn { min-height: 56px; border: 1px solid #294c36; border-radius: 8px;
    background: #294c36; color: #ffffff; box-shadow: none; font-size: 15px; font-weight: 650; letter-spacing: .03em; }
  .sd .bigbtn:hover, .sd .btn:hover { background: #396346; }
  .sd .bigbtn:active { transform: translateY(1px); box-shadow: none; }
  .sd .empty { color: var(--muted); }
  .sd .flash { background: #e4eddd; color: #285039; border-color: #a7bd99; }
  .sd .footer { margin-top: 26px; padding-top: 0; border: 0; text-align: right; }
  .sd .footer a { display: inline-block; padding: 12px 0; color: #45603e; font-size: 13px; }
  .sd :is(button, a, input, summary):focus-visible { outline: 3px solid #a47837; outline-offset: 4px; }
  @media (max-width: 700px) {
    body:has(.sd) { padding: 22px 18px 30px; }
    body:has(.sd) .lang { top: 22px; right: 18px; }
    .sd-brand { margin: 0 0 24px; font-size: 11px; letter-spacing: .1em; gap: 9px; }
    .sd-mark { width: 34px; height: 34px; font-size: 26px; }
    .sd-brand-sub { font-size: 12px; }
    .sd .sd-head { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px; padding: 24px 0; }
    .sd-eyebrow { font-size: 10px; }
    .sd-head h1 { grid-column: 1 / -1; font-size: 34px; padding-right: 0; }
    .sd-head h1 .code { font-size: 11px; margin-top: 8px; }
    .sd-head .serial { grid-row: 3 / 5; min-width: 74px; min-height: 66px; font-size: 32px; padding: 6px; margin: 0 5px; }
    .sd-head .fullid { font-size: 11px; align-self: end; }
    .sd .badge { font-size: 12px; padding: 7px 10px; }
    .sd .tiles { padding: 20px 0; }
    .sd .tile { padding: 0 12px; }
    .sd .tile .tl { font-size: 10px; letter-spacing: .05em; min-height: 26px; }
    .sd .tile .tv { font-size: 29px; margin-top: 3px; }
    .sd .tile .ts { font-size: 12px; }
    .sd-columns { grid-template-columns: 1fr; gap: 16px; margin-top: 22px; }
    .sd-panel { padding: 22px 20px; border-radius: 12px; }
    .sd .sd-panel h2 { font-size: 21px; margin-bottom: 22px; }
    .sd .wtop .tv { font-size: 42px; }
    .sd .wtop .badge { max-width: 108px; text-align: center; }
    .sd .weight-row { gap: 8px; grid-template-columns: minmax(0, 1fr) auto 36px; }
    .sd-notes { margin-top: 16px; }
    .sd .journey .node .when { font-size: 12px; }
  }
  /* Website brand: Karla headings, Quicksand copy, sage and golden yellow. */
  @font-face { font-family: 'Karla'; font-style: normal; font-weight: 700; font-display: swap;
    src: url('https://fonts.gstatic.com/s/karla/v33/qkBIXvYC6trAT55ZBi1ueQVIjQTDH52qFA.ttf') format('truetype'); }
  @font-face { font-family: 'Quicksand'; font-style: normal; font-weight: 500; font-display: swap;
    src: url('https://fonts.gstatic.com/s/quicksand/v37/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkM0o18E.ttf') format('truetype'); }
  .sd { font-family: 'Quicksand', Arial, sans-serif; --tops: #668971; --smalls: #b3c59b;
    --biomass: #8babb9; --trim: #e6bc56; }
  .sd-brand { margin-bottom: 20px; }
  .sd-logo { display: block; object-fit: contain; flex: none; }
  .sd-brand-caption { color: #536c5b; font: 500 15px 'Quicksand', sans-serif; letter-spacing: 0; }
  .sd-language a { border-radius: 30px; font-family: 'Karla', Arial, sans-serif; color: #486750; }
  .sd .sd-head { border: 0; border-radius: 20px; padding: 30px 34px; background: #668971;
    grid-template-columns: minmax(0,1fr) 170px; gap: 12px 28px; position: relative; overflow: hidden; }
  .sd .sd-head::after { content: ''; position: absolute; width: 350px; height: 350px; border: 1px solid #ffffff16;
    border-radius: 50%; right: -165px; top: -130px; pointer-events: none; }
  .sd-eyebrow { color: #fff; font-family: 'Quicksand', Arial, sans-serif; letter-spacing: .12em; }
  .sd-head h1 { color: #fff; font-family: 'Karla', Arial, sans-serif; font-weight: 700;
    text-transform: uppercase; font-size: clamp(32px,4vw,50px); letter-spacing: -.025em; }
  .sd-head h1 .code { display: inline; color: #f3f5ef; font: 500 14px 'Quicksand', sans-serif; margin: 0; }
  .sd-head .fullid { color: #fff; font-size: 13px; }
  .sd-head .serial { background: #e8bc55; color: #344e3a; border: 0; outline: 0; box-shadow: none;
    width: 150px; min-width: 0; min-height: 150px; border-radius: 50%; margin: 0; padding: 12px;
    font: 700 54px 'Karla', Arial, sans-serif; letter-spacing: -.055em; }
  .sd-head .badge { background: #f3f6eb; border-color: #f3f6eb; color: #3e5d46; }
  .sd-head .badge.bad { background: #ffe6df; border-color: #ffe6df; color: #923f32; }
  .sd .tiles { margin-top: 20px; padding: 22px 0; border: 1px solid #e1e7dd; border-radius: 14px; background: #fff; }
  .sd .tile { padding: 0 24px; }
  .sd .tile:first-child { padding-left: 24px; }
  .sd .tile .tv { font-family: 'Karla', Arial, sans-serif; font-weight: 700; color: #4c6b55; }
  .sd .tile .tl { font-family: 'Quicksand', Arial, sans-serif; font-weight: 700; }
  .sd .sd-panel h2 { font: 700 23px 'Karla', Arial, sans-serif; color: #4a6452; }
  .sd .sd-panel h2::before { background: #e1b64e; width: 8px; height: 8px; }
  .sd .wtop .tv { font-family: 'Karla', Arial, sans-serif; font-weight: 700; color: #4d6d56; }
  .sd .wbar { height: 30px; border-radius: 20px; }
  .sd .wtop .badge { font-family: 'Karla', Arial, sans-serif; border-radius: 20px; font-size: 12px; }
  .sd .legend { font-size: 15px; }
  .sd .journey .dot { background: #668971; box-shadow: 0 0 0 4px #e7eddf; }
  .sd .journey .dot.open { background: #e8bc55; border-color: #b28d30; box-shadow: 0 0 0 4px #faf0d6; }
  .sd .journey .dot.none { background: transparent; border-color: #809272; box-shadow: none; }
  .sd .bigbtn, .sd .btn { background: #668971; border-color: #668971; border-radius: 32px;
    font-family: 'Karla', Arial, sans-serif; font-size: 17px; min-height: 56px; }
  .sd .bigbtn:hover, .sd .btn:hover { background: #4c6d57; }
  @media (max-width:700px) {
    .sd-logo { width: 64px; height: 64px; }
    .sd-brand { gap: 10px; }
    .sd-brand-caption { font-size: 12px; max-width: 92px; line-height: 1.5; }
    .sd-language a { padding: 8px 12px; }
    .sd .sd-head { padding: 24px 20px; border-radius: 16px; grid-template-columns: minmax(0,1fr) 84px; gap: 12px; }
    .sd-head h1 { font-size: 32px; }
    .sd-head h1 .code { display: block; font-size: 12px; margin-top: 10px; }
    .sd-head .serial { width: 80px; min-height: 80px; height: 80px; font-size: 32px; }
    .sd .tiles { padding: 18px 0; }
    .sd .tile, .sd .tile:first-child { padding: 0 12px; }
    .sd .tile .tl { min-height: 28px; font-size: 11px; }
    .sd .tile .ts { font-size: 12px; }
    .sd .wtop .tv { font-size: 42px; }
  }
  /* Location: where it dried, where it is now. After every .tile rule, because
     .sd .tiles.loc .tv and .sd .tile .tv tie on specificity. */
  .sd-location { margin-top: 24px; }
  .sd .tiles.loc { grid-template-columns: repeat(2, 1fr); margin-top: 0; }
  .sd .tiles.loc .tv { font-size: 30px; overflow-wrap: normal; word-break: normal; }
  .sd .batch select { display: block; width: 100%; box-sizing: border-box; min-height: 48px; margin: 0 0 12px;
    padding: 0 12px; background: #fff; color: #243d32; border: 1px solid #b4c0a9; border-radius: 8px; font-size: 16px; }
  @media (max-width: 700px) {
    /* Side by side leaves ~124px a tile on a phone, and "Supermarket" split
       mid-word there (seen live, 2026-09-10). Stacked, each gets the full width. */
    .sd .tiles.loc { grid-template-columns: 1fr; row-gap: 16px; }
    .sd .tiles.loc .tile { border-right: 0; }
    .sd .tiles.loc .tile + .tile { border-top: 1px solid #cbd3c2; padding-top: 16px; }
    .sd .tiles.loc .tv { font-size: 26px; }
  }
`;
