/**
 * Section renderers. Each takes state (or a slice of it) and writes HTML into
 * its container. No fetching here — see main.js.
 */
import {
  esc, num, int, money, pct, deltaChip, hourShort, cultivarShort, cultivarParts,
  dur, minutes, clockTime, dayLabel, dayShort, weekday, noteLines, isNum,
} from './format.js';
import { renderLedger } from './ledger.js';
import { columnChart, lineChart } from './svg.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- totals

export function workedDays(daily) {
  return (daily || []).filter((d) => (d.totalLbs || 0) > 0);
}

export function periodTotals(daily) {
  const days = workedDays(daily);
  const t = { tops: 0, smalls: 0, lbs: 0, laborCost: 0, trimmerHours: 0, operatorHours: 0, crewSum: 0, days: days.length, topsCostW: 0, smallsCostW: 0, best: null };
  for (const d of days) {
    t.tops += d.totalTops || 0;
    t.smalls += d.totalSmalls || 0;
    t.lbs += d.totalLbs || 0;
    t.laborCost += d.laborCost || 0;
    t.trimmerHours += d.trimmerHours || 0;
    t.operatorHours += d.operatorHours || 0;
    t.crewSum += d.totalCrew || 0;
    t.topsCostW += (d.topsCostPerLb || 0) * (d.totalTops || 0);
    t.smallsCostW += (d.smallsCostPerLb || 0) * (d.totalSmalls || 0);
    if (!t.best || (d.totalTops || 0) > t.best.totalTops) t.best = d;
  }
  t.rate = t.trimmerHours > 0 ? t.tops / t.trimmerHours : null;
  t.costPerLb = t.lbs > 0 ? t.laborCost / t.lbs : null;
  t.topsCostPerLb = t.tops > 0 ? t.topsCostW / t.tops : null;
  t.smallsCostPerLb = t.smalls > 0 ? t.smallsCostW / t.smalls : null;
  t.avgCrew = t.days ? t.crewSum / t.days : null;
  t.topsPerDay = t.days ? t.tops / t.days : null;
  return t;
}

/** Totals for the comparison period, honouring `pickLast` for single-day ranges. */
export function prevTotals(state) {
  const { range, prev } = state;
  if (!prev?.daily) return null;
  if (range.prev.pickLast) {
    const days = workedDays(prev.daily);
    const last = days[days.length - 1];
    if (!last) return null;
    return { ...periodTotals([last]), label: dayLabel(last.date) };
  }
  return { ...periodTotals(prev.daily), label: range.prev.label };
}

function tile({ label, value, unit = '', sub = '' }) {
  return `<div class="card tile"><div class="label">${esc(label)}</div><div class="value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div><div class="sub">${sub}</div></div>`;
}

function statusDot(kind, text) {
  return `<span class="status ${kind}">${esc(text)}</span>`;
}

// ---------------------------------------------------------------- Right now

