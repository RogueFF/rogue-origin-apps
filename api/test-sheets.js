/**
 * Test endpoint to verify Google Sheets API connection
 * URL: /api/test-sheets
 */

const { google } = require('googleapis');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // Check env vars
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const sheetId = process.env.PRODUCTION_SHEET_ID;

    if (!email || !privateKey) {
      return res.status(500).json({
        success: false,
        error: 'Missing Google credentials',
        hasEmail: !!email,
        hasKey: !!privateKey,
      });
    }

    // Parse private key (handle double-escaped newlines from env)
    const key = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');

    // Create auth client
    const auth = new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    // Create Sheets client
    const sheets = google.sheets({ version: 'v4', auth });

    // Try to read sheet metadata
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'properties.title,sheets.properties.title',
    });

    const sheetNames = response.data.sheets?.map(s => s.properties?.title) || [];

    res.status(200).json({
      success: true,
      message: 'Google Sheets connection works!',
      spreadsheetTitle: response.data.properties?.title,
      sheetCount: sheetNames.length,
      sheets: sheetNames.slice(0, 5), // First 5 sheet names
    });
  } catch (error) {
    console.error('Sheets test error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
};
