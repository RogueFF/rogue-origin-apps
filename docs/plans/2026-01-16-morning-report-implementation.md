# Morning Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Morning Report view to the scoreboard TV showing yesterday vs day before metrics, weekly comparisons, and order progress with traffic light color coding.

**Architecture:** New JS module (`morning-report.js`) handles data fetching and rendering. New backend endpoint (`getMorningReportData`) aggregates comparison data. View toggle via button in scoreboard header. Bilingual labels (EN/ES side-by-side).

**Tech Stack:** Vanilla JS (IIFE module pattern), CSS Grid, Google Apps Script backend, existing i18n pattern

---

## Task 1: Add Backend Endpoint

**Files:**
- Modify: `apps-script/production-tracking/Code.gs`

**Step 1: Add route handler in doGet**

Find the `doGet(e)` function and add the new action case:

```javascript
// Add after other action cases (around line 50-60)
case 'morningReport':
  return jsonResponse(getMorningReportData());
```

**Step 2: Create getMorningReportData function**

Add this function at the end of Code.gs (before the closing comment):

```javascript
/**
 * Get morning report data for scoreboard display
 * Compares yesterday vs day before, this week vs last week
 * @returns {Object} Report data structure
 */
function getMorningReportData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var now = new Date();

  // Get last 14 days of daily data (covers this week + last week)
  var dailyData = getExtendedDailyDataLine1_(ss, timezone, 14);

  // Sort by date descending
  dailyData.sort(function(a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  // Find yesterday and day before (skip today if present)
  var today = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  var filteredDays = dailyData.filter(function(d) {
    var dateStr = Utilities.formatDate(new Date(d.date), timezone, 'yyyy-MM-dd');
    return dateStr !== today;
  });

  var yesterday = filteredDays[0] || null;
  var dayBefore = filteredDays[1] || null;

  // Get cycle times for yesterday
  var yesterdayCycles = yesterday ? getCycleTimesForDate_(ss, timezone, yesterday.date) : null;
  var dayBeforeCycles = dayBefore ? getCycleTimesForDate_(ss, timezone, dayBefore.date) : null;

  // Get best hour for yesterday
  var yesterdayBestHour = yesterday ? getBestHourForDate_(ss, timezone, yesterday.date) : null;

  // Calculate weekly data
  var weekData = calculateWeeklyComparison_(dailyData, timezone);

  // Get current order progress
  var orderProgress = getCurrentOrderProgress_();

  return {
    success: true,
    generatedAt: now.toISOString(),

    yesterday: yesterday ? {
      date: Utilities.formatDate(new Date(yesterday.date), timezone, 'yyyy-MM-dd'),
      dateDisplay: Utilities.formatDate(new Date(yesterday.date), timezone, 'EEEE, MMM d'),
      tops: Math.round(yesterday.totalTops * 10) / 10,
      smalls: Math.round(yesterday.totalSmalls * 10) / 10,
      bags: yesterdayCycles ? yesterdayCycles.count : 0,
      rate: Math.round(yesterday.avgRate * 100) / 100,
      crew: yesterday.crew || 0,
      bestHour: yesterdayBestHour,
      avgCycleTime: yesterdayCycles ? yesterdayCycles.avgMinutes : 0
    } : null,

    dayBefore: dayBefore ? {
      date: Utilities.formatDate(new Date(dayBefore.date), timezone, 'yyyy-MM-dd'),
      dateDisplay: Utilities.formatDate(new Date(dayBefore.date), timezone, 'EEEE, MMM d'),
      tops: Math.round(dayBefore.totalTops * 10) / 10,
      smalls: Math.round(dayBefore.totalSmalls * 10) / 10,
      bags: dayBeforeCycles ? dayBeforeCycles.count : 0,
      rate: Math.round(dayBefore.avgRate * 100) / 100,
      crew: dayBefore.crew || 0,
      avgCycleTime: dayBeforeCycles ? dayBeforeCycles.avgMinutes : 0
    } : null,

    thisWeek: weekData.thisWeek,
    lastWeek: weekData.lastWeek,

    currentOrder: orderProgress
  };
}

/**
 * Get cycle times for a specific date
 */
function getCycleTimesForDate_(ss, timezone, targetDate) {
  var trackingSheet = ss.getSheetByName('Rogue Origin Production Tracking');
  if (!trackingSheet) return { count: 0, avgMinutes: 0 };

  var targetDateStr = Utilities.formatDate(new Date(targetDate), timezone, 'yyyy-MM-dd');
  var data = trackingSheet.getRange(2, 1, Math.min(trackingSheet.getLastRow() - 1, 2000), 10).getValues();

  var bags = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var timestamp = row[0];
    if (!timestamp) continue;

    var rowDate = new Date(timestamp);
    var rowDateStr = Utilities.formatDate(rowDate, timezone, 'yyyy-MM-dd');

    if (rowDateStr === targetDateStr) {
      var size = String(row[1] || '').toLowerCase();
      if (size.indexOf('5kg') >= 0 || size === '5kg') {
        bags.push(rowDate);
      }
    }
  }

  if (bags.length === 0) return { count: 0, avgMinutes: 0 };

  // Sort bags by time
  bags.sort(function(a, b) { return a - b; });

  // Calculate cycle times (time between consecutive bags)
  var cycleTimes = [];
  for (var j = 1; j < bags.length; j++) {
    var diffMs = bags[j] - bags[j-1];
    var diffMin = diffMs / 60000;
    // Only count reasonable cycles (5 min to 4 hours)
    if (diffMin >= 5 && diffMin <= 240) {
      cycleTimes.push(diffMin);
    }
  }

  var avgMinutes = cycleTimes.length > 0
    ? Math.round(cycleTimes.reduce(function(a, b) { return a + b; }, 0) / cycleTimes.length)
    : 0;

  return {
    count: bags.length,
    avgMinutes: avgMinutes
  };
}

/**
 * Get best production hour for a specific date
 */
function getBestHourForDate_(ss, timezone, targetDate) {
  var targetDateStr = Utilities.formatDate(new Date(targetDate), timezone, 'yyyy-MM-dd');
  var monthName = Utilities.formatDate(new Date(targetDate), timezone, 'yyyy-MM');

  var sheet = ss.getSheetByName(monthName);
  if (!sheet) return null;

  var vals = sheet.getDataRange().getValues();
  var inTargetDate = false;
  var cols = null;
  var bestHour = null;
  var bestLbs = 0;

  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];

    if (row[0] === 'Date:') {
      var dateVal = row[1];
      if (dateVal) {
        var rowDateStr = Utilities.formatDate(new Date(dateVal), timezone, 'yyyy-MM-dd');
        inTargetDate = (rowDateStr === targetDateStr);
      }
      var headerRow = vals[i + 1] || [];
      cols = getColumnIndices_(headerRow);
      continue;
    }

    if (!inTargetDate || !cols) continue;
    if (isEndOfBlock_(row)) {
      inTargetDate = false;
      continue;
    }

    var timeSlot = row[0];
    var tops = parseFloat(row[cols.tops1]) || 0;

    if (tops > bestLbs) {
      bestLbs = tops;
      bestHour = {
        time: String(timeSlot),
        lbs: Math.round(tops * 10) / 10
      };
    }
  }

  return bestHour;
}

/**
 * Calculate weekly comparison data
 */
function calculateWeeklyComparison_(dailyData, timezone) {
  var now = new Date();
  var dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...

  // Find start of this week (Monday)
  var thisWeekStart = new Date(now);
  var daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  thisWeekStart.setDate(thisWeekStart.getDate() - daysFromMonday);
  thisWeekStart.setHours(0, 0, 0, 0);

  // Find start of last week
  var lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  var lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);

  var thisWeek = { tops: 0, smalls: 0, bags: 0, totalRate: 0, daysCount: 0, days: [] };
  var lastWeek = { tops: 0, smalls: 0, bags: 0, totalRate: 0, daysCount: 0 };

  dailyData.forEach(function(d) {
    var date = new Date(d.date);
    date.setHours(0, 0, 0, 0);

    if (date >= thisWeekStart && date < now) {
      // This week (up to yesterday)
      thisWeek.tops += d.totalTops || 0;
      thisWeek.smalls += d.totalSmalls || 0;
      thisWeek.totalRate += d.avgRate || 0;
      thisWeek.daysCount++;

      var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      thisWeek.days.push(dayNames[date.getDay()]);
    } else if (date >= lastWeekStart && date <= lastWeekEnd) {
      // Last week (full week)
      lastWeek.tops += d.totalTops || 0;
      lastWeek.smalls += d.totalSmalls || 0;
      lastWeek.totalRate += d.avgRate || 0;
      lastWeek.daysCount++;
    }
  });

  return {
    thisWeek: {
      days: thisWeek.days,
      tops: Math.round(thisWeek.tops * 10) / 10,
      smalls: Math.round(thisWeek.smalls * 10) / 10,
      avgRate: thisWeek.daysCount > 0 ? Math.round((thisWeek.totalRate / thisWeek.daysCount) * 100) / 100 : 0
    },
    lastWeek: {
      tops: Math.round(lastWeek.tops * 10) / 10,
      smalls: Math.round(lastWeek.smalls * 10) / 10,
      avgRate: lastWeek.daysCount > 0 ? Math.round((lastWeek.totalRate / lastWeek.daysCount) * 100) / 100 : 0
    }
  };
}

/**
 * Get current order progress from wholesale orders sheet
 */
function getCurrentOrderProgress_() {
  try {
    var orderSheetId = '1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw';
    var orderSs = SpreadsheetApp.openById(orderSheetId);
    var ordersSheet = orderSs.getSheetByName('Orders');
    var shipmentsSheet = orderSs.getSheetByName('Shipments');

    if (!ordersSheet || !shipmentsSheet) return null;

    // Find current (in progress) order
    var ordersData = ordersSheet.getDataRange().getValues();
    var ordersHeaders = ordersData[0];
    var statusCol = ordersHeaders.indexOf('Status');
    var orderIdCol = ordersHeaders.indexOf('Order ID');
    var customerCol = ordersHeaders.indexOf('Customer');

    var currentOrder = null;
    for (var i = 1; i < ordersData.length; i++) {
      if (ordersData[i][statusCol] === 'In Progress') {
        currentOrder = {
          id: ordersData[i][orderIdCol],
          customer: ordersData[i][customerCol]
        };
        break;
      }
    }

    if (!currentOrder) return null;

    // Find shipments for this order
    var shipmentsData = shipmentsSheet.getDataRange().getValues();
    var shipHeaders = shipmentsData[0];
    var shipOrderCol = shipHeaders.indexOf('Order ID');
    var shipStrainCol = shipHeaders.indexOf('Strain');
    var shipQtyCol = shipHeaders.indexOf('Quantity (kg)');
    var shipFilledCol = shipHeaders.indexOf('Filled (kg)');

    var totalKg = 0;
    var filledKg = 0;
    var strain = '';

    for (var j = 1; j < shipmentsData.length; j++) {
      if (shipmentsData[j][shipOrderCol] === currentOrder.id) {
        totalKg += parseFloat(shipmentsData[j][shipQtyCol]) || 0;
        filledKg += parseFloat(shipmentsData[j][shipFilledCol]) || 0;
        if (!strain) strain = shipmentsData[j][shipStrainCol] || '';
      }
    }

    // Estimate days remaining based on recent production rate
    var recentRate = 25; // Default: ~25 kg/day
    var remaining = totalKg - filledKg;
    var daysRemaining = remaining > 0 ? Math.round((remaining / recentRate) * 10) / 10 : 0;

    return {
      id: currentOrder.id,
      strain: strain,
      customer: currentOrder.customer,
      targetKg: Math.round(totalKg),
      completedKg: Math.round(filledKg),
      estimatedDaysRemaining: daysRemaining
    };
  } catch (e) {
    Logger.log('getCurrentOrderProgress_ error: ' + e.message);
    return null;
  }
}
```

