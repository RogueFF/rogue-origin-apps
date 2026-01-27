/**
 * Charts Module
 * Chart.js initialization and rendering for dashboard charts
 */

import { brandColors } from './config.js';
import { getChart, setChart, getData, getDailyTarget, getCompareMode, getCompareData, setFlag, getFlags } from './state.js';
import { safeGetChartContext } from './utils.js';
import { loadChartJs } from './lazy-loader.js';

// Register ChartDataLabels plugin (called once during initialization)
function registerPlugins() {
  if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
  }
}

/**
 * Get chart colors based on current theme
 * @returns {Object} Theme-aware color configuration
 */
export function getChartColors() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  return {
    grid: theme === 'dark' ? 'rgba(168, 181, 169, 0.08)' : 'rgba(102, 137, 113, 0.06)',
    text: theme === 'dark' ? '#a8b5a9' : '#5a6b5f',
    labelBg: theme === 'dark' ? '#252b22' : '#fff',
    // Botanical color gradients
    greenGradient: ['#668971', '#8ba896'],
    goldGradient: ['#e4aa4f', '#f0cb60']
  };
}

/**
 * Destroy a chart instance if it exists
 * @param {Chart} chart - Chart.js instance
 * @returns {null} Always returns null for reassignment
 */
export function destroyChartIfExists(chart) {
  if (chart && typeof chart.destroy === 'function') {
    chart.destroy();
  }
  return null;
}

/**
 * Create botanical grid configuration (hemp fiber dashed lines)
 * @returns {Object} Grid configuration object
 */
function createBotanicalGrid() {
  return {
    color: function() { return getChartColors().grid; },
    borderDash: [3, 3],
    lineWidth: 1,
    drawBorder: false,
    drawTicks: false
  };
}

/**
 * Create botanical scale configuration
 * @returns {Object} Scale configuration object
 */
function createBotanicalScale() {
  const botanicalGrid = createBotanicalGrid();
  return {
    grid: botanicalGrid,
    ticks: {
      font: { size: 11, family: 'JetBrains Mono, monospace' },
      color: function() { return getChartColors().text; },
      padding: 8
    }
  };
}

/**
 * Create common legend configuration
 * @returns {Object} Legend configuration object
 */
function createLegendConfig() {
  return {
    display: true,
    position: 'top',
    align: 'end',
    labels: {
      boxWidth: 12,
      boxHeight: 12,
      padding: 12,
      font: { size: 12, weight: '500' },
      usePointStyle: true,
      pointStyle: 'circle'
    }
  };
}

/**
 * Create common datalabels config for bar charts
 * @returns {Object} DataLabels configuration object
 */
function createBarDataLabels() {
  return {
    display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; },
    color: '#fff',
    font: { weight: 'bold', size: 11 },
    anchor: 'center',
    align: 'center',
    formatter: function(value) { return value > 0 ? value.toFixed(1) : ''; }
  };
}

/**
 * Initialize all chart instances
 * Creates empty charts ready for data
 * Lazy loads Chart.js library if not already loaded
 */
