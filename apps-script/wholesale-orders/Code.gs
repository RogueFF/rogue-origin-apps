/**********************************************************
 * WHOLESALE ORDER MANAGEMENT SYSTEM
 * Standalone Google Apps Script Backend
 *
 * Data Sheets:
 * - Customers: Customer directory
 * - MasterOrders: Order commitments (~$56K each)
 * - Shipments: Individual shipments with line items
 * - Payments: Payment records
 * - PriceHistory: Last price per strain+type
 * - COA_Index: COA files from Google Drive
 **********************************************************/

// ===== CONFIGURATION =====
// Sheet ID for wholesale orders database
var SHEET_ID = '1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw';
var COA_FOLDER_ID = '1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO';

/**********************************************************
 * SECURITY: Input Validation Functions
 * Prevents formula injection and validates user inputs
 **********************************************************/

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

  return str.trim();
}

/**
 * Validates a date string input
 * Prevents formula injection attacks
 *
 * @param {string} dateStr - The date string to validate
 * @returns {object} { valid: boolean, value: string|Date|null, error: string|null }
 */
function validateDateInput(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '') {
    return { valid: true, value: null, error: null };
  }

  // If already a Date object, return it
  if (dateStr instanceof Date) {
    return { valid: true, value: dateStr, error: null };
  }

  var str = String(dateStr).trim();

  // SECURITY: Block formula injection attempts
  var formulaPatterns = [
    /^[=+\-@]/,
    /IMPORTDATA|IMPORTXML|IMPORTHTML|IMPORTRANGE|HYPERLINK|WEBSERVICE|SCRIPT/i,
    /<[^>]+>/
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

  // Try to parse as a date
  var parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    return {
      valid: false,
      value: null,
      error: 'Invalid date format'
    };
  }

  return { valid: true, value: str, error: null };
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

  // Check for formula injection
  if (/^[=+\-@]/.test(str) || /IMPORT|HYPERLINK|SCRIPT/i.test(str)) {
    return {
      valid: false,
      value: null,
      error: 'Invalid ID: potential injection detected'
    };
  }

  // Only allow alphanumeric, dashes, underscores
  if (!/^[A-Za-z0-9_\-]+$/.test(str)) {
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

/**
 * Validates a numeric input
 *
 * @param {any} input - The input to validate
 * @param {object} options - { min, max, allowNegative }
 * @returns {object} { valid: boolean, value: number|null, error: string|null }
 */
function validateNumericInput(input, options) {
  options = options || {};
  var min = options.min !== undefined ? options.min : 0;
  var max = options.max !== undefined ? options.max : Number.MAX_SAFE_INTEGER;

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

  if (num < min || num > max) {
    return { valid: false, value: null, error: 'Number out of range (' + min + ' to ' + max + ')' };
  }

  return { valid: true, value: num, error: null };
}

/**
 * Validates an email address
 *
 * @param {string} input - The email to validate
 * @returns {object} { valid: boolean, value: string|null, error: string|null }
 */
function validateEmail(input) {
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: '', error: null };
  }

  var str = String(input).trim();

  // Check for injection attempts
  if (/^[=+\-@]/.test(str) && str.length < 3) {
    return { valid: false, value: null, error: 'Invalid email format' };
  }

  // Basic email pattern
  if (str && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    return { valid: false, value: null, error: 'Invalid email format' };
  }

  return { valid: true, value: str, error: null };
}

/**
 * Sanitizes customer/order data object
 *
 * @param {object} data - The data object to sanitize
 * @param {object} schema - Field definitions { fieldName: { type, maxLength, required } }
 * @returns {object} { valid: boolean, data: object, errors: array }
 */
function sanitizeDataObject(data, schema) {
  var sanitized = {};
  var errors = [];

  for (var field in schema) {
    var def = schema[field];
    var value = data[field];

    if (def.type === 'string') {
      sanitized[field] = sanitizeString(value, def.maxLength || 500);
    } else if (def.type === 'number') {
      var numResult = validateNumericInput(value, { min: def.min, max: def.max });
      if (!numResult.valid && value !== null && value !== undefined && value !== '') {
        errors.push(field + ': ' + numResult.error);
      }
      sanitized[field] = numResult.value;
    } else if (def.type === 'date') {
      var dateResult = validateDateInput(value);
      if (!dateResult.valid) {
        errors.push(field + ': ' + dateResult.error);
      }
      sanitized[field] = dateResult.value;
    } else if (def.type === 'email') {
      var emailResult = validateEmail(value);
      if (!emailResult.valid) {
        errors.push(field + ': ' + emailResult.error);
      }
      sanitized[field] = emailResult.value;
    } else if (def.type === 'id') {
      var idResult = validateId(value);
      if (!idResult.valid && def.required) {
        errors.push(field + ': ' + idResult.error);
      }
      sanitized[field] = idResult.value;
    } else {
      // Default: sanitize as string
      sanitized[field] = sanitizeString(value, 500);
    }

    // Check required fields
    if (def.required && (sanitized[field] === null || sanitized[field] === undefined || sanitized[field] === '')) {
      errors.push(field + ' is required');
    }
  }

  return {
    valid: errors.length === 0,
    data: sanitized,
    errors: errors
  };
}

