/**
 * ScoreboardChart.js
 * Chart.js wrapper for hourly performance chart
 * Dependencies: Chart.js, ScoreboardState
 */
(function(window) {
  'use strict';

  var ScoreboardChart = {
    /**
     * Render or update the hourly performance chart
     * @param {Array} hourlyRates - Array of {timeSlot, rate, target} objects
     * @param {Number} targetRate - Overall target rate (for reference)
     */
    renderHourlyChart: function(hourlyRates, targetRate) {
      const container = document.getElementById('chartContainer');
      if (!hourlyRates || hourlyRates.length === 0) {
        container.style.display = 'none';
        return;
      }
      container.style.display = 'block';

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
