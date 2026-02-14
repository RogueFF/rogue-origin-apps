#!/usr/bin/env node

/**
 * RANDOM PORTFOLIO GENERATOR — Monte Carlo Baseline
 * Atlas Squad System — Backtest Module
 *
 * Generates random portfolios over a date range to establish a statistical
 * baseline. Each trial picks a random S&P 500 stock each day, buys at open,
 * sells at close the next day — a naive strategy that represents "chance."
 *
 * Used by engine.js to compute sigma distance from random performance.
 *
 * Usage (as module):
 *   const { generateRandomPortfolios } = require('./random');
 *   const results = await generateRandomPortfolios({ trials: 50, startDate, endDate });
 *
 * Usage (standalone):
 *   node random.js --trials 50
 *   node random.js --trials 100 --verbose
 */

const { getQuote } = require('../market/data');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  defaultTrials: 50,
  rateLimitMs: 1200,      // slightly above market data rate limit
  fetchTimeoutMs: 10000,
};

// Liquid S&P 500 tickers for random selection
const SP500_LIQUID = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'MA',
  'UNH', 'HD', 'PG', 'JNJ', 'XOM', 'CVX', 'BAC', 'WMT', 'KO', 'PEP',
  'ABBV', 'MRK', 'COST', 'AVGO', 'TMO', 'LLY', 'ORCL', 'ACN', 'MCD', 'CRM',
  'AMD', 'NFLX', 'ADBE', 'QCOM', 'TXN', 'INTC', 'AMAT', 'INTU', 'ISRG', 'BKNG',
  'GILD', 'MDLZ', 'ADP', 'REGN', 'VRTX', 'PANW', 'SNPS', 'KLAC', 'CDNS', 'LRCX',
];

// ─── State ───────────────────────────────────────────────────────────────────

let verbose = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = {
    info: '[RANDOM]',
    warn: '[RANDOM WARN]',
    error: '[RANDOM ERROR]',
    verbose: '[RANDOM DBG]',
  };
  if (level === 'verbose' && !verbose) return;
  console.log(`${prefix[level] || '[RANDOM]'} ${ts} ${msg}`);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a single random "trade" — pick a ticker, fetch its quote, simulate
 * a random daily return based on historical volatility of ~1-2% daily moves.
 *
 * Since we can't fetch historical OHLCV for arbitrary past dates via Yahoo
 * real-time quotes, we simulate returns using the stock's current price and
 * a realistic daily return distribution (normal, mean=0.04%, stdev=1.2%).
 */
function simulateRandomReturn() {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  // S&P 500 daily: mean ~0.04%, stdev ~1.2%
  const dailyReturn = 0.0004 + z * 0.012;
  return dailyReturn;
}

/**
 * Generate N random portfolios over a simulated period.
 *
 * Each trial simulates `tradesPerTrial` random day-trades and computes
 * total return. This gives us a distribution of "chance" returns to compare
 * against the actual portfolio.
 *
 * @param {Object} opts
 * @param {number} opts.trials - Number of random portfolios to generate
 * @param {number} opts.tradesPerTrial - Number of trades per portfolio (matches real trade count)
 * @param {number} opts.startingCapital - Starting capital per trial
 * @returns {{ mean: number, stdev: number, trials: Object[], distribution: number[] }}
 */
