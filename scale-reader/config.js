/**
 * Scale Reader Configuration
 * Edit these settings to match your setup
 */

module.exports = {
  // Serial port configuration
  comPort: 'COM3',           // Change if your scale is on a different port
  baudRate: 9600,            // Don't change unless scale requires it

  // Server configuration
  serverPort: 3000,          // Local web server port

  // Cloud API
  cloudApiUrl: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight',
  pushInterval: 500,         // How often to push to cloud (ms)

  // Scale settings
  stationId: 'line1',        // Identifier for this scale (line1, line2, etc.)
  targetWeight: 5.0,         // Target bag weight in kg

  // Logging
  enableLogging: true,       // Write to log file
  logLevel: 'info',          // 'debug', 'info', 'error'
};
