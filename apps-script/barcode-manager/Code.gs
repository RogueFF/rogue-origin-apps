/**
 * ROGUE ORIGIN - Barcode/Label Manager
 * Handles both Apps Script Web App AND API requests for GitHub Pages
 *
 * API Endpoints:
 * - GET  ?action=products     - Get all products
 * - GET  ?action=test         - Test API
 * - POST ?action=add          - Add product
 * - POST ?action=update       - Update product
 * - POST ?action=delete       - Delete product
 * - POST ?action=import       - Import CSV
 */

const SHEET_ID = '1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE';

/**********************************************************
 * SECURITY: Input Validation Functions
 * Prevents formula injection and validates user inputs
 **********************************************************/

/**
 * Sanitizes a string input to prevent injection attacks
 * Removes or escapes dangerous characters
 *
 * @param {string} input - The string to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 500)
 * @returns {string} Sanitized string
 */
function sanitizeString(input, maxLength) {
  if (input === null || input === undefined) {
    return '';
  }

  maxLength = maxLength || 500;
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
 * Validates and sanitizes a numeric row number
 *
 * @param {any} input - The row number to validate
 * @returns {object} { valid: boolean, value: number|null, error: string|null }
 */
function validateRowNumber(input) {
  if (input === null || input === undefined || input === '') {
    return { valid: false, value: null, error: 'Row number is required' };
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

  var num = parseInt(input, 10);

  if (isNaN(num) || num < 2) { // Row 1 is headers
    return { valid: false, value: null, error: 'Invalid row number. Must be >= 2.' };
  }

  if (num > 100000) { // Reasonable limit
    return { valid: false, value: null, error: 'Row number out of range' };
  }

  return { valid: true, value: num, error: null };
}

/**
 * Validates a barcode string
 *
 * @param {string} input - The barcode to validate
 * @returns {object} { valid: boolean, value: string|null, error: string|null }
 */
function validateBarcode(input) {
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: '', error: null }; // Barcode can be empty
  }

  var str = String(input).trim();

  // Check for formula injection
  if (/^[=+\-@]/.test(str) || /IMPORT|HYPERLINK|SCRIPT/i.test(str)) {
    return {
      valid: false,
      value: null,
      error: 'Invalid barcode: potential formula injection detected'
    };
  }

  // Only allow alphanumeric and common barcode characters
  if (!/^[A-Za-z0-9\-_. ]+$/.test(str)) {
    return {
      valid: false,
      value: null,
      error: 'Invalid barcode format. Only letters, numbers, dashes, underscores, dots, and spaces allowed.'
    };
  }

  if (str.length > 100) {
    return { valid: false, value: null, error: 'Barcode too long (max 100 characters)' };
  }

  return { valid: true, value: str, error: null };
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  
  // API requests - return JSON
  if (action === 'products') {
    return jsonResponse({ success: true, products: getProducts() });
  }
  if (action === 'test') {
    return jsonResponse({ ok: true, message: 'Barcode API is working', timestamp: new Date().toISOString() });
  }
  
  // Default - serve HTML page
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Rogue Origin - Label Printer')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    var postData = {};
    if (e && e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }

    if (action === 'add') {
      // SECURITY: Validate and sanitize inputs
      var header = sanitizeString(postData.header, 200);
      var sku = sanitizeString(postData.sku, 100);
      var barcodeValidation = validateBarcode(postData.barcode);

      if (!barcodeValidation.valid) {
        result = { success: false, error: barcodeValidation.error };
      } else {
        result = addProduct(header, sku, barcodeValidation.value);
      }
    } else if (action === 'update') {
      // SECURITY: Validate row number and sanitize inputs
      var rowValidation = validateRowNumber(postData.row);
      if (!rowValidation.valid) {
        result = { success: false, error: rowValidation.error };
      } else {
        var header = sanitizeString(postData.header, 200);
        var sku = sanitizeString(postData.sku, 100);
        var barcodeValidation = validateBarcode(postData.barcode);

        if (!barcodeValidation.valid) {
          result = { success: false, error: barcodeValidation.error };
        } else {
          result = updateProduct(rowValidation.value, header, sku, barcodeValidation.value);
        }
      }
    } else if (action === 'delete') {
      // SECURITY: Validate row number
      var rowValidation = validateRowNumber(postData.row);
      if (!rowValidation.valid) {
        result = { success: false, error: rowValidation.error };
      } else {
        result = deleteProduct(rowValidation.value);
      }
    } else if (action === 'import') {
      // SECURITY: CSV is validated line-by-line in importCSV function
      // Just check for basic sanity
      if (!postData.csv || typeof postData.csv !== 'string') {
        result = { success: false, error: 'CSV data is required' };
      } else if (postData.csv.length > 1000000) { // 1MB limit
        result = { success: false, error: 'CSV data too large (max 1MB)' };
      } else {
        result = importCSV(postData.csv);
      }
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Get spreadsheet - works for both bound and API contexts
function getSheet() {
  var ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch(e) {
    ss = null;
  }
  if (!ss) {
    ss = SpreadsheetApp.openById(SHEET_ID);
  }
  return ss.getActiveSheet();
}

// Initialize sheet with headers if empty
function initializeSheet() {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  
  if (data.length === 0 || (data.length === 1 && !data[0][0])) {
    sheet.clear();
    sheet.appendRow(['Header', 'SKU', 'Barcode']);
    return { success: true, message: 'Sheet initialized with headers' };
  }
  
  return { success: true, message: 'Sheet already initialized' };
}

// Get all products from the sheet
function getProducts() {
  try {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    
    if (data.length === 0) {
      initializeSheet();
      return [];
    }
    
    if (data.length === 1) {
      return [];
    }
    
    var headers = data[0];
    var products = [];
    
    // Find column indices
    var headerIdx = -1, skuIdx = -1, barcodeIdx = -1;
    
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i].toString().toLowerCase();
      if (header.indexOf('header') >= 0 || header.indexOf('product') >= 0 || header.indexOf('name') >= 0) {
        headerIdx = i;
      } else if (header.indexOf('sku') >= 0) {
        skuIdx = i;
      } else if (header.indexOf('barcode') >= 0) {
        barcodeIdx = i;
      }
    }
    
    // Use defaults if not found
    if (headerIdx === -1) headerIdx = 0;
    if (skuIdx === -1) skuIdx = 1;
    if (barcodeIdx === -1) barcodeIdx = 2;
    
    // Process each row
    for (var i = 1; i < data.length; i++) {
      if (data[i][headerIdx] || data[i][skuIdx]) {
        products.push({
          row: i + 1,
          header: data[i][headerIdx] ? data[i][headerIdx].toString() : '',
          sku: data[i][skuIdx] ? data[i][skuIdx].toString() : '',
          barcode: data[i][barcodeIdx] ? data[i][barcodeIdx].toString() : ''
        });
      }
    }
    
    return products;
    
  } catch (error) {
    Logger.log('Error in getProducts: ' + error.toString());
    throw new Error('Failed to load products: ' + error.toString());
  }
}

