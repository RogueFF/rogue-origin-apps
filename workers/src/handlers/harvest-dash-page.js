/**
 * The harvest cycle-time dashboard.
 *
 * SHIPS ZERO DATA. Same contract as the lot board: the HTML below is a public
 * shell, every figure arrives from `?action=harvest_metrics` after the operator
 * types the password, and the password travels in an Authorization header —
 * never a query string, which would put it in access logs and browser history.
 *
 * Charts are hand-drawn SVG against one scale each, following the Ops Hub v3
 * precedent. No chart library: the whole page has to load on one bar of signal
 * on the barn PC.
 *
 * Nothing here computes a lot figure. Bins, sacks and cutter-hours all arrive
 * from the ledger via the metrics endpoint, so the dashboard cannot drift from
 * `?action=rollup`.
 */

import { DEMO_METRICS } from '../lib/harvest-demo-fixture.js';

export function dashPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harvest Cycle Times</title>
<style>
  :root {
    --bg:#111d15; --panel:#18291d; --raised:#1f3526; --line:#2b4433; --line2:#3a5946;
    --ink:#f2f7f2; --ink2:#cfe3d6; --muted:#8fae9b;
    --leaf:#4fbd7c; --straw:#e9c462; --clay:#d9925a; --sky:#7aa7d8; --plum:#c79ad2;
    --bad:#e07b7b; --ok:#4fbd7c;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:26px 20px 70px; }
  a { color:var(--leaf); }

  header.top { display:flex; flex-wrap:wrap; gap:12px 20px; align-items:baseline;
               border-bottom:2px solid var(--line2); padding-bottom:14px; }
  h1 { font-size:1.6rem; margin:0; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:.92rem; margin:0; }
  .grow { flex:1; }
  .stamp { font-family:var(--mono); font-size:.78rem; color:var(--muted); }
  .testpill { font-size:.7rem; font-weight:800; letter-spacing:.1em; padding:4px 9px;
              border-radius:4px; background:#4a3c12; color:var(--straw); border:1px solid #6b5718; }

  /* Back to the lot board — the pair to the board's own "Cycle times" link, and
     styled to match it: the two pages are one tool viewed two ways.
     The explicit line-height is because anchors inherit it and buttons do not,
     which on the board left this link's twin 4px taller than the button beside
     it. (Backticks are not available in this comment: the whole page is one JS
     template literal, and one would end it.) */
  a.nav { font-weight:600; font-size:.78rem; text-transform:uppercase; letter-spacing:.09em;
          color:var(--ink2); background:var(--raised); border:1px solid var(--line2);
          border-radius:8px; padding:7px 12px; text-decoration:none;
          display:inline-flex; align-items:center; line-height:normal; }
  a.nav:hover { border-color:var(--leaf); color:var(--leaf); }
  a.nav:focus-visible { outline:2px solid var(--straw); outline-offset:2px; }

  /* ── gate ─────────────────────────────────────────────── */
  #gate { max-width:420px; margin:70px auto; background:var(--panel); border:1px solid var(--line);
          border-radius:12px; padding:26px; }
  #gate h2 { margin:0 0 6px; font-size:1.15rem; }
  #gate p { color:var(--muted); margin:0 0 16px; font-size:.9rem; }
  input[type=password], select {
    width:100%; font-size:1rem; padding:11px 12px; border-radius:8px; border:1px solid var(--line2);
    background:var(--raised); color:var(--ink); }
  button { font:inherit; font-weight:700; padding:11px 18px; border:none; border-radius:8px;
           background:var(--leaf); color:#0d1a12; cursor:pointer; }
  button.ghost { background:var(--raised); color:var(--ink2); border:1px solid var(--line2); font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .row { display:flex; gap:10px; margin-top:14px; align-items:center; }
  .err { color:var(--bad); font-size:.9rem; margin-top:10px; min-height:1.2em; }

  /* ── strip ────────────────────────────────────────────── */
  .strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(132px,1fr)); gap:10px; margin:22px 0 26px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:13px 14px; }
  .tile .k { font-size:.7rem; text-transform:uppercase; letter-spacing:.11em; color:var(--muted); font-weight:700; }
  .tile .v { font-size:1.85rem; font-weight:800; line-height:1.1; margin-top:3px; font-variant-numeric:tabular-nums; }
  .tile .n { font-size:.8rem; color:var(--ink2); margin-top:2px; }
  .tile.alarm { border-color:#7a3a3a; background:#2a1a1a; }
  .tile.alarm .v { color:var(--bad); }

  /* ── cards ────────────────────────────────────────────── */
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:20px 22px 22px; margin-bottom:20px; }
  .card > h2 { margin:0; font-size:1.18rem; letter-spacing:-.005em; }
  .card > .lede { color:var(--muted); font-size:.88rem; margin:5px 0 16px; max-width:70ch; }
  .card .caveat { margin-top:14px; font-size:.83rem; color:var(--muted);
                  border-left:3px solid var(--line2); padding:7px 0 7px 11px; }
  .split { display:grid; grid-template-columns:1fr; gap:22px; }
  @media (min-width:900px) { .split.two { grid-template-columns:1.05fr .95fr; } }

  svg { display:block; width:100%; height:auto; overflow:visible; }
  .axis { fill:var(--muted); font-size:10px; font-family:var(--mono); }
  .barlbl { fill:var(--ink2); font-size:11px; }
  .barval { fill:var(--ink); font-size:11px; font-weight:700; font-family:var(--mono); }

  .legend { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:12px; font-size:.8rem; color:var(--muted); }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:-1px; }

  .bays { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
  .bay { background:var(--raised); border:1px solid var(--line2); border-radius:8px; padding:9px 10px; }
  .bay .n { font-family:var(--mono); font-size:.72rem; color:var(--muted); }
  .bay .s { font-size:1.25rem; font-weight:800; font-variant-numeric:tabular-nums; }
  .bay .l { font-size:.74rem; color:var(--muted); }
  .bay.empty { opacity:.42; }
  .baygroup + .baygroup { margin-top:14px; }
  .baygroup h3 { font-size:.72rem; text-transform:uppercase; letter-spacing:.12em;
                 color:var(--muted); margin:0 0 8px; }

  /* The rack board. Bigger than the .bay cells above on purpose: this is the
     card that answers a question someone is asking while standing up, and the
     state is carried by a colour lane down the left edge rather than by a word
     you have to stop and read. */
  .racks { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .rack { position:relative; background:var(--raised); border:1px solid var(--line2);
          border-radius:10px; padding:11px 12px 11px 15px; overflow:hidden; min-height:96px; }
  .rack::before { content:""; position:absolute; left:0; top:0; bottom:0; width:5px;
                  background:var(--line2); }
  .rack.green::before     { background:var(--straw); }
  .rack.ready::before     { background:var(--leaf); }
  .rack.overdue::before   { background:var(--clay); }
  .rack.coming::before    { background:var(--sky); }
  .rack.vacant { opacity:.4; }
  .rack .n { font-family:var(--mono); font-size:.72rem; color:var(--muted);
             display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  /* The bay number is what someone says out loud when they point at the barn,
     so it is the cell's name and is set like one. Nowrap on both halves: at
     four columns "Bay 12" and "151 bins" have to stay on one line. */
  .rack .n .bn { font-size:1.35rem; font-weight:800; color:var(--ink); letter-spacing:-.02em; }
  .rack .n span { white-space:nowrap; }
  .rack .age { font-size:1.45rem; font-weight:800; font-variant-numeric:tabular-nums;
               line-height:1.15; margin:2px 0 1px; }
  .rack .age small { font-size:.8rem; font-weight:700; color:var(--muted); margin-left:3px; }
  .rack .st { font-size:.68rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
  .rack.green .st   { color:var(--straw); }
  .rack.ready .st   { color:var(--leaf); }
  .rack.overdue .st { color:var(--clay); }
  .rack.coming .st  { color:var(--sky); }
  .rack.vacant .st  { color:var(--muted); }
  .rack ul { list-style:none; margin:7px 0 0; padding:0; }
  .rack li { font-size:.76rem; color:var(--ink2); display:flex; justify-content:space-between;
             gap:8px; padding:1px 0; }
  .rack li b { font-weight:700; color:var(--ink); }
  .rack li span { font-family:var(--mono); font-size:.72rem; color:var(--muted); white-space:nowrap; }

  table.feed { width:100%; border-collapse:collapse; font-size:.88rem; }
  table.feed th { text-align:left; font-size:.68rem; text-transform:uppercase; letter-spacing:.1em;
                  color:var(--muted); border-bottom:1px solid var(--line2); padding:0 10px 7px 0; }
  table.feed td { padding:7px 10px 7px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  table.feed td.t { font-family:var(--mono); font-size:.82rem; color:var(--ink2); white-space:nowrap; }
  .kind { font-size:.66rem; font-weight:800; letter-spacing:.08em; padding:3px 7px; border-radius:4px;
          text-transform:uppercase; white-space:nowrap; }
  .k-enter { background:#1d4630; color:#8fe3ad; }
  .k-leave { background:#25332b; color:var(--muted); }
  .k-load  { background:#4a3419; color:#f0c089; }
  .k-tag   { background:#4a3c12; color:var(--straw); }
  .k-open  { background:#20364a; color:#9dc6ee; }
  .feedwrap { max-height:520px; overflow:auto; }
  .zone { font-family:var(--mono); font-weight:700; }
  .crewtag { font-family:var(--mono); font-size:.76rem; color:var(--muted); }

  .empty { text-align:center; padding:46px 20px; color:var(--muted); }
  .empty h2 { color:var(--ink); font-size:1.3rem; margin:0 0 8px; }
  .demobar { background:#4a3c12; border:1px solid #6b5718; color:var(--straw); border-radius:10px;
             padding:12px 16px; margin-bottom:20px; font-weight:600; display:flex; gap:14px;
             align-items:center; flex-wrap:wrap; }
  .demobar .grow { flex:1; }
  .hide { display:none !important; }
</style>
</head>
<body>
<div class="wrap">

  <div id="gate">
    <h2>Harvest cycle times</h2>
    <p>Season timings, crew rates and every scan timestamp. Password required — this is the farm's own numbers.</p>
    <input id="pw" type="password" autocomplete="current-password" placeholder="Password" autofocus>
    <div class="row">
      <button id="go">Open dashboard</button>
      <button id="demo" class="ghost">See a worked example</button>
    </div>
    <div class="err" id="err"></div>
  </div>

  <div id="app" class="hide">
    <div id="demobar" class="demobar hide">
      <span class="grow"><strong>Worked example — not your data.</strong>
        Invented figures shaped like a real week, so you can see what the season will look like.</span>
      <button class="ghost" id="exitdemo">Close example</button>
    </div>

    <header class="top">
      <div>
        <h1>Harvest cycle times</h1>
        <p class="sub" id="seasonline">&nbsp;</p>
      </div>
      <div class="grow"></div>
      <a class="nav" id="toboard" href="/api/harvest?action=board_page">Lot board</a>
      <span id="testpill" class="testpill hide">TEST MODE</span>
      <span class="stamp" id="stamp"></span>
    </header>

    <div class="strip" id="strip"></div>
    <div id="cards"></div>
  </div>

</div>

<script>
(function () {
  var API = '/api/harvest';
  var DEMO = ${JSON.stringify(DEMO_METRICS)};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var num = function (n) { return n == null ? '—' : String(n); };

  // ── data ────────────────────────────────────────────────────────────
  function load(pw) {
    $('err').textContent = '';
    $('go').disabled = true;
    return fetch(API + '?action=harvest_metrics', { headers: { authorization: pw } })
      .then(function (r) {
        if (r.status === 401) throw new Error('That password was not accepted.');
        if (!r.ok) throw new Error('Could not load (' + r.status + ').');
        return r.json();
      })
      .then(function (j) {
        try { sessionStorage.setItem('rf_dash_pw', pw); } catch (e) {}
        render(j, false);
      })
      .catch(function (e) { $('err').textContent = e.message; })
      .then(function () { $('go').disabled = false; });
  }

  $('go').addEventListener('click', function () { load($('pw').value); });
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') load($('pw').value); });
  $('demo').addEventListener('click', function () { render(DEMO, true); });
  $('exitdemo').addEventListener('click', function () {
    $('app').classList.add('hide'); $('gate').classList.remove('hide'); $('pw').focus();
  });

  // ── charts ──────────────────────────────────────────────────────────
  /** Horizontal bars against one x scale, with optional background bands. */
  function hbars(rows, opts) {
    if (!rows.length) return '<p class="lede">Nothing recorded yet.</p>';
    var W = 640, rowH = opts.rowH || 26, padL = opts.padL || 132, padR = 54, padT = 22;
    var H = padT + rows.length * rowH + 10;
    var max = Math.max(opts.min || 0, Math.max.apply(null, rows.map(function (r) { return r.v; })) * 1.08);
    var x = function (v) { return padL + (v / max) * (W - padL - padR); };

    var bands = (opts.bands || []).map(function (b) {
      var x0 = x(b.from), x1 = x(Math.min(b.to, max));
      return '<rect x="' + x0.toFixed(1) + '" y="' + (padT - 14) + '" width="' + Math.max(0, x1 - x0).toFixed(1) +
        '" height="' + (H - padT + 8) + '" fill="' + b.fill + '"></rect>' +
        '<text class="axis" x="' + (x0 + 4).toFixed(1) + '" y="' + (padT - 5) + '">' + esc(b.label) + '</text>';
    }).join('');

    var ticks = '';
    var step = max <= 12 ? 2 : max <= 40 ? 10 : max <= 200 ? 50 : 100;
    for (var t = 0; t <= max; t += step) {
      ticks += '<line x1="' + x(t).toFixed(1) + '" y1="' + (padT - 14) + '" x2="' + x(t).toFixed(1) +
        '" y2="' + (H - 2) + '" stroke="#2b4433" stroke-width="1"></line>' +
        '<text class="axis" x="' + x(t).toFixed(1) + '" y="' + (H + 12) + '" text-anchor="middle">' + t + '</text>';
    }

    var bars = rows.map(function (r, i) {
      var y = padT + i * rowH;
      var w = Math.max(2, x(r.v) - padL);
      return '<text class="barlbl" x="' + (padL - 8) + '" y="' + (y + 13) + '" text-anchor="end">' + esc(r.label) + '</text>' +
        '<rect x="' + padL + '" y="' + (y + 3) + '" width="' + w.toFixed(1) + '" height="' + (rowH - 9) +
        '" rx="2" fill="' + r.fill + '"></rect>' +
        '<text class="barval" x="' + (padL + w + 6).toFixed(1) + '" y="' + (y + 13) + '">' + esc(r.text) + '</text>';
    }).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + (H + 20) + '" role="img" aria-label="' + esc(opts.aria || '') + '">' +
      bands + ticks + bars + '</svg>';
  }

  /** Vertical histogram, one bucket per bar. */
  function histogram(values, bucket, unit) {
    if (!values.length) return '<p class="lede">Nothing recorded yet.</p>';
    var buckets = {};
    values.forEach(function (v) { var b = Math.floor(v / bucket) * bucket; buckets[b] = (buckets[b] || 0) + 1; });
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    var maxN = Math.max.apply(null, keys.map(function (k) { return buckets[k]; }));
    var W = 560, H = 190, padB = 34, padL = 30, bw = (W - padL) / keys.length;

    var bars = keys.map(function (k, i) {
      var h = (buckets[k] / maxN) * (H - padB - 14);
      var x = padL + i * bw;
      return '<rect x="' + (x + 2).toFixed(1) + '" y="' + (H - padB - h).toFixed(1) + '" width="' + (bw - 4).toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="2" fill="var(--clay)"></rect>' +
        '<text class="barval" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - padB - h - 4).toFixed(1) +
        '" text-anchor="middle">' + buckets[k] + '</text>' +
        '<text class="axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - padB + 14) +
        '" text-anchor="middle">' + k + '</text>';
    }).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="distribution">' +
      '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) +
      '" stroke="#3a5946"></line>' + bars +
      '<text class="axis" x="' + W + '" y="' + (H - 6) + '" text-anchor="end">' + esc(unit) + '</text></svg>';
  }

  // ── render ──────────────────────────────────────────────────────────
  function render(d, isDemo) {
    $('gate').classList.add('hide');
    $('app').classList.remove('hide');
    $('demobar').classList.toggle('hide', !isDemo);
    $('testpill').classList.toggle('hide', !d.is_test);
    $('stamp').textContent = 'generated ' + String(d.generated_at || '').replace('T', ' ').slice(0, 16) + ' UTC';
    $('seasonline').textContent = d.season + ' season · ' + d.counts.lots + ' lots · ' +
      d.counts.sessions + ' zone sessions · ' + d.feed_total + ' timestamped events';

    var c = d.counts;
    var tiles = [
      { k: 'Bins in', v: c.bins, n: c.loads + ' trailers' },
      { k: 'Sacks tagged', v: c.sacks, n: c.sacks_opened + ' opened' },
      { k: 'Lots cut', v: c.lots, n: c.sessions_open ? c.sessions_open + ' zone(s) open now' : 'none open' },
      { k: 'Median dry', v: d.dry_days.length ? median(d.dry_days.map(function (x) { return x.days; })) + 'd' : '—',
        n: d.dry_window.min + '–' + d.dry_window.max + ' d expected' },
      { k: 'Median gap', v: d.all_gaps.length ? median(d.all_gaps) + 'm' : '—', n: 'between trailers' }
    ];
    if (c.loads_unattributed) {
      tiles.push({ k: 'Loads with NO lot', v: c.loads_unattributed, n: 'bins on no lot at all', alarm: true });
    }
    $('strip').innerHTML = tiles.map(function (t) {
      return '<div class="tile' + (t.alarm ? ' alarm' : '') + '"><div class="k">' + esc(t.k) +
        '</div><div class="v">' + esc(t.v) + '</div><div class="n">' + esc(t.n) + '</div></div>';
    }).join('');

    if (!c.sessions && !c.loads && !c.sacks) {
      $('cards').innerHTML = '<div class="card empty"><h2>No harvest recorded yet</h2>' +
        '<p>The first zone scan of the season fills this page. Nothing here is waiting on you.</p>' +
        '<div class="row" style="justify-content:center"><button class="ghost" id="d2">See a worked example</button></div></div>';
      var b = $('d2'); if (b) b.addEventListener('click', function () { render(DEMO, true); });
      return;
    }

    $('cards').innerHTML = [
      cardRacks(d), cardDry(d), cardCadence(d), cardCrew(d), cardAfterTag(d), cardFeed(d)
    ].join('');
  }

  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    var v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return Math.round(v * 10) / 10;
  }

  // 1 ── dry days
  function cardDry(d) {
    var w = d.dry_window;
    var rows = d.dry_days.map(function (x) {
      return {
        label: x.zone + ' · ' + (x.cultivar || '').slice(0, 12) + ' c' + x.cut_number,
        v: x.days, text: x.days + ' d',
        fill: x.level === 'green' ? 'var(--bad)' : x.level === 'overdue' ? 'var(--clay)' : 'var(--leaf)'
      };
    });
    return '<section class="card"><h2>Days on the rack</h2>' +
      '<p class="lede">Zone scan to the first tag printed off that lot. The bands are the same window the ' +
      'takedown picker uses when it badges a lot <b>READY</b>, <b>TOO GREEN</b> or <b>OVERDUE</b> — so a red ' +
      'bar here is a lot the screen would have questioned at the time.</p>' +
      hbars(rows, {
        min: w.max + 4, aria: 'days on the rack per lot',
        bands: [
          { from: 0, to: w.min, fill: 'rgba(224,123,123,.13)', label: 'too green' },
          { from: w.min, to: w.max, fill: 'rgba(79,189,124,.13)', label: 'expected ' + w.min + '–' + w.max + ' d' },
          { from: w.max, to: 999, fill: 'rgba(217,146,90,.13)', label: 'overdue' }
        ]
      }) +
      '<div class="legend"><span><i style="background:var(--leaf)"></i>in the window</span>' +
      '<span><i style="background:var(--bad)"></i>cut too recently</span>' +
      '<span><i style="background:var(--clay)"></i>left past the window</span></div>' +
      '<p class="caveat">Measured to the <b>first</b> tag of the lot, not the last — a rack coming down over ' +
      'two days would otherwise read as two days drier than it was.</p></section>';
  }

  // 2 ── cadence
  function cardCadence(d) {
    var rows = d.cadence.filter(function (x) { return x.median_gap_min != null; }).slice(0, 12).map(function (x) {
      return { label: x.zone + ' · ' + x.loads + ' loads', v: x.median_gap_min,
        text: x.median_gap_min + ' m', fill: 'var(--clay)' };
    });
    return '<section class="card"><h2>Trailer cadence</h2>' +
      '<p class="lede">Minutes between one trailer arriving and the next off the same lot. Deliberately the ' +
      '<b>gap</b>, not time since the zone opened — elapsed-since climbs all afternoon whatever the crew does, ' +
      'so it reads as a slowdown that is really just the clock.</p>' +
      '<div class="split two"><div>' + hbars(rows, { aria: 'median gap between trailers, per lot', padL: 128 }) +
      '<p class="caveat">Median per lot, fastest first. Gaps over ten hours are dropped — that is a night, not a slow trailer.</p>' +
      '</div><div>' + histogram(d.all_gaps, 15, 'minutes between trailers') +
      '<p class="caveat">Every gap of the season, in 15-minute buckets. The long tail is lunch, breakdowns and zone changes.</p>' +
      '</div></div></section>';
  }

  // 3 ── crews
  function cardCrew(d) {
    var withRate = d.crew.filter(function (x) { return x.bins_per_cutter_hour != null; });
    var rows = withRate.map(function (x) {
      return { label: (x.crew ? 'Crew ' + x.crew : 'Untagged phone'), v: x.bins_per_cutter_hour,
        text: x.bins_per_cutter_hour + ' bins/h', fill: x.crew === 'A' ? 'var(--leaf)' : x.crew === 'B' ? 'var(--sky)' : 'var(--muted)' };
    });
    var denom = d.crew.map(function (x) {
      return '<tr><td>' + esc(x.crew ? 'Crew ' + x.crew : 'Untagged') + '</td><td class="t">' + x.bins +
        ' bins (' + x.bins_rated + ' rated)</td><td class="t">' + num(x.cutter_person_hours) + ' cutter-h</td><td class="t">' +
        x.sessions_counted + ' of ' + x.sessions_total + ' sessions</td></tr>';
    }).join('');

    var dwellRows = d.dwell.slice(0, 10).map(function (x) {
      return { label: x.zone + (x.crew ? ' · ' + x.crew : ''), v: x.hours, text: x.hours + ' h',
        fill: 'var(--plum)' };
    });

    return '<section class="card"><h2>Crews</h2>' +
      '<p class="lede">Bins delivered per cutter-hour. Cutter-hours come from the ledger, which withholds them ' +
      'for any session that ran overnight — so the rate covers fewer sessions than the bin count does. ' +
      'Both are shown; a rate over an unstated subset is worse than no rate.</p>' +
      '<div class="split two"><div>' +
      (rows.length ? hbars(rows, { aria: 'bins per cutter-hour by crew', padL: 118, rowH: 34 })
                   : '<p class="lede">No session yet has both a cutter count and a same-day close.</p>') +
      '<table class="feed" style="margin-top:14px"><thead><tr><th>Crew</th><th>Delivered</th>' +
      '<th>Counted hours</th><th>Rate covers</th></tr></thead><tbody>' + denom + '</tbody></table>' +
      '</div><div><h3 style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0 0 10px">' +
      'Longest time in a zone</h3>' +
      hbars(dwellRows, { aria: 'hours in zone', padL: 96 }) +
      '<p class="caveat">Same-day sessions only. <b>' + d.dwell_excluded_overnight + '</b> session(s) left out ' +
      'because they ran overnight — the crew stops in the last zone of the day and picks up there next ' +
      'morning, so open-to-close would be counting the night as work.</p></div></div></section>';
  }

  // 4 ── after the tag
  function cardAfterTag(d) {
    var ol = d.order_latency;
    var bottom = [], top = [];
    for (var i = 1; i <= 12; i++) {
      var b = null;
      for (var j = 0; j < d.bays.length; j++) if (d.bays[j].bay === i) b = d.bays[j];
      var cell = '<div class="bay' + (b ? '' : ' empty') + '"><div class="n">Bay ' + i + '</div>' +
        '<div class="s">' + (b ? b.sacks : 0) + '</div><div class="l">' +
        (b ? b.lots + ' lot' + (b.lots === 1 ? '' : 's') : 'nothing tagged') + '</div></div>';
      (i > 8 ? top : bottom).push(cell);
    }
    return '<section class="card"><h2>After the tag</h2>' +
      '<p class="lede">Where sacks came down, and how long they wait before they are bucked.</p>' +
      '<div class="split two"><div>' +
      '<div class="baygroup"><h3>Bottom barn · bays 1–8</h3><div class="bays">' + bottom.join('') + '</div></div>' +
      '<div class="baygroup"><h3>Top barn · bays 9–12</h3><div class="bays">' + top.join('') + '</div></div>' +
      '</div><div>' +
      '<div class="strip" style="margin:0 0 14px"><div class="tile"><div class="k">Median tag → open</div>' +
      '<div class="v">' + (ol.median_days == null ? '—' : ol.median_days + ' d') + '</div>' +
      '<div class="n">' + ol.opened + ' sacks opened</div></div>' +
      '<div class="tile"><div class="k">Still sealed</div><div class="v">' + ol.waiting + '</div>' +
      '<div class="n">' + (ol.oldest_waiting_days == null ? 'none waiting' : 'oldest ' + ol.oldest_waiting_days + ' d') + '</div></div></div>' +
      (ol.days.length ? histogram(ol.days, 7, 'days from tag to open') : '<p class="lede">Nothing opened yet.</p>') +
      '<p class="caveat">This is <b>order</b> latency, not process latency. Sacks are bucked when there is an ' +
      'order for that strain, so a lot cut in October can legitimately sit until spring. A long bar here is a ' +
      'sales fact, not a delay to go and fix.</p></div></div></section>';
  }

  // 5 ── what is hanging where, right now
  function cardRacks(d) {
    var racks = d.racks || [];
    var hung = 0, binsUp = 0, oldest = null;
    for (var k = 0; k < racks.length; k++) {
      if (racks[k].state !== 'hanging') continue;
      hung++;
      binsUp += racks[k].bins;
      if (oldest === null || racks[k].days > oldest) oldest = racks[k].days;
    }

    var bottom = [], top = [];
    for (var i = 0; i < racks.length; i++) {
      var r = racks[i];
      // The colour lane says the state AND, while hanging, whether it is ready.
      // Coming down gets its own lane rather than a readiness colour: the
      // question has already been answered for that bay.
      var cls = r.state === 'empty' ? 'vacant'
        : r.state === 'coming_down' ? 'coming' : r.level;
      var word = r.state === 'empty' ? 'empty'
        : r.state === 'coming_down' ? 'coming down' : 'hanging';

      var lots = r.lots.map(function (l) {
        var name = l.cultivar
          ? esc(l.zone) + ' · ' + esc(l.cultivar) + (l.cut_number ? ' c' + l.cut_number : '')
          : esc(l.zone) + ' · no lot';
        return '<li><b>' + name + '</b><span>' + l.bins + ' bins</span></li>';
      }).join('');

      var body = r.state === 'empty'
        ? '<div class="age">—</div><div class="st">empty</div>'
        : '<div class="age">' + r.days + '<small>d</small></div>' +
          '<div class="st">' + word + '</div>' + '<ul>' + lots + '</ul>';

      var cell = '<div class="rack ' + cls + '"><div class="n"><span class="bn">Bay ' + r.bay + '</span>' +
        (r.state === 'empty' ? '' : '<span>' + r.bins + ' bins</span>') + '</div>' + body + '</div>';
      (r.barn === 'top' ? top : bottom).push(cell);
    }

    return '<section class="card"><h2>On the racks right now</h2>' +
      '<p class="lede">What is hanging in which bay, and how long it has been up there. ' +
      'The bay is recorded at the barn door when the trailer is logged.</p>' +
      '<div class="strip" style="margin:0 0 16px">' +
      '<div class="tile"><div class="k">Bays hanging</div><div class="v">' + hung + '</div>' +
      '<div class="n">of ' + racks.length + '</div></div>' +
      '<div class="tile"><div class="k">Bins on the racks</div><div class="v">' + binsUp + '</div>' +
      '<div class="n">still drying</div></div>' +
      '<div class="tile"><div class="k">Longest up</div><div class="v">' +
      (oldest == null ? '—' : oldest + ' d') + '</div><div class="n">' +
      (oldest == null ? 'nothing hanging' : 'ready at ' + d.dry_window.min + ' d') + '</div></div></div>' +
      (hung || racks.some(function (r) { return r.state !== 'empty'; })
        ? '<div class="baygroup"><h3>Bottom barn · bays 1–8</h3><div class="racks">' + bottom.join('') + '</div></div>' +
          '<div class="baygroup"><h3>Top barn · bays 9–12</h3><div class="racks">' + top.join('') + '</div></div>'
        : '<p class="lede">No bay has been recorded at intake yet. Every bay below reads empty because ' +
          'nothing has been logged, not because the barn is.</p>' +
          '<div class="baygroup"><h3>Bottom barn · bays 1–8</h3><div class="racks">' + bottom.join('') + '</div></div>' +
          '<div class="baygroup"><h3>Top barn · bays 9–12</h3><div class="racks">' + top.join('') + '</div></div>') +
      '<div class="legend"><span><i style="background:var(--straw)"></i>hanging, under ' +
      d.dry_window.min + ' d</span>' +
      '<span><i style="background:var(--leaf)"></i>hanging, in the window</span>' +
      '<span><i style="background:var(--clay)"></i>hanging, past ' + d.dry_window.max + ' d</span>' +
      '<span><i style="background:var(--sky)"></i>coming down</span></div>' +
      '<p class="caveat">A bay is <b>coming down</b> from the first sack tagged out of it, and stays that ' +
      'way until a fresh load is hung there. Nothing records the moment a bay is emptied — the takedown ' +
      'screen picks a bay and writes it on the sack, and that is all — so the board can say when takedown ' +
      '<b>started</b> and never when it finished. A refill is the only honest end signal, because you ' +
      'cannot hang a trailer in a full bay. Days freeze at the first tag: material already on the floor ' +
      'should stop ageing.</p></section>';
  }

  // 6 ── the feed
  function cardFeed(d) {
    var rows = d.feed.map(function (e) {
      return '<tr><td class="t">' + esc(String(e.at).replace('T', ' ').slice(0, 19)) + '</td>' +
        '<td><span class="kind k-' + esc(e.kind) + '">' + esc(e.kind) + '</span></td>' +
        '<td class="zone">' + esc(e.zone || '—') + '</td>' +
        '<td class="crewtag">' + esc(e.crew ? 'Crew ' + e.crew : '') + '</td>' +
        '<td>' + esc(e.detail || '') + '</td></tr>';
    }).join('');
    return '<section class="card"><h2>Every timestamp</h2>' +
      '<p class="lede">Newest first — ' + d.feed.length + ' of ' + d.feed_total +
      ' events. Times are UTC, as stored.</p>' +
      '<div class="feedwrap"><table class="feed"><thead><tr><th>When (UTC)</th><th>What</th><th>Zone</th>' +
      '<th>Crew</th><th>Detail</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  // Come back without retyping, within the tab's life.
  try {
    var saved = sessionStorage.getItem('rf_dash_pw');
    if (saved) load(saved);
  } catch (e) {}
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
