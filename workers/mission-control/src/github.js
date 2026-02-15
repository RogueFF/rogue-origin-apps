/**
 * GitHub Dashboard Handler — Mission Control API
 * 
 * Proxies GitHub REST API calls server-side to keep tokens off the client.
 * Caches responses for 60s to avoid rate limits.
 * 
 * GET /api/github?action=dashboard — Combined dashboard payload
 */

const GH_API = 'https://api.github.com';
const REPO = 'RogueFF/rogue-origin-apps';
const CACHE_TTL = 60; // seconds

// In-memory cache (per-isolate, resets on deploy)
let cache = { data: null, expires: 0 };

async function ghFetch(path, token) {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Atlas-OS-Mission-Control/1.0',
    },
  });
  if (!res.ok) {
    console.warn(`[GitHub] ${path} returned ${res.status}`);
    return null;
  }
  return res.json();
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export async function handleGitHub(request, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return { success: false, error: 'GITHUB_TOKEN not configured' };
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'dashboard';

  if (action === 'dashboard') {
    // Check cache
    if (cache.data && Date.now() < cache.expires) {
      return { success: true, data: cache.data, cached: true };
    }

    // Fetch all in parallel
    const [commits, runs, issues, pulls, branches] = await Promise.all([
      ghFetch(`/repos/${REPO}/commits?per_page=10`, token),
      ghFetch(`/repos/${REPO}/actions/runs?per_page=5`, token),
      ghFetch(`/repos/${REPO}/issues?state=open&per_page=10`, token),
      ghFetch(`/repos/${REPO}/pulls?state=open&per_page=10`, token),
      ghFetch(`/repos/${REPO}/branches`, token),
    ]);

    const data = {
      repo: REPO,
      fetched_at: new Date().toISOString(),

      commits: (commits || []).map(c => ({
        sha: c.sha?.substring(0, 7),
        message: c.commit?.message?.split('\n')[0]?.substring(0, 80),
        author: c.commit?.author?.name || c.author?.login || 'unknown',
        date: c.commit?.author?.date,
        time_ago: c.commit?.author?.date ? timeAgo(c.commit.author.date) : '',
        url: c.html_url,
      })),

      ci_runs: (runs?.workflow_runs || []).map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        branch: r.head_branch,
        event: r.event,
        duration: r.run_started_at && r.updated_at
          ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000)
          : null,
        time_ago: r.updated_at ? timeAgo(r.updated_at) : '',
        url: r.html_url,
      })),

      issues: (issues || []).filter(i => !i.pull_request).map(i => ({
        number: i.number,
        title: i.title?.substring(0, 80),
        state: i.state,
        labels: (i.labels || []).map(l => l.name),
        author: i.user?.login,
        time_ago: i.created_at ? timeAgo(i.created_at) : '',
        url: i.html_url,
      })),

      pulls: (pulls || []).map(p => ({
        number: p.number,
        title: p.title?.substring(0, 80),
        state: p.state,
        author: p.user?.login,
        branch: p.head?.ref,
        time_ago: p.created_at ? timeAgo(p.created_at) : '',
        url: p.html_url,
      })),

      branches: (branches || []).map(b => ({
        name: b.name,
        protected: b.protected,
      })),

      summary: {
        total_commits: (commits || []).length,
        open_issues: (issues || []).filter(i => !i.pull_request).length,
        open_prs: (pulls || []).length,
        ci_passing: (runs?.workflow_runs || []).every(r => r.conclusion === 'success'),
        branch_count: (branches || []).length,
      },
    };

    // Cache it
    cache = { data, expires: Date.now() + CACHE_TTL * 1000 };

    return { success: true, data };
  }

  return { success: false, error: `Unknown action: ${action}` };
}
