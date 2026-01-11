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
var WHOLESALE_ORDERS_API_URL = 'https://script.google.com/macros/s/AKfycbxU5dBd5GU1RZeJ-UyNFf1Z8n3jCdIZ0VM6nXVj6_A7Pu2VbbxYWXMiDhkkgB3_8L9MyQ/exec';

/**
 * Task Registry - Defines all executable tasks
 * LangChain-inspired tool schema
 */
var TASK_REGISTRY = {
  'update_crew_count': {
    description: 'Update trimmer or bucker count for current hour',
    parameters: {
      line: { type: 'number', required: true, options: [1, 2] },
      role: { type: 'string', required: true, options: ['trimmers', 'buckers'] },
      count: { type: 'number', required: true, min: 0, max: 20 }
    },
    function: 'executeUpdateCrewCount_'
  },

  'log_bag_completion': {
    description: 'Log a completed 5kg or 10lb bag',
    parameters: {
      bagType: { type: 'string', required: true, options: ['5kg', '10lb'] },
      weight: { type: 'number', required: false, min: 0, max: 15 },
      notes: { type: 'string', required: false, maxLength: 200 }
    },
    function: 'executeLogBag_'
  },

  'schedule_order': {
    description: 'Create or update a wholesale order',
    parameters: {
      customer: { type: 'string', required: true, maxLength: 100 },
      totalKg: { type: 'number', required: true, min: 1, max: 5000 },
      dueDate: { type: 'string', required: true },  // YYYY-MM-DD
      cultivars: { type: 'string', required: false, maxLength: 200 },
      notes: { type: 'string', required: false, maxLength: 500 }
    },
    function: 'executeScheduleOrder_'
  },

  'pause_timer': {
    description: 'Pause the bag timer for breaks or equipment issues',
    parameters: {
      reason: { type: 'string', required: true, options: ['lunch', 'break', 'equipment', 'meeting', 'other'] },
      notes: { type: 'string', required: false, maxLength: 200 }
    },
    function: 'executePauseTimer_'
  },

  'resume_timer': {
    description: 'Resume the bag timer after a pause',
    parameters: {},
    function: 'executeResumeTimer_'
  },

  'get_order_status': {
    description: 'Get detailed status of a specific order',
    parameters: {
      orderId: { type: 'string', required: true }
    },
    function: 'executeGetOrderStatus_'
  },

  'create_shipment': {
    description: 'Create a new shipment for an existing master order',
    parameters: {
      customerName: {
        type: 'string',
        required: true,
        description: 'Customer company name (fuzzy match supported)'
      },
      strain: {
        type: 'string',
        required: true,
        description: 'Strain name (e.g., "Lifter", "Blue Dream")'
      },
      type: {
        type: 'string',
        required: true,
        options: ['Tops', 'Smalls'],
        description: 'Product type: Tops or Smalls'
      },
      quantity: {
        type: 'number',
        required: true,
        min: 1,
        description: 'Quantity in kilograms'
      },
      shipmentDate: {
        type: 'string',
        required: false,
        description: 'Shipment date in YYYY-MM-DD format (default: today)'
      },
      notes: {
        type: 'string',
        required: false,
        description: 'Additional shipment notes'
      }
    },
    function: 'executeCreateShipment_'
  },

  'get_shipments': {
    description: 'Get shipments for a customer',
    parameters: {
      customerName: {
        type: 'string',
        required: true,
        description: 'Customer company name (fuzzy match supported)'
      }
    },
    function: 'executeGetShipments_'
  }
};

/**********************************************************
 * SECURITY: Input Validation Functions
 * Prevents formula injection and validates user inputs
 **********************************************************/

/**
 * Validates a date string input
 * Prevents formula injection attacks (e.g., =IMPORTDATA(), =HYPERLINK())
 *
 * @param {string} dateStr - The date string to validate
 * @returns {object} { valid: boolean, value: string|null, error: string|null }
 */
