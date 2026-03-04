#!/usr/bin/env node
/**
 * Filter — extracts tickers from posts and detects thesis presence.
 * A post passes if it mentions ≥1 recognized ticker AND has a thesis
 * (opinion/analysis beyond just a question or link share).
 *
 * Loads ticker universe from Wire agent's universe.json for consistency.
 */

const fs = require('fs');
const path = require('path');

// Load Wire's ticker universe
const UNIVERSE_PATH = path.join(__dirname, '..', '..', 'wire', 'universe.json');
let VALID_TICKERS = new Set();

try {
  const universe = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8'));
  const tickers = universe.tickers || {};
  for (const sector of Object.values(tickers)) {
    if (Array.isArray(sector)) {
      sector.forEach(t => VALID_TICKERS.add(t.toUpperCase()));
    }
  }
  // Also add flat array if present
  if (universe.flat) {
    universe.flat.forEach(t => VALID_TICKERS.add(t.toUpperCase()));
  }
} catch (err) {
  console.error(`[filter] Warning: Could not load universe.json: ${err.message}`);
  console.error('[filter] Falling back to common tickers');
  // Minimal fallback
  ['SPY','QQQ','AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','AMD'].forEach(t => VALID_TICKERS.add(t));
}

// Regex: $TICKER or standalone TICKER (2-5 uppercase letters, word boundary)
const TICKER_REGEX = /(?:\$([A-Z]{2,5})|\b([A-Z]{2,5})\b)/g;

// Common false positives — uppercase words that aren't tickers
const FALSE_POSITIVES = new Set([
  'DD', 'CEO', 'CFO', 'CTO', 'IPO', 'ETF', 'SEC', 'FDA', 'GDP', 'EPS',
  'PE', 'PB', 'ROE', 'ROI', 'IMO', 'TBH', 'FYI', 'TLDR', 'EDIT', 'UPDATE',
  'PSA', 'HODL', 'YOLO', 'FOMO', 'ATH', 'ATL', 'DCA', 'OTM', 'ITM', 'ATM',
  'IV', 'DTE', 'OP', 'USA', 'US', 'EU', 'UK', 'AI', 'EV', 'ER', 'PM', 'AM',
  'YTD', 'QOQ', 'MOM', 'YOY', 'TTM', 'NAV', 'AUM', 'DCF', 'WACC', 'EBITDA',
  'CAGR', 'MOAT', 'BUY', 'SELL', 'HOLD', 'LONG', 'SHORT', 'PUT', 'CALL',
  'THE', 'AND', 'FOR', 'NOT', 'BUT', 'ALL', 'ANY', 'CAN', 'HAD', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'ARE', 'HAS', 'HIS', 'HOW', 'ITS', 'MAY',
  'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'GET', 'HIM',
  'LET', 'SAY', 'SHE', 'TOO', 'USE', 'JUST', 'WILL', 'VERY', 'BEEN',
]);

function extractTickers(text) {
  const found = new Set();
  let match;

  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const ticker = (match[1] || match[2]).toUpperCase();

    // Must be in our universe AND not a false positive
    if (VALID_TICKERS.has(ticker) && !FALSE_POSITIVES.has(ticker)) {
      found.add(ticker);
    }
  }

  return [...found];
}

// Thesis detection — looks for analysis signals, not just questions
const THESIS_SIGNALS = [
  /\b(bull|bear)ish\b/i,
  /\bundervalued\b/i,
  /\bovervalued\b/i,
  /\btarget\s+(?:price|of)\b/i,
  /\bprice\s+target\b/i,
  /\bmy\s+(?:thesis|position|take|analysis|dd)\b/i,
  /\bi\s+(?:think|believe|expect|predict|bought|sold|am\s+(?:long|short|buying|selling))\b/i,
  /\b(?:fair\s+value|intrinsic\s+value|dcf|valuation)\b/i,
  /\b(?:margin\s+of\s+safety|competitive\s+advantage|moat)\b/i,
  /\b(?:revenue|earnings|growth|guidance|catalyst)\b/i,
  /\b(?:risk|downside|upside)\b/i,
  /\b(?:buy|sell|hold)\s+(?:rating|recommendation)\b/i,
  /\bposition(?:ed)?\b/i,
];

function hasThesis(text) {
  const combined = text.toLowerCase();
  let signals = 0;

  for (const pattern of THESIS_SIGNALS) {
    if (pattern.test(combined)) {
      signals++;
    }
    // Need at least 2 thesis signals to qualify
    if (signals >= 2) return true;
  }

  return false;
}

function filterPosts(posts) {
  const filtered = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`;
    const tickers = extractTickers(text);

    if (tickers.length === 0) continue;
    if (!hasThesis(text)) continue;

    filtered.push({
      ...post,
      tickers,
    });
  }

  console.error(`[filter] ${posts.length} posts → ${filtered.length} with tickers + thesis`);
  return filtered;
}

// CLI mode
if (require.main === module) {
  let input = '';
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    const posts = JSON.parse(input);
    const filtered = filterPosts(posts);
    console.log(JSON.stringify(filtered, null, 2));
  });
}

module.exports = { filterPosts, extractTickers, hasThesis };