export function renderNow(state) {
  const { range, data, score, morning } = state;
  const host = $('nowBody');
  if (!data) { host.innerHTML = '<div class="empty">Production data is not available right now.</div>'; return; }

  const prev = prevTotals(state);
  const vs = prev?.label || '';

  if (range.live) {
    const today = data.today || {};
    const cur = data.current || {};
    const sb = score?.scoreboard || {};
    const timer = score?.timer || {};
    const target = data.targets?.totalTops || cur.todayTarget || 0;
    const tops = today.totalTops || 0;
    const pctv = target > 0 ? (tops / target) * 100 : 0;
    const hoursLogged = (data.hourly || []).filter((h) => (h.lbs || 0) > 0).length;

    let pace;
    if (!hoursLogged) {
      const y = morning?.yesterday;
      pace = y
        ? `No hours logged yet. Yesterday (${esc(y.dateDisplay)}): <strong>${num(y.tops)} lbs tops</strong>, ${num(y.smalls, 0)} smalls, ${num(y.rate, 2)} lb/trimmer/hr.`
        : 'No hours logged yet. The first entry from the floor manager will start the ledger.';
    } else if (pctv >= 100) {
      pace = `<strong>Target met</strong> — ${pct(pctv, 0)} of ${num(target, 0)} lbs after ${num(cur.effectiveHours, 1)} effective hours.`;
    } else {
      const remaining = target - tops;
      const perHr = cur.effectiveHours > 0 ? tops / cur.effectiveHours : 0;
      const hrs = perHr > 0 ? remaining / perHr : null;
      pace = `Projected <strong>${num(cur.projectedTotal || tops)} lbs</strong> · ${num(remaining)} lbs to target${hrs ? ` ≈ ${num(hrs, 1)} h at the current pace` : ''}.`;
    }

    const rateTarget = sb.targetRate || (data.hourly || []).slice(-1)[0]?.target || null;
    const rateOk = isNum(rateTarget) ? (today.avgRate || 0) >= rateTarget : null;
    const sinceBag = timer.secondsSinceLastBag;
    const bagStale = isNum(sinceBag) && sinceBag > 3 * 3600;

    host.innerHTML = `
      <div class="card hero">
        <div class="strain">${esc(cultivarShort(cur.strain) || 'No cultivar logged')}</div>
        <div class="big"><span class="n">${num(tops)}</span><span class="u">lbs tops today</span></div>
        <div class="sub">Total ${num(today.totalLbs)} lbs incl. ${num(today.totalSmalls, 0)} smalls ${hoursLogged ? deltaChip(tops, prev?.tops, { vs }) : ''}</div>
        <div class="meter${pctv >= 100 ? '' : pctv < 60 && hoursLogged > 5 ? ' warn' : ''}" role="progressbar" aria-valuenow="${Math.round(pctv)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to daily target"><span style="width:${Math.min(100, pctv).toFixed(1)}%"></span></div>
        <div class="pace">${pace}</div>
      </div>
      ${tile({
        label: 'Rate, lbs per trimmer-hour',
        value: num(today.avgRate, 2),
        sub: !hoursLogged
          ? (prev ? `<span class="muted">${esc(vs)}: ${num(prev.rate, 2)}</span>` : '')
          : isNum(rateTarget)
            ? `${statusDot(rateOk ? 'good' : 'warn', rateOk ? 'At target' : 'Below target')} <span class="muted">target ${num(rateTarget, 2)}</span>${isNum(sb.streak) && sb.streak > 1 ? ` · ${sb.streak} hrs in a row` : ''}`
            : deltaChip(today.avgRate, prev?.rate, { vs }),
      })}
      ${tile({
        label: 'Crew on line',
        value: int(today.trimmers),
        unit: 'trimmers',
        sub: `${int(today.buckers)} buckers${isNum(today.tzero) && today.tzero > 0 ? ` · ${int(today.tzero)} T0` : ''} · ${int(today.operatorHours)} operator-hrs`,
      })}
      ${tile({
        label: 'Last bag',
        value: timer.lastBagTime ? (bagStale ? clockTime(timer.lastBagTime) : dur(sinceBag)) : '—',
        unit: timer.lastBagTime ? (bagStale ? '' : 'ago') : '',
        sub: timer.lastBagTime
          ? `${bagStale ? '' : `${clockTime(timer.lastBagTime)} · `}${esc(timer.lastBagSize || '')}${isNum(timer.targetSeconds) ? ` · target ${minutes(timer.targetSeconds)}` : ''}`
          : 'No bags logged yet',
      })}
      ${tile({
        label: 'Bags today',
        value: int(timer.bagsToday ?? data.bagTimer?.bagsToday),
        sub: `${isNum(timer.avgSecondsToday) && timer.avgSecondsToday > 0 ? `avg cycle ${minutes(timer.avgSecondsToday)}` : `avg cycle ${esc(data.bagTimer?.avgTime || '—')}`}${isNum(timer.bags10lbToday) || isNum(timer.bags5kgToday) ? ` · ${int(timer.bags10lbToday || 0)} × 10 lb, ${int(timer.bags5kgToday || 0)} × 5 kg` : ''}`,
      })}`;
    return;
  }

  // Historical single day or multi-day range
  const t = periodTotals(data.daily);
  const single = range.days === 1;
  host.innerHTML = `
    <div class="card hero">
      <div class="strain">${single ? esc(dayLabel(range.start, { year: 'numeric' })) : `${esc(range.label)} · ${t.days} day${t.days === 1 ? '' : 's'} worked`}</div>
      <div class="big"><span class="n">${num(t.tops)}</span><span class="u">lbs tops</span></div>
      <div class="sub">Total ${num(t.lbs)} lbs incl. ${num(t.smalls, 0)} smalls ${deltaChip(t.tops, prev?.tops, { vs })}</div>
      <div class="pace">${t.days
        ? single
          ? `${esc(cultivarShort(workedDays(data.daily)[0]?.cultivar))} · ${num(t.trimmerHours, 0)} trimmer-hours`
          : `<strong>${num(t.topsPerDay)} lbs/day</strong> average${t.best ? ` · best day ${num(t.best.totalTops)} lbs on ${esc(dayLabel(t.best.date))}` : ''}`
        : 'No output logged in this range.'}</div>
    </div>
    ${tile({ label: 'Rate, lbs per trimmer-hour', value: num(t.rate, 2), sub: deltaChip(t.rate, prev?.rate, { vs }) })}
    ${tile({ label: single ? 'Crew' : 'Average crew per day', value: num(t.avgCrew, single ? 0 : 1), sub: `${num(t.trimmerHours, 0)} trimmer-hrs · ${num(t.operatorHours, 0)} operator-hrs` })}
    ${tile({ label: 'Labor per lb of tops', value: money(t.topsCostPerLb, 2), sub: deltaChip(t.topsCostPerLb, prev?.topsCostPerLb, { vs, upIsGood: false }) })}
    ${tile({ label: single ? 'Labor cost' : 'Days worked', value: single ? money(t.laborCost) : int(t.days), sub: single ? `${money(t.costPerLb, 2)} per lb blended` : `${money(t.laborCost)} labor` })}`;
}

