/**********************************************************
 * Production Toolkit - With AI Agent
 * 
 * Includes:
 * - GitHub Pages API Backend (Scoreboard + Timer)
 * - 5KG Bag Timer (with 10lb support)
 * - Lead Time Estimator (calculations only)
 * - Crew Change Tool
 * - Master Sheet Generator
 * - Hourly Production Table Generator
 * - AI Agent Chat Interface
 * 
 * API ENDPOINTS (for GitHub Pages):
 * - GET ?action=scoreboard → Get scoreboard + timer data
 * - GET ?action=test       → API health check
 * - POST ?action=logBag    → Log manual bag completion
 * - POST ?action=logPause  → Log timer pause
 * - POST ?action=logResume → Log timer resume
 * - POST ?action=chat      → AI Agent chat (requires ANTHROPIC_API_KEY in Script Properties)
 **********************************************************/

var SHEET_ID = '1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is';
var AI_MODEL = 'claude-sonnet-4-20250514';

/**********************************************************
 * Time Slot Multipliers - Accounts for breaks & partial hours
 * 
 * Schedule:
 * - 9:00 AM: 10 min break
 * - 12:00-12:30 PM: 30 min lunch
 * - 2:30 PM: 10 min break  
 * - 4:20 PM: 10 min cleanup (end of day)
 **********************************************************/
var TIME_SLOT_MULTIPLIERS = {
  '7:00 AM – 8:00 AM': 1.0,
  '8:00 AM – 9:00 AM': 1.0,
  '9:00 AM – 10:00 AM': 0.83,
  '10:00 AM – 11:00 AM': 1.0,
  '11:00 AM – 12:00 PM': 1.0,
  '12:30 PM – 1:00 PM': 0.5,
  '1:00 PM – 2:00 PM': 1.0,
  '2:00 PM – 3:00 PM': 1.0,
  '2:30 PM – 3:00 PM': 0.5,
  '3:00 PM – 4:00 PM': 0.83,
  '4:00 PM – 4:30 PM': 0.33,
  '3:00 PM – 3:30 PM': 0.5
};

function getTimeSlotMultiplier(timeSlot) {
  if (!timeSlot) return 1.0;
  var slot = String(timeSlot).trim();
  if (TIME_SLOT_MULTIPLIERS.hasOwnProperty(slot)) {
    return TIME_SLOT_MULTIPLIERS[slot];
  }
  var normalizedSlot = slot.replace(/[-–—]/g, '–');
  if (TIME_SLOT_MULTIPLIERS.hasOwnProperty(normalizedSlot)) {
    return TIME_SLOT_MULTIPLIERS[normalizedSlot];
  }
  return 1.0;
}

