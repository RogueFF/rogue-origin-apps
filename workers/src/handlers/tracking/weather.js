/**
 * Weather Auto-Pull Handler
 * Fetches daily weather from Open-Meteo API (free, no key needed)
 * and inserts into tracking_environmental table.
 */

import { jsonResponse } from '../../lib/response.js';
import { generateId } from './id.js';

const OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast?' +
  'latitude=42.3956&longitude=-122.7286' +
  '&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_max' +
  '&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph' +
  '&timezone=America/Los_Angeles&forecast_days=1';

/**
 * Pull daily weather data and insert into tracking_environmental
 */
export async function pullDailyWeather(env) {
  const res = await fetch(OPEN_METEO_URL);
  if (!res.ok) {
    throw new Error(`Open-Meteo API returned ${res.status}`);
  }

  const json = await res.json();
  const daily = json.daily;

  const temp_f = daily.temperature_2m_max[0];
  const humidity_pct = daily.relative_humidity_2m_mean[0];
  const precip_in = daily.precipitation_sum[0];
  const wind_mph = daily.wind_speed_10m_max[0];
  const recordedAt = daily.time[0]; // YYYY-MM-DD

  // Look up farm-level location (may not exist yet)
  const locRow = await env.DB.prepare(
    `SELECT id FROM tracking_locations WHERE type = 'farm' LIMIT 1`
  ).first();
  const locationId = locRow ? locRow.id : null;

  const id = generateId();

  await env.DB.prepare(
    `INSERT INTO tracking_environmental
       (id, location_id, source, temp_f, humidity_pct, precip_in, wind_mph, recorded_at, logged_by)
     VALUES (?, ?, 'weather_api', ?, ?, ?, ?, ?, NULL)`
  ).bind(id, locationId, temp_f, humidity_pct, precip_in, wind_mph, recordedAt).run();

  return {
    pulled: true,
    date: recordedAt,
    data: { temp_f, humidity_pct, precip_in, wind_mph },
  };
}

/**
 * Manual trigger handler
 */
export async function handle(action, request, env) {
  switch (action) {
    case 'pullWeather': {
      const result = await pullDailyWeather(env);
      return jsonResponse(result);
    }
    default:
      return null; // not handled here
  }
}
