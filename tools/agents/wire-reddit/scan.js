#!/usr/bin/env node
/**
 * wire-reddit/scan.js — Main orchestrator
 *
 * Pipeline: scrape → filter → score → rank → output
 *
 * Usage:
 *   node scan.js [--dry-run] [--skip-scoring] [--verbose]
 *
 * Output: output/daily-signals.json
 * Wire agent reads this file at 5:30 AM PST alongside Qlib signals.
 */

const path = require('path');
const fs = require('fs');

const { scrapeAll } = require('./lib/scraper');
const { filterPosts } = require('./lib/filter');
const { scoreAll } = require('./lib/scorer');
const { rank, writeOutput } = require('./lib/ranker');

const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'daily-signals.json');
const LOG_DIR = path.join(__dirname, 'logs');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_SCORING = args.includes('--skip-scoring');
const VERBOSE = args.includes('--verbose');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  if (VERBOSE) console.error(line);
  return line;
}

async function main() {
  const startTime = Date.now();
  const logLines = [];

  logLines.push(log('wire-reddit scan starting'));

  // 1. Scrape
  logLines.push(log('Phase 1: Scraping Reddit...'));
  const posts = await scrapeAll();
  logLines.push(log(`Scraped ${posts.length} posts from 2 subreddits`));

  if (posts.length === 0) {
    logLines.push(log('No posts found — exiting'));
    console.log(JSON.stringify({ status: 'empty', posts: 0 }));
    return;
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({
      status: 'dry-run',
      scraped: posts.length,
      sample: posts.slice(0, 3).map(p => ({ title: p.title, tickers: p.tickers })),
    }, null, 2));
    return;
  }

  // 2. Filter
  logLines.push(log('Phase 2: Filtering for tickers + thesis...'));
  const filtered = filterPosts(posts);
  logLines.push(log(`${filtered.length} posts passed filter`));

  if (filtered.length === 0) {
    logLines.push(log('No posts passed filter — writing empty signals'));
    const empty = {
      generated_at: new Date().toISOString(),
      source: 'wire-reddit',
      lookback_hours: 24,
      subreddits: ['r/ValueInvesting', 'r/options'],
      scoring_model: 'opus',
      total_evaluated: 0,
      signals: [],
    };
    writeOutput(empty, OUTPUT_PATH);
    return;
  }

  // 3. Score
  let scored;
  if (SKIP_SCORING) {
    logLines.push(log('Phase 3: SKIPPED (--skip-scoring)'));
    // Assign dummy scores for testing pipeline
    scored = filtered.map(p => ({
      ticker: p.tickers[0],
      tickers: p.tickers,
      score: 0,
      scores: { thesis_clarity: 0, risk_awareness: 0, data_quality: 0, specificity: 0, original_thinking: 0 },
      thesis_summary: p.title,
      source_url: p.url,
      posted_at: p.posted_at,
      subreddit: p.subreddit,
    }));
  } else {
    logLines.push(log(`Phase 3: Scoring ${filtered.length} posts with Opus...`));
    scored = await scoreAll(filtered);
    logLines.push(log(`${scored.length} posts scored`));
  }

  // 4. Rank + Output
  logLines.push(log('Phase 4: Ranking and writing output...'));
  const output = rank(scored);
  writeOutput(output, OUTPUT_PATH);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logLines.push(log(`Done in ${elapsed}s — ${output.signals.length} signals written`));

  // Write scan log
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `scan-${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(logFile, logLines.join('\n') + '\n');

  // Summary to stdout
  console.log(JSON.stringify({
    status: 'ok',
    scraped: posts.length,
    filtered: filtered.length,
    scored: scored.length,
    signals: output.signals.length,
    top_ticker: output.signals[0]?.ticker || null,
    top_score: output.signals[0]?.score || 0,
    elapsed_seconds: parseFloat(elapsed),
  }, null, 2));
}

main().catch(err => {
  console.error(`[wire-reddit] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