/**********************************************************
 * Web App Routing - API Only (GitHub Pages handles UI)
 **********************************************************/
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  
  var result = {};
  try {
    if (action === 'scoreboard') {
      result = getScoreboardWithTimerData();
    } else if (action === 'getOrders') {
      result = getOrders();
    } else if (action === 'getOrder') {
      result = getOrder(e.parameter.id);
    } else if (action === 'test') {
      result = { ok: true, message: 'API is working', timestamp: new Date().toISOString() };
    } else {
      // No action specified - return API info
      result = { 
        ok: true, 
        message: 'Rogue Origin Production API',
        endpoints: ['scoreboard', 'test'],
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {
    // Log full error for debugging, but only expose message to client
    console.error('doGet error:', err.message, err.stack);
    result = { error: err.message };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};
  
  try {
    if (action === 'logBag') {
      var size = (e && e.parameter && e.parameter.size) || '5 kg.';
      result = logManualBagCompletion(size);
    } else if (action === 'logPause') {
      var postData = e.postData ? JSON.parse(e.postData.contents) : {};
      var reason = postData.reason || (e.parameter && e.parameter.reason) || 'No reason provided';
      var duration = postData.duration || (e.parameter && e.parameter.duration) || 0;
      result = logTimerPause(reason, duration);
    } else if (action === 'logResume') {
      var postData2 = e.postData ? JSON.parse(e.postData.contents) : {};
      var pauseId = postData2.pauseId || (e.parameter && e.parameter.pauseId) || '';
      var actualDuration = postData2.duration || (e.parameter && e.parameter.duration) || 0;
      result = logTimerResume(pauseId, actualDuration);
    } else if (action === 'chat') {
      // AI Agent Chat Handler
      var chatData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = handleChatRequest(chatData);
    } else if (action === 'saveOrder') {
      // Orders Management
      var orderData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = saveOrder(orderData);
    } else if (action === 'deleteOrder') {
      var deleteData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = deleteOrder(deleteData.id);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**********************************************************
 * Custom Menu
 **********************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Producción')
    .addItem('Generar tabla única', 'generateHourlyProductionTable')
    .addItem('Construir Master', 'generateMasterSheet')
    .addSeparator()
    .addItem('Lead Time Estimator / Calculadora', 'showLeadTimeEstimator')
    .addSeparator()
    .addItem('Crew Change / Cambio de Personal', 'showCrewChangeSidebar')
    .addItem('Throughput Timer / Temporizador', 'showThroughputTimer')
    .addToUi();
  jumpToNewestHrHr_();
}

/**********************************************************
 * SCOREBOARD DATA (LINE 1 ONLY)
 **********************************************************/
function getScoreboardData() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();
  var todayLabel = Utilities.formatDate(new Date(), timezone, 'MMMM dd, yyyy');
  var sheet = getLatestMonthSheet_(ss);
  
  var result = {
    lastHourLbs: 0, lastHourTarget: 0, lastHourTrimmers: 0, lastTimeSlot: '', lastHourMultiplier: 1.0,
    currentHourTrimmers: 0, currentHourTarget: 0, currentTimeSlot: '', currentHourMultiplier: 1.0,
    targetRate: 0, strain: '', todayLbs: 0, todayTarget: 0, todayPercentage: 0,
    hoursLogged: 0, effectiveHours: 0, avgPercentage: 0, bestPercentage: 0, streak: 0,
    vsYesterday: null, vs7Day: null, strainTargetRate: 0, usingStrainRate: false, hourlyRates: []
  };
  
  if (!sheet) return result;
  
  var vals = sheet.getDataRange().getValues();
  var dateRowIndex = findDateRow_(vals, todayLabel);
  if (dateRowIndex === -1) return result;
  
  var headerRowIndex = dateRowIndex + 1;
  var headers = vals[headerRowIndex] || [];
  var cols = getColumnIndices_(headers);
  
  // Collect all LINE 1 rows for today
  var todayRows = [];
  for (var r = headerRowIndex + 1; r < vals.length; r++) {
    var row = vals[r];
    if (isEndOfBlock_(row)) break;
    
    var timeSlot = row[0] || '';
    var tops1 = parseFloat(row[cols.tops1]) || 0;
    var tr1 = parseFloat(row[cols.trimmers1]) || 0;
    var cv1 = row[cols.cultivar1] || '';
    var multiplier = getTimeSlotMultiplier(timeSlot);
    
    todayRows.push({ timeSlot: timeSlot, tops: tops1, trimmers: tr1, strain: cv1, multiplier: multiplier });
  }
  
  // Find last COMPLETED hour and CURRENT hour
  var lastCompletedHourIndex = -1;
  var currentHourIndex = -1;
  
  for (var i = 0; i < todayRows.length; i++) {
    var row = todayRows[i];
    if (row.tops > 0) {
      lastCompletedHourIndex = i;
    } else if (row.trimmers > 0 && row.tops === 0) {
      currentHourIndex = i;
    }
  }
  
  // Determine active strain
  var activeStrain = '';
  if (currentHourIndex >= 0 && todayRows[currentHourIndex].strain) {
    activeStrain = todayRows[currentHourIndex].strain;
  } else if (lastCompletedHourIndex >= 0 && todayRows[lastCompletedHourIndex].strain) {
    activeStrain = todayRows[lastCompletedHourIndex].strain;
  }
  result.strain = activeStrain;
  
  // Get strain-specific target rate
  var strainTargetRate = 0;
  var fallbackTargetRate = 0;
  
  if (activeStrain) {
    var strainData = getStrainHistoricalRate_(ss, timezone, activeStrain, 30);
    strainTargetRate = strainData.avgRate || 0;
  }
  
  var allDaily = getExtendedDailyDataLine1_(ss, timezone, 30);
  var last7 = allDaily.slice(-7);
  fallbackTargetRate = last7.length > 0 ? last7.reduce(function(sum, d) { return sum + (d.avgRate || 0); }, 0) / last7.length : 0;
  
  var targetRate = strainTargetRate > 0 ? strainTargetRate : fallbackTargetRate;
  if (targetRate === 0) targetRate = 1.0;
  
  result.targetRate = targetRate;
  result.strainTargetRate = strainTargetRate;
  result.usingStrainRate = strainTargetRate > 0;
  
  // Calculate totals
  var totalLbs = 0, totalTrimmerHours = 0, hoursWorked = 0, effectiveHours = 0;
  
  for (var i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    var row = todayRows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      totalTrimmerHours += row.trimmers;
      hoursWorked++;
      effectiveHours += row.multiplier;
    }
  }
  
  // Last completed hour
  if (lastCompletedHourIndex >= 0) {
    var lastRow = todayRows[lastCompletedHourIndex];
    result.lastHourLbs = lastRow.tops;
    result.lastHourTrimmers = lastRow.trimmers;
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
    result.lastHourDelta = lastRow.tops - result.lastHourTarget;
    result.lastTimeSlot = lastRow.timeSlot;
  }
  
  // Current hour
  if (currentHourIndex >= 0) {
    var currentRow = todayRows[currentHourIndex];
    result.currentHourTrimmers = currentRow.trimmers;
    result.currentHourMultiplier = currentRow.multiplier;
    result.currentHourTarget = currentRow.trimmers * targetRate * currentRow.multiplier;
    result.currentTimeSlot = currentRow.timeSlot;
  }
  
  result.todayLbs = totalLbs;
  result.hoursLogged = hoursWorked;
  result.effectiveHours = effectiveHours;
  
  // Calculate metrics
  var totalTarget = 0, hourlyPercentages = [], hourlyDeltas = [];
  var bestPct = 0, bestDelta = null, streak = 0, currentStreak = 0;
  var hourlyRates = [];
  
  for (var i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    var row = todayRows[i];
    if (row.trimmers > 0 && row.tops > 0) {
      var hourTarget = row.trimmers * targetRate * row.multiplier;
      totalTarget += hourTarget;
      
      var pct = hourTarget > 0 ? (row.tops / hourTarget) * 100 : 0;
      hourlyPercentages.push(pct);
      if (pct > bestPct) bestPct = pct;
      
      var hourDelta = row.tops - hourTarget;
      hourlyDeltas.push(hourDelta);
      if (bestDelta === null || hourDelta > bestDelta) bestDelta = hourDelta;
      
      if (pct >= 90) { currentStreak++; streak = currentStreak; }
      else { currentStreak = 0; }
      
      var rate = row.tops / row.trimmers;
      hourlyRates.push({ timeSlot: row.timeSlot, rate: rate, target: targetRate * row.multiplier });
    }
  }
  
  result.hourlyRates = hourlyRates;
  result.todayTarget = totalTarget;
  result.todayPercentage = totalTarget > 0 ? (totalLbs / totalTarget) * 100 : 0;
  result.todayDelta = totalLbs - totalTarget;
  result.avgDelta = hourlyDeltas.length > 0 ? hourlyDeltas.reduce(function(a, b) { return a + b; }, 0) / hourlyDeltas.length : 0;
  result.bestDelta = bestDelta !== null ? bestDelta : 0;
  result.avgPercentage = hourlyPercentages.length > 0 ? hourlyPercentages.reduce(function(a, b) { return a + b; }, 0) / hourlyPercentages.length : 0;
  result.bestPercentage = bestPct;
  result.streak = streak;
  
  // Projection
  var dailyProjection = calculateDailyProjection_(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs);
  result.projectedTotal = dailyProjection.projectedTotal;
  result.dailyGoal = dailyProjection.dailyGoal;
  result.projectedDelta = dailyProjection.projectedTotal - dailyProjection.dailyGoal;
  
  // Comparisons
  var comparisons = getComparisonDataLine1_(ss, timezone, vals, hoursWorked, result.todayPercentage, targetRate);
  result.vsYesterday = comparisons.vsYesterday;
  result.vs7Day = comparisons.vs7Day;
  
  return result;
}

/**********************************************************
 * BAG TIMER DATA - With Cycle History Support
 * Supports both 5kg and 10lb TOP bags
 **********************************************************/
function getBagTimerData() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();
  var result = { 
    lastBagTime: null, 
    secondsSinceLastBag: 0, 
    targetSeconds: 0, 
    avgSecondsToday: 0, 
    avgSeconds7Day: 0, 
    bagsToday: 0,
    bags5kgToday: 0,
    bags10lbToday: 0,
    currentTrimmers: 0, 
    targetRate: 0,
    lastBagSize: null,
    cycleHistory: []
  };
  
  var trackingSheet = ss.getSheetByName('Rogue Origin Production Tracking');
  if (!trackingSheet) return result;
  
  var scoreboardData = getScoreboardData();
  result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
  result.targetRate = scoreboardData.targetRate || 1.0;
  
  // Current target based on current trimmers
  var bagWeightLbs = 11.0231;
  var teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
  if (teamRateLbsPerHour > 0) {
    result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
  }
  
  var vals = trackingSheet.getDataRange().getValues();
  if (vals.length < 2) return result;
  
  var headers = vals[0];
  var timestampCol = headers.indexOf('Timestamp');
  var sizeCol = headers.indexOf('Size');
  var skuCol = headers.indexOf('SKU');
  
  if (timestampCol === -1 || sizeCol === -1) return result;
  
  // Get today's hourly trimmer data for accurate per-bag targets
  var hourlyTrimmers = getTodayHourlyTrimmers_(ss, timezone);
  
  var allBags = [];
  var fiveKgBags = [];
  var tenLbBags = [];
  var today = new Date();
  var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');
  var sevenDaysAgo = new Date(today); 
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  for (var i = 1; i < vals.length; i++) {
    var size = String(vals[i][sizeCol] || '').toLowerCase().trim();
    var sku = skuCol >= 0 ? String(vals[i][skuCol] || '').toUpperCase().trim() : '';
    var timestamp = vals[i][timestampCol];
    
    if (timestamp instanceof Date && !isNaN(timestamp.getTime())) {
      var dateStr = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');
      var bagEntry = { timestamp: timestamp, dateStr: dateStr, size: size, sku: sku };
      
      if (is5kgBag(size)) {
        fiveKgBags.push(bagEntry);
        allBags.push(bagEntry);
      }
      else if (is10lbTopsBag(size, sku)) {
        tenLbBags.push(bagEntry);
        allBags.push(bagEntry);
      }
    }
  }
  
  // Sort all bags by timestamp (newest first)
  allBags.sort(function(a, b) { return b.timestamp - a.timestamp; });
  fiveKgBags.sort(function(a, b) { return b.timestamp - a.timestamp; });
  tenLbBags.sort(function(a, b) { return b.timestamp - a.timestamp; });
  
  if (allBags.length === 0) return result;
  
  // Last bag time
  result.lastBagTime = allBags[0].timestamp.toISOString();
  result.lastBagSize = allBags[0].size;
  result.secondsSinceLastBag = Math.round((today - allBags[0].timestamp) / 1000);
  
  // Filter to today's bags
  var allBagsToday = allBags.filter(function(b) { return b.dateStr === todayStr; });
  var bags5kgToday = fiveKgBags.filter(function(b) { return b.dateStr === todayStr; });
  var bags10lbToday = tenLbBags.filter(function(b) { return b.dateStr === todayStr; });
  
  result.bags5kgToday = bags5kgToday.length;
  result.bags10lbToday = bags10lbToday.length;
  result.bagsToday = allBagsToday.length;
  
  // Calculate individual cycle times for today
  var cycleHistory = [];
  
  if (allBagsToday.length >= 1) {
    var bagsSortedOldestFirst = allBagsToday.slice().sort(function(a, b) { 
      return a.timestamp - b.timestamp; 
    });
    
    for (var j = 0; j < bagsSortedOldestFirst.length; j++) {
      var bag = bagsSortedOldestFirst[j];
      var cycleTime = 0;
      
      if (j === 0) {
        var workdayStart = new Date(bag.timestamp);
        workdayStart.setHours(7, 0, 0, 0);
        
        if (bag.timestamp > workdayStart) {
          cycleTime = Math.round((bag.timestamp - workdayStart) / 1000);
          if (cycleTime > 7200) cycleTime = 0;
        }
      } else {
        var prevBag = bagsSortedOldestFirst[j - 1];
        cycleTime = Math.round((bag.timestamp - prevBag.timestamp) / 1000);
        if (cycleTime > 7200) cycleTime = 0;
      }
      
      var bagHour = bag.timestamp.getHours();
      var trimmersAtTime = getTrimmersForHour_(hourlyTrimmers, bagHour, result.currentTrimmers);
      var targetAtTime = 0;
      
      if (trimmersAtTime > 0 && result.targetRate > 0) {
        var teamRateAtTime = trimmersAtTime * result.targetRate;
        targetAtTime = Math.round((bagWeightLbs / teamRateAtTime) * 3600);
      } else {
        targetAtTime = result.targetSeconds;
      }
      
      if (cycleTime > 0 && cycleTime < 7200) {
        cycleHistory.push({
          cycleTime: cycleTime,
          target: targetAtTime,
          trimmers: trimmersAtTime,
          timestamp: bag.timestamp.toISOString(),
          size: bag.size,
          hour: bagHour
        });
      }
    }
  }
  
  result.cycleHistory = cycleHistory;
  
  // Calculate average time between ALL bags today
  if (allBagsToday.length >= 2) {
    var todayIntervals = [];
    for (var k = 0; k < allBagsToday.length - 1; k++) {
      var interval = (allBagsToday[k].timestamp - allBagsToday[k + 1].timestamp) / 1000;
      if (interval > 0 && interval < 7200) todayIntervals.push(interval);
    }
    if (todayIntervals.length > 0) {
      result.avgSecondsToday = Math.round(todayIntervals.reduce(function(a, b) { return a + b; }, 0) / todayIntervals.length);
    }
  }
  
  // 7-day average
  var bags7Day = allBags.filter(function(b) { return b.timestamp >= sevenDaysAgo; });
  if (bags7Day.length >= 2) {
    var intervals7Day = [];
    for (var m = 0; m < bags7Day.length - 1; m++) {
      var interval2 = (bags7Day[m].timestamp - bags7Day[m + 1].timestamp) / 1000;
      if (interval2 > 0 && interval2 < 7200) intervals7Day.push(interval2);
    }
    if (intervals7Day.length > 0) {
      result.avgSeconds7Day = Math.round(intervals7Day.reduce(function(a, b) { return a + b; }, 0) / intervals7Day.length);
    }
  }
  
  return result;
}

/**
 * Get today's hourly trimmer counts from production sheet
 */
function getTodayHourlyTrimmers_(ss, timezone) {
  var result = {};
  var sheet = getLatestMonthSheet_(ss);
  if (!sheet) return result;
  
  var todayLabel = Utilities.formatDate(new Date(), timezone, 'MMMM dd, yyyy');
  var vals = sheet.getDataRange().getValues();
  var dateRowIndex = findDateRow_(vals, todayLabel);
  
  if (dateRowIndex === -1) return result;
  
  var headerRowIndex = dateRowIndex + 1;
  var headers = vals[headerRowIndex] || [];
  var cols = getColumnIndices_(headers);
  
  var slotToHour = {
    '7:00 AM – 8:00 AM': 7,
    '8:00 AM – 9:00 AM': 8,
    '9:00 AM – 10:00 AM': 9,
    '10:00 AM – 11:00 AM': 10,
    '11:00 AM – 12:00 PM': 11,
    '12:30 PM – 1:00 PM': 12,
    '1:00 PM – 2:00 PM': 13,
    '2:00 PM – 3:00 PM': 14,
    '2:30 PM – 3:00 PM': 14,
    '3:00 PM – 4:00 PM': 15,
    '3:00 PM – 3:30 PM': 15,
    '4:00 PM – 4:30 PM': 16
  };
  
  for (var r = headerRowIndex + 1; r < vals.length; r++) {
    var row = vals[r];
    if (isEndOfBlock_(row)) break;
    
    var timeSlot = String(row[0] || '').trim();
    var normalizedSlot = timeSlot.replace(/[-–—]/g, '–');
    var tr1 = parseFloat(row[cols.trimmers1]) || 0;
    
    for (var slot in slotToHour) {
      var normalizedKey = slot.replace(/[-–—]/g, '–');
      if (normalizedSlot === normalizedKey || timeSlot === slot) {
        var hour = slotToHour[slot];
        result[hour] = tr1;
        break;
      }
    }
  }
  
  return result;
}

/**
 * Get trimmer count for a specific hour
 */
function getTrimmersForHour_(hourlyTrimmers, hour, fallback) {
  if (hourlyTrimmers[hour] !== undefined) {
    return hourlyTrimmers[hour];
  }
  
  var hours = Object.keys(hourlyTrimmers).map(Number).sort(function(a,b) { return a - b; });
  for (var i = hours.length - 1; i >= 0; i--) {
    if (hours[i] <= hour) {
      return hourlyTrimmers[hours[i]];
    }
  }
  
  if (hours.length > 0) {
    return hourlyTrimmers[hours[0]];
  }
  
  return fallback || 0;
}

/**********************************************************
 * Combined Scoreboard + Timer Data
 **********************************************************/
function getScoreboardWithTimerData() {
  return {
    scoreboard: getScoreboardData(),
    timer: getBagTimerData()
  };
}

/**********************************************************
 * LOG MANUAL BAG COMPLETION
 **********************************************************/
function logManualBagCompletion(size) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var trackingSheet = ss.getSheetByName('Rogue Origin Production Tracking');
  
  if (!trackingSheet) {
    return { success: false, error: 'Tracking sheet not found' };
  }
  
  size = size || '5 kg.';
  
  var now = new Date();
  var headers = trackingSheet.getRange(1, 1, 1, trackingSheet.getLastColumn()).getValues()[0];
  var timestampCol = headers.indexOf('Timestamp');
  var sizeCol = headers.indexOf('Size');
  
  if (timestampCol === -1 || sizeCol === -1) {
    return { success: false, error: 'Required columns not found' };
  }
  
  var newRow = [];
  for (var i = 0; i < headers.length; i++) {
    if (i === timestampCol) newRow.push(now);
    else if (i === sizeCol) newRow.push(size);
    else newRow.push('');
  }
  
  trackingSheet.appendRow(newRow);
  
  return { success: true, timestamp: now.toISOString(), size: size };
}

