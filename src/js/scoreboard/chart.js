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

      // Shorten time slot labels: "9:00 AM – 10:00 AM" -> "9-10"
      const labels = hourlyRates.map(h => {
        const match = h.timeSlot.match(/(\d+):\d+\s*(AM|PM)\s*[–-]\s*(\d+):\d+/i);
        if (match) {
          let start = parseInt(match[1]);
          let end = parseInt(match[3]);
          return `${start}-${end}`;
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
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y + ' lbs/hr';
                }
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
