#!/usr/bin/env node

/**
 * ALPACA BROKER CLIENT
 * REST API client for Alpaca paper/live trading.
 *
 * Supports: orders, positions, account info, order management.
 * Options level 3, shorting enabled on paper account ($100K).
 *
 * Usage:
 *   const alpaca = require('./alpaca');
 *   const account = await alpaca.getAccount();
 *   const order = await alpaca.placeOrder('AAPL', 10, 'buy', 'market', 'day');
 *
 * Environment:
 *   ALPACA_API_KEY     — API key ID
 *   ALPACA_SECRET      — Secret key
 *   ALPACA_BASE_URL    — Base URL (paper or live)
 */

const path = require('path');

// Load .env from repo root if available
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (e) { /* dotenv not installed — env vars must be set externally */ }

// ─── Configuration ───────────────────────────────────────────────────────────

const API_KEY = process.env.ALPACA_API_KEY;
const API_SECRET = process.env.ALPACA_SECRET;
const BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const TIMEOUT_MS = 15000;

if (!API_KEY || !API_SECRET) {
  console.warn('[ALPACA] Warning: ALPACA_API_KEY or ALPACA_SECRET not set.');
}

// ─── HTTP Client ─────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Alpaca API.
 * @param {string} endpoint - API path (e.g., '/v2/account')
 * @param {string} method - HTTP method
 * @param {object|null} body - Request body (JSON)
 * @returns {Promise<object|null>} Response data or null on error
 */
async function request(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const opts = {
      method,
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': API_SECRET,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    clearTimeout(timer);

    // DELETE returns 204 No Content on success
    if (res.status === 204) return { success: true };

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = data?.message || data?.code || res.statusText;
      console.error(`[ALPACA] ${method} ${endpoint} → ${res.status}: ${msg}`);
      return { error: true, status: res.status, message: msg, data };
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    console.error(`[ALPACA] ${method} ${endpoint} failed: ${err.message}`);
    return { error: true, message: err.message };
  }
}

// ─── Account ─────────────────────────────────────────────────────────────────

/**
 * Get account information (buying power, equity, etc.)
 * @returns {Promise<object|null>}
 */
async function getAccount() {
  return request('/v2/account');
}

// ─── Positions ───────────────────────────────────────────────────────────────

/**
 * Get all open positions.
 * @returns {Promise<Array>}
 */
async function getPositions() {
  const data = await request('/v2/positions');
  return Array.isArray(data) ? data : [];
}

/**
 * Get a specific position by symbol or asset ID.
 * @param {string} symbolOrId - Symbol (e.g., 'AAPL') or asset UUID
 * @returns {Promise<object|null>}
 */
async function getPosition(symbolOrId) {
  return request(`/v2/positions/${encodeURIComponent(symbolOrId)}`);
}

/**
 * Close (liquidate) a position by symbol or asset ID.
 * @param {string} symbolOrId - Symbol or asset UUID
 * @param {object} opts - Optional: { qty, percentage }
 * @returns {Promise<object|null>}
 */
