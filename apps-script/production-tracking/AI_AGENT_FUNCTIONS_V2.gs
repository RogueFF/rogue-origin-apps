/**********************************************************
 * ENHANCED AI AGENT FUNCTIONS V2 - Complete Data Access
 *
 * NEW IN V2:
 * - Crew change history (when/why crew changed)
 * - Hourly breakdown (trimmers, tops, smalls per hour)
 * - Line 1 vs Line 2 breakdown
 * - Buckers data
 * - Pause/break data
 * - Quality metrics (tops vs smalls ratio)
 * - Individual hour performance analysis
 **********************************************************/

/**
 * Main chat request handler
 */
function handleChatRequest(data) {
  try {
    var userMessage = data.message || '';
    var history = data.history || [];
    var feedback = data.feedback || null;

    if (feedback) {
      return logChatFeedback(feedback);
    }

    if (!userMessage) {
      return { success: false, error: 'No message provided' };
    }

    // Gather ALL production context including new data sources
    var context = gatherProductionContext();

    // Extract corrections from conversation history
    var corrections = extractCorrections(history);

    // Build enhanced system prompt with all data
    var systemPrompt = buildSystemPrompt(context, corrections);

    // Call Anthropic API
    var aiResponse = callAnthropicForChat(systemPrompt, history, userMessage);

    // Log for training
    logChatForTraining(userMessage, aiResponse, history.length);

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
 * ENHANCED: Gathers ALL relevant production data
 */
function gatherProductionContext() {
  var context = {
    timestamp: new Date().toISOString(),
    production: {},
    bags: {},
    crew: {},
    rates: {},
    history: {},
    // NEW V2 data
    hourlyBreakdown: [],      // Hour-by-hour detail
    crewChanges: [],          // Crew change history
    pauseHistory: [],         // Break/pause data
    lineBreakdown: {},        // Line 1 vs Line 2
    qualityMetrics: {}        // Tops vs smalls analysis
  };

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var timezone = ss.getSpreadsheetTimeZone();

    // Get scoreboard data (existing)
    var scoreboardData = getScoreboardData();

    if (scoreboardData) {
      context.production = {
        topsToday: scoreboardData.todayLbs || 0,
        strain: scoreboardData.strain || 'Unknown',
        lastHourLbs: scoreboardData.lastHourLbs || 0,
        lastTimeSlot: scoreboardData.lastTimeSlot || '',
        hoursLogged: scoreboardData.hoursLogged || 0,
        todayPercentage: scoreboardData.todayPercentage || 0,
        todayTarget: scoreboardData.todayTarget || 0,
        projectedTotal: scoreboardData.projectedTotal || 0
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
        vs7Day: scoreboardData.vs7Day,
        hourlyRates: scoreboardData.hourlyRates || []
      };
    }

    // Get bag timer data (existing)
    var timerData = getBagTimerData();

    if (timerData) {
      context.bags = {
        fiveKgToday: timerData.bags5kgToday || 0,
        tenLbToday: timerData.bags10lbToday || 0,
        totalToday: timerData.bagsToday || 0,
        avgCycleSeconds: timerData.avgSecondsToday || 0,
        avgCycle7Day: timerData.avgSeconds7Day || 0,
        lastBagTime: timerData.lastBagTime || null,
        secondsSinceLastBag: timerData.secondsSinceLastBag || 0,
        isPaused: timerData.isPaused || false,
        pauseReason: timerData.pauseReason || ''
      };
    }

    // Historical data (existing)
    context.history = gatherHistoricalData(ss, timezone);

    // ============================================
    // NEW V2: Additional Data Sources
    // ============================================

    // 1. Hourly breakdown with full detail
    context.hourlyBreakdown = getTodayHourlyBreakdown_(ss, timezone);

    // 2. Crew change history
    context.crewChanges = getRecentCrewChanges_(ss, timezone);

    // 3. Pause/break history
    context.pauseHistory = getTodayPauseHistory_(ss, timezone);

    // 4. Line 1 vs Line 2 breakdown
    context.lineBreakdown = getTodayLineBreakdown_(ss, timezone);

    // 5. Quality metrics
    context.qualityMetrics = calculateQualityMetrics_(context);

  } catch (error) {
    Logger.log('Error gathering context: ' + error.message);
  }

  return context;
}

/**
 * NEW: Get detailed hourly breakdown for today
 * Returns: tops, smalls, trimmers, buckers, strain, rate per hour
 */
function getTodayHourlyBreakdown_(ss, timezone) {
  var breakdown = [];

  try {
    var sheet = getLatestMonthSheet_(ss);
    if (!sheet) return breakdown;

    var vals = sheet.getDataRange().getValues();
    var today = new Date();
    var todayLabel = Utilities.formatDate(today, timezone, 'M/d/yyyy');

    // Find today's date row
    var dateRowIndex = -1;
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === 'Date:') {
        var dateValue = vals[r][1];
        if (dateValue instanceof Date) {
          var dateStr = Utilities.formatDate(dateValue, timezone, 'M/d/yyyy');
          if (dateStr === todayLabel) {
            dateRowIndex = r;
            break;
          }
        }
      }
    }

    if (dateRowIndex < 0) return breakdown;

    // Get headers
    var headerRowIndex = dateRowIndex + 1;
    var headers = vals[headerRowIndex] || [];
    var cols = getColumnIndices_(headers);

    // Read each hour's data
    for (var dataRow = headerRowIndex + 1; dataRow < vals.length; dataRow++) {
      var row = vals[dataRow];
      if (isEndOfBlock_(row)) break;

      var timeSlot = row[cols.timeSlot] || '';
      if (!timeSlot) continue;

      // Line 1 data
      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var smalls1 = parseFloat(row[cols.smalls1]) || 0;
      var trimmers1 = parseFloat(row[cols.trimmers1]) || 0;
      var buckers1 = parseFloat(row[cols.buckers1]) || 0;
      var cultivar1 = row[cols.cultivar1] || '';
      var tzero1 = parseFloat(row[cols.tzero1]) || 0;

      // Line 2 data (if exists)
      var tops2 = cols.tops2 !== undefined ? (parseFloat(row[cols.tops2]) || 0) : 0;
      var smalls2 = cols.smalls2 !== undefined ? (parseFloat(row[cols.smalls2]) || 0) : 0;
      var trimmers2 = cols.trimmers2 !== undefined ? (parseFloat(row[cols.trimmers2]) || 0) : 0;
      var buckers2 = cols.buckers2 !== undefined ? (parseFloat(row[cols.buckers2]) || 0) : 0;
      var cultivar2 = cols.cultivar2 !== undefined ? (row[cols.cultivar2] || '') : '';
      var tzero2 = cols.tzero2 !== undefined ? (parseFloat(row[cols.tzero2]) || 0) : 0;

      // Calculate totals and rate
      var totalTops = tops1 + tops2;
      var totalSmalls = smalls1 + smalls2;
      var totalTrimmers = trimmers1 + trimmers2;
      var totalBuckers = buckers1 + buckers2;
      var multiplier = getTimeSlotMultiplier(timeSlot);
      var rate = (totalTrimmers > 0 && totalTops > 0) ?
        (totalTops / (totalTrimmers * multiplier)) : 0;

      breakdown.push({
        timeSlot: timeSlot,
        // Totals
        totalTops: totalTops,
        totalSmalls: totalSmalls,
        totalTrimmers: totalTrimmers,
        totalBuckers: totalBuckers,
        // Line 1
        line1: {
          tops: tops1,
          smalls: smalls1,
          trimmers: trimmers1,
          buckers: buckers1,
          cultivar: cultivar1,
          tzero: tzero1
        },
        // Line 2
        line2: {
          tops: tops2,
          smalls: smalls2,
          trimmers: trimmers2,
          buckers: buckers2,
          cultivar: cultivar2,
          tzero: tzero2
        },
        // Calculated
        rate: rate,
        multiplier: multiplier,
        hasData: totalTops > 0 || totalTrimmers > 0
      });
    }

  } catch (error) {
    Logger.log('Error in getTodayHourlyBreakdown_: ' + error.message);
  }

  return breakdown;
}

