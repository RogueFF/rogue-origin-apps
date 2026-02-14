#!/usr/bin/env node

/**
 * CONFIDENCE SCORER — Play Confidence Assessment
 * Atlas Squad System — Backtest Module
 *
 * Computes a 0-100 confidence score for new trade setups by analyzing:
 * - Historical win rate for the ticker
 * - Historical win rate for the setup type (bull call spread, etc.)
 * - Regime alignment (GREEN + bullish = high confidence)
 * - Sentiment signal strength
 * - Spread pricing vs theoretical value
 * - Factor agreement / disagreement (uncertainty discount)
 *
 * Usage (as module):
 *   const { getConfidence } = require('./confidence');
 *   const score = await getConfidence(play, { closedPositions, regime });
 *
 * Usage (standalone):
 *   node confidence.js --ticker AAPL --setup "bull call spread" --direction bullish
 *   node confidence.js --help
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  API_BASE: 'https://mission-control-api.roguefamilyfarms.workers.dev/api',
  regimePath: path.join(__dirname, '..', 'regime', 'current-signal.json'),
  fetchTimeoutMs: 10000,
  userAgent: 'Mozilla/5.0 (compatible; AtlasSquad/1.0)',

  // Scoring weights (sum to 1.0)
  weights: {
    tickerHistory: 0.20,
    setupHistory: 0.20,
    regimeAlignment: 0.25,
    sentimentStrength: 0.15,
    pricingEdge: 0.10,
    factorAgreement: 0.10,
  },

  // Defaults when no history is available
  defaultWinRate: 0.50,
  minTradesForHistory: 3,   // need at least 3 trades to trust historical win rate
};

// ─── State ───────────────────────────────────────────────────────────────────

let verbose = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = {
    info: '[CONFIDENCE]',
    warn: '[CONFIDENCE WARN]',
    error: '[CONFIDENCE ERROR]',
    verbose: '[CONFIDENCE DBG]',
  };
  if (level === 'verbose' && !verbose) return;
  console.log(`${prefix[level] || '[CONFIDENCE]'} ${ts} ${msg}`);
}

async function apiCall(endpoint) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      log(`API GET ${endpoint} returned ${res.status}`, 'warn');
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`API GET ${endpoint} failed: ${err.message}`, 'warn');
    return null;
  }
}

function loadRegime() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.regimePath, 'utf-8'));
    log(`Regime loaded: ${data.signal}`, 'verbose');
    return data;
  } catch (err) {
    log(`Error loading regime: ${err.message}`, 'warn');
    return null;
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ─── Scoring Functions ──────────────────────────────────────────────────────

/**
 * Score based on historical win rate for this specific ticker.
 * Returns 0-100 where 50 = no edge (50% win rate).
 */
function scoreTickerHistory(ticker, closedPositions) {
  const tickerTrades = closedPositions.filter(p =>
    (p.ticker || '').toUpperCase() === ticker.toUpperCase()
  );

  if (tickerTrades.length < CONFIG.minTradesForHistory) {
    log(`Ticker ${ticker}: only ${tickerTrades.length} trades (need ${CONFIG.minTradesForHistory}), using default`, 'verbose');
    return { score: 50, detail: `Insufficient history (${tickerTrades.length} trades)`, winRate: null };
  }

  const wins = tickerTrades.filter(p => parseFloat(p.pnl || p.realized_pnl || 0) > 0).length;
  const winRate = wins / tickerTrades.length;
  const score = clamp(winRate * 100, 0, 100);

  return { score, detail: `${wins}/${tickerTrades.length} wins (${(winRate * 100).toFixed(0)}%)`, winRate };
}

/**
 * Score based on historical win rate for this setup type.
 */
function scoreSetupHistory(setupType, closedPositions) {
  if (!setupType) return { score: 50, detail: 'No setup type specified', winRate: null };

  const normalized = setupType.toLowerCase().trim();
  const setupTrades = closedPositions.filter(p => {
    // Match against notes (which contain "Bull call", "Bear put", etc.) and vehicle
    const notes = (p.notes || '').toLowerCase();
    const vehicle = (p.vehicle || p.strategy || p.setup_type || '').toLowerCase();
    return notes.includes(normalized) || vehicle.includes(normalized) ||
      normalized.includes(vehicle);
  });

  if (setupTrades.length < CONFIG.minTradesForHistory) {
    log(`Setup "${setupType}": only ${setupTrades.length} trades, using default`, 'verbose');
    return { score: 50, detail: `Insufficient history (${setupTrades.length} trades)`, winRate: null };
  }

  const wins = setupTrades.filter(p => parseFloat(p.pnl || p.realized_pnl || 0) > 0).length;
  const winRate = wins / setupTrades.length;
  const score = clamp(winRate * 100, 0, 100);

  return { score, detail: `${wins}/${setupTrades.length} wins (${(winRate * 100).toFixed(0)}%)`, winRate };
}

