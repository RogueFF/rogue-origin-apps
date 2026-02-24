#!/usr/bin/env node
/**
 * Wire Social Scanner — Reddit + HN signal detection
 * Fetches posts from configured subreddits and HN, scores them against signal keywords.
 * 
 * Usage:
 *   node social-scan.js [--config path/to/config.json] [--dry-run] [--verbose]
 * 
 * Output: JSON array of scored signals to stdout
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Default config — Razor's spec baked in as defaults, overridable via file
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  reddit: {
    subreddits: [
      { name: 'wallstreetbets', tier: 1, weight: 1.5 },
      { name: 'stocks', tier: 1, weight: 1.3 },
      { name: 'technology', tier: 1, weight: 1.2 },
      { name: 'ClaudeAI', tier: 2, weight: 1.0 },
      { name: 'programming', tier: 2, weight: 0.8 },
      { name: 'investing', tier: 2, weight: 1.0 },
      { name: 'options', tier: 2, weight: 1.1 },
      { name: 'SecurityAnalysis', tier: 3, weight: 0.7 },
      { name: 'algotrading', tier: 3, weight: 0.8 },
    ],
    postsPerSub: 25,
    userAgent: 'WireSocialScanner/1.0',
  },
  hn: {
    enabled: true,
    topStoriesCount: 30,
  },
  signals: {
    // Razor's keyword spec — event triggers
    productLaunch: {
      keywords: ['just dropped', 'launching', 'announced', 'released', 'unveils', 'introduces', 'rolls out', 'now available', 'ships today'],
      weight: 2.0,
      type: 'event',
    },
    partnership: {
      keywords: ['partners with', 'partnership', 'collaboration', 'joint venture', 'teams up', 'deal with', 'acquires', 'acquisition', 'merger'],
      weight: 1.8,
      type: 'event',
    },
    regulatory: {
      keywords: ['SEC', 'FDA approval', 'antitrust', 'regulation', 'banned', 'lawsuit', 'investigation', 'subpoena', 'compliance'],
      weight: 2.5,
      type: 'risk',
    },
    competitiveThreat: {
      keywords: ['competitor', 'disrupts', 'obsolete', 'replaced by', 'better than', 'kills', 'threatens', 'alternative to'],
      weight: 2.2,
      type: 'threat',
    },
    sentiment: {
      keywords: ['to the moon', 'bearish', 'bullish', 'short squeeze', 'crash', 'pump', 'dump', 'diamond hands', 'paper hands'],
      weight: 0.8,
      type: 'sentiment',
    },
  },
  // Minimum score threshold to include in output
  minScore: 1.5,
  // Rate limiting: ms between requests
  requestDelayMs: 1200,
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location, headers).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Reddit fetcher
// ---------------------------------------------------------------------------

async function fetchSubreddit(sub, config, verbose) {
  const url = `https://www.reddit.com/r/${sub.name}/new.json?limit=${config.reddit.postsPerSub}&raw_json=1`;
  const headers = { 'User-Agent': config.reddit.userAgent };
  
  if (verbose) process.stderr.write(`[reddit] Fetching r/${sub.name}...\n`);
  
  try {
    const raw = await httpGet(url, headers);
    const json = JSON.parse(raw);
    
    if (!json.data || !json.data.children) return [];
    
    return json.data.children.map((child) => ({
      source: 'reddit',
      subreddit: sub.name,
      tier: sub.tier,
      subWeight: sub.weight,
      title: child.data.title || '',
      selftext: (child.data.selftext || '').slice(0, 500),
      author: child.data.author,
      score: child.data.score,
      url: `https://reddit.com${child.data.permalink}`,
      created: child.data.created_utc,
    }));
  } catch (err) {
    if (verbose) process.stderr.write(`[reddit] Error on r/${sub.name}: ${err.message}\n`);
    return [];
  }
}

async function fetchAllReddit(config, verbose) {
  const posts = [];
  for (const sub of config.reddit.subreddits) {
    const subPosts = await fetchSubreddit(sub, config, verbose);
    posts.push(...subPosts);
    await sleep(config.requestDelayMs);
  }
  return posts;
}

// ---------------------------------------------------------------------------
// HN fetcher
// ---------------------------------------------------------------------------

async function fetchHN(config, verbose) {
  if (!config.hn.enabled) return [];
  
  if (verbose) process.stderr.write(`[hn] Fetching top stories...\n`);
  
  try {
    const idsRaw = await httpGet('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = JSON.parse(idsRaw).slice(0, config.hn.topStoriesCount);
    
    const stories = [];
    for (const id of ids) {
      try {
        const itemRaw = await httpGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const item = JSON.parse(itemRaw);
        if (item && item.title) {
          stories.push({
            source: 'hn',
            subreddit: null,
            tier: 1,
            subWeight: 1.2,
            title: item.title,
            selftext: item.text ? item.text.slice(0, 500) : '',
            author: item.by,
            score: item.score,
            url: item.url || `https://news.ycombinator.com/item?id=${id}`,
            created: item.time,
          });
        }
      } catch (_) { /* skip individual failures */ }
      // Lighter rate limit for HN API
      await sleep(200);
    }
    return stories;
  } catch (err) {
    if (verbose) process.stderr.write(`[hn] Error: ${err.message}\n`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ticker extraction
// ---------------------------------------------------------------------------

const COMPANY_TICKERS = {
  'anthropic': null, 'openai': null, // No direct ticker but flag for threat mapping
  'microsoft': 'MSFT', 'google': 'GOOGL', 'alphabet': 'GOOGL', 'amazon': 'AMZN',
  'apple': 'AAPL', 'meta': 'META', 'facebook': 'META', 'nvidia': 'NVDA',
  'tesla': 'TSLA', 'amd': 'AMD', 'intel': 'INTC', 'ibm': 'IBM',
  'oracle': 'ORCL', 'salesforce': 'CRM', 'snowflake': 'SNOW', 'mongodb': 'MDB',
  'crowdstrike': 'CRWD', 'palo alto': 'PANW', 'cloudflare': 'NET',
  'datadog': 'DDOG', 'palantir': 'PLTR', 'shopify': 'SHOP',
  'coinbase': 'COIN', 'robinhood': 'HOOD', 'paypal': 'PYPL', 'square': 'SQ', 'block': 'SQ',
  'uber': 'UBER', 'lyft': 'LYFT', 'doordash': 'DASH', 'airbnb': 'ABNB',
  'netflix': 'NFLX', 'disney': 'DIS', 'boeing': 'BA', 'jpmorgan': 'JPM',
  'goldman sachs': 'GS', 'morgan stanley': 'MS', 'bank of america': 'BAC',
  'walmart': 'WMT', 'costco': 'COST', 'target': 'TGT',
  'pfizer': 'PFE', 'johnson & johnson': 'JNJ', 'unitedhealth': 'UNH',
  'eli lilly': 'LLY', 'merck': 'MRK', 'adobe': 'ADBE', 'zoom': 'ZM',
  'atlassian': 'TEAM', 'docusign': 'DOCU', 'alibaba': 'BABA',
};

// Load threat graph if available
let THREAT_GRAPH = {};
try {
  const tgPath = path.resolve(__dirname, '../agents/wire/threat-graph.json');
  if (fs.existsSync(tgPath)) {
    THREAT_GRAPH = JSON.parse(fs.readFileSync(tgPath, 'utf8')).graph || {};
  }
} catch (_) {}

function extractTickers(text) {
  const found = new Set();
  const lower = text.toLowerCase();
  
  // $TICKER pattern
  const tickerRe = /\$([A-Z]{2,5})\b/g;
  let m;
  while ((m = tickerRe.exec(text)) !== null) found.add(m[1]);
  
  // Company name → ticker
  for (const [name, ticker] of Object.entries(COMPANY_TICKERS)) {
    if (ticker && lower.includes(name)) found.add(ticker);
  }
  
  // ALL-CAPS 2-5 letter words that match known universe tickers
  let universeTickers = null;
  try {
    const uPath = path.resolve(__dirname, '../agents/wire/universe.json');
    if (fs.existsSync(uPath)) {
      universeTickers = new Set(JSON.parse(fs.readFileSync(uPath, 'utf8')).flat || []);
    }
  } catch (_) {}
  
  if (universeTickers) {
    const capsRe = /\b([A-Z]{2,5})\b/g;
    while ((m = capsRe.exec(text)) !== null) {
      if (universeTickers.has(m[1])) found.add(m[1]);
    }
  }
  
  return [...found];
}

function getThreatenedCompetitors(tickers) {
  const competitors = new Set();
  for (const t of tickers) {
    if (THREAT_GRAPH[t]) {
      for (const c of THREAT_GRAPH[t]) competitors.add(c);
    }
  }
  return [...competitors];
}

// ---------------------------------------------------------------------------
// Signal scoring engine
// ---------------------------------------------------------------------------

function scorePost(post, config) {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  const matches = [];
  let totalScore = 0;
  
  for (const [signalName, signal] of Object.entries(config.signals)) {
    for (const keyword of signal.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        const keywordScore = signal.weight * post.subWeight;
        totalScore += keywordScore;
        matches.push({
          signal: signalName,
          keyword,
          type: signal.type,
          contribution: keywordScore,
        });
      }
    }
  }
  
  // Boost for high-engagement posts
  if (post.score > 100) totalScore *= 1.3;
  if (post.score > 500) totalScore *= 1.5;
  if (post.score > 1000) totalScore *= 2.0;
  
  // Extract tickers + threat map
  const tickers = extractTickers(`${post.title} ${post.selftext}`);
  const competitors = getThreatenedCompetitors(tickers);
  
  return {
    ...post,
    signalScore: Math.round(totalScore * 100) / 100,
    matches,
    tickers,
    threatenedCompetitors: competitors,
  };
}

function scoreAllPosts(posts, config) {
  return posts
    .map((p) => scorePost(p, config))
    .filter((p) => p.signalScore >= config.minScore)
    .sort((a, b) => b.signalScore - a.signalScore);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const dryRun = args.includes('--dry-run');
  const radarOutput = args.includes('--radar-output');
  const configIdx = args.indexOf('--config');
  
  let config = { ...DEFAULT_CONFIG };
  
  if (configIdx !== -1 && args[configIdx + 1]) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(args[configIdx + 1], 'utf8'));
      config = deepMerge(config, userConfig);
    } catch (err) {
      process.stderr.write(`[config] Error loading config: ${err.message}\n`);
      process.exit(1);
    }
  }
  
  if (dryRun) {
    process.stderr.write(`[dry-run] Config:\n${JSON.stringify(config, null, 2)}\n`);
    process.stderr.write(`[dry-run] Would fetch ${config.reddit.subreddits.length} subreddits + HN\n`);
    process.exit(0);
  }
  
  const [redditPosts, hnPosts] = await Promise.all([
    fetchAllReddit(config, verbose),
    fetchHN(config, verbose),
  ]);
  
  const allPosts = [...redditPosts, ...hnPosts];
  if (verbose) process.stderr.write(`[scan] ${allPosts.length} posts fetched, scoring...\n`);
  
  const signals = scoreAllPosts(allPosts, config);
  if (verbose) process.stderr.write(`[scan] ${signals.length} signals above threshold (${config.minScore})\n`);
  
  // Output: Radar-compatible format or raw signals
  if (radarOutput) {
    const radarItems = signals.map(s => ({
      title: s.title,
      sourceName: s.source === 'reddit' ? `reddit:r/${s.subreddit}` : 'hn',
      url: s.url,
      summary: s.selftext ? s.selftext.slice(0, 200) : s.title,
      tags: [...new Set(['social_signal', ...s.matches.map(m => m.signal)])],
      priority: s.signalScore >= 5 ? 'critical' : s.signalScore >= 3 ? 'high' : 'medium',
      score: s.score,
      comments: null,
      tickers: s.tickers,
      threatenedCompetitors: s.threatenedCompetitors,
      signalScore: s.signalScore,
    }));
    const radarPayload = { totalItems: radarItems.length, items: radarItems };
    process.stdout.write(JSON.stringify(radarPayload, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(signals, null, 2) + '\n');
  }
  
  // Summary to stderr
  process.stderr.write(`\n--- Wire Social Scan Summary ---\n`);
  process.stderr.write(`Posts scanned: ${allPosts.length}\n`);
  process.stderr.write(`Signals detected: ${signals.length}\n`);
  if (signals.length > 0) {
    process.stderr.write(`Top signal: [${signals[0].signalScore}] ${signals[0].title}\n`);
    process.stderr.write(`  Source: ${signals[0].source}${signals[0].subreddit ? ' r/' + signals[0].subreddit : ''}\n`);
    process.stderr.write(`  Matches: ${signals[0].matches.map(m => m.signal + ':' + m.keyword).join(', ')}\n`);
  }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err.message}\n`);
  process.exit(1);
});