/**
 * NEW: Get recent crew changes from CrewChangeLog
 */
function getRecentCrewChanges_(ss, timezone) {
  var changes = [];

  try {
    var sheet = ss.getSheetByName('CrewChangeLog');
    if (!sheet) return changes;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return changes;

    var today = new Date();
    var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');
    var yesterdayStr = Utilities.formatDate(
      new Date(today.getTime() - 24*60*60*1000), timezone, 'yyyy-MM-dd'
    );

    // Headers: Timestamp, User, Month Sheet, Hr×Hr Row, Time Slot, Buckers Change, Trimmers Change
    for (var i = data.length - 1; i >= 1 && changes.length < 20; i--) {
      var timestamp = data[i][0];
      if (!(timestamp instanceof Date)) continue;

      var changeDate = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');

      // Only get today and yesterday's changes
      if (changeDate !== todayStr && changeDate !== yesterdayStr) continue;

      var timeStr = Utilities.formatDate(timestamp, timezone, 'h:mm a');
      var dayLabel = changeDate === todayStr ? 'Today' : 'Yesterday';

      changes.push({
        when: dayLabel + ' ' + timeStr,
        timestamp: timestamp,
        user: data[i][1] || 'Unknown',
        timeSlot: data[i][4] || '',
        buckersChange: data[i][5] || '',
        trimmersChange: data[i][6] || ''
      });
    }

  } catch (error) {
    Logger.log('Error in getRecentCrewChanges_: ' + error.message);
  }

  return changes;
}

/**
 * NEW: Get today's pause/break history
 */
