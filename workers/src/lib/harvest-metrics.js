/**
 * Cycle times for the harvest dashboard.
 *
 * Pure: it is handed rows and the lot ledger and returns the shapes the page
 * draws. Nothing here talks to D1, so every number below is testable against a
 * fixture rather than against a live season.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 * 1. Lot-shaped numbers come from the ledger (`computeRollup`), never from a
 *    second aggregation over the same table. Two ways of counting bins per lot
 *    eventually disagree and nothing tells you which is right.
 *
 * 2. A session that ran overnight cannot have its duration used as work. The
 *    crew does not leave the last zone of the day — they stop and pick up there
 *    next morning — so open-to-close contains a night. The ledger already
 *    withholds `cutter_person_hours` for those; a dwell chart drawn from the
 *    same timestamps would re-publish exactly the figure the ledger refused to
 *    state, in a more believable form. So dwell counts same-day sessions only
 *    and reports how many it left out.
 */

/** SQLite's `datetime('now')` is UTC without a zone marker. */
export function parseTs(ts) {
  return ts ? new Date(String(ts).replace(' ', 'T') + 'Z') : null;
}

const MIN = 60000;
const DAY = 86400000;
const r1 = (n) => Math.round(n * 10) / 10;

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {object} input
 * @param {Array}  input.lots      rows from computeRollup — the ledger's own lots
 * @param {Array}  input.sessions  harvest_scan_log 'enter' rows
 * @param {Array}  input.loads     harvest_scan_log 'barn_load' rows
 * @param {Array}  input.sacks     harvest_sacks rows (unvoided)
 * @param {object} input.dryWindow { min, typical, max } days on the rack
 * @param {number} input.bottomBarnLastBay  bays above this number are the top barn
 * @param {number} [input.bayCount]  how many bays exist; all of them are reported
 * @param {number} [input.nowMs]
 */