// Add a new product
function addProduct(header, sku, barcode) {
  try {
    var sheet = getSheet();
    
    // Check for duplicate SKU
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] && data[i][1].toString() === sku) {
        return { success: false, message: 'SKU already exists' };
      }
    }
    
    sheet.appendRow([header, sku, barcode]);
    return { success: true, message: 'Product added successfully' };
    
  } catch (error) {
    Logger.log('Error in addProduct: ' + error.toString());
    return { success: false, message: 'Error adding product: ' + error.toString() };
  }
}

// Delete a product by row number
function deleteProduct(rowNumber) {
  try {
    var sheet = getSheet();
    sheet.deleteRow(rowNumber);
    return { success: true, message: 'Product deleted' };
  } catch (error) {
    Logger.log('Error in deleteProduct: ' + error.toString());
    return { success: false, message: 'Error deleting product: ' + error.toString() };
  }
}

// Update a product
function updateProduct(rowNumber, header, sku, barcode) {
  try {
    var sheet = getSheet();
    sheet.getRange(rowNumber, 1).setValue(header);
    sheet.getRange(rowNumber, 2).setValue(sku);
    sheet.getRange(rowNumber, 3).setValue(barcode);
    return { success: true, message: 'Product updated' };
  } catch (error) {
    Logger.log('Error in updateProduct: ' + error.toString());
    return { success: false, message: 'Error updating product: ' + error.toString() };
  }
}

// Import data from CSV text
function importCSV(csvText) {
  try {
    var sheet = getSheet();
    var lines = csvText.split('\n');

    var imported = 0;
    var skipped = 0;
    var rejected = 0;

    // Get existing SKUs to avoid duplicates
    var existingData = sheet.getDataRange().getValues();
    var existingSKUs = {};
    for (var i = 1; i < existingData.length; i++) {
      if (existingData[i][1]) {
        existingSKUs[existingData[i][1].toString()] = true;
      }
    }

    // Process CSV (skip header line)
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // Handle both comma and tab delimiters
      var parts = line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',');

      if (parts.length >= 3) {
        var headerRaw = parts[0].trim().replace(/^["']|["']$/g, '');
        var skuRaw = parts[1].trim().replace(/^["']|["']$/g, '');
        var barcodeRaw = parts[2].trim().replace(/^["']|["']$/g, '');

        // SECURITY: Sanitize all inputs to prevent formula injection
        var header = sanitizeString(headerRaw, 200);
        var sku = sanitizeString(skuRaw, 100);
        var barcodeValidation = validateBarcode(barcodeRaw);

        // Skip invalid barcodes
        if (!barcodeValidation.valid) {
          rejected++;
          continue;
        }
        var barcode = barcodeValidation.value;

        if (header && sku && barcode && !existingSKUs[sku]) {
          sheet.appendRow([header, sku, barcode]);
          existingSKUs[sku] = true;
          imported++;
        } else {
          skipped++;
        }
      }
    }

    var message = 'Imported ' + imported + ' products. Skipped ' + skipped + ' items.';
    if (rejected > 0) {
      message += ' Rejected ' + rejected + ' items due to invalid data.';
    }

    return {
      success: true,
      message: message
    };

  } catch (error) {
    Logger.log('Error in importCSV: ' + error.toString());
    return { success: false, message: 'Error importing CSV: ' + error.toString() };
  }
}

// Test function
function testGetProducts() {
  var products = getProducts();
  Logger.log('Products found: ' + products.length);
  Logger.log(JSON.stringify(products));
}