async function closePosition(symbolOrId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.qty) params.set('qty', opts.qty);
  if (opts.percentage) params.set('percentage', opts.percentage);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/v2/positions/${encodeURIComponent(symbolOrId)}${qs}`, 'DELETE');
}

/**
 * Close all open positions.
 * @param {boolean} cancelOrders - Also cancel all open orders (default true)
 * @returns {Promise<object|null>}
 */
async function closeAllPositions(cancelOrders = true) {
  return request(`/v2/positions?cancel_orders=${cancelOrders}`, 'DELETE');
}

// ─── Orders ──────────────────────────────────────────────────────────────────

/**
 * Place an order.
 * @param {string} symbol - Ticker symbol
 * @param {number} qty - Quantity (shares or contracts)
 * @param {string} side - 'buy' or 'sell'
 * @param {string} type - 'market', 'limit', 'stop', 'stop_limit', 'trailing_stop'
 * @param {string} timeInForce - 'day', 'gtc', 'opg', 'cls', 'ioc', 'fok'
 * @param {number|null} limitPrice - Limit price (required for limit/stop_limit)
 * @param {number|null} stopPrice - Stop price (required for stop/stop_limit)
 * @param {object} extra - Additional order params (extended_hours, client_order_id, order_class, legs, etc.)
 * @returns {Promise<object|null>}
 */
async function placeOrder(symbol, qty, side, type = 'market', timeInForce = 'day', limitPrice = null, stopPrice = null, extra = {}) {
  const order = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
    ...extra,
  };

  if (limitPrice !== null && limitPrice !== undefined) {
    order.limit_price = String(limitPrice);
  }
  if (stopPrice !== null && stopPrice !== undefined) {
    order.stop_price = String(stopPrice);
  }

  return request('/v2/orders', 'POST', order);
}

/**
 * Place a bracket order (entry + take profit + stop loss).
 * @param {string} symbol
 * @param {number} qty
 * @param {string} side
 * @param {string} type
 * @param {string} timeInForce
 * @param {object} takeProfit - { limit_price }
 * @param {object} stopLoss - { stop_price, limit_price? }
 * @param {number|null} limitPrice
 * @returns {Promise<object|null>}
 */
async function placeBracketOrder(symbol, qty, side, type, timeInForce, takeProfit, stopLoss, limitPrice = null) {
  return placeOrder(symbol, qty, side, type, timeInForce, limitPrice, null, {
    order_class: 'bracket',
    take_profit: takeProfit,
    stop_loss: stopLoss,
  });
}

/**
 * Place an options order (single leg).
 * Alpaca options use OCC symbol format: SYMBOL + YYMMDD + C/P + strike*1000
 * Example: SPY260320C00580000 = SPY Mar 20 2026 $580 Call
 *
 * @param {string} occSymbol - OCC-format option symbol
 * @param {number} qty - Number of contracts
 * @param {string} side - 'buy' or 'sell'
 * @param {string} type - 'market' or 'limit'
 * @param {string} timeInForce - 'day' or 'gtc'
 * @param {number|null} limitPrice - Per-contract limit price
 * @returns {Promise<object|null>}
 */
async function placeOptionsOrder(occSymbol, qty, side, type = 'limit', timeInForce = 'day', limitPrice = null) {
  const order = {
    symbol: occSymbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
  };
  if (limitPrice !== null) {
    order.limit_price = String(limitPrice);
  }
  return request('/v2/orders', 'POST', order);
}

/**
 * Place a multi-leg options order (spread, iron condor, etc.)
 * @param {Array<object>} legs - Array of { symbol (OCC), side, qty, ratio_qty? }
 * @param {string} type - 'market' or 'limit'
 * @param {string} timeInForce - 'day' or 'gtc'
 * @param {number|null} limitPrice - Net debit/credit limit price
 * @returns {Promise<object|null>}
 */
async function placeMultiLegOrder(legs, type = 'limit', timeInForce = 'day', limitPrice = null) {
  const order = {
    order_class: 'mleg',
    type,
    time_in_force: timeInForce,
    legs: legs.map(leg => ({
      symbol: leg.symbol,
      side: leg.side,
      qty: String(leg.qty || 1),
      ...(leg.ratio_qty ? { ratio_qty: String(leg.ratio_qty) } : {}),
    })),
  };
  if (limitPrice !== null) {
    order.limit_price = String(limitPrice);
  }
  return request('/v2/orders', 'POST', order);
}

/**
 * Get orders with optional filters.
 * @param {string} status - 'open', 'closed', 'all' (default 'open')
 * @param {number} limit - Max results (default 50, max 500)
 * @param {object} opts - { after, until, direction, nested, symbols }
 * @returns {Promise<Array>}
 */
async function getOrders(status = 'open', limit = 50, opts = {}) {
  const params = new URLSearchParams({ status, limit: String(limit) });
  if (opts.after) params.set('after', opts.after);
  if (opts.until) params.set('until', opts.until);
  if (opts.direction) params.set('direction', opts.direction);
  if (opts.nested) params.set('nested', 'true');
  if (opts.symbols) params.set('symbols', opts.symbols);

  const data = await request(`/v2/orders?${params.toString()}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Get a specific order by ID.
 * @param {string} orderId - Order UUID
 * @returns {Promise<object|null>}
 */
async function getOrder(orderId) {
  return request(`/v2/orders/${orderId}`);
}

/**
 * Cancel a pending order.
 * @param {string} orderId - Order UUID
 * @returns {Promise<object|null>}
 */
