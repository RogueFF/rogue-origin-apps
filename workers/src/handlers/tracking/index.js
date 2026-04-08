/**
 * Tracking API Router
 * Routes tracking actions to the appropriate handler
 */

import { jsonResponse, errorResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import * as lots from './lots.js';
import * as locations from './locations.js';
import * as weather from './weather.js';
import * as observations from './observations.js';
import * as environmental from './environmental.js';
import * as inputs from './inputs.js';
import * as planting from './planting.js';

const locationActions = [
  'listLocations', 'getLocation', 'createLocation',
  'updateLocation', 'deleteLocation', 'seedLocations'
];

const weatherActions = ['pullWeather'];

const observationActions = [
  'createObservation', 'listObservations', 'getObservation',
  'logWatering', 'logWeeklyCheck', 'logSapAnalysis'
];

const environmentalActions = [
  'recordReading', 'listReadings', 'getLatestReading'
];

const inputActions = [
  'recordInput', 'listInputs'
];

const plantingActions = [
  'logPlantingPass', 'getPlantingPasses', 'logReplant',
  'getReplants', 'getPlantingSummary'
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

  if (weatherActions.includes(action)) {
    return weather.handle(action, request, env);
  }

  if (observationActions.includes(action)) {
    return observations.handle(action, request, env);
  }

  if (environmentalActions.includes(action)) {
    return environmental.handle(action, request, env);
  }

  if (inputActions.includes(action)) {
    return inputs.handle(action, request, env);
  }

  if (plantingActions.includes(action)) {
    return planting.handle(action, request, env);
  }

  return lots.handle(action, request, env);
}
