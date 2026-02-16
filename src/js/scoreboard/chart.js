/**
 * ScoreboardChart.js
 * Chart.js wrapper for hourly performance chart
 * Dependencies: Chart.js (lazy loaded), ScoreboardState
 */
(function(window) {
  'use strict';

  // Lazy load Chart.js
  async function loadChartJs() {
    if (typeof Chart !== 'undefined') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script1 = document.createElement('script');
      script1.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script1.async = true;
      script1.onload = () => {
        const script2 = document.createElement('script');
        script2.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2';
        script2.async = true;
        script2.onload = () => {
          console.log('✅ Chart.js loaded lazily for scoreboard');
          resolve();
        };
        script2.onerror = () => reject(new Error('Failed to load ChartDataLabels'));
        document.head.appendChild(script2);
      };
      script1.onerror = () => reject(new Error('Failed to load Chart.js'));
      document.head.appendChild(script1);
    });
  }

  var ScoreboardChart = {
    /**
     * Render or update the hourly performance chart
     * @param {Array} hourlyRates - Array of {timeSlot, rate, target} objects
     * @param {Number} targetRate - Overall target rate (for reference)
     */
    renderHourlyChart: async function(hourlyRates, targetRate) {
      const container = document.getElementById('chartContainer');
      if (!hourlyRates || hourlyRates.length === 0) {
        container.style.display = 'none';
        return;
      }
      // Show chart by default (user can hide via toggle)
      var chartHidden = localStorage.getItem('chartVisible') === 'false';
      container.style.display = chartHidden ? 'none' : 'block';
      if (chartHidden) return;

      // Lazy load Chart.js if needed
      await loadChartJs();

      // Sort hourly rates chronologically by start time
      function timeSlotTo24h(timeSlot) {
        var match = timeSlot.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return 0;
        var h = parseInt(match[1]);
        var m = parseInt(match[2]);
        var ampm = match[3].toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      }
      hourlyRates = hourlyRates.slice().sort(function(a, b) {
        return timeSlotTo24h(a.timeSlot) - timeSlotTo24h(b.timeSlot);
      });

      // Show actual start time: "7:48 AM – 8:00 AM" -> "7:48a"
      const labels = hourlyRates.map(h => {
        const match = h.timeSlot.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          var hr = parseInt(match[1]);
          var min = match[2];
          var suffix = match[3].toLowerCase().charAt(0);
          // Only show minutes if not :00
          if (min === '00') return hr + suffix;
          return hr + ':' + min + suffix;
        }
        return h.timeSlot;
      });

      const rates = hourlyRates.map(h => parseFloat(h.rate.toFixed(2)));
      const targets = hourlyRates.map(h => parseFloat(h.target.toFixed(2)));

      // Color bars based on performance - using brand colors
      const barColors = hourlyRates.map(h => {
        const pct = (h.rate / h.target) * 100;
        if (pct >= 105) return '#668971';  // Brand green
        if (pct >= 90) return '#e4aa4f';   // Brand gold
        return '#f87171';                   // Red
      });

      // If chart exists, update data instead of recreating
      if (window.ScoreboardState && window.ScoreboardState.hourlyChart) {
        const chart = window.ScoreboardState.hourlyChart;
        chart.data.labels = labels;
        chart.data.datasets[0].data = rates;
        chart.data.datasets[0].backgroundColor = barColors;
        chart.data.datasets[1].data = targets;
        chart.update('none');
        return;
      }

      const ctx = document.getElementById('hourlyChart').getContext('2d');

      // Register datalabels plugin
      if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
      }

      const newChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Actual',
              data: rates,
              backgroundColor: barColors,
              borderRadius: 4,
              barThickness: 32
            },
            {
              label: 'Target',
              data: targets,
              type: 'line',
              borderColor: 'rgba(228,170,79,0.6)',
              borderWidth: 2,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          layout: {
            padding: { bottom: 10, top: 25 }
          },
          plugins: {
            legend: { display: false },
            datalabels: {
              display: function(context) {
                return context.datasetIndex === 0; // Only on bars, not target line
              },
              anchor: 'end',
              align: 'top',
              color: 'rgba(255,255,255,0.85)',
              font: { size: 11, weight: '600', family: 'JetBrains Mono, monospace' },
              formatter: function(value) {
                return value.toFixed(2);
              }
            },
            tooltip: {
              // Use external/custom tooltip for richer display
              enabled: true,
              displayColors: false,
              backgroundColor: 'rgba(20, 25, 24, 0.95)',
              borderColor: 'rgba(228,170,79,0.3)',
              borderWidth: 1,
              cornerRadius: 8,
              padding: 12,
              position: 'average',
              caretSize: 6,
              titleFont: { size: 13, weight: '600', family: 'JetBrains Mono, monospace' },
              titleColor: 'rgba(255,255,255,0.9)',
              bodyFont: { size: 12, family: 'JetBrains Mono, monospace' },
              bodyColor: 'rgba(255,255,255,0.75)',
              bodySpacing: 6,
              callbacks: {
                title: function(items) {
                  if (!items.length) return '';
                  var idx = items[0].dataIndex;
                  var h = hourlyRates[idx];
                  return h ? h.timeSlot : '';
                },
                label: function(context) {
                  // Only show tooltip for the bar dataset (skip target line)
                  if (context.datasetIndex !== 0) return null;
                  var idx = context.dataIndex;
                  var h = hourlyRates[idx];
                  if (!h) return context.parsed.y + ' lbs/hr';

                  var pct = h.target > 0 ? ((h.rate / h.target) * 100) : 0;
                  var pctStr = Math.round(pct) + '% of target';
                  var lines = [];
                  lines.push(h.lbs.toFixed(1) + ' lbs  →  ' + pctStr);
                  lines.push(h.rate.toFixed(2) + ' lbs/trimmer/hr');

                  // Crew line
                  var crew = h.trimmers + ' trimmer' + (h.trimmers !== 1 ? 's' : '');
                  if (h.buckers && h.buckers > 0) {
                    crew += ' · ' + h.buckers + ' bucker' + (h.buckers !== 1 ? 's' : '');
                  }
                  lines.push(crew);

                  // Break line — check if this hour had a break
                  if (h.multiplier && h.multiplier < 1) {
                    var breakMin = Math.round((1 - h.multiplier) * 60);
                    lines.push(breakMin + ' min break (' + Math.round(h.multiplier * 100) + '% hour)');
                  }

                  // Notes line — only if notes exist for this hour
                  if (h.notes) {
                    var noteText = h.notes.length > 40 ? h.notes.substring(0, 40) + '…' : h.notes;
                    lines.push('📝 ' + noteText);
                  }

                  return lines;
                },
                afterLabel: function() { return ''; }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: 'rgba(255,255,255,0.8)', font: { size: 11 } }
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.1)' },
              ticks: { color: 'rgba(255,255,255,0.8)', font: { size: 11 } },
              beginAtZero: true
            }
          }
        }
      });

      // Store chart instance in ScoreboardState
      if (window.ScoreboardState) {
        window.ScoreboardState.hourlyChart = newChart;
      }
    }
  };

  // Export to global scope
  window.ScoreboardChart = ScoreboardChart;

})(window);