export function buildMetrics({ lots, sessions, loads, sacks, dryWindow, bottomBarnLastBay,
                               bayCount = 12, nowMs = Date.now() }) {
  const sessionById = new Map(sessions.map(s => [s.id, s]));
  const lotOfSession = new Map();
  for (const lot of lots) for (const id of lot.session_ids || []) lotOfSession.set(id, lot);

  // ── Dry days: cut to first tag ──────────────────────────────────────────
  // The same judgement the takedown picker makes when it badges a lot READY /
  // TOO GREEN / OVERDUE, shown as a distribution instead of one row at a time —
  // so the picker and the dashboard explain each other rather than each having
  // its own idea of "about right".
  const firstPrintByLot = new Map();
  for (const s of sacks) {
    if (!s.printed_at) continue;
    const lot = lotOfSession.get(s.session_id);
    if (!lot) continue;
    const at = parseTs(s.printed_at).getTime();
    const cur = firstPrintByLot.get(lot.lot_id);
    if (cur === undefined || at < cur) firstPrintByLot.set(lot.lot_id, at);
  }

  const dryDays = [];
  for (const lot of lots) {
    const first = firstPrintByLot.get(lot.lot_id);
    if (first === undefined) continue;               // nothing tagged yet
    // From the moment the zone was SCANNED, not from midnight of that date.
    // The lot carries `cut_date` as a bare date, and measuring from it adds up
    // to 24 hours of slop to a figure the READY / TOO GREEN badge is judged
    // against — a rack cut at 4pm would read most of a day drier than it is.
    // The takedown picker already measures from the timestamp; this matches it.
    const opens = (lot.session_ids || [])
      .map(id => sessionById.get(id))
      .filter(Boolean)
      .map(x => parseTs(x.occurred_at).getTime());
    const cut = opens.length ? Math.min(...opens)
      : new Date(lot.cut_date + 'T00:00:00Z').getTime();
    const days = r1((first - cut) / DAY);
    dryDays.push({
      lot_id: lot.lot_id,
      zone: lot.zone,
      cultivar: lot.cultivar,
      cut_number: lot.cut_number,
      cut_date: lot.cut_date,
      first_tag_at: new Date(first).toISOString(),
      days,
      sacks: lot.sacks,
      level: days < dryWindow.min ? 'green' : days > dryWindow.max ? 'overdue' : 'ready',
    });
  }
  dryDays.sort((a, b) => a.days - b.days);

  // ── Trailer cadence: gap between consecutive loads on one lot ───────────
  // Deliberately the GAP, not time elapsed since the zone opened. Elapsed-since
  // grows with every load whatever the crew does, so it reads as a slowdown
  // that is really just the afternoon; the gap is the thing that actually moves
  // when cutting or hauling speeds up.
  const loadsByLot = new Map();
  for (const l of loads) {
    if (!l.session_id) continue;
    const lot = lotOfSession.get(l.session_id);
    if (!lot) continue;
    if (!loadsByLot.has(lot.lot_id)) loadsByLot.set(lot.lot_id, []);
    loadsByLot.get(lot.lot_id).push(l);
  }

  const cadence = [];
  const allGaps = [];
  for (const [lotId, ls] of loadsByLot) {
    ls.sort((a, b) => parseTs(a.occurred_at) - parseTs(b.occurred_at));
    const gaps = [];
    for (let i = 1; i < ls.length; i++) {
      const g = (parseTs(ls[i].occurred_at) - parseTs(ls[i - 1].occurred_at)) / MIN;
      // A gap that crosses a night is the night, not a slow trailer.
      if (g > 0 && g <= 600) { gaps.push(r1(g)); allGaps.push(r1(g)); }
    }
    const lot = lots.find(x => x.lot_id === lotId);
    cadence.push({
      lot_id: lotId,
      zone: lot?.zone ?? null,
      loads: ls.length,
      bins: ls.reduce((t, x) => t + (x.bins || 0), 0),
      median_gap_min: gaps.length ? r1(median(gaps)) : null,
      gaps,
    });
  }
  cadence.sort((a, b) => (a.median_gap_min ?? 1e9) - (b.median_gap_min ?? 1e9));

  // ── Time in zone, same-day sessions only ───────────────────────────────
  const dwell = [];
  let dwellExcluded = 0;
  for (const s of sessions) {
    if (!s.closed_at) continue;
    const a = parseTs(s.occurred_at), b = parseTs(s.closed_at);
    if (s.spans_days) { dwellExcluded++; continue; }
    dwell.push({
      session_id: s.id,
      zone: s.zone,
      crew: s.crew,
      hours: r1((b - a) / 3600000),
      headcount: s.headcount,
      opened_at: s.occurred_at,
    });
  }
  dwell.sort((a, b) => b.hours - a.hours);

  // ── Tag to open ────────────────────────────────────────────────────────
  // This is ORDER latency, not process latency: sacks are bucked when there is
  // an order for that strain, so a lot cut in October can legitimately sit
  // until spring. A long bar here is a sales fact, not something to go and fix.
  const opened = sacks.filter(s => s.printed_at && s.opened_at);
  const latencyDays = opened.map(s =>
    r1((parseTs(s.opened_at) - parseTs(s.printed_at)) / DAY));
  const waiting = sacks.filter(s => s.printed_at && !s.opened_at);
  const orderLatency = {
    opened: opened.length,
    waiting: waiting.length,
    median_days: latencyDays.length ? r1(median(latencyDays)) : null,
    days: latencyDays.sort((a, b) => a - b),
    oldest_waiting_days: waiting.length
      ? r1(Math.max(...waiting.map(s => (nowMs - parseTs(s.printed_at).getTime()) / DAY)))
      : null,
  };

  // ── Crew A vs B ────────────────────────────────────────────────────────
  // Bins per cutter-hour. The hours come from the LEDGER's per-session figure,
  // which is null for any session that ran overnight — so the denominator here
  // covers fewer sessions than the numerator would if left alone. Both counts
  // are reported: a rate over an unstated subset is worse than no rate.
  //
  // THE NUMERATOR AND THE DENOMINATOR MUST COVER THE SAME SESSIONS. Counting
  // every bin a crew delivered against only the hours that survived the
  // overnight rule inflates whichever crew happened to work more late zones —
  // in the worked example that alone made one crew read twice as productive as
  // the other. So `bins_rated` counts only loads whose own session has hours,
  // and the rate is built from that pair. `bins` stays the true total, reported
  // beside it, because "how much did this crew move" is a real question too.
  const ratedSessions = new Set();
  const crewAgg = new Map();
  const crewOf = (c) => {
    const k = c || 'untagged';
    if (!crewAgg.has(k)) crewAgg.set(k, {
      crew: c || null, bins: 0, bins_rated: 0, loads: 0, cutter_person_hours: 0,
      sessions_counted: 0, sessions_total: 0,
    });
    return crewAgg.get(k);
  };

  for (const lot of lots) {
    for (const ps of lot.sessions || []) {
      const sess = sessionById.get(ps.session_id);
      const agg = crewOf(sess?.crew);
      agg.sessions_total++;
      if (ps.cutter_person_hours !== null && ps.cutter_person_hours !== undefined) {
        agg.cutter_person_hours += ps.cutter_person_hours;
        agg.sessions_counted++;
        ratedSessions.add(ps.session_id);
      }
    }
  }
  for (const l of loads) {
    const agg = crewOf(l.crew);
    agg.bins += l.bins || 0;
    agg.loads++;
    if (l.session_id && ratedSessions.has(l.session_id)) agg.bins_rated += l.bins || 0;
  }

  const crew = [...crewAgg.values()].map(c => ({
    ...c,
    cutter_person_hours: r1(c.cutter_person_hours),
    bins_per_cutter_hour: c.sessions_counted && c.cutter_person_hours > 0
      ? r1(c.bins_rated / c.cutter_person_hours) : null,
  })).sort((a, b) => String(a.crew ?? 'zz').localeCompare(String(b.crew ?? 'zz')));

  // ── Bays ───────────────────────────────────────────────────────────────
  const bayAgg = new Map();
  for (const s of sacks) {
    if (!s.bay) continue;
    if (!bayAgg.has(s.bay)) bayAgg.set(s.bay, { bay: s.bay, sacks: 0, lots: new Set(), last_at: null });
    const b = bayAgg.get(s.bay);
    b.sacks++;
    const lot = lotOfSession.get(s.session_id);
    if (lot) b.lots.add(lot.lot_id);
    if (s.printed_at && (!b.last_at || s.printed_at > b.last_at)) b.last_at = s.printed_at;
  }
  const bays = [...bayAgg.values()]
    .map(b => ({
      bay: b.bay,
      barn: b.bay > bottomBarnLastBay ? 'top' : 'bottom',
      sacks: b.sacks,
      lots: b.lots.size,
      last_tagged_at: b.last_at,
    }))
    .sort((a, b) => a.bay - b.bay);

  // ── The racks: what is hanging in which bay, right now ─────────────────
  //
  // The bay is captured twice now, and the two are different facts: on the LOAD
  // row it is where material was hung, on the SACK row it is where material
  // came from. This section is the only place they meet.
  //
  // WHY FILLS. A bay is not emptied in one go — the code's own comment at
  // getLastBay says a bay sees several takedowns — so "this lot has a sack from
  // this bay, therefore that lot is down" would call a bay empty while half of
  // it is still hanging. That is the same disagreement-with-the-barn the old
  // grid had, just inverted.
  //
  // Nothing records "bay emptied": the takedown form picks a bay and writes it
  // to the sack, and that is all. But a REFILL is a completion signal and it is
  // free — you cannot hang a fresh trailer in a full bay. So a bay's loads
  // group into fills, a fill closes at the first tag out of that bay after it
  // started, and a load arriving after that opens the next one. Only the
  // current fill is described.
  //
  // `coming_down` is therefore open-ended ON PURPOSE. We learn when takedown
  // STARTED and never when it finished — only that the bay was refilled. The
  // card says so; a fourth state claiming completion would be invented.
  const loadsByBay = new Map();
  for (const l of loads) {
    if (!l.bay) continue;
    if (!loadsByBay.has(l.bay)) loadsByBay.set(l.bay, []);
    loadsByBay.get(l.bay).push(l);
  }
  const tagsByBay = new Map();
  for (const s2 of sacks) {
    if (!s2.bay || !s2.printed_at) continue;
    if (!tagsByBay.has(s2.bay)) tagsByBay.set(s2.bay, []);
    tagsByBay.get(s2.bay).push(parseTs(s2.printed_at).getTime());
  }

  const racks = [];
  for (let bay = 1; bay <= bayCount; bay++) {
    // Every bay is reported, including the ones nothing has been near. A bay
    // missing from the list and a bay standing empty look identical on a grid,
    // and only one of them is true.
    const cell = {
      bay,
      barn: bay > bottomBarnLastBay ? 'top' : 'bottom',
      state: 'empty',
      bins: 0,
      loads: 0,
      lots: [],
      hung_at: null,
      days: null,
      level: null,
      first_tag_at: null,
      sacks_out: 0,
    };

    const bayLoads = (loadsByBay.get(bay) || [])
      .slice()
      .sort((a, b) => parseTs(a.occurred_at) - parseTs(b.occurred_at));
    const bayTags = (tagsByBay.get(bay) || []).slice().sort((a, b) => a - b);

    if (bayLoads.length) {
      let fill = null;
      for (const l of bayLoads) {
        const at = parseTs(l.occurred_at).getTime();
        // A tag between this fill's start and this load means the bay came down
        // in between, so this load is the start of the next fill.
        if (fill && bayTags.some(t => t > fill.startMs && t <= at)) fill = null;
        if (!fill) fill = { startMs: at, loads: [] };
        fill.loads.push(l);
      }

      const since = bayTags.filter(t => t > fill.startMs);
      cell.state = since.length ? 'coming_down' : 'hanging';
      cell.hung_at = new Date(fill.startMs).toISOString();
      cell.loads = fill.loads.length;
      cell.sacks_out = since.length;
      cell.first_tag_at = since.length ? new Date(since[0]).toISOString() : null;

      // Hanging: how long it has been up, and still climbing. Coming down: the
      // days it actually got, frozen at the first tag. Reporting "now minus
      // hung" for a bay already being emptied would keep ageing material that
      // is on the floor.
      const end = since.length ? since[0] : nowMs;
      cell.days = r1((end - fill.startMs) / DAY);
      cell.level = cell.days < dryWindow.min ? 'green'
        : cell.days > dryWindow.max ? 'overdue' : 'ready';

      const byLot = new Map();
      for (const l of fill.loads) {
        cell.bins += l.bins || 0;
        const lot = l.session_id ? lotOfSession.get(l.session_id) : null;
        // A load with no lot still counts its bins — it is physically in the
        // bay. It is keyed by zone so the cell can still say where it came from.
        const key = lot ? lot.lot_id : `?${l.zone}`;
        if (!byLot.has(key)) {
          byLot.set(key, {
            lot_id: lot ? lot.lot_id : null,
            zone: l.zone,
            cultivar: lot ? lot.cultivar : null,
            cut_number: lot ? lot.cut_number : null,
            bins: 0,
          });
        }
        byLot.get(key).bins += l.bins || 0;
      }
      cell.lots = [...byLot.values()].sort((a, b) => b.bins - a.bins);
    }

    racks.push(cell);
  }

  // ── The feed — what Koa asked for first: the timestamps themselves ──────
  const feed = [];
  for (const s of sessions) {
    feed.push({ at: s.occurred_at, kind: 'enter', zone: s.zone, crew: s.crew,
      detail: `${s.cultivar || '—'} · cut ${s.cut_number}${s.headcount ? ` · ${s.headcount} cutters` : ''}` });
    if (s.closed_at) {
      feed.push({ at: s.closed_at, kind: 'leave', zone: s.zone, crew: s.crew,
        detail: s.spans_days ? 'closed next day' : '' });
    }
  }
  for (const l of loads) {
    feed.push({ at: l.occurred_at, kind: 'load', zone: l.zone, crew: l.crew,
      detail: `${l.bins} bins${l.session_id ? '' : ' · NO LOT'}` });
  }
  for (const s of sacks) {
    if (s.printed_at) feed.push({ at: s.printed_at, kind: 'tag', zone: s.zone, crew: null,
      detail: `${s.sack_id}${s.bay ? ` · bay ${s.bay}` : ''}` });
    if (s.opened_at) feed.push({ at: s.opened_at, kind: 'open', zone: s.zone, crew: null,
      detail: s.sack_id });
  }
  feed.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    dry_days: dryDays,
    dry_window: dryWindow,
    cadence,
    all_gaps: allGaps.sort((a, b) => a - b),
    dwell,
    dwell_excluded_overnight: dwellExcluded,
    order_latency: orderLatency,
    crew,
    bays,
    racks,
    feed: feed.slice(0, 200),
    feed_total: feed.length,
    counts: {
      lots: lots.length,
      sessions: sessions.length,
      sessions_open: sessions.filter(s => !s.closed_at).length,
      loads: loads.length,
      loads_unattributed: loads.filter(l => !l.session_id).length,
      bins: loads.reduce((t, l) => t + (l.bins || 0), 0),
      sacks: sacks.length,
      sacks_opened: sacks.filter(s => s.opened_at).length,
    },
  };
}
