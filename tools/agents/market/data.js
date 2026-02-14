#!/usr/bin/env node

/**
 * MARKET DATA — Real-Time Quote & Options Chain Module
 * Atlas Squad System — Market Data Provider
 *
 * Fetches real-time stock prices and options chains from Yahoo Finance.
 * Used by the Strategist to replace placeholder pricing with real market data.
 *
 * Usage (standalone):
 *   node data.js AAPL                      # Get quote
 *   node data.js AAPL options              # Get options chain
 *   node data.js AAPL spread bullish 500   # Find best spread for $500 budget
 *   node data.js AAPL --verbose            # Extra logging
 *
 * Usage (as module):
 *   const { getQuote, getOptionsChain, findBestSpread } = require('./data');
 *   const quote = await getQuote('AAPL');
 *   const chain = await getOptionsChain('AAPL');
 *   const spread = await findBestSpread('AAPL', 'bullish', 500);
 *
 * Data source: Yahoo Finance (no API key needed)
 * Rate limit: max 1 request per second
 * Cache: 5-minute TTL for quotes
 */

const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  quoteUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=1d',
  optionsUrl: 'https://cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json',
  userAgent: 'Mozilla/5.0 (compatible; AtlasSquad/1.0)',
  rateLimitMs: 1000,        // 1 request per second
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  fetchTimeoutMs: 10000,     // 10 second timeout
};

// ─── State ───────────────────────────────────────────────────────────────────