function getTodayPauseHistory_(ss, timezone) {
  var pauses = [];

  try {
    var sheet = ss.getSheetByName('Timer Pause Log');
    if (!sheet) return pauses;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return pauses;

    var today = new Date();
    var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');

    // Headers: Timestamp, Reason, Duration, End Time, etc.
    for (var i = data.length - 1; i >= 1 && pauses.length < 10; i--) {
      var timestamp = data[i][0];
      if (!(timestamp instanceof Date)) continue;

      var pauseDate = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');
      if (pauseDate !== todayStr) continue;

      var timeStr = Utilities.formatDate(timestamp, timezone, 'h:mm a');
      var reason = data[i][1] || 'No reason';
      var duration = data[i][2] || 0;

      pauses.push({
        time: timeStr,
        reason: reason,
        durationMinutes: typeof duration === 'number' ? Math.round(duration / 60) : 0
      });
    }

  } catch (error) {
    Logger.log('Error in getTodayPauseHistory_: ' + error.message);
  }

  return pauses;
}

/**
 * NEW: Get Line 1 vs Line 2 breakdown for today
 */
function getTodayLineBreakdown_(ss, timezone) {
  var breakdown = {
    line1: { tops: 0, smalls: 0, trimmers: 0, buckers: 0, hours: 0 },
    line2: { tops: 0, smalls: 0, trimmers: 0, buckers: 0, hours: 0 },
    combined: { tops: 0, smalls: 0, trimmers: 0, buckers: 0, hours: 0 }
  };

  try {
    var sheet = getLatestMonthSheet_(ss);
    if (!sheet) return breakdown;

    var vals = sheet.getDataRange().getValues();
    var today = new Date();
    var todayLabel = Utilities.formatDate(today, timezone, 'M/d/yyyy');

    // Find today's date row
    var dateRowIndex = -1;
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === 'Date:') {
        var dateValue = vals[r][1];
        if (dateValue instanceof Date) {
          var dateStr = Utilities.formatDate(dateValue, timezone, 'M/d/yyyy');
          if (dateStr === todayLabel) {
            dateRowIndex = r;
            break;
          }
        }
      }
    }

    if (dateRowIndex < 0) return breakdown;

    var headerRowIndex = dateRowIndex + 1;
    var headers = vals[headerRowIndex] || [];
    var cols = getColumnIndices_(headers);

    for (var dataRow = headerRowIndex + 1; dataRow < vals.length; dataRow++) {
      var row = vals[dataRow];
      if (isEndOfBlock_(row)) break;

      var timeSlot = row[cols.timeSlot] || '';
      if (!timeSlot) continue;

      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var smalls1 = parseFloat(row[cols.smalls1]) || 0;
      var trimmers1 = parseFloat(row[cols.trimmers1]) || 0;
      var buckers1 = parseFloat(row[cols.buckers1]) || 0;

      if (tops1 > 0 || trimmers1 > 0) {
        breakdown.line1.tops += tops1;
        breakdown.line1.smalls += smalls1;
        breakdown.line1.trimmers = Math.max(breakdown.line1.trimmers, trimmers1);
        breakdown.line1.buckers = Math.max(breakdown.line1.buckers, buckers1);
        if (tops1 > 0) breakdown.line1.hours++;
      }

      if (cols.tops2 !== undefined) {
        var tops2 = parseFloat(row[cols.tops2]) || 0;
        var smalls2 = parseFloat(row[cols.smalls2]) || 0;
        var trimmers2 = parseFloat(row[cols.trimmers2]) || 0;
        var buckers2 = parseFloat(row[cols.buckers2]) || 0;

        if (tops2 > 0 || trimmers2 > 0) {
          breakdown.line2.tops += tops2;
          breakdown.line2.smalls += smalls2;
          breakdown.line2.trimmers = Math.max(breakdown.line2.trimmers, trimmers2);
          breakdown.line2.buckers = Math.max(breakdown.line2.buckers, buckers2);
          if (tops2 > 0) breakdown.line2.hours++;
        }
      }
    }

    // Calculate combined
    breakdown.combined.tops = breakdown.line1.tops + breakdown.line2.tops;
    breakdown.combined.smalls = breakdown.line1.smalls + breakdown.line2.smalls;
    breakdown.combined.trimmers = breakdown.line1.trimmers + breakdown.line2.trimmers;
    breakdown.combined.buckers = breakdown.line1.buckers + breakdown.line2.buckers;
    breakdown.combined.hours = Math.max(breakdown.line1.hours, breakdown.line2.hours);

  } catch (error) {
    Logger.log('Error in getTodayLineBreakdown_: ' + error.message);
  }

  return breakdown;
}

/**
 * NEW: Calculate quality metrics
 */
