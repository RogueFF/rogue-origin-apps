#!/usr/bin/env node
/**
 * Reddit scraper — fetches posts from target subreddits via public JSON API.
 * No auth needed. 24h lookback, min 5 upvotes, extracts selftext posts only.
 *
 * Usage: node scraper.js [--subreddits r/ValueInvesting,r/Options] [--min-upvotes 5]
 * Output: JSON array of { title, selftext, url, author, upvotes, posted_at, subreddit }
 */

const https = require('https');

const DEFAULT_SUBREDDITS = ['ValueInvesting', 'options'];
const MIN_UPVOTES = 5;
const LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

function fetchSubreddit(subreddit, after = null) {
  return new Promise((resolve, reject) => {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100${after ? `&after=${after}` : ''}`;
    const opts = {
      headers: { 'User-Agent': 'wire-reddit-scanner/1.0 (by RogueOrigin)' }
    };

    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.data) {
            reject(new Error(`Reddit API error for r/${subreddit}: ${data.slice(0, 200)}`));
            return;
          }
          resolve(json.data);
        } catch (e) {
          reject(new Error(`Parse error for r/${subreddit}: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function scrapeSubreddit(subreddit) {
  const cutoff = Date.now() - LOOKBACK_MS;
  const posts = [];
  let after = null;
  let pages = 0;
  const maxPages = 5; // Safety cap

  while (pages < maxPages) {
    const data = await fetchSubreddit(subreddit, after);
    const children = data.children || [];

    if (children.length === 0) break;

    for (const child of children) {
      const post = child.data;
      const postedAt = post.created_utc * 1000;

      // Stop if we've gone past 24h lookback
      if (postedAt < cutoff) return posts;

      // Skip non-selftext posts (links, images, etc.)
      if (!post.selftext || post.selftext.length < 50) continue;

      // Min upvotes filter
      if (post.ups < MIN_UPVOTES) continue;

      posts.push({
        title: post.title,
        selftext: post.selftext.slice(0, 3000), // Cap for token efficiency
        url: `https://reddit.com${post.permalink}`,
        author: post.author,
        upvotes: post.ups,       // Kept for filtering, stripped before scoring
        posted_at: new Date(postedAt).toISOString(),
        subreddit: subreddit
      });
    }

    after = data.after;
    if (!after) break;
    pages++;

    // Rate limit: 1 req/sec
    await new Promise(r => setTimeout(r, 1000));
  }

  return posts;
}

async function scrapeAll(subreddits = DEFAULT_SUBREDDITS) {
  const allPosts = [];

  for (const sub of subreddits) {
    try {
      const posts = await scrapeSubreddit(sub);
      allPosts.push(...posts);
      console.error(`[scraper] r/${sub}: ${posts.length} posts (24h, ≥${MIN_UPVOTES} upvotes)`);
    } catch (err) {
      console.error(`[scraper] r/${sub} error: ${err.message}`);
    }

    // Rate limit between subreddits
    await new Promise(r => setTimeout(r, 1500));
  }

  return allPosts;
}

// CLI mode
if (require.main === module) {
  scrapeAll().then(posts => {
    console.log(JSON.stringify(posts, null, 2));
  }).catch(err => {
    console.error(`[scraper] Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrapeAll, scrapeSubreddit };