const quoteCache = new Map();   // ticker -> { data, timestamp }
let lastRequestTime = 0;        // For rate limiting
let verbose = false;            // Set by parseArgs or caller

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = { info: '[MARKET]', warn: '[MARKET WARN]', error: '[MARKET ERROR]', verbose: '[MARKET DBG]' };
  if (level === 'verbose' && !verbose) return;
  console.log(`${prefix[level] || '[MARKET]'} ${ts} ${msg}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { ticker: null, command: 'quote', direction: null, budget: null, verbose: false };
  const positional = [];
  for (const arg of args) {
    if (arg === '--verbose') parsed.verbose = true;
    else positional.push(arg);
  }
  if (positional.length >= 1) parsed.ticker = positional[0].toUpperCase();
  if (positional.length >= 2) parsed.command = positional[1].toLowerCase();
  if (positional.length >= 3) parsed.direction = positional[2].toLowerCase();
  if (positional.length >= 4) parsed.budget = parseFloat(positional[3]);
  return parsed;
}

/**
 * Rate-limit: wait until at least CONFIG.rateLimitMs since last request.
 */
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < CONFIG.rateLimitMs) {
    const waitMs = CONFIG.rateLimitMs - elapsed;
    log(`Rate limit: waiting ${waitMs}ms`, 'verbose');
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch with timeout and error handling.
 */
async function safeFetch(url) {
  await rateLimit();
  log(`Fetching: ${url}`, 'verbose');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': CONFIG.userAgent },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      log(`HTTP ${res.status} from ${url}`, 'warn');
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`Fetch error for ${url}: ${err.message}`, 'error');
    return null;
  }
}

// ─── Exported Functions ──────────────────────────────────────────────────────

/**
 * Get a real-time quote for a ticker.
 * Returns: { ticker, price, change, changePct, volume, marketCap } or null on failure.
 */
async function getQuote(ticker) {
  ticker = ticker.toUpperCase().replace('$', '');

  // Check cache
  const cached = quoteCache.get(ticker);
  if (cached && (Date.now() - cached.timestamp) < CONFIG.cacheTtlMs) {
    log(`Cache hit for ${ticker} quote`, 'verbose');
    return cached.data;
  }

  const url = CONFIG.quoteUrl.replace('{TICKER}', encodeURIComponent(ticker));
  const json = await safeFetch(url);
  if (!json) return null;

  try {
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result) {
      log(`No chart data for ${ticker}`, 'warn');
      return null;
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = Math.round((price - prevClose) * 100) / 100;
    const changePct = prevClose ? Math.round((change / prevClose) * 10000) / 100 : 0;

    // Volume from indicators
    const indicators = result.indicators && result.indicators.quote && result.indicators.quote[0];
    const volumes = indicators && indicators.volume ? indicators.volume : [];
    const volume = volumes.length > 0 ? volumes[volumes.length - 1] : null;

    const quote = {
      ticker,
      price,
      change,
      changePct,
      volume: volume || 0,
      marketCap: meta.marketCap || null,
    };

    // Cache it
    quoteCache.set(ticker, { data: quote, timestamp: Date.now() });
    log(`Quote for ${ticker}: $${price} (${change >= 0 ? '+' : ''}${change}, ${changePct}%)`, 'verbose');
    return quote;
  } catch (err) {
    log(`Error parsing quote for ${ticker}: ${err.message}`, 'error');
    return null;
  }
}

/**
 * Get the options chain for a ticker.
 * Returns: { ticker, expirations: [...dates], calls: [...], puts: [...] } or null.
 * Each option: { strike, bid, ask, mid, volume, openInterest, iv, expiry, inTheMoney }
 */
async function getOptionsChain(ticker, expiry) {
  ticker = ticker.toUpperCase().replace('$', '');

  const url = CONFIG.optionsUrl.replace('{TICKER}', encodeURIComponent(ticker));
  const json = await safeFetch(url);
  if (!json) return null;

  try {
    const options = (json.data && json.data.options) || [];
    if (!options.length) {
      log(`No options data for ${ticker}`, 'warn');
      return null;
    }

    // Collect unique expirations
    const expirationSet = new Set();
    options.forEach(o => {
      const dm = (o.option || '').match(/(\d{6})[CP]/);
      if (dm) {
        const d = dm[1];
        expirationSet.add('20' + d.slice(0,2) + '-' + d.slice(2,4) + '-' + d.slice(4,6));
      }
    });
    const expirations = [...expirationSet].sort();

    // Filter by expiry if specified
    const filtered = expiry
      ? options.filter(o => {
          const m = (o.option||'').match(/(\d{6})[CP]/);
          if (!m) return false;
          const d = m[1];
          return ('20'+d.slice(0,2)+'-'+d.slice(2,4)+'-'+d.slice(4,6)) === expiry;
        })
      : options;

    // Parse option symbol to determine call/put: symbol contains C or P after date
    function isCall(opt) {
      // CBOE format: AAPL260213C00110000
      const sym = opt.option || '';
      const match = sym.match(/\d{6}([CP])\d+$/);
      return match ? match[1] === 'C' : false;
    }

    function parseContract(c) {
      const strike = parseFloat(c.option.match(/[CP](\d+)$/)?.[1] || 0) / 1000;
      return {
        strike: strike,
        bid: c.bid || 0,
        ask: c.ask || 0,
        mid: Math.round(((c.bid || 0) + (c.ask || 0)) / 2 * 100) / 100,
        volume: c.volume || 0,
        openInterest: c.open_interest || 0,
        iv: c.iv ? Math.round(c.iv * 100) / 100 : 0,
        expiry: (() => { const m = (c.option||'').match(/(\d{6})[CP]/); return m ? '20'+m[1].slice(0,2)+'-'+m[1].slice(2,4)+'-'+m[1].slice(4,6) : null; })(),
        inTheMoney: c.delta ? Math.abs(c.delta) > 0.5 : false,
        delta: c.delta || 0,
        theta: c.theta || 0,
      };
    }

    const calls = filtered.filter(o => isCall(o)).map(parseContract);
    const puts = filtered.filter(o => !isCall(o)).map(parseContract);

    // If no expiry specified, default to nearest with good liquidity
    let targetExpiry = expiry;
    if (!targetExpiry && expirations.length > 0) {
      // Pick the nearest Friday expiry that's > 7 days out
      const now = Date.now();
      const minDate = new Date(now + 7 * 86400000).toISOString().split('T')[0];
      targetExpiry = expirations.find(e => e >= minDate) || expirations[0];
    }

    const chain = {
      ticker,
      expirations,
      targetExpiry,
      calls: targetExpiry ? calls.filter(c => c.expiry === targetExpiry) : calls,
      puts: targetExpiry ? puts.filter(p => p.expiry === targetExpiry) : puts,
    };

    log(`Options chain for ${ticker}: ${chain.calls.length} calls, ${chain.puts.length} puts, ${expirations.length} expirations (using ${targetExpiry})`, 'verbose');
    return chain;
  } catch (err) {
    log(`Error parsing options for ${ticker}: ${err.message}`, 'error');
    return null;
  }
}


/**
 * Find the best spread for a ticker given direction and budget.
 *
 * For BULLISH: bull call spread (buy lower strike call, sell higher strike call)
 * For BEARISH: bear put spread (buy higher strike put, sell lower strike put)
 *
 * Returns: { ticker, direction, spread_type, long_leg, short_leg, net_debit, spread_width,
 *            max_loss, max_gain, contracts, expiry } or null.
 */
async function findBestSpread(ticker, direction, budget, expiry) {
  ticker = ticker.toUpperCase().replace('$', '');
  direction = (direction || 'bullish').toLowerCase();

  // Get quote for current price context
  const quote = await getQuote(ticker);
  if (!quote) {
    log(`Cannot find spread for ${ticker}: no quote data`, 'warn');
    return null;
  }
  const currentPrice = quote.price;

  // Get options chain
  const chain = await getOptionsChain(ticker, expiry);
  if (!chain) {
    log(`Cannot find spread for ${ticker}: no options chain`, 'warn');
    return null;
  }

  // Pick the nearest expiry if not specified
  const targetExpiry = expiry || chain.targetExpiry || chain.expirations[0] || null;
  if (!targetExpiry) {
    log(`No expirations available for ${ticker}`, 'warn');
    return null;
  }

  // If the expiry we used doesn't match, re-fetch with the right one
  let contracts;
  if (direction === 'bullish') {
    contracts = chain.calls;
  } else {
    contracts = chain.puts;
  }

  if (!contracts || contracts.length < 2) {
    log(`Not enough option contracts for ${ticker} to build a spread`, 'warn');
    return null;
  }

  // Filter to contracts near the money (within 10% of current price)
  const nearMoney = contracts.filter(c =>
    c.strike >= currentPrice * 0.95 && c.strike <= currentPrice * 1.05 && c.ask > 0
  );

  if (nearMoney.length < 2) {
    log(`Not enough near-the-money contracts for ${ticker}`, 'warn');
    return null;
  }

  // Sort by strike
  nearMoney.sort((a, b) => a.strike - b.strike);

  // Find the best spread: iterate adjacent pairs, pick one that fits budget with best risk/reward
  let bestSpread = null;
  let bestRatio = 0;

  for (let i = 0; i < nearMoney.length - 1; i++) {
    let longLeg, shortLeg;

    if (direction === 'bullish') {
      // Bull call: buy lower strike, sell higher strike
      longLeg = nearMoney[i];
      shortLeg = nearMoney[i + 1];
    } else {
      // Bear put: buy higher strike, sell lower strike
      longLeg = nearMoney[i + 1];
      shortLeg = nearMoney[i];
    }

    // Net debit = long ask - short bid
    const netDebit = Math.round((longLeg.ask - shortLeg.bid) * 100) / 100;
    if (netDebit <= 0) continue; // Invalid spread

    const spreadWidth = Math.abs(longLeg.strike - shortLeg.strike);
    if (spreadWidth <= 0) continue;

    const maxLossPerContract = netDebit * 100;
    const maxGainPerContract = (spreadWidth - netDebit) * 100;

    if (maxGainPerContract <= 0) continue;

    // How many contracts fit the budget
    const numContracts = Math.min(10, Math.max(1, Math.floor(budget / maxLossPerContract)));
    const totalCost = numContracts * maxLossPerContract;

    if (totalCost > budget * 1.1) continue; // Allow 10% tolerance

    const ratio = maxGainPerContract / maxLossPerContract;

    // Skip penny spreads — minimum $0.10 net debit for anything tradeable
    if (netDebit < 0.10) continue;

    // Score: balance R:R with proximity to ATM
    const longStrike = longLeg.strike;
    const distFromATM = Math.abs(longStrike - currentPrice) / currentPrice;
    // Sweet spot: slightly OTM (1-3%). Penalize deep OTM and deep ITM.
    const proximityScore = distFromATM < 0.01 ? 0.85
      : distFromATM < 0.03 ? 1.0
      : distFromATM < 0.05 ? 0.7
      : 0.2;
    // Penalize illiquid options
    const liquidityScore = longLeg.bid > 0.50 ? 1.0 : longLeg.bid > 0.10 ? 0.7 : 0.3;
    // Cap R:R contribution at 5:1 — anything higher is lottery, not edge
    const cappedRatio = Math.min(ratio, 5);
    const score = cappedRatio * proximityScore * liquidityScore;

    if (score > bestRatio) {
      bestRatio = score;
      bestSpread = {
        ticker,
        direction,
        spread_type: direction === 'bullish' ? 'bull_call_spread' : 'bear_put_spread',
        long_leg: { strike: longLeg.strike, price: longLeg.ask },
        short_leg: { strike: shortLeg.strike, price: shortLeg.bid },
        net_debit: netDebit,
        spread_width: spreadWidth,
        max_loss: Math.round(numContracts * maxLossPerContract * 100) / 100,
        max_gain: Math.round(numContracts * maxGainPerContract * 100) / 100,
        contracts: numContracts,
        expiry: targetExpiry,
      };
    }
  }

  if (bestSpread) {
    log(`Best spread for ${ticker} (${direction}): ${bestSpread.spread_type} ${bestSpread.long_leg.strike}/${bestSpread.short_leg.strike} x${bestSpread.contracts} — max gain $${bestSpread.max_gain}, max loss $${bestSpread.max_loss}`, 'verbose');
  } else {
    log(`No viable spread found for ${ticker} (${direction}) within $${budget} budget`, 'warn');
  }

  return bestSpread;
}

/**
 * Allow callers to set verbose mode (for integration with other agents).
 */
function setVerbose(v) {
  verbose = !!v;
}

// ─── Module Exports ──────────────────────────────────────────────────────────

module.exports = { getQuote, getOptionsChain, findBestSpread, setVerbose };

// ─── Standalone CLI ──────────────────────────────────────────────────────────

if (require.main === module) {
  const ARGS = parseArgs();
  verbose = ARGS.verbose;

  async function run() {
    if (!ARGS.ticker) {
      console.log('Usage:');
      console.log('  node data.js AAPL                      # Get quote');
      console.log('  node data.js AAPL options              # Get options chain');
      console.log('  node data.js AAPL spread bullish 500   # Find best spread');
      console.log('  node data.js AAPL --verbose            # Extra logging');
      process.exit(1);
    }

    log('═══════════════════════════════════════════');
    log('MARKET DATA — Real-Time Provider');
    log('═══════════════════════════════════════════');

    if (ARGS.command === 'options') {
      // Options chain
      log(`Fetching options chain for ${ARGS.ticker}...`);
      const chain = await getOptionsChain(ARGS.ticker);
      if (!chain) {
        log('Failed to fetch options chain.', 'error');
        process.exit(1);
      }
      console.log(JSON.stringify(chain, null, 2));

    } else if (ARGS.command === 'spread') {
      // Find best spread
      if (!ARGS.direction || !ARGS.budget) {
        log('Spread requires: node data.js TICKER spread <bullish|bearish> <budget>', 'error');
        process.exit(1);
      }
      log(`Finding best ${ARGS.direction} spread for ${ARGS.ticker} with $${ARGS.budget} budget...`);
      const spread = await findBestSpread(ARGS.ticker, ARGS.direction, ARGS.budget);
      if (!spread) {
        log('No viable spread found.', 'error');
        process.exit(1);
      }
      console.log(JSON.stringify(spread, null, 2));

    } else {
      // Default: quote
      log(`Fetching quote for ${ARGS.ticker}...`);
      const quote = await getQuote(ARGS.ticker);
      if (!quote) {
        log('Failed to fetch quote.', 'error');
        process.exit(1);
      }
      console.log(JSON.stringify(quote, null, 2));
    }
  }

  run().catch(err => {
    log(`Fatal error: ${err.message}`, 'error');
    console.error(err.stack);
    process.exit(1);
  });
}