function calculateQualityMetrics_(context) {
  var metrics = {
    topsToSmallsRatio: 0,
    topsPercentage: 0,
    smallsPercentage: 0,
    avgRateToday: 0,
    bestHour: null,
    worstHour: null
  };

  try {
    var lineBreakdown = context.lineBreakdown || {};
    var combined = lineBreakdown.combined || {};
    var totalTops = combined.tops || 0;
    var totalSmalls = combined.smalls || 0;
    var total = totalTops + totalSmalls;

    if (total > 0) {
      metrics.topsPercentage = Math.round((totalTops / total) * 100);
      metrics.smallsPercentage = Math.round((totalSmalls / total) * 100);
    }

    if (totalSmalls > 0) {
      metrics.topsToSmallsRatio = (totalTops / totalSmalls).toFixed(1);
    }

    // Find best/worst hours
    var hourlyBreakdown = context.hourlyBreakdown || [];
    var rateSum = 0;
    var rateCount = 0;

    for (var i = 0; i < hourlyBreakdown.length; i++) {
      var hour = hourlyBreakdown[i];
      if (hour.hasData && hour.rate > 0) {
        rateSum += hour.rate;
        rateCount++;

        if (!metrics.bestHour || hour.rate > metrics.bestHour.rate) {
          metrics.bestHour = { timeSlot: hour.timeSlot, rate: hour.rate, tops: hour.totalTops };
        }
        if (!metrics.worstHour || hour.rate < metrics.worstHour.rate) {
          metrics.worstHour = { timeSlot: hour.timeSlot, rate: hour.rate, tops: hour.totalTops };
        }
      }
    }

    if (rateCount > 0) {
      metrics.avgRateToday = rateSum / rateCount;
    }

  } catch (error) {
    Logger.log('Error in calculateQualityMetrics_: ' + error.message);
  }

  return metrics;
}

/**
 * ENHANCED: Build system prompt with ALL data
 */