// ===== WEB APP ROUTING =====
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    if (action === 'validatePassword') {
      // Handle authentication via GET to avoid CORS preflight issues
      // Password validation - sanitize but don't restrict characters
      var password = e.parameter.password || '';
      result = validatePassword(password);
    } else if (action === 'getCustomers') {
      result = getCustomers();
    } else if (action === 'getMasterOrders') {
      result = getMasterOrders();
    } else if (action === 'getShipments') {
      // SECURITY: Validate orderID parameter
      var orderIdValidation = validateId(e.parameter.orderID);
      if (e.parameter.orderID && !orderIdValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + orderIdValidation.error };
      } else {
        result = getShipments(orderIdValidation.value);
      }
    } else if (action === 'getPayments') {
      // SECURITY: Validate orderID parameter
      var orderIdValidation = validateId(e.parameter.orderID);
      if (e.parameter.orderID && !orderIdValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + orderIdValidation.error };
      } else {
        result = getPayments(orderIdValidation.value);
      }
    } else if (action === 'getPriceHistory') {
      result = getPriceHistory();
    } else if (action === 'getCOAIndex') {
      result = getCOAIndex();
    } else if (action === 'syncCOAIndex') {
      result = syncCOAIndex();
    } else if (action === 'getCOAsForStrains') {
      // Get COA PDFs for a list of strains (base64 encoded)
      var strainsParam = e.parameter.strains;
      if (!strainsParam) {
        result = { success: false, error: 'Missing strains parameter' };
      } else {
        var strainList = strainsParam.split(',').map(function(s) { return s.trim(); });
        result = getCOAsForStrains(strainList);
      }
    } else if (action === 'getOrderFinancials') {
      // SECURITY: Validate orderID parameter
      var orderIdValidation = validateId(e.parameter.orderID);
      if (!orderIdValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + orderIdValidation.error };
      } else {
        result = getOrderFinancials(orderIdValidation.value);
      }
    } else if (action === 'getScoreboardOrderQueue') {
      result = getScoreboardOrderQueue();
    } else if (action === 'getOrderForPortal') {
      // PUBLIC: Customer portal order view (no password required)
      var orderIdValidation = validateId(e.parameter.orderID);
      if (!orderIdValidation.valid) {
        result = { success: false, error: 'Invalid order ID' };
      } else {
        result = getOrderForPortal(orderIdValidation.value);
      }
    } else if (action === 'getActiveMasterOrder') {
      var customerID = e.parameter.customerID;
      return ContentService.createTextOutput(
        JSON.stringify(handleGetActiveMasterOrder_(customerID))
      ).setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'getPriceForStrain') {
      var strain = e.parameter.strain;
      var type = e.parameter.type;
      var customerID = e.parameter.customerID || '';
      return ContentService.createTextOutput(
        JSON.stringify(handleGetPriceForStrain_(strain, type, customerID))
      ).setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'test') {
      result = { ok: true, message: 'Wholesale Orders API working', timestamp: new Date().toISOString() };
    } else {
      result = {
        ok: true,
        message: 'Rogue Origin Wholesale Orders API',
        endpoints: ['getCustomers', 'getMasterOrders', 'getShipments', 'getPayments', 'getScoreboardOrderQueue', 'getActiveMasterOrder', 'getPriceForStrain', 'validatePassword', 'test'],
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {
    console.error('doGet error:', err.message, err.stack);
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Schema definitions for data validation
var CUSTOMER_SCHEMA = {
  id: { type: 'id' },
  companyName: { type: 'string', maxLength: 200, required: true },
  contactName: { type: 'string', maxLength: 200 },
  email: { type: 'email' },
  phone: { type: 'string', maxLength: 50 },
  shipToAddress: { type: 'string', maxLength: 500 },
  billToAddress: { type: 'string', maxLength: 500 },
  country: { type: 'string', maxLength: 100 },
  notes: { type: 'string', maxLength: 2000 },
  createdDate: { type: 'date' },
  lastOrderDate: { type: 'date' }
};

var ORDER_SCHEMA = {
  id: { type: 'id' },
  customerID: { type: 'id' },
  customerName: { type: 'string', maxLength: 200 },
  commitmentAmount: { type: 'number', min: 0 },
  currency: { type: 'string', maxLength: 10 },
  status: { type: 'string', maxLength: 50 },
  poNumber: { type: 'string', maxLength: 100 },
  terms: { type: 'string', maxLength: 50 },
  createdDate: { type: 'date' },
  dueDate: { type: 'date' },
  shipTo_Contact: { type: 'string', maxLength: 200 },
  shipTo_Company: { type: 'string', maxLength: 200 },
  shipTo_Address: { type: 'string', maxLength: 500 },
  shipTo_Phone: { type: 'string', maxLength: 50 },
  shipTo_Email: { type: 'email' },
  soldTo_Contact: { type: 'string', maxLength: 200 },
  soldTo_Company: { type: 'string', maxLength: 200 },
  soldTo_Address: { type: 'string', maxLength: 500 },
  soldTo_Phone: { type: 'string', maxLength: 50 },
  soldTo_Email: { type: 'email' },
  notes: { type: 'string', maxLength: 2000 }
};

var PAYMENT_SCHEMA = {
  id: { type: 'id' },
  orderID: { type: 'id', required: true },
  paymentDate: { type: 'date' },
  amount: { type: 'number', min: 0 },
  method: { type: 'string', maxLength: 100 },
  reference: { type: 'string', maxLength: 200 },
  notes: { type: 'string', maxLength: 1000 },
  recordedBy: { type: 'string', maxLength: 200 },
  recordedDate: { type: 'date' }
};

function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    // Handle JSON payload actions
    var jsonData = null;
    if (e.postData && e.postData.contents) {
      try {
        jsonData = JSON.parse(e.postData.contents);
        if (jsonData.action) {
          action = jsonData.action;
        }
      } catch (parseError) {
        // Not JSON, continue with query parameter action
      }
    }

    if (action === 'saveOrder') {
      var orderData = e.postData ? JSON.parse(e.postData.contents) : {};
      return ContentService.createTextOutput(
        JSON.stringify(handleSaveOrder_(orderData))
      ).setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'saveCustomer') {
      var customerData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate and sanitize customer data
      var validation = sanitizeDataObject(customerData, CUSTOMER_SCHEMA);
      if (!validation.valid) {
        result = { success: false, error: 'Validation errors: ' + validation.errors.join(', ') };
      } else {
        result = saveCustomer(validation.data);
      }
    } else if (action === 'deleteCustomer') {
      var deleteData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate customer ID
      var idValidation = validateId(deleteData.id);
      if (!idValidation.valid) {
        result = { success: false, error: 'Invalid customer ID: ' + idValidation.error };
      } else {
        result = deleteCustomer(idValidation.value);
      }
    } else if (action === 'saveMasterOrder') {
      var orderData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate and sanitize order data
      var validation = sanitizeDataObject(orderData, ORDER_SCHEMA);
      if (!validation.valid) {
        result = { success: false, error: 'Validation errors: ' + validation.errors.join(', ') };
      } else {
        result = saveMasterOrder(validation.data);
      }
    } else if (action === 'deleteMasterOrder') {
      var deleteData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate order ID
      var idValidation = validateId(deleteData.orderID);
      if (!idValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + idValidation.error };
      } else {
        result = deleteMasterOrder(idValidation.value);
      }
    } else if (action === 'deleteShipment') {
      var deleteData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate shipment ID
      var idValidation = validateId(deleteData.shipmentID);
      if (!idValidation.valid) {
        result = { success: false, error: 'Invalid shipment ID: ' + idValidation.error };
      } else {
        result = deleteShipment(idValidation.value);
      }
    } else if (action === 'savePayment') {
      var paymentData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate and sanitize payment data
      var validation = sanitizeDataObject(paymentData, PAYMENT_SCHEMA);
      if (!validation.valid) {
        result = { success: false, error: 'Validation errors: ' + validation.errors.join(', ') };
      } else {
        result = savePayment(validation.data);
      }
    } else if (action === 'updateOrderPriority') {
      var priorityData = e.postData ? JSON.parse(e.postData.contents) : {};
      // SECURITY: Validate order ID and priority
      var idValidation = validateId(priorityData.orderID);
      var priorityValidation = validateNumericInput(priorityData.newPriority, { min: 0, max: 9999, allowNull: true });

      if (!idValidation.valid) {
        result = { success: false, error: 'Invalid order ID: ' + idValidation.error };
      } else if (!priorityValidation.valid) {
        result = { success: false, error: 'Invalid priority value: ' + priorityValidation.error };
      } else {
        result = updateOrderPriority(idValidation.value, priorityValidation.value);
      }
    } else if (action === 'saveShipment') {
      var shipmentData = e.postData ? JSON.parse(e.postData.contents) : {};
      return ContentService.createTextOutput(
        JSON.stringify(handleSaveShipment_(shipmentData))
      ).setMimeType(ContentService.MimeType.JSON);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== AUTHENTICATION =====
/**
 * Validates password against Script Properties
 * Password is stored securely in Script Properties (not in code or Git)
 *
 * Setup: File > Project properties > Script properties > Add property:
 * - Property name: ORDERS_PASSWORD
 * - Value: your-secure-password
 */
function validatePassword(enteredPassword) {
  try {
    // Get password from Script Properties (similar to Claude API key storage)
    var scriptProperties = PropertiesService.getScriptProperties();
    var storedPassword = scriptProperties.getProperty('ORDERS_PASSWORD');

    if (!storedPassword) {
      return {
        success: false,
        error: 'Password not configured in Script Properties. Set ORDERS_PASSWORD property.'
      };
    }

    if (enteredPassword === storedPassword) {
      // Generate session token (valid for 30 days by default)
      var sessionToken = generateSessionToken_();
      return {
        success: true,
        sessionToken: sessionToken,
        expiresIn: 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds
      };
    } else {
      return {
        success: false,
        error: 'Invalid password'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generates a secure session token
 * Format: timestamp + random string, hashed
 */
function generateSessionToken_() {
  var timestamp = new Date().getTime();
  var random = Math.random().toString(36).substring(2, 15);
  var scriptProperties = PropertiesService.getScriptProperties();
  var storedPassword = scriptProperties.getProperty('ORDERS_PASSWORD');

  // Create token from timestamp + random + password hash
  var tokenString = timestamp + '-' + random + '-' + storedPassword;

  // Simple hash (for demonstration - in production use better hashing)
  var hash = Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    tokenString
  ));

  return hash.substring(0, 32); // Return first 32 chars
}

// ===== CUSTOMERS MANAGEMENT =====
var CUSTOMERS_SHEET_NAME = 'Customers';

function getCustomers() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) sheet = createCustomersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, customers: [] };

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

function saveCustomer(customerData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) sheet = createCustomersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === customerData.id) {
        existingRow = i + 1;
        break;
      }
    }

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

function deleteCustomer(customerId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Customers sheet not found' };

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

function createCustomersSheet_(ss) {
  var sheet = ss.insertSheet(CUSTOMERS_SHEET_NAME);
  var headers = [
    'CustomerID', 'CompanyName', 'ContactName', 'Email', 'Phone',
    'ShipToAddress', 'BillToAddress', 'Country', 'Notes',
    'CreatedDate', 'LastOrderDate'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== MASTER ORDERS MANAGEMENT =====
var MASTER_ORDERS_SHEET_NAME = 'MasterOrders';

function getMasterOrders() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!sheet) sheet = createMasterOrdersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, orders: [] };

    var orders = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      orders.push({
        id: row[0],
        customerID: row[1],
        customerName: row[2],
        commitmentAmount: parseFloat(row[3]) || 0,
        currency: row[4] || 'USD',
        status: row[5] || 'pending',
        poNumber: row[6],
        terms: row[7] || 'DAP',
        createdDate: formatDateForJSON_(row[8]),
        dueDate: formatDateForJSON_(row[9]),
        shipTo_Contact: row[10],
        shipTo_Company: row[11],
        shipTo_Address: row[12],
        shipTo_Phone: row[13],
        shipTo_Email: row[14],
        soldTo_Contact: row[15],
        soldTo_Company: row[16],
        soldTo_Address: row[17],
        soldTo_Phone: row[18],
        soldTo_Email: row[19],
        notes: row[20],
        priority: parseInt(row[21]) || null
      });
    }
    return { success: true, orders: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveMasterOrder(orderData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!sheet) sheet = createMasterOrdersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!orderData.id) {
      var year = new Date().getFullYear();
      // Find the highest existing order number for this year
      var maxOrderNum = 0;
      for (var i = 1; i < data.length; i++) {
        var existingId = data[i][0];
        if (existingId && existingId.toString().startsWith('MO-' + year + '-')) {
          var numStr = existingId.toString().split('-')[2];
          var num = parseInt(numStr, 10);
          if (num > maxOrderNum) maxOrderNum = num;
        }
      }
      var nextOrderNum = maxOrderNum + 1;
      orderData.id = 'MO-' + year + '-' + String(nextOrderNum).padStart(3, '0');
    }

    var row = [
      orderData.id,
      orderData.customerID || '',
      orderData.customerName || '',
      orderData.commitmentAmount || 0,
      orderData.currency || 'USD',
      orderData.status || 'pending',
      orderData.poNumber || '',
      orderData.terms || 'DAP',
      orderData.createdDate || new Date(),
      orderData.dueDate || '',
      orderData.shipTo_Contact || '',
      orderData.shipTo_Company || '',
      orderData.shipTo_Address || '',
      orderData.shipTo_Phone || '',
      orderData.shipTo_Email || '',
      orderData.soldTo_Contact || '',
      orderData.soldTo_Company || '',
      orderData.soldTo_Address || '',
      orderData.soldTo_Phone || '',
      orderData.soldTo_Email || '',
      orderData.notes || '',
      orderData.priority || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true, order: orderData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function deleteMasterOrder(orderID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);

    // Delete the master order
    var ordersSheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!ordersSheet) {
      return { success: false, error: 'Orders sheet not found' };
    }

    var data = ordersSheet.getDataRange().getValues();
    var rowToDelete = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderID) {
        rowToDelete = i + 1; // +1 because sheet rows are 1-indexed
        break;
      }
    }

    if (rowToDelete === -1) {
      return { success: false, error: 'Order not found' };
    }

    ordersSheet.deleteRow(rowToDelete);

    // Also delete associated shipments
    var shipmentsSheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (shipmentsSheet) {
      var shipmentData = shipmentsSheet.getDataRange().getValues();
      // Delete from bottom to top to avoid row index shifting issues
      for (var i = shipmentData.length - 1; i >= 1; i--) {
        if (shipmentData[i][1] === orderID) { // Column B is OrderID in Shipments
          shipmentsSheet.deleteRow(i + 1);
        }
      }
    }

    // Also delete associated payments
    var paymentsSheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
    if (paymentsSheet) {
      var paymentData = paymentsSheet.getDataRange().getValues();
      // Delete from bottom to top to avoid row index shifting issues
      for (var i = paymentData.length - 1; i >= 1; i--) {
        if (paymentData[i][1] === orderID) { // Column B is OrderID in Payments
          paymentsSheet.deleteRow(i + 1);
        }
      }
    }

    return { success: true, message: 'Order and associated records deleted successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createMasterOrdersSheet_(ss) {
  var sheet = ss.insertSheet(MASTER_ORDERS_SHEET_NAME);
  var headers = [
    'OrderID', 'CustomerID', 'CustomerName', 'CommitmentAmount', 'Currency',
    'Status', 'PONumber', 'Terms', 'CreatedDate', 'DueDate',
    'ShipTo_Contact', 'ShipTo_Company', 'ShipTo_Address', 'ShipTo_Phone', 'ShipTo_Email',
    'SoldTo_Contact', 'SoldTo_Company', 'SoldTo_Address', 'SoldTo_Phone', 'SoldTo_Email',
    'Notes', 'Priority'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== SHIPMENTS MANAGEMENT =====
var SHIPMENTS_SHEET_NAME = 'Shipments';

function getShipments(orderID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) sheet = createShipmentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, shipments: [] };

    var shipments = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (orderID && row[1] !== orderID) continue;

      var shipment = {
        id: row[0],
        orderID: row[1],
        invoiceNumber: row[2],
        shipmentDate: formatDateForJSON_(row[3]),
        startDateTime: row[4] ? String(row[4]) : null, // Keep as string, no timezone conversion
        status: row[5] || 'pending',
        dimensionsJSON: row[6] || '{}',
        lineItemsJSON: row[7] || '[]',
        subTotal: parseFloat(row[8]) || 0,
        discount: parseFloat(row[9]) || 0,
        freightCost: parseFloat(row[10]) || 0,
        totalAmount: parseFloat(row[11]) || 0,
        trackingNumber: row[12] || '',
        carrier: row[13] || '',
        notes: row[14] || ''
      };

      try {
        shipment.dimensions = JSON.parse(shipment.dimensionsJSON);
        shipment.lineItems = JSON.parse(shipment.lineItemsJSON);
      } catch (e) {
        shipment.dimensions = {};
        shipment.lineItems = [];
      }
      shipments.push(shipment);
    }
    return { success: true, shipments: shipments };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveShipment(shipmentData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) sheet = createShipmentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === shipmentData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!shipmentData.id) {
      var orderNum = shipmentData.orderID ? shipmentData.orderID.split('-').pop() : '000';
      shipmentData.id = 'SH-' + orderNum + '-' + String(data.length).padStart(2, '0');
    }
    if (!shipmentData.invoiceNumber) {
      shipmentData.invoiceNumber = getNextInvoiceNumber();
    }

    var row = [
      shipmentData.id,
      shipmentData.orderID || '',
      shipmentData.invoiceNumber,
      shipmentData.shipmentDate || new Date(),
      shipmentData.startDateTime ? String(shipmentData.startDateTime) : '', // Store as string to preserve timezone
      shipmentData.status || 'pending',
      JSON.stringify(shipmentData.dimensions || {}),
      JSON.stringify(shipmentData.lineItems || []),
      shipmentData.subTotal || 0,
      shipmentData.discount || 0,
      shipmentData.freightCost || 0,
      shipmentData.totalAmount || 0,
      shipmentData.trackingNumber || '',
      shipmentData.carrier || '',
      shipmentData.notes || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
      // Set startDateTime cell (column 5) to plain text format to prevent auto-conversion
      if (shipmentData.startDateTime) {
        sheet.getRange(existingRow, 5).setNumberFormat('@STRING@');
      }
    } else {
      sheet.appendRow(row);
      var newRow = sheet.getLastRow();
      // Set startDateTime cell (column 5) to plain text format to prevent auto-conversion
      if (shipmentData.startDateTime) {
        sheet.getRange(newRow, 5).setNumberFormat('@STRING@');
      }
    }

    // Update price history
    if (shipmentData.lineItems && shipmentData.lineItems.length > 0) {
      for (var j = 0; j < shipmentData.lineItems.length; j++) {
        var item = shipmentData.lineItems[j];
        if (item.strain && item.type && item.unitPrice) {
          updatePriceHistory(item.strain, item.type, item.unitPrice);
        }
      }
    }
    return { success: true, shipment: shipmentData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function deleteShipment(shipmentID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) {
      return { success: false, error: 'Shipments sheet not found' };
    }

    var data = sheet.getDataRange().getValues();
    var rowToDelete = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === shipmentID) {
        rowToDelete = i + 1; // +1 because sheet rows are 1-indexed
        break;
      }
    }

    if (rowToDelete === -1) {
      return { success: false, error: 'Shipment not found' };
    }

    sheet.deleteRow(rowToDelete);
    return { success: true, message: 'Shipment deleted successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getNextInvoiceNumber() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) return 'INV-' + new Date().getFullYear() + '-0001';

    var data = sheet.getDataRange().getValues();
    var year = new Date().getFullYear();
    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var invoice = data[i][2] || '';
      if (invoice.indexOf('INV-' + year) === 0) {
        var num = parseInt(invoice.split('-').pop());
        if (num > maxNum) maxNum = num;
      }
    }
    return 'INV-' + year + '-' + String(maxNum + 1).padStart(4, '0');
  } catch (error) {
    return 'INV-' + new Date().getFullYear() + '-0001';
  }
}