function validateDateInput(dateStr) {
  // Handle null/undefined
  if (dateStr === null || dateStr === undefined || dateStr === '') {
    return { valid: true, value: null, error: null };
  }

  // Convert to string
  var str = String(dateStr).trim();

  // SECURITY: Block formula injection attempts
  // Formulas in Google Sheets start with = + - @ or contain dangerous patterns
  var formulaPatterns = [
    /^[=+\-@]/,                           // Starts with formula characters
    /^[\t\r\n]*[=+\-@]/,                  // Starts with whitespace then formula chars
    /IMPORTDATA/i,                         // Data import function
    /IMPORTXML/i,                          // XML import function
    /IMPORTHTML/i,                         // HTML import function
    /IMPORTRANGE/i,                        // Range import function
    /IMPORTFEED/i,                         // RSS feed import
    /IMAGE\s*\(/i,                         // Image function
    /HYPERLINK\s*\(/i,                     // Hyperlink function
    /WEBSERVICE\s*\(/i,                    // Web service calls
    /QUERY\s*\(/i,                         // Query function
    /SCRIPT/i,                             // Script injection
    /<[^>]+>/                              // HTML tags
  ];

  for (var i = 0; i < formulaPatterns.length; i++) {
    if (formulaPatterns[i].test(str)) {
      return {
        valid: false,
        value: null,
        error: 'Invalid input: potential formula injection detected'
      };
    }
  }

  // Validate date format: YYYY-MM-DD or MM/DD/YYYY or similar
  var datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,                // YYYY-MM-DD (ISO format)
    /^\d{2}\/\d{2}\/\d{4}$/,              // MM/DD/YYYY
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,          // M/D/YYYY
    /^[A-Za-z]+ \d{1,2}, \d{4}$/          // Month DD, YYYY
  ];

  var isValidDate = false;
  for (var j = 0; j < datePatterns.length; j++) {
    if (datePatterns[j].test(str)) {
      isValidDate = true;
      break;
    }
  }

  if (!isValidDate) {
    // Try to parse as a date anyway
    var parsed = new Date(str);
    if (isNaN(parsed.getTime())) {
      return {
        valid: false,
        value: null,
        error: 'Invalid date format. Use YYYY-MM-DD format.'
      };
    }
  }

  return { valid: true, value: str, error: null };
}

/**
 * Sanitizes a string input to prevent injection attacks
 * Removes or escapes dangerous characters
 *
 * @param {string} input - The string to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 1000)
 * @returns {string} Sanitized string
 */
function sanitizeString(input, maxLength) {
  if (input === null || input === undefined) {
    return '';
  }

  maxLength = maxLength || 1000;
  var str = String(input);

  // Truncate if too long
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  // SECURITY: Escape formula injection by prefixing with single quote
  // This tells Google Sheets to treat the cell as text
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }

  // Remove null bytes and other control characters (except newlines and tabs)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return str;
}

/**
 * Validates and sanitizes a numeric input
 *
 * @param {any} input - The input to validate
 * @param {object} options - { min, max, allowNegative, allowFloat }
 * @returns {object} { valid: boolean, value: number|null, error: string|null }
 */
function validateNumericInput(input, options) {
  options = options || {};
  var min = options.min !== undefined ? options.min : -Infinity;
  var max = options.max !== undefined ? options.max : Infinity;
  var allowNegative = options.allowNegative !== false;
  var allowFloat = options.allowFloat !== false;

  if (input === null || input === undefined || input === '') {
    return { valid: true, value: null, error: null };
  }

  // Check for formula injection in string inputs
  if (typeof input === 'string') {
    var str = input.trim();
    if (/^[=+@]/.test(str) || /IMPORT|HYPERLINK|SCRIPT/i.test(str)) {
      return {
        valid: false,
        value: null,
        error: 'Invalid input: potential formula injection detected'
      };
    }
  }

  var num = parseFloat(input);

  if (isNaN(num)) {
    return { valid: false, value: null, error: 'Invalid number format' };
  }

  if (!allowNegative && num < 0) {
    return { valid: false, value: null, error: 'Negative numbers not allowed' };
  }

  if (!allowFloat && num !== Math.floor(num)) {
    num = Math.floor(num);
  }

  if (num < min || num > max) {
    return { valid: false, value: null, error: 'Number out of range (' + min + ' to ' + max + ')' };
  }

  return { valid: true, value: num, error: null };
}

/**
 * Validates an ID/reference string (alphanumeric with limited special chars)
 *
 * @param {string} input - The ID to validate
 * @returns {object} { valid: boolean, value: string|null, error: string|null }
 */
function validateId(input) {
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: null, error: null };
  }

  var str = String(input).trim();

  // Only allow alphanumeric, dashes, underscores
  if (!/^[A-Za-z0-9_-]+$/.test(str)) {
    return {
      valid: false,
      value: null,
      error: 'Invalid ID format. Only letters, numbers, dashes, and underscores allowed.'
    };
  }

  if (str.length > 100) {
    return { valid: false, value: null, error: 'ID too long (max 100 characters)' };
  }

  return { valid: true, value: str, error: null };
}

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
      // Performance: Cache scoreboard data for 2 minutes
      var cache = CacheService.getScriptCache();
      var cacheKey = 'scoreboard_data';
      var cached = cache.get(cacheKey);

      if (cached) {
        result = JSON.parse(cached);
        result.cached = true;
      } else {
        result = getScoreboardWithTimerData();
        cache.put(cacheKey, JSON.stringify(result), 120); // 2 min cache
      }
    } else if (action === 'dashboard') {
      var startRaw = e.parameter.start || '';
      var endRaw = e.parameter.end || '';

      // SECURITY: Validate date inputs to prevent formula injection
      var startValidation = validateDateInput(startRaw);
      var endValidation = validateDateInput(endRaw);

      if (!startValidation.valid) {
        result = { success: false, error: 'Invalid start date: ' + startValidation.error };
      } else if (!endValidation.valid) {
        result = { success: false, error: 'Invalid end date: ' + endValidation.error };
      } else {
        var start = startValidation.value || '';
        var end = endValidation.value || '';

        // Performance: Cache dashboard data for 5 minutes
        var cache = CacheService.getScriptCache();
        var cacheKey = 'dashboard_' + start + '_' + end;
        var cached = cache.get(cacheKey);

        if (cached) {
          result = JSON.parse(cached);
          result.cached = true;
        } else {
          result = getProductionDashboardData(start, end);
          cache.put(cacheKey, JSON.stringify(result), 300); // 5 min cache
        }
      }
    } else if (action === 'getOrders') {
      result = getOrders();
    } else if (action === 'getOrder') {
      // SECURITY: Validate order ID
      var orderIdValidation = validateId(e.parameter.id);
      if (!orderIdValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + orderIdValidation.error };
      } else {
        result = getOrder(orderIdValidation.value);
      }
    } else if (action === 'getScoreboardOrderQueue') {
      result = getScoreboardOrderQueue();
    } else if (action === 'setShiftStart') {
      result = handleSetShiftStart(e.parameter);
    } else if (action === 'getShiftStart') {
      result = handleGetShiftStart(e.parameter);
    } else if (action === 'test') {
      result = { ok: true, message: 'API is working', timestamp: new Date().toISOString() };
    } else {
      // No action specified - return API info
      result = {
        ok: true,
        message: 'Rogue Origin Production API',
        endpoints: ['scoreboard', 'dashboard', 'getScoreboardOrderQueue', 'test'],
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

/**
 * Handle shift start time setting
 */
function handleSetShiftStart(params) {
  try {
    var timestamp = new Date(params.time);
    var today = new Date();

    // Validation
    if (!isSameDay(timestamp, today)) {
      return { success: false, error: 'Can only set start time for today' };
    }

    if (timestamp > today) {
      return { success: false, error: 'Cannot set future start time' };
    }

    // Calculate adjustments
    var availableHours = calculateAvailableHours(timestamp);
    var normalHours = 8.5;
    var scaleFactor = availableHours / normalHours;

    // Get baseline goals from config or calculate
    var baselineDailyGoal = 200;  // TODO: Make configurable
    var adjustedGoal = Math.round(baselineDailyGoal * scaleFactor);

    // Log to Shift Adjustments sheet
    logShiftAdjustment({
      date: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      shiftStart: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm:ss'),
      setAt: Utilities.formatDate(today, Session.getScriptTimeZone(), 'HH:mm:ss'),
      availableHours: availableHours.toFixed(2),
      scaleFactor: scaleFactor.toFixed(3)
    });

    return {
      success: true,
      shiftAdjustment: {
        manualStartTime: timestamp.toISOString(),
        availableHours: availableHours,
        scaleFactor: scaleFactor,
        adjustedDailyGoal: adjustedGoal
      }
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * Calculate available working hours from start to 4:30 PM
 */
function calculateAvailableHours(startTime) {
  var shiftEnd = new Date(startTime);
  shiftEnd.setHours(16, 30, 0, 0);

  var totalMinutes = (shiftEnd - startTime) / 60000;

  // Scheduled breaks [startHour, startMin, endHour, endMin]
  var breaks = [
    [9, 0, 9, 10],
    [12, 0, 12, 30],
    [14, 30, 14, 40],
    [16, 20, 16, 30]
  ];

  var breakMinutes = 0;
  breaks.forEach(function(brk) {
    var breakStart = new Date(startTime);
    breakStart.setHours(brk[0], brk[1], 0, 0);
    var breakEnd = new Date(startTime);
    breakEnd.setHours(brk[2], brk[3], 0, 0);

    if (startTime < breakEnd && breakStart < shiftEnd) {
      var overlapStart = Math.max(startTime.getTime(), breakStart.getTime());
      var overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
      breakMinutes += (overlapEnd - overlapStart) / 60000;
    }
  });

  return (totalMinutes - breakMinutes) / 60;
}

/**
 * Log shift adjustment to Google Sheets
 */
function logShiftAdjustment(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Shift Adjustments');

  // Create sheet if doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Shift Adjustments');
    sheet.appendRow(['Date', 'Shift Start', 'Set At', 'Available Hours', 'Scale Factor', 'Notes']);
  }

  sheet.appendRow([
    data.date,
    data.shiftStart,
    data.setAt,
    data.availableHours,
    data.scaleFactor,
    ''
  ]);
}

/**
 * Get today's shift start adjustment
 */
function handleGetShiftStart(params) {
  try {
    var date = params.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Shift Adjustments');

    if (!sheet) {
      return { success: true, shiftAdjustment: null, debug: 'Sheet not found' };
    }

    var data = sheet.getDataRange().getValues();

    // Find today's entry (most recent)
    for (var i = data.length - 1; i >= 1; i--) {
      var cellDate = Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      if (cellDate === date) {
        var timeStr = Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), 'HH:mm:ss');
        return {
          success: true,
          shiftAdjustment: {
            manualStartTime: date + 'T' + timeStr,
            availableHours: parseFloat(data[i][3]),
            scaleFactor: parseFloat(data[i][4])
          }
        };
      }
    }

    return { success: true, shiftAdjustment: null };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * Helper: Check if two dates are same day
 */
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    if (action === 'logBag') {
      var size = (e && e.parameter && e.parameter.size) || '5 kg.';
      result = logManualBagCompletion(size);
      // Clear cache after data modification
      clearProductionCache_();
    } else if (action === 'logPause') {
      var postData = e.postData ? JSON.parse(e.postData.contents) : {};
      var reason = postData.reason || (e.parameter && e.parameter.reason) || 'No reason provided';
      var duration = postData.duration || (e.parameter && e.parameter.duration) || 0;
      result = logTimerPause(reason, duration);
      clearProductionCache_();
    } else if (action === 'logResume') {
      var postData2 = e.postData ? JSON.parse(e.postData.contents) : {};
      var pauseId = postData2.pauseId || (e.parameter && e.parameter.pauseId) || '';
      var actualDuration = postData2.duration || (e.parameter && e.parameter.duration) || 0;
      result = logTimerResume(pauseId, actualDuration);
      clearProductionCache_();
    } else if (action === 'chat') {
      // AI Agent Chat Handler
      var chatData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = handleChatRequest(chatData);
    } else if (action === 'feedback') {
      // AI Feedback Handler
      var feedbackData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = logChatFeedback(feedbackData);
    } else if (action === 'tts') {
      // Text-to-Speech Handler
      var ttsData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = handleTTSRequest(ttsData);
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
 * Performance: Clear production data cache
 **********************************************************/
function clearProductionCache_() {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('scoreboard_data');
    // Clear all dashboard caches (they use dynamic keys)
    cache.removeAll(['scoreboard_data']);
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
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
 * Dashboard Data - For Ops Hub Dashboard
 **********************************************************/
function getProductionDashboardData(startDate, endDate) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();

  // Use date strings directly to avoid timezone issues
  var today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  var startStr = startDate && startDate.match(/^\d{4}-\d{2}-\d{2}$/) ? startDate : today;
  var endStr = endDate && endDate.match(/^\d{4}-\d{2}-\d{2}$/) ? endDate : today;

  // Get scoreboard data for current production info
  var scoreboard = getScoreboardData();

  // Get bag timer data for dashboard
  var bagTimer = getBagTimerData();

  // Get detailed hourly breakdown with smalls and buckers
  var hourlyBreakdown = getTodayHourlyBreakdown_(ss, timezone);

  // Get line breakdown for accurate smalls and buckers totals
  var lineBreakdown = getTodayLineBreakdown_(ss, timezone);

  // Calculate totals from line breakdown
  var totalTops = (lineBreakdown.line1Tops || 0) + (lineBreakdown.line2Tops || 0);
  var totalSmalls = (lineBreakdown.line1Smalls || 0) + (lineBreakdown.line2Smalls || 0);
  var totalLbs = totalTops + totalSmalls;

  // Calculate crew hours
  var hoursWorked = scoreboard.hoursLogged || 0;

  // Trimmers come from both Line 1 and Line 2
  var totalTrimmerHours = (lineBreakdown.line1Trimmers || 0) + (lineBreakdown.line2Trimmers || 0);
  var avgTrimmers = hoursWorked > 0 ? totalTrimmerHours / hoursWorked : 0;
  var trimmers = scoreboard.lastHourTrimmers || scoreboard.currentHourTrimmers || Math.round(avgTrimmers);

  // T-Zero workers from both lines
  var totalTZeroHours = (lineBreakdown.line1TZero || 0) + (lineBreakdown.line2TZero || 0);
  var avgTZero = hoursWorked > 0 ? totalTZeroHours / hoursWorked : 0;
  var tzero = Math.round(avgTZero);

  // QC workers (single column)
  var totalQCHours = lineBreakdown.totalQC || 0;
  var avgQC = hoursWorked > 0 ? totalQCHours / hoursWorked : 0;
  var qc = Math.round(avgQC);

  // Buckers come from both Line 1 and Line 2
  // Note: The 'Buckers' column in spreadsheet includes T-Zero and QC, so we subtract them
  var rawBuckerHours = (lineBreakdown.line1Buckers || 0) + (lineBreakdown.line2Buckers || 0);
  var totalBuckerHours = Math.max(0, rawBuckerHours - totalTZeroHours - totalQCHours);
  var avgBuckers = hoursWorked > 0 ? totalBuckerHours / hoursWorked : 0;
  var buckers = Math.round(avgBuckers);

  var totalOperatorHours = totalTrimmerHours + totalBuckerHours + totalTZeroHours + totalQCHours;

  // Calculate rates from actual data
  var currentRate = scoreboard.lastHourTrimmers > 0 ? (scoreboard.lastHourLbs / scoreboard.lastHourTrimmers) : 0;
  var avgRate = totalTrimmerHours > 0 ? totalTops / totalTrimmerHours : scoreboard.targetRate || 0;
  var maxRate = 0;

  // Find max rate from hourly data
  hourlyBreakdown.forEach(function(hr) {
    if (hr.rate > maxRate) maxRate = hr.rate;
  });
  if (maxRate === 0) maxRate = Math.max(currentRate, avgRate);

  var lbsPerHour = hoursWorked > 0 ? totalLbs / hoursWorked : 0;

  // Build hourly data with tops, smalls, trimmers, buckers, and strain
  var hourlyData = hourlyBreakdown.map(function(hr) {
    return {
      label: hr.timeSlot || '',
      tops: hr.tops || 0,
      smalls: hr.smalls || 0,
      rate: hr.rate || 0,
      trimmers: hr.trimmers || 0,
      buckers: hr.buckers || 0,
      strain: hr.strain || ''
    };
  });

  // Get hourly wage from Data sheet (column O4)
  var dataSheet = ss.getSheetByName('Data');
  var hourlyWage = 15.00; // Fallback
  if (dataSheet) {
    var wageCell = dataSheet.getRange('O4').getValue();
    if (wageCell && !isNaN(parseFloat(wageCell))) {
      hourlyWage = parseFloat(wageCell);
    }
  }

  var totalLaborCost = totalOperatorHours * hourlyWage;
  var costPerLb = totalLbs > 0 ? totalLaborCost / totalLbs : 0;
  var avgCostPerTop = totalTops > 0 ? totalLaborCost / totalTops : 0;
  var avgCostPerSmall = totalSmalls > 0 ? totalLaborCost / totalSmalls : 0;

  // Get weekly/historical summary
  var dailyData = getExtendedDailyDataLine1_(ss, timezone, 7);
  var weeklyTops = 0, weeklySmalls = 0, bestRate = 0;
  dailyData.forEach(function(d) {
    weeklyTops += d.totalTops || 0;
    weeklySmalls += d.totalSmalls || 0;
    if (d.avgRate > bestRate) bestRate = d.avgRate;
  });

  // Calculate 7-day rolling averages for state-based emphasis
  var validDays = dailyData.filter(function(d) { return d.totalTops > 0; });
  var avgTops7Day = validDays.length > 0 ? weeklyTops / validDays.length : 0;
  var avgSmalls7Day = validDays.length > 0 ? validDays.reduce(function(sum, d) { return sum + (d.totalSmalls || 0); }, 0) / validDays.length : 0;
  var avgRate7Day = validDays.length > 0 ? validDays.reduce(function(sum, d) { return sum + (d.avgRate || 0); }, 0) / validDays.length : 0;
  var avgLbs7Day = avgTops7Day + avgSmalls7Day;
  var avgOperatorHours7Day = validDays.length > 0 ? validDays.reduce(function(sum, d) { return sum + (d.totalOperatorHours || 0); }, 0) / validDays.length : 0;
  var avgCostPerLb7Day = avgLbs7Day > 0 ? (avgOperatorHours7Day * hourlyWage) / avgLbs7Day : 0;

  // Build last completed hour info with smalls and buckers
  // Skip the current in-progress hour and show the previous completed hour
  var lastCompleted = null;
  if (hourlyBreakdown.length > 0) {
    var now = new Date();
    var currentHour = now.getHours();

    // Find the last COMPLETED hour (not the current in-progress hour)
    for (var i = hourlyBreakdown.length - 1; i >= 0; i--) {
      var hour = hourlyBreakdown[i];
      // Parse the end hour from timeSlot (e.g., "3:00 PM - 4:00 PM" -> 16)
      var endMatch = hour.timeSlot.match(/[-–]\s*(\d+):.*?(AM|PM)/i);
      if (endMatch) {
        var endHour = parseInt(endMatch[1]);
        var isPM = endMatch[2].toUpperCase() === 'PM';
        if (isPM && endHour !== 12) endHour += 12;
        if (!isPM && endHour === 12) endHour = 0;

        // If current time is past the end hour, this hour is completed
        if (currentHour >= endHour) {
          if (hour.tops > 0 || hour.smalls > 0) {
            lastCompleted = {
              strain: scoreboard.strain || 'Unknown',
              timeSlot: hour.timeSlot || '',
              tops: hour.tops || 0,
              smalls: hour.smalls || 0,
              trimmers: hour.trimmers || 0,
              buckers: hour.buckers || 0,
              rate: hour.rate || 0
            };
          }
          break;
        }
      }
    }
  }

  // Format bag timer data for dashboard
  var bagTimerFormatted = {
    bagsToday: (bagTimer.bags5kgToday || 0) + (bagTimer.bags10lbToday || 0),
    avgTime: bagTimer.avgSecondsToday > 0 ? Math.round(bagTimer.avgSecondsToday / 60) + ' min' : '—',
    avgMinutes: bagTimer.avgSecondsToday > 0 ? bagTimer.avgSecondsToday / 60 : 0,
    vsTarget: bagTimer.avgSeconds7Day > 0 ? Math.round((bagTimer.avgSecondsToday - bagTimer.avgSeconds7Day) / 60) + ' min' : '—'
  };

  return {
    success: true,
    data: {
      dateRange: {
        start: startStr,
        end: endStr,
        label: startStr === endStr ? 'Today' : startStr + ' to ' + endStr
      },
      today: {
        totalTops: totalTops,
        totalSmalls: totalSmalls,
        totalLbs: totalLbs,
        currentRate: currentRate,
        avgRate: avgRate,
        maxRate: maxRate,
        lbsPerHour: lbsPerHour,
        trimmers: trimmers,
        buckers: buckers,
        qc: qc,
        tzero: tzero,
        hoursWorked: hoursWorked,
        totalTrimmerHours: totalTrimmerHours,
        totalBuckerHours: totalBuckerHours,
        totalTZeroHours: totalTZeroHours,
        totalQCHours: totalQCHours,
        totalOperatorHours: totalOperatorHours,
        totalLaborCost: totalLaborCost,
        costPerLb: costPerLb,
        avgCostPerTop: avgCostPerTop,
        avgCostPerSmall: avgCostPerSmall
      },
      weekly: {
        totalDays: dailyData.length,
        totalTops: weeklyTops,
        totalSmalls: weeklySmalls,
        bestRate: bestRate
      },
      rollingAverage: {
        totalTops: avgTops7Day,
        totalSmalls: avgSmalls7Day,
        avgRate: avgRate7Day,
        totalLbs: avgLbs7Day,
        operatorHours: avgOperatorHours7Day,
        costPerLb: avgCostPerLb7Day
      },
      targets: {
        totalTops: scoreboard.todayTarget || 200,
        avgRate: scoreboard.targetRate || 1.0,
        costPerLb: 15.0
      },
      lastCompleted: lastCompleted,
      hourly: hourlyData,
      daily: dailyData.map(function(d) {
        return {
          label: Utilities.formatDate(d.date, timezone, 'MMM d'),
          totalTops: d.totalTops || 0,
          totalSmalls: d.totalSmalls || 0,
          avgRate: d.avgRate || 0,
          crew: d.crew || 0,
          operatorHours: d.operatorHours || 0,
          costPerLb: d.costPerLb || 0,
          totalLbs: d.totalLbs || 0,
          maxRate: d.maxRate || 0,
          trimmerHours: d.trimmerHours || 0,
          laborCost: d.laborCost || 0
        };
      }),
      current: {
        strain: scoreboard.strain,
        trimmers: scoreboard.currentHourTrimmers,
        targetRate: scoreboard.targetRate,
        todayLbs: scoreboard.todayLbs,
        todayTarget: scoreboard.todayTarget,
        todayPercentage: scoreboard.todayPercentage
      },
      bagTimer: bagTimerFormatted,
      strains: []
    }
  };
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

  // Get hourly wage from Data sheet (column O4)
  var dataSheet = ss.getSheetByName('Data');
  var hourlyWage = 15.00; // Fallback
  if (dataSheet) {
    var wageCell = dataSheet.getRange('O4').getValue();
    if (wageCell && !isNaN(parseFloat(wageCell))) {
      hourlyWage = parseFloat(wageCell);
    }
  }

  var dailyMap = {};
  var today = new Date();
  var cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);

  monthSheets.forEach(function(sheet) {
    var vals = sheet.getDataRange().getValues();
    var currentDate = null, cols = null;
    var dayData = {
      totalTops: 0,
      totalSmalls: 0,
      totalTrimmerHours: 0,
      totalBuckerHours: 0,
      totalQCHours: 0,
      totalTZeroHours: 0,
      hoursWorked: 0,
      maxRate: 0,
      hourlyRates: []
    };

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];
      if (row[0] === 'Date:') {
        if (currentDate && (dayData.totalTops > 0 || dayData.totalSmalls > 0) && currentDate >= cutoff) {
          var dateKey = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
          if (!dailyMap[dateKey]) {
            var totalOperatorHours = dayData.totalTrimmerHours + dayData.totalBuckerHours + dayData.totalQCHours + dayData.totalTZeroHours;
            var totalLbs = dayData.totalTops + dayData.totalSmalls;
            var avgCrewPerHour = dayData.hoursWorked > 0 ? totalOperatorHours / dayData.hoursWorked : 0;
            var laborCost = totalOperatorHours * hourlyWage;

            dailyMap[dateKey] = {
              date: new Date(currentDate),
              totalTops: dayData.totalTops,
              totalSmalls: dayData.totalSmalls,
              avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalTops / dayData.totalTrimmerHours : 0,
              crew: Math.round(avgCrewPerHour),
              operatorHours: totalOperatorHours,
              costPerLb: totalLbs > 0 ? laborCost / totalLbs : 0,
              totalLbs: totalLbs,
              maxRate: dayData.maxRate,
              trimmerHours: dayData.totalTrimmerHours,
              laborCost: laborCost
            };
          }
        }
        var dateStr = row[1];
        if (dateStr) {
          var d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            currentDate = d;
            dayData = {
              totalTops: 0,
              totalSmalls: 0,
              totalTrimmerHours: 0,
              totalBuckerHours: 0,
              totalQCHours: 0,
              totalTZeroHours: 0,
              hoursWorked: 0,
              maxRate: 0,
              hourlyRates: []
            };
          }
        }
        var headerRow = vals[i + 1] || [];
        cols = getColumnIndices_(headerRow);
        continue;
      }
      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock_(row)) continue;

      // Line 1 data
      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var smalls1 = parseFloat(row[cols.smalls1]) || 0;
      var tr1 = parseFloat(row[cols.trimmers1]) || 0;
      var buck1 = parseFloat(row[cols.buckers1]) || 0;
      var tz1 = parseFloat(row[cols.tzero1]) || 0;

      // Line 2 data
      var tops2 = parseFloat(row[cols.tops2]) || 0;
      var smalls2 = parseFloat(row[cols.smalls2]) || 0;
      var tr2 = parseFloat(row[cols.trimmers2]) || 0;
      var buck2 = parseFloat(row[cols.buckers2]) || 0;
      var tz2 = parseFloat(row[cols.tzero2]) || 0;

      // QC (shared)
      var qc = parseFloat(row[cols.qc]) || 0;

      // Aggregate totals
      var totalTopsHour = tops1 + tops2;
      var totalSmallsHour = smalls1 + smalls2;
      var totalTrimmersHour = tr1 + tr2;

      if (totalTopsHour > 0 || totalSmallsHour > 0 || totalTrimmersHour > 0) {
        dayData.totalTops += totalTopsHour;
        dayData.totalSmalls += totalSmallsHour;
        dayData.totalTrimmerHours += totalTrimmersHour;
        dayData.totalBuckerHours += buck1 + buck2;
        dayData.totalQCHours += qc;
        dayData.totalTZeroHours += tz1 + tz2;
        dayData.hoursWorked++;

        // Track max rate (lbs/trimmer)
        if (totalTrimmersHour > 0 && totalTopsHour > 0) {
          var hourRate = totalTopsHour / totalTrimmersHour;
          if (hourRate > dayData.maxRate) {
            dayData.maxRate = hourRate;
          }
        }
      }
    }

    // Process last date in sheet
    if (currentDate && (dayData.totalTops > 0 || dayData.totalSmalls > 0) && currentDate >= cutoff) {
      var dateKey2 = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
      if (!dailyMap[dateKey2]) {
        var totalOperatorHours2 = dayData.totalTrimmerHours + dayData.totalBuckerHours + dayData.totalQCHours + dayData.totalTZeroHours;
        var totalLbs2 = dayData.totalTops + dayData.totalSmalls;
        var avgCrewPerHour2 = dayData.hoursWorked > 0 ? totalOperatorHours2 / dayData.hoursWorked : 0;
        var laborCost2 = totalOperatorHours2 * hourlyWage;

        dailyMap[dateKey2] = {
          date: new Date(currentDate),
          totalTops: dayData.totalTops,
          totalSmalls: dayData.totalSmalls,
          avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalTops / dayData.totalTrimmerHours : 0,
          crew: Math.round(avgCrewPerHour2),
          operatorHours: totalOperatorHours2,
          costPerLb: totalLbs2 > 0 ? laborCost2 / totalLbs2 : 0,
          totalLbs: totalLbs2,
          maxRate: dayData.maxRate,
          trimmerHours: dayData.totalTrimmerHours,
          laborCost: laborCost2
        };
      }
    }
  });

  return Object.keys(dailyMap).map(function(k) { return dailyMap[k]; }).sort(function(a, b) { return a.date - b.date; });
}

