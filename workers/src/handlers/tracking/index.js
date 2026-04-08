/**
 * Tracking API Router
 * Routes tracking actions to lots or locations handlers
 */

import { jsonResponse, errorResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import * as lots from './lots.js';
import * as locations from './locations.js';

const locationActions = [
  'listLocations', 'getLocation', 'createLocation',
  'updateLocation', 'deleteLocation', 'seedLocations'
];

export async function handleTrackingD1(request, env, ctx) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (!action) {
    throw new ApiError('Missing action parameter', 'BAD_REQUEST', 400);
  }

  if (locationActions.includes(action)) {
    return locations.handle(action, request, env);
  }

  return lots.handle(action, request, env);
}
