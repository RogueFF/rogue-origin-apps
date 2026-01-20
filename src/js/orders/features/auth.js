/**
 * Authentication feature
 * Handles login, logout, and session management
 * @module features/auth
 */

import { AUTH_STORAGE_KEY, API_URL } from '../core/config.js';
import { showToast } from '../ui/toast.js';

/**
 * Check authentication status on page load
 * @returns {boolean} True if authenticated
 */
export function checkAuth() {
  const session = localStorage.getItem(AUTH_STORAGE_KEY);
  if (session) {
    try {
      const { sessionToken, timestamp, expiresIn } = JSON.parse(session);
      const sessionAge = Date.now() - timestamp;

      if (sessionAge < expiresIn && sessionToken) {
        unlockPage();
        return true;
      }
    } catch (e) {
      console.error('Session parse error:', e);
    }
  }

  showLoginScreen();
  return false;
}

/**
 * Handle login form submission
 * @param {Event} event - Form submit event
 */
export async function handleLogin(event) {
  event.preventDefault();

  const passwordInput = document.getElementById('password-input');
  const enteredPassword = passwordInput.value;
  const errorEl = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  errorEl.classList.remove('visible');

  if (!enteredPassword) {
    showLoginError(errorEl, 'Please enter a password');
    return;
  }

  // Disable button and show loading state
  loginBtn.disabled = true;
  const originalText = loginBtn.textContent;
  loginBtn.textContent = 'Validating...';

  try {
    const url = `${API_URL}?action=validatePassword&password=${encodeURIComponent(enteredPassword)}`;
    const response = await fetch(url);
    const raw = await response.json();
    const result = raw.data || raw;

    if (result.success) {
      // Correct password - save session token
      const session = {
        sessionToken: result.sessionToken,
        timestamp: Date.now(),
        expiresIn: result.expiresIn
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));

      unlockPage();
      passwordInput.value = '';
    } else {
      showLoginError(errorEl, result.error || 'Invalid password');
      passwordInput.value = '';
      passwordInput.focus();

      // Shake animation
      loginBtn.style.animation = 'none';
      setTimeout(() => {
        loginBtn.style.animation = 'shake 0.5s';
      }, 10);
    }
  } catch (error) {
    console.error('Authentication error:', error);
    showLoginError(errorEl, 'Connection error. Please try again.');
    passwordInput.focus();
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = originalText;
  }
}

/**
 * Handle logout
 */
export function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    document.body.classList.add('auth-required');
    showLoginScreen();
  }
}

/**
 * Show login screen
 * @private
 */
function showLoginScreen() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  const passwordInput = document.getElementById('password-input');
  if (passwordInput) {
    passwordInput.focus();
  }
}

/**
 * Unlock page after successful auth
 * @private
 */
function unlockPage() {
  document.body.classList.remove('auth-required');
  document.getElementById('auth-overlay').classList.add('hidden');
}

/**
 * Show login error message
 * @private
 */
function showLoginError(errorEl, message) {
  errorEl.textContent = `❌ ${message}`;
  errorEl.classList.add('visible');
}

/**
 * Get current session token
 * @returns {string|null} Session token or null
 */
export function getSessionToken() {
  const session = localStorage.getItem(AUTH_STORAGE_KEY);
  if (session) {
    try {
      const { sessionToken } = JSON.parse(session);
      return sessionToken;
    } catch (e) {
      return null;
    }
  }
  return null;
}