/**
 * Get order queue for scoreboard display
 * Delegates to wholesale-orders API
 *
 * @returns {object} { success, current, next, queue }
 */
function getScoreboardOrderQueue() {
  try {
    var WHOLESALE_ORDERS_API_URL = 'https://script.google.com/macros/s/AKfycbxU5dBd5GU1RZeJ-UyNFf1Z8n3jCdIZ0VM6nXVj6_A7Pu2VbbxYWXMiDhkkgB3_8L9MyQ/exec';

    // Call wholesale-orders API to get order queue
    var response = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getScoreboardOrderQueue');
    var data = JSON.parse(response.getContentText());

    return data;

  } catch (error) {
    Logger.log('getScoreboardOrderQueue error: ' + error.message);
    return {
      success: false,
      error: error.message,
      current: null,
      next: null,
      queue: { totalShipments: 0, totalKg: 0 }
    };
  }
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
 * Main chat request handler (V2 - with feedback, corrections, and logging)
 */
function handleChatRequest(data) {
  try {
    Logger.log('DEBUG: Received data = ' + JSON.stringify(data));
    var userMessage = data.userMessage || '';
    var history = data.history || [];

    // Handle feedback submission
    if (data.feedback) {
      return logChatFeedback(data.feedback);
    }

    if (!userMessage) {
      return { success: false, error: 'No message provided' };
    }

    // Extract any corrections from conversation history
    var sessionCorrections = extractCorrections(history);

    // Get stored corrections from sheet
    var storedCorrections = getRecentCorrections();

    // Gather current production context (V2 - enhanced)
    var context = gatherProductionContext();

    // Search conversation memory for relevant context
    var memoryResults = searchMemory_(userMessage, true);

    // Build the AI prompt with corrections and memory
    var systemPrompt = buildSystemPrompt(context, sessionCorrections.concat(storedCorrections), memoryResults);

    // Call Anthropic API
    var aiResponse = callAnthropicForChat(systemPrompt, history, userMessage);

    // Log chat for training (async-safe)
    logChatForTraining(userMessage, aiResponse, history.length);

    // Save to persistent memory (new)
    var sessionId = data.sessionId || 'legacy_' + new Date().getTime();
    var contextHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, JSON.stringify(context)).toString();

    // Save user message
    saveToMemory_(sessionId, 'user', userMessage, '', contextHash);

    // Save assistant response
    saveToMemory_(sessionId, 'assistant', aiResponse, '', contextHash);

    // Extract and execute tasks (NEW)
    var tasks = extractTasks_(aiResponse);
    var taskResults = [];

    if (tasks.length > 0) {
      for (var j = 0; j < tasks.length; j++) {
        var task = tasks[j];
        var result = executeTask_(task.task, task.params);
        logTaskExecution_(sessionId, task.task, task.params, result);
        taskResults.push(result);
      }
    }

    // Remove task blocks from response for clean display
    var cleanResponse = removeTaskBlocks_(aiResponse);

    // Check for new corrections in the user's message
    var newCorrections = extractCorrections([{ role: 'user', content: userMessage }]);
    if (newCorrections.length > 0) {
      for (var i = 0; i < newCorrections.length; i++) {
        saveCorrection(newCorrections[i].correction, 'user_correction');
      }
    }

    return {
      success: true,
      response: cleanResponse,
      context: context,
      tasksExecuted: taskResults
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
 * Handle Text-to-Speech request via Google Cloud TTS
 * @param {Object} data - { text: "string to speak" }
 * @returns {Object} { success: boolean, audioBase64: string } or { success: false, error: string }
 */
function handleTTSRequest(data) {
  try {
    // Get Google Cloud TTS API key from script properties
    var apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_TTS_API_KEY');

    if (!apiKey) {
      Logger.log('TTS: API key not configured');
      return { success: false, error: 'TTS not configured' };
    }

    if (!data || !data.text) {
      return { success: false, error: 'No text provided' };
    }

    // Truncate extremely long text (safety limit)
    var text = data.text;
    if (text.length > 5000) {
      text = text.substring(0, 5000) + '...';
    }

    // Call Google Cloud TTS API
    var url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + apiKey;

    var payload = {
      input: { text: text },
      voice: {
        languageCode: 'en-US',
        name: 'en-US-Neural2-A',  // Deep professional male voice
        ssmlGender: 'MALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0.0,
        speakingRate: 1.1  // 10% faster for efficiency
      }
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      Logger.log('TTS API error: ' + responseCode + ' - ' + response.getContentText());
      return { success: false, error: 'TTS API error: ' + responseCode };
    }

    var result = JSON.parse(response.getContentText());

    if (result.audioContent) {
      return {
        success: true,
        audioBase64: result.audioContent  // Base64 encoded MP3
      };
    } else {
      Logger.log('TTS: No audio content in response');
      return { success: false, error: 'No audio content received' };
    }

  } catch (error) {
    Logger.log('TTS Error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy customer name matching
 */
function levenshteinDistance_(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  var matrix = [];

  // Initialize matrix
  for (var i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (var j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (var i = 1; i <= b.length; i++) {
    for (var j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find customer by name using fuzzy matching
 * Returns best match if similarity > 70%, otherwise null
 */
function findCustomerByName_(customerName) {
  try {
    // Fetch customers from wholesale orders API
    var response = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getCustomers', {
      method: 'get',
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('[findCustomerByName] API error: ' + response.getContentText());
      return null;
    }

    var result = JSON.parse(response.getContentText());
    if (!result.success || !result.customers) {
      Logger.log('[findCustomerByName] Invalid response format');
      return null;
    }

    var customers = result.customers;
    var searchName = customerName.toLowerCase().trim();

    // Find best match
    var bestMatch = null;
    var bestScore = 0;

    customers.forEach(function(customer) {
      var companyName = (customer.companyName || '').toLowerCase().trim();

      // Calculate similarity (inverse of distance, normalized)
      var distance = levenshteinDistance_(searchName, companyName);
      var maxLength = Math.max(searchName.length, companyName.length);
      var similarity = maxLength > 0 ? (1 - distance / maxLength) * 100 : 0;

      Logger.log('[findCustomerByName] Match: ' + customer.companyName + ' = ' + similarity + '%');

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = customer;
      }
    });

    // Only return if similarity > 70%
    if (bestScore > 70) {
      Logger.log('[findCustomerByName] Found match: ' + bestMatch.companyName + ' (' + bestScore.toFixed(1) + '%)');
      return bestMatch;
    }

    Logger.log('[findCustomerByName] No match found (best: ' + bestScore.toFixed(1) + '%)');
    return null;

  } catch (error) {
    Logger.log('[findCustomerByName] Error: ' + error.toString());
    return null;
  }
}

/**
 * Execute create_shipment task
 * Creates new shipment with line items linked to customer's active master order
 */
function executeCreateShipment_(params) {
  try {
    Logger.log('[executeCreateShipment] Starting with params: ' + JSON.stringify(params));

    // Find customer by name
    var customer = findCustomerByName_(params.customerName);
    if (!customer) {
      return {
        success: false,
        error: 'Customer not found. Please check the name and try again.',
        searchedFor: params.customerName
      };
    }

    Logger.log('[executeCreateShipment] Found customer: ' + customer.companyName + ' (ID: ' + customer.id + ')');

    // Get customer's active master order
    var masterOrderResponse = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getActiveMasterOrder&customerID=' + encodeURIComponent(customer.id), {
      method: 'get',
      muteHttpExceptions: true
    });

    if (masterOrderResponse.getResponseCode() !== 200) {
      Logger.log('[executeCreateShipment] Failed to get master order: ' + masterOrderResponse.getContentText());
      return {
        success: false,
        error: 'Failed to find active master order for ' + customer.companyName + '. Please create a master order first.'
      };
    }

    var masterOrderResult = JSON.parse(masterOrderResponse.getContentText());
    if (!masterOrderResult.success || !masterOrderResult.masterOrder) {
      return {
        success: false,
        error: 'No active master order found for ' + customer.companyName + '. Please create a master order first.'
      };
    }

    var masterOrder = masterOrderResult.masterOrder;
    Logger.log('[executeCreateShipment] Found master order: ' + masterOrder.id);

    // Get price for strain+type from price history
    var priceResponse = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getPriceForStrain&strain=' + encodeURIComponent(params.strain) + '&type=' + encodeURIComponent(params.type) + '&customerID=' + encodeURIComponent(customer.id), {
      method: 'get',
      muteHttpExceptions: true
    });

    if (priceResponse.getResponseCode() !== 200) {
      Logger.log('[executeCreateShipment] Failed to get price: ' + priceResponse.getContentText());
      return {
        success: false,
        error: 'Failed to get price for ' + params.strain + ' ' + params.type
      };
    }

    var priceResult = JSON.parse(priceResponse.getContentText());
    var unitPrice = priceResult.success && priceResult.price ? priceResult.price : 0;

    if (unitPrice === 0) {
      Logger.log('[executeCreateShipment] No price found for ' + params.strain + ' ' + params.type);
    }

    // Build line items
    var lineItems = [{
      strain: params.strain,
      type: params.type,
      quantity: params.quantity,
      unitPrice: unitPrice,
      total: params.quantity * unitPrice
    }];

    var subTotal = params.quantity * unitPrice;

    // Build shipment data
    var shipmentData = {
      orderID: masterOrder.id,
      shipmentDate: params.shipmentDate || new Date().toISOString().split('T')[0],
      status: 'pending',
      lineItems: lineItems,
      subTotal: subTotal,
      discount: 0,
      freightCost: 0,
      totalAmount: subTotal,
      notes: params.notes || ''
    };

    Logger.log('[executeCreateShipment] Shipment data prepared: ' + JSON.stringify(shipmentData));

    // Call wholesale orders API to save shipment
    var response = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'saveShipment',
        shipment: shipmentData
      }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('[executeCreateShipment] API error: ' + response.getContentText());
      return {
        success: false,
        error: 'Failed to create shipment. Please try again.'
      };
    }

    var result = JSON.parse(response.getContentText());

    if (!result.success) {
      Logger.log('[executeCreateShipment] Save failed: ' + result.error);
      return {
        success: false,
        error: result.error || 'Failed to create shipment'
      };
    }

    Logger.log('[executeCreateShipment] Shipment created: ' + result.shipmentId);

    // Return formatted confirmation
    return {
      success: true,
      message: 'Shipment created successfully!',
      shipmentId: result.shipmentId,
      summary: {
        'Shipment ID': result.shipmentId,
        'Master Order': masterOrder.id,
        'Customer': customer.companyName,
        'Line Items': params.quantity + ' kg ' + params.strain + ' ' + params.type + (unitPrice > 0 ? ' @ $' + unitPrice.toFixed(2) + '/kg' : ''),
        'Total': unitPrice > 0 ? '$' + subTotal.toFixed(2) : 'Price TBD',
        'Status': 'Pending',
        'Shipment Date': shipmentData.shipmentDate
      }
    };

  } catch (error) {
    Logger.log('[executeCreateShipment] Exception: ' + error.toString());
    return {
      success: false,
      error: 'An error occurred while creating the shipment: ' + error.toString()
    };
  }
}

/**
 * Execute get_shipments task
 * Gets all shipments for a customer's active master order
 */
function executeGetShipments_(params) {
  try {
    Logger.log('[executeGetShipments] Starting with params: ' + JSON.stringify(params));

    // Find customer by name
    var customer = findCustomerByName_(params.customerName);
    if (!customer) {
      return {
        success: false,
        error: 'Customer not found. Please check the name and try again.',
        searchedFor: params.customerName
      };
    }

    Logger.log('[executeGetShipments] Found customer: ' + customer.companyName + ' (ID: ' + customer.id + ')');

    // Get customer's active master order
    var masterOrderResponse = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getActiveMasterOrder&customerID=' + encodeURIComponent(customer.id), {
      method: 'get',
      muteHttpExceptions: true
    });

    if (masterOrderResponse.getResponseCode() !== 200) {
      Logger.log('[executeGetShipments] Failed to get master order: ' + masterOrderResponse.getContentText());
      return {
        success: false,
        error: 'Failed to find active master order for ' + customer.companyName
      };
    }

    var masterOrderResult = JSON.parse(masterOrderResponse.getContentText());
    if (!masterOrderResult.success || !masterOrderResult.masterOrder) {
      return {
        success: false,
        error: 'No active master order found for ' + customer.companyName
      };
    }

    var masterOrder = masterOrderResult.masterOrder;
    Logger.log('[executeGetShipments] Found master order: ' + masterOrder.id);

    // Get shipments for this master order
    var shipmentsResponse = UrlFetchApp.fetch(WHOLESALE_ORDERS_API_URL + '?action=getShipments&orderID=' + encodeURIComponent(masterOrder.id), {
      method: 'get',
      muteHttpExceptions: true
    });

    if (shipmentsResponse.getResponseCode() !== 200) {
      Logger.log('[executeGetShipments] Failed to get shipments: ' + shipmentsResponse.getContentText());
      return {
        success: false,
        error: 'Failed to retrieve shipments for ' + customer.companyName
      };
    }

    var shipmentsResult = JSON.parse(shipmentsResponse.getContentText());
    if (!shipmentsResult.success) {
      return {
        success: false,
        error: shipmentsResult.error || 'Failed to retrieve shipments'
      };
    }

    var shipments = shipmentsResult.shipments || [];
    Logger.log('[executeGetShipments] Found ' + shipments.length + ' shipment(s)');

    // Format shipments for display
    if (shipments.length === 0) {
      return {
        success: true,
        message: 'No shipments found for ' + customer.companyName,
        customer: customer.companyName,
        masterOrder: masterOrder.id,
        shipmentCount: 0
      };
    }

    // Build summary
    var shipmentSummaries = shipments.map(function(s) {
      var lineItemsText = (s.lineItems || []).map(function(item) {
        return item.quantity + 'kg ' + item.strain + ' ' + item.type;
      }).join(', ');

      return {
        'Shipment ID': s.id || s.invoiceNumber || 'N/A',
        'Date': s.shipmentDate || 'N/A',
        'Status': s.status || 'pending',
        'Items': lineItemsText || 'No items',
        'Total': s.totalAmount ? '$' + s.totalAmount.toFixed(2) : 'N/A'
      };
    });

    return {
      success: true,
      message: 'Found ' + shipments.length + ' shipment(s) for ' + customer.companyName,
      customer: customer.companyName,
      masterOrder: masterOrder.id,
      shipmentCount: shipments.length,
      shipments: shipmentSummaries
    };

  } catch (error) {
    Logger.log('[executeGetShipments] Exception: ' + error.toString());
    return {
      success: false,
      error: 'An error occurred while retrieving shipments: ' + error.toString()
    };
  }
}

/**
 * Gathers all relevant production data for AI context (V2 - enhanced)
 */
function gatherProductionContext() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();

  var context = {
    timestamp: new Date().toISOString(),
    production: {},
    bags: {},
    crew: {},
    rates: {},
    hourlyBreakdown: [],
    crewChanges: [],
    pauseHistory: [],
    lineBreakdown: {},
    qualityMetrics: {},
    history: {}
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

    // V2: Get hourly breakdown
    context.hourlyBreakdown = getTodayHourlyBreakdown_(ss, timezone);

    // V2: Get crew changes
    context.crewChanges = getRecentCrewChanges_(ss, timezone);

    // V2: Get pause history
    context.pauseHistory = getTodayPauseHistory_(ss, timezone);

    // V2: Get line breakdown (Line 1 vs Line 2)
    context.lineBreakdown = getTodayLineBreakdown_(ss, timezone);

    // V2: Calculate quality metrics
    context.qualityMetrics = calculateQualityMetrics_(context);

    // V2: Get historical data
    context.history = gatherHistoricalData(ss, timezone);

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
 * Builds the system prompt with current production data (V2 - with corrections and enhanced data)
 */
function buildSystemPrompt(context, corrections, memoryResults) {
  var now = new Date();
  var currentTime = Utilities.formatDate(now, 'America/Los_Angeles', 'EEEE, MMMM d, yyyy h:mm a');

  // Calculate derived metrics
  var totalBagsToday = context.bags.totalToday || 0;
  var crewTotal = context.crew.currentTrimmers || context.crew.lastHourTrimmers || 0;
  var avgCycleMinutes = context.bags.avgCycleSeconds ? Math.round(context.bags.avgCycleSeconds / 60) : 0;
  var minutesSinceLastBag = context.bags.secondsSinceLastBag ? Math.round(context.bags.secondsSinceLastBag / 60) : 0;

  // Calculate hours remaining in workday
  var currentHour = now.getHours() + now.getMinutes() / 60;
  var workStartHour = 6; // 6:00 AM
  var workEndHour = 16.5; // 4:30 PM
  var hoursRemaining = Math.max(0, workEndHour - currentHour);
  var effectiveHoursRemaining = hoursRemaining * 0.88; // Account for breaks

  // Detect if we're outside working hours (after midnight, before work starts)
  var isAfterMidnightBeforeWork = currentHour < workStartHour;
  var hasNoProductionData = (context.production.topsToday || 0) === 0 && (context.production.hoursLogged || 0) === 0;

  // Calculate work days remaining this week
  var dayOfWeek = now.getDay();
  var daysRemaining = Math.max(0, 5 - dayOfWeek);

  var prompt = 'You are the Rogue Origin AI Assistant, helping manage a hemp processing facility in Southern Oregon.\n\n' +
    'CURRENT TIME: ' + currentTime + '\n';

  // Add context about work schedule
  if (isAfterMidnightBeforeWork && hasNoProductionData) {
    prompt += '⚠️ NOTE: It\'s currently after midnight but before work starts (work hours: 6 AM - 4:30 PM).\n' +
              'Today\'s production hasn\'t begun yet. When discussing production data, refer to the most recent work day.\n\n';
    prompt += '- Work starts at: 6:00 AM (approximately ' + (workStartHour - currentHour).toFixed(1) + ' hours from now)\n';
  } else {
    prompt += '- Hours remaining today: ' + effectiveHoursRemaining.toFixed(1) + ' effective hours\n';
  }

  prompt += '- Work days remaining this week: ' + daysRemaining + ' (Mon-Fri)\n\n';

  if (isAfterMidnightBeforeWork && hasNoProductionData) {
    prompt += 'MOST RECENT WORK DAY PRODUCTION:\n' +
      '(Note: This data is from the previous work day, not today)\n';
  } else {
    prompt += 'TODAY\'S PRODUCTION:\n';
  }

  prompt += '- Tops produced: ' + (context.production.topsToday || 0).toFixed(1) + ' lbs\n' +
    '- Target: ' + (context.production.todayTarget || 0).toFixed(1) + ' lbs\n' +
    '- Performance: ' + Math.round(context.production.todayPercentage || 0) + '%\n' +
    '- Projected end-of-day: ' + (context.production.projectedTotal || 0).toFixed(1) + ' lbs\n' +
    '- Current strain: ' + (context.production.strain || 'Unknown') + '\n' +
    '- Last hour: ' + (context.production.lastHourLbs || 0) + ' lbs (' + (context.production.lastTimeSlot || 'N/A') + ')\n' +
    '- Hours logged: ' + (context.production.hoursLogged || 0) + '\n\n' +

    'CREW STATUS:\n' +
    '- Current trimmers: ' + crewTotal + '\n';

  // Add crew changes if any
  if (context.crewChanges && context.crewChanges.length > 0) {
    prompt += '- Recent crew changes:\n';
    for (var i = 0; i < Math.min(3, context.crewChanges.length); i++) {
      var change = context.crewChanges[i];
      prompt += '  • ' + change.time + ': ' + change.before + ' → ' + change.after + ' trimmers\n';
    }
  }
  prompt += '\n';

  prompt += 'BAG COMPLETIONS TODAY:\n' +
    '- 5kg bags: ' + (context.bags.fiveKgToday || 0) + '\n' +
    '- 10lb tops bags: ' + (context.bags.tenLbToday || 0) + '\n' +
    '- Total bags: ' + totalBagsToday + '\n' +
    '- Avg cycle time: ' + (avgCycleMinutes || 'N/A') + ' minutes\n' +
    '- 7-day avg: ' + (context.bags.avgCycle7Day ? Math.round(context.bags.avgCycle7Day / 60) : 'N/A') + ' minutes\n' +
    '- Minutes since last bag: ' + (minutesSinceLastBag || 'N/A') + '\n\n';

  prompt += 'PRODUCTION RATE:\n' +
    '- Target rate: ' + (context.rates.targetRate || 1.0).toFixed(2) + ' lbs/person/hour\n' +
    '- vs Yesterday: ' + formatComparison(context.rates.vsYesterday) + '\n' +
    '- vs 7-day avg: ' + formatComparison(context.rates.vs7Day) + '\n\n';

  // Add hourly breakdown if available
  if (context.hourlyBreakdown && context.hourlyBreakdown.length > 0) {
    prompt += 'HOURLY BREAKDOWN TODAY:\n';
    for (var j = 0; j < context.hourlyBreakdown.length; j++) {
      var hour = context.hourlyBreakdown[j];
      prompt += '  ' + hour.timeSlot + ': ' + hour.tops.toFixed(1) + ' lbs, ' + hour.trimmers + ' trimmers';
      if (hour.buckers > 0) prompt += ', ' + hour.buckers + ' buckers';
      prompt += '\n';
    }
    prompt += '\n';
  }

  // Add line breakdown if both lines have data
  if (context.lineBreakdown && (context.lineBreakdown.line1Tops > 0 || context.lineBreakdown.line2Tops > 0)) {
    var line1Crew = ((context.lineBreakdown.line1Trimmers || 0) / (context.production.hoursLogged || 1)).toFixed(0);
    var line1Buckers = ((context.lineBreakdown.line1Buckers || 0) / (context.production.hoursLogged || 1)).toFixed(0);
    var line2Crew = ((context.lineBreakdown.line2Trimmers || 0) / (context.production.hoursLogged || 1)).toFixed(0);
    var line2Buckers = ((context.lineBreakdown.line2Buckers || 0) / (context.production.hoursLogged || 1)).toFixed(0);

    prompt += 'LINE BREAKDOWN:\n' +
      '- Line 1: ' + (context.lineBreakdown.line1Tops || 0).toFixed(1) + ' lbs tops, ' + (context.lineBreakdown.line1Smalls || 0).toFixed(1) + ' lbs smalls (' + line1Crew + ' trimmers, ' + line1Buckers + ' buckers)\n' +
      '- Line 2: ' + (context.lineBreakdown.line2Tops || 0).toFixed(1) + ' lbs tops, ' + (context.lineBreakdown.line2Smalls || 0).toFixed(1) + ' lbs smalls (' + line2Crew + ' trimmers, ' + line2Buckers + ' buckers)\n\n';
  }

  // Add quality metrics
  if (context.qualityMetrics && context.qualityMetrics.topsToSmallsRatio) {
    prompt += 'QUALITY METRICS:\n' +
      '- Tops:Smalls ratio: ' + context.qualityMetrics.topsToSmallsRatio + '\n' +
      '- Tops %: ' + (context.qualityMetrics.topsPercentage || 0).toFixed(1) + '%\n\n';
  }

  // Add pause history if any
  if (context.pauseHistory && context.pauseHistory.length > 0) {
    prompt += 'BREAKS/PAUSES TODAY:\n';
    for (var k = 0; k < context.pauseHistory.length; k++) {
      var pause = context.pauseHistory[k];
      prompt += '  • ' + pause.time + ': ' + pause.reason + ' (' + pause.duration + ' min)\n';
    }
    prompt += '\n';
  }

  // Add historical data
  if (context.history) {
    if (context.history.last30Days && context.history.last30Days.totalLbs > 0) {
      prompt += 'LAST 30 DAYS:\n' +
        '- Total: ' + context.history.last30Days.totalLbs.toFixed(1) + ' lbs over ' + context.history.last30Days.daysWorked + ' days\n' +
        '- Daily average: ' + context.history.last30Days.avgDaily.toFixed(1) + ' lbs\n';
      if (context.history.last30Days.bestDay) {
        prompt += '- Best day: ' + context.history.last30Days.bestDay.date + ' (' + context.history.last30Days.bestDay.lbs.toFixed(1) + ' lbs)\n';
      }
      prompt += '\n';
    }

    if (context.history.weekOverWeek) {
      prompt += 'WEEK OVER WEEK:\n' +
        '- This week: ' + context.history.weekOverWeek.thisWeek.toFixed(1) + ' lbs\n' +
        '- Last week: ' + context.history.weekOverWeek.lastWeek.toFixed(1) + ' lbs\n' +
        '- Change: ' + formatComparison(context.history.weekOverWeek.change) + '\n\n';
    }

    if (context.history.dailyStrainBreakdown && context.history.dailyStrainBreakdown.length > 0) {
      prompt += 'DETAILED DAILY STRAIN BREAKDOWN (Last 14 Days):\n';
      for (var m = 0; m < context.history.dailyStrainBreakdown.length; m++) {
        var day = context.history.dailyStrainBreakdown[m];
        prompt += day.dayOfWeek + ' (' + day.date + '):\n';
        for (var n = 0; n < day.strains.length; n++) {
          var strain = day.strains[n];
          prompt += '  • ' + strain.name + ': ' + strain.tops.toFixed(1) + ' lbs tops';
          if (strain.smalls > 0) prompt += ', ' + strain.smalls.toFixed(1) + ' lbs smalls';
          prompt += '\n';
        }
      }
      prompt += '\n';
    }
  }

  prompt += buildOrdersPromptSection(context.orders) + '\n\n';

  // Add learned corrections
  if (corrections && corrections.length > 0) {
    prompt += 'LEARNED CORRECTIONS (remember these):\n';
    for (var p = 0; p < corrections.length; p++) {
      prompt += '• ' + corrections[p].correction + '\n';
    }
    prompt += '\n';
  }

  // Add relevant memory if found
  if (memoryResults && memoryResults.found) {
    prompt += 'RELEVANT PAST CONVERSATIONS:\n';
    for (var i = 0; i < memoryResults.topMatches.length; i++) {
      var match = memoryResults.topMatches[i];
      prompt += '- ' + match.summary + ' (' + match.timestamp + ')\n';
    }
    prompt += '\n';
  }

  prompt += 'PROJECTION FORMULAS:\n' +
    '- 1 kg = 2.205 lbs\n' +
    '- 5kg bag = 11.02 lbs\n' +
    '- Hours needed = lbs ÷ (trimmers × rate)\n' +
    '- Effective hours/day = 7.5\n\n';

  prompt += 'RESPONSE GUIDELINES:\n' +
    '1. Be concise and friendly - the boss reads this on his phone\n' +
    '2. Lead with the most important number or insight\n' +
    '3. Use simple comparisons ("ahead of yesterday", "on track")\n' +
    '4. If you don\'t have data for something, say so honestly\n' +
    '5. Use emojis sparingly for visual scanning (📊 📦 👥 ⚡ 📈 📉)\n\n' +

    'For data display, use this HTML format:\n' +
    '<div class="data-card">\n' +
    '  <h4>Title</h4>\n' +
    '  <div class="metric"><span class="metric-label">Label</span><span class="metric-value">Value</span></div>\n' +
    '</div>\n\n';

  // TASK EXECUTION CAPABILITIES
  prompt += 'TASK EXECUTION:\n' +
    'You can execute tasks on behalf of the user. When appropriate, include a task in your response.\n\n' +
    'Available tasks:\n';

  for (var taskName in TASK_REGISTRY) {
    var task = TASK_REGISTRY[taskName];
    prompt += '- ' + taskName + ': ' + task.description + '\n';
    prompt += '  Parameters: ' + JSON.stringify(task.parameters) + '\n';
  }

  prompt += '\n**Shipment Management:**\n' +
    '- Create shipments for existing master orders\n' +
    '- View/query shipments for a customer\n' +
    '- Required for creation: customer name, strain, type (Tops/Smalls), quantity (kg)\n' +
    '- Required for querying: customer name\n' +
    '- Optional: shipment date, notes\n' +
    '- Auto-matches customer names with fuzzy matching\n' +
    '- Looks up prices from customer price history\n' +
    '- Links to customer\'s active master order automatically\n' +
    '- Returns shipment ID and formatted summary\n' +
    '- IMPORTANT: If any required information is missing (strain name, type, or quantity), ask the user before proceeding\n' +
    '- Example: If user says "ship to Green Valley", ask "What strain, type (Tops/Smalls), and quantity should I ship?"\n';

  prompt += '\nTo execute a task, include this JSON block in your response:\n' +
    '```task\n' +
    '{\n' +
    '  "task": "task_name",\n' +
    '  "params": { "param1": "value1" }\n' +
    '}\n' +
    '```\n\n' +
    'Examples:\n' +
    'User: "Set trimmers to 5 on Line 1"\n' +
    'Assistant: "I\'ll update the crew count for you.\n```task\n{"task":"update_crew_count","params":{"line":1,"role":"trimmers","count":5}}\n```\nDone! Line 1 now has 5 trimmers."\n\n' +
    'User: "Log a 5kg bag"\n' +
    'Assistant: "Logging the bag completion now.\n```task\n{"task":"log_bag_completion","params":{"bagType":"5kg"}}\n```\nBag logged successfully!"\n\n' +
    'User: "Create a shipment for Green Valley Farm, 100kg Lifter Tops"\n' +
    'Assistant: "I\'ll create that shipment for you.\n```task\n{"task": "create_shipment", "params": {"customerName": "Green Valley Farm", "strain": "Lifter", "type": "Tops", "quantity": 100}}\n```"\n\n' +
    'User: "New shipment: Mountain Organics, 50kg Blue Dream Smalls, shipping Feb 15"\n' +
    'Assistant: "Creating shipment with those details.\n```task\n{"task": "create_shipment", "params": {"customerName": "Mountain Organics", "strain": "Blue Dream", "type": "Smalls", "quantity": 50, "shipmentDate": "2026-02-15"}}\n```"\n\n' +
    'User: "What shipments exist for Cannaflora?"\n' +
    'Assistant: "Let me check Cannaflora\'s shipments.\n```task\n{"task": "get_shipments", "params": {"customerName": "Cannaflora"}}\n```"\n\n' +
    'User: "Show me Green Valley\'s shipments"\n' +
    'Assistant: "I\'ll pull up their shipment history.\n```task\n{"task": "get_shipments", "params": {"customerName": "Green Valley"}}\n```"\n\n' +
    'Only suggest tasks when the user clearly wants an action performed, not just information.\n\n';

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

/**********************************************************
 * AI AGENT V2 HELPER FUNCTIONS
 **********************************************************/

/**
 * Get today's hourly breakdown with detailed data per hour
 */
function getTodayHourlyBreakdown_(ss, timezone) {
  var result = [];
  var sheet = getLatestMonthSheet_(ss);
  if (!sheet) return result;

  var todayLabel = Utilities.formatDate(new Date(), timezone, 'MMMM dd, yyyy');
  var vals = sheet.getDataRange().getValues();
  var dateRowIndex = findDateRow_(vals, todayLabel);

  if (dateRowIndex === -1) return result;

  var headerRowIndex = dateRowIndex + 1;
  var headers = vals[headerRowIndex] || [];
  var cols = getColumnIndices_(headers);

  for (var r = headerRowIndex + 1; r < vals.length; r++) {
    var row = vals[r];
    if (isEndOfBlock_(row)) break;

    var timeSlot = row[0] || '';
    var tops1 = parseFloat(row[cols.tops1]) || 0;
    var smalls1 = parseFloat(row[cols.smalls1]) || 0;
    var trimmers1 = parseFloat(row[cols.trimmers1]) || 0;
    var buckers1 = parseFloat(row[cols.buckers1]) || 0;

    if (tops1 > 0 || trimmers1 > 0) {
      result.push({
        timeSlot: timeSlot,
        tops: tops1,
        smalls: smalls1,
        trimmers: trimmers1,
        buckers: buckers1,
        rate: trimmers1 > 0 ? tops1 / trimmers1 : 0
      });
    }
  }

  return result;
}

/**
 * Get recent crew changes from the CrewChangeLog sheet
 */
function getRecentCrewChanges_(ss, timezone) {
  var result = [];
  var sheet = ss.getSheetByName('CrewChangeLog');
  if (!sheet) return result;

  var today = new Date();
  var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');

  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1 && result.length < 5; i--) {
    var row = data[i];
    var timestamp = row[0];
    if (timestamp instanceof Date) {
      var dateStr = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');
      if (dateStr === todayStr) {
        var trimmersChange = row[6] || '';
        var parts = trimmersChange.split(' → ');
        if (parts.length === 2) {
          result.push({
            time: Utilities.formatDate(timestamp, timezone, 'h:mm a'),
            before: parseInt(parts[0]) || 0,
            after: parseInt(parts[1]) || 0,
            timeSlot: row[4] || ''
          });
        }
      }
    }
  }

  return result;
}

/**
 * Get today's pause/break history from Timer Pause Log
 */
function getTodayPauseHistory_(ss, timezone) {
  var result = [];
  var sheet = ss.getSheetByName('Timer Pause Log');
  if (!sheet) return result;

  var today = new Date();
  var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var dateStr = row[1];
    if (dateStr === todayStr) {
      var duration = parseFloat(row[4]) || 0;
      if (duration > 0) {
        result.push({
          time: row[2],
          reason: row[5] || 'Break',
          duration: Math.round(duration)
        });
      }
    }
  }

  return result;
}

/**
 * Get today's line breakdown (Line 1 vs Line 2)
 */
function getTodayLineBreakdown_(ss, timezone) {
  var result = {
    line1Tops: 0,
    line1Smalls: 0,
    line1Trimmers: 0,
    line1Buckers: 0,
    line1TZero: 0,
    line2Tops: 0,
    line2Smalls: 0,
    line2Trimmers: 0,
    line2Buckers: 0,
    line2TZero: 0,
    totalQC: 0
  };

  var sheet = getLatestMonthSheet_(ss);
  if (!sheet) return result;

  var todayLabel = Utilities.formatDate(new Date(), timezone, 'MMMM dd, yyyy');
  var vals = sheet.getDataRange().getValues();
  var dateRowIndex = findDateRow_(vals, todayLabel);

  if (dateRowIndex === -1) return result;

  var headerRowIndex = dateRowIndex + 1;
  var headers = vals[headerRowIndex] || [];
  var cols = getColumnIndices_(headers);

  for (var r = headerRowIndex + 1; r < vals.length; r++) {
    var row = vals[r];
    if (isEndOfBlock_(row)) break;

    result.line1Tops += parseFloat(row[cols.tops1]) || 0;
    result.line1Smalls += parseFloat(row[cols.smalls1]) || 0;
    result.line1Trimmers += parseFloat(row[cols.trimmers1]) || 0;
    result.line1Buckers += parseFloat(row[cols.buckers1]) || 0;
    result.line1TZero += parseFloat(row[cols.tzero1]) || 0;
    result.line2Tops += parseFloat(row[cols.tops2]) || 0;
    result.line2Smalls += parseFloat(row[cols.smalls2]) || 0;
    result.line2Trimmers += parseFloat(row[cols.trimmers2]) || 0;
    result.line2Buckers += parseFloat(row[cols.buckers2]) || 0;
    result.line2TZero += parseFloat(row[cols.tzero2]) || 0;
    result.totalQC += parseFloat(row[cols.qc]) || 0;
  }

  return result;
}

/**
 * Calculate quality metrics (tops vs smalls ratio)
 */
function calculateQualityMetrics_(context) {
  var result = {
    topsToSmallsRatio: 'N/A',
    topsPercentage: 0
  };

  var line = context.lineBreakdown || {};
  var totalTops = (line.line1Tops || 0) + (line.line2Tops || 0);
  var totalSmalls = (line.line1Smalls || 0) + (line.line2Smalls || 0);

  if (totalTops > 0 && totalSmalls > 0) {
    var ratio = totalTops / totalSmalls;
    result.topsToSmallsRatio = ratio.toFixed(1) + ':1';
  } else if (totalTops > 0) {
    result.topsToSmallsRatio = 'All tops (no smalls)';
  }

  var total = totalTops + totalSmalls;
  if (total > 0) {
    result.topsPercentage = (totalTops / total) * 100;
  }

  return result;
}

/**
 * Extract corrections from conversation history
 */
function extractCorrections(history) {
  var corrections = [];
  if (!history || history.length < 1) return corrections;

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

/**
 * Extract task blocks from AI response
 * Returns array of {task, params} objects
 */
function extractTasks_(responseText) {
  var tasks = [];
  var taskPattern = /```task\s*\n([\s\S]*?)\n```/g;
  var match;

  while ((match = taskPattern.exec(responseText)) !== null) {
    try {
      var taskJson = JSON.parse(match[1]);
      if (taskJson.task && taskJson.params) {
        tasks.push(taskJson);
      }
    } catch (error) {
      Logger.log('Failed to parse task JSON: ' + error.message);
    }
  }

  return tasks;
}

/**
 * Remove task blocks from response text
 * Returns clean text for display to user
 */
function removeTaskBlocks_(responseText) {
  return responseText.replace(/```task\s*\n[\s\S]*?\n```/g, '').trim();
}

/**
 * Log chat for training purposes
 */
function logChatForTraining(userMessage, aiResponse, historyLength) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Chat_Log');

    if (!sheet) {
      sheet = ss.insertSheet('AI_Chat_Log');
      sheet.appendRow(['Timestamp', 'Question', 'Response', 'Conversation Turn', 'Feedback', 'Notes']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#668971').setFontColor('#fff');
    }

    var truncatedResponse = aiResponse.length > 500 ? aiResponse.substring(0, 500) + '...' : aiResponse;
    sheet.appendRow([new Date(), userMessage, truncatedResponse, historyLength + 1, '', '']);
  } catch (error) {
    Logger.log('Error logging chat: ' + error.message);
  }
}

/**
 * Log feedback for a chat response
 */
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

/**
 * Get recent corrections from AI_Corrections sheet
 */
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

/**
 * Save a correction to AI_Corrections sheet
 */
function saveCorrection(correction, category) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('AI_Corrections');
    if (!sheet) {
      sheet = ss.insertSheet('AI_Corrections');
      sheet.appendRow(['Timestamp', 'Correction', 'Status', 'Category']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#668971').setFontColor('#fff');
    }
    sheet.appendRow([new Date(), correction, 'active', category || 'general']);
    return { success: true, message: 'Correction saved' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Initialize or get AI_Memory sheet with Mem0-inspired schema
 * 3-tier memory: short (session), mid (7 days), long (all history)
 */
function getOrCreateMemorySheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('AI_Memory');

  if (!sheet) {
    sheet = ss.insertSheet('AI_Memory');

    // Header row
    var headers = [
      'Session ID',      // UUID for conversation grouping
      'Timestamp',       // When message was sent
      'User ID',         // Who sent it (future: multi-user)
      'Message Type',    // user/assistant/system
      'Message',         // Full message text
      'Summary',         // AI-generated summary (for search)
      'Keywords',        // Comma-separated keywords for search
      'Entities',        // JSON: {strains:[], crew:[], dates:[]}
      'Context Hash',    // SHA1 of production context (detect changes)
      'Tier',            // short/mid/long (for memory lifecycle)
      'Embedding Score', // Future: semantic similarity score
      'Related IDs'      // Comma-separated related session IDs
    ];

    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#668971')
      .setFontColor('#ffffff');

    // Set column widths for readability
    sheet.setColumnWidth(1, 120);  // Session ID
    sheet.setColumnWidth(2, 150);  // Timestamp
    sheet.setColumnWidth(5, 300);  // Message
    sheet.setColumnWidth(6, 200);  // Summary
    sheet.setColumnWidth(7, 200);  // Keywords
  }

  return sheet;
}

/**
 * Update memory tiers based on age (Mem0 pattern)
 * short: last 24 hours (in-memory context)
 * mid: 2-7 days (quick lookup)
 * long: 7+ days (keyword search only)
 */
function updateMemoryTiers_() {
  try {
    var sheet = getOrCreateMemorySheet_();
    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    var sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (var i = 1; i < data.length; i++) {
      var timestamp = new Date(data[i][1]);
      var currentTier = data[i][9];
      var newTier;

      if (timestamp > oneDayAgo) {
        newTier = 'short';
      } else if (timestamp > sevenDaysAgo) {
        newTier = 'mid';
      } else {
        newTier = 'long';
      }

      if (currentTier !== newTier) {
        sheet.getRange(i + 1, 10).setValue(newTier);
      }
    }
  } catch (error) {
    Logger.log('Error updating memory tiers: ' + error.message);
  }
}

/**
 * Save message to AI_Memory sheet
 * Extracts keywords and entities for search
 */
function saveToMemory_(sessionId, messageType, message, summary, contextHash) {
  try {
    var sheet = getOrCreateMemorySheet_();
    var timestamp = new Date();

    // Extract keywords (simple approach: significant words)
    var keywords = extractKeywords_(message);

    // Extract entities (strains, crew mentions, dates)
    var entities = extractEntities_(message);

    // Determine tier (new messages start as 'short')
    var tier = 'short';

    // Append row
    sheet.appendRow([
      sessionId,
      timestamp,
      'default_user',  // Future: multi-user support
      messageType,
      message,
      summary || message.substring(0, 100),
      keywords.join(', '),
      JSON.stringify(entities),
      contextHash || '',
      tier,
      0,  // Embedding score (future)
      ''  // Related IDs (future)
    ]);

    return { success: true };
  } catch (error) {
    Logger.log('Error saving to memory: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Extract keywords from message (simple word frequency)
 */
function extractKeywords_(text) {
  // Remove common stop words
  var stopWords = ['the', 'is', 'at', 'which', 'on', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during'];

  var words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 3 && stopWords.indexOf(w) === -1; });

  // Get unique words
  var uniqueWords = [];
  for (var i = 0; i < words.length; i++) {
    if (uniqueWords.indexOf(words[i]) === -1) {
      uniqueWords.push(words[i]);
    }
  }

  return uniqueWords.slice(0, 10);  // Top 10 keywords
}

/**
 * Extract entities from message (strains, numbers, dates)
 */
function extractEntities_(text) {
  var entities = {
    strains: [],
    numbers: [],
    dates: []
  };

  // Common strain names
  var strains = ['lifter', 'sour lifter', 'cherry', 'abacus', 'bubba kush'];
  for (var i = 0; i < strains.length; i++) {
    if (text.toLowerCase().indexOf(strains[i]) !== -1) {
      entities.strains.push(strains[i]);
    }
  }

  // Extract numbers (lbs, counts, etc.)
  var numberMatches = text.match(/\d+\.?\d*/g);
  if (numberMatches) {
    entities.numbers = numberMatches.slice(0, 5);
  }

  // Extract date mentions (today, yesterday, Monday, etc.)
  var dateMentions = ['today', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  for (var j = 0; j < dateMentions.length; j++) {
    if (text.toLowerCase().indexOf(dateMentions[j]) !== -1) {
      entities.dates.push(dateMentions[j]);
    }
  }

  return entities;
}

/**
 * Layer 1: Fast keyword search (returns IDs only)
 * Mem0-inspired: search across keywords column
 */
function searchMemoryKeywords_(query, limit) {
  limit = limit || 10;
  var sheet = getOrCreateMemorySheet_();
  var data = sheet.getDataRange().getValues();
  var results = [];

  // Extract query keywords
  var queryKeywords = extractKeywords_(query);

  // Search through memory entries
  for (var i = 1; i < data.length; i++) {
    var rowKeywords = data[i][6].toLowerCase().split(', ');
    var score = 0;

    // Calculate match score
    for (var j = 0; j < queryKeywords.length; j++) {
      if (rowKeywords.indexOf(queryKeywords[j]) !== -1) {
        score++;
      }
    }

    if (score > 0) {
      results.push({
        row: i + 1,
        sessionId: data[i][0],
        timestamp: data[i][1],
        score: score,
        messageType: data[i][3],
        summary: data[i][5]
      });
    }
  }

  // Sort by score descending
  results.sort(function(a, b) { return b.score - a.score; });

  return results.slice(0, limit);
}

/**
 * Layer 2: Get timeline context around a memory entry
 * Returns messages before/after for conversation flow
 */
function getMemoryTimeline_(sessionId, anchorRow, beforeCount, afterCount) {
  beforeCount = beforeCount || 2;
  afterCount = afterCount || 2;

  var sheet = getOrCreateMemorySheet_();
  var data = sheet.getDataRange().getValues();
  var timeline = [];

  // Find all messages in this session
  var sessionMessages = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === sessionId) {
      sessionMessages.push({
        row: i + 1,
        timestamp: data[i][1],
        messageType: data[i][3],
        summary: data[i][5]
      });
    }
  }

  // Sort by timestamp
  sessionMessages.sort(function(a, b) {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  // Find anchor position
  var anchorIndex = -1;
  for (var j = 0; j < sessionMessages.length; j++) {
    if (sessionMessages[j].row === anchorRow) {
      anchorIndex = j;
      break;
    }
  }

  if (anchorIndex === -1) return [];

  // Get surrounding messages
  var startIndex = Math.max(0, anchorIndex - beforeCount);
  var endIndex = Math.min(sessionMessages.length - 1, anchorIndex + afterCount);

  return sessionMessages.slice(startIndex, endIndex + 1);
}

/**
 * Layer 3: Get full message details for specific rows
 * Only called after filtering in Layer 1 & 2
 */
function getMemoryDetails_(rows) {
  var sheet = getOrCreateMemorySheet_();
  var results = [];

  for (var i = 0; i < rows.length; i++) {
    var rowData = sheet.getRange(rows[i], 1, 1, 12).getValues()[0];
    results.push({
      sessionId: rowData[0],
      timestamp: rowData[1],
      userId: rowData[2],
      messageType: rowData[3],
      message: rowData[4],
      summary: rowData[5],
      keywords: rowData[6],
      entities: rowData[7],
      tier: rowData[9]
    });
  }

  return results;
}

/**
 * Search memory with 3-layer pattern (token-efficient)
 * 1. Keyword search → get relevant IDs
 * 2. Timeline context → understand conversation flow
 * 3. Full details → only for filtered results
 */
function searchMemory_(query, includeTimeline) {
  includeTimeline = includeTimeline !== false;

  // Layer 1: Keyword search
  var matches = searchMemoryKeywords_(query, 5);

  if (matches.length === 0) {
    return { found: false, matches: [] };
  }

  // Layer 2: Get timeline for top match
  var timeline = [];
  if (includeTimeline && matches.length > 0) {
    timeline = getMemoryTimeline_(matches[0].sessionId, matches[0].row, 2, 2);
  }

  // Layer 3: Get full details for top 3 matches
  var detailRows = matches.slice(0, 3).map(function(m) { return m.row; });
  var details = getMemoryDetails_(detailRows);

  return {
    found: true,
    query: query,
    matchCount: matches.length,
    topMatches: details,
    timeline: timeline
  };
}

/**
 * Validate task parameters against schema
 */
function validateTaskParams_(taskName, params) {
  var task = TASK_REGISTRY[taskName];
  if (!task) {
    return { valid: false, error: 'Unknown task: ' + taskName };
  }

  var schema = task.parameters;
  var errors = [];

  // Check required parameters
  for (var key in schema) {
    var paramSchema = schema[key];
    var value = params[key];

    // Required check
    if (paramSchema.required && (value === undefined || value === null || value === '')) {
      errors.push('Missing required parameter: ' + key);
      continue;
    }

    if (value === undefined || value === null) continue;

    // Type check
    if (paramSchema.type === 'number' && typeof value !== 'number') {
      errors.push('Parameter ' + key + ' must be a number');
    }
    if (paramSchema.type === 'string' && typeof value !== 'string') {
      errors.push('Parameter ' + key + ' must be a string');
    }

    // Range check for numbers
    if (paramSchema.type === 'number') {
      if (paramSchema.min !== undefined && value < paramSchema.min) {
        errors.push('Parameter ' + key + ' must be >= ' + paramSchema.min);
      }
      if (paramSchema.max !== undefined && value > paramSchema.max) {
        errors.push('Parameter ' + key + ' must be <= ' + paramSchema.max);
      }
    }

    // Length check for strings
    if (paramSchema.type === 'string' && paramSchema.maxLength) {
      if (value.length > paramSchema.maxLength) {
        errors.push('Parameter ' + key + ' exceeds max length of ' + paramSchema.maxLength);
      }
    }

    // Options check (enum)
    if (paramSchema.options) {
      if (paramSchema.options.indexOf(value) === -1) {
        errors.push('Parameter ' + key + ' must be one of: ' + paramSchema.options.join(', '));
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  return { valid: true };
}

/**
 * Execute a validated task
 */
function executeTask_(taskName, params) {
  // Validate
  var validation = validateTaskParams_(taskName, params);
  if (!validation.valid) {
    return {
      success: false,
      error: 'Validation failed',
      details: validation.errors || validation.error
    };
  }

  // Get task function
  var task = TASK_REGISTRY[taskName];
  var functionName = task.function;

  // Execute
  try {
    var result = this[functionName](params);
    return {
      success: true,
      task: taskName,
      result: result
    };
  } catch (error) {
    Logger.log('Task execution error: ' + error.message);
    return {
      success: false,
      error: error.message,
      task: taskName
    };
  }
}

/**
 * Create or get AI_Tasks sheet for logging
 */
function getOrCreateTasksSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('AI_Tasks');

  if (!sheet) {
    sheet = ss.insertSheet('AI_Tasks');
    var headers = ['Timestamp', 'Session ID', 'Task Name', 'Parameters', 'Status', 'Result', 'Error'];
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7)
      .setFontWeight('bold')
      .setBackground('#668971')
      .setFontColor('#ffffff');
  }

  return sheet;
}

/**
 * Log task execution
 */
function logTaskExecution_(sessionId, taskName, params, result) {
  try {
    var sheet = getOrCreateTasksSheet_();
    sheet.appendRow([
      new Date(),
      sessionId,
      taskName,
      JSON.stringify(params),
      result.success ? 'success' : 'failed',
      result.success ? JSON.stringify(result.result) : '',
      result.error || ''
    ]);
  } catch (error) {
    Logger.log('Error logging task: ' + error.message);
  }
}

/**
 * Execute: Update crew count
 */
function executeUpdateCrewCount_(params) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var timezone = ss.getSpreadsheetTimeZone();
  var sheet = getLatestMonthSheet_(ss);

  if (!sheet) {
    throw new Error('Could not find current month sheet');
  }

  // Get today's date label
  var today = Utilities.formatDate(new Date(), timezone, 'EEEE, MMMM d, yyyy');
  var vals = sheet.getDataRange().getValues();
  var dateRow = findDateRow_(vals, today);

  if (!dateRow) {
    throw new Error('Could not find today\'s date in sheet');
  }

  // Get column indices
  var headers = vals[dateRow];
  var colIndices = getColumnIndices_(headers);

  // Determine which column to update
  var columnKey = params.role + params.line;  // e.g., "trimmers1"
  var colIndex = colIndices[columnKey];

  if (!colIndex) {
    throw new Error('Could not find column for ' + params.role + ' Line ' + params.line);
  }

  // Get current hour
  var currentHour = new Date().getHours();
  var targetRow = dateRow + 2 + currentHour - 7;  // Assuming work starts at 7am

  // Update cell
  var oldValue = sheet.getRange(targetRow, colIndex).getValue();
  sheet.getRange(targetRow, colIndex).setValue(params.count);

  // Log change to CrewChangeLog
  var changeLog = getCrewChangeLog_(ss, timezone);
  changeLog.appendRow([
    new Date(),
    'AI Assistant',
    sheet.getName(),
    targetRow,
    Utilities.formatDate(new Date(), timezone, 'h:00 a - h:59 a'),
    params.role === 'buckers' ? (oldValue + ' → ' + params.count) : '',
    params.role === 'trimmers' ? (oldValue + ' → ' + params.count) : ''
  ]);

  return {
    line: params.line,
    role: params.role,
    oldCount: oldValue,
    newCount: params.count,
    timeSlot: Utilities.formatDate(new Date(), timezone, 'h:00 a')
  };
}

/**
 * Execute: Log bag completion
 */
function executeLogBag_(params) {
  // Call existing logBagCompletion function
  var result = logBagCompletion({
    bagType: params.bagType,
    weight: params.weight,
    notes: params.notes || 'Logged via AI Assistant'
  });

  return {
    bagType: params.bagType,
    weight: params.weight || (params.bagType === '5kg' ? 11.02 : 10.0),
    timestamp: new Date().toISOString(),
    bagId: result.bagId || 'unknown'
  };
}

/**
 * Execute: Schedule order
 */
function executeScheduleOrder_(params) {
  // Generate order ID
  var orderId = 'ORD-' + Date.now().toString().slice(-6);

  // In production, this would:
  // 1. Create entry in Orders sheet
  // 2. Calculate ETA based on current production rate
  // 3. Notify relevant parties

  // For now, return structured data
  return {
    orderId: orderId,
    customer: params.customer,
    totalKg: params.totalKg,
    dueDate: params.dueDate,
    cultivars: params.cultivars || 'Not specified',
    notes: params.notes || '',
    status: 'pending',
    message: 'Order ' + orderId + ' created for ' + params.customer
  };
}

/**
 * Execute: Pause timer
 */
function executePauseTimer_(params) {
  var result = logTimerPause({
    reason: params.reason,
    notes: params.notes || ''
  });

  return {
    pauseId: result.pauseId || 'pause_' + Date.now(),
    reason: params.reason,
    timestamp: new Date().toISOString(),
    message: 'Timer paused: ' + params.reason
  };
}

/**
 * Execute: Resume timer
 */
function executeResumeTimer_(params) {
  var result = logTimerResume();

  return {
    resumedAt: new Date().toISOString(),
    duration: result.duration || 0,
    message: 'Timer resumed after ' + (result.duration || 0) + ' seconds'
  };
}

/**
 * Execute: Get order status
 */
function executeGetOrderStatus_(params) {
  // This would query Orders sheet in production
  // For now, return mock data structure

  return {
    orderId: params.orderId,
    customer: 'Sample Customer',
    totalKg: 1400,
    completedKg: 580,
    remainingKg: 820,
    status: 'in_progress',
    percentComplete: 41,
    estimatedCompletion: '2026-02-01',
    cultivars: 'Lifter, Cherry',
    message: 'Order ' + params.orderId + ' is 41% complete'
  };
}

/**
 * Gather historical data for AI context
 */
function gatherHistoricalData(ss, timezone) {
  var history = {
    last7Days: [],
    last30Days: { totalLbs: 0, avgDaily: 0, daysWorked: 0, bestDay: null, worstDay: null },
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
          date: Utilities.formatDate(dateObj, timezone, 'yyyy-MM-dd'),
          dayOfWeek: dayOfWeek,
          lbs: d.totalTops || 0,
          avgRate: d.avgRate || 0
        };
      });

      var totalLbs30 = 0, bestDay = null, worstDay = null;
      dailyData.forEach(function(d) {
        var lbs = d.totalTops || 0;
        totalLbs30 += lbs;
        if (lbs > 0) {
          var dateStr = Utilities.formatDate(new Date(d.date), timezone, 'MMM d');
          if (!bestDay || lbs > bestDay.lbs) bestDay = { date: dateStr, lbs: lbs };
          if (!worstDay || lbs < worstDay.lbs) worstDay = { date: dateStr, lbs: lbs };
        }
      });

      var daysWithData = dailyData.filter(function(d) { return (d.totalTops || 0) > 0; }).length;
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
        var thisWeekLbs = thisWeek.reduce(function(sum, d) { return sum + (d.totalTops || 0); }, 0);
        var lastWeekLbs = lastWeek.reduce(function(sum, d) { return sum + (d.totalTops || 0); }, 0);
        history.weekOverWeek = {
          thisWeek: thisWeekLbs,
          lastWeek: lastWeekLbs,
          change: lastWeekLbs > 0 ? ((thisWeekLbs - lastWeekLbs) / lastWeekLbs * 100) : 0
        };
      }
    }

    history.dailyStrainBreakdown = getDailyStrainBreakdown_(ss, timezone, 14);

  } catch (error) {
    Logger.log('Error gathering historical data: ' + error.message);
  }

  return history;
}

