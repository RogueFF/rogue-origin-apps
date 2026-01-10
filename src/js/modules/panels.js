/**
 * Panels Module
 * Handles side panel interactions for settings and AI chat
 */

import { API_URL } from './config.js';
import { getData, isAppsScript } from './state.js';
import { safeGetEl } from './utils.js';
import { getSessionId, addMessage, exportForBackend } from './memory.js';
import { isVoiceActive, speak } from './voice.js';

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

  // Add user message to DOM
  const userMsg = document.createElement('div');
  userMsg.className = 'ai-message user';
  userMsg.textContent = message;
  messagesContainer.appendChild(userMsg);

  // Add to memory
  addMessage('user', message);

  // Clear input
  input.value = '';

  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'ai-typing';
  typingDiv.innerHTML = '<span></span><span></span><span></span>';
  messagesContainer.appendChild(typingDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Prepare request data with history
  const data = getData();
  const requestData = {
    userMessage: message,
    sessionId: getSessionId(),
    history: exportForBackend(),
    context: {
      date: new Date().toISOString(),
      data: data || {}
    }
  };

  // Handle response helper
  function handleSuccess(response) {
    typingDiv.remove();

    // Debug: log the actual response structure
    console.log('[AI Chat] Backend response:', response);
    console.log('[AI Chat] Response keys:', Object.keys(response || {}));

    // Handle error responses from backend
    if (response && response.success === false && response.error) {
      handleError();
      console.error('[AI Chat] Backend error:', response.error);
      return;
    }

    // Extract response text with proper fallbacks
    let responseText;
    if (typeof response === 'string') {
      responseText = response;
    } else if (response && response.response) {
      responseText = response.response;
    } else if (response && response.message) {
      responseText = response.message;
    } else if (response && typeof response === 'object') {
      // Handle unexpected object format
      console.error('[AI Chat] Unexpected response format:', response);
      responseText = 'Sorry, I received an unexpected response format. Please try again.';
    } else {
      responseText = 'Sorry, I didn\'t get a valid response. Please try again.';
    }

    // Ensure responseText is a string
    if (typeof responseText !== 'string') {
      console.error('[AI Chat] Response is not a string:', responseText);
      responseText = String(responseText);
    }

    // Create unique message ID based on timestamp
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Add assistant message to DOM with feedback buttons
    const assistantMsg = document.createElement('div');
    assistantMsg.className = 'ai-message assistant';
    assistantMsg.setAttribute('data-message-id', messageId);

    const messageText = document.createElement('div');
    messageText.className = 'ai-message-text';
    messageText.innerHTML = responseText;
    assistantMsg.appendChild(messageText);

    // Create feedback buttons container
    const feedbackContainer = document.createElement('div');
    feedbackContainer.className = 'ai-feedback-buttons';

    const thumbsUpBtn = document.createElement('button');
    thumbsUpBtn.className = 'ai-feedback-btn thumbs-up';
    thumbsUpBtn.innerHTML = '👍';
    thumbsUpBtn.title = 'Helpful response';
    thumbsUpBtn.setAttribute('aria-label', 'Mark as helpful');
    thumbsUpBtn.onclick = function(e) {
      e.preventDefault();
      submitAIFeedback(this, 'up', messageId);
    };

    const thumbsDownBtn = document.createElement('button');
    thumbsDownBtn.className = 'ai-feedback-btn thumbs-down';
    thumbsDownBtn.innerHTML = '👎';
    thumbsDownBtn.title = 'Not helpful';
    thumbsDownBtn.setAttribute('aria-label', 'Mark as not helpful');
    thumbsDownBtn.onclick = function(e) {
      e.preventDefault();
      submitAIFeedback(this, 'down', messageId);
    };

    feedbackContainer.appendChild(thumbsUpBtn);
    feedbackContainer.appendChild(thumbsDownBtn);
    assistantMsg.appendChild(feedbackContainer);

    messagesContainer.appendChild(assistantMsg);

    // Add to memory
    addMessage('assistant', responseText);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Trigger TTS if voice mode enabled
    if (isVoiceActive()) {
      speak(responseText).catch(function(error) {
        console.error('[AI Chat] TTS error:', error);
        // Don't show error to user, just log it
      });
    }
  }

  // Handle error helper
  function handleError(errorDetail) {
    typingDiv.remove();
    const errorMsg = document.createElement('div');
    errorMsg.className = 'ai-message assistant';

    // Show generic error to user, but log details
    errorMsg.textContent = 'Sorry, I\'m having trouble connecting right now. Please try again.';

    if (errorDetail) {
      console.error('[AI Chat] Error details:', errorDetail);
    }

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
      body: JSON.stringify(requestData),
      cache: 'no-store'
    })
    .then(function(r) {
      if (!r.ok) {
        throw new Error('HTTP ' + r.status + ': ' + r.statusText);
      }
      return r.json();
    })
    .then(function(response) {
      // Ensure response is valid
      if (!response || typeof response !== 'object') {
        console.error('[AI Chat] Invalid response type:', typeof response);
        throw new Error('Invalid response format');
      }
      handleSuccess(response);
    })
    .catch(function(error) {
      console.error('AI chat error:', error);
      handleError(error);
    });
  }
}

/**
 * Submit feedback for an AI response
 * @param {HTMLElement} button - The feedback button that was clicked
 * @param {string} rating - 'up' for thumbs up, 'down' for thumbs down
 * @param {string} messageId - Unique ID of the message being rated
 */
export function submitAIFeedback(button, rating, messageId) {
  // Disable the button and show visual feedback
  button.style.opacity = '0.5';
  button.style.cursor = 'not-allowed';
  button.disabled = true;

  // Find the message element
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageElement) {
    console.error('Message element not found for ID:', messageId);
    return;
  }

  // Get message text for reference
  const messageText = messageElement.querySelector('.ai-message-text');
  const messageContent = messageText ? messageText.textContent : '';

  // Prepare feedback data
  const feedbackData = {
    messageId: messageId,
    rating: rating === 'up' ? 'helpful' : 'not helpful',
    question: messageContent,
    timestamp: new Date().toISOString()
  };

  // Send to backend
  if (isAppsScript()) {
    google.script.run
      .withSuccessHandler(function(response) {
        console.log('Feedback logged:', response);
        // Show brief confirmation
        button.innerHTML = rating === 'up' ? '✓👍' : '✓👎';
        setTimeout(function() {
          button.innerHTML = rating === 'up' ? '👍' : '👎';
        }, 1500);
      })
      .withFailureHandler(function(error) {
        console.error('Error logging feedback:', error);
        // Reset button on error
        button.style.opacity = '1';
        button.disabled = false;
        button.style.cursor = 'pointer';
      })
      .logChatFeedback(feedbackData);
  } else {
    fetch(API_URL + '?action=feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(feedbackData),
      cache: 'no-store'
    })
    .then(function(r) { return r.json(); })
    .then(function(response) {
      console.log('Feedback logged:', response);
      // Show brief confirmation
      button.innerHTML = rating === 'up' ? '✓👍' : '✓👎';
      setTimeout(function() {
        button.innerHTML = rating === 'up' ? '👍' : '👎';
      }, 1500);
    })
    .catch(function(error) {
      console.error('Error logging feedback:', error);
      // Reset button on error
      button.style.opacity = '1';
      button.disabled = false;
      button.style.cursor = 'pointer';
    });
  }
}