**Step 3: Test the endpoint**

Deploy to Apps Script and test:
```
GET ?action=morningReport
```

Expected: JSON with yesterday, dayBefore, thisWeek, lastWeek, currentOrder

**Step 4: Commit**

```bash
git add apps-script/production-tracking/Code.gs
git commit -m "feat(backend): add morning report API endpoint"
```

---

## Task 2: Create Morning Report JavaScript Module

**Files:**
- Create: `src/js/scoreboard/morning-report.js`

**Step 1: Create the module file**

```javascript
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
            container.innerHTML = '<div class="mr-error">Failed to load report data</div>';
          }
        });
    },

    /**
     * Render the report
     */
    render: function() {
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

      // Rate card
      html += this.renderMetricCard(
        'Rate / Ritmo',
        yesterday.rate,
        dayBefore ? dayBefore.rate : null,
        'lbs/hr',
        'higher'
      );

      // Crew card (neutral - no color)
      html += this.renderMetricCard(
        'Crew / Equipo',
        yesterday.crew,
        dayBefore ? dayBefore.crew : null,
        '',
        'neutral'
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
     */
    renderMetricCard: function(label, value, compareValue, unit, betterWhen) {
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

      var arrow = diff > 0 ? '\u2b06\ufe0f' : (diff < 0 ? '\u2b07\ufe0f' : '');
      var diffDisplay = diff !== 0 ? (diff > 0 ? '+' : '') + this.formatNumber(diff) : '';

      var html = '<div class="mr-card mr-' + status + '">';
      html += '<div class="mr-card-header">' + label + ' <span class="mr-status-dot"></span></div>';
      html += '<div class="mr-card-values">';
      html += '<div class="mr-value-col"><div class="mr-value-label">Yesterday / Ayer</div><div class="mr-value">' + this.formatNumber(value) + ' ' + unit + '</div></div>';
      if (compareValue !== null) {
        html += '<div class="mr-value-col"><div class="mr-value-label">Day Before / Anteayer</div><div class="mr-value">' + this.formatNumber(compareValue) + ' ' + unit + '</div></div>';
      }
      html += '</div>';
      if (diff !== 0 && betterWhen !== 'neutral') {
        html += '<div class="mr-diff">' + arrow + ' ' + diffDisplay + ' ' + unit + '</div>';
      }
      html += '</div>';
      return html;
    },

    /**
     * Render best hour card
     */
    renderBestHourCard: function(bestHour) {
      var html = '<div class="mr-card mr-best-hour">';
      html += '<div class="mr-card-header">\ud83c\udfc6 BEST HOUR / MEJOR HORA <span class="mr-fire">\ud83d\udd25</span></div>';
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
     * Render weekly comparison section
     */
    renderWeeklyComparison: function(thisWeek, lastWeek) {
      if (!thisWeek || !lastWeek) {
        return '<div class="mr-section"><div class="mr-no-data">No weekly data available</div></div>';
      }

      var topsDiff = thisWeek.tops - lastWeek.tops;
      var smallsDiff = thisWeek.smalls - lastWeek.smalls;
      var totalThis = thisWeek.tops + thisWeek.smalls;
      var totalLast = lastWeek.tops + lastWeek.smalls;
      var totalDiff = totalThis - totalLast;
      var totalStatus = totalDiff > 0 ? 'green' : (totalDiff < 0 ? 'red' : 'yellow');

      var html = '<div class="mr-section mr-weekly">';
      html += '<div class="mr-section-header">THIS WEEK vs LAST WEEK / ESTA SEMANA vs SEMANA PASADA</div>';

      html += '<div class="mr-weekly-grid">';
      html += '<div class="mr-weekly-col">';
      html += '<div class="mr-weekly-label">This Week So Far / Esta Semana<br><span class="mr-days">(' + (thisWeek.days || []).join(', ') + ')</span></div>';
      html += '</div>';
      html += '<div class="mr-weekly-col">';
      html += '<div class="mr-weekly-label">Last Week / Semana Pasada<br><span class="mr-days">(Full week)</span></div>';
      html += '</div>';
      html += '</div>';

      // Rows
      html += this.renderWeeklyRow('Tops', thisWeek.tops, lastWeek.tops, topsDiff, 'lbs');
      html += this.renderWeeklyRow('Smalls', thisWeek.smalls, lastWeek.smalls, smallsDiff, 'lbs');
      html += this.renderWeeklyRow('Avg Rate / Ritmo Prom', thisWeek.avgRate, lastWeek.avgRate, thisWeek.avgRate - lastWeek.avgRate, 'lbs/hr');

      // Total row
      html += '<div class="mr-weekly-total mr-' + totalStatus + '">';
      html += '<span>TOTAL:</span> <span class="mr-total-value">' + this.formatNumber(totalThis) + ' lbs</span>';
      html += '<span class="mr-total-diff">' + (totalDiff >= 0 ? '\u2b06\ufe0f +' : '\u2b07\ufe0f ') + this.formatNumber(totalDiff) + ' lbs vs last week</span>';
      html += '</div>';

      html += '</div>';
      return html;
    },

    /**
     * Render a weekly comparison row
     */
    renderWeeklyRow: function(label, thisVal, lastVal, diff, unit) {
      var arrow = diff > 0 ? '\u2b06\ufe0f' : (diff < 0 ? '\u2b07\ufe0f' : '');
      var html = '<div class="mr-weekly-row">';
      html += '<span class="mr-row-label">' + label + ':</span>';
      html += '<span class="mr-row-this">' + this.formatNumber(thisVal) + ' ' + unit + '</span>';
      html += '<span class="mr-row-diff">' + arrow + ' ' + (diff >= 0 ? '+' : '') + this.formatNumber(diff) + '</span>';
      html += '<span class="mr-row-last">' + this.formatNumber(lastVal) + ' ' + unit + '</span>';
      html += '</div>';
      return html;
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
      html += '<div class="mr-section-header">\ud83c\udfaf ORDER / PEDIDO: ' + order.id + ' \u2014 ' + order.strain + ' (' + order.customer + ')</div>';

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
```