export async function initCharts() {
  // Lazy load Chart.js library
  await loadChartJs();

  // Destroy any existing charts first to prevent memory leaks
  destroyChartIfExists(getChart('hourly'));
  destroyChartIfExists(getChart('rate'));
  destroyChartIfExists(getChart('daily'));
  destroyChartIfExists(getChart('dailyRate'));
  destroyChartIfExists(getChart('trimmers'));

  // Register datalabels plugin
  registerPlugins();

  // Get common configurations
  const botanicalScale = createBotanicalScale();
  const legendConfig = createLegendConfig();
  const barDataLabels = createBarDataLabels();
  const dailyTarget = getDailyTarget();

  // Hourly Chart (bar) - hourly tops/smalls breakdown
  const hourlyCtx = safeGetChartContext('hourlyChart');
  if (hourlyCtx) {
    const hourlyChart = new Chart(hourlyCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Tops',
            data: [],
            backgroundColor: brandColors.green,
            borderRadius: 4,
            borderWidth: 0
          },
          {
            label: 'Smalls',
            data: [],
            backgroundColor: brandColors.sungrown,
            borderRadius: 4,
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: legendConfig,
          datalabels: barDataLabels
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: botanicalScale.ticks
          },
          y: Object.assign({ beginAtZero: true }, botanicalScale)
        }
      }
    });
    setChart('hourly', hourlyChart);
  }

  // Rate Chart (line) - rate over time with fill
  const rateCtx = safeGetChartContext('rateChart');
  if (rateCtx) {
    const rateChart = new Chart(rateCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Rate',
            data: [],
            borderColor: brandColors.green,
            backgroundColor: brandColors.greenLight,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: brandColors.green,
            pointBorderColor: '#fff',
            pointBorderWidth: 2
          },
          {
            label: 'Prev',
            data: [],
            borderColor: brandColors.indoor,
            borderDash: [5, 5],
            backgroundColor: 'transparent',
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            hidden: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: false }
        },
        scales: {
          y: Object.assign({ beginAtZero: true }, botanicalScale),
          x: {
            grid: { display: false },
            ticks: botanicalScale.ticks
          }
        }
      }
    });
    setChart('rate', rateChart);
  }

  // Daily Chart (bar) - daily production with target line
  const dailyCtx = safeGetChartContext('dailyChart');
  if (dailyCtx) {
    const dailyChart = new Chart(dailyCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Tops',
            data: [],
            backgroundColor: brandColors.green,
            borderRadius: 4,
            borderWidth: 0
          },
          {
            label: 'Smalls',
            data: [],
            backgroundColor: brandColors.sungrown,
            borderRadius: 4,
            borderWidth: 0
          },
          {
            label: `Target (${dailyTarget} lbs)`,
            data: [],
            borderColor: '#c45c4a',
            borderDash: [8, 4],
            borderWidth: 2,
            type: 'line',
            fill: false,
            pointRadius: 0,
            order: 0,
            tension: 0.4,
            datalabels: { display: false }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: legendConfig,
          datalabels: barDataLabels
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: botanicalScale.ticks
          },
          y: Object.assign({ beginAtZero: true }, botanicalScale)
        }
      }
    });
    setChart('daily', dailyChart);
  }

  // Daily Rate Chart (line) - daily rate trend
  const dailyRateCtx = safeGetChartContext('dailyRateChart');
  if (dailyRateCtx) {
    const dailyRateChart = new Chart(dailyRateCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Rate',
            data: [],
            borderColor: brandColors.green,
            backgroundColor: brandColors.greenLight,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: brandColors.green,
            pointBorderColor: '#fff',
            pointBorderWidth: 2
          },
          {
            label: '7d MA',
            data: [],
            borderColor: brandColors.gold,
            borderDash: [5, 5],
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: brandColors.gold,
            pointBorderColor: '#fff',
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: legendConfig,
          datalabels: { display: false }
        },
        scales: {
          y: Object.assign({ beginAtZero: true }, botanicalScale),
          x: {
            grid: { display: false },
            ticks: botanicalScale.ticks
          }
        }
      }
    });
    setChart('dailyRate', dailyRateChart);
  }

  // Trimmers Chart (bar with line) - trimmers on line
  const trimmersCtx = safeGetChartContext('trimmersChart');
  if (trimmersCtx) {
    const trimmersChart = new Chart(trimmersCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Trimmers',
            data: [],
            backgroundColor: brandColors.green,
            borderRadius: 4,
            borderWidth: 0,
            order: 2
          },
          {
            label: 'Average',
            data: [],
            borderColor: brandColors.gold,
            borderDash: [6, 4],
            borderWidth: 2,
            type: 'line',
            fill: false,
            pointRadius: 0,
            order: 1,
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: legendConfig,
          datalabels: {
            display: function(ctx) {
              return ctx.datasetIndex === 0 && ctx.dataset.data[ctx.dataIndex] > 0;
            },
            color: '#fff',
            font: { weight: 'bold', size: 11 },
            anchor: 'center',
            align: 'center',
            formatter: function(value) { return value > 0 ? Math.round(value) : ''; }
          }
        },
        scales: {
          y: Object.assign({
            beginAtZero: true,
            title: {
              display: true,
              text: 'Trimmers',
              font: { size: 10, family: 'JetBrains Mono, monospace' }
            }
          }, botanicalScale),
          x: {
            grid: { display: false },
            ticks: botanicalScale.ticks
          }
        }
      }
    });
    setChart('trimmers', trimmersChart);
  }

  // Mark charts as initialized
  setFlag('chartsInitialized', true);
}

