#!/usr/bin/env node

/**
 * BACKTEST ENGINE — Historical Trade Replay & Statistical Validation
 * Atlas Squad System — Backtest Agent
 *
 * Replays historical trades from Mission Control API and validates performance
 * against a Monte Carlo random baseline. Answers the question: "Are we beating
 * chance, or just getting lucky?"
 *
 * Commands:
 *   node engine.js replay                 Replay closed trades, compute metrics
 *   node engine.js random --trials 50     Generate random baseline portfolios
 *   node engine.js validate               Full validation (replay + random + comparison)
 *   node engine.js report                 Generate summary and POST to activity feed
 *
 * Flags:
 *   --dry-run     No API writes (reads still work)
 *   --verbose     Extra debug logging
 *   --trials N    Number of random portfolios (default: 50)
 *   --help        Show usage
 *
 * Data source: Mission Control API (single source of truth).
 */

const fs = require('fs');
const path = require('path');
const { agentStart, agentDone, agentError } = require('../status');
const { generateRandomPortfolios, computeSignificance } = require('./random');
const { getConfidence } = require('./confidence');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  API_BASE: 'https://mission-control-api.roguefamilyfarms.workers.dev/api',
  regimePath: path.join(__dirname, '..', 'regime', 'current-signal.json'),
  deliverablesDir: path.join(__dirname, 'deliverables'),
  userAgent: 'Mozilla/5.0 (compatible; AtlasSquad/1.0)',
  fetchTimeoutMs: 15000,
  defaultTrials: 50,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg, level = 'info') {
  const ts = new Date().toISOString();
  const prefix = {
    info: '[BACKTEST]',
    warn: '[BACKTEST WARN]',
    error: '[BACKTEST ERROR]',
    verbose: '[BACKTEST DBG]',
  };
  if (level === 'verbose' && !ARGS.verbose) return;
  console.log(`${prefix[level] || '[BACKTEST]'} ${ts} ${msg}`);
}

function todayStamp() {
  return new Date().toISOString().split('T')[0];
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ─── Parse CLI Args ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    command: null,
    dryRun: false,
    verbose: false,
    trials: CONFIG.defaultTrials,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') parsed.dryRun = true;
    else if (args[i] === '--verbose') parsed.verbose = true;
    else if (args[i] === '--help') parsed.help = true;
    else if (args[i] === '--trials' && args[i + 1]) { parsed.trials = parseInt(args[i + 1], 10); i++; }
    else if (!args[i].startsWith('--') && !parsed.command) parsed.command = args[i];
  }

  return parsed;
}

const ARGS = parseArgs();

// ─── Help ────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
BACKTEST ENGINE — Historical Trade Replay & Statistical Validation
Atlas Squad System

Commands:
  replay              Replay closed trades, compute performance metrics
  random              Generate random baseline portfolios (Monte Carlo)
  validate            Full validation: replay + random + statistical comparison
  report              Generate summary report and POST to activity feed

Flags:
  --dry-run           No API writes (reads still work)
  --verbose           Extra debug logging
  --trials N          Number of random portfolios (default: ${CONFIG.defaultTrials})
  --help              Show this help