**Step 2: Commit**

```bash
git add src/js/scoreboard/morning-report.js
git commit -m "feat(frontend): add morning report JS module"
```

---

## Task 3: Add Morning Report CSS Styles

**Files:**
- Modify: `src/css/scoreboard.css`

**Step 1: Add morning report styles at end of file**

```css
/* ============================================
   MORNING REPORT STYLES
   ============================================ */

/* Container */
#morningReportContainer {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-main, #1a1a1a);
  z-index: 100;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px;
}

.morning-report-active #morningReportContainer {
  display: flex;
}

/* Header */
.mr-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--bg-card, #2d2d2d);
  border-radius: 12px;
  margin-bottom: 20px;
}

.mr-title {
  font-family: 'DM Serif Display', serif;
  font-size: 28px;
  color: var(--ro-green, #668971);
}

.mr-subtitle {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  color: #888;
  margin-top: 4px;
}

.mr-back-btn {
  background: var(--ro-green, #668971);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-family: 'Outfit', sans-serif;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.mr-back-btn:hover {
  background: var(--ro-green-dark, #4a6b54);
  transform: scale(1.02);
}

/* Content */
#morningReportContent {
  flex: 1;
}

/* Sections */
.mr-section {
  background: var(--bg-card, #2d2d2d);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.mr-section-header {
  font-family: 'Outfit', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid rgba(255,255,255,0.1);
}

/* Metric Cards Grid */
.mr-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

/* Individual Card */
.mr-card {
  background: rgba(255,255,255,0.05);
  border-radius: 10px;
  padding: 16px;
  border-left: 4px solid #666;
}

.mr-card.mr-green { border-left-color: #22c55e; }
.mr-card.mr-yellow { border-left-color: #eab308; }
.mr-card.mr-red { border-left-color: #ef4444; }
.mr-card.mr-neutral { border-left-color: #666; }

.mr-card-header {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mr-status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #666;
}

.mr-green .mr-status-dot { background: #22c55e; }
.mr-yellow .mr-status-dot { background: #eab308; }
.mr-red .mr-status-dot { background: #ef4444; }

.mr-card-values {
  display: flex;
  gap: 20px;
  margin-bottom: 8px;
}

.mr-value-col {
  flex: 1;
}

.mr-value-label {
  font-family: 'Outfit', sans-serif;
  font-size: 11px;
  color: #888;
  margin-bottom: 4px;
}

.mr-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px;
  font-weight: 700;
  color: #fff;
}

.mr-diff {
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 600;
  color: #22c55e;
  text-align: center;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.mr-red .mr-diff { color: #ef4444; }
.mr-yellow .mr-diff { color: #eab308; }

/* Best Hour Card */
.mr-best-hour {
  background: linear-gradient(135deg, rgba(228,170,79,0.2) 0%, rgba(228,170,79,0.05) 100%);
  border-left-color: var(--gold, #e4aa4f);
  text-align: center;
}

.mr-best-hour .mr-card-header {
  justify-content: center;
  color: var(--gold, #e4aa4f);
}

.mr-fire {
  animation: fire-pulse 1s infinite;
}

@keyframes fire-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

.mr-best-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 36px;
  font-weight: 700;
  color: var(--gold, #e4aa4f);
}

.mr-best-lbs {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px;
  color: #fff;
  margin: 8px 0;
}

.mr-best-msg {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  color: #888;
  font-style: italic;
}

/* Weekly Section */
.mr-weekly-grid {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.mr-weekly-col {
  flex: 1;
  text-align: center;
}

.mr-weekly-label {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #ccc;
}

.mr-days {
  font-size: 12px;
  color: #888;
  font-weight: 400;
}

.mr-weekly-row {
  display: grid;
  grid-template-columns: 1fr 1fr 80px 1fr;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  align-items: center;
}

.mr-row-label {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  color: #ccc;
}

.mr-row-this, .mr-row-last {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  text-align: center;
}

.mr-row-diff {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  color: #22c55e;
  text-align: center;
}

.mr-weekly-total {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-top: 16px;
  background: rgba(255,255,255,0.05);
  border-radius: 8px;
  font-family: 'Outfit', sans-serif;
  font-size: 16px;
  font-weight: 700;
}

.mr-weekly-total.mr-green { background: rgba(34,197,94,0.15); }
.mr-weekly-total.mr-red { background: rgba(239,68,68,0.15); }

.mr-total-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px;
  color: #fff;
}

.mr-total-diff {
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  color: #22c55e;
}

.mr-weekly-total.mr-red .mr-total-diff { color: #ef4444; }

/* Order Progress */
.mr-order-bar-container {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.mr-order-bar {
  flex: 1;
  height: 24px;
  background: rgba(255,255,255,0.1);
  border-radius: 12px;
  overflow: hidden;
}

.mr-order-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ro-green, #668971), var(--gold, #e4aa4f));
  border-radius: 12px;
  transition: width 0.5s ease;
}

.mr-order-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  min-width: 120px;
}

.mr-order-pct {
  font-family: 'Outfit', sans-serif;
  font-size: 24px;
  font-weight: 700;
  color: var(--ro-green, #668971);
  margin-bottom: 12px;
}

.mr-order-remaining {
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  color: #888;
  line-height: 1.6;
}

/* Loading/Error states */
.mr-loading, .mr-error, .mr-no-data {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit', sans-serif;
  font-size: 16px;
  color: #888;
}

.mr-error {
  color: #ef4444;
}

/* Morning Report Button */
#morningReportBtn {
  background: rgba(102, 137, 113, 0.2);
  border: 1px solid var(--ro-green, #668971);
  color: var(--ro-green, #668971);
  padding: 8px 16px;
  border-radius: 8px;
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

#morningReportBtn:hover {
  background: rgba(102, 137, 113, 0.3);
}

#morningReportBtn.active {
  background: var(--ro-green, #668971);
  color: white;
}

/* Responsive */
@media (max-width: 768px) {
  .mr-cards {
    grid-template-columns: 1fr;
  }

  .mr-weekly-row {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .mr-row-diff {
    grid-column: span 2;
    text-align: left;
  }

  .mr-header {
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
}
```

