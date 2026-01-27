/**
 * Pool Inventory API Proxy Handler
 * Proxies requests to the external Pool Inventory API
 * Securely stores API key in Workers environment
 */

import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';

/**
 * Main handler for pool inventory requests
 */
export async function handlePoolRequest(request, env) {
  const action = getAction(request);
  const body = await parseBody(request);

  // Validate environment variables
  if (!env.POOL_INVENTORY_API_URL) {
    throw createError('CONFIG_ERROR', 'Pool Inventory API URL not configured');
  }
  if (!env.POOL_INVENTORY_API_KEY) {
    throw createError('CONFIG_ERROR', 'Pool Inventory API key not configured');
  }

  // Health check endpoint
  if (action === 'health') {
    return successResponse({
      status: 'healthy',
      service: 'Pool Inventory Proxy',
      timestamp: new Date().toISOString()
    });
  }

  // Validate action is one of the allowed Pool API actions
  const allowedActions = ['list_products', 'update_pool', 'get_recent_changes'];
  if (!allowedActions.includes(action)) {
    throw createError('VALIDATION_ERROR', `Invalid action: ${action}. Allowed: ${allowedActions.join(', ')}`);
  }

  // Build request payload with API key from environment
  const payload = {
    action,
    apiKey: env.POOL_INVENTORY_API_KEY,
    ...body
  };

  // Proxy request to Pool Inventory API
  try {
    const response = await fetch(env.POOL_INVENTORY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Parse response
    const data = await response.json();

    // Check if the external API returned an error
    if (!data.success) {
      throw createError('EXTERNAL_API_ERROR', data.error || 'Pool API request failed');
    }

    // Return the response from the Pool API
    return successResponse(data);

  } catch (error) {
    // If it's already a formatted error, rethrow it
    if (error.status) throw error;

    // Otherwise, wrap it
    throw createError('EXTERNAL_API_ERROR', `Pool API request failed: ${error.message}`);
  }
}