async function generateRandomPortfolios(opts = {}) {
  const trials = opts.trials || CONFIG.defaultTrials;
  const tradesPerTrial = opts.tradesPerTrial || 10;
  const startingCapital = opts.startingCapital || 3000;

  log(`Generating ${trials} random portfolios (${tradesPerTrial} trades each, $${startingCapital} capital)...`);

  const results = [];

  for (let i = 0; i < trials; i++) {
    let capital = startingCapital;
    const trades = [];

    for (let t = 0; t < tradesPerTrial; t++) {
      const ticker = pickRandom(SP500_LIQUID);
      const returnPct = simulateRandomReturn();
      const positionSize = capital * 0.2; // 20% of capital per trade (similar to our rules)
      const pnl = positionSize * returnPct;
      capital += pnl;

      trades.push({
        ticker,
        returnPct: returnPct * 100,
        pnl,
      });
    }

    const totalReturn = ((capital - startingCapital) / startingCapital) * 100;

    results.push({
      trial: i + 1,
      finalCapital: capital,
      totalReturnPct: totalReturn,
      totalPnl: capital - startingCapital,
      tradeCount: tradesPerTrial,
    });

    if ((i + 1) % 10 === 0) {
      log(`  ... ${i + 1}/${trials} trials complete`, 'verbose');
    }
  }

  // Compute distribution statistics
  const returns = results.map(r => r.totalReturnPct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);

  // Sort for percentile calculation
  const sorted = [...returns].sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  const summary = {
    trials,
    tradesPerTrial,
    startingCapital,
    mean,
    stdev,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    percentiles: { p5, p25, p50, p75, p95 },
    distribution: returns,
  };

  log(`Random baseline: mean=${mean.toFixed(2)}%, stdev=${stdev.toFixed(2)}%, range=[${sorted[0].toFixed(2)}%, ${sorted[sorted.length - 1].toFixed(2)}%]`);

  return summary;
}

/**
 * Compute sigma distance and p-value of actual return vs random baseline.
 *
 * @param {number} actualReturnPct - Our portfolio's return %
 * @param {{ mean: number, stdev: number, distribution: number[] }} baseline
 * @returns {{ sigma: number, pValue: number, percentile: number, interpretation: string }}
 */
function computeSignificance(actualReturnPct, baseline) {
  const { mean, stdev, distribution } = baseline;

  // Sigma distance (z-score)
  const sigma = stdev > 0 ? (actualReturnPct - mean) / stdev : 0;

  // Empirical p-value: fraction of random portfolios that beat our return
  const beatCount = distribution.filter(r => r >= actualReturnPct).length;
  const pValue = beatCount / distribution.length;

  // Percentile rank
  const belowCount = distribution.filter(r => r < actualReturnPct).length;
  const percentile = (belowCount / distribution.length) * 100;

  // Interpretation
  let interpretation;
  if (sigma >= 3) interpretation = 'STRONG SIGNAL — Model significantly outperforms random chance';
  else if (sigma >= 2) interpretation = 'SIGNAL — Model likely outperforms random chance';
  else if (sigma >= 1) interpretation = 'WEAK SIGNAL — Suggestive but not conclusive';
  else if (sigma >= 0) interpretation = 'NO SIGNAL — Performance within random range';
  else interpretation = 'UNDERPERFORMING — Worse than random chance';

  return {
    sigma: parseFloat(sigma.toFixed(3)),
    pValue: parseFloat(pValue.toFixed(4)),
    percentile: parseFloat(percentile.toFixed(1)),
    interpretation,
  };
}

// ─── Module Exports ──────────────────────────────────────────────────────────

function setVerbose(v) { verbose = v; }

module.exports = { generateRandomPortfolios, computeSignificance, setVerbose, SP500_LIQUID };

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = { trials: CONFIG.defaultTrials, tradesPerTrial: 10, verbose: false, help: false };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--trials' && args[i + 1]) { parsed.trials = parseInt(args[i + 1], 10); i++; }
      else if (args[i] === '--trades' && args[i + 1]) { parsed.tradesPerTrial = parseInt(args[i + 1], 10); i++; }
      else if (args[i] === '--verbose') parsed.verbose = true;
      else if (args[i] === '--help') parsed.help = true;
    }
    return parsed;
  }

  const args = parseArgs();

  if (args.help) {
    console.log(`
RANDOM PORTFOLIO GENERATOR — Monte Carlo Baseline
Usage: node random.js [options]

Options:
  --trials N     Number of random portfolios (default: ${CONFIG.defaultTrials})
  --trades N     Trades per portfolio (default: 10)
  --verbose      Extra logging
  --help         Show this help
    `.trim());
    process.exit(0);
  }

  verbose = args.verbose;

  generateRandomPortfolios({
    trials: args.trials,
    tradesPerTrial: args.tradesPerTrial,
  }).then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
  }).catch(err => {
    log(`Fatal: ${err.message}`, 'error');
    process.exit(1);
  });
}
