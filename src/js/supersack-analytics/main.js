/**
 * Supersack Analytics page (src/pages/supersack-analytics.html).
 */
// Sacks per day come from the salida scan-out (2026-10-13 on) merged with the
// water spider's end-of-day tracker; tops and smalls per cultivar from the
// hourly log. The merge rules live in ../js/shared/supersack-days.js
// (tests/supersack-days.test.mjs pins them).
import {
  SCAN_START, buildDays, lbsFillMap, scanDays, unclosedDays, cultivarTotals, projectVariant, mapLimit,
} from '../shared/supersack-days.js';

(function() {
  'use strict';

  // -- i18n --
  const LANG = {
    en: {
      title: 'Supersack Analytics', entryLink: 'Entry', today: 'Today',
      thisWeek: 'This Week', thisMonth: 'This Month', last30: 'Last 30 Days',
      allTime: 'All Time', kpiTotalSacks: 'Total Sacks', kpiOpened: 'opened',
      kpiAvgDay: 'Avg / Day', kpiSacksDay: 'sacks/day',
      kpiRawProcessed: 'Raw Processed', kpiAvgYield: 'Avg Tops Yield %',
      kpiTopsSmalls: 'tops only', chartSacksDay: 'Supersacks / Day',
      chartYield: 'Yield Composition', chartYieldSub: 'Percent of raw material by day', chartStrain: 'Strain Comparison',
      chartStrainSub: 'Tops and smalls as % of raw',
      chartRate: 'Production Rate (lbs/hr)', sectionInventory: 'Remaining Inventory & Projections',
      currentInventory: 'Current Inventory by Strain', totalInventory: 'Total Supersacks', totalDaysLeft: 'Total Days Left', sectionCost: 'Production Rate & Cost Metrics',
      laborMetrics: 'Labor & Cost Metrics', loading: 'Loading...',
      costsLocked: 'Labor costs are locked. Unlock with the shared password on the Hub, then reload.',
      strain: 'Strain', sacks: 'Sacks', daysSupply: 'Days Supply',
      projYield: 'Proj. Yield (lbs)', depletes: 'Depletes',
      noData: 'No data for selected range', lbsHr: 'Lbs / Hr',
      lbsTrimmer: 'Lbs / Trimmer', costLb: 'Cost / Tops Lb', totalLabor: 'Total Labor',
      topsLabor: 'Tops Labor', smallsLabor: 'Smalls Labor',
      topsHr: 'Tops / Hr', smallsHr: 'Smalls / Hr', topsTrimmer: 'Tops / Trimmer', smallsTrimmer: 'Smalls / Trimmer',
      chartSacksOp: 'Supersacks / Operator / Day',
      sacksOp: 'Sacks/Operator', operators: 'Operators',
      movingAvg: '7-day avg', tops: 'Tops', smalls: 'Smalls',
      biomass: 'Biomass', trim: 'Trim', waste: 'Waste', notWeighed: 'Not weighed',
      topsP: 'Tops %', smallsP: 'Smalls %', wasteP: 'Waste %',
      never: 'N/A', errorLoad: 'Failed to load data',
      sectionDays: 'Day by Day', daysSub: 'Sacks scanned out at salida. Tops from the hourly log.',
      closed: 'Closed', notClosed: 'Not closed', inProgress: 'In progress', fromTracker: 'Tracker count',
      sacksWord: 'sacks', perSack: '/sack', lbRaw: 'lb raw', lbSmalls: 'lb smalls', light: '{n} light', topsPerSack: 'tops/sack', lbTops: 'lb tops', other: 'Other',
      showAll: 'Show all {n} days', showLess: 'Show fewer',
      unclosed: 'Not closed yet, so no biomass or trim weights: {days}.',
      scanGaps: 'Scan-out did not answer for {n} day(s); those days use the tracker only.',
      rawEst: 'lbs · some est. from sacks', rawLbs: 'lbs · sacks opened', yieldSubN: 'tops only · {n} lb tops/sack',
      yearFix: 'Hourly log used another crop year for this cultivar',
      noTops: 'no tops logged', thinTitle: 'Only {n} sacks in this range, too few to project',
    },
    es: {
      title: 'Analisis de Supersacos', entryLink: 'Entrada', today: 'Hoy',
      thisWeek: 'Esta Semana', thisMonth: 'Este Mes', last30: 'Ultimos 30 Dias',
      allTime: 'Todo', kpiTotalSacks: 'Total Sacos', kpiOpened: 'abiertos',
      kpiAvgDay: 'Prom / Dia', kpiSacksDay: 'sacos/dia',
      kpiRawProcessed: 'Bruto Procesado', kpiAvgYield: 'Rend. Prom. Tops %',
      kpiTopsSmalls: 'solo tops', chartSacksDay: 'Supersacos / Dia',
      chartYield: 'Composicion del Rendimiento', chartYieldSub: 'Porcentaje del material bruto por dia', chartStrain: 'Comparacion por Variedad',
      chartStrainSub: 'Tops y smalls como % del bruto',
      chartRate: 'Tasa de Produccion (lbs/hr)', sectionInventory: 'Inventario Restante y Proyecciones',
      currentInventory: 'Inventario Actual por Variedad', totalInventory: 'Supersacos Totales', totalDaysLeft: 'Dias Totales Restantes', sectionCost: 'Tasa de Produccion y Costos',
      laborMetrics: 'Metricas de Labor y Costo', loading: 'Cargando...',
      costsLocked: 'Los costos de labor estan bloqueados. Desbloquee con la contrasena compartida en el Hub y recargue.',
      strain: 'Variedad', sacks: 'Sacos', daysSupply: 'Dias Restantes',
      projYield: 'Rend. Proy. (lbs)', depletes: 'Se Agota',
      noData: 'Sin datos para el rango seleccionado', lbsHr: 'Lbs / Hr',
      lbsTrimmer: 'Lbs / Podador', costLb: 'Costo / Lb Tops', totalLabor: 'Labor Total',
      topsLabor: 'Labor Tops', smallsLabor: 'Labor Smalls',
      topsHr: 'Tops / Hr', smallsHr: 'Smalls / Hr', topsTrimmer: 'Tops / Podador', smallsTrimmer: 'Smalls / Podador',
      chartSacksOp: 'Supersacos / Operador / Dia',
      sacksOp: 'Sacos/Operador', operators: 'Operadores',
      movingAvg: 'Prom. 7 dias', tops: 'Tops', smalls: 'Smalls',
      biomass: 'Biomasa', trim: 'Recorte', waste: 'Desperdicio', notWeighed: 'Sin pesar',
      topsP: 'Tops %', smallsP: 'Smalls %', wasteP: 'Desperdicio %',
      never: 'N/A', errorLoad: 'Error al cargar datos',
      sectionDays: 'Dia por Dia', daysSub: 'Sacos escaneados en salida. Tops del registro por hora.',
      closed: 'Cerrado', notClosed: 'Sin cerrar', inProgress: 'En curso', fromTracker: 'Conteo del registro',
      sacksWord: 'sacos', perSack: '/saco', lbRaw: 'lb bruto', lbSmalls: 'lb smalls', light: '{n} livianos', topsPerSack: 'tops/saco', lbTops: 'lb tops', other: 'Otros',
      showAll: 'Ver los {n} dias', showLess: 'Ver menos',
      unclosed: 'Sin cerrar, sin pesos de biomasa ni recorte: {days}.',
      scanGaps: 'El escaneo de salida no respondio para {n} dia(s); esos dias usan solo el registro.',
      rawEst: 'lbs · parte est. por sacos', rawLbs: 'lbs · sacos abiertos', yieldSubN: 'solo tops · {n} lb tops/saco',
      yearFix: 'El registro por hora uso otro ano de cosecha para esta variedad',
      noTops: 'sin tops registrados', thinTitle: 'Solo {n} sacos en este rango, muy pocos para proyectar',
    }
  };
  const lang = () => (window.getLang && window.getLang()) || 'en';
  const t = (key, vars) => {
    let s = (LANG[lang()] && LANG[lang()][key]) || LANG.en[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function applyLang() {
    const l = lang();
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (LANG[l][key]) el.textContent = LANG[l][key];
    });
    document.getElementById('lang-toggle').textContent = l === 'en' ? 'ES' : 'EN';
    // Re-render from what is already loaded; never refetch on a language switch.
    if (state.days) renderAll();
    if (state.inventoryData) renderInventory();
    if (state.costData !== undefined) renderCostCard();
  }

  document.getElementById('lang-toggle').addEventListener('click', () => window.toggleLang());
  document.addEventListener('ro:langchange', applyLang);

  // -- APIs --
  const SS_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack';
  const POOL_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool';
  const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
  const HARVEST_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/harvest';
  const CONCURRENCY = 6;

  // -- State --
  const state = {
    startDate: '', endDate: '', activePreset: 'month',
    days: null, hourlyByDate: {}, scanGaps: 0, showAllDays: false, fills: null,
    inventoryData: null, costData: undefined,
  };
  let loadSeq = 0;

  // -- Chart instances --
  let chartSacks = null, chartYield = null, chartStrain = null, chartRate = null, chartSacksOp = null;

  // -- Chart.js defaults --
  Chart.defaults.color = 'rgba(232,228,220,0.55)';
  Chart.defaults.borderColor = 'rgba(102, 137, 113, 0.1)';
  Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
  Chart.defaults.font.size = 11;

  // -- Helpers --
  function todayStr() { return new Date().toLocaleDateString('en-CA'); }
  function fmt(n, dec = 0) { return n == null ? '--' : Number(n).toLocaleString(undefined, { maximumFractionDigits: dec }); }
  function dayLabel(date, opts = { weekday: 'short', month: 'numeric', day: 'numeric' }) {
    return new Date(date + 'T12:00:00').toLocaleDateString(lang() === 'es' ? 'es-US' : 'en-US', opts);
  }
  const shortDay = (date) => dayLabel(date, { month: 'numeric', day: 'numeric' });
  const cultivarLabel = (c) => (c.season && c.season < 2026 ? `${c.cultivar} '${String(c.season).slice(2)}` : c.cultivar);

  function getPresetDates(preset) {
    const today = new Date();
    const end = todayStr();
    let start;
    switch (preset) {
      case 'today':
        start = end; break;
      case 'week': {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay());
        start = d.toLocaleDateString('en-CA');
        break;
      }
      case 'month':
        start = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01';
        break;
      case '30': {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        start = d.toLocaleDateString('en-CA');
        break;
      }
      case 'all':
        start = '2025-01-01'; break;
      default:
        start = end;
    }
    return { start, end };
  }

  function movingAverage(arr, window = 7) {
    return arr.map((_, i) => {
      const slice = arr.slice(Math.max(0, i - window + 1), i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }

  // -- Date Controls --
  const dateStart = document.getElementById('date-start');
  const dateEnd = document.getElementById('date-end');
  const presetBtns = document.querySelectorAll('.preset-btn');

  function setPreset(preset) {
    state.activePreset = preset;
    const { start, end } = getPresetDates(preset);
    state.startDate = start;
    state.endDate = end;
    dateStart.value = start;
    dateEnd.value = end;
    presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    loadAllData();
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => setPreset(btn.dataset.preset));
  });

  dateStart.addEventListener('change', () => {
    state.startDate = dateStart.value;
    state.activePreset = null;
    presetBtns.forEach(b => b.classList.remove('active'));
    loadAllData();
  });
  dateEnd.addEventListener('change', () => {
    state.endDate = dateEnd.value;
    state.activePreset = null;
    presetBtns.forEach(b => b.classList.remove('active'));
    loadAllData();
  });

  // -- Data Loading --
  async function fetchJSON(url) {
    // The dashboard read only includes labor costs for callers with the
    // shared password; send it when this device has unlocked on the Hub.
    const headers = {};
    try { const pw = localStorage.getItem('ro_api_password'); if (pw) headers.Authorization = `Bearer ${pw}`; } catch { /* storage blocked */ }
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json();
    return raw.data || raw;
  }

  async function loadAllData() {
    const token = ++loadSeq;
    const s = state.startDate, e = state.endDate;
    state.showAllDays = false;
    // A newer range was picked while this one loaded: drop this one's results.
    const stale = () => token !== loadSeq;

    // Inventory and cost are independent of the merge.
    loadCostData(token);

    try {
      const scanDates = scanDays(s, e, SCAN_START);
      const [history, scans] = await Promise.all([
        fetchJSON(`${SS_API}?action=history&start=${s}&end=${e}`),
        mapLimit(scanDates, CONCURRENCY, d => fetchJSON(`${HARVEST_API}?action=sack_out_today&date=${d}`).catch(() => undefined)),
      ]);
      if (stale()) return;
      const entries = history.entries || [];
      const scansByDate = {};
      let scanGaps = 0;
      scanDates.forEach((d, i) => { if (scans[i] === undefined) scanGaps++; else scansByDate[d] = scans[i]; });

      // Takedown weights of light sacks. The scan payload carries fill_lbs once
      // the worker that adds it is deployed; until then one read of every
      // opened sack supplies them. A failed read means full sacks.
      const needFills = scans.some(p => (p?.groups || []).some(g => (g.sacks || []).some(x => !('fill_lbs' in x))));
      if (needFills && !state.fills) {
        state.fills = await fetchJSON(`${HARVEST_API}?action=sacks&opened=true&limit=1000`)
          .then(r => lbsFillMap(Array.isArray(r) ? r : (r.data || [])))
          .catch(() => ({}));
        if (stale()) return;
      }

      // Hourly rows only for days that opened sacks.
      const sackDates = [...new Set([...entries.map(x => x.date), ...scanDates.filter(d => (scansByDate[d]?.total || 0) > 0)])].sort();
      const hourly = await mapLimit(sackDates, CONCURRENCY,
        d => fetchJSON(`${PROD_API}?action=getProduction&date=${d}`).then(r => r.production || []).catch(() => null));
      if (stale()) return;
      const hourlyByDate = {};
      sackDates.forEach((d, i) => { if (hourly[i]) hourlyByDate[d] = hourly[i]; });

      state.hourlyByDate = hourlyByDate;
      state.scanGaps = scanGaps;
      state.days = buildDays({ entries, scansByDate, hourlyByDate, fills: state.fills || {} });
      renderAll();
    } catch (err) {
      if (stale()) return;
      console.error('Load error:', err);
      state.days = null;
      destroyCharts();
      ['kpi-sacks', 'kpi-avg-day', 'kpi-raw', 'kpi-yield'].forEach(id => { document.getElementById(id).textContent = '--'; });
      document.getElementById('days-list').innerHTML = `<div class="error-msg">${t('errorLoad')}</div>`;
    }

    // Projections need this range's merged days.
    loadInventory(token);
  }

  async function loadInventory(token) {
    const card = document.getElementById('inventory-card');
    try {
      if (!state.inventoryData) {
        const r = await fetch(`${POOL_API}?action=get_supersack_variants`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({}),
        });
        const raw = await r.json();
        state.inventoryData = (raw.data || raw).variants || [];
      }
      if (token !== loadSeq) return;
      renderInventory();
    } catch (err) {
      console.error('Inventory error:', err);
      card.innerHTML = `<div class="card-title" data-i18n="currentInventory">${t('currentInventory')}</div><div class="error-msg">${t('errorLoad')}</div>`;
    }
  }

  async function loadCostData(token) {
    const card = document.getElementById('cost-card');
    try {
      const start = state.startDate;
      const end = state.endDate;
      const dashboard = await fetchJSON(`${PROD_API}?action=dashboard&start=${start}&end=${end}`);
      if (token !== loadSeq) return;
      const daily = dashboard.daily || [];

      if (dashboard.costsLocked) { state.costData = { locked: true }; renderCostCard(); return; }
      if (!daily.length) { state.costData = null; renderCostCard(); return; }

      const totalTops = daily.reduce((s, d) => s + (d.totalTops || 0), 0);
      const totalSmalls = daily.reduce((s, d) => s + (d.totalSmalls || 0), 0);
      const totalLabor = daily.reduce((s, d) => s + (d.laborCost || 0), 0);
      const totalOperatorHours = daily.reduce((s, d) => s + (d.operatorHours || 0), 0);
      const totalTrimmerHours = daily.reduce((s, d) => s + (d.trimmerHours || 0), 0);
      const totalTopsLaborCost = daily.reduce((s, d) => s + ((d.topsCostPerLb || 0) * (d.totalTops || 0)), 0);
      const totalSmallsLaborCost = daily.reduce((s, d) => s + ((d.smallsCostPerLb || 0) * (d.totalSmalls || 0)), 0);
      const daysWorked = daily.filter(d => (d.totalTops || 0) > 0 || (d.totalSmalls || 0) > 0).length || daily.length;

      state.costData = {
        totalTops,
        totalSmalls,
        totalHours: totalOperatorHours,
        totalLabor,
        totalTopsLaborCost,
        totalSmallsLaborCost,
        totalTrimmerHours,
        avgTrimmers: daysWorked > 0 ? (totalTrimmerHours / 7.5) / daysWorked : 0,
        daysWorked,
      };
      renderCostCard();
    } catch (err) {
      if (token !== loadSeq) return;
      console.error('Cost data error:', err);
      card.innerHTML = `<div class="card-title" data-i18n="laborMetrics">${t('laborMetrics')}</div><div class="error-msg">${t('errorLoad')}</div>`;
    }
  }

  function renderAll() {
    renderKPIs();
    renderDays();
    renderCharts();
  }

  // -- KPI Rendering --
  function renderKPIs() {
    const days = state.days || [];
    const yieldSub = document.getElementById('kpi-yield-sub');
    const rawSub = document.getElementById('kpi-raw-sub');
    if (!days.length) {
      ['kpi-sacks', 'kpi-avg-day', 'kpi-raw', 'kpi-yield'].forEach(id => {
        document.getElementById(id).textContent = '--';
      });
      yieldSub.textContent = t('kpiTopsSmalls');
      rawSub.textContent = t('rawLbs');
      return;
    }

    const totalSacks = days.reduce((s, d) => s + d.sacks, 0);
    const totalRaw = days.reduce((s, d) => s + d.raw, 0);
    const totalTops = days.reduce((s, d) => s + d.tops, 0);
    const daysWorked = days.filter(d => d.sacks > 0).length || 1;
    const avgYield = totalRaw > 0 ? (totalTops / totalRaw * 100) : 0;

    document.getElementById('kpi-sacks').textContent = fmt(totalSacks);
    document.getElementById('kpi-avg-day').textContent = fmt(totalSacks / daysWorked, 1);
    document.getElementById('kpi-raw').textContent = fmt(totalRaw);
    document.getElementById('kpi-yield').textContent = fmt(avgYield, 1) + '%';
    rawSub.textContent = days.some(d => d.rawEstimated) ? t('rawEst') : t('rawLbs');
    yieldSub.textContent = totalSacks > 0 ? t('yieldSubN', { n: fmt(totalTops / totalSacks, 1) }) : t('kpiTopsSmalls');
  }

  // -- Day by day cards --
  const DAYS_SHOWN = 8;
  function renderDays() {
    const list = document.getElementById('days-list');
    const notice = document.getElementById('days-notice');
    const days = (state.days || []).filter(d => d.sacks > 0).slice().reverse(); // newest first
    const today = todayStr();

    const notes = [];
    const open = unclosedDays(state.days || [], today);
    if (open.length) notes.push(t('unclosed', { days: open.map(shortDay).join(', ') }));
    if (state.scanGaps) notes.push(t('scanGaps', { n: state.scanGaps }));
    notice.innerHTML = notes.map(n => `<div class="days-notice">${esc(n)}</div>`).join('');

    if (!days.length) { list.innerHTML = `<div class="loading-msg">${t('noData')}</div>`; return; }

    const shown = state.showAllDays ? days : days.slice(0, DAYS_SHOWN);
    let html = '<div class="day-grid">';
    for (const d of shown) {
      const status = d.date === today && !d.weighed ? ['today', t('inProgress')]
        : d.weighed ? ['closed', t('closed')] : ['open', t('notClosed')];
      const maxSacks = Math.max(...d.cultivars.map(c => c.sacks), 1);
      html += `<div class="day-card">`;
      html += `<div class="day-head"><span class="day-date">${esc(dayLabel(d.date))}</span><span class="day-badge ${status[0]}">${esc(status[1])}</span></div>`;
      html += `<div class="day-total"><span class="day-big">${fmt(d.sacks)}</span><span class="day-unit">${t('sacksWord')}</span>`
        + `<span class="day-big day-raw">${fmt(d.raw)}</span><span class="day-unit">${t('lbRaw')}${d.rawEstimated ? ' (est.)' : ''}</span></div>`;
      html += `<div class="day-line">${fmt(d.tops, 1)} ${t('lbTops')} · ${fmt(d.smalls, 1)} ${t('lbSmalls')} · ${d.sacks ? fmt(d.tops / d.sacks, 1) : '--'} ${t('topsPerSack')}</div>`;
      html += `<div class="day-cults">`;
      for (const c of d.cultivars) {
        if (!c.sacks) continue;
        const flags = (c.sacksFrom === 'tracker' && d.scanned ? `<span class="cult-flag" title="${esc(t('fromTracker'))}">✎</span>` : '')
          + (c.seasonFallback ? `<span class="cult-flag" title="${esc(t('yearFix'))}">⚑</span>` : '');
        const yieldTxt = c.tops > 0 || c.smalls > 0
          ? `${fmt(c.tops, 1)} tops · ${fmt(c.smalls, 1)} smalls · ${fmt(c.tops / c.sacks, 1)}${t('perSack')}`
          : t('noTops');
        const lightTxt = c.lightSacks ? ` (${t('light', { n: c.lightSacks })})` : '';
        const tps = `${yieldTxt}${lightTxt}`;
        html += `<div class="cult-row">`
          + `<div class="cult-top"><span class="cult-name">${esc(cultivarLabel(c))}${flags}</span><span class="cult-sacks">${fmt(c.sacks)}<span class="cult-raw">${fmt(c.raw)} lb</span></span></div>`
          + `<div class="cult-bar"><div class="cult-fill" style="width:${(c.sacks / maxSacks * 100).toFixed(0)}%"></div></div>`
          + `<div class="cult-tops">${esc(tps)}</div>`
          + `</div>`;
      }
      html += `</div></div>`;
    }
    html += '</div>';
    if (days.length > DAYS_SHOWN) {
      html += `<button class="show-more" id="days-more">${state.showAllDays ? t('showLess') : t('showAll', { n: days.length })}</button>`;
    }
    list.innerHTML = html;
    const more = document.getElementById('days-more');
    if (more) more.addEventListener('click', () => { state.showAllDays = !state.showAllDays; renderDays(); });
  }

  // -- Chart Rendering --
  const COLORS = {
    tops: '#668971', smalls: '#e4aa4f', biomass: '#62758d',
    trim: '#8b7355', waste: '#c45c4a', unweighed: 'rgba(232,228,220,0.12)',
  };
  const CULTIVAR_COLORS = ['#668971', '#e4aa4f', '#62758d', '#a8c4a2', '#8b7355', '#c9a0dc'];
  const OTHER_COLOR = 'rgba(232,228,220,0.25)';

  function destroyCharts() {
    [chartSacks, chartYield, chartStrain, chartRate, chartSacksOp].forEach(c => c && c.destroy());
    chartSacks = chartYield = chartStrain = chartRate = chartSacksOp = null;
  }

  function renderCharts() {
    destroyCharts();
    const days = (state.days || []).filter(d => d.sacks > 0); // oldest first
    const totals = cultivarTotals(days);
    const labels = days.map(d => shortDay(d.date));

    // -- Sacks/Day: stacked by cultivar (top 5 + other) with the 7-day average --
    const top = totals.slice(0, 5);
    const topKeys = new Set(top.map(c => `${c.season}|${c.cultivar}`));
    const series = top.map((c, i) => ({
      label: cultivarLabel(c),
      data: days.map(d => d.cultivars.filter(x => x.season === c.season && x.cultivar === c.cultivar).reduce((n, x) => n + x.sacks, 0)),
      backgroundColor: CULTIVAR_COLORS[i % CULTIVAR_COLORS.length],
      stack: 'sacks', borderRadius: 3, order: 2,
    }));
    const otherData = days.map(d => d.cultivars.filter(x => !topKeys.has(`${x.season}|${x.cultivar}`)).reduce((n, x) => n + x.sacks, 0));
    if (otherData.some(n => n > 0)) series.push({ label: t('other'), data: otherData, backgroundColor: OTHER_COLOR, stack: 'sacks', borderRadius: 3, order: 2 });
    const sacksData = days.map(d => d.sacks);
    series.push({
      type: 'line', label: t('movingAvg'), data: movingAverage(sacksData, 7),
      borderColor: 'rgba(232,228,220,0.7)', borderDash: [5, 3], pointRadius: 0, tension: 0.4, fill: false, order: 1,
    });

    chartSacks = new Chart(document.getElementById('chart-sacks-day'), {
      type: 'bar',
      data: { labels, datasets: series },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, padding: 10 } },
          tooltip: { mode: 'index', intersect: false, filter: (i) => i.parsed.y > 0 || i.dataset.type === 'line',
            callbacks: { footer: (items) => `${t('kpiTotalSacks')}: ${sacksData[items[0]?.dataIndex] ?? 0}` } },
        },
        scales: {
          x: { stacked: true, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });

    // -- Yield composition (100% stacked). A day not closed has no biomass or
    //    trim weights: its remainder shows as "Not weighed", never as waste.
    const pct = (d, v) => (d.raw > 0 ? (v || 0) / d.raw * 100 : 0);
    const part = (label, color, fn) => ({
      label, backgroundColor: color,
      data: days.map(d => pct(d, fn(d))), rawData: days.map(d => fn(d) || 0),
    });
    chartYield = new Chart(document.getElementById('chart-yield'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          part(t('tops'), COLORS.tops, d => d.tops),
          part(t('smalls'), COLORS.smalls, d => d.smalls),
          part(t('biomass'), COLORS.biomass, d => (d.weighed ? d.biomass : 0)),
          part(t('trim'), COLORS.trim, d => (d.weighed ? d.trim : 0)),
          part(t('waste'), COLORS.waste, d => (d.weighed ? d.waste : 0)),
          part(t('notWeighed'), COLORS.unweighed, d => (d.weighed ? 0 : Math.max(0, d.raw - d.tops - d.smalls))),
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, padding: 10 } },
          tooltip: {
            filter: (i) => i.parsed.y > 0,
            callbacks: {
              label(context) {
                const p = context.parsed.y || 0;
                const lbs = context.dataset.rawData?.[context.dataIndex] || 0;
                return `${context.dataset.label}: ${fmt(p, 1)}% (${fmt(lbs, 1)} lbs)`;
              },
              footer(items) {
                const idx = items[0]?.dataIndex;
                const d = idx != null ? days[idx] : null;
                return d ? `Raw: ${fmt(d.raw, 1)} lbs${d.rawEstimated ? ' (est.)' : ''}` : '';
              }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
        }
      }
    });

    // -- Cultivar comparison: tops and smalls as % of raw --
    const strains = totals.filter(c => c.sacks > 0 && c.raw > 0);
    if (strains.length) {
      chartStrain = new Chart(document.getElementById('chart-strain'), {
        type: 'bar',
        data: {
          labels: strains.map(c => `${cultivarLabel(c)} (${c.sacks})`),
          datasets: [
            { label: t('topsP'), data: strains.map(c => c.tops / c.raw * 100), backgroundColor: COLORS.tops },
            { label: t('smallsP'), data: strains.map(c => c.smalls / c.raw * 100), backgroundColor: COLORS.smalls },
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { boxWidth: 12, padding: 10 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.x, 1)}%` } },
          },
          scales: {
            x: { stacked: true, beginAtZero: true, ticks: { callback: v => v + '%' } },
            y: { stacked: true }
          }
        }
      });
    }

    renderRateChart(days, labels);
    renderSacksPerOperator(days, labels);
  }

  function renderRateChart(days, labels) {
    if (!days.length) return;
    // Estimate lbs/hr: assume 7.5 effective hours per day
    const HOURS_PER_DAY = 7.5;
    const ptRadius = days.length > 30 ? 0 : 3;
    chartRate = new Chart(document.getElementById('chart-rate'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: t('tops') + ' /hr',
          data: days.map(d => d.tops / HOURS_PER_DAY),
          borderColor: COLORS.tops,
          backgroundColor: 'rgba(102, 137, 113, 0.1)',
          fill: true, tension: 0.3, pointRadius: ptRadius, pointBackgroundColor: COLORS.tops,
        }, {
          label: t('smalls') + ' /hr',
          data: days.map(d => d.smalls / HOURS_PER_DAY),
          borderColor: COLORS.smalls,
          backgroundColor: 'rgba(228, 170, 79, 0.1)',
          fill: true, tension: 0.3, pointRadius: ptRadius, pointBackgroundColor: COLORS.smalls,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, padding: 10 } } },
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { beginAtZero: true }
        }
      }
    });
  }

  // -- Sacks per Operator chart: crew from the hourly rows already loaded --
  function renderSacksPerOperator(days, labels) {
    if (!days.length) return;
    const crewPerDay = days.map(d => {
      const rows = state.hourlyByDate[d.date] || [];
      // Avg operators = avg (trimmers + buckers) across active slots
      const activeSlots = rows.filter(r => (r.trimmers1 || 0) + (r.trimmers2 || 0) + (r.buckers1 || 0) + (r.buckers2 || 0) > 0);
      if (!activeSlots.length) return 0;
      const totalOps = activeSlots.reduce((s, r) =>
        s + (r.effectiveTrimmers1 || r.trimmers1 || 0) + (r.effectiveTrimmers2 || r.trimmers2 || 0)
          + (r.buckers1 || 0) + (r.buckers2 || 0), 0);
      return totalOps / activeSlots.length;
    });
    const sacksOpData = days.map((d, i) => crewPerDay[i] > 0 ? +(d.sacks / crewPerDay[i]).toFixed(2) : 0);
    const ptRadius = days.length > 30 ? 0 : 4;

    chartSacksOp = new Chart(document.getElementById('chart-sacks-op'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: t('sacksOp'),
            data: sacksOpData,
            backgroundColor: 'rgba(102, 137, 113, 0.6)',
            borderColor: COLORS.tops,
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            label: t('operators'),
            data: crewPerDay.map(c => +c.toFixed(1)),
            type: 'line',
            borderColor: COLORS.smalls,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: ptRadius,
            pointBackgroundColor: COLORS.smalls,
            borderDash: [5, 3],
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, padding: 10 } } },
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { beginAtZero: true, position: 'left', title: { display: true, text: t('sacksOp'), font: { size: 10 } } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: t('operators'), font: { size: 10 } } },
        }
      }
    });
  }

  // -- Inventory Rendering --
  function renderInventory() {
    const card = document.getElementById('inventory-card');
    const variants = state.inventoryData || [];
    const days = (state.days || []).filter(d => d.sacks > 0);
    const totals = cultivarTotals(days);

    if (!variants.length) {
      card.innerHTML = `<div class="card-title" data-i18n="currentInventory">${t('currentInventory')}</div><div class="loading-msg">${t('noData')}</div>`;
      return;
    }

    const totalInventory = variants.reduce((sum, v) => sum + (v.quantity || 0), 0);
    // "Total days left" uses the global daily throughput (all sacks ÷ days
    // worked), not the sum of per-cultivar full-time rates, which would
    // double-count capacity since cultivars share the same line time.
    const totalSacks = days.reduce((n, d) => n + d.sacks, 0);
    const totalDailyThroughput = days.length ? totalSacks / days.length : 0;
    const totalDaysLeft = totalDailyThroughput > 0 ? Math.round(totalInventory / totalDailyThroughput) : null;

    let html = `<div class="card-title">${t('currentInventory')}</div>`;
    html += `<div class="inventory-summary">`;
    html += `<div class="inventory-stat"><div class="inventory-stat-label">${t('totalInventory')}</div><div class="inventory-stat-value">${fmt(totalInventory)}</div></div>`;
    html += `<div class="inventory-stat"><div class="inventory-stat-label">${t('totalDaysLeft')}</div><div class="inventory-stat-value">${totalDaysLeft != null ? fmt(totalDaysLeft) : t('never')}</div></div>`;
    html += `</div>`;
    html += `<div style="overflow-x:auto"><table class="inv-table"><thead><tr>`;
    html += `<th>${t('strain')}</th><th>${t('sacks')}</th><th>${t('daysSupply')}</th><th>${t('projYield')}</th><th>${t('depletes')}</th>`;
    html += `</tr></thead><tbody>`;

    variants.forEach(v => {
      const name = v.title || 'Unknown';
      const p = projectVariant(name, v.quantity || 0, totals);
      // An empty variant (most 2nd Cut rows) has nothing to deplete.
      const empty = p.quantity <= 0;
      const daysLeft = empty ? null : p.daysLeft;
      const daysStr = empty ? '--' : daysLeft == null ? t('never') : daysLeft < 1 ? '<1' : fmt(Math.round(daysLeft));
      const projTops = p.topsLbs != null ? fmt(p.topsLbs) : '--';
      const projSmalls = p.smallsLbs != null ? fmt(p.smallsLbs) : '--';
      const thinBadge = (!empty && p.daysLeft == null && p.sample > 0)
        ? `<span class="thin-sample-badge" title="${esc(t('thinTitle', { n: p.sample }))}">⚠ thin</span>`
        : '';

      let depleteStr = empty ? '--' : t('never');
      if (daysLeft != null && daysLeft < 9999) {
        const d = new Date();
        d.setDate(d.getDate() + Math.ceil(daysLeft));
        depleteStr = d.toLocaleDateString('en-CA');
      }

      const barPct = daysLeft != null ? Math.min(100, (daysLeft / 60) * 100) : 0;
      const barColor = daysLeft != null ? (daysLeft < 7 ? 'var(--red)' : daysLeft < 21 ? 'var(--gold)' : 'var(--green)') : 'var(--text-faint)';

      html += `<tr>`;
      html += `<td style="font-family:var(--font-ui);font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(name)}">${esc(name)}</td>`;
      html += `<td>${fmt(p.quantity)}</td>`;
      html += `<td>${daysStr}${thinBadge}<div class="depletion-bar-bg"><div class="depletion-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div></td>`;
      html += `<td style="font-size:11px"><span style="color:var(--green)">${projTops}t</span> / <span style="color:var(--gold)">${projSmalls}s</span></td>`;
      html += `<td style="font-size:11px">${depleteStr}</td>`;
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    card.innerHTML = html;
  }

  // -- Cost Card Rendering --
  function renderCostCard() {
    const card = document.getElementById('cost-card');
    const data = state.costData;

    if (data && data.locked) {
      card.innerHTML = `<div class="card-title">${t('laborMetrics')}</div><div class="loading-msg">🔒 ${t('costsLocked')}</div>`;
      return;
    }
    if (!data || (!data.totalTops && !data.totalSmalls)) {
      card.innerHTML = `<div class="card-title">${t('laborMetrics')}</div><div class="loading-msg">${t('noData')}</div>`;
      return;
    }

    const topsHr = data.totalHours > 0 ? (data.totalTops / data.totalHours) : 0;
    const smallsHr = data.totalHours > 0 ? (data.totalSmalls / data.totalHours) : 0;
    const topsTrimmer = data.avgTrimmers > 0 ? (data.totalTops / data.avgTrimmers / data.daysWorked) : 0;
    const smallsTrimmer = data.avgTrimmers > 0 ? (data.totalSmalls / data.avgTrimmers / data.daysWorked) : 0;
    const costLb = data.totalTops > 0 ? (data.totalTopsLaborCost / data.totalTops) : 0;

    let html = `<div class="card-title">${t('laborMetrics')}</div>`;
    html += `<div class="cost-grid">`;
    html += `<div class="cost-item"><div class="cost-label">${t('topsHr')}</div><div class="cost-value" style="color:var(--green)">${fmt(topsHr, 1)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('smallsHr')}</div><div class="cost-value" style="color:var(--gold)">${fmt(smallsHr, 1)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('topsTrimmer')}</div><div class="cost-value" style="color:var(--green)">${fmt(topsTrimmer, 1)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('smallsTrimmer')}</div><div class="cost-value" style="color:var(--gold)">${fmt(smallsTrimmer, 1)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('costLb')}</div><div class="cost-value" style="color:var(--red)">$${fmt(costLb, 2)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('topsLabor')}</div><div class="cost-value" style="color:var(--green)">$${fmt(data.totalTopsLaborCost)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('smallsLabor')}</div><div class="cost-value" style="color:var(--gold)">$${fmt(data.totalSmallsLaborCost)}</div></div>`;
    html += `<div class="cost-item"><div class="cost-label">${t('totalLabor')}</div><div class="cost-value" style="color:var(--blue)">$${fmt(data.totalLabor)}</div></div>`;
    html += `</div>`;

    card.innerHTML = html;
  }

  // -- Init --
  applyLang();
  setPreset('month');

})();
