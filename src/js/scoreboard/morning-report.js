/**
 * Morning Report Module
 * Displays yesterday vs day before comparison for morning meetings
 *
 * @module MorningReport
 */
(function(window) {
  'use strict';

  var MorningReport = {
    /**
     * Whether morning report view is currently active
     */
    isActive: false,

    /**
     * Cached report data
     */
    data: null,

    /**
     * Chart.js instance for weekly comparison
     */
    weeklyChart: null,

    /**
     * Toggle morning report view
     */
    toggle: function() {
      if (this.isActive) {
        this.hide();
      } else {
        this.show();
      }
    },

    /**
     * Show morning report view
     */
    show: function() {
      this.isActive = true;
      document.body.classList.add('morning-report-active');

      var container = document.getElementById('morningReportContainer');
      if (container) {
        container.style.display = 'flex';
      }

      var mainPanel = document.querySelector('.main-panel');
      var timerPanel = document.getElementById('timerPanel');
      if (mainPanel) mainPanel.style.display = 'none';
      if (timerPanel) timerPanel.style.display = 'none';

      // Update button state
      var btn = document.getElementById('morningReportBtn');
      if (btn) btn.classList.add('active');

      this.loadData();
    },

    /**
     * Hide morning report view
     */
    hide: function() {
      this.isActive = false;
      document.body.classList.remove('morning-report-active');

      // Destroy chart instance
      if (this.weeklyChart) {
        this.weeklyChart.destroy();
        this.weeklyChart = null;
      }

      var container = document.getElementById('morningReportContainer');
      if (container) {
        container.style.display = 'none';
      }

      var mainPanel = document.querySelector('.main-panel');
      var timerPanel = document.getElementById('timerPanel');
      if (mainPanel) mainPanel.style.display = '';
      if (timerPanel) timerPanel.style.display = '';

      // Update button state
      var btn = document.getElementById('morningReportBtn');
      if (btn) btn.classList.remove('active');
    },

    /**
     * Load report data from API
     */
    loadData: function() {
      var self = this;
      var container = document.getElementById('morningReportContent');
      if (container) {
        container.innerHTML = '<div class="mr-loading">Loading report data...</div>';
      }

      // Update date subtitle
      var dateEl = document.getElementById('mrDate');
      if (dateEl) {
        var now = new Date();
        var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('en-US', options);
      }

      var apiUrl = window.ScoreboardAPI ? window.ScoreboardAPI.getApiUrl() : '';

      fetch(apiUrl + '?action=morningReport')
        .then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function(data) {
          self.data = data;
          self.render();
        })
        .catch(function(error) {
          console.error('Morning report error:', error);
          if (container) {
            container.innerHTML = '<div class="mr-error">Failed to load report data. Please try again.</div>';
          }
        });
    },

    /**
     * Render the report
     */
    render: function() {
      var self = this;
      var container = document.getElementById('morningReportContent');
      if (!container || !this.data) return;

      var d = this.data;
      var html = '';

      // Section 1: Yesterday vs Day Before
      html += this.renderDailyComparison(d.yesterday, d.dayBefore);

      // Section 2: Weekly comparison
      html += this.renderWeeklyComparison(d.thisWeek, d.lastWeek);

      // Section 3: Order progress
      html += this.renderOrderProgress(d.currentOrder);

      container.innerHTML = html;

      // Initialize chart after DOM is ready
      setTimeout(function() {
        self.renderWeeklyChart(d.thisWeek, d.lastWeek);
      }, 50);
    },

    /**
     * Render daily comparison section
     */
    renderDailyComparison: function(yesterday, dayBefore) {
      if (!yesterday) {
        return '<div class="mr-section"><div class="mr-no-data">No data for yesterday</div></div>';
      }

      var html = '<div class="mr-section">';
      html += '<div class="mr-section-header">YESTERDAY vs DAY BEFORE / AYER vs ANTEAYER</div>';

      // Crew summary line (shows crew context once, not on every card)
      var crewSummary = 'Yesterday / Ayer: ' + (yesterday.crew || 0) + ' crew';
      if (dayBefore && dayBefore.crew) {
        crewSummary += ' \u2022 Day Before / Anteayer: ' + dayBefore.crew + ' crew';
      }
      html += '<div class="mr-crew-summary">' + crewSummary + '</div>';

      html += '<div class="mr-cards">';

      // Tops card
      html += this.renderMetricCard(
        'Tops / Puntas',
        yesterday.tops,
        dayBefore ? dayBefore.tops : null,
        'lbs',
        'higher'
      );

      // Smalls card
      html += this.renderMetricCard(
        'Smalls / Peque\u00f1os',
        yesterday.smalls,
        dayBefore ? dayBefore.smalls : null,
        'lbs',
        'higher'
      );

      // Bags card
      html += this.renderMetricCard(
        'Bags / Bolsas',
        yesterday.bags,
        dayBefore ? dayBefore.bags : null,
        '',
        'higher'
      );

      // Rate card (already normalized per trimmer)
      html += this.renderMetricCard(
        'Rate / Ritmo',
        yesterday.rate,
        dayBefore ? dayBefore.rate : null,
        'lbs/hr',
        'higher'
      );

      // Best Hour card (special)
      html += this.renderBestHourCard(yesterday.bestHour);

      // Cycle Time card
      html += this.renderMetricCard(
        'Cycle Time / Tiempo de Ciclo',
        yesterday.avgCycleTime,
        dayBefore ? dayBefore.avgCycleTime : null,
        'min',
        'lower'
      );

      html += '</div></div>';
      return html;
    },

    /**
     * Render a single metric card
     * @param {object} opts - Optional: { crewYesterday, crewDayBefore } for crew context
     */
    renderMetricCard: function(label, value, compareValue, unit, betterWhen, opts) {
      opts = opts || {};
      var diff = compareValue !== null ? value - compareValue : 0;
      var pctChange = compareValue && compareValue !== 0 ? Math.abs(diff / compareValue * 100) : 0;

      var status = 'neutral';
      if (betterWhen !== 'neutral' && compareValue !== null) {
        if (betterWhen === 'higher') {
          if (diff > 0 && pctChange > 5) status = 'green';
          else if (diff < 0 && pctChange > 5) status = 'red';
          else status = 'yellow';
        } else if (betterWhen === 'lower') {
          if (diff < 0 && pctChange > 5) status = 'green';
          else if (diff > 0 && pctChange > 5) status = 'red';
          else status = 'yellow';
        }
      }

      // Only show arrow if the rounded diff is meaningful (not 0 after rounding)
      var roundedDiff = Math.round(diff * 10) / 10;
      var arrow = roundedDiff > 0 ? '<span class="mr-arrow up">\u25B2</span>' : (roundedDiff < 0 ? '<span class="mr-arrow down">\u25BC</span>' : '');
      var diffDisplay = roundedDiff !== 0 ? (roundedDiff > 0 ? '+' : '') + this.formatNumber(diff) : '';

      // Crew context strings
      var crewYesterday = opts.crewYesterday ? '<span class="mr-crew-context">(' + opts.crewYesterday + ' crew)</span>' : '';
      var crewDayBefore = opts.crewDayBefore ? '<span class="mr-crew-context">(' + opts.crewDayBefore + ' crew)</span>' : '';

      var html = '<div class="mr-card mr-' + status + '">';
      html += '<div class="mr-card-header">' + label + ' <span class="mr-status-dot"></span></div>';
      html += '<div class="mr-card-values">';
      html += '<div class="mr-value-col"><div class="mr-value-label">Yesterday / Ayer</div><div class="mr-value">' + this.formatNumber(value) + ' ' + unit + '</div>' + crewYesterday + '</div>';
      if (compareValue !== null) {
        html += '<div class="mr-value-col"><div class="mr-value-label">Day Before / Anteayer</div><div class="mr-value">' + this.formatNumber(compareValue) + ' ' + unit + '</div>' + crewDayBefore + '</div>';
      }
      html += '</div>';
      if (roundedDiff !== 0 && betterWhen !== 'neutral') {
        html += '<div class="mr-diff">' + arrow + diffDisplay + ' ' + unit + '</div>';
      }
      html += '</div>';
      return html;
    },

    /**
     * Render best hour card
     */
    renderBestHourCard: function(bestHour) {
      var html = '<div class="mr-card mr-best-hour">';
      html += '<div class="mr-card-header"><span class="mr-trophy"></span> BEST HOUR / MEJOR HORA</div>';
      if (bestHour) {
        html += '<div class="mr-best-time">' + bestHour.time + '</div>';
        html += '<div class="mr-best-lbs">' + bestHour.lbs + ' lbs</div>';
        html += '<div class="mr-best-msg">Keep it up! / \u00a1Sigan as\u00ed!</div>';
      } else {
        html += '<div class="mr-best-time">--</div>';
      }
      html += '</div>';
      return html;
    },

    /**
     * Render weekly comparison section with rate-based metrics
     */
    renderWeeklyComparison: function(thisWeek, lastWeek) {
      if (!thisWeek || !lastWeek) {
        return '<div class="mr-section"><div class="mr-no-data">No weekly data available</div></div>';
      }

      // Rate comparison (main metric - normalizes for crew size)
      var rateDiff = (thisWeek.avgRate || 0) - (lastWeek.avgRate || 0);
      var ratePctChange = lastWeek.avgRate > 0 ? (rateDiff / lastWeek.avgRate * 100) : 0;
      var rateStatus = rateDiff > 0.05 ? 'green' : (rateDiff < -0.05 ? 'red' : 'yellow');

      var html = '<div class="mr-section mr-weekly">';
      html += '<div class="mr-section-header">PRODUCTIVITY / PRODUCTIVIDAD</div>';

      // Main rate comparison card
      html += '<div class="mr-rate-comparison">';

      // This week rate
      html += '<div class="mr-rate-card mr-rate-this">';
      html += '<div class="mr-rate-label">This Week / Esta Semana</div>';
      html += '<div class="mr-rate-value">' + this.formatNumber(thisWeek.avgRate) + '</div>';
      html += '<div class="mr-rate-unit">lbs/trimmer/hr</div>';
      html += '<div class="mr-rate-context">' + (thisWeek.days || []).join(', ') + ' \u2022 ~' + this.formatNumber(thisWeek.avgCrew) + ' crew avg</div>';
      html += '</div>';

      // vs indicator
      var rateArrow = rateDiff > 0 ? '\u25B2' : (rateDiff < 0 ? '\u25BC' : '');
      html += '<div class="mr-rate-vs mr-' + rateStatus + '">';
      html += '<div class="mr-rate-diff">' + rateArrow + ' ' + (rateDiff >= 0 ? '+' : '') + this.formatNumber(rateDiff) + '</div>';
      html += '<div class="mr-rate-pct">' + (ratePctChange >= 0 ? '+' : '') + Math.round(ratePctChange) + '%</div>';
      html += '</div>';

      // Last week rate
      html += '<div class="mr-rate-card mr-rate-last">';
      html += '<div class="mr-rate-label">Last Week / Semana Pasada</div>';
      html += '<div class="mr-rate-value">' + this.formatNumber(lastWeek.avgRate) + '</div>';
      html += '<div class="mr-rate-unit">lbs/trimmer/hr</div>';
      html += '<div class="mr-rate-context">Full week \u2022 ~' + this.formatNumber(lastWeek.avgCrew) + ' crew avg</div>';
      html += '</div>';

      html += '</div>';

      // Chart container - now shows totals with context
      html += '<div class="mr-chart-container">';
      html += '<canvas id="weeklyComparisonChart"></canvas>';
      html += '</div>';

      // Legend with crew context
      html += '<div class="mr-weekly-legend">';
      html += '<div class="mr-legend-item">';
      html += '<span class="mr-legend-color mr-legend-this"></span>';
      html += '<span>This Week: ' + this.formatNumber(thisWeek.tops + thisWeek.smalls) + ' lbs (' + (thisWeek.daysCount || 0) + ' days, ~' + this.formatNumber(thisWeek.avgCrew) + ' crew)</span>';
      html += '</div>';
      html += '<div class="mr-legend-item">';
      html += '<span class="mr-legend-color mr-legend-last"></span>';
      html += '<span>Last Week: ' + this.formatNumber(lastWeek.tops + lastWeek.smalls) + ' lbs (' + (lastWeek.daysCount || 0) + ' days, ~' + this.formatNumber(lastWeek.avgCrew) + ' crew)</span>';
      html += '</div>';
      html += '</div>';

      html += '</div>';
      return html;
    },

    /**
     * Render the weekly comparison bar chart
     */
    renderWeeklyChart: function(thisWeek, lastWeek) {
      if (!thisWeek || !lastWeek) return;

      var canvas = document.getElementById('weeklyComparisonChart');
      if (!canvas) return;

      // Destroy existing chart
      if (this.weeklyChart) {
        this.weeklyChart.destroy();
      }

      var ctx = canvas.getContext('2d');

      this.weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Tops / Puntas', 'Smalls / Peque\u00f1os', 'Total'],
          datasets: [
            {
              label: 'This Week / Esta Semana',
              data: [thisWeek.tops, thisWeek.smalls, thisWeek.tops + thisWeek.smalls],
              backgroundColor: '#668971',
              borderColor: '#4a6b54',
              borderWidth: 2,
              borderRadius: 6,
              barPercentage: 0.8,
              categoryPercentage: 0.7
            },
            {
              label: 'Last Week / Semana Pasada',
              data: [lastWeek.tops, lastWeek.smalls, lastWeek.tops + lastWeek.smalls],
              backgroundColor: 'rgba(102, 137, 113, 0.4)',
              borderColor: '#668971',
              borderWidth: 2,
              borderRadius: 6,
              barPercentage: 0.8,
              categoryPercentage: 0.7
            }
          ]
        },
        plugins: [ChartDataLabels],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: '#2d2d2d',
              titleColor: '#fff',
              bodyColor: '#fff',
              titleFont: { size: 16, weight: 'bold' },
              bodyFont: { size: 14 },
              padding: 12,
              cornerRadius: 8,
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + ' lbs';
                }
              }
            },
            datalabels: {
              color: '#fff',
              anchor: 'center',
              align: 'center',
              font: {
                family: "'JetBrains Mono', monospace",
                size: 18,
                weight: 'bold'
              },
              formatter: function(value) {
                return Math.round(value) + ' lbs';
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: '#fff',
                font: { size: 18, weight: 'bold' }
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(255, 255, 255, 0.1)'
              },
              ticks: {
                color: '#fff',
                font: { size: 16 },
                callback: function(value) {
                  return value + ' lbs';
                }
              }
            }
          }
        }
      });
    },

    /**
     * Render order progress section
     */
    renderOrderProgress: function(order) {
      if (!order) {
        return '<div class="mr-section"><div class="mr-no-data">No active order</div></div>';
      }

      var pct = order.targetKg > 0 ? Math.round(order.completedKg / order.targetKg * 100) : 0;
      var remaining = order.targetKg - order.completedKg;

      var html = '<div class="mr-section mr-order">';
      html += '<div class="mr-section-header">CURRENT ORDER / PEDIDO ACTUAL: ' + order.id + ' \u2014 ' + order.strain + ' (' + order.customer + ')</div>';

      html += '<div class="mr-order-bar-container">';
      html += '<div class="mr-order-bar"><div class="mr-order-fill" style="width:' + pct + '%"></div></div>';
      html += '<div class="mr-order-text">' + order.completedKg + ' / ' + order.targetKg + ' kg</div>';
      html += '</div>';

      html += '<div class="mr-order-pct">' + pct + '% complete</div>';

      html += '<div class="mr-order-remaining">';
      html += remaining + ' kg remaining \u2022 ~' + order.estimatedDaysRemaining + ' days at current rate<br>';
      html += 'Faltan ' + remaining + ' kg \u2022 ~' + order.estimatedDaysRemaining + ' d\u00edas al ritmo actual';
      html += '</div>';

      html += '</div>';
      return html;
    },

    /**
     * Format number for display
     */
    formatNumber: function(num) {
      if (num === null || num === undefined) return '--';
      return Math.round(num * 10) / 10;
    }
  };

  // Expose to global scope
  window.MorningReport = MorningReport;

  // Global toggle function for button onclick
  window.toggleMorningReport = function() {
    MorningReport.toggle();
  };

})(window);
