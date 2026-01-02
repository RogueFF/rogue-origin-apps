/**********************************************************
 * ENHANCED AI AGENT FUNCTIONS - With Historical Data
 * 
 * Replace your existing AI Agent functions with these
 * to give the AI access to historical production data
 **********************************************************/

/**
 * Main chat request handler
 */
function handleChatRequest(data) {
  try {
    var userMessage = data.message || '';
    var history = data.history || [];
    var feedback = data.feedback || null;  // NEW: feedback support
    
    // Handle feedback logging
    if (feedback) {
      return logChatFeedback(feedback);
    }
    
    if (!userMessage) {
      return { success: false, error: 'No message provided' };
    }
    
    // Gather current AND historical production context
    var context = gatherProductionContext();
    
    // NEW: Extract any corrections from conversation history
    var corrections = extractCorrections(history);
    
    // Build the AI prompt
    var systemPrompt = buildSystemPrompt(context, corrections);
    
    // Call Anthropic API
    var aiResponse = callAnthropicForChat(systemPrompt, history, userMessage);
    
    // NEW: Log the conversation for training
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
 * NEW: Extract corrections from conversation history
 * Looks for patterns like "actually...", "no, ...", "that's wrong..."
 */
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
          corrections.push({
            original: msg,
            correction: match[1] || msg
          });
          break;
        }
      }
    }
  }
  
  return corrections;
}

/**
 * NEW: Log conversations for training/review
 */
function logChatForTraining(userMessage, aiResponse, historyLength) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Chat_Log');
    
    if (!sheet) {
      sheet = ss.insertSheet('AI_Chat_Log');
      sheet.appendRow([
        'Timestamp', 
        'Question', 
        'Response', 
        'Conversation Turn',
        'Feedback',
        'Notes'
      ]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#668971').setFontColor('white');
      sheet.setColumnWidth(2, 300);
      sheet.setColumnWidth(3, 400);
    }
    
    // Truncate response for logging (keep it readable)
    var truncatedResponse = aiResponse.length > 500 ? 
      aiResponse.substring(0, 500) + '...' : aiResponse;
    
    sheet.appendRow([
      new Date(),
      userMessage,
      truncatedResponse,
      historyLength + 1,
      '',  // Feedback column - filled later
      ''   // Notes column
    ]);
    
  } catch (error) {
    Logger.log('Error logging chat: ' + error.message);
  }
}

/**
 * NEW: Log feedback for a conversation
 */
function logChatFeedback(feedback) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Chat_Log');
    
    if (!sheet) {
      return { success: false, error: 'No chat log found' };
    }
    
    // Find the most recent row matching this question
    var data = sheet.getDataRange().getValues();
    var feedbackCol = 5; // Column E
    
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === feedback.question || 
          (feedback.timestamp && Math.abs(new Date(data[i][0]) - new Date(feedback.timestamp)) < 60000)) {
        sheet.getRange(i + 1, feedbackCol).setValue(feedback.rating);
        if (feedback.note) {
          sheet.getRange(i + 1, feedbackCol + 1).setValue(feedback.note);
        }
        return { success: true, message: 'Feedback logged' };
      }
    }
    
    // If no match, log as new feedback entry
    sheet.appendRow([
      new Date(),
      feedback.question || 'Unknown',
      '',
      0,
      feedback.rating,
      feedback.note || ''
    ]);
    
    return { success: true, message: 'Feedback logged' };
    
  } catch (error) {
    Logger.log('Error logging feedback: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * NEW: Get recent corrections/learnings to add to prompt
 */
function getRecentCorrections() {
  var corrections = [];
  
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Corrections');
    
    if (!sheet) return corrections;
    
    var data = sheet.getDataRange().getValues();
    
    // Get last 20 active corrections
    for (var i = data.length - 1; i >= 1 && corrections.length < 20; i--) {
      if (data[i][2] !== 'disabled') {  // Check if not disabled
        corrections.push({
          correction: data[i][1],
          category: data[i][3] || 'general'
        });
      }
    }
    
  } catch (error) {
    Logger.log('Error getting corrections: ' + error.message);
  }
  
  return corrections;
}

/**
 * NEW: Save a permanent correction
 */
function saveCorrection(correction, category) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Corrections');
    
    if (!sheet) {
      sheet = ss.insertSheet('AI_Corrections');
      sheet.appendRow(['Timestamp', 'Correction', 'Status', 'Category']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#668971').setFontColor('white');
    }
    
    sheet.appendRow([new Date(), correction, 'active', category || 'general']);
    
    return { success: true, message: 'Correction saved' };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Gathers all relevant production data INCLUDING historical data
 */
function gatherProductionContext() {
  var context = {
    timestamp: new Date().toISOString(),
    production: {},
    bags: {},
    crew: {},
    rates: {},
    history: {}  // NEW: Historical data
  };
  
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var timezone = ss.getSpreadsheetTimeZone();
    
    // Get scoreboard data (uses existing function)
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
        avgCycle7Day: timerData.avgSeconds7Day || 0,
        lastBagTime: timerData.lastBagTime || null,
        secondsSinceLastBag: timerData.secondsSinceLastBag || 0
      };
    }
    
    // ============================================
    // NEW: Gather Historical Data
    // ============================================
    context.history = gatherHistoricalData(ss, timezone);
    
  } catch (error) {
    Logger.log('Error gathering context: ' + error.message);
  }
  
  return context;
}