/**********************************************************
 * LOG TIMER PAUSE
 **********************************************************/
function logTimerPause(reason, estimatedDuration) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();
  
  var pauseSheet = ss.getSheetByName('Timer Pause Log');
  if (!pauseSheet) {
    pauseSheet = ss.insertSheet('Timer Pause Log');
    pauseSheet.appendRow(['Pause ID', 'Date', 'Pause Time', 'Resume Time', 'Duration (min)', 'Reason', 'User']);
    pauseSheet.setFrozenRows(1);
    pauseSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#668971').setFontColor('#fff');
  }
  
  var now = new Date();
  var pauseId = now.getTime().toString();
  var dateStr = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(now, timezone, 'HH:mm:ss');
  var user = Session.getActiveUser().getEmail() || 'Scoreboard';
  
  pauseSheet.appendRow([pauseId, dateStr, timeStr, '', '', reason, user]);
  
  return { success: true, pauseId: pauseId, timestamp: now.toISOString(), reason: reason };
}

/**********************************************************
 * LOG TIMER RESUME
 **********************************************************/
function logTimerResume(pauseId, actualDurationSeconds) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();
  
  var pauseSheet = ss.getSheetByName('Timer Pause Log');
  if (!pauseSheet) {
    return { success: false, error: 'Pause log sheet not found' };
  }
  
  var now = new Date();
  var timeStr = Utilities.formatDate(now, timezone, 'HH:mm:ss');
  var durationMin = Math.round(actualDurationSeconds / 60 * 10) / 10;
  
  var data = pauseSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == pauseId) {
      pauseSheet.getRange(i + 1, 4).setValue(timeStr);
      pauseSheet.getRange(i + 1, 5).setValue(durationMin);
      return { success: true, pauseId: pauseId, resumeTime: now.toISOString(), durationMinutes: durationMin };
    }
  }
  
  return { success: false, error: 'Pause record not found: ' + pauseId };
}

/**
 * Check if a size string matches 5kg bag
 */
function is5kgBag(size) {
  var s = String(size || '').toLowerCase().trim();
  return s === '5 kg.' || s === '5kg' || s === '5 kg';
}

/**
 * Check if this is a 10lb TOPS bag
 */
function is10lbTopsBag(size, sku) {
  var skuStr = String(sku || '').toUpperCase();
  return skuStr.indexOf('TOP-10-LB') !== -1;
}

/**********************************************************
 * HELPER FUNCTIONS
 **********************************************************/
function getLatestMonthSheet_(ss) {
  var monthSheets = ss.getSheets().filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });
  return monthSheets[0] || null;
}

function findDateRow_(vals, dateLabel) {
  var lastAnyDateRow = -1, todayDateRow = -1;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === 'Date:') {
      lastAnyDateRow = i;
      if (vals[i][1] === dateLabel) todayDateRow = i;
    }
  }
  return todayDateRow !== -1 ? todayDateRow : lastAnyDateRow;
}

function getColumnIndices_(headers) {
  return {
    cultivar1: headers.indexOf('Cultivar 1'), tops1: headers.indexOf('Tops 1'),
    smalls1: headers.indexOf('Smalls 1'), buckers1: headers.indexOf('Buckers 1'),
    trimmers1: headers.indexOf('Trimmers 1'), tzero1: headers.indexOf('T-Zero 1'),
    cultivar2: headers.indexOf('Cultivar 2'), tops2: headers.indexOf('Tops 2'),
    smalls2: headers.indexOf('Smalls 2'), buckers2: headers.indexOf('Buckers 2'),
    trimmers2: headers.indexOf('Trimmers 2'), tzero2: headers.indexOf('T-Zero 2'),
    qc: headers.indexOf('QC')
  };
}

function isEndOfBlock_(row) {
  if (!row[0]) return true;
  if (row[0] === 'Date:') return true;
  var str = String(row[0]);
  if (str.indexOf('Performance Averages') !== -1) return true;
  if (str.indexOf('Avg Tops:Smalls') !== -1) return true;
  return false;
}

function getStrainHistoricalRate_(ss, timezone, strainName, days) {
  var monthSheets = ss.getSheets().filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });
  
  if (monthSheets.length === 0) return { avgRate: 0 };
  
  var today = new Date();
  var cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);
  var totalLbs = 0, totalTrimmerHours = 0;
  
  monthSheets.forEach(function(sheet) {
    var vals = sheet.getDataRange().getValues();
    var currentDate = null, cols = null;
    
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      if (row[0] === 'Date:') {
        var dateStr = row[1];
        if (dateStr) {
          var d = new Date(dateStr);
          currentDate = !isNaN(d.getTime()) ? d : null;
        }
        var headerRow = vals[i + 1] || [];
        cols = getColumnIndices_(headerRow);
        continue;
      }
      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock_(row)) continue;
      
      var cv1 = row[cols.cultivar1] || '';
      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var tr1 = parseFloat(row[cols.trimmers1]) || 0;
      
      if (cv1 && strainName && (String(cv1).indexOf(strainName) !== -1 || String(strainName).indexOf(cv1) !== -1)) {
        if (tops1 > 0 && tr1 > 0) {
          totalLbs += tops1;
          totalTrimmerHours += tr1;
        }
      }
    }
  });
  
  return { avgRate: totalTrimmerHours > 0 ? totalLbs / totalTrimmerHours : 0 };
}

function getExtendedDailyDataLine1_(ss, timezone, days) {
  var monthSheets = ss.getSheets().filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });
  if (monthSheets.length === 0) return [];
  
  var dailyMap = {};
  var today = new Date();
  var cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);
  
  monthSheets.forEach(function(sheet) {
    var vals = sheet.getDataRange().getValues();
    var currentDate = null, cols = null;
    var dayData = { totalLbs: 0, totalTrimmerHours: 0, hoursWorked: 0 };
    
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      if (row[0] === 'Date:') {
        if (currentDate && dayData.totalLbs > 0 && currentDate >= cutoff) {
          var dateKey = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = {
              date: new Date(currentDate),
              avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalLbs / dayData.totalTrimmerHours : 0
            };
          }
        }
        var dateStr = row[1];
        if (dateStr) {
          var d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            currentDate = d;
            dayData = { totalLbs: 0, totalTrimmerHours: 0, hoursWorked: 0 };
          }
        }
        var headerRow = vals[i + 1] || [];
        cols = getColumnIndices_(headerRow);
        continue;
      }
      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock_(row)) continue;
      
      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var tr1 = parseFloat(row[cols.trimmers1]) || 0;
      
      if (tops1 > 0 && tr1 > 0) {
        dayData.totalLbs += tops1;
        dayData.totalTrimmerHours += tr1;
        dayData.hoursWorked++;
      }
    }
    
    if (currentDate && dayData.totalLbs > 0 && currentDate >= cutoff) {
      var dateKey2 = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
      if (!dailyMap[dateKey2]) {
        dailyMap[dateKey2] = {
          date: new Date(currentDate),
          avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalLbs / dayData.totalTrimmerHours : 0
        };
      }
    }
  });
  
  return Object.keys(dailyMap).map(function(k) { return dailyMap[k]; }).sort(function(a, b) { return a.date - b.date; });
}