async function cancelOrder(orderId) {
  return request(`/v2/orders/${orderId}`, 'DELETE');
}

/**
 * Cancel all open orders.
 * @returns {Promise<object|null>}
 */
async function cancelAllOrders() {
  return request('/v2/orders', 'DELETE');
}

/**
 * Replace (modify) an existing order.
 * @param {string} orderId - Order UUID
 * @param {object} updates - { qty, time_in_force, limit_price, stop_price, trail }
 * @returns {Promise<object|null>}
 */
async function replaceOrder(orderId, updates) {
  return request(`/v2/orders/${orderId}`, 'PATCH', updates);
}

// ─── Options Chain (via Alpaca Options API) ──────────────────────────────────

/**
 * Get options contracts for a symbol.
 * @param {string} underlyingSymbol - e.g., 'SPY'
 * @param {object} opts - { expiration_date, type ('call'|'put'), strike_price_gte, strike_price_lte, limit }
 * @returns {Promise<Array>}
 */
async function getOptionsContracts(underlyingSymbol, opts = {}) {
  const params = new URLSearchParams({
    underlying_symbols: underlyingSymbol,
    ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v != null)),
  });
  const data = await request(`/v2/options/contracts?${params.toString()}`);
  return data?.option_contracts || (Array.isArray(data) ? data : []);
}

// ─── OCC Symbol Builder ─────────────────────────────────────────────────────

/**
 * Build an OCC-format option symbol.
 * @param {string} symbol - Underlying (e.g., 'SPY')
 * @param {string} expiry - Expiry date 'YYYY-MM-DD'
 * @param {string} optionType - 'C' or 'P'
 * @param {number} strike - Strike price
 * @returns {string} OCC symbol (e.g., 'SPY260320C00580000')
 */
function buildOccSymbol(symbol, expiry, optionType, strike) {
  // Pad symbol to 6 chars (right-padded with spaces, but Alpaca uses variable length)
  const sym = symbol.toUpperCase();
  // Date: YYMMDD
  const [y, m, d] = expiry.split('-');
  const dateStr = y.slice(2) + m + d;
  // Type: C or P
  const type = optionType.toUpperCase().charAt(0);
  // Strike: 8 digits, strike * 1000, zero-padded
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${sym}${dateStr}${type}${strikeStr}`;
}

/**
 * Parse an OCC symbol back to components.
 * @param {string} occ - OCC symbol
 * @returns {{ symbol, expiry, type, strike }}
 */
function parseOccSymbol(occ) {
  // Match: SYMBOL(1-6) + YYMMDD + C/P + 8-digit strike
  const match = occ.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, symbol, date, type, strikeRaw] = match;
  return {
    symbol,
    expiry: `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`,
    type: type === 'C' ? 'call' : 'put',
    strike: parseInt(strikeRaw, 10) / 1000,
  };
}

// ─── Portfolio Snapshot ──────────────────────────────────────────────────────

/**
 * Get a complete portfolio snapshot: account + positions + open orders.
 * Useful for dealer status checks.
 * @returns {Promise<object>}
 */
async function getPortfolioSnapshot() {
  const [account, positions, orders] = await Promise.all([
    getAccount(),
    getPositions(),
    getOrders('open'),
  ]);

  return {
    account: account?.error ? null : account,
    positions,
    orders,
    timestamp: new Date().toISOString(),
    summary: account?.error ? null : {
      equity: parseFloat(account.equity),
      buyingPower: parseFloat(account.buying_power),
      cash: parseFloat(account.cash),
      portfolioValue: parseFloat(account.portfolio_value),
      positionCount: positions.length,
      openOrderCount: orders.length,
      daytradeCount: parseInt(account.daytrade_count, 10) || 0,
      patternDayTrader: account.pattern_day_trader === true,
    },
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Core
  request,

  // Account
  getAccount,

  // Positions
  getPositions,
  getPosition,
  closePosition,
  closeAllPositions,

  // Orders
  placeOrder,
  placeBracketOrder,
  placeOptionsOrder,
  placeMultiLegOrder,
  getOrders,
  getOrder,
  cancelOrder,
  cancelAllOrders,
  replaceOrder,

  // Options
  getOptionsContracts,
  buildOccSymbol,
  parseOccSymbol,

  // Convenience
  getPortfolioSnapshot,
};
