#!/usr/bin/env node
/**
 * Scorer — uses Opus to evaluate posts on 5 dimensions.
 * Strips popularity signals (upvotes, awards, karma) before scoring.
 *
 * Dimensions (each 0-20, total 0-100):
 *   1. Thesis Clarity — Is the investment thesis clearly stated and logical?
 *   2. Risk Awareness — Does the author identify risks and potential downsides?
 *   3. Data Quality — Are claims backed by specific numbers, filings, or verifiable data?
 *   4. Specificity — Are there specific entry/exit points, timeframes, or catalysts?
 *   5. Original Thinking — Does this go beyond consensus/surface-level takes?
 *
 * Uses OpenClaw sessions_spawn or falls back to Claude CLI for scoring.
 */

const { execSync } = require('child_process');
const path = require('path');

const SCORING_PROMPT = `You are evaluating a Reddit investment post for reasoning quality ONLY.
Popularity signals (upvotes, awards, karma, comment count) have been stripped.
Judge purely on the quality of thinking.

Score each dimension 0-20:

1. THESIS CLARITY (0-20): Is the investment thesis clearly stated? Is the logic chain coherent?
2. RISK AWARENESS (0-20): Does the author identify what could go wrong? Downside scenarios?
3. DATA QUALITY (0-20): Are claims backed by specific numbers, SEC filings, earnings data, or verifiable sources?
4. SPECIFICITY (0-20): Specific entry/exit points, position sizing, timeframes, or catalysts mentioned?
5. ORIGINAL THINKING (0-20): Does this go beyond "everyone knows X"? Novel angle or contrarian reasoning?

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "thesis_clarity": <0-20>,
  "risk_awareness": <0-20>,
  "data_quality": <0-20>,
  "specificity": <0-20>,
  "original_thinking": <0-20>,
  "total": <0-100>,
  "thesis_summary": "<1-2 sentence summary of the core thesis>"
}`;

function stripPopularity(post) {
  // Remove all popularity/social proof signals
  const { upvotes, author, ...clean } = post;
  return clean;
}

async function scorePost(post) {
  const clean = stripPopularity(post);
  const postText = `TITLE: ${clean.title}\n\nSUBREDDIT: r/${clean.subreddit}\n\nPOST:\n${clean.selftext}`;

  const fullPrompt = `${SCORING_PROMPT}\n\n---\n\n${postText}`;

  try {
    // Use Claude CLI in non-interactive mode
    const result = execSync(
      `CI=true claude -p "${fullPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --output-format text --max-budget-usd 0.05`,
      {
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, CI: 'true' },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    ).trim();

    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[scorer] No JSON in response for "${post.title.slice(0, 50)}"`);
      return null;
    }

    const scores = JSON.parse(jsonMatch[0]);

    // Validate
    const dims = ['thesis_clarity', 'risk_awareness', 'data_quality', 'specificity', 'original_thinking'];
    for (const dim of dims) {
      if (typeof scores[dim] !== 'number' || scores[dim] < 0 || scores[dim] > 20) {
        console.error(`[scorer] Invalid score for ${dim}: ${scores[dim]}`);
        return null;
      }
    }

    // Recalculate total to prevent hallucinated sums
    scores.total = dims.reduce((sum, d) => sum + scores[d], 0);

    return {
      ticker: post.tickers[0], // Primary ticker
      tickers: post.tickers,
      score: scores.total,
      scores: {
        thesis_clarity: scores.thesis_clarity,
        risk_awareness: scores.risk_awareness,
        data_quality: scores.data_quality,
        specificity: scores.specificity,
        original_thinking: scores.original_thinking,
      },
      thesis_summary: scores.thesis_summary || '',
      source_url: post.url,
      posted_at: post.posted_at,
      subreddit: post.subreddit,
    };

  } catch (err) {
    console.error(`[scorer] Error scoring "${post.title.slice(0, 50)}": ${err.message}`);
    return null;
  }
}

async function scoreAll(posts) {
  const results = [];

  for (let i = 0; i < posts.length; i++) {
    console.error(`[scorer] Scoring ${i + 1}/${posts.length}: "${posts[i].title.slice(0, 60)}"`);
    const result = await scorePost(posts[i]);
    if (result) {
      results.push(result);
    }

    // Rate limit between Opus calls
    if (i < posts.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.error(`[scorer] ${results.length}/${posts.length} scored successfully`);
  return results;
}

// CLI mode
if (require.main === module) {
  let input = '';
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', async () => {
    const posts = JSON.parse(input);
    const scored = await scoreAll(posts);
    console.log(JSON.stringify(scored, null, 2));
  });
}

module.exports = { scoreAll, scorePost };