function calculateDailyProjection_(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar) {
  var allTimeSlots = [
    '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
    '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM'
  ];
  
  var totalLbs = 0, totalTrimmerEffectiveHours = 0, lastKnownTrimmers = 0;
  
  for (var i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    var row = todayRows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      totalTrimmerEffectiveHours += row.trimmers * row.multiplier;
      lastKnownTrimmers = row.trimmers;
    }
  }
  
  if (currentHourIndex >= 0 && todayRows[currentHourIndex].trimmers > 0) {
    lastKnownTrimmers = todayRows[currentHourIndex].trimmers;
  }
  
  var currentRate = totalTrimmerEffectiveHours > 0 ? totalLbs / totalTrimmerEffectiveHours : targetRate;
  
  var workedSlots = {};
  for (var i = 0; i < todayRows.length; i++) {
    if (todayRows[i].timeSlot) {
      var normalizedSlot = String(todayRows[i].timeSlot).trim().replace(/[-–—]/g, '–');
      workedSlots[normalizedSlot] = todayRows[i];
    }
  }
  
  var dailyGoal = 0, projectedFromRemaining = 0;
  
  for (var j = 0; j < allTimeSlots.length; j++) {
    var slot = allTimeSlots[j];
    var normalizedSlot = slot.replace(/[-–—]/g, '–');
    var multiplier = getTimeSlotMultiplier(slot);
    var workedRow = workedSlots[normalizedSlot];
    
    if (workedRow && workedRow.tops > 0 && workedRow.trimmers > 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
    } else if (workedRow && workedRow.trimmers > 0 && workedRow.tops === 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
      projectedFromRemaining += workedRow.trimmers * currentRate * multiplier;
    } else {
      dailyGoal += lastKnownTrimmers * targetRate * multiplier;
      projectedFromRemaining += lastKnownTrimmers * currentRate * multiplier;
    }
  }
  
  return { projectedTotal: totalLbsSoFar + projectedFromRemaining, dailyGoal: dailyGoal };
}

function getComparisonDataLine1_(ss, timezone, vals, hoursWorked, todayPct, targetRate) {
  var result = { vsYesterday: null, vs7Day: null };
  if (hoursWorked === 0) return result;
  
  var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  var yesterdayLabel = Utilities.formatDate(yesterday, timezone, 'MMMM dd, yyyy');
  var yesterdayRowIndex = findDateRow_(vals, yesterdayLabel);
  
  if (yesterdayRowIndex !== -1) {
    var yesterdayPct = calculateDayPercentageAtHourLine1_(vals, yesterdayRowIndex, hoursWorked, targetRate);
    if (yesterdayPct > 0) result.vsYesterday = todayPct - yesterdayPct;
  }
  
  var dayPercentages = [];
  for (var d = 1; d <= 7; d++) {
    var pastDate = new Date(); pastDate.setDate(pastDate.getDate() - d);
    var pastLabel = Utilities.formatDate(pastDate, timezone, 'MMMM dd, yyyy');
    var pastRowIndex = findDateRow_(vals, pastLabel);
    if (pastRowIndex !== -1) {
      var pastPct = calculateDayPercentageAtHourLine1_(vals, pastRowIndex, hoursWorked, targetRate);
      if (pastPct > 0) dayPercentages.push(pastPct);
    }
  }
  
  if (dayPercentages.length > 0) {
    result.vs7Day = todayPct - dayPercentages.reduce(function(a, b) { return a + b; }, 0) / dayPercentages.length;
  }
  
  return result;
}

function calculateDayPercentageAtHourLine1_(vals, dateRowIndex, maxHours, targetRate) {
  var headerRowIndex = dateRowIndex + 1;
  var headers = vals[headerRowIndex] || [];
  var cols = getColumnIndices_(headers);
  var totalLbs = 0, totalTarget = 0, hoursCount = 0;
  
  for (var r = headerRowIndex + 1; r < vals.length && hoursCount < maxHours; r++) {
    var row = vals[r];
    if (isEndOfBlock_(row)) break;
    
    var timeSlot = row[0] || '';
    var multiplier = getTimeSlotMultiplier(timeSlot);
    var tops1 = parseFloat(row[cols.tops1]) || 0;
    var tr1 = parseFloat(row[cols.trimmers1]) || 0;
    
    if (tr1 > 0 && tops1 > 0) {
      totalLbs += tops1;
      totalTarget += tr1 * targetRate * multiplier;
      hoursCount++;
    }
  }
  
  return totalTarget > 0 ? (totalLbs / totalTarget) * 100 : 0;
}

/**********************************************************
 * Hour-by-Hour Production Tables
 **********************************************************/