function buildSystemPrompt(context, sessionCorrections) {
  var now = new Date();
  var timezone = 'America/Los_Angeles';
  var currentTime = Utilities.formatDate(now, timezone, 'EEEE, MMMM d, yyyy h:mm a');
  var currentHour = parseInt(Utilities.formatDate(now, timezone, 'H'));
  var dayOfWeek = Utilities.formatDate(now, timezone, 'EEEE');

  // Calculate hours remaining
  var endOfDay = 16.5;
  var hoursRemainingToday = Math.max(0, endOfDay - currentHour);
  if (currentHour < 7) hoursRemainingToday = 7.5;
  if (currentHour >= 17) hoursRemainingToday = 0;

  var daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var todayIndex = daysOfWeek.indexOf(dayOfWeek);
  var workDaysRemaining = Math.max(0, 5 - todayIndex);
  if (todayIndex === 0 || todayIndex === 6) workDaysRemaining = 5;

  var savedCorrections = getRecentCorrections();

  var crewTotal = context.crew.currentTrimmers || context.crew.lastHourTrimmers || 0;
  var avgCycleMinutes = context.bags.avgCycleSeconds ? Math.round(context.bags.avgCycleSeconds / 60) : 0;
  var minutesSinceLastBag = context.bags.secondsSinceLastBag ? Math.round(context.bags.secondsSinceLastBag / 60) : 0;

  var prompt = 'You are the Rogue Origin AI Assistant, helping manage a hemp processing facility in Southern Oregon.\n\n' +
    'CURRENT TIME: ' + currentTime + '\n' +
    '• Hours remaining today: ' + hoursRemainingToday.toFixed(1) + ' effective hours\n' +
    '• Work days remaining this week: ' + workDaysRemaining + ' (Mon-Fri)\n\n';

  // ============================================
  // TODAY'S PRODUCTION
  // ============================================
  prompt += '═══════════════════════════════════════\n' +
    'TODAY\'S PRODUCTION\n' +
    '═══════════════════════════════════════\n' +
    '• Tops produced: ' + (context.production.topsToday || 0).toFixed(1) + ' lbs\n' +
    '• Target: ' + (context.production.todayTarget || 0).toFixed(1) + ' lbs\n' +
    '• Performance: ' + Math.round(context.production.todayPercentage || 0) + '%\n' +
    '• Projected end-of-day: ' + (context.production.projectedTotal || 0).toFixed(1) + ' lbs\n' +
    '• Last hour: ' + (context.production.lastHourLbs || 0) + ' lbs (' + (context.production.lastTimeSlot || 'N/A') + ')\n' +
    '• Hours logged: ' + (context.production.hoursLogged || 0) + '\n' +
    '• Current strain: ' + (context.production.strain || 'Unknown') + '\n\n';

  // ============================================
  // NEW: LINE 1 VS LINE 2 BREAKDOWN
  // ============================================
  if (context.lineBreakdown) {
    var lb = context.lineBreakdown;
    prompt += 'LINE BREAKDOWN TODAY:\n';
    if (lb.line1 && lb.line1.tops > 0) {
      prompt += '• Line 1: ' + lb.line1.tops.toFixed(1) + ' lbs tops, ' +
        lb.line1.smalls.toFixed(1) + ' lbs smalls, ' +
        lb.line1.trimmers + ' trimmers, ' + lb.line1.buckers + ' buckers\n';
    }
    if (lb.line2 && lb.line2.tops > 0) {
      prompt += '• Line 2: ' + lb.line2.tops.toFixed(1) + ' lbs tops, ' +
        lb.line2.smalls.toFixed(1) + ' lbs smalls, ' +
        lb.line2.trimmers + ' trimmers, ' + lb.line2.buckers + ' buckers\n';
    }
    if (lb.combined) {
      prompt += '• Combined: ' + lb.combined.tops.toFixed(1) + ' lbs tops, ' +
        lb.combined.smalls.toFixed(1) + ' lbs smalls\n';
    }
    prompt += '\n';
  }

  // ============================================
  // CREW STATUS
  // ============================================
  prompt += 'CREW STATUS:\n' +
    '• Current trimmers: ' + crewTotal + '\n';

  if (context.lineBreakdown && context.lineBreakdown.combined) {
    prompt += '• Current buckers: ' + (context.lineBreakdown.combined.buckers || 0) + '\n';
  }
  prompt += '\n';

  // ============================================
  // NEW: CREW CHANGE HISTORY
  // ============================================
  if (context.crewChanges && context.crewChanges.length > 0) {
    prompt += 'CREW CHANGES (Recent):\n';
    context.crewChanges.slice(0, 5).forEach(function(change) {
      prompt += '• ' + change.when + ' (' + change.timeSlot + '): ';
      if (change.trimmersChange) prompt += 'Trimmers ' + change.trimmersChange;
      if (change.trimmersChange && change.buckersChange) prompt += ', ';
      if (change.buckersChange) prompt += 'Buckers ' + change.buckersChange;
      prompt += '\n';
    });
    prompt += '\n';
  }

  // ============================================
  // BAGS
  // ============================================
  prompt += 'BAGS TODAY:\n' +
    '• 5kg bags: ' + (context.bags.fiveKgToday || 0) + '\n' +
    '• 10lb tops: ' + (context.bags.tenLbToday || 0) + '\n' +
    '• Total bags: ' + (context.bags.totalToday || 0) + '\n' +
    '• Avg cycle: ' + (avgCycleMinutes || 'N/A') + ' min (7-day avg: ' + Math.round((context.bags.avgCycle7Day || 0) / 60) + ' min)\n' +
    '• Last bag: ' + (minutesSinceLastBag > 60 ? Math.round(minutesSinceLastBag/60) + ' hours ago' : minutesSinceLastBag + ' min ago') + '\n';

  if (context.bags.isPaused) {
    prompt += '• ⚠️ TIMER PAUSED: ' + (context.bags.pauseReason || 'No reason given') + '\n';
  }
  prompt += '\n';

  // ============================================
  // NEW: PAUSE/BREAK HISTORY
  // ============================================
  if (context.pauseHistory && context.pauseHistory.length > 0) {
    prompt += 'BREAKS/PAUSES TODAY:\n';
    context.pauseHistory.forEach(function(pause) {
      prompt += '• ' + pause.time + ': ' + pause.reason;
      if (pause.durationMinutes > 0) {
        prompt += ' (' + pause.durationMinutes + ' min)';
      }
      prompt += '\n';
    });
    prompt += '\n';
  }

  // ============================================
  // NEW: QUALITY METRICS
  // ============================================
  if (context.qualityMetrics) {
    var qm = context.qualityMetrics;
    prompt += 'QUALITY METRICS:\n' +
      '• Tops percentage: ' + (qm.topsPercentage || 0) + '%\n' +
      '• Smalls percentage: ' + (qm.smallsPercentage || 0) + '%\n' +
      '• Tops:Smalls ratio: ' + (qm.topsToSmallsRatio || 'N/A') + ':1\n';

    if (qm.bestHour) {
      prompt += '• Best hour: ' + qm.bestHour.timeSlot + ' (' + qm.bestHour.rate.toFixed(2) + ' lbs/person/hr)\n';
    }
    if (qm.worstHour) {
      prompt += '• Slowest hour: ' + qm.worstHour.timeSlot + ' (' + qm.worstHour.rate.toFixed(2) + ' lbs/person/hr)\n';
    }
    prompt += '\n';
  }

  // ============================================
  // RATES
  // ============================================
  prompt += 'RATE: ' + (context.rates.targetRate || 1.0).toFixed(2) + ' lbs/person/hour\n' +
    '• vs Yesterday: ' + formatComparison(context.rates.vsYesterday) + '\n' +
    '• vs 7-day avg: ' + formatComparison(context.rates.vs7Day) + '\n\n';

  // ============================================
  // NEW: HOURLY BREAKDOWN (Today)
  // ============================================
  if (context.hourlyBreakdown && context.hourlyBreakdown.length > 0) {
    prompt += '═══════════════════════════════════════\n' +
      'HOUR-BY-HOUR TODAY\n' +
      '═══════════════════════════════════════\n';

    context.hourlyBreakdown.forEach(function(hour) {
      if (hour.hasData) {
        prompt += hour.timeSlot + ': ' + hour.totalTops.toFixed(1) + ' lbs, ' +
          hour.totalTrimmers + ' trimmers';
        if (hour.rate > 0) {
          prompt += ', ' + hour.rate.toFixed(2) + ' lbs/hr/person';
        }
        if (hour.totalSmalls > 0) {
          prompt += ', ' + hour.totalSmalls.toFixed(1) + ' smalls';
        }
        prompt += '\n';
      }
    });
    prompt += '\n';
  }

  // ============================================
  // HISTORICAL DATA (existing, condensed)
  // ============================================
  if (context.history) {
    prompt += '═══════════════════════════════════════\n' +
      'HISTORICAL DATA (Last 30 Days)\n' +
      '═══════════════════════════════════════\n';

    if (context.history.last30Days) {
      var h30 = context.history.last30Days;
      prompt += '30-DAY SUMMARY:\n' +
        '• Total: ' + h30.totalLbs.toFixed(1) + ' lbs over ' + h30.daysWorked + ' days\n' +
        '• Daily average: ' + h30.avgDaily.toFixed(1) + ' lbs\n';
      if (h30.bestDay) prompt += '• Best day: ' + h30.bestDay.date + ' (' + h30.bestDay.lbs.toFixed(1) + ' lbs)\n';
      if (h30.worstDay) prompt += '• Slowest day: ' + h30.worstDay.date + ' (' + h30.worstDay.lbs.toFixed(1) + ' lbs)\n';
      prompt += '\n';
    }

    if (context.history.weekOverWeek) {
      var wow = context.history.weekOverWeek;
      prompt += 'WEEK OVER WEEK:\n' +
        '• This week: ' + wow.thisWeek.toFixed(1) + ' lbs\n' +
        '• Last week: ' + wow.lastWeek.toFixed(1) + ' lbs\n' +
        '• Change: ' + (wow.change >= 0 ? '+' : '') + wow.change.toFixed(1) + '%\n\n';
    }

    if (context.history.last7Days && context.history.last7Days.length > 0) {
      prompt += 'LAST 7 DAYS:\n';
      context.history.last7Days.forEach(function(d) {
        prompt += '• ' + d.dayOfWeek + ': ' + d.lbs.toFixed(1) + ' lbs';
        if (d.avgRate > 0) prompt += ' (' + d.avgRate.toFixed(2) + ' lbs/hr/person)';
        prompt += '\n';
      });
      prompt += '\n';
    }

    if (context.history.strainSummary && context.history.strainSummary.length > 0) {
      prompt += 'STRAIN PERFORMANCE (30 days):\n';
      context.history.strainSummary.slice(0, 5).forEach(function(s) {
        var strainName = s.strain.split(' - ')[1] || s.strain;
        prompt += '• ' + strainName + ': ' + s.totalLbs.toFixed(1) + ' lbs, ' +
          s.avgRate.toFixed(2) + ' lbs/hr/person\n';
      });
      prompt += '\n';
    }

    if (context.history.dailyStrainBreakdown && context.history.dailyStrainBreakdown.length > 0) {
      prompt += 'DAILY STRAIN BREAKDOWN (Last 14 Days):\n';
      context.history.dailyStrainBreakdown.forEach(function(day) {
        prompt += day.dayOfWeek + ' (' + day.date + '):\n';
        day.strains.forEach(function(s) {
          var strainName = s.strain.split(' - ')[1] || s.strain;
          prompt += '  • ' + strainName + ': ' + s.tops.toFixed(1) + ' lbs tops';
          if (s.smalls > 0) prompt += ', ' + s.smalls.toFixed(1) + ' lbs smalls';
          prompt += '\n';
        });
      });
      prompt += '\n';
    }
  }

  // ============================================
  // RESPONSE GUIDELINES
  // ============================================
  prompt += '═══════════════════════════════════════\n' +
    'RESPONSE GUIDELINES\n' +
    '═══════════════════════════════════════\n' +
    '1. Be concise - the boss reads this on his phone\n' +
    '2. Lead with the most important insight\n' +
    '3. Use simple language and comparisons\n' +
    '4. If data is missing, say so\n' +
    '5. Use emojis sparingly (📊 📦 👥 ⚡ 📈 📉)\n\n';

  // Saved corrections
  if (savedCorrections && savedCorrections.length > 0) {
    prompt += '═══════════════════════════════════════\n' +
      'LEARNED CORRECTIONS (Apply these!)\n' +
      '═══════════════════════════════════════\n';
    savedCorrections.forEach(function(c) {
      prompt += '• ' + c.correction + '\n';
    });
    prompt += '\n';
  }

  // Session corrections
  if (sessionCorrections && sessionCorrections.length > 0) {
    prompt += '═══════════════════════════════════════\n' +
      'SESSION CORRECTIONS (User corrected you this conversation)\n' +
      '═══════════════════════════════════════\n';
    sessionCorrections.forEach(function(c) {
      prompt += '• User said: "' + c.original + '"\n';
    });
    prompt += 'IMPORTANT: Apply these corrections in your responses!\n\n';
  }

  // Projection formulas
  prompt += '═══════════════════════════════════════\n' +
    'PROJECTION CALCULATIONS\n' +
    '═══════════════════════════════════════\n' +
    'CONVERSIONS:\n' +
    '• 1 kg = 2.205 lbs\n' +
    '• 5 kg bag = 11.02 lbs\n' +
    '• 10 lb bag = 10 lbs\n\n' +

    'WORK SCHEDULE:\n' +
    '• Standard day: 7:00 AM - 4:30 PM (8.5 hrs total)\n' +
    '• Effective hours per day: ~7.5 hrs (after breaks)\n' +
    '• Work week: Monday - Friday\n\n' +

    'FORMULAS:\n' +
    '• Lbs per hour = trimmers × rate\n' +
    '• Hours needed = target lbs ÷ (trimmers × rate)\n' +
    '• Trimmers needed = target lbs ÷ (hours × rate)\n' +
    '• Days needed = hours needed ÷ 7.5\n\n';

  return prompt;
}

