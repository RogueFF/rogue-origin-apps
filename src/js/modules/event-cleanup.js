/**
 * Event Cleanup Module
 * Centralized event listener tracking and cleanup system to prevent memory leaks
 * 
 * Problem: 47 addEventListener calls, only 4 removeEventListener
 * Solution: Track all listeners and provide automatic cleanup on destroy
 * 
 * @module modules/event-cleanup
 */

// Registry of all active event listeners
const listenerRegistry = new Map();
let listenerIdCounter = 0;

/**
 * Register an event listener with automatic cleanup tracking
 * @param {EventTarget} target - The element or object to attach the listener to
 * @param {string} eventType - The event type (e.g., 'click', 'resize')
 * @param {Function} handler - The event handler function
 * @param {Object|boolean} options - Event listener options (capture, passive, once, etc.)
 * @returns {number} Listener ID for manual removal if needed
 */
export function registerEventListener(target, eventType, handler, options = false) {
  if (!target || typeof handler !== 'function') {
    console.warn('[EventCleanup] Invalid listener registration:', { target, eventType, handler });
    return -1;
  }

  // Generate unique ID for this listener
  const listenerId = ++listenerIdCounter;

  // Store listener metadata
  listenerRegistry.set(listenerId, {
    target,
    eventType,
    handler,
    options,
    addedAt: new Date().toISOString()
  });

  // Add the event listener
  target.addEventListener(eventType, handler, options);

  console.debug(`[EventCleanup] Registered listener #${listenerId}: ${eventType} on`, target);

  return listenerId;
}

/**
 * Unregister a specific event listener by ID
 * @param {number} listenerId - The ID returned from registerEventListener
 * @returns {boolean} True if removed, false if not found
 */
export function unregisterEventListener(listenerId) {
  const listener = listenerRegistry.get(listenerId);
  
  if (!listener) {
    console.warn(`[EventCleanup] Listener #${listenerId} not found in registry`);
    return false;
  }

  const { target, eventType, handler, options } = listener;

  try {
    target.removeEventListener(eventType, handler, options);
    listenerRegistry.delete(listenerId);
    console.debug(`[EventCleanup] Unregistered listener #${listenerId}: ${eventType}`);
    return true;
  } catch (error) {
    console.error(`[EventCleanup] Error removing listener #${listenerId}:`, error);
    listenerRegistry.delete(listenerId); // Remove from registry anyway
    return false;
  }
}

/**
 * Remove all registered event listeners
 * Call this during cleanup/destroy to prevent memory leaks
 * @returns {number} Number of listeners cleaned up
 */
export function cleanupAllListeners() {
  const count = listenerRegistry.size;
  
  if (count === 0) {
    console.log('[EventCleanup] No listeners to clean up');
    return 0;
  }

  console.debug(`[EventCleanup] Cleaning up ${count} registered listeners...`);

  // Iterate through all registered listeners
  listenerRegistry.forEach((listener, listenerId) => {
    const { target, eventType, handler, options } = listener;
    
    try {
      target.removeEventListener(eventType, handler, options);
      console.debug(`[EventCleanup] Removed listener #${listenerId}: ${eventType}`);
    } catch (error) {
      console.warn(`[EventCleanup] Failed to remove listener #${listenerId}:`, error);
    }
  });

  // Clear the registry
  listenerRegistry.clear();
  
  console.debug(`[EventCleanup] Cleanup complete. ${count} listeners removed.`);
  return count;
}

/**
 * Get statistics about registered listeners (for debugging)
 * @returns {Object} Statistics about active listeners
 */
export function getListenerStats() {
  const stats = {
    total: listenerRegistry.size,
    byEventType: {},
    byTarget: {}
  };

  listenerRegistry.forEach((listener) => {
    const { eventType, target } = listener;
    
    // Count by event type
    stats.byEventType[eventType] = (stats.byEventType[eventType] || 0) + 1;
    
    // Count by target type
    const targetType = target === window ? 'window' 
                     : target === document ? 'document'
                     : target.tagName || 'unknown';
    stats.byTarget[targetType] = (stats.byTarget[targetType] || 0) + 1;
  });

  return stats;
}

/**
 * Log current listener statistics to console (for debugging)
 */
export function debugListeners() {
  const stats = getListenerStats();
  console.log('[EventCleanup] Listener Statistics:', stats);
  console.table(Array.from(listenerRegistry.entries()).map(([id, listener]) => ({
    ID: id,
    Target: listener.target === window ? 'window' : listener.target === document ? 'document' : listener.target.id || listener.target.tagName,
    Event: listener.eventType,
    AddedAt: listener.addedAt
  })));
}

/**
 * Helper: Create an event listener that automatically cleans itself up
 * Useful for one-time or conditional listeners
 * @param {EventTarget} target - The element or object to attach the listener to
 * @param {string} eventType - The event type
 * @param {Function} handler - The event handler function  
 * @param {Object|boolean} options - Event listener options
 * @returns {Function} Cleanup function to manually remove the listener
 */
export function createManagedListener(target, eventType, handler, options = false) {
  const listenerId = registerEventListener(target, eventType, handler, options);
  
  // Return a cleanup function
  return function cleanup() {
    unregisterEventListener(listenerId);
  };
}

/**
 * Helper: Register multiple listeners at once
 * @param {Array<Object>} listeners - Array of listener configs: { target, eventType, handler, options }
 * @returns {Array<number>} Array of listener IDs
 */
export function registerMultipleListeners(listeners) {
  return listeners.map(({ target, eventType, handler, options }) => 
    registerEventListener(target, eventType, handler, options)
  );
}

/**
 * Helper: Unregister multiple listeners at once
 * @param {Array<number>} listenerIds - Array of listener IDs to remove
 * @returns {number} Number of successfully removed listeners
 */
export function unregisterMultipleListeners(listenerIds) {
  let removed = 0;
  listenerIds.forEach(id => {
    if (unregisterEventListener(id)) {
      removed++;
    }
  });
  return removed;
}

// Export the registry for advanced debugging (read-only access)
export function getListenerRegistry() {
  return new Map(listenerRegistry); // Return a copy to prevent external modification
}