function generateHourlyProductionTable() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone();
  var monthCode = Utilities.formatDate(new Date(), timezone, 'yyyy-MM');

  var sheet = ss.getSheets().find(function(sh) { return sh.getName().includes(monthCode); });
  if (!sheet) {
    sheet = ss.insertSheet(monthCode);
    setupMonthlySheet(sheet);
    ss.toast('Created sheet "' + monthCode + '"', 'Producción');
  } else {
    ss.toast('Using sheet "' + sheet.getName() + '"', 'Producción');
  }

  var dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) return SpreadsheetApp.getUi().alert('Missing sheet "Data".');
  var wage = dataSheet.getRange('O4').getValue();
  if (!wage || isNaN(wage))
    return SpreadsheetApp.getUi().alert('Data!O4 must contain a numeric wage rate.');

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(dataSheet.getRange('A3:A40'), true)
    .setAllowInvalid(false)
    .build();

  var lastRow = sheet.getLastRow();
  var startRow = lastRow + 2;

  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getUserProperties();
  var lastChoice = props.getProperty('includeLateShift') === 'YES';
  var promptText = lastChoice
    ? 'Include 3:00–4:30 PM again? (Last time you selected YES)'
    : 'Include 3:00–4:30 PM timeslot? (Last time you selected NO)';
  var includeLateShift = ui.alert(promptText, ui.ButtonSet.YES_NO);
  props.setProperty('includeLateShift', includeLateShift === ui.Button.YES ? 'YES' : 'NO');

  var baseSlotsCore = [
    '7:00 AM – 8:00 AM','8:00 AM – 9:00 AM','9:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM','11:00 AM – 12:00 PM','12:30 PM – 1:00 PM',
    '1:00 PM – 2:00 PM','2:00 PM – 3:00 PM'
  ];

  var slots =
    includeLateShift === ui.Button.YES
      ? baseSlotsCore.concat(['3:00 PM – 4:00 PM','4:00 PM – 4:30 PM'])
      : baseSlotsCore.concat(['3:00 PM – 3:30 PM']);

  sheet.getRange(startRow,1,1,2)
    .setValues([['Date:',Utilities.formatDate(new Date(),timezone,'MMMM dd, yyyy')]])
    .setFontWeight('bold');

  var headers = [
    'Time Slot',
    'Cultivar 1','Tops 1','Smalls 1','Buckers 1','Trimmers 1','T-Zero 1',
    'Cultivar 2','Tops 2','Smalls 2','Buckers 2','Trimmers 2','T-Zero 2',
    'QC',
    'Cum. Tops 1','Cum. Smalls 1','Total Ops/Hr 1','Tops/Op 1','Units/Op 1','Cost/Top 1','Cost/Small 1',
    'Cum. Tops 2','Cum. Smalls 2','Total Ops/Hr 2','Tops/Op 2','Units/Op 2','Cost/Top 2','Cost/Small 2'
  ];
  sheet.getRange(startRow+1,1,1,headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#004d40')
    .setFontColor('white')
    .setHorizontalAlignment('center');

  var cols = { qc:14, calc1:15, calc2:22 };

  slots.forEach(function(slot,i){
    var r = startRow+2+i;
    sheet.setRowHeight(r,40);
    sheet.getRange(r,1).setValue(slot).setHorizontalAlignment('center');
    sheet.getRange(r,1,1,headers.length).setBackground(i%2 ? '#f9f9f9' : '#ffffff');
    sheet.getRange(r,2,1,6).setBackground('#FFF3E0');
    sheet.getRange(r,cols.calc1,1,7).setBackground('#FFF3E0');
    sheet.getRange(r,8,1,6).setBackground('#E3F2FD');
    sheet.getRange(r,cols.calc2,1,7).setBackground('#E3F2FD');
    sheet.getRange(r,2).setDataValidation(rule);
    sheet.getRange(r,8).setDataValidation(rule);

    sheet.getRange(r,cols.calc1+0).setFormula('=SUM(C$'+(startRow+2)+':C'+r+')');
    sheet.getRange(r,cols.calc1+1).setFormula('=SUM(D$'+(startRow+2)+':D'+r+')');
    sheet.getRange(r,cols.calc1+2).setFormula('=E'+r+'+F'+r+'+G'+r);
    sheet.getRange(r,cols.calc1+3).setFormula('=IFERROR(C'+r+'/F'+r+',0)').setNumberFormat('0.00');
    sheet.getRange(r,cols.calc1+4).setFormula('=IFERROR((C'+r+'+D'+r+')/Q'+r+',0)').setNumberFormat('0.00');
    sheet.getRange(r,cols.calc1+5).setFormula('=IFERROR((Q'+r+'*'+wage+')/C'+r+',0)').setNumberFormat('$#,##0.00');
    sheet.getRange(r,cols.calc1+6).setFormula('=IFERROR((Q'+r+'*'+wage+')/D'+r+',0)').setNumberFormat('$#,##0.00');

    sheet.getRange(r,cols.calc2+0).setFormula('=SUM(I$'+(startRow+2)+':I'+r+')');
    sheet.getRange(r,cols.calc2+1).setFormula('=SUM(J$'+(startRow+2)+':J'+r+')');
    sheet.getRange(r,cols.calc2+2).setFormula('=K'+r+'+L'+r+'+M'+r);
    sheet.getRange(r,cols.calc2+3).setFormula('=IFERROR(I'+r+'/L'+r+',0)').setNumberFormat('0.00');
    sheet.getRange(r,cols.calc2+4).setFormula('=IFERROR((I'+r+'+J'+r+')/X'+r+',0)').setNumberFormat('0.00');
    sheet.getRange(r,cols.calc2+5).setFormula('=IFERROR((X'+r+'*'+wage+')/I'+r+',0)').setNumberFormat('$#,##0.00');
    sheet.getRange(r,cols.calc2+6).setFormula('=IFERROR((X'+r+'*'+wage+')/J'+r+',0)').setNumberFormat('$#,##0.00');
  });

  var summaryStart = startRow + slots.length + 3;
  var ratioRow = summaryStart;

  sheet.getRange(ratioRow,2,1,15)
    .setBackground('#FFFFFF').setFontWeight('bold').setFontColor('#000000')
    .setBorder(true,true,true,true,true,true);

  sheet.getRange(ratioRow,2).setValue('Avg Tops:Smalls 1');
  sheet.getRange(ratioRow,3).setFormula(
    '=IFERROR("1:" & ROUND(SUM(D'+(startRow+2)+':D'+(startRow+slots.length+1)+') / SUM(C'+(startRow+2)+':C'+(startRow+slots.length+1)+'),1),0)'
  );
  sheet.getRange(ratioRow,5).setValue('Daily Avg Cost/Top 1');
  sheet.getRange(ratioRow,6).setFormula(
    '=IFERROR(SUMPRODUCT(T'+(startRow+2)+':T'+(startRow+slots.length+1)+',C'+(startRow+2)+':C'+(startRow+slots.length+1)+') / SUM(C'+(startRow+2)+':C'+(startRow+slots.length+1)+'),0)'
  ).setNumberFormat('$#,##0.00');
  sheet.getRange(ratioRow,7).setValue('Daily Avg Cost/Small 1');
  sheet.getRange(ratioRow,8).setFormula(
    '=IFERROR(SUMPRODUCT(U'+(startRow+2)+':U'+(startRow+slots.length+1)+',D'+(startRow+2)+':D'+(startRow+slots.length+1)+') / SUM(D'+(startRow+2)+':D'+(startRow+slots.length+1)+'),0)'
  ).setNumberFormat('$#,##0.00');

  sheet.getRange(ratioRow,9).setValue('Avg Tops:Smalls 2');
  sheet.getRange(ratioRow,10).setFormula(
    '=IFERROR("1:" & ROUND(SUM(J'+(startRow+2)+':J'+(startRow+slots.length+1)+') / SUM(I'+(startRow+2)+':I'+(startRow+slots.length+1)+'),1),0)'
  );
  sheet.getRange(ratioRow,12).setValue('Daily Avg Cost/Top 2');
  sheet.getRange(ratioRow,13).setFormula(
    '=IFERROR(SUMPRODUCT(AA'+(startRow+2)+':AA'+(startRow+slots.length+1)+',I'+(startRow+2)+':I'+(startRow+slots.length+1)+') / SUM(I'+(startRow+2)+':I'+(startRow+slots.length+1)+'),0)'
  ).setNumberFormat('$#,##0.00');
  sheet.getRange(ratioRow,14).setValue('Daily Avg Cost/Small 2');
  sheet.getRange(ratioRow,15).setFormula(
    '=IFERROR(SUMPRODUCT(AB'+(startRow+2)+':AB'+(startRow+slots.length+1)+',J'+(startRow+2)+':J'+(startRow+slots.length+1)+') / SUM(J'+(startRow+2)+':J'+(startRow+slots.length+1)+'),0)'
  ).setNumberFormat('$#,##0.00');

  var perfStart = ratioRow + 2;
  sheet.getRange(perfStart,2).setValue('Performance Averages')
    .setFontWeight('bold').setBackground('#FFF9C4')
    .setHorizontalAlignment('center').setBorder(true,true,true,true,true,true);
  sheet.getRange(perfStart,8).setValue('Performance Averages')
    .setFontWeight('bold').setBackground('#FFF9C4')
    .setHorizontalAlignment('center').setBorder(true,true,true,true,true,true);

  var metrics = [
    ['Avg Tops/Trimmer per Hr'],
    ['Avg Units/Op per Hr'],
    ['Avg Tops/Trimmer (Day)'],
    ['Avg Units/Op (Day)']
  ];
  sheet.getRange(perfStart+1,3,metrics.length,1).setValues(metrics)
    .setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange(perfStart+1,9,metrics.length,1).setValues(metrics)
    .setFontWeight('bold').setHorizontalAlignment('right');
  sheet.getRange(perfStart,2,metrics.length+1,12)
    .setBackground('#FFFDE7').setBorder(true,true,true,true,true,true);

  sheet.getRange(perfStart+1,4).setFormula(
    '=IFERROR(ROUND(SUM(C'+(startRow+2)+':C'+(startRow+slots.length+1)+')/SUM(F'+(startRow+2)+':F'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+2,4).setFormula(
    '=IFERROR(ROUND(SUM(C'+(startRow+2)+':D'+(startRow+slots.length+1)+')/SUM(Q'+(startRow+2)+':Q'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+3,4).setFormula(
    '=IFERROR(ROUND(SUM(C'+(startRow+2)+':C'+(startRow+slots.length+1)+')/COUNTUNIQUE(A'+(startRow+2)+':A'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+4,4).setFormula(
    '=IFERROR(ROUND(SUM(C'+(startRow+2)+':D'+(startRow+slots.length+1)+')/COUNTUNIQUE(A'+(startRow+2)+':A'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');

  sheet.getRange(perfStart+1,10).setFormula(
    '=IFERROR(ROUND(SUM(I'+(startRow+2)+':I'+(startRow+slots.length+1)+')/SUM(L'+(startRow+2)+':L'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+2,10).setFormula(
    '=IFERROR(ROUND(SUM(I'+(startRow+2)+':J'+(startRow+slots.length+1)+')/SUM(X'+(startRow+2)+':X'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+3,10).setFormula(
    '=IFERROR(ROUND(SUM(I'+(startRow+2)+':I'+(startRow+slots.length+1)+')/COUNTUNIQUE(A'+(startRow+2)+':A'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');
  sheet.getRange(perfStart+4,10).setFormula(
    '=IFERROR(ROUND(SUM(I'+(startRow+2)+':J'+(startRow+slots.length+1)+')/COUNTUNIQUE(A'+(startRow+2)+':A'+(startRow+slots.length+1)+'),2),0)'
  ).setNumberFormat('0.00');

  SpreadsheetApp.flush();
}

function setupMonthlySheet(sheet) {
  sheet.getRange(1,1).setValue(sheet.getName()).setFontWeight('bold').setFontSize(14);
  sheet.setFrozenRows(3);
}

function generateMasterSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var monthSheets = ss.getSheets().filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a,b) { return a.getName().localeCompare(b.getName()); });
  var master = ss.getSheetByName('Master');
  if(master) ss.deleteSheet(master);
  master = ss.insertSheet('Master');
  var row = 1;
  monthSheets.forEach(function(sh) {
    var vals = sh.getDataRange().getValues();
    var block = row===1 ? vals : vals.slice(1);
    if(block.length && block[0].length){
      master.getRange(row,1,block.length,block[0].length).setValues(block);
      row += block.length;
    }
  });
  if(row>1) master.setFrozenRows(1);
  ss.toast('Master rebuilt','Status');
}

/**********************************************************
 * Lead Time Estimator (Calculations Only)
 **********************************************************/