// ---------------------------------------------------------------- Ledger

export function renderShift(state) {
  const { range, data } = state;
  const host = $('ledgerHost');
  const notesHost = $('shiftNotes');
  const title = $('shiftTitle');
  const meta = $('shiftMeta');
  if (!data) { host.innerHTML = ''; notesHost.innerHTML = ''; return; }

  const hourly = (data.hourly || []).filter((h) => (h.lbs || 0) > 0 || (h.trimmers || 0) > 0);
  if (range.live && hourly.length) {
    title.textContent = 'This shift';
    meta.textContent = `${hourly.length} hour${hourly.length === 1 ? '' : 's'} logged · ${cultivarShort(data.current?.strain)}`;
    const columns = hourly.map((h, i) => ({
      label: hourShort(h.label),
      tipTitle: h.label,
      tops: h.tops, smalls: h.smalls, rate: h.rate, target: h.target,
      trimmers: h.trimmers, buckers: h.buckers,
      notes: noteLines(h.notes).join('\n'),
      current: i === hourly.length - 1,
    }));
    renderLedger(host, { columns, mode: 'hour' });
    const notes = hourly.filter((h) => noteLines(h.notes).length);
    notesHost.innerHTML = notes.length
      ? `<div class="eyebrow" style="margin-bottom:6px">Shift notes</div>${notes.map((h) => `<div class="note"><div class="when">${esc(hourShort(h.label))}</div><div class="body">${esc(noteLines(h.notes).join('\n'))}</div></div>`).join('')}`
      : '';
    return;
  }

  const source = range.days === 1 ? (state.trend || data) : data;
  const days = workedDays(source.daily).filter((d) => d.date <= range.end);
  title.textContent = range.live ? 'This shift' : 'Day by day';
  meta.textContent = range.live ? 'Nothing logged yet today · recent days' : range.days === 1 ? `${dayLabel(range.start)} and the days before it` : `${days.length} day${days.length === 1 ? '' : 's'} worked · ${range.label}`;
  const columns = days.slice(-14).map((d) => ({
    label: dayShort(d.date),
    sub: weekday(d.date),
    tipTitle: dayLabel(d.date),
    tops: d.totalTops, smalls: d.totalSmalls, rate: d.avgRate,
    crew: d.totalCrew,
    cultivar: (d.cultivars || []).length > 1 ? d.cultivars.map((c) => cultivarParts(c.cultivar).name).join(', ') : cultivarShort(d.cultivar),
    notes: noteLines(d.notes).join('\n'),
  }));
  renderLedger(host, { columns, mode: 'day' });
  const notes = days.slice(-14).filter((d) => noteLines(d.notes).length);
  notesHost.innerHTML = notes.length
    ? `<div class="eyebrow" style="margin-bottom:6px">Notes</div>${notes.map((d) => `<div class="note"><div class="when">${esc(dayShort(d.date))}</div><div class="body">${esc(noteLines(d.notes).join('\n'))}</div></div>`).join('')}`
    : '';
}

