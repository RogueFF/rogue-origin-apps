/**
 * Weather Briefing Module
 * Fetches weather for Grants Pass, OR from wttr.in
 */

const WEATHER_URL = 'https://wttr.in/Grants+Pass+Oregon?format=j1';

let cachedWeather = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch weather data with caching
 */
async function fetchWeather() {
  const now = Date.now();
  if (cachedWeather && (now - cacheTime) < CACHE_TTL) {
    return cachedWeather;
  }

  try {
    const response = await fetch(WEATHER_URL);
    if (!response.ok) throw new Error(`Weather API ${response.status}`);
    const data = await response.json();
    cachedWeather = data;
    cacheTime = now;
    return data;
  } catch (e) {
    console.warn('Weather briefing: fetch failed', e);
    return cachedWeather; // Return stale cache if available
  }
}

/**
 * Parse weather data into usable format
 */
function parseWeather(data) {
  if (!data || !data.current_condition || !data.current_condition[0]) return null;

  const current = data.current_condition[0];
  const today = data.weather && data.weather[0];
  const tomorrow = data.weather && data.weather[1];

  const tempF = current.temp_F || current.temp_C;
  const desc = current.weatherDesc && current.weatherDesc[0] && current.weatherDesc[0].value;
  const humidity = current.humidity;

  let highF = null, lowF = null, chanceOfRain = null;
  if (today) {
    highF = today.maxtempF;
    lowF = today.mintempF;
    // Average hourly precipitation chance
    if (today.hourly) {
      const chances = today.hourly.map(h => parseInt(h.chanceofrain || 0, 10));
      chanceOfRain = Math.round(chances.reduce((a, b) => a + b, 0) / chances.length);
    }
  }

  let tomorrowHigh = null, tomorrowLow = null, tomorrowDesc = null;
  if (tomorrow) {
    tomorrowHigh = tomorrow.maxtempF;
    tomorrowLow = tomorrow.mintempF;
    // Get overall description from astronomy or first hourly
    if (tomorrow.hourly && tomorrow.hourly[4]) {
      tomorrowDesc = tomorrow.hourly[4].weatherDesc && tomorrow.hourly[4].weatherDesc[0] && tomorrow.hourly[4].weatherDesc[0].value;
    }
  }

  let tonightLow = null;
  if (today && today.hourly) {
    // Find evening hours (18-23) for tonight's low
    const eveningHours = today.hourly.filter(h => parseInt(h.time, 10) >= 1800);
    if (eveningHours.length > 0) {
      tonightLow = Math.min(...eveningHours.map(h => parseInt(h.tempF || h.temp_F || 99, 10)));
    }
  }

  return {
    tempF, desc, humidity,
    highF, lowF, chanceOfRain,
    tonightLow: tonightLow || lowF,
    tomorrowHigh, tomorrowLow, tomorrowDesc
  };
}

/**
 * Generate morning weather briefing
 */
function generateMorning(w) {
  const parts = [];

  parts.push(
    `Currently ${w.tempF} degrees and ${(w.desc || 'unknown conditions').toLowerCase()} in Grants Pass.`
  );

  if (w.highF && w.lowF) {
    parts.push(`High of ${w.highF} today, low of ${w.lowF}.`);
  }

  if (w.chanceOfRain != null && w.chanceOfRain > 0) {
    parts.push(`${w.chanceOfRain}% chance of rain.`);
  }

  const html = `<div>Grants Pass: <span class="briefing-value">${w.tempF}&deg;F</span> ${w.desc || ''}</div>` +
    (w.highF ? `<div>High <span class="briefing-value">${w.highF}&deg;</span> / Low <span class="briefing-value">${w.lowF}&deg;</span></div>` : '') +
    (w.chanceOfRain > 0 ? `<div>Rain: <span class="briefing-value">${w.chanceOfRain}%</span></div>` : '');

  return { title: 'Weather', text: parts.join(' '), html, priority: 5 };
}

/**
 * Generate evening weather briefing
 */
function generateEvening(w) {
  const parts = [];

  parts.push(`Currently ${w.tempF} degrees in Grants Pass.`);

  if (w.tonightLow) {
    parts.push(`Tonight's low around ${w.tonightLow} degrees.`);
  }

  if (w.tomorrowHigh && w.tomorrowDesc) {
    parts.push(`Tomorrow: ${w.tomorrowDesc.toLowerCase()}, high of ${w.tomorrowHigh}.`);
  } else if (w.tomorrowHigh) {
    parts.push(`Tomorrow's high: ${w.tomorrowHigh} degrees.`);
  }

  const html = `<div>Now: <span class="briefing-value">${w.tempF}&deg;F</span></div>` +
    (w.tonightLow ? `<div>Tonight's low: <span class="briefing-value">${w.tonightLow}&deg;</span></div>` : '') +
    (w.tomorrowHigh ? `<div>Tomorrow: <span class="briefing-value">${w.tomorrowHigh}&deg;</span>` + (w.tomorrowDesc ? ` ${w.tomorrowDesc}` : '') + '</div>' : '');

  return { title: 'Weather', text: parts.join(' '), html, priority: 5 };
}

const WeatherModule = {
  name: 'weather',
  slots: ['morning', 'evening'],

  async generate(slot) {
    const data = await fetchWeather();
    const w = parseWeather(data);
    if (!w) return null;

    if (slot === 'morning') return generateMorning(w);
    if (slot === 'evening') return generateEvening(w);

    return null;
  }
};

export default WeatherModule;