Examples:
  node engine.js replay
  node engine.js random --trials 100
  node engine.js validate --trials 50 --verbose
  node engine.js report --dry-run
  `.trim());
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function apiCall(endpoint, method = 'GET', body = null) {
  if (ARGS.dryRun && method !== 'GET') {
    log(`DRY RUN — skip ${method} ${endpoint}`, 'verbose');
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, opts);
    clearTimeout(timer);
    if (!res.ok) {
      log(`API ${method} ${endpoint} returned ${res.status}`, 'warn');
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`API ${method} ${endpoint} failed: ${err.message}`, 'warn');
    return null;
  }
}

async function postActivity(title, body) {
  await apiCall('/activity', 'POST', {
    agent_name: 'backtest',
    type: 'analysis',
    domain: 'trading',
    title,
    body,
  });
}

// ─── Data Loading ────────────────────────────────────────────────────────────

async function loadClosedPositions() {
  const res = await apiCall('/positions?status=closed');
  if (!res) {
    log('Failed to load closed positions.', 'error');
    return [];
  }
  const positions = res.data || res;
  log(`Loaded ${positions.length} closed positions.`);
  return Array.isArray(positions) ? positions : [];
}

async function loadPortfolio() {
  const res = await apiCall('/portfolio');
  if (!res) {
    log('Failed to load portfolio.', 'error');
    return null;
  }
  return res.data || res;
}

function loadRegime() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.regimePath, 'utf-8'));
    log(`Regime loaded: ${data.signal} — ${data.label || ''}`, 'verbose');
    return data;
  } catch (err) {
    log(`Error loading regime: ${err.message}`, 'warn');
    return null;
  }
}

// ─── Trade Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze a single closed position from Mission Control API.
 *
 * API fields: id, ticker, direction, vehicle, strike, expiry, entry_price, quantity,
 * entry_date, status, exit_price, exit_date, pnl, notes, target_price, stop_loss
 */
function analyzeTrade(position) {
  const entry = parseFloat(position.entry_price || 0);
  const exit = parseFloat(position.exit_price || 0);
  const qty = parseInt(position.quantity || 1, 10);

  // P&L: use API pnl if available, otherwise compute from prices
  // API pnl is total $ P&L (already includes quantity * 100 multiplier for options)
  let realizedPnl = parseFloat(position.pnl || 0);
  if (!realizedPnl && entry > 0 && exit > 0) {
    realizedPnl = (exit - entry) * qty * 100;
  }

  // Cost basis for options spreads: entry premium * quantity * 100 (contract multiplier)
  const costBasis = entry * qty * 100;

  // Return calculation
  const returnPct = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;

  // Hold duration
  const entryDate = position.entry_date || position.created_at;
  const exitDate = position.exit_date;
  let holdDays = null;
  if (entryDate && exitDate) {
    holdDays = Math.max(1, Math.round((new Date(exitDate) - new Date(entryDate)) / (1000 * 60 * 60 * 24)));
  }

  // Parse setup type from notes (e.g. "Bear put 74/72.5 Feb20" or "Bull call 187.5/190")
  const notesLower = (position.notes || '').toLowerCase();
  let setupType = position.vehicle || 'unknown';
  if (notesLower.includes('bull call')) setupType = 'bull_call_spread';
  else if (notesLower.includes('bear put')) setupType = 'bear_put_spread';
  else if (notesLower.includes('degen')) setupType = 'degen';

  // Parse regime from notes (e.g. "RED regime defensive")
  let regimeAtEntry = null;
  const regimeMatch = (position.notes || '').match(/(RED|YELLOW|GREEN)\s*regime/i);
  if (regimeMatch) regimeAtEntry = regimeMatch[1].toUpperCase();

  // Result classification
  const isWin = realizedPnl > 0;
  const hitTarget = exit >= parseFloat(position.target_price || Infinity);
  const hitStop = position.stop_loss > 0 && exit <= parseFloat(position.stop_loss);

  // Exit reason from dealer notes
  let exitReason = 'unknown';
  const dealerMatch = (position.notes || '').match(/Dealer auto-close: (\S+)/);
  if (dealerMatch) exitReason = dealerMatch[1];
  else if (hitTarget) exitReason = 'target_hit';
  else if (hitStop) exitReason = 'stop_loss';

  return {
    id: position.id,
    ticker: position.ticker,
    strategy: setupType,
    direction: position.direction || 'unknown',
    vehicle: position.vehicle || 'spread',
    regime_at_entry: regimeAtEntry,
    entry_price: entry,
    exit_price: exit,
    quantity: qty,
    cost_basis: parseFloat(costBasis.toFixed(2)),
    realized_pnl: parseFloat(realizedPnl.toFixed(2)),
    return_pct: parseFloat(returnPct.toFixed(2)),
    hold_days: holdDays,
    is_win: isWin,
    hit_target: hitTarget,
    hit_stop: hitStop,
    exit_reason: exitReason,
    entry_date: entryDate || null,
    exit_date: exitDate || null,
    expiry: position.expiry || null,
    notes: position.notes || '',
  };
}

/**
 * Compute aggregate metrics from analyzed trades.
 */
function computeMetrics(trades) {
  if (trades.length === 0) {
    return {
      trade_count: 0,
      win_rate: 0,
      expectancy: 0,
      total_pnl: 0,
      avg_return_pct: 0,
      sharpe_ratio: 0,
      max_drawdown: 0,
      avg_hold_days: 0,
      by_regime: {},
      by_setup: {},
      best_trade: null,
      worst_trade: null,
    };
  }

  // Basic stats
  const wins = trades.filter(t => t.is_win).length;
  const losses = trades.length - wins;
  const winRate = wins / trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.realized_pnl, 0);
  const avgPnl = totalPnl / trades.length;
  const avgReturn = trades.reduce((s, t) => s + t.return_pct, 0) / trades.length;

  // Expectancy (avg win * win rate - avg loss * loss rate)
  const avgWin = wins > 0 ? trades.filter(t => t.is_win).reduce((s, t) => s + t.realized_pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(trades.filter(t => !t.is_win).reduce((s, t) => s + t.realized_pnl, 0) / losses) : 0;
  const expectancy = (avgWin * winRate) - (avgLoss * (1 - winRate));

  // Sharpe ratio (annualized, using daily returns)
  const returns = trades.map(t => t.return_pct / 100);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const returnVariance = returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length;
  const returnStdev = Math.sqrt(returnVariance);
  const sharpeRatio = returnStdev > 0 ? (meanReturn / returnStdev) * Math.sqrt(252) : 0;

  // Max drawdown (sequential P&L)
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const trade of trades) {
    cumulative += trade.realized_pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Average hold time
  const holdsWithData = trades.filter(t => t.hold_days !== null);
  const avgHoldDays = holdsWithData.length > 0
    ? holdsWithData.reduce((s, t) => s + t.hold_days, 0) / holdsWithData.length
    : null;

  // Performance by regime
  const byRegime = {};
  for (const trade of trades) {
    const regime = trade.regime_at_entry || 'UNKNOWN';
    if (!byRegime[regime]) byRegime[regime] = { trades: 0, wins: 0, pnl: 0 };
    byRegime[regime].trades++;
    if (trade.is_win) byRegime[regime].wins++;
    byRegime[regime].pnl += trade.realized_pnl;
  }
  for (const key of Object.keys(byRegime)) {
    byRegime[key].win_rate = byRegime[key].trades > 0
      ? parseFloat((byRegime[key].wins / byRegime[key].trades * 100).toFixed(1))
      : 0;
  }

  // Performance by setup type
  const bySetup = {};
  for (const trade of trades) {
    const setup = trade.strategy || 'unknown';
    if (!bySetup[setup]) bySetup[setup] = { trades: 0, wins: 0, pnl: 0 };
    bySetup[setup].trades++;
    if (trade.is_win) bySetup[setup].wins++;
    bySetup[setup].pnl += trade.realized_pnl;
  }
  for (const key of Object.keys(bySetup)) {
    bySetup[key].win_rate = bySetup[key].trades > 0
      ? parseFloat((bySetup[key].wins / bySetup[key].trades * 100).toFixed(1))
      : 0;
  }

  // Performance by direction (long vs short)
  const byDirection = {};
  for (const trade of trades) {
    const dir = trade.direction || 'unknown';
    if (!byDirection[dir]) byDirection[dir] = { trades: 0, wins: 0, pnl: 0 };
    byDirection[dir].trades++;
    if (trade.is_win) byDirection[dir].wins++;
    byDirection[dir].pnl += trade.realized_pnl;
  }
  for (const key of Object.keys(byDirection)) {
    byDirection[key].win_rate = byDirection[key].trades > 0
      ? parseFloat((byDirection[key].wins / byDirection[key].trades * 100).toFixed(1))
      : 0;
  }

  // Best and worst trades
  const sorted = [...trades].sort((a, b) => b.realized_pnl - a.realized_pnl);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return {
    trade_count: trades.length,
    wins,
    losses,
    win_rate: parseFloat((winRate * 100).toFixed(1)),
    expectancy: parseFloat(expectancy.toFixed(2)),
    total_pnl: parseFloat(totalPnl.toFixed(2)),
    avg_pnl: parseFloat(avgPnl.toFixed(2)),
    avg_return_pct: parseFloat(avgReturn.toFixed(2)),
    avg_win: parseFloat(avgWin.toFixed(2)),
    avg_loss: parseFloat(avgLoss.toFixed(2)),
    sharpe_ratio: parseFloat(sharpeRatio.toFixed(3)),
    max_drawdown: parseFloat(maxDrawdown.toFixed(2)),
    avg_hold_days: avgHoldDays !== null ? parseFloat(avgHoldDays.toFixed(1)) : null,
    by_regime: byRegime,
    by_setup: bySetup,
    by_direction: byDirection,
    best_trade: best ? { ticker: best.ticker, pnl: best.realized_pnl, return_pct: best.return_pct } : null,
    worst_trade: worst ? { ticker: worst.ticker, pnl: worst.realized_pnl, return_pct: worst.return_pct } : null,
  };
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * REPLAY — Fetch closed positions, analyze each, compute aggregate metrics.
 */
async function cmdReplay() {
  log('═══════════════════════════════════════════');
  log('REPLAY — Analyzing Closed Positions');
  log('═══════════════════════════════════════════');

  const positions = await loadClosedPositions();
  if (positions.length === 0) {
    log('No closed positions found. Nothing to replay.');
    return { trades: [], metrics: computeMetrics([]) };
  }

  log(`Analyzing ${positions.length} closed positions...`);

  const trades = positions.map(p => analyzeTrade(p));

  // Print individual trade details
  for (const t of trades) {
    const holdLabel = t.hold_days !== null ? `${t.hold_days}d` : '?';
    log(`  [${t.id}] ${t.ticker} ${t.direction} ${t.strategy}: entry=${t.entry_price} exit=${t.exit_price} x${t.quantity} → ${fmt(t.realized_pnl)} (${fmtPct(t.return_pct)}) hold=${holdLabel}`);
  }

  const metrics = computeMetrics(trades);

  // Print summary
  log('───────────────────────────────────────────');
  log('REPLAY RESULTS');
  log(`  Trades:      ${metrics.trade_count}`);
  log(`  Win Rate:    ${metrics.win_rate}%`);
  log(`  Total P&L:   ${fmt(metrics.total_pnl)}`);
  log(`  Avg P&L:     ${fmt(metrics.avg_pnl)}`);
  log(`  Avg Return:  ${fmtPct(metrics.avg_return_pct)}`);
  log(`  Expectancy:  ${fmt(metrics.expectancy)}`);
  log(`  Sharpe:      ${metrics.sharpe_ratio}`);
  log(`  Max DD:      ${fmt(metrics.max_drawdown)}`);
  if (metrics.avg_hold_days !== null) log(`  Avg Hold:    ${metrics.avg_hold_days} days`);
  if (metrics.best_trade) log(`  Best:        ${metrics.best_trade.ticker} ${fmt(metrics.best_trade.pnl)}`);
  if (metrics.worst_trade) log(`  Worst:       ${metrics.worst_trade.ticker} ${fmt(metrics.worst_trade.pnl)}`);

  // Regime breakdown
  if (Object.keys(metrics.by_regime).length > 0) {
    log('');
    log('  BY REGIME:');
    for (const [regime, data] of Object.entries(metrics.by_regime)) {
      log(`    ${regime}: ${data.trades} trades, ${data.win_rate}% win, ${fmt(data.pnl)} P&L`);
    }
  }

  // Setup breakdown
  if (Object.keys(metrics.by_setup).length > 0) {
    log('');
    log('  BY SETUP:');
    for (const [setup, data] of Object.entries(metrics.by_setup)) {
      log(`    ${setup}: ${data.trades} trades, ${data.win_rate}% win, ${fmt(data.pnl)} P&L`);
    }
  }

  // Direction breakdown
  if (Object.keys(metrics.by_direction).length > 0) {
    log('');
    log('  BY DIRECTION:');
    for (const [dir, data] of Object.entries(metrics.by_direction)) {
      log(`    ${dir}: ${data.trades} trades, ${data.win_rate}% win, ${fmt(data.pnl)} P&L`);
    }
  }

  log('───────────────────────────────────────────');

  return { trades, metrics };
}

/**
 * RANDOM — Generate random baseline portfolios.
 */
async function cmdRandom() {
  log('═══════════════════════════════════════════');
  log('RANDOM — Monte Carlo Baseline Generation');
  log('═══════════════════════════════════════════');

  // Load portfolio to match starting capital
  const portfolio = await loadPortfolio();
  const startingCapital = portfolio ? parseFloat(portfolio.starting_bankroll || 3000) : 3000;

  // Load closed trades to match trade count
  const positions = await loadClosedPositions();
  const tradesPerTrial = Math.max(positions.length, 5); // at least 5 trades per trial

  log(`Config: ${ARGS.trials} trials, ${tradesPerTrial} trades each, $${startingCapital} capital`);

  const baseline = await generateRandomPortfolios({
    trials: ARGS.trials,
    tradesPerTrial,
    startingCapital,
  });

  log('───────────────────────────────────────────');
  log('RANDOM BASELINE RESULTS');
  log(`  Trials:      ${baseline.trials}`);
  log(`  Mean Return: ${fmtPct(baseline.mean)}`);
  log(`  Std Dev:     ${baseline.stdev.toFixed(2)}%`);
  log(`  Range:       [${fmtPct(baseline.min)}, ${fmtPct(baseline.max)}]`);
  log(`  Median:      ${fmtPct(baseline.percentiles.p50)}`);
  log(`  P5/P95:      [${fmtPct(baseline.percentiles.p5)}, ${fmtPct(baseline.percentiles.p95)}]`);
  log('───────────────────────────────────────────');

  return baseline;
}

/**
 * VALIDATE — Full pipeline: replay + random + statistical comparison.
 */
async function cmdValidate() {
  log('═══════════════════════════════════════════');
  log('VALIDATE — Full Statistical Validation');
  log('═══════════════════════════════════════════');

  // Phase 1: Replay our trades
  log('');
  log('Phase 1: Replaying actual trades...');
  const { trades, metrics } = await cmdReplay();

  if (trades.length === 0) {
    log('No trades to validate. Run the Dealer to close some positions first.');
    return { trades, metrics, baseline: null, significance: null };
  }

  // Phase 2: Generate random baseline
  log('');
  log('Phase 2: Generating random baseline...');
  const portfolio = await loadPortfolio();
  const startingCapital = portfolio ? parseFloat(portfolio.starting_bankroll || 3000) : 3000;

  const baseline = await generateRandomPortfolios({
    trials: ARGS.trials,
    tradesPerTrial: trades.length,
    startingCapital,
  });

  // Phase 3: Statistical comparison
  log('');
  log('Phase 3: Computing statistical significance...');
  const totalReturnPct = metrics.total_pnl / startingCapital * 100;
  const significance = computeSignificance(totalReturnPct, baseline);

  log('═══════════════════════════════════════════');
  log('VALIDATION SUMMARY');
  log('═══════════════════════════════════════════');
  log(`  Our Return:      ${fmtPct(totalReturnPct)}`);
  log(`  Random Mean:     ${fmtPct(baseline.mean)}`);
  log(`  Random Stdev:    ${baseline.stdev.toFixed(2)}%`);
  log(`  Sigma Distance:  ${significance.sigma.toFixed(2)}σ`);
  log(`  P-Value:         ${significance.pValue}`);
  log(`  Percentile:      ${significance.percentile.toFixed(0)}th`);
  log(`  Verdict:         ${significance.interpretation}`);
  log('═══════════════════════════════════════════');

  const result = {
    timestamp: new Date().toISOString(),
    trades,
    metrics,
    baseline: {
      trials: baseline.trials,
      tradesPerTrial: baseline.tradesPerTrial,
      mean: baseline.mean,
      stdev: baseline.stdev,
      percentiles: baseline.percentiles,
    },
    significance,
    portfolio_return_pct: totalReturnPct,
  };

  // Save deliverable
  saveDeliverable(result);

  return result;
}

/**
 * REPORT — Generate summary and POST to activity feed.
 */
async function cmdReport() {
  log('═══════════════════════════════════════════');
  log('REPORT — Generating & Posting Summary');
  log('═══════════════════════════════════════════');

  // Run full validation
  const result = await cmdValidate();

  if (!result.trades.length) {
    log('No trades to report.');
    return;
  }

  const m = result.metrics;
  const s = result.significance;

  // Build activity body
  const lines = [
    `**${m.trade_count} trades analyzed** | Win rate: ${m.win_rate}%`,
    `Total P&L: ${fmt(m.total_pnl)} | Expectancy: ${fmt(m.expectancy)}/trade`,
    `Sharpe: ${m.sharpe_ratio} | Max DD: ${fmt(m.max_drawdown)}`,
  ];

  if (s) {
    lines.push('');
    lines.push(`**Monte Carlo (${result.baseline.trials} trials):** ${s.sigma.toFixed(2)}σ from random | p=${s.pValue}`);
    lines.push(`Verdict: ${s.interpretation}`);
  }

  // Regime breakdown
  if (Object.keys(m.by_regime).length > 0) {
    lines.push('');
    lines.push('**By Regime:**');
    for (const [regime, data] of Object.entries(m.by_regime)) {
      lines.push(`- ${regime}: ${data.win_rate}% win (${data.trades} trades, ${fmt(data.pnl)})`);
    }
  }

  // Direction breakdown
  if (Object.keys(m.by_direction).length > 0) {
    lines.push('');
    lines.push('**By Direction:**');
    for (const [dir, data] of Object.entries(m.by_direction)) {
      lines.push(`- ${dir}: ${data.win_rate}% win (${data.trades} trades, ${fmt(data.pnl)})`);
    }
  }

  const body = lines.join('\n');
  const title = `Backtest: ${m.win_rate}% win rate, ${s ? s.sigma.toFixed(1) + 'σ' : 'no baseline'} vs random`;

  log(`Posting report to activity feed...`);
  await postActivity(title, body);
  log('Report posted.');
}

// ─── Deliverable Saving ─────────────────────────────────────────────────────

function saveDeliverable(result) {
  if (ARGS.dryRun) {
    log('DRY RUN — skipping deliverable save.', 'warn');
    return;
  }

  if (!fs.existsSync(CONFIG.deliverablesDir)) {
    fs.mkdirSync(CONFIG.deliverablesDir, { recursive: true });
  }

  const date = todayStamp();
  const filePath = path.join(CONFIG.deliverablesDir, `${date}-backtest.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  log(`Deliverable saved: ${filePath}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  if (ARGS.help) {
    showHelp();
    process.exit(0);
  }

  await agentStart('backtest', 'Running backtest...');

  log('═══════════════════════════════════════════');
  log('BACKTEST — Statistical Validation Engine');
  log('═══════════════════════════════════════════');
  if (ARGS.dryRun) log('Mode: DRY RUN (no writes)');
  if (ARGS.verbose) log('Mode: VERBOSE');

  const command = ARGS.command || 'validate';
  log(`Command: ${command}`);

  let summary;

  switch (command) {
    case 'replay':
      await cmdReplay();
      summary = 'Replay complete';
      break;

    case 'random':
      await cmdRandom();
      summary = `Random baseline: ${ARGS.trials} trials`;
      break;

    case 'validate':
      const result = await cmdValidate();
      if (result.significance) {
        summary = `Validated: ${result.metrics.win_rate}% win, ${result.significance.sigma.toFixed(1)}σ`;
      } else {
        summary = 'Validated (no closed trades)';
      }
      break;

    case 'report':
      await cmdReport();
      summary = 'Report posted to activity feed';
      break;

    default:
      log(`Unknown command: ${command}`, 'error');
      showHelp();
      await agentError('backtest', `Unknown command: ${command}`);
      process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('───────────────────────────────────────────');
  log(`COMPLETE in ${elapsed}s`);
  log('───────────────────────────────────────────');

  await agentDone('backtest', summary);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'error');
  console.error(err.stack);
  agentError('backtest', err);
  process.exit(1);
});