/**
 * Calculate moving average
 * @param {Array} arr - Array of numbers
 * @param {number} period - Period for moving average
 * @returns {Array} Moving average values
 */
function calcMA(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += arr[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Render efficiency chart (adapts based on date range)
 */
function renderEfficiencyChart() {
  const data = getData();
  const dailyRateChart = getChart('dailyRate');

  if (!data || !dailyRateChart) return;

  const numDays = data.daily ? data.daily.length : 0;
  const titleEl = document.getElementById('efficiencyChartTitle');
  const subtitleEl = document.getElementById('efficiencyChartSubtitle');

  if (numDays <= 1) {
    // SINGLE DAY: Show hourly efficiency
    if (titleEl) titleEl.textContent = 'Hourly Efficiency';
    if (subtitleEl) subtitleEl.textContent = 'lbs/trimmer by hour';

    if (!data.hourly || data.hourly.length === 0) {
      dailyRateChart.data.labels = [];
      dailyRateChart.data.datasets[0].data = [];
      dailyRateChart.data.datasets[1].data = [];
      dailyRateChart.update('none');
      return;
    }

    const labels = data.hourly.map(function(h) { return h.label; });
    const rates = data.hourly.map(function(h) { return h.rate || 0; });

    // Calculate average for reference line
    const validRates = rates.filter(function(r) { return r > 0; });
    const avgRate = validRates.length > 0
      ? validRates.reduce(function(a, b) { return a + b; }, 0) / validRates.length
      : 0;
    const avgLine = rates.map(function() { return avgRate; });

    dailyRateChart.data.labels = labels;
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = avgLine;
    dailyRateChart.data.datasets[1].label = `Avg (${avgRate.toFixed(2)})`;
    dailyRateChart.update('none');

  } else if (numDays < 7) {
    // 2-6 DAYS: Show daily efficiency without MA
    if (titleEl) titleEl.textContent = 'Daily Efficiency';
    if (subtitleEl) subtitleEl.textContent = 'lbs/trimmer by day';

    const rates = data.daily.map(function(d) { return d.avgRate; });

    // Calculate average for reference line
    const validRates = rates.filter(function(r) { return r > 0; });
    const avgRate = validRates.length > 0
      ? validRates.reduce(function(a, b) { return a + b; }, 0) / validRates.length
      : 0;
    const avgLine = rates.map(function() { return avgRate; });

    dailyRateChart.data.labels = data.daily.map(function(d) { return d.label; });
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = avgLine;
    dailyRateChart.data.datasets[1].label = `Avg (${avgRate.toFixed(2)})`;
    dailyRateChart.update('none');

  } else {
    // 7+ DAYS: Show daily efficiency with 7-day moving average
    if (titleEl) titleEl.textContent = 'Daily Efficiency';
    if (subtitleEl) subtitleEl.textContent = 'With 7-day MA';

    const rates = data.daily.map(function(d) { return d.avgRate; });

    dailyRateChart.data.labels = data.daily.map(function(d) { return d.label; });
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = calcMA(rates, 7);
    dailyRateChart.data.datasets[1].label = '7d MA';
    dailyRateChart.update('none');
  }
}

/**
 * Update all charts with current data
 */
export function renderCharts() {
  const data = getData();
  const flags = getFlags();

  // Guard against race condition: data may arrive before charts are initialized
  if (!data || !flags.chartsInitialized) return;

  const hourlyChart = getChart('hourly');
  const rateChart = getChart('rate');
  const dailyChart = getChart('daily');
  const dailyTarget = getDailyTarget();
  const compareMode = getCompareMode();
  const compareData = getCompareData();

  // Hourly Chart
  try {
    if (data.hourly && data.hourly.length > 0 && hourlyChart) {
      hourlyChart.data.labels = data.hourly.map(function(h) { return h.label; });
      hourlyChart.data.datasets[0].data = data.hourly.map(function(h) { return h.tops; });
      hourlyChart.data.datasets[1].data = data.hourly.map(function(h) { return h.smalls; });
      hourlyChart.update();
    }
  } catch (e) {
    console.error('Hourly chart error:', e);
  }

  // Rate Chart
  try {
    if (data.hourly && data.hourly.length > 0 && rateChart) {
      rateChart.data.labels = data.hourly.map(function(h) { return h.label; });
      rateChart.data.datasets[0].data = data.hourly.map(function(h) { return h.rate; });
      if (compareMode && compareData && compareData.hourly) {
        rateChart.data.datasets[1].data = compareData.hourly.map(function(h) { return h.rate; });
        rateChart.data.datasets[1].hidden = false;
      } else {
        rateChart.data.datasets[1].hidden = true;
      }
      rateChart.update('none');
    }
  } catch (e) {
    console.error('Rate chart error:', e);
  }

  // Daily Chart
  try {
    if (data.daily && data.daily.length > 0 && dailyChart) {
      dailyChart.data.labels = data.daily.map(function(d) { return d.label; });
      dailyChart.data.datasets[0].data = data.daily.map(function(d) { return d.totalTops; });
      dailyChart.data.datasets[1].data = data.daily.map(function(d) { return d.totalSmalls; });
      // Daily target line
      if (dailyChart.data.datasets[2]) {
        dailyChart.data.datasets[2].data = data.daily.map(function() { return dailyTarget; });
        dailyChart.data.datasets[2].label = `Target (${dailyTarget} lbs)`;
      }
      dailyChart.update('none');
    }
  } catch (e) {
    console.error('Daily chart error:', e);
  }

  // Efficiency Chart (daily rate)
  try {
    renderEfficiencyChart();
  } catch (e) {
    console.error('Efficiency chart error:', e);
  }
}

/**
 * Render trimmers on line chart
 * Adapts between hourly (single day) and daily (multi-day) views
 */
export function renderTrimmersChart() {
  const data = getData();
  const trimmersChart = getChart('trimmers');

  // Guard against race condition
  if (!data || !trimmersChart) return;

  let labels = [];
  let trimmerData = [];
  const isMultiDay = data.daily && data.daily.length > 1;
  const subtitleEl = document.getElementById('trimmersChartSubtitle');

  if (isMultiDay && data.daily && data.daily.length > 0) {
    // Multi-day view: show average trimmers per day
    if (subtitleEl) subtitleEl.textContent = 'By Day (Avg)';
    labels = data.daily.map(function(d) { return d.label; });
    trimmerData = data.daily.map(function(d) {
      // Use avgTrimmers if available, otherwise calculate
      return d.avgTrimmers || (d.hoursWorked > 0 ? d.trimmerHours / d.hoursWorked : 0);
    });
  } else if (data.hourly && data.hourly.length > 0) {
    // Single day view: show trimmers by hour
    if (subtitleEl) subtitleEl.textContent = 'By Hour';
    labels = data.hourly.map(function(h) { return h.label; });
    trimmerData = data.hourly.map(function(h) { return h.trimmers || 0; });
  } else {
    return;
  }

  // Calculate average for dotted line
  const validData = trimmerData.filter(function(t) { return t > 0; });
  const avg = validData.length > 0
    ? validData.reduce(function(a, b) { return a + b; }, 0) / validData.length
    : 0;
  const avgLine = trimmerData.map(function() { return avg; });

  trimmersChart.data.labels = labels;
  trimmersChart.data.datasets[0].data = trimmerData;
  trimmersChart.data.datasets[1].data = avgLine;
  trimmersChart.update('none');
}