/**
 * Score regime alignment. Bullish play in GREEN regime = high score.
 */
function scoreRegimeAlignment(direction, regime) {
  if (!regime || !regime.signal) return { score: 50, detail: 'No regime data' };

  const signal = regime.signal.toUpperCase();
  const dir = (direction || '').toLowerCase();
  const isBullish = dir === 'bullish' || dir === 'long' || dir === 'call';
  const isBearish = dir === 'bearish' || dir === 'short' || dir === 'put';

  let score;
  let detail;

  if (signal === 'GREEN') {
    if (isBullish) { score = 90; detail = 'GREEN regime + bullish = strong alignment'; }
    else if (isBearish) { score = 25; detail = 'GREEN regime + bearish = counter-trend'; }
    else { score = 65; detail = 'GREEN regime, neutral direction'; }
  } else if (signal === 'YELLOW') {
    if (isBullish) { score = 50; detail = 'YELLOW regime + bullish = caution'; }
    else if (isBearish) { score = 50; detail = 'YELLOW regime + bearish = caution'; }
    else { score = 45; detail = 'YELLOW regime, uncertain'; }
  } else { // RED
    if (isBearish) { score = 80; detail = 'RED regime + bearish = aligned'; }
    else if (isBullish) { score = 15; detail = 'RED regime + bullish = counter-trend warning'; }
    else { score = 30; detail = 'RED regime, defensive posture'; }
  }

  return { score, detail };
}

/**
 * Score sentiment signal strength (from Viper).
 * Higher absolute sentiment = more conviction.
 */
function scoreSentimentStrength(play) {
  const sentiment = play.sentiment_score || play.sentimentScore || null;
  if (sentiment === null || sentiment === undefined) {
    return { score: 50, detail: 'No sentiment data' };
  }

  // Sentiment is typically -1 to +1 or -100 to +100
  const normalized = Math.abs(sentiment) > 1 ? sentiment / 100 : sentiment;
  const strength = Math.abs(normalized);

  // Strong sentiment in the right direction = high score
  const direction = (play.direction || '').toLowerCase();
  const isBullish = direction === 'bullish' || direction === 'long';
  const sentimentBullish = normalized > 0;

  let score;
  if ((isBullish && sentimentBullish) || (!isBullish && !sentimentBullish)) {
    // Sentiment aligns with direction
    score = 50 + (strength * 50);
  } else {
    // Sentiment conflicts with direction
    score = 50 - (strength * 40);
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    detail: `Sentiment ${normalized > 0 ? '+' : ''}${(normalized * 100).toFixed(0)}%, strength ${(strength * 100).toFixed(0)}%`,
  };
}

/**
 * Score spread pricing edge.
 * If the spread is cheaper than theoretical mid, it's a better entry.
 */
function scorePricingEdge(play) {
  const cost = parseFloat(play.cost || play.debit || play.premium || 0);
  const theoretical = parseFloat(play.theoretical_value || play.fair_value || 0);

  if (!cost || !theoretical) {
    return { score: 50, detail: 'No pricing data available' };
  }

  // Discount = how much cheaper we're getting vs fair value
  const discount = (theoretical - cost) / theoretical;

  let score;
  if (discount > 0.15) score = 90;       // >15% discount
  else if (discount > 0.05) score = 70;   // 5-15% discount
  else if (discount > -0.05) score = 50;  // ~fair value
  else if (discount > -0.15) score = 30;  // 5-15% premium
  else score = 15;                         // >15% overpaying

  return {
    score: clamp(score, 0, 100),
    detail: `${discount >= 0 ? 'Discount' : 'Premium'}: ${(Math.abs(discount) * 100).toFixed(1)}%`,
  };
}

/**
 * Score factor agreement. If most factors point the same direction, confidence is high.
 * Disagreement between factors = uncertainty discount.
 */