**Step 2: Commit**

```bash
git add src/css/scoreboard.css
git commit -m "feat(styles): add morning report CSS"
```

---

## Task 4: Add HTML Structure and Button

**Files:**
- Modify: `src/pages/scoreboard.html`

**Step 1: Add script tag for morning report module**

Find the other scoreboard module script tags (around line 40) and add:

```html
<script defer src="../js/scoreboard/morning-report.js?v=1"></script>
```

**Step 2: Add morning report button in header area**

Find the language toggle section (around line 57-60) and add the button before it:

```html
<!-- Morning Report Button -->
<button id="morningReportBtn" onclick="toggleMorningReport()">
  <i class="ph-duotone ph-chart-bar"></i>
  Morning Report / Reporte Matutino
</button>
```

**Step 3: Add morning report container**

Add this right after the opening `<body>` tag (after line 47):

```html
<!-- Morning Report View -->
<div id="morningReportContainer">
  <div class="mr-header">
    <div>
      <div class="mr-title">MORNING REPORT / REPORTE MATUTINO</div>
      <div class="mr-subtitle" id="mrDate">Loading...</div>
    </div>
    <button class="mr-back-btn" onclick="toggleMorningReport()">
      <i class="ph-duotone ph-arrow-left"></i>
      Back to Live / Volver en Vivo
    </button>
  </div>
  <div id="morningReportContent"></div>
</div>
```

**Step 4: Commit**

```bash
git add src/pages/scoreboard.html
git commit -m "feat(html): add morning report button and container"
```

---

## Task 5: Integration Testing

**Step 1: Deploy backend changes**

1. Copy updated `Code.gs` to Google Apps Script
2. Deploy new version

**Step 2: Test API endpoint**

Open browser console and run:
```javascript
fetch('https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec?action=morningReport')
  .then(r => r.json())
  .then(console.log)
```

Expected: JSON with yesterday, dayBefore, thisWeek, lastWeek data

**Step 3: Test frontend**

1. Open scoreboard.html in browser
2. Click "Morning Report / Reporte Matutino" button
3. Verify report loads with data
4. Verify traffic light colors work
5. Click "Back to Live" to return
6. Test on mobile viewport

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete morning report integration"
git push
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | Code.gs | Backend API endpoint with data aggregation |
| 2 | morning-report.js | Frontend JS module for rendering |
| 3 | scoreboard.css | Styles for report layout and cards |
| 4 | scoreboard.html | Button and container HTML |
| 5 | - | Integration testing and deployment |

**Total estimated tasks:** 5 major tasks with ~20 subtasks