function showLeadTimeEstimator() {
  var html = HtmlService.createHtmlOutputFromFile('LeadTimeEstimatorSidebar')
    .setTitle('Lead Time Estimator')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

function addWorkHours(start, hoursToAdd, workStartHour, workEndHour, daysOff) {
  daysOff = daysOff || [0];
  var result = new Date(start);
  if (hoursToAdd <= 0) return result;

  var remaining = hoursToAdd * 60;

  var breaks = [
    [9.0, 9.1667], [12.0, 12.5], [14.5, 14.6667], [16.3333, 16.5]
  ].map(function(b) { return [Math.round(b[0] * 60), Math.round(b[1] * 60)]; });

  var workStartMinutes = Math.round(workStartHour * 60);
  var baseWorkEndMinutes = Math.round(workEndHour * 60);

  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function setMinutesSinceMidnight(date, minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    date.setHours(h, m, 0, 0);
  }

  while (remaining > 0) {
    var day = result.getDay();

    if (daysOff.indexOf(day) !== -1) {
      result.setDate(result.getDate() + 1);
      setMinutesSinceMidnight(result, workStartMinutes);
      continue;
    }

    var isSaturday = (day === 6);
    var todayWorkEndMinutes = isSaturday ? Math.round(12 * 60) : baseWorkEndMinutes;

    var now = minutesSinceMidnight(result);

    if (now < workStartMinutes) {
      setMinutesSinceMidnight(result, workStartMinutes);
      now = workStartMinutes;
    }

    if (now >= todayWorkEndMinutes) {
      result.setDate(result.getDate() + 1);
      setMinutesSinceMidnight(result, workStartMinutes);
      continue;
    }

    var currentBreak = null;
    for (var i = 0; i < breaks.length; i++) {
      if (now >= breaks[i][0] && now < breaks[i][1] && breaks[i][0] < todayWorkEndMinutes) {
        currentBreak = breaks[i];
        break;
      }
    }
    
    if (currentBreak) {
      var bEnd = currentBreak[1];
      if (bEnd >= todayWorkEndMinutes) {
        result.setDate(result.getDate() + 1);
        setMinutesSinceMidnight(result, workStartMinutes);
      } else {
        setMinutesSinceMidnight(result, bEnd);
      }
      continue;
    }

    var nextBreak = null;
    for (var j = 0; j < breaks.length; j++) {
      if (breaks[j][0] > now && breaks[j][0] < todayWorkEndMinutes) {
        nextBreak = breaks[j];
        break;
      }
    }
    var nextBreakStart = nextBreak ? nextBreak[0] : null;

    var availableUntil = nextBreakStart !== null
      ? Math.min(nextBreakStart, todayWorkEndMinutes)
      : todayWorkEndMinutes;

    var available = availableUntil - now;

    if (available <= 0) {
      result.setDate(result.getDate() + 1);
      setMinutesSinceMidnight(result, workStartMinutes);
      continue;
    }

    if (remaining <= available) {
      var finishMinutes = now + remaining;
      setMinutesSinceMidnight(result, finishMinutes);
      remaining = 0;
      break;
    }

    remaining -= available;
    now = availableUntil;

    if (nextBreak && now === nextBreakStart) {
      var bEnd2 = nextBreak[1];
      if (bEnd2 >= todayWorkEndMinutes) {
        result.setDate(result.getDate() + 1);
        setMinutesSinceMidnight(result, workStartMinutes);
      } else {
        setMinutesSinceMidnight(result, bEnd2);
      }
    } else {
      result.setDate(result.getDate() + 1);
      setMinutesSinceMidnight(result, workStartMinutes);
    }
  }

  return result;
}

function calculateLeadTimeEstimator(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone();

  var monthSheets = ss.getSheets()
    .filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });

  if (!monthSheets.length) {
    throw new Error('No monthly production sheets found (YYYY-MM).');
  }

  var latest = monthSheets[0];
  var vals = latest.getDataRange().getValues();

  var headerRowIndex = vals.findIndex(function(r) { return r.indexOf('Cultivar 1') !== -1; });
  if (headerRowIndex === -1) {
    throw new Error('No valid header row found');
  }
  var headers = vals[headerRowIndex];

  var cCultivar1 = headers.indexOf('Cultivar 1');
  var cTops1 = headers.indexOf('Tops 1');
  var cTrimmers1 = headers.indexOf('Trimmers 1');
  var cCultivar2 = headers.indexOf('Cultivar 2');
  var cTops2 = headers.indexOf('Tops 2');
  var cTrimmers2 = headers.indexOf('Trimmers 2');

  var crew = parseInt(formData.crew, 10) || 6;
  var workHours = parseFloat(formData.workHours) || 8.5;
  var itemsIn = Array.isArray(formData.items) ? formData.items : [];

  if (!itemsIn.length) {
    throw new Error('No items were provided.');
  }

  var start = formData.startDate ? new Date(formData.startDate) : new Date();
  if (isNaN(start.getTime())) start = new Date();

  function toLbs(qty, unit) {
    var n = parseFloat(qty) || 0;
    if (unit === 'kg') return n * 2.20462;
    return n;
  }

  var dataRows = vals.slice(headerRowIndex + 1);

  var outItems = [];
  var totalQuantityLbs = 0;
  var totalWorkHours = 0;

  itemsIn.forEach(function(item) {
    var cultivar = item.cultivar || '';
    var unit = item.unit || 'lb';
    var qtyEntered = item.quantity || 0;
    var qtyLbs = toLbs(qtyEntered, unit);

    var totalRate = 0;
    var count = 0;

    dataRows.forEach(function(r) {
      var cv1 = r[cCultivar1];
      var cv2 = r[cCultivar2];
      var tops1 = parseFloat(r[cTops1]) || 0;
      var tops2 = parseFloat(r[cTops2]) || 0;
      var trim1 = parseFloat(r[cTrimmers1]) || 0;
      var trim2 = parseFloat(r[cTrimmers2]) || 0;

      if (cultivar && cv1 && cv1.toString().indexOf(cultivar) !== -1 && trim1 > 0) {
        totalRate += tops1 / trim1;
        count++;
      }
      if (cultivar && cv2 && cv2.toString().indexOf(cultivar) !== -1 && trim2 > 0) {
        totalRate += tops2 / trim2;
        count++;
      }
    });

    var avgRate = count > 0 ? totalRate / count : 0;
    var dailyOutput = avgRate * crew * workHours;
    var daysNeeded = dailyOutput > 0 ? qtyLbs / dailyOutput : 0;
    var hoursNeeded = daysNeeded * workHours;

    totalQuantityLbs += qtyLbs;
    totalWorkHours += hoursNeeded;

    outItems.push({
      cultivar: cultivar,
      quantityEntered: qtyEntered,
      unit: unit,
      quantityLbs: Number(qtyLbs.toFixed(2)),
      avgRate: Number(avgRate.toFixed(2)),
      dailyOutput: Number(dailyOutput.toFixed(2)),
      daysNeeded: Number(daysNeeded.toFixed(2))
    });
  });

  var totalDaysNeeded = workHours > 0 ? totalWorkHours / workHours : 0;
  var finish = addWorkHours(start, totalWorkHours, 7.0, 16.5);

  return {
    start: Utilities.formatDate(start, timezone, 'EEEE, MMMM d, yyyy @ h:mm a'),
    finish: Utilities.formatDate(finish, timezone, 'EEEE, MMMM d, yyyy @ h:mm a'),
    totalDaysNeeded: Number(totalDaysNeeded.toFixed(2)),
    totalWorkHours: Number(totalWorkHours.toFixed(2)),
    totalQuantityLbs: Number(totalQuantityLbs.toFixed(2)),
    items: outItems
  };
}

function getCultivarList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allCultivars = [];

  var dataSheet = ss.getSheetByName('Data');
  if (dataSheet) {
    var dataCultivars = dataSheet.getRange('A3:A40').getValues().flat().filter(String);
    dataCultivars.forEach(function(c) { 
      if (allCultivars.indexOf(c.trim()) === -1) allCultivars.push(c.trim()); 
    });
  }

  var monthSheets = ss.getSheets()
    .filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });
  var latest = monthSheets[0];

  if (latest) {
    var vals = latest.getDataRange().getValues();
    var headerRowIndex = vals.findIndex(function(r) { return r.indexOf('Cultivar 1') !== -1; });
    if (headerRowIndex !== -1) {
      var headers = vals[headerRowIndex];
      var cCultivar1 = headers.indexOf('Cultivar 1');
      var cCultivar2 = headers.indexOf('Cultivar 2');
      vals.slice(headerRowIndex + 1).forEach(function(r) {
        var cv1 = r[cCultivar1];
        var cv2 = r[cCultivar2];
        if (cv1 && typeof cv1 === 'string' && allCultivars.indexOf(cv1.trim()) === -1) 
          allCultivars.push(cv1.trim());
        if (cv2 && typeof cv2 === 'string' && allCultivars.indexOf(cv2.trim()) === -1) 
          allCultivars.push(cv2.trim());
      });
    }
  }

  return allCultivars.sort();
}

/**********************************************************
 * Crew Change Tool
 **********************************************************/
function showCrewChangeSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('CrewChangeSidebar')
    .setTitle('Crew Change')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

var HRXR_COL_TIME_SLOT = 1;
var HRXR_COL_BUCKERS_1 = 5;
var HRXR_COL_TRIMMERS_1 = 6;
var HRXR_COL_BUCKERS_2 = 11;
var HRXR_COL_TRIMMERS_2 = 12;

function assertMonthSheet_(sheetName) {
  if (!/^\d{4}-\d{2}$/.test(sheetName)) {
    throw new Error('Go to a YYYY-MM production sheet first.');
  }
}

function isValidHrxrDataRow_(sheet, row) {
  var timeSlotValue = sheet.getRange(row, HRXR_COL_TIME_SLOT).getValue();
  if (!timeSlotValue) return false;
  var str = String(timeSlotValue);
  if (str.indexOf('–') !== -1 || str.indexOf('AM') !== -1 || str.indexOf('PM') !== -1) {
    return true;
  }
  if (str.indexOf('Date:') !== -1 || str.indexOf('Performance') !== -1 || 
      str.indexOf('Time Slot') !== -1 || str.indexOf('Avg ') !== -1 ||
      str.indexOf('Daily Avg') !== -1) {
    return false;
  }
  return true;
}

function getActiveHrxrContext_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  assertMonthSheet_(sh.getName());
  var row = sh.getActiveCell().getRow();
  if (!isValidHrxrDataRow_(sh, row)) {
    throw new Error('Please select a time slot row (not header or summary)');
  }
  return {
    sheetName: sh.getName(),
    row: row,
    timeSlot: String(sh.getRange(row, HRXR_COL_TIME_SLOT).getValue() || '')
  };
}

function readCrewFromRow_(ctx) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ctx.sheetName);
  var b1 = Number(sh.getRange(ctx.row, HRXR_COL_BUCKERS_1).getValue()) || 0;
  var b2 = Number(sh.getRange(ctx.row, HRXR_COL_BUCKERS_2).getValue()) || 0;
  var t1 = Number(sh.getRange(ctx.row, HRXR_COL_TRIMMERS_1).getValue()) || 0;
  var t2 = Number(sh.getRange(ctx.row, HRXR_COL_TRIMMERS_2).getValue()) || 0;
  return { b1: b1, b2: b2, bTotal: b1 + b2, tr1: t1, tr2: t2, trTotal: t1 + t2 };
}