function scoreFactorAgreement(factorScores) {
  const scores = Object.values(factorScores).map(f => f.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Standard deviation of factor scores — high stdev = disagreement
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const stdev = Math.sqrt(variance);

  // Low stdev (agreement) = high score. High stdev (disagreement) = low score.
  // stdev of 0 means perfect agreement → 100
  // stdev of 30+ means major disagreement → low score
  const score = clamp(Math.round(100 - (stdev * 2.5)), 0, 100);

  return {
    score,
    detail: `Factor spread: stdev=${stdev.toFixed(1)} (${stdev < 10 ? 'strong agreement' : stdev < 20 ? 'moderate agreement' : 'disagreement'})`,
  };
}

// ─── Main Confidence Function ───────────────────────────────────────────────

/**
 * Compute confidence score for a trade play.
 *
 * @param {Object} play - Trade setup from Strategist
 * @param {Object} [context] - Optional context (closedPositions, regime)
 * @returns {Promise<{ score: number, grade: string, breakdown: Object }>}
 */
async function getConfidence(play, context = {}) {
  log(`Computing confidence for ${play.ticker || 'unknown'} ${play.strategy || play.setup_type || ''}...`);

  // Load context if not provided
  let closedPositions = context.closedPositions || [];
  let regime = context.regime || null;

  if (!closedPositions.length) {
    const res = await apiCall('/positions?status=closed');
    if (res && res.data) closedPositions = res.data;
  }

  if (!regime) {
    regime = loadRegime();
  }

  // Compute individual factor scores
  const ticker = scoreTickerHistory(play.ticker, closedPositions);
  const setup = scoreSetupHistory(play.strategy || play.setup_type, closedPositions);
  const regimeAlign = scoreRegimeAlignment(play.direction, regime);
  const sentiment = scoreSentimentStrength(play);
  const pricing = scorePricingEdge(play);

  const factors = { ticker, setup, regimeAlign, sentiment, pricing };
  const agreement = scoreFactorAgreement(factors);

  // Weighted composite score
  const w = CONFIG.weights;
  const composite =
    ticker.score * w.tickerHistory +
    setup.score * w.setupHistory +
    regimeAlign.score * w.regimeAlignment +
    sentiment.score * w.sentimentStrength +
    pricing.score * w.pricingEdge +
    agreement.score * w.factorAgreement;

  const finalScore = clamp(Math.round(composite), 0, 100);

  // Grade
  let grade;
  if (finalScore >= 80) grade = 'A';
  else if (finalScore >= 65) grade = 'B';
  else if (finalScore >= 50) grade = 'C';
  else if (finalScore >= 35) grade = 'D';
  else grade = 'F';

  const result = {
    score: finalScore,
    grade,
    ticker: play.ticker,
    setup: play.strategy || play.setup_type || null,
    direction: play.direction || null,
    breakdown: {
      tickerHistory: { ...ticker, weight: w.tickerHistory },
      setupHistory: { ...setup, weight: w.setupHistory },
      regimeAlignment: { ...regimeAlign, weight: w.regimeAlignment },
      sentimentStrength: { ...sentiment, weight: w.sentimentStrength },
      pricingEdge: { ...pricing, weight: w.pricingEdge },
      factorAgreement: { ...agreement, weight: w.factorAgreement },
    },
    timestamp: new Date().toISOString(),
  };

  log(`Confidence: ${finalScore}/100 (${grade}) for ${play.ticker}`);

  return result;
}

// ─── Module Exports ──────────────────────────────────────────────────────────

function setVerbose(v) { verbose = v; }

module.exports = { getConfidence, setVerbose };

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
      ticker: null,
      setup: null,
      direction: null,
      verbose: false,
      help: false,
    };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--ticker' && args[i + 1]) { parsed.ticker = args[i + 1].toUpperCase(); i++; }
      else if (args[i] === '--setup' && args[i + 1]) { parsed.setup = args[i + 1]; i++; }
      else if (args[i] === '--direction' && args[i + 1]) { parsed.direction = args[i + 1]; i++; }
      else if (args[i] === '--verbose') parsed.verbose = true;
      else if (args[i] === '--help') parsed.help = true;
    }
    return parsed;
  }

  const args = parseArgs();

  if (args.help || !args.ticker) {
    console.log(`
CONFIDENCE SCORER — Play Confidence Assessment
Usage: node confidence.js --ticker AAPL [options]

Options:
  --ticker SYM      Ticker symbol (required)
  --setup TYPE      Setup type (e.g. "bull call spread")
  --direction DIR   Direction (bullish/bearish)
  --verbose         Extra logging
  --help            Show this help

Example:
  node confidence.js --ticker AAPL --setup "bull call spread" --direction bullish
    `.trim());
    process.exit(args.help ? 0 : 1);
  }

  verbose = args.verbose;

  const play = {
    ticker: args.ticker,
    strategy: args.setup,
    direction: args.direction,
  };

  getConfidence(play).then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
  }).catch(err => {
    log(`Fatal: ${err.message}`, 'error');
    process.exit(1);
  });
}