/**
 * Formats comparison values
 */
function formatComparison(value) {
  if (value === null || value === undefined) return 'N/A';
  var num = parseFloat(value);
  if (isNaN(num)) return 'N/A';
  if (num > 0) return '+' + num.toFixed(1) + '%';
  return num.toFixed(1) + '%';
}

// ============================================
// Existing functions (unchanged)
// ============================================

function extractCorrections(history) {
  var corrections = [];
  if (!history || history.length < 2) return corrections;

  var correctionPatterns = [
    /^actually[,:]?\s+(.+)/i,
    /^no[,:]?\s+(.+)/i,
    /^that'?s (?:wrong|incorrect|not right)[,:]?\s*(.+)/i,
    /^correction[,:]?\s+(.+)/i,
    /^fyi[,:]?\s+(.+)/i,
    /^remember[,:]?\s+(.+)/i,
    /^note[,:]?\s+(.+)/i,
    /^we (?:actually|usually|always|never)\s+(.+)/i,
    /^it'?s actually\s+(.+)/i,
    /^the correct.+is\s+(.+)/i
  ];

  for (var i = 0; i < history.length; i++) {
    if (history[i].role === 'user') {
      var msg = history[i].content;
      for (var j = 0; j < correctionPatterns.length; j++) {
        var match = msg.match(correctionPatterns[j]);
        if (match) {
          corrections.push({ original: msg, correction: match[1] || msg });
          break;
        }
      }
    }
  }
  return corrections;
}