function createShipmentsSheet_(ss) {
  var sheet = ss.insertSheet(SHIPMENTS_SHEET_NAME);
  var headers = [
    'ShipmentID', 'OrderID', 'InvoiceNumber', 'ShipmentDate', 'StartDateTime', 'Status',
    'DimensionsJSON', 'LineItemsJSON', 'SubTotal', 'Discount', 'FreightCost',
    'TotalAmount', 'TrackingNumber', 'Carrier', 'Notes'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Migration function: Adds StartDateTime column to existing Shipments sheet if it doesn't exist
 * Run this once after deploying the startDateTime feature
 */
function migrateShipmentsAddStartDateTime() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) {
      Logger.log('Shipments sheet does not exist yet');
      return { success: true, message: 'Sheet does not exist yet, will be created with correct headers' };
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var startDateTimeIndex = headers.indexOf('StartDateTime');

    if (startDateTimeIndex !== -1) {
      Logger.log('StartDateTime column already exists at index: ' + startDateTimeIndex);
      return { success: true, message: 'StartDateTime column already exists' };
    }

    // Insert StartDateTime column after ShipmentDate (column E, index 5)
    sheet.insertColumnAfter(4); // Insert after column D (ShipmentDate)
    sheet.getRange(1, 5).setValue('StartDateTime');
    sheet.getRange(1, 5).setFontWeight('bold');

    Logger.log('Successfully added StartDateTime column');
    return { success: true, message: 'StartDateTime column added successfully' };
  } catch (error) {
    Logger.log('Migration error: ' + error.message);
    return { success: false, error: error.message };
  }
}

// ===== PAYMENTS MANAGEMENT =====
var PAYMENTS_SHEET_NAME = 'Payments';