/**
 * NEW: Gathers historical production data
 */
function gatherHistoricalData(ss, timezone) {
  var history = {
    last7Days: [],
    last30Days: { totalLbs: 0, avgDaily: 0, bestDay: null, worstDay: null },
    weekOverWeek: null,
    strainSummary: [],
    dailyStrainBreakdown: []  // NEW: Per-day strain breakdown
  };
  
  try {
    // Get last 30 days of data using existing function
    var dailyData = getExtendedDailyDataLine1_(ss, timezone, 30);
    
    if (dailyData && dailyData.length > 0) {
      // Last 7 days detail
      var last7 = dailyData.slice(-7);
      history.last7Days = last7.map(function(d) {
        var dateObj = new Date(d.date);
        var dayOfWeek = Utilities.formatDate(dateObj, timezone, 'EEEE');
        return {
          date: d.date,
          dayOfWeek: dayOfWeek,
          lbs: d.totalLbs || 0,
          hours: d.hoursWorked || 0,
          avgRate: d.avgRate || 0,
          strain: d.strain || ''
        };
      });
      
      // 30-day summary
      var totalLbs30 = 0;
      var bestDay = null;
      var worstDay = null;
      
      dailyData.forEach(function(d) {
        var lbs = d.totalLbs || 0;
        totalLbs30 += lbs;
        
        if (lbs > 0) {
          if (!bestDay || lbs > bestDay.lbs) {
            bestDay = { date: d.date, lbs: lbs };
          }
          if (!worstDay || lbs < worstDay.lbs) {
            worstDay = { date: d.date, lbs: lbs };
          }
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
      
      // Week over week comparison
      if (dailyData.length >= 14) {
        var thisWeek = dailyData.slice(-7);
        var lastWeek = dailyData.slice(-14, -7);
        
        var thisWeekLbs = thisWeek.reduce(function(sum, d) { return sum + (d.totalLbs || 0); }, 0);
        var lastWeekLbs = lastWeek.reduce(function(sum, d) { return sum + (d.totalLbs || 0); }, 0);
        
        history.weekOverWeek = {
          thisWeek: thisWeekLbs,
          lastWeek: lastWeekLbs,
          change: lastWeekLbs > 0 ? ((thisWeekLbs - lastWeekLbs) / lastWeekLbs * 100) : 0
        };
      }
      
      // Strain summary from recent data
      var strainTotals = {};
      dailyData.forEach(function(d) {
        var strain = d.strain || 'Unknown';
        if (!strainTotals[strain]) {
          strainTotals[strain] = { lbs: 0, days: 0, rates: [] };
        }
        strainTotals[strain].lbs += d.totalLbs || 0;
        strainTotals[strain].days++;
        if (d.avgRate) strainTotals[strain].rates.push(d.avgRate);
      });
      
      history.strainSummary = Object.keys(strainTotals).map(function(strain) {
        var data = strainTotals[strain];
        var avgRate = data.rates.length > 0 ? 
          data.rates.reduce(function(a,b) { return a+b; }, 0) / data.rates.length : 0;
        return {
          strain: strain,
          totalLbs: data.lbs,
          daysWorked: data.days,
          avgRate: avgRate
        };
      }).sort(function(a, b) { return b.totalLbs - a.totalLbs; });
    }
    
    // NEW: Get detailed strain breakdown per day from raw sheet data
    history.dailyStrainBreakdown = getDailyStrainBreakdown_(ss, timezone, 14);
    
  } catch (error) {
    Logger.log('Error gathering historical data: ' + error.message);
  }
  
  return history;
}

/**
 * NEW: Gets detailed per-day, per-strain production breakdown
 */
function getDailyStrainBreakdown_(ss, timezone, days) {
  var breakdown = [];
  
  try {
    var sheet = getLatestMonthSheet_(ss);
    if (!sheet) return breakdown;
    
    var vals = sheet.getDataRange().getValues();
    var today = new Date();
    
    // Find all date blocks in the sheet
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === 'Date:') {
        var dateValue = vals[r][1];
        if (!(dateValue instanceof Date)) continue;
        
        // Check if within our range
        var daysDiff = Math.floor((today - dateValue) / (1000 * 60 * 60 * 24));
        if (daysDiff > days || daysDiff < 0) continue;
        
        var dateStr = Utilities.formatDate(dateValue, timezone, 'MMMM dd, yyyy');
        var dayOfWeek = Utilities.formatDate(dateValue, timezone, 'EEEE');
        
        // Get headers
        var headerRowIndex = r + 1;
        var headers = vals[headerRowIndex] || [];
        var cols = getColumnIndices_(headers);
        
        // Collect strain data for this day
        var strainData = {};
        
        for (var dataRow = headerRowIndex + 1; dataRow < vals.length; dataRow++) {
          var row = vals[dataRow];
          if (isEndOfBlock_(row)) break;
          
          // Line 1 data
          var tops1 = parseFloat(row[cols.tops1]) || 0;
          var cultivar1 = row[cols.cultivar1] || '';
          
          if (tops1 > 0 && cultivar1) {
            if (!strainData[cultivar1]) {
              strainData[cultivar1] = { tops: 0, smalls: 0 };
            }
            strainData[cultivar1].tops += tops1;
            
            var smalls1 = parseFloat(row[cols.smalls1]) || 0;
            strainData[cultivar1].smalls += smalls1;
          }
          
          // Line 2 data if exists
          if (cols.tops2 !== undefined) {
            var tops2 = parseFloat(row[cols.tops2]) || 0;
            var cultivar2 = row[cols.cultivar2] || '';
            
            if (tops2 > 0 && cultivar2) {
              if (!strainData[cultivar2]) {
                strainData[cultivar2] = { tops: 0, smalls: 0 };
              }
              strainData[cultivar2].tops += tops2;
              
              var smalls2 = parseFloat(row[cols.smalls2]) || 0;
              strainData[cultivar2].smalls += smalls2;
            }
          }
        }
        
        // Convert to array
        var strains = Object.keys(strainData).map(function(strain) {
          return {
            strain: strain,
            tops: strainData[strain].tops,
            smalls: strainData[strain].smalls
          };
        });
        
        if (strains.length > 0) {
          breakdown.push({
            date: dateStr,
            dayOfWeek: dayOfWeek,
            strains: strains
          });
        }
      }
    }
    
  } catch (error) {
    Logger.log('Error in getDailyStrainBreakdown_: ' + error.message);
  }
  
  return breakdown;
}

/**
 * Builds the system prompt with current AND historical data
 */
/**
 * Builds the system prompt with current AND historical data
 */
function buildSystemPrompt(context, sessionCorrections) {
  var now = new Date();
  var timezone = 'America/Los_Angeles';
  var currentTime = Utilities.formatDate(now, timezone, 'EEEE, MMMM d, yyyy h:mm a');
  var currentHour = parseInt(Utilities.formatDate(now, timezone, 'H'));
  var dayOfWeek = Utilities.formatDate(now, timezone, 'EEEE');
  
  // Calculate hours remaining today
  var endOfDay = 16.5; // 4:30 PM
  var hoursRemainingToday = Math.max(0, endOfDay - currentHour);
  if (currentHour < 7) hoursRemainingToday = 7.5; // Before work
  if (currentHour >= 17) hoursRemainingToday = 0; // After work
  
  // Calculate work days this week remaining
  var daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var todayIndex = daysOfWeek.indexOf(dayOfWeek);
  var workDaysRemaining = Math.max(0, 5 - todayIndex); // Mon-Fri = indices 1-5
  if (todayIndex === 0 || todayIndex === 6) workDaysRemaining = 5; // Weekend
  
  // Get saved corrections from sheet
  var savedCorrections = getRecentCorrections();
  
  // Calculate derived metrics
  var totalBagsToday = context.bags.totalToday || 0;
  var crewTotal = context.crew.currentTrimmers || context.crew.lastHourTrimmers || 0;
  var avgCycleMinutes = context.bags.avgCycleSeconds ? Math.round(context.bags.avgCycleSeconds / 60) : 0;
  var minutesSinceLastBag = context.bags.secondsSinceLastBag ? Math.round(context.bags.secondsSinceLastBag / 60) : 0;
  
  var prompt = 'You are the Rogue Origin AI Assistant, helping manage a hemp processing facility in Southern Oregon.\n\n' +
    'CURRENT TIME: ' + currentTime + '\n' +
    '• Hours remaining today: ' + hoursRemainingToday.toFixed(1) + ' effective hours\n' +
    '• Work days remaining this week: ' + workDaysRemaining + ' (Mon-Fri)\n\n' +
    
    '═══════════════════════════════════════\n' +
    'TODAY\'S PRODUCTION\n' +
    '═══════════════════════════════════════\n' +
    '• Tops produced: ' + (context.production.topsToday || 0).toFixed(1) + ' lbs\n' +
    '• Target: ' + (context.production.todayTarget || 0).toFixed(1) + ' lbs\n' +
    '• Performance: ' + Math.round(context.production.todayPercentage || 0) + '%\n' +
    '• Projected end-of-day: ' + (context.production.projectedTotal || 0).toFixed(1) + ' lbs\n' +
    '• Last hour: ' + (context.production.lastHourLbs || 0) + ' lbs (' + (context.production.lastTimeSlot || 'N/A') + ')\n' +
    '• Hours logged: ' + (context.production.hoursLogged || 0) + '\n' +
    '• Current strain: ' + (context.production.strain || 'Unknown') + '\n\n' +
    
    'CREW: ' + crewTotal + ' trimmers\n\n' +
    
    'BAGS TODAY:\n' +
    '• 5kg bags: ' + (context.bags.fiveKgToday || 0) + '\n' +
    '• 10lb tops: ' + (context.bags.tenLbToday || 0) + '\n' +
    '• Avg cycle: ' + (avgCycleMinutes || 'N/A') + ' min (7-day avg: ' + Math.round((context.bags.avgCycle7Day || 0) / 60) + ' min)\n' +
    '• Last bag: ' + (minutesSinceLastBag > 60 ? Math.round(minutesSinceLastBag/60) + ' hours ago' : minutesSinceLastBag + ' min ago') + '\n\n' +
    
    'RATE: ' + (context.rates.targetRate || 1.0).toFixed(2) + ' lbs/person/hour\n' +
    '• vs Yesterday: ' + formatComparison(context.rates.vsYesterday) + '\n' +
    '• vs 7-day avg: ' + formatComparison(context.rates.vs7Day) + '\n\n';
  
  // Add historical data section
  if (context.history) {
    prompt += '═══════════════════════════════════════\n' +
      'HISTORICAL DATA (Last 30 Days)\n' +
      '═══════════════════════════════════════\n';
    
    // 30-day summary
    if (context.history.last30Days) {
      var h30 = context.history.last30Days;
      prompt += '30-DAY SUMMARY:\n' +
        '• Total: ' + h30.totalLbs.toFixed(1) + ' lbs over ' + h30.daysWorked + ' days\n' +
        '• Daily average: ' + h30.avgDaily.toFixed(1) + ' lbs\n';
      if (h30.bestDay) prompt += '• Best day: ' + h30.bestDay.date + ' (' + h30.bestDay.lbs.toFixed(1) + ' lbs)\n';
      if (h30.worstDay) prompt += '• Slowest day: ' + h30.worstDay.date + ' (' + h30.worstDay.lbs.toFixed(1) + ' lbs)\n';
      prompt += '\n';
    }
    
    // Week over week
    if (context.history.weekOverWeek) {
      var wow = context.history.weekOverWeek;
      prompt += 'WEEK OVER WEEK:\n' +
        '• This week: ' + wow.thisWeek.toFixed(1) + ' lbs\n' +
        '• Last week: ' + wow.lastWeek.toFixed(1) + ' lbs\n' +
        '• Change: ' + (wow.change >= 0 ? '+' : '') + wow.change.toFixed(1) + '%\n\n';
    }
    
    // Last 7 days breakdown
    if (context.history.last7Days && context.history.last7Days.length > 0) {
      prompt += 'LAST 7 DAYS:\n';
      context.history.last7Days.forEach(function(d) {
        prompt += '• ' + d.date + ': ' + d.lbs.toFixed(1) + ' lbs';
        if (d.strain) prompt += ' (' + d.strain.split(' - ')[1] || d.strain + ')';
        prompt += '\n';
      });
      prompt += '\n';
    }
    
    // Strain summary
    if (context.history.strainSummary && context.history.strainSummary.length > 0) {
      prompt += 'STRAIN PERFORMANCE (30 days):\n';
      context.history.strainSummary.slice(0, 5).forEach(function(s) {
        var strainName = s.strain.split(' - ')[1] || s.strain;
        prompt += '• ' + strainName + ': ' + s.totalLbs.toFixed(1) + ' lbs, ' + 
          s.daysWorked + ' days, ' + s.avgRate.toFixed(2) + ' lbs/hr/person\n';
      });
      prompt += '\n';
    }
    
    // NEW: Daily strain breakdown (for specific queries like "Lifter on Tuesday")
    if (context.history.dailyStrainBreakdown && context.history.dailyStrainBreakdown.length > 0) {
      prompt += 'DETAILED DAILY STRAIN BREAKDOWN (Last 14 Days):\n';
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
  
  prompt += '═══════════════════════════════════════\n' +
    'RESPONSE GUIDELINES\n' +
    '═══════════════════════════════════════\n' +
    '1. Be concise - the boss reads this on his phone\n' +
    '2. Lead with the most important insight\n' +
    '3. Use simple language and comparisons\n' +
    '4. If data is missing, say so\n' +
    '5. Use emojis sparingly (📊 📦 👥 ⚡ 📈 📉)\n\n';
  
  // NEW: Add saved corrections
  if (savedCorrections && savedCorrections.length > 0) {
    prompt += '═══════════════════════════════════════\n' +
      'LEARNED CORRECTIONS (Apply these!)\n' +
      '═══════════════════════════════════════\n';
    savedCorrections.forEach(function(c) {
      prompt += '• ' + c.correction + '\n';
    });
    prompt += '\n';
  }
  
  // NEW: Add session corrections from current conversation
  if (sessionCorrections && sessionCorrections.length > 0) {
    prompt += '═══════════════════════════════════════\n' +
      'SESSION CORRECTIONS (User corrected you this conversation)\n' +
      '═══════════════════════════════════════\n';
    sessionCorrections.forEach(function(c) {
      prompt += '• User said: "' + c.original + '"\n';
    });
    prompt += 'IMPORTANT: Apply these corrections in your responses!\n\n';
  }
  
  prompt += '═══════════════════════════════════════\n' +
    'HANDLING CORRECTIONS\n' +
    '═══════════════════════════════════════\n' +
    'When user corrects you (says "actually", "no", "that\'s wrong", "remember that", etc.):\n' +
    '1. Acknowledge the correction gracefully\n' +
    '2. Thank them briefly\n' +
    '3. Apply the correction immediately\n' +
    '4. If it\'s useful long-term info, say: "Got it! I\'ll remember that."\n\n' +
    
    'Examples of corrections to watch for:\n' +
    '• "Actually, we only work half days on Friday"\n' +
    '• "No, Lifter is slower to trim than that"\n' +
    '• "Remember: the boss prefers kg over lbs"\n' +
    '• "FYI we call Line 1 the beast"\n\n' +
    
    '═══════════════════════════════════════\n' +
    'PROJECTION CALCULATIONS\n' +
    '═══════════════════════════════════════\n' +
    'Use these formulas for time/crew estimates:\n\n' +
    
    'CONVERSIONS:\n' +
    '• 1 kg = 2.205 lbs\n' +
    '• 5 kg bag = 11.02 lbs\n' +
    '• 10 lb bag = 10 lbs\n\n' +
    
    'WORK SCHEDULE:\n' +
    '• Standard day: 7:00 AM - 4:30 PM (8.5 hrs total)\n' +
    '• Effective hours per day: ~7.5 hrs (after breaks)\n' +
    '• Breaks: 10min at 9am, 30min lunch at 12pm, 10min at 2:30pm, 10min cleanup at 4:20pm\n' +
    '• Work week: Monday - Friday\n\n' +
    
    'FORMULAS:\n' +
    '• Lbs per hour = trimmers × rate (lbs/trimmer/hour)\n' +
    '• Hours needed = target lbs ÷ (trimmers × rate)\n' +
    '• Trimmers needed = target lbs ÷ (hours × rate)\n' +
    '• Days needed = hours needed ÷ 7.5 effective hours/day\n\n' +
    
    'STRAIN RATES (use from data above, or defaults):\n' +
    '• If strain rate is known, use it\n' +
    '• Default fallback: 1.0 lbs/trimmer/hour\n' +
    '• Sungrown strains typically: 0.9-1.1 lbs/hr\n' +
    '• Indoor strains typically: 0.8-1.0 lbs/hr\n\n' +
    
    'EXAMPLE CALCULATIONS:\n' +
    '• "40kg Lifter with 5 trimmers at 1.0 rate":\n' +
    '  40 kg × 2.205 = 88.2 lbs needed\n' +
    '  88.2 lbs ÷ (5 trimmers × 1.0 rate) = 17.6 hours\n' +
    '  17.6 hrs ÷ 7.5 hrs/day = 2.35 work days\n\n' +
    
    '• "Need 100 lbs by deadline, have 3 days":\n' +
    '  3 days × 7.5 hrs = 22.5 hours available\n' +
    '  Trimmers needed = 100 lbs ÷ (22.5 hrs × 1.0 rate) = 4.4 → 5 trimmers\n\n' +
    
    'When answering projection questions:\n' +
    '1. Show the calculation briefly\n' +
    '2. Give a clear answer (X hours, Y days, Z trimmers)\n' +
    '3. Round up for trimmers (can\'t have partial people)\n' +
    '4. Account for current progress if relevant\n' +
    '5. Mention if using strain-specific or default rate\n\n' +
    
    'For data cards, use this HTML:\n' +
    '<div class="data-card">\n' +
    '  <h4>Title</h4>\n' +
    '  <div class="metric"><span class="metric-label">Label</span><span class="metric-value">Value</span></div>\n' +
    '</div>';
  
  return prompt;
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
 * Calls Anthropic API for chat response
 */
function callAnthropicForChat(systemPrompt, history, userMessage) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Go to File > Project Settings > Script Properties and add ANTHROPIC_API_KEY');
  }
  
  var messages = [];
  
  if (history && history.length > 0) {
    var recentHistory = history.slice(-10);
    for (var i = 0; i < recentHistory.length; i++) {
      messages.push({
        role: recentHistory[i].role,
        content: recentHistory[i].content
      });
    }
  }
  
  messages.push({
    role: 'user',
    content: userMessage
  });
  
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
 * Test function
 */
function testAIAgent() {
  var testResult = handleChatRequest({
    message: 'How long would it take to get 40kg of Lifter with 5 trimmers?',
    history: []
  });
  
  Logger.log('=== AI Agent Test ===');
  Logger.log('Success: ' + testResult.success);
  if (testResult.success) {
    Logger.log('Response: ' + testResult.response);
  } else {
    Logger.log('Error: ' + testResult.error);
  }
  
  return testResult;
}

/**
 * Test follow-up question
 */
function testAIAgentFollowUp() {
  var history = [
    { role: 'user', content: 'How long would it take to get 40kg of Lifter with 5 trimmers?' },
    { role: 'assistant', content: 'Based on Sour Lifter\'s rate of ~1.07 lbs/trimmer/hour:\n\n40 kg = 88.2 lbs\n88.2 ÷ (5 × 1.07) = 16.5 hours\nThat\'s about 2.2 work days.\n\nSo roughly 2 full days plus a couple hours.' }
  ];
  
  var testResult = handleChatRequest({
    message: 'How many trimmers would we need to get that done by Friday at noon?',
    history: history
  });
  
  Logger.log('=== AI Follow-up Test ===');
  Logger.log('Success: ' + testResult.success);
  if (testResult.success) {
    Logger.log('Response: ' + testResult.response);
  } else {
    Logger.log('Error: ' + testResult.error);
  }
  
  return testResult;
}

/**
 * Test correction handling
 */
function testAICorrection() {
  var history = [
    { role: 'user', content: 'How long would it take to get 40kg of Lifter with 5 trimmers?' },
    { role: 'assistant', content: 'About 2.2 work days (16.5 hours) with 5 trimmers.' },
    { role: 'user', content: 'Actually, we only work half days on Fridays - 7am to noon.' }
  ];
  
  var testResult = handleChatRequest({
    message: 'So recalculate with that in mind',
    history: history
  });
  
  Logger.log('=== AI Correction Test ===');
  Logger.log('Success: ' + testResult.success);
  if (testResult.success) {
    Logger.log('Response: ' + testResult.response);
  } else {
    Logger.log('Error: ' + testResult.error);
  }
  
  return testResult;
}

/**
 * Test saving a permanent correction
 */
function testSaveCorrection() {
  var result = saveCorrection('We only work half days on Fridays (7am-noon)', 'schedule');
  Logger.log('Save correction result: ' + JSON.stringify(result));
  return result;
}

/**
 * View the AI Chat Log
 */
function viewChatLog() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('AI_Chat_Log');
  
  if (!sheet) {
    Logger.log('No chat log found yet.');
    return;
  }
  
  var data = sheet.getDataRange().getValues();
  Logger.log('=== Chat Log (' + (data.length - 1) + ' entries) ===');
  
  for (var i = Math.max(1, data.length - 10); i < data.length; i++) {
    Logger.log('\n--- Entry ' + i + ' ---');
    Logger.log('Time: ' + data[i][0]);
    Logger.log('Q: ' + data[i][1]);
    Logger.log('A: ' + data[i][2].substring(0, 100) + '...');
    Logger.log('Feedback: ' + (data[i][4] || 'none'));
  }
}

/**
 * View saved corrections
 */
function viewCorrections() {
  var corrections = getRecentCorrections();
  Logger.log('=== Saved Corrections (' + corrections.length + ') ===');
  corrections.forEach(function(c, i) {
    Logger.log((i+1) + '. [' + c.category + '] ' + c.correction);
  });
  return corrections;
}

/**
 * Test context gathering
 */
function testGatherContext() {
  var context = gatherProductionContext();
  Logger.log('=== Full Context ===');
  Logger.log(JSON.stringify(context, null, 2));
  return context;
}