function setCrewCounts(buckers1, buckers2, trimmers1, trimmers2) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(5000);
  try {
    var ctx = getActiveHrxrContext_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(ctx.sheetName);
    var timezone = ss.getSpreadsheetTimeZone();
    var b1 = Number(buckers1);
    var b2 = Number(buckers2);
    var t1 = Number(trimmers1);
    var t2 = Number(trimmers2);
    if ([b1,b2,t1,t2].some(function(v) { return !isFinite(v) || v < 0; })) {
      throw new Error('Crew counts must be numbers >= 0');
    }
    var before = readCrewFromRow_(ctx);
    var timestamp = Utilities.formatDate(new Date(), timezone, 'h:mm a');
    function addChangeNote(colNum, oldVal, newVal) {
      if (oldVal === newVal) return;
      var cell = sh.getRange(ctx.row, colNum);
      var existingNote = cell.getNote() || '';
      var changeLog = timestamp + ': ' + oldVal + ' → ' + newVal;
      var newNote = existingNote ? changeLog + '\n' + existingNote : changeLog;
      cell.setNote(newNote);
    }
    sh.getRange(ctx.row, HRXR_COL_BUCKERS_1).setValue(b1);
    addChangeNote(HRXR_COL_BUCKERS_1, before.b1, b1);
    sh.getRange(ctx.row, HRXR_COL_BUCKERS_2).setValue(b2);
    addChangeNote(HRXR_COL_BUCKERS_2, before.b2, b2);
    sh.getRange(ctx.row, HRXR_COL_TRIMMERS_1).setValue(t1);
    addChangeNote(HRXR_COL_TRIMMERS_1, before.tr1, t1);
    sh.getRange(ctx.row, HRXR_COL_TRIMMERS_2).setValue(t2);
    addChangeNote(HRXR_COL_TRIMMERS_2, before.tr2, t2);
    var after = { b1: b1, b2: b2, bTotal: b1 + b2, tr1: t1, tr2: t2, trTotal: t1 + t2 };
    getCrewChangeLog_().appendRow([
      new Date(), Session.getActiveUser().getEmail() || 'unknown',
      ctx.sheetName, ctx.row, ctx.timeSlot,
      before.bTotal + ' → ' + after.bTotal, before.trTotal + ' → ' + after.trTotal
    ]);
    return { ok: true, before: before, after: after, ctx: ctx };
  } finally {
    lock.releaseLock();
  }
}

function getCrewSnapshotForActiveRow() {
  var ctx = getActiveHrxrContext_();
  var crew = readCrewFromRow_(ctx);
  return { ok: true, ctx: ctx, current: crew };
}

function getCrewChangeLog_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('CrewChangeLog');
  if (!sh) sh = ss.insertSheet('CrewChangeLog');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'User', 'Month Sheet', 'Hr×Hr Row', 'Time Slot', 'Buckers Change', 'Trimmers Change']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#004d40').setFontColor('white');
  }
  return sh;
}

function getUiLocale() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var locale = (ss.getSpreadsheetLocale() || '').toLowerCase();
  var isSpanish = locale.indexOf('es') === 0;
  return { ok: true, locale: locale, isSpanish: isSpanish };
}

function showThroughputTimer() {
  var html = HtmlService.createHtmlOutputFromFile('ThroughputTimerSidebar')
    .setTitle('Throughput Timer')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

function jumpToNewestHrHr_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (!/^\d{4}-\d{2}/.test(name)) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 5) return;
  var maxCols = Math.min(sheet.getLastColumn(), 30);
  var values = sheet.getRange(1, 1, lastRow, maxCols).getValues();
  var dateBlocks = [];
  for (var r = 0; r < values.length; r++) {
    if (values[r][0] === 'Date:') {
      dateBlocks.push({ dateRowIndex: r + 1, dateValue: values[r][1], headerRowIndex: r + 2 });
    }
  }
  if (dateBlocks.length === 0) return;
  var lastBlock = dateBlocks[dateBlocks.length - 1];
  var headerRowIndex = lastBlock.headerRowIndex;
  var timeCol = -1;
  var headerRow = values[headerRowIndex - 1] || [];
  for (var c = 0; c < headerRow.length; c++) {
    var v = String(headerRow[c] || '').trim().toLowerCase();
    if (v === 'time slot' || v === 'timeslot') { timeCol = c + 1; break; }
  }
  if (timeCol < 0) return;
  var dataStart = headerRowIndex + 1;
  var lastFilledRow = dataStart;
  for (var r2 = dataStart - 1; r2 < values.length; r2++) {
    var timeSlotValue = String(values[r2][0] || '').trim();
    if (timeSlotValue === 'Date:' || timeSlotValue.indexOf('Performance Averages') !== -1 ||
        timeSlotValue.indexOf('Avg Tops:Smalls') !== -1) { break; }
    if (timeSlotValue && (timeSlotValue.indexOf('AM') !== -1 || timeSlotValue.indexOf('PM') !== -1 ||
        timeSlotValue.indexOf('–') !== -1)) { lastFilledRow = r2 + 1; }
  }
  var targetRange = sheet.getRange(lastFilledRow, 1);
  sheet.setActiveSelection(targetRange);
  SpreadsheetApp.setActiveRange(targetRange);
  SpreadsheetApp.getActive().toast('Jumped to ' + (values[lastFilledRow - 1][0] || 'latest row'), 'Navigation', 2);
}

/**********************************************************
 * Test Functions
 **********************************************************/
function testScoreboardAPI() {
  var result = getScoreboardWithTimerData();
  Logger.log('Scoreboard Data: ' + JSON.stringify(result.scoreboard, null, 2));
  Logger.log('Timer Data: ' + JSON.stringify(result.timer, null, 2));
  Logger.log('Cycle History Count: ' + (result.timer.cycleHistory ? result.timer.cycleHistory.length : 0));
  return result;
}


/**********************************************************
 * AI AGENT FUNCTIONS
 * Provides conversational AI interface for production queries
 **********************************************************/

/**
 * Main chat request handler
 */
function handleChatRequest(data) {
  try {
    var userMessage = data.message || '';
    var history = data.history || [];
    
    if (!userMessage) {
      return { success: false, error: 'No message provided' };
    }
    
    // Gather current production context
    var context = gatherProductionContext();
    
    // Build the AI prompt
    var systemPrompt = buildSystemPrompt(context);
    
    // Call Anthropic API
    var aiResponse = callAnthropicForChat(systemPrompt, history, userMessage);
    
    return { 
      success: true, 
      response: aiResponse,
      context: context
    };
  } catch (error) {
    Logger.log('Chat error: ' + error.message);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Gathers all relevant production data for AI context
 */
function gatherProductionContext() {
  var context = {
    timestamp: new Date().toISOString(),
    production: {},
    bags: {},
    crew: {},
    rates: {}
  };
  
  try {
    // Get scoreboard data (uses existing function)
    var scoreboardData = getScoreboardData();
    
    if (scoreboardData) {
      context.production = {
        topsToday: scoreboardData.todayLbs || 0,
        strain: scoreboardData.strain || 'Unknown',
        lastHourLbs: scoreboardData.lastHourLbs || 0,
        lastTimeSlot: scoreboardData.lastTimeSlot || '',
        hoursLogged: scoreboardData.hoursLogged || 0,
        todayPercentage: scoreboardData.todayPercentage || 0
      };
      
      context.crew = {
        currentTrimmers: scoreboardData.currentHourTrimmers || 0,
        lastHourTrimmers: scoreboardData.lastHourTrimmers || 0
      };
      
      context.rates = {
        targetRate: scoreboardData.targetRate || 1.0,
        strainTargetRate: scoreboardData.strainTargetRate || 0,
        usingStrainRate: scoreboardData.usingStrainRate || false,
        vsYesterday: scoreboardData.vsYesterday,
        vs7Day: scoreboardData.vs7Day
      };
    }
    
    // Get bag timer data (uses existing function)
    var timerData = getBagTimerData();
    
    if (timerData) {
      context.bags = {
        fiveKgToday: timerData.bags5kgToday || 0,
        tenLbToday: timerData.bags10lbToday || 0,
        totalToday: timerData.bagsToday || 0,
        avgCycleSeconds: timerData.avgSecondsToday || 0,
        lastBagTime: timerData.lastBagTime || null,
        secondsSinceLastBag: timerData.secondsSinceLastBag || 0
      };
    }
    
  } catch (error) {
    Logger.log('Error gathering context: ' + error.message);
  }

  // Get orders summary for AI context
  try {
    var ordersSummary = getOrdersSummary();
    if (ordersSummary) {
      context.orders = ordersSummary;
    }
  } catch (error) {
    Logger.log('Error getting orders summary: ' + error.message);
  }

  return context;
}

/**
 * Builds the system prompt with current production data
 */
function buildSystemPrompt(context) {
  var now = new Date();
  var currentTime = Utilities.formatDate(now, 'America/Los_Angeles', 'EEEE, h:mm a');
  
  // Calculate derived metrics
  var totalBagsToday = context.bags.totalToday || 0;
  var crewTotal = context.crew.currentTrimmers || context.crew.lastHourTrimmers || 0;
  var avgCycleMinutes = context.bags.avgCycleSeconds ? Math.round(context.bags.avgCycleSeconds / 60) : 0;
  var minutesSinceLastBag = context.bags.secondsSinceLastBag ? Math.round(context.bags.secondsSinceLastBag / 60) : 0;
  
  return 'You are the Rogue Origin AI Assistant, helping manage a hemp processing facility in Southern Oregon.\n\n' +
    'CURRENT TIME: ' + currentTime + '\n\n' +
    
    'TODAY\'S PRODUCTION:\n' +
    '- Tops produced: ' + (context.production.topsToday || 0) + ' lbs\n' +
    '- Last hour: ' + (context.production.lastHourLbs || 0) + ' lbs (' + (context.production.lastTimeSlot || 'N/A') + ')\n' +
    '- Hours logged: ' + (context.production.hoursLogged || 0) + '\n' +
    '- Current strain: ' + (context.production.strain || 'Unknown') + '\n' +
    '- Performance vs target: ' + Math.round(context.production.todayPercentage || 0) + '%\n\n' +
    
    'CREW STATUS:\n' +
    '- Current trimmers: ' + crewTotal + '\n\n' +
    
    'BAG COMPLETIONS TODAY:\n' +
    '- 5kg bags: ' + (context.bags.fiveKgToday || 0) + '\n' +
    '- 10lb tops bags: ' + (context.bags.tenLbToday || 0) + '\n' +
    '- Total bags: ' + totalBagsToday + '\n' +
    '- Avg cycle time: ' + (avgCycleMinutes || 'N/A') + ' minutes\n' +
    '- Minutes since last bag: ' + (minutesSinceLastBag || 'N/A') + '\n\n' +
    
    'PRODUCTION RATE:\n' +
    '- Target rate: ' + (context.rates.targetRate || 1.0).toFixed(2) + ' lbs/person/hour\n' +
    '- vs Yesterday: ' + formatComparison(context.rates.vsYesterday) + '\n' +
    '- vs 7-day avg: ' + formatComparison(context.rates.vs7Day) + '\n\n' +

    buildOrdersPromptSection(context.orders) + '\n\n' +

    'RESPONSE GUIDELINES:\n' +
    '1. Be concise and friendly - the boss reads this on his phone\n' +
    '2. Lead with the most important number or insight\n' +
    '3. Use simple comparisons ("ahead of yesterday", "on track")\n' +
    '4. If you don\'t have data for something, say so honestly\n' +
    '5. Use emojis sparingly for visual scanning (📊 📦 👥 ⚡)\n\n' +
    
    'For data display, use this HTML format:\n' +
    '<div class="data-card">\n' +
    '  <h4>Title</h4>\n' +
    '  <div class="metric"><span class="metric-label">Label</span><span class="metric-value">Value</span></div>\n' +
    '</div>';
}

/**
 * Formats comparison values for display
 */
function formatComparison(value) {
  if (value === null || value === undefined) return 'N/A';
  var num = parseFloat(value);
  if (isNaN(num)) return 'N/A';
  if (num > 0) return '+' + num.toFixed(1) + '%';
  return num.toFixed(1) + '%';
}

/**
 * Builds the orders section for AI system prompt
 */
function buildOrdersPromptSection(ordersData) {
  if (!ordersData || !ordersData.orders || ordersData.orders.length === 0) {
    return 'ACTIVE ORDERS:\n- No active orders currently';
  }

  var section = 'ACTIVE ORDERS (' + ordersData.activeOrders + ' orders):\n' +
    '- Total pending: ' + ordersData.pendingKg + ' kg\n' +
    '- In progress: ' + ordersData.inProgressKg + ' kg remaining\n' +
    '- Ready to ship: ' + ordersData.readyToShipKg + ' kg\n\n' +
    'Order Details:';

  for (var i = 0; i < ordersData.orders.length; i++) {
    var order = ordersData.orders[i];
    var remaining = order.totalKg - order.completedKg;
    section += '\n  ' + order.customer + ' (' + order.id + '):\n' +
      '    - ' + order.totalKg + ' kg total, ' + order.completedKg + ' kg done (' + order.percentComplete + '%)\n' +
      '    - ' + remaining + ' kg remaining\n' +
      '    - Status: ' + order.status + '\n' +
      '    - Due: ' + (order.dueDate || 'Not set');
  }

  // Add estimation help
  section += '\n\nORDER ESTIMATION FORMULAS:\n' +
    '- 1 kg = 2.205 lbs\n' +
    '- 5kg bag = 11.02 lbs\n' +
    '- Hours needed = remaining_lbs / (trimmers × rate)\n' +
    '- Days needed = hours / 7.5 effective hours per day\n' +
    '- When estimating ETAs, exclude weekends';

  return section;
}

/**
 * Calls Anthropic API for chat response
 */
function callAnthropicForChat(systemPrompt, history, userMessage) {
  // Get API key from Script Properties
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Go to File > Project Settings > Script Properties and add ANTHROPIC_API_KEY');
  }
  
  // Build messages array
  var messages = [];
  
  // Add conversation history (last 10 messages max)
  if (history && history.length > 0) {
    var recentHistory = history.slice(-10);
    for (var i = 0; i < recentHistory.length; i++) {
      messages.push({
        role: recentHistory[i].role,
        content: recentHistory[i].content
      });
    }
  }
  
  // Add current user message
  messages.push({
    role: 'user',
    content: userMessage
  });
  
  // Call Anthropic API
  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    }),
    muteHttpExceptions: true
  });
  
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText();
  
  if (responseCode !== 200) {
    Logger.log('Anthropic API error: ' + responseBody);
    throw new Error('AI service error (code ' + responseCode + ')');
  }
  
  var result = JSON.parse(responseBody);
  
  if (result.content && result.content.length > 0) {
    return result.content[0].text;
  }
  
  throw new Error('Empty response from AI');
}