function getPayments(orderID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
    if (!sheet) sheet = createPaymentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, payments: [] };

    var payments = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (orderID && row[1] !== orderID) continue;
      payments.push({
        id: row[0],
        orderID: row[1],
        paymentDate: formatDateForJSON_(row[2]),
        amount: parseFloat(row[3]) || 0,
        method: row[4] || '',
        reference: row[5] || '',
        notes: row[6] || '',
        recordedBy: row[7] || '',
        recordedDate: formatDateForJSON_(row[8])
      });
    }
    return { success: true, payments: payments };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function savePayment(paymentData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
    if (!sheet) sheet = createPaymentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === paymentData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!paymentData.id) {
      paymentData.id = 'PAY-' + String(data.length).padStart(5, '0');
    }

    var row = [
      paymentData.id,
      paymentData.orderID || '',
      paymentData.paymentDate || new Date(),
      paymentData.amount || 0,
      paymentData.method || '',
      paymentData.reference || '',
      paymentData.notes || '',
      paymentData.recordedBy || '',
      paymentData.recordedDate || new Date()
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true, payment: paymentData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createPaymentsSheet_(ss) {
  var sheet = ss.insertSheet(PAYMENTS_SHEET_NAME);
  var headers = [
    'PaymentID', 'OrderID', 'PaymentDate', 'Amount', 'Method',
    'Reference', 'Notes', 'RecordedBy', 'RecordedDate'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== PRICE HISTORY =====
var PRICE_HISTORY_SHEET_NAME = 'PriceHistory';

function getPriceHistory() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);
    if (!sheet) sheet = createPriceHistorySheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, prices: [] };

    var prices = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      prices.push({
        strain: row[0],
        type: row[1],
        lastPrice: parseFloat(row[2]) || 0,
        lastUsedDate: formatDateForJSON_(row[3]),
        customerID: row[4] || ''
      });
    }
    return { success: true, prices: prices };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function updatePriceHistory(strain, type, price, customerID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);
    if (!sheet) sheet = createPriceHistorySheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === strain && data[i][1] === type) {
        if (!customerID || data[i][4] === customerID) {
          existingRow = i + 1;
          break;
        }
      }
    }

    var row = [strain, type, price, new Date(), customerID || ''];
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createPriceHistorySheet_(ss) {
  var sheet = ss.insertSheet(PRICE_HISTORY_SHEET_NAME);
  var headers = ['Strain', 'Type', 'LastPrice', 'LastUsedDate', 'CustomerID'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== COA INDEX =====
var COA_INDEX_SHEET_NAME = 'COA_Index';

function syncCOAIndex() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    if (!sheet) sheet = createCOAIndexSheet_(ss);

    var folder = DriveApp.getFolderById(COA_FOLDER_ID);
    var files = folder.getFiles();
    var coaData = [];

    while (files.hasNext()) {
      var file = files.next();
      var fileName = file.getName();
      // Include all PDFs in the COA folder (not just ones with "COA" in filename)
      if (fileName.toLowerCase().endsWith('.pdf')) {
        // Extract strain name: remove .pdf, remove COA (with any prefix), normalize spaces
        var strain = fileName
          .replace(/\.pdf$/i, '')           // Remove .pdf extension
          .replace(/[\s_-]*COA[\s_-]*/gi, '') // Remove COA with any surrounding separators
          .replace(/_/g, ' ')               // Replace underscores with spaces
          .trim();
        coaData.push([
          strain,
          fileName,
          file.getId(),
          file.getUrl(),
          'https://drive.google.com/uc?export=download&id=' + file.getId(),
          new Date()
        ]);
      }
    }

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
    }
    if (coaData.length > 0) {
      sheet.getRange(2, 1, coaData.length, 6).setValues(coaData);
    }
    return { success: true, count: coaData.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getCOAIndex() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    if (!sheet) {
      sheet = createCOAIndexSheet_(ss);
      syncCOAIndex();
      sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, coas: [] };

    var coas = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      coas.push({
        strain: row[0],
        fileName: row[1],
        fileID: row[2],
        url: row[3],
        downloadURL: row[4],
        lastSynced: formatDateForJSON_(row[5])
      });
    }
    return { success: true, coas: coas };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createCOAIndexSheet_(ss) {
  var sheet = ss.insertSheet(COA_INDEX_SHEET_NAME);
  var headers = ['Strain', 'FileName', 'FileID', 'URL', 'DownloadURL', 'LastSynced'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Get COA PDFs for a list of strains
 * Uses fuzzy matching to find COAs and returns them as base64
 *
 * @param {string[]} strainList - Array of strain names to match
 * @returns {object} { success, coas: [{ strain, matched, matchedStrain, fileName, base64 }] }
 */
function getCOAsForStrains(strainList) {
  try {
    // Get COA index
    var indexResult = getCOAIndex();
    if (!indexResult.success) return indexResult;

    var coaIndex = indexResult.coas;
    var results = [];

    for (var i = 0; i < strainList.length; i++) {
      var requestedStrain = strainList[i];
      var normalized = normalizeStrainName_(requestedStrain);

      // Find best match in COA index
      var bestMatch = null;
      var bestScore = 0;

      for (var j = 0; j < coaIndex.length; j++) {
        var coaFileName = coaIndex[j].fileName;
        var coaFileNormalized = normalizeStrainName_(coaFileName);

        // Check if strain name is contained in filename (best match)
        if (coaFileNormalized.indexOf(normalized) !== -1) {
          // Direct substring match - high confidence
          bestScore = 1.0;
          bestMatch = coaIndex[j];
          break; // Found exact match, no need to continue
        }

        // Fall back to word overlap scoring
        var score = calculateMatchScore_(normalized, coaFileNormalized);
        if (score > bestScore && score >= 0.6) { // 60% threshold for partial matches
          bestScore = score;
          bestMatch = coaIndex[j];
        }
      }

      if (bestMatch) {
        // Fetch the file and convert to base64
        try {
          var file = DriveApp.getFileById(bestMatch.fileID);
          var blob = file.getBlob();
          var base64 = Utilities.base64Encode(blob.getBytes());

          results.push({
            strain: requestedStrain,
            matched: true,
            matchedStrain: bestMatch.strain,
            fileName: bestMatch.fileName,
            base64: base64
          });
        } catch (fileError) {
          Logger.log('[getCOAsForStrains] Failed to fetch file for ' + bestMatch.strain + ': ' + fileError.message);
          results.push({
            strain: requestedStrain,
            matched: false,
            error: 'Failed to fetch COA file'
          });
        }
      } else {
        results.push({
          strain: requestedStrain,
          matched: false,
          error: 'No matching COA found'
        });
      }
    }

    return { success: true, coas: results };
  } catch (error) {
    Logger.log('[getCOAsForStrains] Error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Normalize strain name for matching
 * Strips year prefixes, lowercases, removes extra spaces/underscores
 */
function normalizeStrainName_(name) {
  if (!name) return '';

  var normalized = String(name).toLowerCase().trim();

  // Remove year prefixes like "2025 ", "2024 "
  normalized = normalized.replace(/^20\d{2}\s+/, '');

  // Replace underscores with spaces
  normalized = normalized.replace(/_/g, ' ');

  // Remove extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Calculate match score between two normalized strain names
 * Returns 0-1 score (1 = exact match)
 */
function calculateMatchScore_(name1, name2) {
  if (name1 === name2) return 1.0;
  if (!name1 || !name2) return 0;

  // Check if one contains the other
  if (name1.indexOf(name2) !== -1 || name2.indexOf(name1) !== -1) {
    return 0.9;
  }

  // Simple word overlap scoring
  var words1 = name1.split(' ');
  var words2 = name2.split(' ');
  var matchedWords = 0;

  for (var i = 0; i < words1.length; i++) {
    for (var j = 0; j < words2.length; j++) {
      if (words1[i] === words2[j] && words1[i].length > 2) {
        matchedWords++;
        break;
      }
    }
  }

  var maxWords = Math.max(words1.length, words2.length);
  return matchedWords / maxWords;
}

// ===== ORDER FINANCIALS HELPER =====
function getOrderFinancials(orderID) {
  try {
    var orderResult = getMasterOrders();
    if (!orderResult.success) return orderResult;

    var order = null;
    for (var i = 0; i < orderResult.orders.length; i++) {
      if (orderResult.orders[i].id === orderID) {
        order = orderResult.orders[i];
        break;
      }
    }
    if (!order) return { success: false, error: 'Order not found' };

    var shipmentsResult = getShipments(orderID);
    var totalFulfilled = 0;
    if (shipmentsResult.success) {
      for (var j = 0; j < shipmentsResult.shipments.length; j++) {
        totalFulfilled += shipmentsResult.shipments[j].totalAmount;
      }
    }

    var paymentsResult = getPayments(orderID);
    var totalPaid = 0;
    if (paymentsResult.success) {
      for (var k = 0; k < paymentsResult.payments.length; k++) {
        totalPaid += paymentsResult.payments[k].amount;
      }
    }

    return {
      success: true,
      commitment: order.commitmentAmount,
      fulfilled: totalFulfilled,
      paid: totalPaid,
      outstanding: order.commitmentAmount - totalFulfilled,
      balance: totalFulfilled - totalPaid
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== CUSTOMER PORTAL =====
/**
 * Gets order details for the customer-facing portal
 * Returns order info in a format suitable for public display
 * Includes shipments as "pallets" and calculates completion from bag timer
 *
 * @param {string} orderID - The order ID to fetch
 * @returns {object} { success, order: {...} }
 */
function getOrderForPortal(orderID) {
  try {
    // Get order
    var ordersResult = getMasterOrders();
    if (!ordersResult.success) return ordersResult;

    var order = null;
    for (var i = 0; i < ordersResult.orders.length; i++) {
      if (ordersResult.orders[i].id === orderID) {
        order = ordersResult.orders[i];
        break;
      }
    }
    if (!order) return { success: false, error: 'Order not found' };

    // Get customer name
    var customersResult = getCustomers();
    var customerName = 'Customer';
    if (customersResult.success) {
      for (var j = 0; j < customersResult.customers.length; j++) {
        if (customersResult.customers[j].id === order.customerID) {
          customerName = customersResult.customers[j].companyName;
          break;
        }
      }
    }

    // Get shipments for this order (displayed as "pallets" in portal)
    var shipmentsResult = getShipments(orderID);
    var shipments = shipmentsResult.success ? shipmentsResult.shipments : [];

    // Calculate total kg ordered from shipment line items
    var totalKg = 0;
    var pallets = [];

    for (var k = 0; k < shipments.length; k++) {
      var shipment = shipments[k];
      var lineItems = [];
      try {
        lineItems = JSON.parse(shipment.lineItems || '[]');
      } catch (e) {
        lineItems = [];
      }

      var palletKg = 0;
      var cultivars = [];
      for (var l = 0; l < lineItems.length; l++) {
        var item = lineItems[l];
        palletKg += (item.quantity || 0);
        if (item.strain) cultivars.push(item.strain);
      }
      totalKg += palletKg;

      pallets.push({
        id: shipment.invoiceNumber || shipment.id,
        cultivars: cultivars.join(', '),
        weightKg: palletKg,
        status: shipment.status || 'pending'
      });
    }

    // Calculate completed kg from bag timer data
    // Sum up all cultivars mentioned in the line items
    var completedKg = 0;
    var countedStrains = {};

    for (var m = 0; m < shipments.length; m++) {
      var shipmentItems = [];
      try {
        shipmentItems = JSON.parse(shipments[m].lineItems || '[]');
      } catch (e) {
        shipmentItems = [];
      }

      for (var n = 0; n < shipmentItems.length; n++) {
        var strain = shipmentItems[n].strain;
        if (strain && !countedStrains[strain]) {
          countedStrains[strain] = true;
          var bagsForStrain = count5kgBagsForStrain(strain);
          completedKg += (bagsForStrain * 5);
        }
      }
    }

    // Cap completedKg at totalKg (can't be more than ordered)
    if (completedKg > totalKg) completedKg = totalKg;

    // Build response in format customer portal expects
    return {
      success: true,
      order: {
        id: order.id,
        customer: customerName,
        totalKg: totalKg,
        completedKg: completedKg,
        status: order.status || 'pending',
        createdDate: order.createdDate,
        dueDate: order.dueDate,
        notes: order.notes || '',
        pallets: pallets
      }
    };
  } catch (error) {
    Logger.log('[getOrderForPortal] Error: ' + error.message);
    return { success: false, error: error.message };
  }
}

// ===== SCOREBOARD ORDER QUEUE =====
/**
 * Gets the current active order and next order in queue for the scoreboard display
 * Filters for TOPS-only line items and calculates production progress
 *
 * @returns {object} { success, current: {...}, next: {...}, queue: {...} }
 */
function getScoreboardOrderQueue() {
  try {
    // Get all master orders and shipments
    var ordersResult = getMasterOrders();
    if (!ordersResult.success) return ordersResult;

    var shipmentsResult = getShipments(null); // Get all shipments
    if (!shipmentsResult.success) return shipmentsResult;

    // Build a list of shipment line items with tops only
    var topsLineItems = [];

    for (var i = 0; i < shipmentsResult.shipments.length; i++) {
      var shipment = shipmentsResult.shipments[i];

      // Find the parent order
      var parentOrder = null;
      for (var j = 0; j < ordersResult.orders.length; j++) {
        if (ordersResult.orders[j].id === shipment.orderID) {
          parentOrder = ordersResult.orders[j];
          break;
        }
      }

      if (!parentOrder) continue;

      // Skip completed or cancelled orders
      if (parentOrder.status === 'completed' || parentOrder.status === 'cancelled') continue;

      // Parse line items and filter for tops only
      var lineItems = [];
      try {
        lineItems = JSON.parse(shipment.lineItemsJSON || '[]');
      } catch (e) {
        lineItems = [];
      }

      for (var k = 0; k < lineItems.length; k++) {
        var item = lineItems[k];

        // Only include tops (skip smalls)
        if (item.type && item.type.toLowerCase() === 'tops') {
          topsLineItems.push({
            masterOrderId: parentOrder.id,
            shipmentId: shipment.id,
            customer: parentOrder.customerName,
            strain: item.strain,
            type: item.type,
            quantityKg: parseFloat(item.quantity) || 0,
            completedKg: parseFloat(item.completedKg) || null,
            startDateTime: shipment.startDateTime || null,
            dueDate: parentOrder.dueDate,
            orderPriority: parentOrder.priority,
            createdDate: parentOrder.createdDate,
            invoiceNumber: shipment.invoiceNumber,
            orderStatus: parentOrder.status,
            shipmentStatus: shipment.status
          });
        }
      }
    }

    // Sort by priority (manual override) or creation date (FIFO)
    topsLineItems.sort(function(a, b) {
      // If both have priority set, sort by priority ascending
      if (a.orderPriority != null && b.orderPriority != null) {
        return a.orderPriority - b.orderPriority;
      }
      // If only one has priority, prioritize it
      if (a.orderPriority != null) return -1;
      if (b.orderPriority != null) return 1;
      // Otherwise, FIFO by creation date
      var dateA = new Date(a.createdDate);
      var dateB = new Date(b.createdDate);
      return dateA - dateB;
    });

    // Get current and next
    var current = null;
    var next = null;

    if (topsLineItems.length > 0) {
      var currentItem = topsLineItems[0];

      // Calculate progress for current order (pass manual completedKg and startDateTime if set)
      var progress = calculateOrderProgress(
        currentItem.shipmentId,
        currentItem.strain,
        currentItem.type,
        currentItem.quantityKg,
        currentItem.completedKg,
        currentItem.startDateTime
      );

      current = {
        masterOrderId: currentItem.masterOrderId,
        shipmentId: currentItem.shipmentId,
        customer: currentItem.customer,
        strain: currentItem.strain,
        type: currentItem.type,
        quantityKg: currentItem.quantityKg,
        completedKg: progress.completedKg,
        percentComplete: progress.percentComplete,
        dueDate: currentItem.dueDate,
        estimatedHoursRemaining: progress.estimatedHoursRemaining,
        invoiceNumber: currentItem.invoiceNumber
      };
    }

    if (topsLineItems.length > 1) {
      var nextItem = topsLineItems[1];
      next = {
        masterOrderId: nextItem.masterOrderId,
        shipmentId: nextItem.shipmentId,
        customer: nextItem.customer,
        strain: nextItem.strain,
        type: nextItem.type,
        quantityKg: nextItem.quantityKg,
        dueDate: nextItem.dueDate,
        invoiceNumber: nextItem.invoiceNumber
      };
    }

    return {
      success: true,
      current: current,
      next: next,
      queue: {
        totalShipments: topsLineItems.length,
        totalKg: topsLineItems.reduce(function(sum, item) { return sum + item.quantityKg; }, 0)
      }
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Counts scanned 5kg bags that match a specific strain
 * Matches bags to strains by checking what cultivar was being worked on at scan time
 *
 * @param {string} strain - The strain name to match (e.g., "Sour Lifter")
 * @param {string|null} startDateTime - Optional start date/time (ISO format). Only count bags after this.
 * @returns {number} Number of matching 5kg bags scanned
 */
function count5kgBagsForStrain(strain, startDateTime) {
  try {
    var PRODUCTION_SHEET_ID = '1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is';
    var ss = SpreadsheetApp.openById(PRODUCTION_SHEET_ID);
    var timezone = ss.getSpreadsheetTimeZone();

    // Get bag tracking data
    var trackingSheet = ss.getSheetByName('Rogue Origin Production Tracking');
    if (!trackingSheet) {
      Logger.log('[count5kgBagsForStrain] Tracking sheet not found');
      return 0;
    }

    // PERFORMANCE: Only read recent data (first 2000 rows after header)
    // New bags are added at the TOP of the sheet, so read from row 2 downward
    var lastRow = trackingSheet.getLastRow();
    var startRow = 2; // First data row (row 1 is headers)
    var numRows = Math.min(2000, lastRow - 1); // Max 2000 rows, or all available data rows

    if (numRows < 1) return 0;

    var headers = trackingSheet.getRange(1, 1, 1, trackingSheet.getLastColumn()).getValues()[0];
    var recentData = trackingSheet.getRange(startRow, 1, numRows, trackingSheet.getLastColumn()).getValues();

    var bagData = [headers].concat(recentData); // Combine headers with data
    if (bagData.length < 2) return 0;

    var bagHeaders = bagData[0];
    var timestampCol = bagHeaders.indexOf('Timestamp');
    var sizeCol = bagHeaders.indexOf('Size');
    var skuCol = bagHeaders.indexOf('SKU'); // SKU contains cultivar name like "SLIFT-INTL-HT-5-KG-2025"

    if (timestampCol === -1 || sizeCol === -1) return 0;
    if (skuCol === -1) {
      Logger.log('[count5kgBagsForStrain] SKU column not found in tracking sheet');
      return 0;
    }

    // Get all 5kg bags with timestamps and SKUs
    var fiveKgBags = [];
    for (var i = 1; i < bagData.length; i++) {
      var size = String(bagData[i][sizeCol] || '').toLowerCase().trim();
      var timestamp = bagData[i][timestampCol];
      var sku = String(bagData[i][skuCol] || '').toUpperCase().trim();

      if (timestamp instanceof Date && !isNaN(timestamp.getTime())) {
        // Check if it's a 5kg bag
        if (size.indexOf('5') !== -1 && size.indexOf('kg') !== -1) {
          fiveKgBags.push({
            timestamp: timestamp,
            size: size,
            sku: sku
          });
        }
      }
    }

    // Filter bags by start date/time if provided
    Logger.log('[count5kgBagsForStrain] Total bags before filtering: ' + fiveKgBags.length);

    if (startDateTime) {
      Logger.log('[count5kgBagsForStrain] Applying startDateTime filter...');
      // Parse datetime format - handle both 'YYYY-MM-DDTHH:MM' and 'YYYY-MM-DD HH:MM'
      // Google Sheets may convert 'T' to space, so normalize it first
      var normalizedDateTime = String(startDateTime).replace(' ', 'T');
      var parts = normalizedDateTime.split('T');
      Logger.log('[count5kgBagsForStrain] Original: "' + startDateTime + '" -> Normalized: "' + normalizedDateTime + '"');
      Logger.log('[count5kgBagsForStrain] Parts after split: ' + JSON.stringify(parts));

      if (parts.length === 2) {
        var dateParts = parts[0].split('-'); // [YYYY, MM, DD]
        var timeParts = parts[1].split(':'); // [HH, MM]

        if (dateParts.length === 3 && timeParts.length >= 2) {
          // Create date in production sheet's timezone
          var year = parseInt(dateParts[0], 10);
          var month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
          var day = parseInt(dateParts[2], 10);
          var hour = parseInt(timeParts[0], 10);
          var minute = parseInt(timeParts[1], 10);

          var startDate = new Date(year, month, day, hour, minute, 0, 0);
          Logger.log('[count5kgBagsForStrain] Parsed startDate: ' + startDate);

          if (!isNaN(startDate.getTime())) {
            var beforeFilterCount = fiveKgBags.length;
            fiveKgBags = fiveKgBags.filter(function(bag) {
              return bag.timestamp >= startDate;
            });
            Logger.log('[count5kgBagsForStrain] Filtered from ' + beforeFilterCount + ' to ' + fiveKgBags.length + ' bags');
          } else {
            Logger.log('[count5kgBagsForStrain] Invalid startDate (NaN)');
          }
        } else {
          Logger.log('[count5kgBagsForStrain] Date/time parts invalid');
        }
      } else {
        Logger.log('[count5kgBagsForStrain] Split failed - parts.length: ' + parts.length);
      }
    } else {
      Logger.log('[count5kgBagsForStrain] No startDateTime provided - counting ALL bags');
    }

    if (fiveKgBags.length === 0) return 0;

    // Match bags by SKU - much more reliable than timestamp matching!
    // SKU format: "SLIFT-INTL-HT-5-KG-2025" where SLIFT = Sour Lifter
    var matchingBags = 0;

    Logger.log('[count5kgBagsForStrain] Checking ' + fiveKgBags.length + ' bags for strain: ' + strain);

    // Generate search terms from strain name
    // For "Sour Lifter", we require ALL words to match to avoid "Lifter" matching "Sour Lifter"
    var strainUpper = strain.toUpperCase();
    var strainWords = strainUpper.split(/[\s\-_]+/).filter(function(w) { return w.length >= 3; }); // Significant words only

    for (var b = 0; b < fiveKgBags.length; b++) {
      var bag = fiveKgBags[b];
      var matched = false;

      Logger.log('[count5kgBagsForStrain] Bag #' + (b + 1) + ' at ' + bag.timestamp + ' -> SKU: "' + bag.sku + '"');

      // Check if SKU contains the full strain name (exact match)
      if (bag.sku.indexOf(strainUpper) !== -1) {
        matched = true;
        Logger.log('[count5kgBagsForStrain] Matched on full strain name');
      } else if (strainWords.length > 0) {
        // Require ALL significant words from strain to be present in SKU
        // This prevents "Lifter" bags from matching "Sour Lifter" (missing "SOUR")
        var allWordsFound = true;
        for (var w = 0; w < strainWords.length; w++) {
          var word = strainWords[w];
          var wordFound = false;

          // Check if the full word appears in SKU
          if (bag.sku.indexOf(word) !== -1) {
            wordFound = true;
          } else if (word.length >= 4) {
            // Check if any 4+ character substring of the word appears in SKU
            // This catches "LIFT" from "LIFTER" matching "SLIFT"
            for (var j = 0; j <= word.length - 4; j++) {
              var substring = word.substring(j, j + 4);
              if (bag.sku.indexOf(substring) !== -1) {
                wordFound = true;
                Logger.log('[count5kgBagsForStrain] Word "' + word + '" matched on substring: "' + substring + '"');
                break;
              }
            }
          }

          if (!wordFound) {
            allWordsFound = false;
            Logger.log('[count5kgBagsForStrain] Word "' + word + '" NOT found in SKU');
            break;
          }
        }
        matched = allWordsFound;
      }

      if (matched) {
        matchingBags++;
        Logger.log('[count5kgBagsForStrain] ✓ MATCH - Bag counted');
      } else {
        Logger.log('[count5kgBagsForStrain] ✗ NO MATCH - Bag not counted');
      }
    }

    Logger.log('[count5kgBagsForStrain] Total matching bags: ' + matchingBags + ' = ' + (matchingBags * 5) + 'kg');
    return matchingBags;

  } catch (error) {
    Logger.log('count5kgBagsForStrain error: ' + error.message);
    return 0;
  }
}

/**
 * TEST FUNCTION - Run this manually to debug bag counting
 * Results will be written to a new sheet called "BagCountingTest"
 */
function testBagCounting() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Get the Sour Lifter shipment
  var shipmentsResult = getShipments('MO-2026-002');
  if (!shipmentsResult.success || shipmentsResult.shipments.length === 0) {
    Browser.msgBox('No shipments found for MO-2026-002');
    return;
  }

  var shipment = shipmentsResult.shipments[0];
  var startDateTime = shipment.startDateTime;

  // Count bags
  var bagCount = count5kgBagsForStrain('Sour Lifter', startDateTime);

  // Create or clear test sheet
  var testSheet = ss.getSheetByName('BagCountingTest');
  if (!testSheet) {
    testSheet = ss.insertSheet('BagCountingTest');
  } else {
    testSheet.clear();
  }

  // Write results
  var results = [
    ['Bag Counting Test Results', ''],
    ['', ''],
    ['Shipment ID:', shipment.id],
    ['Order ID:', shipment.orderID],
    ['Start Date/Time:', startDateTime || 'NOT SET'],
    ['Start Date/Time Type:', typeof startDateTime],
    ['', ''],
    ['Strain:', 'Sour Lifter'],
    ['Bags Counted:', bagCount],
    ['Kilograms:', bagCount * 5],
    ['', ''],
    ['Expected:', '6 bags = 30kg'],
    ['Status:', bagCount === 6 ? '✅ CORRECT' : '❌ INCORRECT']
  ];

  testSheet.getRange(1, 1, results.length, 2).setValues(results);
  testSheet.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(14);
  testSheet.autoResizeColumns(1, 2);

  Browser.msgBox('Test complete! Check the "BagCountingTest" sheet for results.');
}

/**
 * Gets the cultivar that was being worked on at a specific timestamp
 * Looks at production data to find what was being trimmed
 *
 * @param {Spreadsheet} ss - The spreadsheet object
 * @param {string} timezone - The timezone
 * @param {Date} timestamp - The timestamp to check
 * @returns {string|null} The cultivar name, or null if not found
 */
function getCultivarAtTime_(ss, timezone, timestamp) {
  try {
    // Get the month sheet for this timestamp
    var monthSheetName = Utilities.formatDate(timestamp, timezone, 'yyyy-MM');
    var monthSheet = ss.getSheetByName(monthSheetName);

    Logger.log('[getCultivarAtTime_] Looking up timestamp: ' + timestamp + ' in sheet: ' + monthSheetName);

    if (!monthSheet) {
      Logger.log('[getCultivarAtTime_] Month sheet not found: ' + monthSheetName);
      return null;
    }

    var vals = monthSheet.getDataRange().getValues();
    var targetDateStr = Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd');
    var targetHour = timestamp.getHours();

    var currentDate = null;
    var cols = null;

    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];

      // Check for date block start
      if (row[0] === 'Date:') {
        var dateStr = row[1];
        if (dateStr) {
          var d = new Date(dateStr);
          currentDate = !isNaN(d.getTime()) ? d : null;
        }
        // Next row contains headers
        var headerRow = vals[i + 1] || [];
        cols = {
          timeSlot: 0,
          cultivar1: headerRow.indexOf('Cultivar 1'),
          cultivar2: headerRow.indexOf('Cultivar 2')
        };
        continue;
      }

      // Skip if not in the target date
      if (!currentDate || !cols) continue;
      var rowDateStr = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
      if (rowDateStr !== targetDateStr) continue;

      // Check time slot
      var timeSlot = String(row[0] || '');
      if (!timeSlot || timeSlot === 'Date:') continue;

      // Parse hour from time slot (e.g., "7:00 AM – 8:00 AM")
      var hourMatch = timeSlot.match(/(\d+):00\s*(AM|PM)/);
      if (!hourMatch) continue;

      var slotHour = parseInt(hourMatch[1]);
      var period = hourMatch[2];

      // Convert to 24-hour format
      if (period === 'PM' && slotHour !== 12) slotHour += 12;
      if (period === 'AM' && slotHour === 12) slotHour = 0;

      // Check if this time slot matches the bag timestamp hour
      if (slotHour === targetHour) {
        // Return the first non-empty cultivar
        var cv1 = row[cols.cultivar1] || '';
        var cv2 = row[cols.cultivar2] || '';

        Logger.log('[getCultivarAtTime_] Found matching time slot ' + timeSlot + ' for hour ' + targetHour + ' - Cultivar1: "' + cv1 + '", Cultivar2: "' + cv2 + '"');

        if (cv1 && String(cv1).trim()) {
          var result = String(cv1).trim();
          Logger.log('[getCultivarAtTime_] Returning cultivar: "' + result + '"');
          return result;
        }
        if (cv2 && String(cv2).trim()) {
          var result = String(cv2).trim();
          Logger.log('[getCultivarAtTime_] Returning cultivar: "' + result + '"');
          return result;
        }
      }
    }

    Logger.log('[getCultivarAtTime_] No cultivar found for date ' + targetDateStr + ' hour ' + targetHour);
    return null;

  } catch (error) {
    Logger.log('getCultivarAtTime_ error: ' + error.message);
    return null;
  }
}

/**
 * Calculates order progress by matching production data to shipment line items
 * Priority: 1) Manual completedKg, 2) Scanned bag count, 3) Today's production data
 *
 * @param {string} shipmentId - The shipment ID to calculate progress for
 * @param {string} strain - The cultivar/strain name (e.g., "Cherry Wine")
 * @param {string} type - The product type ("Tops" or "Smalls")
 * @param {number} targetKg - The target quantity in kg
 * @param {number} manualCompletedKg - Optional manual completion override
 * @param {string} startDateTime - Optional start date/time to filter bag counts
 * @returns {object} { completedKg, percentComplete, estimatedHoursRemaining }
 */
function calculateOrderProgress(shipmentId, strain, type, targetKg, manualCompletedKg, startDateTime) {
  try {
    // Priority 1: If manual completion is set, use that
    if (manualCompletedKg != null && manualCompletedKg >= 0) {
      var completedKg = parseFloat(manualCompletedKg) || 0;
      var percentComplete = targetKg > 0 ? Math.round((completedKg / targetKg) * 100) : 0;
      if (percentComplete > 100) percentComplete = 100;

      var estimatedHoursRemaining = 0;
      var remainingKg = targetKg - completedKg;
      if (remainingKg > 0) {
        var crewRate = 5.0; // Default fallback
        try {
          var PRODUCTION_API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
          var scoreboardResponse = UrlFetchApp.fetch(PRODUCTION_API_URL + '?action=scoreboard');
          var scoreboardData = JSON.parse(scoreboardResponse.getContentText());
          if (scoreboardData && scoreboardData.success && scoreboardData.data) {
            var currentTrimmers = scoreboardData.data.currentHourTrimmers || 5;
            var targetRate = scoreboardData.data.targetRate || 1.0;
            crewRate = currentTrimmers * targetRate;
          }
        } catch (apiError) {
          Logger.log('Could not fetch crew rate, using default: ' + apiError.message);
        }
        var remainingLbs = remainingKg * 2.205;
        estimatedHoursRemaining = crewRate > 0 ? Math.ceil(remainingLbs / crewRate) : 0;
      }

      return { completedKg: completedKg, percentComplete: percentComplete, estimatedHoursRemaining: estimatedHoursRemaining };
    }

    // Priority 2: Count scanned bags for this strain (automatic tracking)
    // Each bag = 5kg, match bags to strain by production timing
    // Filter by startDateTime if provided (excludes bags scanned before shipment started)
    var bagCount = count5kgBagsForStrain(strain, startDateTime);
    if (bagCount > 0) {
      var completedKg = bagCount * 5; // Each bag is 5kg
      var percentComplete = targetKg > 0 ? Math.round((completedKg / targetKg) * 100) : 0;
      if (percentComplete > 100) percentComplete = 100;

      var estimatedHoursRemaining = 0;
      var remainingKg = targetKg - completedKg;
      if (remainingKg > 0) {
        var crewRate = 5.0; // Default fallback
        try {
          var PRODUCTION_API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
          var scoreboardResponse = UrlFetchApp.fetch(PRODUCTION_API_URL + '?action=scoreboard');
          var scoreboardData = JSON.parse(scoreboardResponse.getContentText());
          if (scoreboardData && scoreboardData.success && scoreboardData.data) {
            var currentTrimmers = scoreboardData.data.currentHourTrimmers || 5;
            var targetRate = scoreboardData.data.targetRate || 1.0;
            crewRate = currentTrimmers * targetRate;
          }
        } catch (apiError) {
          Logger.log('Could not fetch crew rate, using default: ' + apiError.message);
        }
        var remainingLbs = remainingKg * 2.205;
        estimatedHoursRemaining = crewRate > 0 ? Math.ceil(remainingLbs / crewRate) : 0;
      }

      Logger.log('[calculateOrderProgress] Using bag count: ' + bagCount + ' bags × 5kg = ' + completedKg + 'kg for ' + strain);
      return { completedKg: completedKg, percentComplete: percentComplete, estimatedHoursRemaining: estimatedHoursRemaining };
    }

    // Priority 3: Fall back to today's production data (old method)
    // 1. Open production tracking spreadsheet
    var PRODUCTION_SHEET_ID = '1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is';
    var ss = SpreadsheetApp.openById(PRODUCTION_SHEET_ID);
    var timezone = ss.getSpreadsheetTimeZone();

    // 2. Get current month sheet (e.g., "2026-01")
    var today = new Date();
    var monthSheetName = Utilities.formatDate(today, timezone, 'yyyy-MM');
    var monthSheet = ss.getSheetByName(monthSheetName);

    if (!monthSheet) {
      // No production data for current month yet
      return { completedKg: 0, percentComplete: 0, estimatedHoursRemaining: 0 };
    }

    // 3. Get all data from sheet
    var vals = monthSheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(today, timezone, 'yyyy-MM-dd');
    var totalLbs = 0;
    var currentDate = null;
    var cols = null;

    // 4. Iterate through sheet to find today's production for this strain
    for (var i = 0; i < vals.length; i++) {
      var row = vals[i];

      // Check for date block start
      if (row[0] === 'Date:') {
        var dateStr = row[1];
        if (dateStr) {
          var d = new Date(dateStr);
          currentDate = !isNaN(d.getTime()) ? d : null;
        }
        // Next row contains headers
        var headerRow = vals[i + 1] || [];
        cols = {
          cultivar1: headerRow.indexOf('Cultivar 1'),
          tops1: headerRow.indexOf('Tops 1'),
          smalls1: headerRow.indexOf('Smalls 1'),
          trimmers1: headerRow.indexOf('Trimmers 1'),
          cultivar2: headerRow.indexOf('Cultivar 2'),
          tops2: headerRow.indexOf('Tops 2'),
          smalls2: headerRow.indexOf('Smalls 2'),
          trimmers2: headerRow.indexOf('Trimmers 2')
        };
        continue;
      }

      // Skip if not in a date block or not today
      if (!currentDate || !cols) continue;
      var rowDateStr = Utilities.formatDate(currentDate, timezone, 'yyyy-MM-dd');
      if (rowDateStr !== todayStr) continue;

      // Check if this is an end-of-block marker
      if (!row[0] || row[0] === 'Date:') continue;
      var str = String(row[0]);
      if (str.indexOf('Performance Averages') !== -1 || str.indexOf('Avg Tops:Smalls') !== -1) continue;

      // Check Line 1 for matching cultivar
      var cv1 = row[cols.cultivar1] || '';
      if (cv1 && String(cv1).trim() === strain) {
        if (type === 'Tops' && cols.tops1 >= 0) {
          totalLbs += parseFloat(row[cols.tops1]) || 0;
        } else if (type === 'Smalls' && cols.smalls1 >= 0) {
          totalLbs += parseFloat(row[cols.smalls1]) || 0;
        }
      }

      // Check Line 2 for matching cultivar
      var cv2 = row[cols.cultivar2] || '';
      if (cv2 && String(cv2).trim() === strain) {
        if (type === 'Tops' && cols.tops2 >= 0) {
          totalLbs += parseFloat(row[cols.tops2]) || 0;
        } else if (type === 'Smalls' && cols.smalls2 >= 0) {
          totalLbs += parseFloat(row[cols.smalls2]) || 0;
        }
      }
    }

    // 5. Convert lbs to kg (1 kg = 2.205 lbs)
    var completedKg = totalLbs / 2.205;
    completedKg = Math.round(completedKg * 10) / 10; // Round to 1 decimal

    // 6. Calculate percentage
    var percentComplete = targetKg > 0 ? Math.round((completedKg / targetKg) * 100) : 0;
    if (percentComplete > 100) percentComplete = 100; // Cap at 100%

    // 7. Estimate hours remaining based on current crew rate
    var estimatedHoursRemaining = 0;
    var remainingKg = targetKg - completedKg;
    if (remainingKg > 0) {
      // Default fallback rate: 5 trimmers × 1.0 lbs/hr = 5 lbs/hr total
      var crewRate = 5.0;

      // Try to get actual current crew rate from production tracking API
      try {
        var PRODUCTION_API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
        var scoreboardResponse = UrlFetchApp.fetch(PRODUCTION_API_URL + '?action=scoreboard');
        var scoreboardData = JSON.parse(scoreboardResponse.getContentText());
        if (scoreboardData && scoreboardData.success && scoreboardData.data) {
          var currentTrimmers = scoreboardData.data.currentHourTrimmers || 5;
          var targetRate = scoreboardData.data.targetRate || 1.0;
          crewRate = currentTrimmers * targetRate;
        }
      } catch (apiError) {
        Logger.log('Could not fetch crew rate, using default: ' + apiError.message);
      }

      var remainingLbs = remainingKg * 2.205;
      estimatedHoursRemaining = crewRate > 0 ? Math.round((remainingLbs / crewRate) * 10) / 10 : 0;
    }

    return {
      completedKg: completedKg,
      percentComplete: percentComplete,
      estimatedHoursRemaining: estimatedHoursRemaining
    };

  } catch (error) {
    Logger.log('calculateOrderProgress error: ' + error.message);
    return {
      completedKg: 0,
      percentComplete: 0,
      estimatedHoursRemaining: 0
    };
  }
}

/**
 * Updates the priority of an order (for drag-and-drop reordering)
 *
 * @param {string} orderID - The order ID to update
 * @param {number} newPriority - The new priority value
 * @returns {object} { success, message }
 */
function updateOrderPriority(orderID, newPriority) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!sheet) {
      return { success: false, error: 'Orders sheet not found' };
    }

    var data = sheet.getDataRange().getValues();
    var rowToUpdate = -1;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderID) {
        rowToUpdate = i + 1; // +1 because sheet rows are 1-indexed
        break;
      }
    }

    if (rowToUpdate === -1) {
      return { success: false, error: 'Order not found' };
    }

    // Update priority column (column 22 = index 21)
    sheet.getRange(rowToUpdate, 22).setValue(newPriority);

    return { success: true, message: 'Priority updated successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== HELPER FUNCTIONS =====
function formatDateForJSON_(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return dateVal.toISOString();
  }
  if (typeof dateVal === 'string') {
    return new Date(dateVal).toISOString();
  }
  return null;
}

/**
 * Handle saveOrder API request
 * Wraps existing saveMasterOrder function
 */
function handleSaveOrder_(orderData) {
  try {
    Logger.log('[handleSaveOrder] Received order: ' + JSON.stringify(orderData));

    // Call existing saveMasterOrder function
    var result = saveMasterOrder(orderData);

    if (result.success) {
      return {
        success: true,
        orderId: result.order.id,
        message: 'Order created successfully'
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to save order'
      };
    }

  } catch (error) {
    Logger.log('[handleSaveOrder] Error: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Handle getCustomers API request
 * Returns list of all customers from Customers sheet
 */
function handleGetCustomers_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var customersSheet = ss.getSheetByName('Customers');

    if (!customersSheet) {
      return {
        success: false,
        error: 'Customers sheet not found'
      };
    }

    var data = customersSheet.getDataRange().getValues();
    var headers = data[0];
    var customers = [];

    // Find column indices
    var idCol = headers.indexOf('CustomerID');
    var nameCol = headers.indexOf('CompanyName');
    var addressCol = headers.indexOf('ShipToAddress');
    var cityCol = -1; // Not in current schema
    var stateCol = -1; // Not in current schema
    var zipCol = -1; // Not in current schema
    var countryCol = headers.indexOf('Country');
    var termsCol = -1; // Not in current schema

    // Build customer objects
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idCol]) { // Only include rows with customer ID
        customers.push({
          customerID: row[idCol],
          companyName: row[nameCol] || '',
          address: addressCol >= 0 ? row[addressCol] || '' : '',
          city: cityCol >= 0 ? row[cityCol] || '' : '',
          state: stateCol >= 0 ? row[stateCol] || '' : '',
          zip: zipCol >= 0 ? row[zipCol] || '' : '',
          country: countryCol >= 0 ? row[countryCol] || '' : '',
          paymentTerms: termsCol >= 0 ? row[termsCol] || '' : ''
        });
      }
    }

    Logger.log('[handleGetCustomers] Found ' + customers.length + ' customers');

    return {
      success: true,
      customers: customers
    };

  } catch (error) {
    Logger.log('[handleGetCustomers] Error: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Handle getActiveMasterOrder API request
 * Finds active or pending master order for a customer
 */
function handleGetActiveMasterOrder_(customerID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('MasterOrders');

    if (!sheet) {
      return {
        success: false,
        error: 'MasterOrders sheet not found'
      };
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    // Find column indices
    var idCol = headers.indexOf('OrderID');
    var customerIDCol = headers.indexOf('CustomerID');
    var customerNameCol = headers.indexOf('CustomerName');
    var statusCol = headers.indexOf('Status');
    var commitmentCol = headers.indexOf('CommitmentAmount');
    var currencyCol = headers.indexOf('Currency');

    // Find first active or pending order for this customer
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[customerIDCol] === customerID) {
        var status = (row[statusCol] || '').toLowerCase();
        if (status === 'active' || status === 'pending') {
          return {
            success: true,
            masterOrder: {
              id: row[idCol],
              customerID: row[customerIDCol],
              customerName: row[customerNameCol],
              commitmentAmount: row[commitmentCol],
              currency: row[currencyCol],
              status: row[statusCol]
            }
          };
        }
      }
    }

    return {
      success: false,
      error: 'No active master order found for customer'
    };

  } catch (error) {
    Logger.log('[handleGetActiveMasterOrder] Error: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Handle getPriceForStrain API request
 * Looks up price from price history for strain+type combination
 */
function handleGetPriceForStrain_(strain, type, customerID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('PriceHistory');

    if (!sheet) {
      return {
        success: false,
        error: 'PriceHistory sheet not found'
      };
    }

    var data = sheet.getDataRange().getValues();

    // Find matching price (prioritize customer-specific, then general)
    var matchedPrice = 0;
    var hasCustomerMatch = false;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowStrain = row[0];
      var rowType = row[1];
      var rowPrice = parseFloat(row[2]) || 0;
      var rowCustomerID = row[4] || '';

      if (rowStrain === strain && rowType === type) {
        if (rowCustomerID === customerID) {
          // Exact customer match - use this and stop
          matchedPrice = rowPrice;
          hasCustomerMatch = true;
          break;
        } else if (!rowCustomerID && !hasCustomerMatch) {
          // General price (no customer) - use as fallback
          matchedPrice = rowPrice;
        }
      }
    }

    if (matchedPrice > 0) {
      return {
        success: true,
        price: matchedPrice
      };
    } else {
      return {
        success: false,
        error: 'No price found for ' + strain + ' ' + type
      };
    }

  } catch (error) {
    Logger.log('[handleGetPriceForStrain] Error: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Handle saveShipment API request
 * Wraps existing saveShipment function
 */
function handleSaveShipment_(shipmentData) {
  try {
    Logger.log('[handleSaveShipment] Received shipment: ' + JSON.stringify(shipmentData));

    // Call existing saveShipment function
    var result = saveShipment(shipmentData);

    if (result.success) {
      return {
        success: true,
        shipmentId: result.shipment.id,
        message: 'Shipment created successfully'
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to save shipment'
      };
    }

  } catch (error) {
    Logger.log('[handleSaveShipment] Error: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