function logChatForTraining(userMessage, aiResponse, historyLength) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Chat_Log');

    if (!sheet) {
      sheet = ss.insertSheet('AI_Chat_Log');
      sheet.appendRow(['Timestamp', 'Question', 'Response', 'Conversation Turn', 'Feedback', 'Notes']);
      sheet.setFrozenRows(1);
    }

    var truncatedResponse = aiResponse.length > 500 ? aiResponse.substring(0, 500) + '...' : aiResponse;
    sheet.appendRow([new Date(), userMessage, truncatedResponse, historyLength + 1, '', '']);
  } catch (error) {
    Logger.log('Error logging chat: ' + error.message);
  }
}

function logChatFeedback(feedback) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Chat_Log');
    if (!sheet) return { success: false, error: 'No chat log found' };

    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === feedback.question) {
        sheet.getRange(i + 1, 5).setValue(feedback.rating);
        if (feedback.note) sheet.getRange(i + 1, 6).setValue(feedback.note);
        return { success: true, message: 'Feedback logged' };
      }
    }
    return { success: true, message: 'Feedback logged' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getRecentCorrections() {
  var corrections = [];
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Corrections');
    if (!sheet) return corrections;

    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1 && corrections.length < 20; i--) {
      if (data[i][2] !== 'disabled') {
        corrections.push({ correction: data[i][1], category: data[i][3] || 'general' });
      }
    }
  } catch (error) {
    Logger.log('Error getting corrections: ' + error.message);
  }
  return corrections;
}

