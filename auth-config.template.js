/**
 * AUTHENTICATION CONFIG TEMPLATE
 *
 * SETUP INSTRUCTIONS:
 * 1. Copy this file and rename it to "auth-config.js"
 * 2. Set your password below
 * 3. NEVER commit auth-config.js to Git (it's in .gitignore)
 *
 * This template file is safe to commit - it's just instructions.
 */

// Configuration object
const AUTH_CONFIG = {
  // Your password (plain text - only stored locally, never committed)
  password: 'YOUR_PASSWORD_HERE',

  // How long to stay logged in (in days)
  sessionDuration: 30,

  // Optional: List of pages that require authentication
  protectedPages: ['orders.html']
};

// Export for use in orders.html
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AUTH_CONFIG;
}
