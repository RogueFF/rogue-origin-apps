/**
 * Operations Briefing Module
 * Fetches production data and generates human-readable briefing segments
 */

import { API_URL } from '../config.js';
import { formatDateInput } from '../utils.js';

/**
 * Fetch scoreboard data from API
 */
async function fetchScoreboard() {
  try {
    const response = await fetch(`${API_URL}?action=scoreboard`);
    const raw = await response.json();
    return raw.data || raw;
  } catch (e) {
    console.warn('Operations briefing: scoreboard fetch failed', e);
    return null;
  }
}

/**
 * Fetch dashboard summary for a date range
 */
async function fetchDashboard(startDate, endDate) {
  try {
    const response = await fetch(`${API_URL}?action=dashboard&start=${startDate}&end=${endDate}`);
    const raw = await response.json();
    return raw.data || raw;
  } catch (e) {
    console.warn('Operations briefing: dashboard fetch failed', e);
    return null;
  }
}

/**
 * Get yesterday's date formatted
 */
function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateInput(d);
}

/**
 * Generate morning briefing text
 */
function generateMorning(scoreboard, yesterday) {
  const parts = [];
  parts.push('Good morning.');

  // Yesterday's numbers
  if (yesterday && yesterday.totals) {
    const t = yesterday.totals;
    const tops = t.totalTops || 0;
    const rate = t.avgRate || 0;
    const strain = (yesterday.current && yesterday.current.strain) || '';
    const target = (yesterday.targets && yesterday.targets.totalTops) || 0;
    const pct = target > 0 ? Math.round(tops / target * 100) : 0;

    parts.push(
      `Yesterday the team processed ${tops.toFixed(1)} pounds` +
      (strain ? ` of ${strain}` : '') +
      ` at an average rate of ${rate.toFixed(2)} pounds per trimmer hour` +
      (target > 0 ? `, hitting ${pct}% of target` : '') + '.'
    );
  }

  // Today's crew and target
  if (scoreboard) {
    const crew = scoreboard.trimmers || scoreboard.crew || 0;
    const target = scoreboard.dailyTarget || scoreboard.target || 0;
    const strain = scoreboard.strain || '';

    if (crew > 0) {
      parts.push(
        `Today we have ${crew} trimmers on the line` +
        (target > 0 ? ` targeting ${target} pounds` : '') +
        (strain ? ` of ${strain}` : '') + '.'
      );
    }
  }

  const html = buildHtml(scoreboard, yesterday, 'morning');
  return { title: 'Production Update', text: parts.join(' '), html, priority: 1 };
}

/**
 * Generate midday briefing text
 */
function generateMidday(scoreboard) {
  const parts = [];
  parts.push('Midday update.');

  if (scoreboard) {
    const lbs = scoreboard.totalLbs || scoreboard.totalTops || 0;
    const rate = scoreboard.avgRate || scoreboard.rate || 0;
    const target = scoreboard.dailyTarget || scoreboard.target || 0;
    const projected = scoreboard.projectedTotal || scoreboard.projected || 0;
    const pct = target > 0 ? Math.round(lbs / target * 100) : 0;

    parts.push(`Current pace: ${lbs.toFixed(1)} pounds done so far at ${rate.toFixed(2)} pounds per trimmer hour.`);

    if (target > 0) {
      parts.push(`That's ${pct}% of today's target.`);
    }
    if (projected > 0) {
      parts.push(`Projected finish: ${projected.toFixed(0)} pounds.`);
    }
  } else {
    parts.push('No live data available right now.');
  }

  const html = buildHtml(scoreboard, null, 'midday');
  return { title: 'Midday Production', text: parts.join(' '), html, priority: 1 };
}

/**
 * Generate evening briefing text
 */
function generateEvening(scoreboard) {
  const parts = [];
  parts.push('End of day wrap up.');

  if (scoreboard) {
    const lbs = scoreboard.totalLbs || scoreboard.totalTops || 0;
    const target = scoreboard.dailyTarget || scoreboard.target || 0;
    const rate = scoreboard.avgRate || scoreboard.rate || 0;
    const bestRate = scoreboard.maxRate || scoreboard.bestRate || 0;
    const hitTarget = target > 0 && lbs >= target;

    parts.push(`Final numbers: ${lbs.toFixed(1)} pounds processed at an average rate of ${rate.toFixed(2)}.`);

    if (target > 0) {
      parts.push(hitTarget ? 'Target hit.' : `Target was ${target.toFixed(0)} pounds, fell short.`);
    }
    if (bestRate > 0) {
      parts.push(`Best hourly rate was ${bestRate.toFixed(2)}.`);
    }
  } else {
    parts.push('No production data available for today.');
  }

  const html = buildHtml(scoreboard, null, 'evening');
  return { title: 'Daily Wrap-up', text: parts.join(' '), html, priority: 1 };
}

/**
 * Build rich HTML for toast display
 */
function buildHtml(scoreboard, yesterday, slot) {
  const rows = [];

  if (slot === 'morning' && yesterday && yesterday.totals) {
    const t = yesterday.totals;
    rows.push(`<div>Yesterday: <span class="briefing-value">${(t.totalTops || 0).toFixed(1)} lbs</span> tops @ <span class="briefing-value">${(t.avgRate || 0).toFixed(2)}</span>/hr</div>`);
  }

  if (scoreboard) {
    if (slot === 'morning') {
      const crew = scoreboard.trimmers || scoreboard.crew || 0;
      const target = scoreboard.dailyTarget || scoreboard.target || 0;
      rows.push(`<div>Today: <span class="briefing-value">${crew}</span> trimmers, target <span class="briefing-value">${target}</span> lbs</div>`);
    } else {
      const lbs = scoreboard.totalLbs || scoreboard.totalTops || 0;
      const rate = scoreboard.avgRate || scoreboard.rate || 0;
      const target = scoreboard.dailyTarget || scoreboard.target || 0;
      const pct = target > 0 ? Math.round(lbs / target * 100) : 0;
      rows.push(`<div>Production: <span class="briefing-value">${lbs.toFixed(1)} lbs</span> @ <span class="briefing-value">${rate.toFixed(2)}</span>/hr</div>`);
      if (target > 0) {
        rows.push(`<div>vs Target: <span class="briefing-value">${pct}%</span> of <span class="briefing-value">${target}</span> lbs</div>`);
      }
    }
  }

  return rows.join('') || '<div>No data available</div>';
}

const OperationsModule = {
  name: 'operations',
  slots: ['morning', 'midday', 'evening'],

  async generate(slot) {
    const scoreboard = await fetchScoreboard();

    if (slot === 'morning') {
      const yDate = getYesterday();
      const yesterday = await fetchDashboard(yDate, yDate);
      return generateMorning(scoreboard, yesterday);
    }

    if (slot === 'midday') {
      return generateMidday(scoreboard);
    }

    if (slot === 'evening') {
      return generateEvening(scoreboard);
    }

    return null;
  }
};

export default OperationsModule;