/**
 * Get daily strain breakdown for the last N days
 */
function getDailyStrainBreakdown_(ss, timezone, days) {
  var result = [];

  var monthSheets = ss.getSheets().filter(function(sh) { return /^\d{4}-\d{2}$/.test(sh.getName()); })
    .sort(function(a, b) { return b.getName().localeCompare(a.getName()); });

  if (monthSheets.length === 0) return result;

  var today = new Date();
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);

  var dailyMap = {};

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
      if (!currentDate || !cols || currentDate < cutoff || currentDate >= today) continue;
      if (isEndOfBlock_(row)) continue;

      var dateKey = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          dayOfWeek: Utilities.formatDate(currentDate, timezone, 'EEEE'),
          strains: {}
        };
      }

      var cv1 = row[cols.cultivar1] || 'Unknown';
      var tops1 = parseFloat(row[cols.tops1]) || 0;
      var smalls1 = parseFloat(row[cols.smalls1]) || 0;

      if (tops1 > 0 || smalls1 > 0) {
        if (!dailyMap[dateKey].strains[cv1]) {
          dailyMap[dateKey].strains[cv1] = { name: cv1, tops: 0, smalls: 0 };
        }
        dailyMap[dateKey].strains[cv1].tops += tops1;
        dailyMap[dateKey].strains[cv1].smalls += smalls1;
      }
    }
  });

  var sortedDays = Object.keys(dailyMap).sort().reverse();
  for (var j = 0; j < sortedDays.length; j++) {
    var day = dailyMap[sortedDays[j]];
    day.strains = Object.values(day.strains).sort(function(a, b) { return b.tops - a.tops; });
    result.push(day);
  }

  return result;
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

