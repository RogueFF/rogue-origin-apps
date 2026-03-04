#!/usr/bin/env node
/**
 * Ranker — sorts scored posts by reasoning score, outputs top 10.
 * Deduplicates by primary ticker (keeps highest score per ticker).
 * Outputs daily-signals.json format for Wire agent consumption.
 */

const fs = require('fs');
const path = require('path');

const TOP_N = 10;

function rank(scoredPosts) {
  // Deduplicate: keep highest score per primary ticker
  const byTicker = new Map();

  for (const post of scoredPosts) {
    const existing = byTicker.get(post.ticker);
    if (!existing || post.score > existing.score) {
      byTicker.set(post.ticker, post);
    }
  }

  // Sort by total reasoning score, descending
  const ranked = [...byTicker.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  // Format output for Wire consumption
  const signals = ranked.map((post, i) => ({
    rank: i + 1,
    ticker: post.ticker,
    score: post.score,
    scores: post.scores,
    thesis_summary: post.thesis_summary,
    source_url: post.source_url,
    posted_at: post.posted_at,
    subreddit: post.subreddit,
  }));

  return {
    generated_at: new Date().toISOString(),
    source: 'wire-reddit',
    lookback_hours: 24,
    subreddits: ['r/ValueInvesting', 'r/options'],
    scoring_model: 'opus',
    total_evaluated: scoredPosts.length,
    signals,
  };
}

function writeOutput(output, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.error(`[ranker] Wrote ${output.signals.length} signals to ${outputPath}`);
}

// CLI mode
if (require.main === module) {
  const outputPath = process.argv[2] || path.join(__dirname, '..', 'output', 'daily-signals.json');

  let input = '';
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    const scored = JSON.parse(input);
    const output = rank(scored);
    writeOutput(output, outputPath);
    console.log(JSON.stringify(output, null, 2));
  });
}

module.exports = { rank, writeOutput };