// ---------------------------------------------------------------- Pipe

export function renderPipe(pipe) {
  const host = $('pipeBody');
  const q = pipe.queue;
  const cov = pipe.coverage;
  const tops = pipe.tops;

  let queueHtml;
  if (!q) queueHtml = '<div class="empty">Queue unavailable.</div>';
  else if (!q.blocks?.length) queueHtml = '<div class="empty">Nothing queued. <a href="wholesale.html">Add an order</a>.</div>';
  else {
    queueHtml = `<div class="queue">${q.blocks.map((b) => {
      const p = Math.max(0, Math.min(1, b.pct || 0));
      const fin = b.finish?.date ? `finish ~${dayLabel(b.finish.date)}` : '';
      const passes = (b.passes || []).map((ps) => `<span class="q-pass${(ps.pct || 0) >= 1 ? ' done' : (ps.pct || 0) > 0 ? ' active' : ''}">${esc(ps.cultivarName)} ${esc(ps.form)} ${num(ps.doneLbs, 0)}/${num(ps.totalLbs, 0)}</span>`).join('');
      return `<div class="q-row">
        <div class="q-head"><div><b>${esc(b.nickname || b.orderId)}</b><span class="ref">${esc(b.orderRef || '')}</span></div><span class="fin">${esc(fin)}</span></div>
        <div class="meter${p >= 1 ? '' : ''}"><span style="width:${(p * 100).toFixed(1)}%"></span></div>
        <div class="q-nums"><span><b>${num(b.doneLbs)}</b> of <b>${num(b.totalLbs, 0)}</b> lbs</span><span>${pct(p * 100, 0)}</span></div>
        ${passes ? `<div class="q-passes">${passes}</div>` : ''}
      </div>`;
    }).join('')}</div>${q.blocksTotal > q.blocks.length ? `<div class="empty">+${q.blocksTotal - q.blocks.length} more on the <a href="wholesale.html">board</a></div>` : ''}`;
  }

  let covHtml;
  if (!cov) covHtml = '<div class="empty">Coverage unavailable.</div>';
  else if (!cov.coverage?.length) covHtml = '<div class="empty">No committed lines to cover.</div>';
  else {
    const rows = [...cov.coverage].sort((a, b) => (b.short === true) - (a.short === true) || (b.shortfallLbs || 0) - (a.shortfallLbs || 0));
    const shortCount = rows.filter((r) => r.short).length;
    covHtml = `<div style="margin-bottom:8px">${shortCount ? statusDot('warn', `${shortCount} line${shortCount === 1 ? '' : 's'} short of committed lbs`) : statusDot('good', 'Every committed line is covered')}</div>
      <div class="table-scroll"><table class="grid-table">
      <thead><tr><th>Cultivar</th><th>Form</th><th class="n">Committed</th><th class="n">Finished</th><th class="n">Raw sacks</th><th class="n">Short</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.short ? 'short' : ''}"><td>${esc(r.cultivarName)}</td><td class="dim">${esc(r.form)}</td><td class="n">${num(r.committedLbs, 0)}</td><td class="n">${num(r.finishedLbs, 0)}</td><td class="n dim">${int(r.rawSacks)}</td><td class="n">${r.short ? num(r.shortfallLbs, 0) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const topsHtml = tops
    ? `<div class="tile"><div class="value">${int(tops.finished_tops_lbs)}<small>lbs</small></div><div class="sub">projected from <b class="num">${int(tops.inventory_sacks)}</b> raw sacks on hand</div><div class="sub muted">as of ${esc(clockTime(tops.as_of))}</div></div>`
    : '<div class="empty">Sack inventory unavailable.</div>';

  host.innerHTML = `
    <div class="card"><div class="card-title"><h3>Order queue</h3><a href="wholesale.html">Open board</a></div>${queueHtml}</div>
    <div class="card"><div class="card-title"><h3>Committed vs finished</h3><a href="wholesale.html">Coverage</a></div>${covHtml}</div>
    <div class="card"><div class="card-title"><h3>Finished tops on hand</h3><a href="supersack-analytics.html">Analytics</a></div>${topsHtml}</div>`;
}

// ---------------------------------------------------------------- Watchlist

export function renderWatch(w) {
  const host = $('watchBody');
  const c = w.complaints;
  const r = w.reorders;
  const cart = w.cart;
  const qa = w.qa;

  const complaintsTile = c
    ? tile({
      label: 'Open complaints',
      value: int(c.open),
      sub: `${statusDot((c.open || 0) > 0 ? 'warn' : 'good', (c.open || 0) > 0 ? 'Needs a response' : 'All resolved')} <span class="muted">${int(c.in_progress)} in progress · ${int(c.resolved)} resolved</span>`,
    })
    : tile({ label: 'Open complaints', value: '—', sub: '<span class="err">Unavailable</span>' });

  const reorderTile = r
    ? `<div class="card tile"><div class="label">Reorder requests</div><div class="value">${int(r.count)}</div><div class="sub">${statusDot((r.count || 0) > 0 ? 'warn' : 'good', (r.count || 0) > 0 ? 'Waiting on a vendor' : 'None open')}</div>${(r.requests || []).length ? `<ul class="list">${r.requests.slice(0, 4).map((x) => `<li><span>${esc(x.item)}</span><span>${esc(x.supplier || '')}</span></li>`).join('')}</ul>` : ''}</div>`
    : tile({ label: 'Reorder requests', value: '—', sub: '<span class="err">Unavailable</span>' });

  let cartTile;
  if (cart) {
    const vendors = Object.entries(cart.cart || {}).map(([v, items]) => ({ v, n: items.length }));
    cartTile = `<div class="card tile"><div class="label">Reorder cart</div><div class="value">${int(cart.count)}<small>items</small></div><div class="sub">${statusDot((cart.count || 0) > 0 ? 'warn' : 'none', (cart.count || 0) > 0 ? 'Goes out Friday' : 'Cart is empty')}</div>${vendors.length ? `<ul class="list">${vendors.map((x) => `<li><span>${esc(x.v)}</span><span>${x.n} item${x.n === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : ''}</div>`;
  } else cartTile = tile({ label: 'Reorder cart', value: '—', sub: '<span class="err">Unavailable</span>' });

  let qaTile;
  if (qa) {
    const n = (qa.counts?.missingWeights || 0) + (qa.counts?.overAttributed || 0);
    qaTile = `<div class="card tile"><div class="label">Supersack data check</div><div class="value">${qa.hasAnomalies ? int(n) : '0'}<small>flags</small></div><div class="sub">${qa.hasAnomalies ? statusDot('warn', 'Fix before the Monday report') : statusDot('good', 'Clean, last 7 days')}</div>${qa.hasAnomalies ? `<ul class="list"><li><span>Missing weights</span><span>${int(qa.counts?.missingWeights)}</span></li><li><span>Over-attributed</span><span>${int(qa.counts?.overAttributed)}</span></li></ul>` : ''}</div>`;
  } else qaTile = tile({ label: 'Supersack data check', value: '—', sub: '<span class="err">Unavailable</span>' });

  host.innerHTML = `
    <a class="card-link" href="complaints.html">${complaintsTile}</a>
    <a class="card-link" href="kanban.html">${reorderTile}</a>
    <a class="card-link" href="kanban.html">${cartTile}</a>
    <a class="card-link" href="supersack-entry.html">${qaTile}</a>`;
}

// ---------------------------------------------------------------- Trend

export function renderTrend(state) {
  const { range, score } = state;
  const data = range.days === 1 ? (state.trend || state.data) : state.data;
  const title = $('trendTitle');
  const meta = $('trendMeta');
  const cols = $('trendColumns');
  const line = $('trendLine');
  if (!data) return;
  const days = workedDays(data.daily).filter((d) => d.date <= range.end);
  title.textContent = range.days > 1 ? range.label : 'Last 30 days';
  meta.textContent = `${days.length} day${days.length === 1 ? '' : 's'} with output`;

  // No target line here: the daily target moves with crew and cultivar, so a
  // single hairline across thirty days would misstate most of them. The
  // reference is the 7-day average of tops instead.
  const avg7 = days.length >= 3 ? days.slice(-7).reduce((a, d) => a + (d.totalTops || 0), 0) / Math.min(7, days.length) : null;
  columnChart(cols, {
    rows: days.map((d) => ({ label: dayShort(d.date), sub: `${dayLabel(d.date)} · ${cultivarShort(d.cultivar)}`, tops: d.totalTops || 0, smalls: d.totalSmalls || 0 })),
    target: avg7,
    targetLabel: '7-day avg tops',
  });
  $('trendColumnsLegend').innerHTML = `<span><i class="tops"></i>Tops</span><span><i class="smalls"></i>Smalls</span>${avg7 ? '<span><i class="tgt"></i>7-day average of tops</span>' : ''}`;

  const rates = days.map((d) => d.avgRate);
  const ma = rates.map((_, i) => {
    const w = rates.slice(Math.max(0, i - 6), i + 1).filter(isNum);
    return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  const rateTarget = score?.scoreboard?.targetRate || null;
  lineChart(line, {
    rows: days.map((d, i) => ({ label: dayShort(d.date), sub: `${dayLabel(d.date)} · ${cultivarShort(d.cultivar)}`, value: d.avgRate, ma: ma[i] })),
    target: rateTarget,
    unit: 'lb/tr/hr',
    valueLabel: 'Rate',
  });
  $('trendLineLegend').innerHTML = `<span><i class="tops"></i>Daily rate</span><span><i class="ma"></i>7-day average</span>${rateTarget ? '<span><i class="tgt"></i>Target rate for today’s cultivar</span>' : ''}`;
}

// ---------------------------------------------------------------- Cultivars

export function renderCultivars(state) {
  const host = $('cultivarBody');
  const snap = state.data?.strainSnapshot || [];
  if (!snap.length) { host.innerHTML = '<div class="empty">No cultivar output in the last 7 days.</div>'; return; }
  const max = Math.max(...snap.map((s) => s.tops || 0), 1);
  host.innerHTML = `<div class="table-scroll"><table class="grid-table">
    <thead><tr><th>Cultivar</th><th class="n">Days</th><th class="n">Tops lbs</th><th class="n">Tops share</th><th class="n">Rate</th><th class="n">$/lb tops</th></tr></thead>
    <tbody>${snap.map((s) => {
      const p = cultivarParts(s.strain);
      const share = s.totalLbs > 0 ? (s.tops / s.totalLbs) * 100 : null;
      return `<tr><td><div class="cultivar-name">${esc(p.name)}<small>${esc([p.grow, p.year].filter(Boolean).join(' · '))}</small></div></td><td class="n dim">${int(s.daysWorked)}</td><td class="n"><span class="bar-inline" style="width:${Math.round((s.tops / max) * 48)}px"></span>${num(s.tops)}</td><td class="n dim">${pct(share, 0)}</td><td class="n">${num(s.avgRate, 2)}</td><td class="n">${money(s.topsCostPerLb, 2)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- Cost

export function renderCost(state) {
  const host = $('costBody');
  const meta = $('costMeta');
  const { data, range } = state;
  if (!data) return;
  const t = range.live && data.today?.laborCost != null
    ? { ...periodTotals(workedDays(data.daily).filter((d) => d.date === range.end)), laborCost: data.today.laborCost, operatorHours: data.today.operatorHours, costPerLb: data.today.costPerLb, topsCostPerLb: data.today.topsCostPerLb, smallsCostPerLb: data.today.smallsCostPerLb }
    : periodTotals(data.daily);
  // Before the first hour is logged every cost is zero; a delta against
  // yesterday would just say "-100%" six times.
  const started = !range.live || (data.today?.laborCost || 0) > 0;
  const prev = started ? prevTotals(state) : null;
  const vs = prev?.label || '';
  meta.textContent = range.label;
  host.innerHTML = `<div class="cost-grid">
    ${tile({ label: 'Labor cost', value: money(t.laborCost), sub: deltaChip(t.laborCost, prev?.laborCost, { vs, upIsGood: false }) })}
    ${tile({ label: 'Operator hours', value: num(t.operatorHours, 0), sub: deltaChip(t.operatorHours, prev?.operatorHours, { vs, upIsGood: false }) })}
    ${tile({ label: 'Trimmer hours', value: num(t.trimmerHours, 0), sub: deltaChip(t.trimmerHours, prev?.trimmerHours, { vs, upIsGood: false }) })}
    ${tile({ label: '$ per lb, blended', value: money(t.costPerLb, 2), sub: deltaChip(t.costPerLb, prev?.costPerLb, { vs, upIsGood: false }) })}
    ${tile({ label: '$ per lb, tops', value: money(t.topsCostPerLb, 2), sub: deltaChip(t.topsCostPerLb, prev?.topsCostPerLb, { vs, upIsGood: false }) })}
    ${tile({ label: '$ per lb, smalls', value: money(t.smallsCostPerLb, 2), sub: deltaChip(t.smallsCostPerLb, prev?.smallsCostPerLb, { vs, upIsGood: false }) })}
  </div>`;
}

// ---------------------------------------------------------------- Daily table

export function renderDaily(state) {
  const host = $('dailyBody');
  const meta = $('dailyMeta');
  const source = state.range.days === 1 ? (state.trend || state.data) : state.data;
  const days = workedDays(source?.daily).filter((d) => d.date <= state.range.end).reverse();
  meta.textContent = `${days.length} row${days.length === 1 ? '' : 's'}${state.range.days === 1 ? ' · last 30 days' : ''}`;
  if (!days.length) { host.innerHTML = '<div class="empty">No days with output in this range.</div>'; return; }
  host.innerHTML = `<div class="table-scroll"><table class="grid-table">
    <thead><tr><th>Date</th><th>Cultivar</th><th class="n">Tops</th><th class="n">Smalls</th><th class="n">Total</th><th class="n">Rate</th><th class="n">Crew</th><th class="n">$/lb tops</th><th class="n">Labor</th><th>Notes</th></tr></thead>
    <tbody>${days.map((d) => {
      const cult = (d.cultivars || []).length > 1 ? d.cultivars.map((c) => `${cultivarParts(c.cultivar).name} ${num(c.tops, 0)}`).join(', ') : cultivarShort(d.cultivar);
      const note = noteLines(d.notes).join(' · ');
      return `<tr><td class="num">${esc(dayLabel(d.date))}</td><td>${esc(cult)}</td><td class="n">${num(d.totalTops)}</td><td class="n dim">${num(d.totalSmalls, 0)}</td><td class="n">${num(d.totalLbs)}</td><td class="n">${num(d.avgRate, 2)}</td><td class="n dim">${int(d.totalCrew)}</td><td class="n">${money(d.topsCostPerLb, 2)}</td><td class="n dim">${money(d.laborCost)}</td><td class="dim" title="${esc(note)}">${esc(note.length > 70 ? `${note.slice(0, 70)}…` : note)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

export function dailyCsv(state) {
  const source = state.range.days === 1 ? (state.trend || state.data) : state.data;
  const days = workedDays(source?.daily).filter((d) => d.date <= state.range.end);
  const head = ['date', 'cultivar', 'tops_lbs', 'smalls_lbs', 'total_lbs', 'rate_lb_per_trimmer_hr', 'crew', 'trimmer_hours', 'operator_hours', 'labor_cost', 'cost_per_lb', 'tops_cost_per_lb', 'smalls_cost_per_lb', 'notes'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = days.map((d) => [d.date, d.cultivar, d.totalTops, d.totalSmalls, d.totalLbs, d.avgRate, d.totalCrew, d.trimmerHours, d.operatorHours, d.laborCost, d.costPerLb, d.topsCostPerLb, d.smallsCostPerLb, noteLines(d.notes).join(' | ')].map(q).join(','));
  return `${head.join(',')}\n${rows.join('\n')}`;
}