/**********************************************************
 * WHOLESALE ORDER MANAGEMENT SYSTEM
 * Comprehensive order, customer, shipment, and payment tracking
 **********************************************************/

// ============================================================
// CUSTOMERS MANAGEMENT
// ============================================================

var CUSTOMERS_SHEET_NAME = 'Customers';

/**
 * Get all customers
 */
function getCustomers() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);

    if (!sheet) {
      sheet = createCustomersSheet_(ss);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, customers: [] };
    }

    var customers = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;

      customers.push({
        id: row[0],
        companyName: row[1],
        contactName: row[2],
        email: row[3],
        phone: row[4],
        shipToAddress: row[5],
        billToAddress: row[6],
        country: row[7],
        notes: row[8],
        createdDate: formatDateForJSON_(row[9]),
        lastOrderDate: formatDateForJSON_(row[10])
      });
    }

    return { success: true, customers: customers };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save (create or update) a customer
 */
function saveCustomer(customerData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);

    if (!sheet) {
      sheet = createCustomersSheet_(ss);
    }

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;

    // Check if customer exists
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === customerData.id) {
        existingRow = i + 1;
        break;
      }
    }

    // Generate ID if new customer
    if (!customerData.id) {
      customerData.id = 'CUST-' + String(data.length).padStart(3, '0');
    }

    var row = [
      customerData.id,
      customerData.companyName || '',
      customerData.contactName || '',
      customerData.email || '',
      customerData.phone || '',
      customerData.shipToAddress || '',
      customerData.billToAddress || '',
      customerData.country || '',
      customerData.notes || '',
      customerData.createdDate || new Date(),
      customerData.lastOrderDate || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return { success: true, customer: customerData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a customer
 */
function deleteCustomer(customerId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);

    if (!sheet) {
      return { success: false, error: 'Customers sheet not found' };
    }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === customerId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: 'Customer not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Create Customers sheet
 */
function createCustomersSheet_(ss) {
  var sheet = ss.insertSheet(CUSTOMERS_SHEET_NAME);

  var headers = [
    'CustomerID',
    'CompanyName',
    'ContactName',
    'Email',
    'Phone',
    'ShipToAddress',
    'BillToAddress',
    'Country',
    'Notes',
    'CreatedDate',
    'LastOrderDate'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 100);  // CustomerID
  sheet.setColumnWidth(2, 200);  // CompanyName
  sheet.setColumnWidth(3, 150);  // ContactName
  sheet.setColumnWidth(4, 200);  // Email
  sheet.setColumnWidth(5, 120);  // Phone
  sheet.setColumnWidth(6, 300);  // ShipToAddress
  sheet.setColumnWidth(7, 300);  // BillToAddress
  sheet.setColumnWidth(8, 100);  // Country
  sheet.setColumnWidth(9, 200);  // Notes
  sheet.setColumnWidth(10, 100); // CreatedDate
  sheet.setColumnWidth(11, 100); // LastOrderDate

  return sheet;
}

/**
 * Test function to manually verify executeGetShipments_ works
 * Run this from Apps Script editor to test shipment querying
 */
function testGetShipments() {
  var result = executeGetShipments_({
    customerName: "Cannaflora"
  });

  Logger.log('Result: ' + JSON.stringify(result, null, 2));
  return result;
}