/**
 * Test function - run this to verify AI agent works
 */
function testAIAgent() {
  var testResult = handleChatRequest({
    message: 'How are we doing today?',
    history: []
  });
  
  Logger.log('=== AI Agent Test ===');
  Logger.log('Success: ' + testResult.success);
  if (testResult.success) {
    Logger.log('Response: ' + testResult.response);
    Logger.log('Context: ' + JSON.stringify(testResult.context, null, 2));
  } else {
    Logger.log('Error: ' + testResult.error);
  }
  
  return testResult;
}

/**
 * Test function - verify context gathering works
 */
function testGatherContext() {
  var context = gatherProductionContext();
  Logger.log('=== Production Context Test ===');
  Logger.log(JSON.stringify(context, null, 2));
  return context;
}

/**********************************************************
 * ORDERS MANAGEMENT
 * Wholesale order tracking for customers
 **********************************************************/

var ORDERS_SHEET_NAME = 'Orders';

/**
 * Get all orders
 */
function getOrders() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = createOrdersSheet_(ss);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, orders: [] };
    }

    var orders = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue; // Skip empty rows

      var order = {
        id: row[0],
        customer: row[1],
        totalKg: parseFloat(row[2]) || 0,
        completedKg: parseFloat(row[3]) || 0,
        status: row[4] || 'pending',
        createdDate: formatDateForJSON_(row[5]),
        dueDate: formatDateForJSON_(row[6]),
        notes: row[7] || '',
        pallets: []
      };

      // Parse pallets JSON
      try {
        order.pallets = JSON.parse(row[8] || '[]');
      } catch (e) {
        order.pallets = [];
      }

      orders.push(order);
    }

    return { success: true, orders: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a single order by ID
 */
function getOrder(orderId) {
  try {
    var result = getOrders();
    if (!result.success) return result;

    var order = null;
    for (var i = 0; i < result.orders.length; i++) {
      if (result.orders[i].id === orderId) {
        order = result.orders[i];
        break;
      }
    }

    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    return { success: true, order: order };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save (create or update) an order
 */
function saveOrder(orderData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = createOrdersSheet_(ss);
    }

    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;

    // Find existing row
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderData.id) {
        rowIndex = i + 1; // 1-indexed for Sheets
        break;
      }
    }

    // Prepare row data
    var rowData = [
      orderData.id,
      orderData.customer,
      orderData.totalKg,
      orderData.completedKg || 0,
      orderData.status || 'pending',
      orderData.createdDate || new Date().toISOString().split('T')[0],
      orderData.dueDate || '',
      orderData.notes || '',
      JSON.stringify(orderData.pallets || [])
    ];

    if (rowIndex > 0) {
      // Update existing row
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Append new row
      sheet.appendRow(rowData);
    }

    return { success: true, order: orderData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete an order
 */
function deleteOrder(orderId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    if (!sheet) {
      return { success: false, error: 'Orders sheet not found' };
    }

    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: 'Order not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Create the Orders sheet with headers
 */
function createOrdersSheet_(ss) {
  var sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  var headers = [
    'OrderID',
    'Customer',
    'TotalKg',
    'CompletedKg',
    'Status',
    'CreatedDate',
    'DueDate',
    'Notes',
    'Pallets'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 100);  // OrderID
  sheet.setColumnWidth(2, 150);  // Customer
  sheet.setColumnWidth(3, 80);   // TotalKg
  sheet.setColumnWidth(4, 100);  // CompletedKg
  sheet.setColumnWidth(5, 100);  // Status
  sheet.setColumnWidth(6, 100);  // CreatedDate
  sheet.setColumnWidth(7, 100);  // DueDate
  sheet.setColumnWidth(8, 200);  // Notes
  sheet.setColumnWidth(9, 400);  // Pallets (JSON)

  return sheet;
}

/**
 * Helper to format dates for JSON
 */
function formatDateForJSON_(date) {
  if (!date) return '';
  if (date instanceof Date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(date);
}

/**
 * Get orders summary for AI context
 */
function getOrdersSummary() {
  try {
    var result = getOrders();
    if (!result.success || !result.orders.length) {
      return null;
    }

    var orders = result.orders;
    var active = [];
    var processing = [];
    var totalPendingKg = 0;
    var totalInProgressKg = 0;
    var totalReadyKg = 0;

    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (o.status !== 'completed' && o.status !== 'shipped') {
        active.push(o);
      }
      if (o.status === 'processing') {
        processing.push(o);
        totalInProgressKg += (o.totalKg - o.completedKg);
      }
      if (o.status === 'pending') {
        totalPendingKg += o.totalKg;
      }
      if (o.status === 'ready') {
        totalReadyKg += o.totalKg;
      }
    }

    return {
      totalOrders: orders.length,
      activeOrders: active.length,
      processingOrders: processing.length,
      pendingKg: totalPendingKg,
      inProgressKg: totalInProgressKg,
      readyToShipKg: totalReadyKg,
      orders: active.map(function(o) {
        return {
          id: o.id,
          customer: o.customer,
          totalKg: o.totalKg,
          completedKg: o.completedKg,
          percentComplete: Math.round((o.completedKg / o.totalKg) * 100),
          status: o.status,
          dueDate: o.dueDate
        };
      })
    };
  } catch (error) {
    Logger.log('Error getting orders summary: ' + error);
    return null;
  }
}

/**
 * Test orders API
 */
function testOrdersAPI() {
  Logger.log('=== Testing Orders API ===');

  // Test getOrders
  var orders = getOrders();
  Logger.log('getOrders: ' + JSON.stringify(orders, null, 2));

  // Test getOrdersSummary
  var summary = getOrdersSummary();
  Logger.log('getOrdersSummary: ' + JSON.stringify(summary, null, 2));
}