function saveCorrection(correction, category) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Corrections');
    if (!sheet) {
      sheet = ss.insertSheet('AI_Corrections');
      sheet.appendRow(['Timestamp', 'Correction', 'Status', 'Category']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), correction, 'active', category || 'general']);
    return { success: true, message: 'Correction saved' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function gatherHistoricalData(ss, timezone) {
  var history = {
    last7Days: [],
    last30Days: { totalLbs: 0, avgDaily: 0, bestDay: null, worstDay: null },
    weekOverWeek: null,
    strainSummary: [],
    dailyStrainBreakdown: []
  };

  try {
    var dailyData = getExtendedDailyDataLine1_(ss, timezone, 30);

    if (dailyData && dailyData.length > 0) {
      var last7 = dailyData.slice(-7);
      history.last7Days = last7.map(function(d) {
        var dateObj = new Date(d.date);
        var dayOfWeek = Utilities.formatDate(dateObj, timezone, 'EEEE');
        return {
          date: d.date, dayOfWeek: dayOfWeek, lbs: d.totalLbs || 0,
          hours: d.hoursWorked || 0, avgRate: d.avgRate || 0, strain: d.strain || ''
        };
      });

      var totalLbs30 = 0, bestDay = null, worstDay = null;
      dailyData.forEach(function(d) {
        var lbs = d.totalLbs || 0;
        totalLbs30 += lbs;
        if (lbs > 0) {
          if (!bestDay || lbs > bestDay.lbs) bestDay = { date: d.date, lbs: lbs };
          if (!worstDay || lbs < worstDay.lbs) worstDay = { date: d.date, lbs: lbs };
        }
      });

      var daysWithData = dailyData.filter(function(d) { return (d.totalLbs || 0) > 0; }).length;
      history.last30Days = {
        totalLbs: totalLbs30,
        avgDaily: daysWithData > 0 ? totalLbs30 / daysWithData : 0,
        daysWorked: daysWithData,
        bestDay: bestDay,
        worstDay: worstDay
      };

      if (dailyData.length >= 14) {
        var thisWeek = dailyData.slice(-7);
        var lastWeek = dailyData.slice(-14, -7);
        var thisWeekLbs = thisWeek.reduce(function(sum, d) { return sum + (d.totalLbs || 0); }, 0);
        var lastWeekLbs = lastWeek.reduce(function(sum, d) { return sum + (d.totalLbs || 0); }, 0);
        history.weekOverWeek = {
          thisWeek: thisWeekLbs, lastWeek: lastWeekLbs,
          change: lastWeekLbs > 0 ? ((thisWeekLbs - lastWeekLbs) / lastWeekLbs * 100) : 0
        };
      }

      var strainTotals = {};
      dailyData.forEach(function(d) {
        var strain = d.strain || 'Unknown';
        if (!strainTotals[strain]) strainTotals[strain] = { lbs: 0, days: 0, rates: [] };
        strainTotals[strain].lbs += d.totalLbs || 0;
        strainTotals[strain].days++;
        if (d.avgRate) strainTotals[strain].rates.push(d.avgRate);
      });

      history.strainSummary = Object.keys(strainTotals).map(function(strain) {
        var data = strainTotals[strain];
        var avgRate = data.rates.length > 0 ? data.rates.reduce(function(a,b) { return a+b; }, 0) / data.rates.length : 0;
        return { strain: strain, totalLbs: data.lbs, daysWorked: data.days, avgRate: avgRate };
      }).sort(function(a, b) { return b.totalLbs - a.totalLbs; });
    }

    history.dailyStrainBreakdown = getDailyStrainBreakdown_(ss, timezone, 14);

  } catch (error) {
    Logger.log('Error gathering historical data: ' + error.message);
  }

  return history;
}

function callAnthropicForChat(systemPrompt, history, userMessage) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');

  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  var messages = [];
  if (history && history.length > 0) {
    var recentHistory = history.slice(-10);
    for (var i = 0; i < recentHistory.length; i++) {
      messages.push({ role: recentHistory[i].role, content: recentHistory[i].content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

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
    throw new Error('AI service error (code ' + responseCode + ')');
  }

  var result = JSON.parse(responseBody);
  if (result.content && result.content.length > 0) {
    return result.content[0].text;
  }

  throw new Error('Empty response from AI');
}

// ============================================
// TEST FUNCTIONS
// ============================================

function testAIAgentV2() {
  var testResult = handleChatRequest({
    message: 'Give me a complete breakdown of today including crew changes and hour by hour performance',
    history: []
  });

  Logger.log('=== AI Agent V2 Test ===');
  Logger.log('Success: ' + testResult.success);
  if (testResult.success) {
    Logger.log('Response: ' + testResult.response);
    Logger.log('\n=== Context Gathered ===');
    Logger.log('Hourly breakdown entries: ' + (testResult.context.hourlyBreakdown || []).length);
    Logger.log('Crew changes: ' + (testResult.context.crewChanges || []).length);
    Logger.log('Pause history: ' + (testResult.context.pauseHistory || []).length);
  } else {
    Logger.log('Error: ' + testResult.error);
  }

  return testResult;
}

function testGatherContextV2() {
  var context = gatherProductionContext();
  Logger.log('=== Full Context V2 ===');
  Logger.log(JSON.stringify(context, null, 2));
  return context;
}
