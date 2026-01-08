/**
 * Panels Module
 * Handles side panel interactions for settings and AI chat
 */

import { API_URL } from './config.js';
import { getData, isAppsScript } from './state.js';
import { safeGetEl } from './utils.js';

// Callback references for toggle rendering
// These must be set by the main app before using toggleSettings
let renderWidgetTogglesCallback = null;
let renderKPITogglesCallback = null;

/**
 * Set the callback functions for rendering toggles
 * @param {Function} widgetCallback - Function to render widget toggles
 * @param {Function} kpiCallback - Function to render KPI toggles
 */
export function setToggleCallbacks(widgetCallback, kpiCallback) {
  renderWidgetTogglesCallback = widgetCallback;
  renderKPITogglesCallback = kpiCallback;
}

/**
 * Toggle the settings panel open/closed
 * Closes AI chat if open
 */
export function toggleSettings() {
  const panel = safeGetEl('settingsPanel');
  const aiChat = safeGetEl('aiChatPanel');
  const overlay = safeGetEl('settingsOverlay');

  // Close AI chat if open
  if (aiChat && aiChat.classList.contains('open')) {
    aiChat.classList.remove('open');
  }

  // Refresh toggles when opening
  if (panel && !panel.classList.contains('open')) {
    if (typeof renderWidgetTogglesCallback === 'function') {
      renderWidgetTogglesCallback();
    }
    if (typeof renderKPITogglesCallback === 'function') {
      renderKPITogglesCallback();
    }
  }

  // Toggle panel
  if (panel) {
    panel.classList.toggle('open');
  }
  if (overlay) {
    overlay.classList.toggle('open');
  }
}

/**
 * Open the settings panel
 * Refreshes widget and KPI toggles before opening
 */
export function openSettings() {
  // Refresh widget toggles to reflect current visibility
  if (typeof renderWidgetTogglesCallback === 'function') {
    renderWidgetTogglesCallback();
  }
  if (typeof renderKPITogglesCallback === 'function') {
    renderKPITogglesCallback();
  }

  const panel = safeGetEl('settingsPanel');
  const overlay = safeGetEl('settingsOverlay');

  if (panel) {
    panel.classList.add('open');
  }
  if (overlay) {
    overlay.classList.add('open');
  }
}

/**
 * Close the settings panel
 */
export function closeSettings() {
  const panel = safeGetEl('settingsPanel');
  const overlay = safeGetEl('settingsOverlay');

  if (panel) {
    panel.classList.remove('open');
  }
  if (overlay) {
    overlay.classList.remove('open');
  }
}

/**
 * Toggle the AI chat panel open/closed
 * Closes settings panel if open
 * Auto-focuses input after 300ms when opening
 */
export function toggleAIChat() {
  const panel = safeGetEl('aiChatPanel');
  const settings = safeGetEl('settingsPanel');
  const settingsOverlay = safeGetEl('settingsOverlay');

  // Close settings if open
  if (settings && settings.classList.contains('open')) {
    settings.classList.remove('open');
    if (settingsOverlay) {
      settingsOverlay.classList.remove('open');
    }
  }

  // Toggle AI chat panel
  if (panel) {
    panel.classList.toggle('open');

    // Auto-focus input when opening
    if (panel.classList.contains('open')) {
      setTimeout(function() {
        const input = safeGetEl('aiInput');
        if (input) {
          input.focus();
        }
      }, 300);
    }
  }
}

/**
 * Send a message to the AI backend
 * Creates user message div, shows typing indicator, and handles response
 */
export function sendAIMessage() {
  const input = safeGetEl('aiInput');
  const messagesContainer = safeGetEl('aiMessages');

  if (!input || !messagesContainer) return;

  const message = input.value.trim();
  if (!message) return;

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'ai-message user';
  userMsg.textContent = message;
  messagesContainer.appendChild(userMsg);

  // Clear input
  input.value = '';

  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'ai-typing';
  typingDiv.innerHTML = '<span></span><span></span><span></span>';
  messagesContainer.appendChild(typingDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Prepare request data
  const data = getData();
  const requestData = {
    message: message,
    context: {
      date: new Date().toISOString(),
      data: data || {}
    }
  };

  // Handle response helper
  function handleSuccess(response) {
    typingDiv.remove();
    const assistantMsg = document.createElement('div');
    assistantMsg.className = 'ai-message assistant';
    assistantMsg.textContent = response.message || response;
    messagesContainer.appendChild(assistantMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Handle error helper
  function handleError() {
    typingDiv.remove();
    const errorMsg = document.createElement('div');
    errorMsg.className = 'ai-message assistant';
    errorMsg.textContent = 'Sorry, I\'m having trouble connecting right now. Please try again.';
    messagesContainer.appendChild(errorMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Call API (Apps Script or Web App)
  if (isAppsScript()) {
    google.script.run
      .withSuccessHandler(handleSuccess)
      .withFailureHandler(handleError)
      .handleChatRequest(requestData);
  } else {
    fetch(API_URL + '?action=chat', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(requestData)
    })
    .then(function(r) { return r.json(); })
    .then(function(response) {
      handleSuccess(response);
    })
    .catch(function(error) {
      console.error('AI chat error:', error);
      handleError();
    });
  }
}
