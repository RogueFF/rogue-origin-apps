/**
 * Memory Module
 * Manages conversation history in sessionStorage
 * Implements Mem0-inspired 3-layer pattern
 */

const STORAGE_KEY = 'ai_conversation_history';
const MAX_HISTORY_LENGTH = 50; // Keep last 50 messages
let sessionId = null;

/**
 * Initialize or get current session ID
 */
export function getSessionId() {
  if (!sessionId) {
    // Check sessionStorage first
    sessionId = sessionStorage.getItem('ai_session_id');

    if (!sessionId) {
      // Generate new UUID-like session ID
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('ai_session_id', sessionId);
    }
  }
  return sessionId;
}

/**
 * Get conversation history from sessionStorage
 */
export function getHistory() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const history = JSON.parse(stored);
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.error('Error reading history:', error);
    return [];
  }
}

/**
 * Add message to conversation history
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message text
 */
export function addMessage(role, content) {
  const history = getHistory();

  const message = {
    role: role,
    content: content,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId()
  };

  history.push(message);

  // Trim history if too long (keep last MAX_HISTORY_LENGTH)
  if (history.length > MAX_HISTORY_LENGTH) {
    history.splice(0, history.length - MAX_HISTORY_LENGTH);
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Error saving history:', error);
    // If quota exceeded, keep only recent history
    const recentHistory = history.slice(-20);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recentHistory));
  }
}

/**
 * Clear conversation history (new conversation)
 */
export function clearHistory() {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem('ai_session_id');
  sessionId = null;
}

/**
 * Get conversation summary for display
 */
export function getConversationSummary() {
  const history = getHistory();
  return {
    sessionId: getSessionId(),
    messageCount: history.length,
    startTime: history[0]?.timestamp || null,
    lastMessageTime: history[history.length - 1]?.timestamp || null
  };
}

/**
 * Export history for backend (format for API)
 */
export function exportForBackend() {
  const history = getHistory();

  // Convert to Anthropic API format
  return history.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}
