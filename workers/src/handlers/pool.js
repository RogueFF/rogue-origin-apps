/**
 * Pool Inventory API Proxy Handler
 * Proxies requests to the external Pool Inventory Google Apps Script.
 * Uses text/plain Content-Type to avoid Google's CORS redirect behavior.
 */

import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';

export async function handlePoolRequest(request, env) {
  const action = getAction(request);
  const body = await parseBody(request);

  // Health check
  if (action === 'health') {
    return successResponse({
      status: 'healthy',
      service: 'Pool Inventory Proxy',
      timestamp: new Date().toISOString()
    });
  }

  if (!env.POOL_INVENTORY_API_URL) {
    throw createError('CONFIG_ERROR', 'Pool Inventory API URL not configured');
  }
  if (!env.POOL_INVENTORY_API_KEY) {
    throw createError('CONFIG_ERROR', 'Pool Inventory API key not configured');
  }

  const allowedActions = [
    'list_products', 'update_pool', 'get_pool_status', 'get_recent_changes',
    'list_vendor_products', 'get_vendor_variants', 'update_vendor_inventory', 'get_vendor_recent_changes',
    'reorder_vendor_variants', 'vendor_flow_decrement',
    'get_supersack_variants', 'update_supersack_inventory', 'get_supersack_recent_changes',
  ];
  if (!allowedActions.includes(action)) {
    throw createError('VALIDATION_ERROR', `Invalid action: ${action}. Allowed: ${allowedActions.join(', ')}`);
  }

  // Build payload with API key from environment
  const payload = {
    action,
    apiKey: env.POOL_INVENTORY_API_KEY,
    ...body
  };

  try {
    // Use text/plain to prevent Google Apps Script from returning a 302 redirect.
    // GAS doPost() receives the JSON string in e.postData.contents regardless of Content-Type.
    const response = await fetch(env.POOL_INVENTORY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw createError('EXTERNAL_API_ERROR', `Pool API returned non-JSON: ${text.substring(0, 200)}`);
    }

    if (data.error) {
      throw createError('EXTERNAL_API_ERROR', data.error);
    }

    return successResponse(data);

  } catch (error) {
    if (error.status) throw error;
    throw createError('EXTERNAL_API_ERROR', `Pool API request failed: ${error.message}`);
  }
}
