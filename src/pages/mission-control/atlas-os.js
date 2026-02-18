/* ═══════════════════════════════════════════════════════════════
   ATLAS OS — Mission Control v0.1
   Window manager, data layer, UI controllers, sound design
   ═══════════════════════════════════════════════════════════════ */

// ── morphInto: flicker-free DOM updates via morphdom ──────────
// Wraps html string in a container div, morphs into target element.
// Preserves scroll, focus, open <details>, event listeners, DD panels.
function morphInto(target, html) {
  if (!target) return;
  // First render — just set innerHTML (morphdom needs existing DOM)
  if (!target.hasChildNodes()) {
    target.innerHTML = html;
    return;
  }
  const wrapper = document.createElement(target.tagName || 'div');
  // Copy id/class so morphdom matches the root
  wrapper.id = target.id;
  wrapper.className = target.className;
  wrapper.innerHTML = html;
  morphdom(target, wrapper, {
    childrenOnly: false,
    onBeforeElUpdated(fromEl, toEl) {
      // Preserve open/closed state on <details>
      if (fromEl.tagName === 'DETAILS' && fromEl.hasAttribute('open') && !toEl.hasAttribute('open')) {
        toEl.setAttribute('open', '');
      }
      // Preserve DD panel open state
      if (fromEl.classList?.contains('dd-open') && !toEl.classList?.contains('dd-open')) {
        toEl.classList.add('dd-open');
      }
      if (fromEl.classList?.contains('dd-active') && !toEl.classList?.contains('dd-active')) {
        toEl.classList.add('dd-active');
      }
      // Skip updating focused inputs
      if (fromEl === document.activeElement && fromEl.tagName === 'INPUT') return false;
      return true;
    }
  });
}

const API_BASE = 'https://mission-control-api.roguefamilyfarms.workers.dev/api';
const POLL_INTERVAL = 30000;
const TRADING_POLL_INTERVAL = 60000; // 60s during market hours
const TRADING_IDLE_INTERVAL = 300000; // 5m outside market hours
const PRODUCTION_POLL_INTERVAL = 60000; // 60s during shift
const PRODUCTION_IDLE_INTERVAL = 300000; // 5m outside shift
const PRODUCTION_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scoreboard';

function isMarketHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  const min = et.getMinutes();
  const timeVal = hour * 60 + min;
  // M-F, 9:30 AM - 4:00 PM ET
  return day >= 1 && day <= 5 && timeVal >= 570 && timeVal <= 960;
}

function isShiftHours() {
  const now = new Date();
  const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day = pst.getDay();
  const hour = pst.getHours();
  const min = pst.getMinutes();
  const timeVal = hour * 60 + min;
  return day >= 1 && day <= 5 && timeVal >= 420 && timeVal <= 990; // 7:00 AM - 4:30 PM
}

// ─── Agent glyphs — refined emoji, sharp + intentional ───
const GLYPH_MAP = {
  atlas:      '🔮',   // foresight, command
  darwin:     '🧬',   // evolution, DNA
  viper:      '⚡',   // speed, electricity
  analyst:    '💎',   // precision, clarity
  ledger:     '📊',   // data, metrics
  regime:     '🛡️',   // defense, protection
  strategist: '♟️',   // strategy, chess
  wire:       '🔗',   // connection, signal
  dispatch:   '📡',   // broadcast, dispatch
  friday:     '🔧',   // utility, tools
  grower:     '🌱',   // growth, cultivation
  radar:      '🎯',   // targeting, precision
  guide:      '🧭',   // navigation, compass
  scout:      '🔭',   // discovery, observation
  sensei:     '☯️',    // mastery, balance
};

// ─── State ───
const state = {
  agents: [],
  activity: [],
  inbox: [],
  tasks: [],
  windows: new Map(),
  nextZ: 100,
  focusedWindow: null,
  dragState: null,
  resizeState: null,
  isMobile: window.innerWidth <= 768,
  soundEnabled: false, // User opts in via tray click
  connected: true,
};

// ─── Option Position DD Panel Data Store ───
const optPosDataMap = new Map();

// ─── Window Definitions ───
// Default positions/sizes are computed dynamically to fill viewport
const WINDOW_DEFS = {
  activity: {
    title: 'Activity Feed',
    icon: '📡',
    template: 'tmpl-activity',
  },
  agents: {
    title: 'Agent Fleet',
    icon: '⚡',
    template: 'tmpl-agents',
  },
  inbox: {
    title: 'Inbox',
    icon: '📨',
    template: 'tmpl-inbox',
  },
  'atlas-chat': {
    title: 'Atlas Chat',
    icon: '🔮',
    template: 'tmpl-atlas-chat',
  },
  tasks: {
    title: 'Neural Tasks',
    icon: '🧠',
    template: 'tmpl-tasks',
  },
  trading: {
    title: 'Trading Desk',
    icon: '📊',
    template: 'tmpl-trading',
  },
  work: {
    title: 'Production',
    icon: '🏭',
    template: 'tmpl-work',
  },
  github: {
    title: 'GitHub',
    icon: '🐙',
    template: 'tmpl-github',
  },
  analytics: {
    title: 'Analytics',
    icon: '📈',
    template: 'tmpl-analytics',
  },
  scout: {
    title: 'Scout — Opportunities',
    icon: '🔭',
    template: 'tmpl-scout',
  },
  system: {
    title: 'System Status',
    icon: '🖥️',
    template: 'tmpl-system',
  },
};

// Compute tiled layout that fills the viewport
function getDefaultLayout(id) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const taskbarH = 48;
  const pad = 12;
  const usableH = vh - taskbarH - pad * 2;
  const usableW = vw - pad * 3; // left pad + gap + right pad

  const halfW = Math.floor(usableW / 2);
  const fullH = usableH;

  // Trading desk: largest window, center-left (70% width)
  const tradingW = Math.floor(usableW * 0.7);
  const sidebarW = usableW - tradingW - pad;

  const layouts = {
    trading:  { x: pad, y: pad, w: tradingW, h: fullH }, // HERO: 70% width, left
    agents:   { x: pad * 2 + tradingW, y: pad, w: sidebarW, h: Math.floor(fullH / 2) - pad/2 }, // Right sidebar, top
    activity: { x: pad * 2 + tradingW, y: pad * 2 + Math.floor(fullH / 2), w: sidebarW, h: Math.floor(fullH / 2) - pad }, // Right sidebar, bottom
    inbox:    { x: pad, y: pad, w: halfW, h: fullH },
    'atlas-chat': { x: pad * 2 + halfW, y: pad, w: halfW, h: fullH },
    tasks:    { x: pad, y: pad, w: halfW + pad + halfW, h: fullH },
    work:     { x: pad, y: pad, w: tradingW, h: fullH },
    github:   { x: pad * 2 + halfW, y: pad, w: halfW, h: fullH },
    analytics: { x: pad, y: pad, w: tradingW, h: fullH },
    scout:    { x: pad * 2 + halfW, y: pad, w: halfW, h: fullH },
  };

  return layouts[id] || { x: 100, y: 50, w: 500, h: 500 };
}


/* ═══════════════════════════════════════════════════
   SOUND DESIGN — Subtle audio cues (Web Audio API)
   ═══════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.04) {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function soundOpen() { playTone(600, 0.12, 'sine', 0.03); setTimeout(() => playTone(800, 0.1, 'sine', 0.02), 60); }
function soundClose() { playTone(500, 0.1, 'sine', 0.02); }
function soundNotify() { playTone(880, 0.08, 'sine', 0.04); setTimeout(() => playTone(1100, 0.15, 'sine', 0.03), 100); }
function soundClick() { playTone(1000, 0.04, 'sine', 0.015); }


/* ═══════════════════════════════════════════════════
   BOOT SEQUENCE
   ═══════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  const bootScreen = document.getElementById('bootScreen');
  const desktop = document.getElementById('desktop');
  const bootStatus = bootScreen.querySelector('.boot-status');

  const bootMessages = [
    'Initializing agent network...',
    'Connecting to Mission Control API...',
    'Loading agent fleet status...',
    'Mapping neural pathways...',
    'Systems ready.',
  ];
  let msgIdx = 0;
  const statusInterval = setInterval(() => {
    msgIdx++;
    if (msgIdx < bootMessages.length && bootStatus) {
      bootStatus.textContent = bootMessages[msgIdx];
    }
  }, 600);

  const dataPromise = Promise.all([
    fetchAgents(),
    fetchActivity(),
    fetchInbox(),
  ]);

  await Promise.all([
    new Promise(r => setTimeout(r, 3200)),
    dataPromise,
  ]);

  clearInterval(statusInterval);

  bootScreen.classList.add('boot-exit');
  setTimeout(() => {
    bootScreen.style.display = 'none';
    desktop.style.display = 'flex';
    initDesktop();
  }, 600);
});


/* ═══════════════════════════════════════════════════
   DESKTOP INITIALIZATION
   ═══════════════════════════════════════════════════ */
function initDesktop() {
  // Clear stale saved positions from old layout
  const layoutVersion = 'v5-list';
  if (localStorage.getItem('atlas-os-layout-ver') !== layoutVersion) {
    ['activity', 'agents', 'inbox', 'atlas-chat', 'tasks'].forEach(id => {
      localStorage.removeItem(`atlas-os-pos-${id}`);
      localStorage.removeItem(`atlas-os-size-${id}`);
    });
    localStorage.setItem('atlas-os-layout-ver', layoutVersion);
  }

  initClock();
  initBgCanvas();
  initDesktopIcons();
  initTaskbar();
  initMobileNav();
  initKeyboard();
  updateTray();

  // Open default windows
  if (state.isMobile) {
    // Mobile: Trading Desk is the default view
    openWindow('trading');
    openWindow('agents');
    openWindow('activity');
  } else {
    const saved = loadWindowState();
    if (saved && saved.length > 0) {
      saved.forEach(id => openWindow(id));
    } else {
      // Default desktop layout: Trading Desk (hero) + Agent Fleet + Activity Feed
      openWindow('trading');
      openWindow('agents');
      openWindow('activity');
    }
  }

  // Start polling
  setInterval(pollData, POLL_INTERVAL);

  // Trading desk auto-refresh — faster during market hours
  // Trading auto-refresh — faster during market hours
  let tradingTimer = null;
  function scheduleTradingPoll() {
    if (tradingTimer) clearInterval(tradingTimer);
    const interval = isMarketHours() ? TRADING_POLL_INTERVAL : TRADING_IDLE_INTERVAL;
    tradingTimer = setInterval(async () => {
      if (state.windows.has('trading')) await fetchTradingData();
    }, interval);
  }
  scheduleTradingPoll();
  setInterval(scheduleTradingPoll, 300000);

  // Work/production auto-refresh — faster during shift hours
  let workTimer = null;
  function scheduleWorkPoll() {
    if (workTimer) clearInterval(workTimer);
    const interval = isShiftHours() ? PRODUCTION_POLL_INTERVAL : PRODUCTION_IDLE_INTERVAL;
    workTimer = setInterval(async () => {
      if (state.windows.has('work')) await fetchWorkData();
    }, interval);
  }
  scheduleWorkPoll();
  setInterval(scheduleWorkPoll, 300000);

  // GitHub auto-refresh — every 2 minutes
  setInterval(async () => {
    if (state.windows.has('github')) await fetchGitHubData();
  }, GITHUB_POLL_INTERVAL);

  // Resize listener
  window.addEventListener('resize', () => {
    state.isMobile = window.innerWidth <= 768;
  });
}


/* ═══════════════════════════════════════════════════
   DATA LAYER
   ═══════════════════════════════════════════════════ */
async function apiFetch(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();
    state.connected = true;
    updateConnectionIndicator();
    return json.data || json;
  } catch (err) {
    console.warn(`[Atlas OS] API error: ${path}`, err);
    state.connected = false;
    updateConnectionIndicator();
    return null;
  }
}

function updateConnectionIndicator() {
  const indicator = document.querySelector('.tray-indicator');
  if (!indicator) return;
  if (state.connected) {
    indicator.style.background = 'var(--sig-active)';
    indicator.style.boxShadow = '0 0 6px var(--sig-active)';
  } else {
    indicator.style.background = 'var(--sig-danger)';
    indicator.style.boxShadow = '0 0 6px var(--sig-danger)';
  }
}

async function fetchAgents() {
  const data = await apiFetch('/agents');
  if (data) {
    state.agents = data;
    renderAgents();
    updateTray();
  }
}

async function fetchActivity() {
  const data = await apiFetch('/activity');
  if (data) {
    const prev = state.activity.length;
    state.activity = Array.isArray(data) ? data : [];
    renderActivity();
    // Sound on new activity
    if (prev > 0 && state.activity.length > prev) soundNotify();
  }
}

async function fetchInbox() {
  const data = await apiFetch('/inbox');
  if (data) {
    const prevPending = state.inbox.filter(i => i.status === 'pending').length;
    state.inbox = Array.isArray(data) ? data : [];
    renderInbox();
    updateTray();
    const newPending = state.inbox.filter(i => i.status === 'pending').length;
    if (newPending > prevPending) soundNotify();
  }
}

async function fetchTradingData() {
  const [regime, plays, portfolio, positions, closedPositions, brief, regimeHistory, widgets] = await Promise.all([
    apiFetch('/regime'),
    apiFetch('/plays'),
    apiFetch('/portfolio'),
    apiFetch('/positions?status=open'),
    apiFetch('/positions?status=closed'),
    apiFetch('/briefs/latest'),
    apiFetch('/regime/history'),
    apiFetch('/widgets'),
  ]);

  if (regime || plays || portfolio) {
    renderTradingDesk(regime, plays, portfolio, positions, closedPositions, brief, regimeHistory, widgets);
  }
}

async function fetchWorkData() {
  const production = await fetchProductionData();
  renderWorkPanel(production);
}

function renderWorkPanel(production) {
  const container = document.getElementById('workMain');
  if (!container) return;

  const shiftActive = isShiftHours();
  const shiftIndicator = shiftActive
    ? '<span class="live-dot"></span> ON SHIFT'
    : 'OFF SHIFT';

  morphInto(container, `
    <div class="trading-status-bar">
      <span class="trading-market-status ${shiftActive ? 'market-open' : 'market-closed'}">${shiftIndicator}</span>
      <span class="trading-refresh-rate">${shiftActive ? 'Refreshing every 60s' : 'Refreshing every 5m'}</span>
    </div>
    <div class="work-grid">
      ${buildProductionCard(production)}
    </div>
  `);
}

async function fetchProductionData() {
  try {
    const res = await fetch(PRODUCTION_API);
    if (!res.ok) throw new Error(`Production API ${res.status}`);
    const json = await res.json();
    return json.scoreboard || null;
  } catch (err) {
    console.warn('[Atlas OS] Production API error:', err);
    return null;
  }
}

// ─── GitHub Dashboard ───
const GITHUB_POLL_INTERVAL = 120000; // 2 min

async function fetchGitHubData() {
  const data = await apiFetch('/github?action=dashboard');
  if (data) renderGitHubDashboard(data);
}

function renderGitHubDashboard(data) {
  const container = document.getElementById('githubMain');
  if (!container) return;

  const { commits = [], ci_runs = [], issues = [], pulls = [], branches = [], summary = {} } = data;

  // CI status badge
  const ciStatus = summary.ci_passing
    ? '<span class="gh-badge gh-badge-pass">✓ CI Passing</span>'
    : '<span class="gh-badge gh-badge-fail">✗ CI Failing</span>';

  // Commits section
  const commitsHTML = commits.map(c => `
    <div class="gh-commit">
      <code class="gh-sha">${c.sha}</code>
      <span class="gh-commit-msg">${escapeHTML(c.message)}</span>
      <span class="gh-meta">${c.time_ago}</span>
    </div>
  `).join('') || '<div class="gh-empty">No recent commits</div>';

  // CI runs section
  const runsHTML = ci_runs.map(r => {
    const icon = r.conclusion === 'success' ? '<span class="gh-ci-dot gh-ci-pass">●</span>'
      : r.conclusion === 'failure' ? '<span class="gh-ci-dot gh-ci-fail">●</span>'
      : '<span class="gh-ci-dot gh-ci-pending">●</span>';
    const dur = r.duration ? `${r.duration}s` : '—';
    return `
      <div class="gh-run">
        ${icon}
        <span class="gh-run-name">${escapeHTML(r.name)}</span>
        <span class="gh-meta">${dur} · ${r.time_ago}</span>
      </div>
    `;
  }).join('') || '<div class="gh-empty">No workflow runs</div>';

  // Issues section
  const issueCount = issues.length;
  const issuesHTML = issueCount > 0
    ? issues.map(i => `
        <div class="gh-issue">
          <span class="gh-issue-num">#${i.number}</span>
          <span class="gh-issue-title">${escapeHTML(i.title)}</span>
          <span class="gh-meta">${i.time_ago}</span>
        </div>
      `).join('')
    : '<div class="gh-empty-good">No open issues ✓</div>';

  // PRs section
  const prCount = pulls.length;
  const prsHTML = prCount > 0
    ? pulls.map(p => `
        <div class="gh-pr">
          <span class="gh-pr-num">#${p.number}</span>
          <span class="gh-pr-title">${escapeHTML(p.title)}</span>
          <span class="gh-pr-branch">${escapeHTML(p.branch)}</span>
          <span class="gh-meta">${p.time_ago}</span>
        </div>
      `).join('')
    : '<div class="gh-empty-good">No open PRs ✓</div>';

  // Branches
  const branchCount = branches.length;
  const branchesHTML = branches.map(b => {
    const badge = b.protected ? ' <span class="gh-branch-protected">protected</span>' : '';
    const isMain = b.name === 'master' || b.name === 'main';
    return `<span class="gh-branch ${isMain ? 'gh-branch-main' : ''}">${escapeHTML(b.name)}${badge}</span>`;
  }).join('');

  morphInto(container, `
    <div class="gh-header">
      <div class="gh-repo">
        <span class="gh-repo-icon">🐙</span>
        <span class="gh-repo-name">${escapeHTML(data.repo)}</span>
        ${ciStatus}
      </div>
      <div class="gh-summary">
        <span class="gh-stat"><strong>${summary.total_commits || 0}</strong> recent</span>
        <span class="gh-stat-sep">·</span>
        <span class="gh-stat"><strong>${issueCount}</strong> issue${issueCount !== 1 ? 's' : ''}</span>
        <span class="gh-stat-sep">·</span>
        <span class="gh-stat"><strong>${prCount}</strong> PR${prCount !== 1 ? 's' : ''}</span>
        <span class="gh-stat-sep">·</span>
        <span class="gh-stat"><strong>${branchCount}</strong> branch${branchCount !== 1 ? 'es' : ''}</span>
      </div>
    </div>

    <div class="gh-grid">
      <div class="gh-section">
        <div class="gh-section-header">
          <span class="gh-section-icon">⊙</span>
          <span class="gh-section-title">RECENT COMMITS</span>
        </div>
        <div class="gh-section-body gh-commits-list">
          ${commitsHTML}
        </div>
      </div>

      <div class="gh-section">
        <div class="gh-section-header">
          <span class="gh-section-icon">◎</span>
          <span class="gh-section-title">CI RUNS</span>
        </div>
        <div class="gh-section-body">
          ${runsHTML}
        </div>
      </div>

      <div class="gh-section gh-section-half">
        <div class="gh-section-header">
          <span class="gh-section-icon">◉</span>
          <span class="gh-section-title">ISSUES</span>
          <span class="gh-count">${issueCount}</span>
        </div>
        <div class="gh-section-body">
          ${issuesHTML}
        </div>
      </div>

      <div class="gh-section gh-section-half">
        <div class="gh-section-header">
          <span class="gh-section-icon">⊕</span>
          <span class="gh-section-title">PULL REQUESTS</span>
          <span class="gh-count">${prCount}</span>
        </div>
        <div class="gh-section-body">
          ${prsHTML}
        </div>
      </div>

      <div class="gh-section">
        <div class="gh-section-header">
          <span class="gh-section-icon">⊘</span>
          <span class="gh-section-title">BRANCHES</span>
          <span class="gh-count">${branchCount}</span>
        </div>
        <div class="gh-branches">
          ${branchesHTML}
        </div>
      </div>
    </div>

    <div class="gh-footer">
      <span class="gh-refresh-note">Updated ${new Date(data.fetched_at).toLocaleTimeString()} · Refreshing every 2m</span>
    </div>
  `);
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Analytics Dashboard ───
async function fetchAnalyticsData() {
  const today = new Date();
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(today.getDate() - 60);

  const formatDate = (d) => d.toISOString().split('T')[0];
  const start = formatDate(sixtyDaysAgo);
  const end = formatDate(today);

  try {
    const url = `https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&start=${start}&end=${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Analytics API ${res.status}`);
    const json = await res.json();
    const daily = json.daily || [];

    // Filter to active production days only
    const activeDays = daily.filter(d => d.totalLbs > 0);

    renderAnalytics(activeDays);
  } catch (err) {
    console.warn('[Atlas OS] Analytics API error:', err);
    const container = document.getElementById('analyticsMain');
    if (container) {
      container.innerHTML = '<div class="analytics-error">Failed to load analytics data</div>';
    }
  }
}

function renderAnalytics(days) {
  const container = document.getElementById('analyticsMain');
  if (!container || !days || days.length === 0) {
    if (container) {
      container.innerHTML = '<div class="analytics-empty">No production data available</div>';
    }
    return;
  }

  // Calculate summary stats
  const totalLbs = days.reduce((sum, d) => sum + d.totalLbs, 0);
  const productionDays = days.length;
  const dailyAvg = totalLbs / productionDays;
  const bestDay = days.reduce((best, d) => d.totalLbs > best.totalLbs ? d : best, days[0]);
  const bestRate = days.reduce((best, d) => d.avgRate > best.avgRate ? d : best, days[0]);

  // Weighted avg cost/lb
  const totalCost = days.reduce((sum, d) => sum + (d.costPerLb * d.totalLbs), 0);
  const avgCost = totalCost / totalLbs;

  // Day of week analysis
  const dowData = {};
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  days.forEach(d => {
    const date = new Date(d.date + 'T12:00:00');
    const dow = dowNames[date.getDay()];
    if (!dowData[dow]) dowData[dow] = { totalLbs: 0, totalRate: 0, count: 0 };
    dowData[dow].totalLbs += d.totalLbs;
    dowData[dow].totalRate += d.avgRate;
    dowData[dow].count++;
  });

  const dowStats = Object.entries(dowData).map(([dow, data]) => ({
    dow,
    avgLbs: data.totalLbs / data.count,
    avgRate: data.totalRate / data.count,
    count: data.count,
  })).sort((a, b) => b.avgLbs - a.avgLbs);

  // Tops vs Smalls breakdown
  const totalTops = days.reduce((sum, d) => sum + d.totalTops, 0);
  const totalSmalls = days.reduce((sum, d) => sum + d.totalSmalls, 0);
  const topsPercent = (totalTops / totalLbs * 100).toFixed(1);
  const smallsPercent = (totalSmalls / totalLbs * 100).toFixed(1);

  morphInto(container, `
    <div class="analytics-scroll">
      <div class="analytics-summary-cards">
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">TOTAL OUTPUT</span>
          <span class="portfolio-stat-value">${totalLbs.toFixed(1)} lbs</span>
        </div>
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">PRODUCTION DAYS</span>
          <span class="portfolio-stat-value">${productionDays}</span>
        </div>
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">DAILY AVERAGE</span>
          <span class="portfolio-stat-value">${dailyAvg.toFixed(1)} lbs</span>
        </div>
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">BEST DAY</span>
          <span class="portfolio-stat-value">${bestDay.totalLbs.toFixed(1)} lbs</span>
          <span class="portfolio-stat-meta">${formatShortDate(bestDay.date)}</span>
        </div>
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">BEST RATE</span>
          <span class="portfolio-stat-value">${bestRate.avgRate.toFixed(2)} lb/hr</span>
          <span class="portfolio-stat-meta">${formatShortDate(bestRate.date)}</span>
        </div>
        <div class="portfolio-stat">
          <span class="portfolio-stat-label">AVG COST/LB</span>
          <span class="portfolio-stat-value">$${avgCost.toFixed(2)}</span>
        </div>
      </div>

      <div class="analytics-section">
        <div class="analytics-section-header">DAILY OUTPUT</div>
        <div class="analytics-chart-container">
          ${buildOutputChart(days, dailyAvg)}
        </div>
      </div>

      <div class="analytics-section">
        <div class="analytics-section-header">EFFICIENCY TREND</div>
        <div class="analytics-chart-container">
          ${buildEfficiencyChart(days)}
        </div>
      </div>

      <div class="analytics-section">
        <div class="analytics-section-header">COST PER LB</div>
        <div class="analytics-chart-container">
          ${buildCostChart(days)}
        </div>
      </div>

      <div class="analytics-section">
        <div class="analytics-section-header">DAY OF WEEK PERFORMANCE</div>
        <div class="analytics-dow-grid">
          ${dowStats.map(d => `
            <div class="analytics-dow-card">
              <div class="analytics-dow-name">${d.dow}</div>
              <div class="analytics-dow-stat">${d.avgLbs.toFixed(1)} <span class="analytics-dow-unit">lbs</span></div>
              <div class="analytics-dow-stat">${d.avgRate.toFixed(2)} <span class="analytics-dow-unit">lb/hr</span></div>
              <div class="analytics-dow-count">${d.count} days</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="analytics-section">
        <div class="analytics-section-header">TOPS VS SMALLS</div>
        <div class="analytics-breakdown">
          <div class="analytics-breakdown-bar">
            <div class="analytics-breakdown-segment analytics-breakdown-tops" style="width: ${topsPercent}%">
              <span class="analytics-breakdown-label">Tops: ${topsPercent}%</span>
            </div>
            <div class="analytics-breakdown-segment analytics-breakdown-smalls" style="width: ${smallsPercent}%">
              <span class="analytics-breakdown-label">Smalls: ${smallsPercent}%</span>
            </div>
          </div>
          <div class="analytics-breakdown-legend">
            <div class="analytics-breakdown-legend-item">
              <span class="analytics-breakdown-dot analytics-breakdown-dot-tops"></span>
              <span>Tops: ${totalTops.toFixed(1)} lbs</span>
            </div>
            <div class="analytics-breakdown-legend-item">
              <span class="analytics-breakdown-dot analytics-breakdown-dot-smalls"></span>
              <span>Smalls: ${totalSmalls.toFixed(1)} lbs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function formatShortDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  const mon = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${mon} ${day}`;
}

function buildOutputChart(days, avgLine) {
  if (days.length === 0) return '<div class="analytics-chart-empty">No data</div>';

  const maxLbs = Math.max(...days.map(d => d.totalLbs));
  const chartH = 200;
  const chartW = 800;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const barW = Math.max(4, Math.min(24, (plotW / days.length) * 0.7));
  const barGap = plotW / days.length;

  const bars = days.map((d, i) => {
    const h = (d.totalLbs / maxLbs) * plotH;
    const x = padL + i * barGap + (barGap - barW) / 2;
    const y = padT + plotH - h;
    const color = d.totalLbs >= 150 ? 'var(--sig-success)'
                : d.totalLbs >= 100 ? 'var(--sig-warning)'
                : 'var(--sig-danger)';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" opacity="0.85" rx="1.5"><title>${formatShortDate(d.date)}: ${d.totalLbs.toFixed(1)} lbs</title></rect>`;
  }).join('');

  const avgY = padT + plotH - (avgLine / maxLbs) * plotH;

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = (maxLbs / ySteps) * i;
    const y = padT + plotH - (val / maxLbs) * plotH;
    return `<text x="${padL - 6}" y="${y + 3}" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="end" font-family="var(--font-mono)">${Math.round(val)}</text>` +
           `<line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`;
  }).join('');

  // X-axis labels (every Nth day)
  const labelEvery = Math.ceil(days.length / 10);
  const xLabels = days.filter((_, i) => i % labelEvery === 0).map(d => {
    const idx = days.indexOf(d);
    const x = padL + idx * barGap + barGap / 2;
    return `<text x="${x}" y="${chartH - 5}" fill="rgba(255,255,255,0.4)" font-size="7" text-anchor="middle" font-family="var(--font-mono)">${formatShortDate(d.date)}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${chartW} ${chartH}" class="analytics-chart" preserveAspectRatio="xMidYMid meet">
      ${yLabels}
      <line x1="${padL}" y1="${avgY}" x2="${chartW - padR}" y2="${avgY}" stroke="rgba(255,255,255,0.3)" stroke-width="0.5" stroke-dasharray="4,3" />
      <text x="${padL + 4}" y="${avgY - 4}" fill="rgba(255,255,255,0.5)" font-size="7" font-family="var(--font-mono)">avg: ${avgLine.toFixed(0)}</text>
      ${bars}
      ${xLabels}
    </svg>
  `;
}

function buildEfficiencyChart(days) {
  if (days.length === 0) return '<div class="analytics-chart-empty">No data</div>';

  const maxRate = Math.max(...days.map(d => d.avgRate));
  const minRate = Math.min(...days.map(d => d.avgRate));
  const range = maxRate - minRate || 0.1;
  const chartH = 200;
  const chartW = 800;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const getX = (i) => padL + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const getY = (val) => padT + plotH - ((val - minRate) / range) * plotH;

  const points = days.map((d, i) => `${getX(i)},${getY(d.avgRate)}`).join(' ');

  const dots = days.map((d, i) =>
    `<circle cx="${getX(i)}" cy="${getY(d.avgRate)}" r="3" fill="var(--sig-active)" opacity="0.9"><title>${formatShortDate(d.date)}: ${d.avgRate.toFixed(2)} lb/hr</title></circle>`
  ).join('');

  const avgRate = days.reduce((sum, d) => sum + d.avgRate, 0) / days.length;
  const avgY = getY(avgRate);

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = minRate + (range / ySteps) * i;
    const y = getY(val);
    return `<text x="${padL - 6}" y="${y + 3}" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="end" font-family="var(--font-mono)">${val.toFixed(2)}</text>` +
           `<line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`;
  }).join('');

  const labelEvery = Math.ceil(days.length / 10);
  const xLabels = days.filter((_, i) => i % labelEvery === 0).map((d, _, arr) => {
    const idx = days.indexOf(d);
    return `<text x="${getX(idx)}" y="${chartH - 5}" fill="rgba(255,255,255,0.4)" font-size="7" text-anchor="middle" font-family="var(--font-mono)">${formatShortDate(d.date)}</text>`;
  }).join('');

  // Gradient area fill
  const areaPath = `M${getX(0)},${padT + plotH} ${days.map((d, i) => `L${getX(i)},${getY(d.avgRate)}`).join(' ')} L${getX(days.length - 1)},${padT + plotH} Z`;

  return `
    <svg viewBox="0 0 ${chartW} ${chartH}" class="analytics-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--sig-active)" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="var(--sig-active)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yLabels}
      <line x1="${padL}" y1="${avgY}" x2="${chartW - padR}" y2="${avgY}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" stroke-dasharray="4,3" />
      <text x="${padL + 4}" y="${avgY - 4}" fill="rgba(255,255,255,0.5)" font-size="7" font-family="var(--font-mono)">avg: ${avgRate.toFixed(2)}</text>
      <path d="${areaPath}" fill="url(#effGrad)" />
      <polyline points="${points}" fill="none" stroke="var(--sig-active)" stroke-width="1.5" stroke-linejoin="round" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

function buildCostChart(days) {
  if (days.length === 0) return '<div class="analytics-chart-empty">No data</div>';

  const maxCost = Math.max(...days.map(d => d.costPerLb));
  const minCost = Math.min(...days.map(d => d.costPerLb));
  const range = maxCost - minCost || 1;
  const chartH = 200;
  const chartW = 800;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const getX = (i) => padL + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const getY = (val) => padT + plotH - ((val - minCost) / range) * plotH;

  const points = days.map((d, i) => `${getX(i)},${getY(d.costPerLb)}`).join(' ');

  const dots = days.map((d, i) => {
    const normalized = (d.costPerLb - minCost) / range;
    const color = normalized < 0.33 ? 'var(--sig-success)' : normalized < 0.67 ? 'var(--sig-warning)' : 'var(--sig-danger)';
    return `<circle cx="${getX(i)}" cy="${getY(d.costPerLb)}" r="3" fill="${color}" opacity="0.9"><title>${formatShortDate(d.date)}: $${d.costPerLb.toFixed(2)}/lb</title></circle>`;
  }).join('');

  const avgCost = days.reduce((sum, d) => sum + d.costPerLb, 0) / days.length;
  const avgY = getY(avgCost);

  // Y-axis labels
  const ySteps = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = minCost + (range / ySteps) * i;
    const y = getY(val);
    return `<text x="${padL - 6}" y="${y + 3}" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="end" font-family="var(--font-mono)">$${val.toFixed(0)}</text>` +
           `<line x1="${padL}" y1="${y}" x2="${chartW - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`;
  }).join('');

  const labelEvery = Math.ceil(days.length / 10);
  const xLabels = days.filter((_, i) => i % labelEvery === 0).map(d => {
    const idx = days.indexOf(d);
    return `<text x="${getX(idx)}" y="${chartH - 5}" fill="rgba(255,255,255,0.4)" font-size="7" text-anchor="middle" font-family="var(--font-mono)">${formatShortDate(d.date)}</text>`;
  }).join('');

  // Area fill
  const areaPath = `M${getX(0)},${padT + plotH} ${days.map((d, i) => `L${getX(i)},${getY(d.costPerLb)}`).join(' ')} L${getX(days.length - 1)},${padT + plotH} Z`;

  return `
    <svg viewBox="0 0 ${chartW} ${chartH}" class="analytics-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--sig-warning)" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="var(--sig-warning)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${yLabels}
      <line x1="${padL}" y1="${avgY}" x2="${chartW - padR}" y2="${avgY}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" stroke-dasharray="4,3" />
      <text x="${padL + 4}" y="${avgY - 4}" fill="rgba(255,255,255,0.5)" font-size="7" font-family="var(--font-mono)">avg: $${avgCost.toFixed(2)}</text>
      <path d="${areaPath}" fill="url(#costGrad)" />
      <polyline points="${points}" fill="none" stroke="var(--sig-warning)" stroke-width="1.5" stroke-linejoin="round" opacity="0.7" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

// ══════════════════════════════════════════════
// SYSTEM STATUS WINDOW
// ══════════════════════════════════════════════

function renderSystemStatus() {
  const el = document.getElementById('systemMain');
  if (!el) return;

  const heartbeatState = {
    lastChecks: {
      production: '2026-02-13T12:00:00-08:00',
      github: '2026-02-15T20:55:00-08:00',
      weather: '2026-02-15T17:50:00-08:00',
      digest: '2026-02-15T20:55:00-08:00',
      radar: '2026-02-15T08:02:00-08:00',
      eveningBuild: '2026-02-15T19:02:00-08:00',
      selfEvolution: '2026-02-15T04:11:00-08:00',
      nightlyBuild: '2026-02-15T22:02:00-08:00',
    },
  };

  const nightlyBuilds = [
    { date: '2026-02-15', task: 'Production Analytics Window', status: 'complete', highlights: ['SVG bar/line charts', 'Day-of-week analysis', 'Tops vs smalls breakdown'] },
    { date: '2026-02-14', task: 'GitHub Dashboard', status: 'complete', highlights: ['Server-side GitHub API proxy', 'Commits, CI, issues, PRs, branches'] },
    { date: '2026-02-13', task: 'Test Suite + CI + Repo Refactor', status: 'complete', highlights: ['227 tests, 60 suites', 'Deleted 5 legacy handlers', 'Split 2,700-line handler → 12 modules'] },
    { date: '2026-02-06', task: 'Evening Cleanup & Docs', status: 'complete', highlights: ['Documentation updates', 'Code cleanup'] },
    { date: '2026-02-05', task: 'Pool Inventory System', status: 'complete', highlights: ['Full CRUD inventory', 'D1 backend integration'] },
    { date: '2026-02-03', task: 'Cookbook App', status: 'complete', highlights: ['Cooking Mama pixel art', '25 recipes, favorites'] },
    { date: '2026-02-02', task: 'Repo Review + Briefing Cards', status: 'complete', highlights: ['Root cleanup 50→13 files', 'SQL injection guards'] },
  ];

  const checkLabels = {
    production: { label: 'Production Pulse', icon: '🏭' },
    github: { label: 'GitHub Sentinel', icon: '🐙' },
    weather: { label: 'Weather Report', icon: '🌤️' },
    digest: { label: 'Daily Digest', icon: '📝' },
    radar: { label: "Koa's Radar", icon: '📡' },
    eveningBuild: { label: 'Evening Build', icon: '🔧' },
    selfEvolution: { label: 'Self-Evolution', icon: '🧬' },
    nightlyBuild: { label: 'Nightly Build', icon: '⭐' },
  };

  function timeAgo(isoStr) {
    if (!isoStr) return 'never';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function checkStatus(isoStr) {
    if (!isoStr) return 'offline';
    const diff = Date.now() - new Date(isoStr).getTime();
    const hrs = diff / 3600000;
    if (hrs < 6) return 'recent';
    if (hrs < 24) return 'stale';
    return 'overdue';
  }

  // Machine Overview
  const machineHTML = `
    <div class="sys-card sys-machine">
      <div class="sys-machine-header">
        <div class="sys-machine-status">
          <span class="sys-pulse"></span>
          <span class="sys-status-text">ONLINE</span>
        </div>
        <div class="sys-machine-name">Fern</div>
      </div>
      <div class="sys-machine-specs">
        <span class="sys-spec">ASUS ROG Zephyrus 14"</span>
        <span class="sys-spec-sep">·</span>
        <span class="sys-spec">Ryzen 9</span>
        <span class="sys-spec-sep">·</span>
        <span class="sys-spec">16GB DDR5</span>
        <span class="sys-spec-sep">·</span>
        <span class="sys-spec">RX 6700S</span>
      </div>
      <div class="sys-bars">
        <div class="sys-bar-row">
          <span class="sys-bar-label">CPU</span>
          <div class="sys-bar-track"><div class="sys-bar-fill sys-bar-cpu" style="width:12%"></div></div>
          <span class="sys-bar-val">12%</span>
        </div>
        <div class="sys-bar-row">
          <span class="sys-bar-label">RAM</span>
          <div class="sys-bar-track"><div class="sys-bar-fill sys-bar-ram" style="width:68%"></div></div>
          <span class="sys-bar-val">9.5/14 GB</span>
        </div>
        <div class="sys-bar-row">
          <span class="sys-bar-label">Disk</span>
          <div class="sys-bar-track"><div class="sys-bar-fill sys-bar-disk" style="width:41%"></div></div>
          <span class="sys-bar-val">410/1000 GB</span>
        </div>
      </div>
      <div class="sys-session-info">
        <span class="sys-info-item">Model: <strong>Claude Opus 4.6</strong></span>
        <span class="sys-info-item">Boot: <strong>Feb 1, 2026</strong></span>
        <span class="sys-info-item">WSL2: <strong>Ubuntu 24.04</strong></span>
      </div>
    </div>
  `;

  // Heartbeat Timeline
  const checksHTML = Object.entries(heartbeatState.lastChecks).map(([key, val]) => {
    const meta = checkLabels[key] || { label: key, icon: '⏱️' };
    const status = checkStatus(val);
    const ago = timeAgo(val);
    return `
      <div class="sys-check-row">
        <span class="sys-check-icon">${meta.icon}</span>
        <span class="sys-check-label">${meta.label}</span>
        <span class="sys-check-ago">${ago}</span>
        <span class="sys-check-dot sys-dot-${status}"></span>
      </div>
    `;
  }).join('');

  const heartbeatHTML = `
    <div class="sys-card">
      <div class="sys-card-title">Heartbeat Checks</div>
      <div class="sys-checks-list">
        ${checksHTML}
      </div>
    </div>
  `;

  // Nightly Build Log
  const buildsHTML = nightlyBuilds.map(b => `
    <div class="sys-build-entry">
      <div class="sys-build-header">
        <span class="sys-build-date">${b.date}</span>
        <span class="sys-build-badge sys-badge-${b.status}">${b.status}</span>
      </div>
      <div class="sys-build-task">${escapeHTML(b.task)}</div>
      <div class="sys-build-highlights">
        ${b.highlights.map(h => `<span class="sys-highlight">• ${escapeHTML(h)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  const buildLogHTML = `
    <div class="sys-card sys-card-scroll">
      <div class="sys-card-title">Nightly Build Log</div>
      <div class="sys-builds-list">
        ${buildsHTML}
      </div>
    </div>
  `;

  el.innerHTML = `
    <div class="sys-grid">
      ${machineHTML}
      ${heartbeatHTML}
      ${buildLogHTML}
    </div>
  `;
}

async function pollData() {
  await Promise.all([fetchAgents(), fetchActivity(), fetchInbox()]);
  // Poll trading data if trading window is open
  if (state.windows.has('trading')) {
    await fetchTradingData();
  }
  // Poll work data if work window is open
  if (state.windows.has('work')) {
    await fetchWorkData();
  }
  // Poll GitHub data if github window is open
  if (state.windows.has('github')) {
    await fetchGitHubData();
  }
}

async function postInboxAction(itemId, action) {
  try {
    await fetch(`${API_BASE}/inbox/${itemId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    soundClick();
    await fetchInbox();
  } catch (err) {
    console.warn('[Atlas OS] Inbox action failed:', err);
  }
}


/* ═══════════════════════════════════════════════════
   WINDOW MANAGER
   ═══════════════════════════════════════════════════ */
function openWindow(id) {
  if (state.windows.has(id)) {
    const win = state.windows.get(id);
    if (win.el.classList.contains('window-minimized')) {
      win.el.classList.remove('window-minimized');
    }
    focusWindow(id);
    return;
  }

  const def = WINDOW_DEFS[id];
  if (!def) return;

  const container = document.getElementById('windowContainer');
  const tmpl = document.getElementById(def.template);
  if (!tmpl) return;

  const win = document.createElement('div');
  win.className = 'window';
  win.dataset.windowId = id;

  const titlebar = document.createElement('div');
  titlebar.className = 'window-titlebar';
  titlebar.innerHTML = `
    <span class="window-titlebar-icon">${def.icon}</span>
    <span class="window-titlebar-text">${def.title}</span>
    <div class="window-controls">
      <button class="window-ctrl window-ctrl-minimize" title="Minimize"></button>
      <button class="window-ctrl window-ctrl-maximize" title="Maximize"></button>
      <button class="window-ctrl window-ctrl-close" title="Close"></button>
    </div>
  `;

  const body = tmpl.content.cloneNode(true);

  const resizeHandles = ['n','s','e','w','ne','nw','se','sw'].map(dir => {
    const handle = document.createElement('div');
    handle.className = `window-resize window-resize-${dir}`;
    handle.dataset.resizeDir = dir;
    return handle;
  });

  win.appendChild(titlebar);
  win.appendChild(body);
  resizeHandles.forEach(h => win.appendChild(h));
  container.appendChild(win);

  // Position & size — use saved or compute tiled layout
  const layout = getDefaultLayout(id);
  const pos = loadWindowPos(id) || { x: layout.x, y: layout.y };
  const size = loadWindowSize(id) || { w: layout.w, h: layout.h };

  if (!state.isMobile) {
    win.style.left = pos.x + 'px';
    win.style.top = pos.y + 'px';
    win.style.width = size.w + 'px';
    win.style.height = size.h + 'px';
  }

  state.windows.set(id, {
    el: win,
    config: def,
    maximized: false,
    preMaxBounds: null,
  });

  requestAnimationFrame(() => {
    win.classList.add('window-visible');
  });

  // Drag
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-controls')) return;
    startDrag(e, id);
  });
  titlebar.addEventListener('touchstart', (e) => {
    if (e.target.closest('.window-controls')) return;
    startDrag(e, id);
  }, { passive: false });

  // Double-click titlebar to maximize
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.window-controls')) return;
    maximizeWindow(id);
  });

  win.querySelector('.window-ctrl-minimize').addEventListener('click', () => minimizeWindow(id));
  win.querySelector('.window-ctrl-maximize').addEventListener('click', () => maximizeWindow(id));
  win.querySelector('.window-ctrl-close').addEventListener('click', () => closeWindow(id));

  resizeHandles.forEach(h => {
    h.addEventListener('mousedown', (e) => startResize(e, id, h.dataset.resizeDir));
  });

  win.addEventListener('mousedown', () => focusWindow(id));

  focusWindow(id);
  updateTaskbarWindows();
  saveWindowState();
  soundOpen();

  // Populate
  if (id === 'agents') renderAgents();
  if (id === 'activity') renderActivity();
  if (id === 'inbox') renderInbox();
  if (id === 'atlas-chat') initChat();
  if (id === 'tasks') initTasksWindow();
  if (id === 'scout') renderScoutWindow();
  if (id === 'trading') fetchTradingData();
  if (id === 'work') fetchWorkData();
  if (id === 'github') fetchGitHubData();
  if (id === 'analytics') fetchAnalyticsData();
  if (id === 'system') renderSystemStatus();
}

function closeWindow(id) {
  const win = state.windows.get(id);
  if (!win) return;
  soundClose();
  win.el.classList.add('window-closing');
  win.el.classList.remove('window-visible');
  setTimeout(() => {
    win.el.remove();
    state.windows.delete(id);
    // Clean up dynamic window defs (agent detail panels)
    if (id.startsWith('agent-detail-')) delete WINDOW_DEFS[id];
    if (state.focusedWindow === id) state.focusedWindow = null;
    updateTaskbarWindows();
    saveWindowState();
  }, 250);
}

function minimizeWindow(id) {
  const win = state.windows.get(id);
  if (!win) return;
  win.el.classList.add('window-minimized');
  if (state.focusedWindow === id) state.focusedWindow = null;
  updateTaskbarWindows();
  soundClick();
}

function maximizeWindow(id) {
  const win = state.windows.get(id);
  if (!win || state.isMobile) return;

  const container = document.getElementById('windowContainer');
  const bounds = container.getBoundingClientRect();

  if (win.maximized) {
    const b = win.preMaxBounds;
    win.el.style.left = b.x + 'px';
    win.el.style.top = b.y + 'px';
    win.el.style.width = b.w + 'px';
    win.el.style.height = b.h + 'px';
    win.el.style.borderRadius = '';
    win.maximized = false;
  } else {
    win.preMaxBounds = {
      x: parseInt(win.el.style.left),
      y: parseInt(win.el.style.top),
      w: parseInt(win.el.style.width),
      h: parseInt(win.el.style.height),
    };
    win.el.style.left = '0px';
    win.el.style.top = '0px';
    win.el.style.width = bounds.width + 'px';
    win.el.style.height = bounds.height + 'px';
    win.el.style.borderRadius = '0';
    win.maximized = true;
  }
  soundClick();
}

function focusWindow(id) {
  state.windows.forEach((w) => {
    w.el.classList.remove('window-focused');
  });

  const win = state.windows.get(id);
  if (!win) return;
  win.el.classList.add('window-focused');
  win.el.style.zIndex = ++state.nextZ;
  state.focusedWindow = id;
  updateTaskbarWindows();
}


/* ─── Drag with snap zones ─── */
function startDrag(e, windowId) {
  if (state.isMobile) return;
  e.preventDefault();

  const win = state.windows.get(windowId);
  if (!win || win.maximized) return;

  const el = win.el;
  const isTouch = e.type === 'touchstart';
  const clientX = isTouch ? e.touches[0].clientX : e.clientX;
  const clientY = isTouch ? e.touches[0].clientY : e.clientY;

  state.dragState = {
    windowId,
    startX: clientX,
    startY: clientY,
    origLeft: parseInt(el.style.left) || 0,
    origTop: parseInt(el.style.top) || 0,
  };

  const container = document.getElementById('windowContainer');
  const bounds = container.getBoundingClientRect();
  const SNAP_ZONE = 20;

  const onMove = (ev) => {
    const cx = ev.type === 'touchmove' ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.type === 'touchmove' ? ev.touches[0].clientY : ev.clientY;
    const dx = cx - state.dragState.startX;
    const dy = cy - state.dragState.startY;

    let newLeft = state.dragState.origLeft + dx;
    let newTop = state.dragState.origTop + dy;

    // Prevent dragging completely off-screen
    newLeft = Math.max(-el.offsetWidth + 80, Math.min(bounds.width - 80, newLeft));
    newTop = Math.max(0, Math.min(bounds.height - 40, newTop));

    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';

    // Show snap hint
    removeSnapHint();
    if (cx <= SNAP_ZONE) showSnapHint('left');
    else if (cx >= window.innerWidth - SNAP_ZONE) showSnapHint('right');
    else if (cy <= SNAP_ZONE) showSnapHint('top');
  };

  const onUp = (ev) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);

    const cx = ev.type === 'touchend' ? (ev.changedTouches?.[0]?.clientX || 0) : ev.clientX;
    const cy = ev.type === 'touchend' ? (ev.changedTouches?.[0]?.clientY || 0) : ev.clientY;

    // Snap: left half, right half, or maximize on top
    if (cx <= SNAP_ZONE) {
      snapWindow(windowId, 'left', bounds);
    } else if (cx >= window.innerWidth - SNAP_ZONE) {
      snapWindow(windowId, 'right', bounds);
    } else if (cy <= SNAP_ZONE) {
      maximizeWindow(windowId);
    }

    removeSnapHint();
    state.dragState = null;
    saveWindowPos(windowId, parseInt(el.style.left), parseInt(el.style.top));
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);

  focusWindow(windowId);
}

function snapWindow(windowId, side, bounds) {
  const win = state.windows.get(windowId);
  if (!win) return;
  const el = win.el;

  if (side === 'left') {
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.width = Math.floor(bounds.width / 2) + 'px';
    el.style.height = bounds.height + 'px';
  } else if (side === 'right') {
    el.style.left = Math.ceil(bounds.width / 2) + 'px';
    el.style.top = '0px';
    el.style.width = Math.floor(bounds.width / 2) + 'px';
    el.style.height = bounds.height + 'px';
  }

  saveWindowPos(windowId, parseInt(el.style.left), parseInt(el.style.top));
  saveWindowSize(windowId, parseInt(el.style.width), parseInt(el.style.height));
}

function showSnapHint(side) {
  let hint = document.getElementById('snapHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'snapHint';
    hint.style.cssText = `
      position: fixed; z-index: 9999; pointer-events: none;
      background: rgba(167, 139, 250, 0.06);
      border: 2px solid rgba(167, 139, 250, 0.15);
      border-radius: 8px;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    document.body.appendChild(hint);
  }

  const taskbarH = 48;
  if (side === 'left') {
    hint.style.left = '4px'; hint.style.top = '4px';
    hint.style.width = 'calc(50vw - 8px)'; hint.style.height = `calc(100vh - ${taskbarH + 8}px)`;
  } else if (side === 'right') {
    hint.style.left = '50vw'; hint.style.top = '4px';
    hint.style.width = 'calc(50vw - 4px)'; hint.style.height = `calc(100vh - ${taskbarH + 8}px)`;
  } else if (side === 'top') {
    hint.style.left = '4px'; hint.style.top = '4px';
    hint.style.width = 'calc(100vw - 8px)'; hint.style.height = `calc(100vh - ${taskbarH + 8}px)`;
  }
  hint.style.opacity = '1';
}

function removeSnapHint() {
  const hint = document.getElementById('snapHint');
  if (hint) hint.remove();
}


/* ─── Resize ─── */
function startResize(e, windowId, dir) {
  if (state.isMobile) return;
  e.preventDefault();
  e.stopPropagation();

  const win = state.windows.get(windowId);
  if (!win) return;

  const el = win.el;
  const rect = el.getBoundingClientRect();

  state.resizeState = {
    windowId, dir,
    startX: e.clientX,
    startY: e.clientY,
    origLeft: parseInt(el.style.left),
    origTop: parseInt(el.style.top),
    origW: rect.width,
    origH: rect.height,
  };

  const minW = 340;
  const minH = 260;

  const onMove = (ev) => {
    const rs = state.resizeState;
    const dx = ev.clientX - rs.startX;
    const dy = ev.clientY - rs.startY;
    let newW = rs.origW, newH = rs.origH, newL = rs.origLeft, newT = rs.origTop;

    if (dir.includes('e')) newW = Math.max(minW, rs.origW + dx);
    if (dir.includes('w')) { newW = Math.max(minW, rs.origW - dx); newL = rs.origLeft + (rs.origW - newW); }
    if (dir.includes('s')) newH = Math.max(minH, rs.origH + dy);
    if (dir.includes('n')) { newH = Math.max(minH, rs.origH - dy); newT = rs.origTop + (rs.origH - newH); }

    el.style.width = newW + 'px';
    el.style.height = newH + 'px';
    el.style.left = newL + 'px';
    el.style.top = newT + 'px';
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    state.resizeState = null;
    saveWindowSize(windowId, parseInt(el.style.width), parseInt(el.style.height));
    saveWindowPos(windowId, parseInt(el.style.left), parseInt(el.style.top));
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  focusWindow(windowId);
}


/* ═══════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════ */
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+1-5 to open/focus windows
    if (e.ctrlKey && e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      const ids = ['activity', 'agents', 'inbox', 'atlas-chat', 'tasks'];
      const idx = parseInt(e.key) - 1;
      if (ids[idx]) openWindow(ids[idx]);
    }
    // Escape: dismiss overlays first, then close focused window
    if (e.key === 'Escape') {
      // Task detail overlay takes priority
      const taskOverlay = document.getElementById('taskDetailOverlay');
      if (taskOverlay && taskOverlay.style.display !== 'none') return; // handled by initTaskDetailClose
      // Then close focused window
      if (state.focusedWindow) closeWindow(state.focusedWindow);
    }
  });
}


/* ═══════════════════════════════════════════════════
   TASKBAR
   ═══════════════════════════════════════════════════ */
function initTaskbar() {
  document.getElementById('menuBtn').addEventListener('click', (e) => {
    // Toggle launcher menu
    let launcher = document.getElementById('appLauncher');
    if (launcher) {
      launcher.remove();
      return;
    }
    launcher = document.createElement('div');
    launcher.id = 'appLauncher';
    launcher.className = 'app-launcher';
    launcher.innerHTML = Object.entries(WINDOW_DEFS).map(([id, def]) => {
      const isOpen = state.windows.has(id);
      return `<button class="app-launcher-btn${isOpen ? ' launcher-open' : ''}" data-launch="${id}">
        <span class="launcher-icon">${def.icon}</span>
        <span class="launcher-label">${def.title}</span>
      </button>`;
    }).join('');
    document.body.appendChild(launcher);
    launcher.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-launch]');
      if (btn) {
        openWindow(btn.dataset.launch);
        launcher.remove();
      }
    });
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function close(ev) {
        if (!launcher.contains(ev.target) && ev.target !== e.target.closest('.taskbar-menu-btn')) {
          launcher.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 10);
  });

  // Sound toggle on agent tray click
  document.getElementById('trayAgents').addEventListener('click', () => {
    openWindow('agents');
  });

  document.getElementById('trayNotifications').addEventListener('click', () => {
    // Toggle sound and open inbox
    state.soundEnabled = !state.soundEnabled;
    openWindow('inbox');
    if (state.soundEnabled) soundNotify();
  });
}

function updateTaskbarWindows() {
  const container = document.getElementById('taskbarWindows');
  container.innerHTML = '';

  state.windows.forEach((win, id) => {
    const isMin = win.el.classList.contains('window-minimized');
    const tab = document.createElement('button');
    tab.className = 'taskbar-window-tab' +
      (id === state.focusedWindow && !isMin ? ' tab-active' : '') +
      (isMin ? ' tab-minimized' : '');
    tab.innerHTML = `
      <span class="tab-icon">${win.config.icon}</span>
      <span class="tab-label">${win.config.title}</span>
    `;
    tab.addEventListener('click', () => {
      if (win.el.classList.contains('window-minimized')) {
        win.el.classList.remove('window-minimized');
        focusWindow(id);
      } else if (state.focusedWindow === id) {
        minimizeWindow(id);
      } else {
        focusWindow(id);
      }
    });
    container.appendChild(tab);
  });
}


/* ═══════════════════════════════════════════════════
   SYSTEM TRAY
   ═══════════════════════════════════════════════════ */
function updateTray() {
  const agentCount = document.getElementById('agentCount');
  const notifCount = document.getElementById('notifCount');

  if (agentCount) agentCount.textContent = state.agents.length;

  const pendingInbox = state.inbox.filter(i => i.status === 'pending').length;
  if (notifCount) notifCount.textContent = pendingInbox;

  // Pulse notification bell if there are pending items
  const bell = document.querySelector('.tray-bell');
  if (bell) {
    bell.style.animation = pendingInbox > 0 ? 'trayPulse 1s ease-in-out infinite' : 'none';
  }

  updateMobileNavBadge();
}

function initClock() {
  function update() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const clockTime = document.getElementById('clockTime');
    const clockDate = document.getElementById('clockDate');
    if (clockTime) clockTime.textContent = time;
    if (clockDate) clockDate.textContent = date;
  }
  update();
  setInterval(update, 10000);
}


/* ═══════════════════════════════════════════════════
   RENDER: AGENTS
   ═══════════════════════════════════════════════════ */
function renderAgents() {
  const grid = document.getElementById('agentsGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const domainOrder = { system: 0, trading: 1, work: 2, life: 3 };
  const sorted = [...state.agents].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    const da = domainOrder[a.domain] ?? 9;
    const db = domainOrder[b.domain] ?? 9;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach((agent, i) => {
    const agentGlyph = GLYPH_MAP[agent.name] || '●';

    // Use row layout for density — glyph, name, status, task, domain
    const card = document.createElement('div');
    card.className = state.isMobile ? 'agent-card' : 'agent-card-row';
    card.style.setProperty('--agent-color', agent.signature_color);
    card.style.setProperty('--card-delay', (i * 40) + 'ms');

    if (state.isMobile) {
      // Grid card layout for mobile
      card.innerHTML = `
        <div class="agent-glyph">${agentGlyph}</div>
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-domain">${agent.domain.toUpperCase()}</div>
        <div class="agent-status">
          <span class="agent-status-dot status-${agent.status || 'idle'}"></span>
          <span>${agent.status || 'idle'}</span>
        </div>
        ${agent.current_task ? `<div class="agent-task" title="${escapeHtml(agent.current_task)}">${escapeHtml(agent.current_task)}</div>` : ''}
      `;
    } else {
      // Dense row layout for desktop
      card.innerHTML = `
        <div class="agent-glyph">${agentGlyph}</div>
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-status">
          <span class="agent-status-dot status-${agent.status || 'idle'}"></span>
          <span>${agent.status || 'idle'}</span>
        </div>
        ${agent.current_task ? `<div class="agent-task" title="${escapeHtml(agent.current_task)}">${escapeHtml(agent.current_task)}</div>` : '<div class="agent-task">—</div>'}
        <div class="agent-domain">${agent.domain.toUpperCase()}</div>
      `;
    }

    card.addEventListener('click', () => openAgentDetail(agent.name));
    grid.appendChild(card);
  });

  // Footer stats
  const active = state.agents.filter(a => a.status === 'active').length;
  const idle = state.agents.filter(a => a.status === 'idle').length;
  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  setEl('fleetActive', active);
  setEl('fleetIdle', idle);
  setEl('fleetTotal', state.agents.length);
}


/* ─── Parse activity body (may be JSON or plain text) ─── */
function parseActivityBody(body) {
  if (!body) return '';
  // Try to parse as JSON and extract readable fields
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      // Prefer summary, then description, then flatten top-level string values
      if (parsed.summary) return parsed.summary;
      if (parsed.description) return parsed.description;
      if (parsed.message) return parsed.message;
      if (parsed.text) return parsed.text;
      // Fallback: join all string values
      const parts = Object.entries(parsed)
        .filter(([, v]) => typeof v === 'string')
        .map(([, v]) => v);
      return parts.join(' — ') || body;
    }
  } catch {
    // Not JSON — return as-is
  }
  return body;
}

/* ─── Try to parse body as structured JSON ─── */
function tryParseJSON(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {}
  return null;
}

/* ─── Format full timestamp for expanded view ─── */
function formatTimeFull(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

/* ─── Render Viper scan findings ─── */
function renderViperFindings(data) {
  const tickers = data.tickers || data.findings || data.results || [];
  if (!Array.isArray(tickers) || tickers.length === 0) return '';

  const items = tickers.map(t => {
    const ticker = t.ticker || t.symbol || '';
    const sentiment = (t.sentiment || 'neutral').toLowerCase();
    const sentimentClass = sentiment.includes('bull') ? 'bullish' : sentiment.includes('bear') ? 'bearish' : 'neutral';
    const mentions = t.mentions || t.mention_count || '';
    const take = t.viper_take || t.take || t.analysis || '';
    const ddLink = t.top_dd_link || t.dd_link || t.link || '';

    return `
      <div class="viper-finding">
        <div class="viper-finding-header">
          <span class="viper-ticker">${escapeHtml(ticker)}</span>
          <span class="viper-sentiment ${sentimentClass}">${escapeHtml(sentiment)}</span>
          ${mentions ? `<span class="viper-mentions">${escapeHtml(String(mentions))} mentions</span>` : ''}
        </div>
        ${take ? `<div class="viper-take">${escapeHtml(take)}</div>` : ''}
        ${ddLink ? `<a class="viper-dd-link" href="${escapeHtml(ddLink)}" target="_blank" rel="noopener">Top DD ↗</a>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="activity-detail-section">
      <div class="activity-detail-section-title">Ticker Findings</div>
      ${items}
    </div>
  `;
}

/* ─── Render task completion details ─── */
function renderTaskDetails(data) {
  const rows = [];

  if (data.changed || data.what_changed || data.changes) {
    rows.push(`<div class="task-detail-row">
      <span class="task-detail-label">Changed</span>
      <span class="task-detail-value">${escapeHtml(data.changed || data.what_changed || data.changes)}</span>
    </div>`);
  }

  if (data.files || data.files_touched) {
    const files = data.files || data.files_touched;
    const fileList = Array.isArray(files) ? files : [files];
    rows.push(`<div class="task-detail-row">
      <span class="task-detail-label">Files</span>
      <div class="task-detail-files">${fileList.map(f => `<span class="task-detail-file">${escapeHtml(f)}</span>`).join('')}</div>
    </div>`);
  }

  if (data.commit || data.commit_sha || data.commit_hash) {
    const sha = data.commit || data.commit_sha || data.commit_hash;
    rows.push(`<div class="task-detail-row">
      <span class="task-detail-label">Commit</span>
      <span class="task-detail-value" style="font-family:var(--font-mono);font-size:11px;">${escapeHtml(sha)}</span>
    </div>`);
  }

  if (data.commit_message || data.message) {
    rows.push(`<div class="task-detail-row">
      <span class="task-detail-label">Msg</span>
      <span class="task-detail-value">${escapeHtml(data.commit_message || data.message)}</span>
    </div>`);
  }

  if (data.result || data.outcome) {
    rows.push(`<div class="task-detail-row">
      <span class="task-detail-label">Result</span>
      <span class="task-detail-value">${escapeHtml(data.result || data.outcome)}</span>
    </div>`);
  }

  if (rows.length === 0) return '';
  return `<div class="activity-detail-section">
    <div class="activity-detail-section-title">Task Details</div>
    ${rows.join('')}
  </div>`;
}

/* ─── Render generic key-value pairs from structured JSON ─── */
function renderGenericKV(data, excludeKeys) {
  const exclude = new Set(excludeKeys || [
    'summary', 'description', 'message', 'text',
    'tickers', 'findings', 'results',
    'changed', 'what_changed', 'changes',
    'files', 'files_touched',
    'commit', 'commit_sha', 'commit_hash', 'commit_message',
    'result', 'outcome',
  ]);

  const entries = Object.entries(data).filter(([k, v]) => {
    if (exclude.has(k)) return false;
    if (v === null || v === undefined) return false;
    if (typeof v === 'object') return false; // skip nested objects in KV view
    return true;
  });

  if (entries.length === 0) return '';

  const rows = entries.map(([k, v]) => {
    const label = k.replace(/_/g, ' ');
    return `<span class="activity-detail-kv-key">${escapeHtml(label)}</span>
            <span class="activity-detail-kv-value">${escapeHtml(String(v))}</span>`;
  }).join('');

  return `<div class="activity-detail-kv">${rows}</div>`;
}

/* ─── Build expanded detail HTML for an activity item ─── */
function buildActivityDetail(item) {
  const agent = state.agents.find(a => a.name === item.agent_name);
  const color = agent?.signature_color || 'var(--os-text-muted)';
  const fullTime = formatTimeFull(item.created_at);
  const parsed = tryParseJSON(item.body);

  // Type badge
  const typeBadge = `<span class="activity-detail-badge" data-type="${escapeHtml(item.type || '')}">${escapeHtml(item.type || 'activity')}</span>`;
  const agentLabel = `<span class="activity-detail-agent" style="color:${color}">${escapeHtml(item.agent_name)}</span>`;
  const domainLabel = `<span class="activity-detail-domain">${escapeHtml(item.domain || '')}</span>`;
  const timeLabel = `<span class="activity-detail-time">${escapeHtml(fullTime)}</span>`;

  let detailSections = '';

  // Full body (untruncated) — show if it's plain text
  if (item.body && !parsed) {
    detailSections += `<div class="activity-detail-body">${escapeHtml(item.body)}</div>`;
  }

  // Structured data rendering
  if (parsed) {
    // Show summary/description if present, as full body
    const textContent = parsed.summary || parsed.description || parsed.message || parsed.text || '';
    if (textContent) {
      detailSections += `<div class="activity-detail-body">${escapeHtml(textContent)}</div>`;
    }

    // Viper scan findings
    const isViperScan = item.type === 'scan' || item.agent_name === 'viper' ||
      parsed.tickers || parsed.findings;
    if (isViperScan) {
      detailSections += renderViperFindings(parsed);
    }

    // Task completion details
    const isTaskComplete = item.type === 'task_complete' || parsed.files || parsed.commit || parsed.changed;
    if (isTaskComplete) {
      detailSections += renderTaskDetails(parsed);
    }

    // Any remaining key-value pairs
    detailSections += renderGenericKV(parsed);
  }

  return `
    <div class="activity-detail-content">
      <div class="activity-detail-header">
        ${typeBadge}
        ${agentLabel}
        ${domainLabel}
        ${timeLabel}
      </div>
      ${detailSections}
    </div>
  `;
}


/* ═══════════════════════════════════════════════════
   RENDER: ACTIVITY
   ═══════════════════════════════════════════════════ */
function renderActivity(filter = 'all') {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  const items = filter === 'all'
    ? state.activity
    : state.activity.filter(a => a.domain === filter);

  if (items.length === 0) {
    feed.innerHTML = `
      <div class="activity-empty">
        <div class="empty-glyph">◌</div>
        <p>No activity yet. Agents are standing by.</p>
        <p style="font-size:11px;color:var(--os-text-whisper);margin-top:4px;">Activity will appear here as agents complete tasks.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = '';
  items.forEach((item, i) => {
    const agent = state.agents.find(a => a.name === item.agent_name);
    const color = agent?.signature_color || 'var(--os-text-muted)';
    const glyph = GLYPH_MAP[item.agent_name] || '●';
    const time = formatTime(item.created_at);

    const el = document.createElement('div');
    el.className = 'activity-item';
    el.style.setProperty('--item-color', color);
    el.style.animationDelay = (i * 50) + 'ms';
    if (item.priority) el.dataset.priority = item.priority;

    const bodyText = parseActivityBody(item.body);

    el.innerHTML = `
      <div class="activity-item-glyph">${glyph}</div>
      <div class="activity-item-content">
        <div class="activity-item-title">${escapeHtml(item.title)}</div>
        ${bodyText ? `<div class="activity-item-body">${escapeHtml(bodyText)}</div>` : ''}
        <div class="activity-item-meta">
          <span class="activity-item-agent">${escapeHtml(item.agent_name)}</span>
          <span class="activity-item-time">${time}</span>
        </div>
        <div class="activity-item-detail">
          <div class="activity-item-detail-inner"></div>
        </div>
      </div>
      <div class="activity-item-expand-icon">▸</div>
    `;

    // Click to expand/collapse
    el.addEventListener('click', (e) => {
      // Don't toggle if user is selecting text or clicking a link
      if (e.target.closest('a')) return;
      if (window.getSelection().toString().length > 0) return;

      const isExpanded = el.classList.contains('expanded');
      if (isExpanded) {
        el.classList.remove('expanded');
      } else {
        // Lazy-render detail content on first expand
        const inner = el.querySelector('.activity-item-detail-inner');
        if (!inner.dataset.rendered) {
          inner.innerHTML = buildActivityDetail(item);
          inner.dataset.rendered = '1';
        }
        el.classList.add('expanded');
      }
      soundClick();
    });

    feed.appendChild(el);
  });
}

// Wire up filter buttons (delegated)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  const toolbar = btn.closest('.activity-toolbar');
  if (!toolbar) return;
  toolbar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderActivity(btn.dataset.filter);
});


/* ═══════════════════════════════════════════════════
   RENDER: INBOX
   ═══════════════════════════════════════════════════ */
function renderInbox(statusFilter = 'pending') {
  const list = document.getElementById('inboxList');
  if (!list) return;

  const items = statusFilter === 'all'
    ? state.inbox
    : state.inbox.filter(i => i.status === statusFilter);

  if (items.length === 0) {
    list.innerHTML = `
      <div class="inbox-empty">
        <div class="empty-glyph">◻</div>
        <p>${statusFilter === 'pending' ? 'Inbox clear. No decisions needed.' : 'No items.'}</p>
      </div>
    `;
    const cnt = document.getElementById('inboxPendingCount');
    if (cnt) cnt.textContent = '0 items';
    return;
  }

  list.innerHTML = '';
  items.forEach((item, i) => {
    const agent = state.agents.find(a => a.name === item.agent_name);
    const glyph = GLYPH_MAP[item.agent_name] || '●';
    const time = formatTime(item.created_at);
    let actions = [];
    try { actions = JSON.parse(item.actions || '[]'); } catch { actions = []; }

    const el = document.createElement('div');
    el.className = 'inbox-item' + (item.status !== 'pending' ? ' resolved' : '');
    el.style.animationDelay = (i * 60) + 'ms';

    el.innerHTML = `
      <div class="inbox-item-header">
        <div class="inbox-item-glyph">${glyph}</div>
        <div class="inbox-item-info">
          <div class="inbox-item-title">${escapeHtml(item.title)}</div>
          ${item.body ? `<div class="inbox-item-body">${escapeHtml(item.body)}</div>` : ''}
          <div class="inbox-item-meta">
            <span class="inbox-item-priority" data-priority="${item.priority || 'normal'}">${item.priority || 'normal'}</span>
            <span>${escapeHtml(item.agent_name)}</span>
            <span>${time}</span>
          </div>
        </div>
      </div>
      ${item.status === 'pending' ? `
        <div class="inbox-item-actions">
          ${actions.length > 0 ? actions.map(a =>
            `<button class="inbox-action-btn ${a === 'approve' ? 'action-primary' : a === 'reject' ? 'action-danger' : ''}"
              data-item-id="${item.id}" data-action="${escapeHtml(a)}">${escapeHtml(a)}</button>`
          ).join('') : `
            <button class="inbox-action-btn action-primary" data-item-id="${item.id}" data-action="approve">Approve</button>
            <button class="inbox-action-btn" data-item-id="${item.id}" data-action="snooze">Snooze</button>
            <button class="inbox-action-btn action-danger" data-item-id="${item.id}" data-action="reject">Dismiss</button>
          `}
        </div>
      ` : ''}
    `;

    list.appendChild(el);
  });

  const pending = state.inbox.filter(i => i.status === 'pending').length;
  const cnt = document.getElementById('inboxPendingCount');
  if (cnt) cnt.textContent = pending + ' item' + (pending !== 1 ? 's' : '');
}

// Inbox action buttons (delegated)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.inbox-action-btn');
  if (!btn) return;
  const itemId = btn.dataset.itemId;
  const action = btn.dataset.action;
  if (itemId && action) {
    btn.disabled = true;
    btn.textContent = '...';
    postInboxAction(itemId, action);
  }
});

// Inbox tabs (delegated)
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.inbox-tab');
  if (!tab) return;
  const header = tab.closest('.inbox-header');
  if (!header) return;
  header.querySelectorAll('.inbox-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  renderInbox(tab.dataset.status);
});


/* ═══════════════════════════════════════════════════
   TRADING DESK
   ═══════════════════════════════════════════════════ */

// ─── Live Price Fetcher ───
async function fetchLivePrices(tickers) {
  if (!tickers || tickers.length === 0) return {};
  try {
    const symbols = tickers.join(',');
    const resp = await fetch(`${API_BASE}/prices?symbols=${encodeURIComponent(symbols)}`);
    if (!resp.ok) return {};
    const result = await resp.json();
    return result.data || {};
  } catch { return {}; }
}

function renderTradingDesk(regime, plays, portfolio, positions, closedPositions, brief, regimeHistory, widgets) {
  const container = document.getElementById('tradingMain');
  if (!container) return;

  const marketOpen = isMarketHours();
  const liveIndicator = marketOpen
    ? '<span class="live-dot"></span> LIVE'
    : 'CLOSED';

  const openPositions = Array.isArray(positions) ? positions : (portfolio?.positions || []);

  // Separate stock plays from options plays
  const allPlays = Array.isArray(plays) ? plays : [];
  const stockPlays = allPlays.filter(p => p.vehicle === 'shares');
  const optionPlays = allPlays.filter(p => p.vehicle === 'calls' || p.vehicle === 'puts');

  const regimeSignal = (regime?.signal || '').toUpperCase();
  const suppressed = regimeSignal === 'RED';

  // Parse brief data (structured JSON or fallback to raw text)
  let briefData = null;
  let briefRaw = '';
  try {
    if (brief?.body && typeof brief.body === 'string') {
      if (brief.body.trim().startsWith('{')) {
        briefData = JSON.parse(brief.body);
      } else {
        briefRaw = brief.body;
      }
    }
  } catch { briefRaw = brief?.body || ''; }

  const html = `
    <div class="trading-status-bar">
      <span class="trading-market-status ${marketOpen ? 'market-open' : 'market-closed'}">${liveIndicator}</span>
      <span class="trading-refresh-rate">${marketOpen ? 'Refreshing every 60s' : 'Refreshing every 5m'}</span>
    </div>
    ${buildRegimeBanner(regime)}
    ${buildRegimeStrip(Array.isArray(regimeHistory) ? regimeHistory : [])}
    ${buildPortfolioOverview(portfolio, openPositions, optionPlays, widgets?.fear_greed)}
    <div class="td-sections ${suppressed ? 'td-suppressed' : ''}">
      ${buildStockPicks(stockPlays, suppressed, widgets?.sparklines, openPositions)}
      ${buildOptionPlays(optionPlays, openPositions)}
    </div>
    <details class="td-collapsible">
      <summary class="td-collapsible-toggle">More ▸</summary>
      <div class="td-collapsible-content">
        ${buildTradeHistory(Array.isArray(closedPositions) ? closedPositions : [])}
        <div class="td-widget-row">
          ${buildSectorHeatmap(widgets?.sectors)}
          ${buildCalendarWidget(widgets?.econ_calendar, widgets?.earnings)}
        </div>
      </div>
    </details>
    ${briefData ? buildStructuredBrief(briefData) : (briefRaw ? buildBriefSection(briefRaw) : '')}
  `;

  // Morph the DOM — only patches what changed, no blink, preserves state
  morphInto(container, html);

  // ── Option DD panel — click-to-expand event delegation ──
  // Only attach once — use a flag to prevent duplicate listeners
  if (!container._ddListenerAttached) {
  container._ddListenerAttached = true;
  container.addEventListener('click', (e) => {
    const row = e.target.closest('.td-option-pos-row');
    if (!row) return;
    const posId = row.dataset.posId;
    if (!posId) return;
    const panel = document.getElementById('dd-' + posId);
    if (!panel) return;

    const isOpen = panel.classList.contains('dd-open');

    // Close any open panels
    container.querySelectorAll('.td-option-dd-panel.dd-open').forEach(p => {
      p.classList.remove('dd-open');
    });
    container.querySelectorAll('.td-option-pos-row.dd-active').forEach(r => {
      r.classList.remove('dd-active');
    });

    if (!isOpen) {
      panel.classList.add('dd-open');
      row.classList.add('dd-active');
    }
  });
  } // end _ddListenerAttached guard

  // Fetch live prices and update stock picks
  const stockTickers = stockPlays.map(p => p.ticker).filter(t => t && t !== '—');
  if (stockTickers.length > 0) {
    fetchLivePrices(stockTickers).then(prices => {
      if (Object.keys(prices).length === 0) return;
      
      // Update each stock row with live data
      const rows = container.querySelectorAll('.td-stock-row');
      rows.forEach(row => {
        const tickerEl = row.querySelector('.td-stock-ticker');
        if (!tickerEl) return;
        const ticker = tickerEl.textContent.trim();
        const liveData = prices[ticker];
        if (!liveData || !liveData.price) return;
        
        // Update price column
        const priceEl = row.querySelector('.td-stock-price');
        if (priceEl) priceEl.textContent = '$' + liveData.price.toFixed(2);
        
        // Add/update change pill
        const existingPill = row.querySelector('.td-change-pill');
        const sign = liveData.changePct >= 0 ? '+' : '';
        const pillCls = liveData.changePct >= 0 ? 'td-change-up' : 'td-change-down';
        const pillHTML = `<span class="td-change-pill ${pillCls}">${sign}${liveData.changePct.toFixed(1)}%</span>`;
        
        if (existingPill) {
          existingPill.outerHTML = pillHTML;
        } else {
          // Insert after ticker
          tickerEl.insertAdjacentHTML('afterend', pillHTML);
        }
        
        // Update P&L if we have entry price
        const entryEl = row.querySelector('.td-stock-entry');
        const qtyEl = row.querySelector('.td-stock-qty');
        if (entryEl && qtyEl) {
          const entryText = entryEl.textContent.trim();
          const qtyText = qtyEl.textContent.trim();
          if (entryText !== '—' && qtyText !== '—') {
            const entryPrice = parseFloat(entryText.replace('$', ''));
            const qty = parseFloat(qtyText);
            if (entryPrice > 0 && qty > 0) {
              const pnl = (liveData.price - entryPrice) * qty;
              const pnlPct = ((liveData.price - entryPrice) / entryPrice) * 100;
              const pnlColor = pnl >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';
              // Add P&L display after qty
              const existingPnl = row.querySelector('.td-stock-pnl');
              const pnlHTML = `<span class="td-stock-pnl" style="color:${pnlColor};font-family:'JetBrains Mono',monospace;font-size:0.7rem">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)</span>`;
              if (existingPnl) {
                existingPnl.outerHTML = pnlHTML;
              } else {
                qtyEl.insertAdjacentHTML('afterend', pnlHTML);
              }
            }
          }
        }
      });
      
      // Update portfolio with total unrealized P&L
      const totalUnrealized = stockTickers.reduce((sum, ticker) => {
        const liveData = prices[ticker];
        if (!liveData) return sum;
        const posMatch = (openPositions || []).find(p => p.ticker === ticker && p.vehicle === 'shares');
        if (!posMatch) return sum;
        return sum + (liveData.price - (posMatch.entry_price || 0)) * (posMatch.quantity || 0);
      }, 0);
      
      if (totalUnrealized !== 0) {
        const pnlEl = container.querySelector('.td-pstat-val');
        if (pnlEl) {
          const color = totalUnrealized >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';
          pnlEl.style.color = color;
          pnlEl.textContent = `$${totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(0)}`;
        }
      }

      // Add "prices as of" timestamp
      const stockSection = container.querySelector('.td-section');
      if (stockSection) {
        const sectionHeader = stockSection.querySelector('.td-section-header');
        if (sectionHeader && !sectionHeader.querySelector('.td-prices-timestamp')) {
          const now = new Date();
          const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          const timestampHTML = `<span class="td-prices-timestamp" style="font-size:0.65rem;color:rgba(255,255,255,0.3);margin-left:8px">Live prices as of ${timeStr}</span>`;
          sectionHeader.insertAdjacentHTML('beforeend', timestampHTML);
        }
      }
    });
  }
}

function buildProductionCard(data) {
  if (!data) {
    const shiftActive = isShiftHours();
    const shiftIndicator = shiftActive
      ? '<span class="live-dot production-live-dot"></span> ON SHIFT'
      : 'OFF SHIFT';
    const shiftClass = shiftActive ? 'shift-active' : 'shift-closed';
    return `
      <div class="trading-card production-card">
        <div class="trading-card-header">
          <span class="trading-card-title">Production</span>
          <span class="production-shift-status ${shiftClass}">${shiftIndicator}</span>
        </div>
        <div class="trading-card-body">
          <div class="production-off-shift">
            <div class="empty-glyph">◻</div>
            <p>No active production session.</p>
            <p class="production-off-shift-sub">${shiftActive ? 'Waiting for data...' : 'Floor is closed. Check back during shift hours.'}</p>
          </div>
        </div>
      </div>
    `;
  }

  const shiftActive = isShiftHours();
  const shiftIndicator = shiftActive
    ? '<span class="live-dot production-live-dot"></span> LIVE'
    : 'CLOSED';
  const shiftClass = shiftActive ? 'shift-active' : 'shift-closed';

  const todayLbs = data.todayLbs || 0;
  const todayTarget = data.todayTarget || 0;
  const todayPct = data.todayPercentage || 0;
  const strain = data.strain || '';
  const targetRate = data.targetRate || 0;
  const streak = data.streak || 0;
  const lastHourTrimmers = data.lastHourTrimmers || 0;
  const lastHourBuckers = data.lastHourBuckers || 0;
  const lastHourLbs = data.lastHourLbs || 0;
  const lastTimeSlot = data.lastTimeSlot || '';
  const hourlyRates = Array.isArray(data.hourlyRates) ? data.hourlyRates : [];

  // Percentage color
  const pctColor = todayPct >= 100 ? 'var(--sig-green, #22c55e)' : todayPct >= 80 ? '#eab308' : 'var(--sig-red, #ef4444)';
  const pctClass = todayPct >= 100 ? 'prod-green' : todayPct >= 80 ? 'prod-yellow' : 'prod-red';

  // Progress bar (can exceed 100%)
  const barPct = Math.min(todayPct, 150); // cap visual at 150%
  const barWidth = (barPct / 150 * 100).toFixed(1);

  // Hourly breakdown rows
  const hourlyHtml = hourlyRates.map(h => {
    const slotShort = (h.timeSlot || '').replace(/ (AM|PM)/g, '$1').replace(' – ', '–');
    const totalLbs = h.totalLbs || 0;
    const rate = h.rate || 0;
    const target = h.target || 0;
    const trimmers = h.trimmers || 0;
    const buckers = h.buckers || 0;
    const hPct = target > 0 ? ((rate / target) * 100) : 0;
    const hColor = hPct >= 100 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';
    const hBarW = Math.min(hPct, 150);
    const hBarWidth = (hBarW / 150 * 100).toFixed(1);
    return `
      <div class="prod-hourly-row">
        <span class="prod-hourly-slot">${escapeHtml(slotShort)}</span>
        <span class="prod-hourly-lbs">${totalLbs.toFixed(1)}</span>
        <span class="prod-hourly-crew">${trimmers}T/${buckers}B</span>
        <div class="prod-hourly-bar-wrap">
          <div class="prod-hourly-bar" style="width:${hBarWidth}%;background:${hColor}"></div>
        </div>
        <span class="prod-hourly-pct" style="color:${hColor}">${hPct.toFixed(0)}%</span>
      </div>
    `;
  }).join('');

  return `
    <div class="trading-card production-card">
      <div class="trading-card-header">
        <span class="trading-card-title">Production</span>
        <div class="production-header-right">
          <span class="production-shift-status ${shiftClass}">${shiftIndicator}</span>
          ${strain ? `<span class="production-strain">${escapeHtml(strain)}</span>` : ''}
        </div>
      </div>
      <div class="trading-card-body">
        <div class="production-stats">
          <div class="portfolio-stat production-hero-stat">
            <span class="portfolio-stat-label">Today</span>
            <span class="portfolio-stat-value production-hero-value">${todayLbs.toFixed(1)} lbs</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Target</span>
            <span class="portfolio-stat-value">${todayTarget.toFixed(1)} lbs</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Percentage</span>
            <span class="portfolio-stat-value" style="color:${pctColor}">${todayPct.toFixed(1)}%</span>
          </div>
        </div>

        <div class="production-progress-wrap">
          <div class="production-progress-bar">
            <div class="production-progress-fill ${pctClass}" style="width:${barWidth}%"></div>
          </div>
          <span class="production-progress-label" style="color:${pctColor}">${todayPct.toFixed(1)}%</span>
        </div>

        <div class="production-crew-stats">
          <div class="production-crew-row">
            <span class="production-crew-label">Last Hour</span>
            <span class="production-crew-value">${lastHourTrimmers}T / ${lastHourBuckers}B · ${lastHourLbs.toFixed(1)} lbs</span>
            ${lastTimeSlot ? `<span class="production-crew-slot">${escapeHtml(lastTimeSlot)}</span>` : ''}
          </div>
          <div class="production-crew-row">
            <span class="production-crew-label">Rate</span>
            <span class="production-crew-value">${targetRate.toFixed(2)} lbs/hr per trimmer</span>
          </div>
          <div class="production-crew-row">
            <span class="production-crew-label">Streak</span>
            <span class="production-crew-value">${streak} day${streak !== 1 ? 's' : ''} above target</span>
          </div>
        </div>

        ${hourlyRates.length > 0 ? `
          <div class="production-hourly">
            <div class="production-hourly-title">Hourly Breakdown</div>
            <div class="production-hourly-list">
              ${hourlyHtml}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}


// ─── Trading Desk: Regime Banner ───
function buildRegimeBanner(data) {
  if (!data) {
    return `<div class="td-regime td-regime-neutral"><span class="td-regime-signal">—</span><span class="td-regime-label">No regime data</span></div>`;
  }

  const signal = (data.signal || 'NEUTRAL').toUpperCase();
  const cls = signal === 'GREEN' ? 'td-regime-green' : signal === 'YELLOW' ? 'td-regime-yellow' : signal === 'RED' ? 'td-regime-red' : 'td-regime-neutral';
  const label = data.label || '';

  let rawData = data.data || {};
  if (typeof rawData === 'string') try { rawData = JSON.parse(rawData); } catch { rawData = {}; }
  let strategy = data.strategy || {};
  if (typeof strategy === 'string') try { strategy = JSON.parse(strategy); } catch { strategy = {}; }
  let reasoning = data.reasoning || [];
  if (typeof reasoning === 'string') try { reasoning = JSON.parse(reasoning); } catch { reasoning = []; }

  const spy = rawData.spy_price || '—';
  const vix = rawData.vix || '—';
  const y10 = rawData.yield_10y || '—';
  const sizing = strategy.position_sizing || '';

  return `
    <div class="td-regime ${cls}" ${sizing ? `title="${escapeHTML(sizing)}"` : ''}>
      <span class="td-regime-signal">${signal}</span>
      <span class="td-regime-label">${escapeHTML(label)}</span>
      <div class="td-regime-stats">
        <span class="td-regime-stat-inline">SPY ${spy}</span>
        <span class="td-regime-stat-inline">VIX ${vix}</span>
        <span class="td-regime-stat-inline">10Y ${y10}</span>
      </div>
    </div>
  `;
}

// ─── Trading Desk: Portfolio Overview ───
function buildPortfolioOverview(portfolio, openPositions, optionPlays, fearGreedData) {
  if (!portfolio) return '';

  const pv = portfolio.portfolio_value || portfolio.starting_bankroll || 10000;
  const start = portfolio.starting_bankroll || 10000;
  const realized = portfolio.realized_pnl || 0;
  const unrealized = portfolio.unrealized_pnl || 0;
  const totalPnl = realized + unrealized;
  const pnlPct = start > 0 ? ((pv / start - 1) * 100) : 0;
  const pnlColor = totalPnl >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';

  const exposure = portfolio.open_exposure || 0;
  const bankroll = portfolio.available_bankroll || pv;
  const openCount = portfolio.open_positions || 0;
  const closedCount = portfolio.closed_trades || 0;
  const winRate = portfolio.win_rate || 0;
  const wins = portfolio.wins || 0;
  const losses = portfolio.losses || 0;

  // Calculate allocation bars (use current_price if available, fall back to entry_price)
  const stockExposure = (openPositions || []).filter(p => p.vehicle === 'shares').reduce((s, p) => s + (p.current_price || p.entry_price || 0) * (p.quantity || 0), 0);
  const optionExposure = (openPositions || []).filter(p => p.vehicle === 'calls' || p.vehicle === 'puts').reduce((s, p) => s + (p.current_price || p.entry_price || 0) * (p.quantity || 0) * 100, 0);
  const cashAmount = Math.max(0, pv - stockExposure - optionExposure);

  const stockPct = pv > 0 ? (stockExposure / pv * 100) : 0;
  const optionPct = pv > 0 ? (optionExposure / pv * 100) : 0;
  const cashPct = pv > 0 ? (cashAmount / pv * 100) : 0;

  // Fear & Greed badge
  let fgBadge = '';
  if (fearGreedData) {
    const score = fearGreedData.score || 50;
    const label = fearGreedData.label || 'Neutral';
    let fgColor;
    if (score >= 75) fgColor = '#22c55e';
    else if (score >= 55) fgColor = '#86efac';
    else if (score >= 45) fgColor = '#eab308';
    else if (score >= 25) fgColor = '#f97316';
    else fgColor = '#ef4444';
    fgBadge = `<span class="td-fg-badge" style="color:${fgColor}">F&G: ${score} ${label}</span>`;
  }

  return `
    <div class="td-portfolio">
      <div class="td-portfolio-header">
        <span class="td-portfolio-title">PORTFOLIO</span>
        <div class="td-portfolio-value">
          <span class="td-portfolio-amount">$${pv.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
          <span class="td-portfolio-pnl" style="color:${pnlColor}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</span>
          ${fgBadge}
        </div>
      </div>
      <div class="td-portfolio-alloc">
        ${stockExposure > 0 || optionExposure > 0 ? `
        <div class="td-alloc-row">
          <span class="td-alloc-label">Stocks</span>
          <div class="td-alloc-bar-wrap"><div class="td-alloc-bar td-alloc-stocks" style="width:${Math.max(stockPct > 0 ? 3 : 0, Math.min(stockPct, 100))}%"></div></div>
          <span class="td-alloc-val">$${Math.round(stockExposure).toLocaleString()} <span class="td-alloc-pct">${stockPct.toFixed(0)}%</span></span>
        </div>
        <div class="td-alloc-row">
          <span class="td-alloc-label">Options</span>
          <div class="td-alloc-bar-wrap"><div class="td-alloc-bar td-alloc-options" style="width:${Math.max(optionPct > 0 ? 3 : 0, Math.min(optionPct, 100))}%"></div></div>
          <span class="td-alloc-val">$${Math.round(optionExposure).toLocaleString()} <span class="td-alloc-pct">${optionPct.toFixed(0)}%</span></span>
        </div>
        <div class="td-alloc-row">
          <span class="td-alloc-label">Cash</span>
          <div class="td-alloc-bar-wrap"><div class="td-alloc-bar td-alloc-cash" style="width:${Math.min(cashPct, 100)}%"></div></div>
          <span class="td-alloc-val">$${Math.round(cashAmount).toLocaleString()} <span class="td-alloc-pct">${cashPct.toFixed(0)}%</span></span>
        </div>
        ` : `
        <div class="td-alloc-empty">100% cash — no open positions</div>
        `}
      </div>
      <div class="td-portfolio-stats">
        <div class="td-pstat"><span class="td-pstat-val" style="color:${pnlColor}">$${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span><span class="td-pstat-label">P&L</span></div>
        <div class="td-pstat"><span class="td-pstat-val">${closedCount}</span><span class="td-pstat-label">Trades</span></div>
        <div class="td-pstat"><span class="td-pstat-val">${closedCount > 0 ? winRate.toFixed(0) + '%' : '—'}</span><span class="td-pstat-label">Win Rate</span></div>
        <div class="td-pstat"><span class="td-pstat-val">${wins}W/${losses}L</span><span class="td-pstat-label">Record</span></div>
      </div>
    </div>
  `;
}

// ─── Trading Desk: Stock Picks ───
function buildStockPicks(plays, suppressed, sparklines, positions) {
  if (!plays || plays.length === 0) return '';

  const sorted = [...plays].sort((a, b) => {
    const aSetup = typeof a.setup === 'string' ? JSON.parse(a.setup || '{}') : (a.setup || {});
    const bSetup = typeof b.setup === 'string' ? JSON.parse(b.setup || '{}') : (b.setup || {});
    return (bSetup.quant_score || 0) - (aSetup.quant_score || 0);
  });

  // Find max alpha score for bar scaling
  const allScores = sorted.map(p => {
    const s = typeof p.setup === 'string' ? JSON.parse(p.setup || '{}') : (p.setup || {});
    return Math.abs(s.quant_score || 0);
  });
  const maxScore = Math.max(...allScores, 0.01);

  const rows = sorted.map((play, idx) => {
    const setup = typeof play.setup === 'string' ? JSON.parse(play.setup || '{}') : (play.setup || {});
    const ticker = play.ticker || '—';
    const score = setup.quant_score || 0;
    const conviction = setup.conviction || play.risk_level || 'medium';
    const weight = setup.weight_pct || 0;
    const price = setup.entry_price || 0;
    const currentPrice = setup.current_price || play.current_price || 0;
    const convCls = conviction === 'high' ? 'td-conv-high' : conviction === 'low' ? 'td-conv-low' : 'td-conv-med';
    const convLabel = conviction.charAt(0).toUpperCase() + conviction.slice(1);
    // Top 3 get visual emphasis
    const rankCls = idx < 3 ? 'td-stock-top' : '';

    // Alpha bar width as percentage of max
    const barWidth = Math.round((Math.abs(score) / maxScore) * 100);

    // % change pill - only show if prices differ
    let changePill = '';
    if (currentPrice > 0 && price > 0 && currentPrice !== price) {
      const pctChange = ((currentPrice - price) / price) * 100;
      const sign = pctChange >= 0 ? '+' : '';
      const pillCls = pctChange >= 0 ? 'td-change-up' : 'td-change-down';
      changePill = `<span class="td-change-pill ${pillCls}">${sign}${pctChange.toFixed(1)}%</span>`;
    }

    // Look up position data for this ticker (stock positions only)
    const position = positions ? positions.find(p => p.ticker === ticker && p.vehicle === 'shares') : null;
    const entryPrice = position ? position.entry_price : 0;
    const qty = position ? position.quantity : 0;
    const entryDisplay = entryPrice > 0 ? `$${entryPrice.toFixed(2)}` : '—';
    const qtyDisplay = qty > 0 ? `${qty.toFixed(0)} sh` : '—';

    // Stop/target indicators (only on hover via title)
    const targetPrice = setup.target_price || (price > 0 ? (price * 1.10) : 0);
    const stopPrice = setup.stop_loss || (price > 0 ? (price * 0.95) : 0);
    const stopTargetTitle = price > 0 ? `Target: $${targetPrice.toFixed(2)} | Stop: $${stopPrice.toFixed(2)}` : '';

    return `
      <div class="td-stock-row ${rankCls}" title="${stopTargetTitle}">
        <span class="td-stock-rank">${idx + 1}</span>
        <span class="td-stock-ticker">${escapeHTML(ticker)}</span>
        ${changePill}
        <span class="td-stock-alpha-bar">
          <span class="td-alpha-fill" style="width:${barWidth}%"></span>
          <span class="td-alpha-text">α:${score >= 0 ? '+' : ''}${score.toFixed(3)}</span>
        </span>
        <span class="td-conv-badge ${convCls}">${convLabel}</span>
        <span class="td-stock-weight">${weight.toFixed(1)}%</span>
        <span class="td-stock-price">${price > 0 ? '$' + price.toFixed(2) : '—'}</span>
        <span class="td-stock-entry">${entryDisplay}</span>
        <span class="td-stock-qty">${qtyDisplay}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="td-section">
      <div class="td-section-header">
        <span class="td-section-title">📈 Stock Picks</span>
        <span class="td-section-count">${plays.length}</span>
      </div>
      ${suppressed ? '<div class="td-suppressed-note">⚠️ Regime suppressed — all positions sized to 25%</div>' : ''}
      <div class="td-stock-header-row">
        <span class="td-stock-rank">#</span>
        <span class="td-stock-ticker">Ticker</span>
        <span class="td-stock-alpha-bar">Alpha</span>
        <span class="td-conv-badge" style="background:none;color:var(--os-text-muted)">Conv</span>
        <span class="td-stock-weight">Wt%</span>
        <span class="td-stock-price">Price</span>
        <span class="td-stock-entry">Entry</span>
        <span class="td-stock-qty">Qty</span>
        <span class="td-stock-pnl">P&L</span>
      </div>
      <div class="td-stock-list">${rows}</div>
    </div>
  `;
}

// ─── Trading Desk: Option DD Panel CSS (injected once) ───
(function injectOptionDDStyles() {
  if (document.getElementById('opt-dd-styles')) return;
  const style = document.createElement('style');
  style.id = 'opt-dd-styles';
  style.textContent = `
    .td-option-pos-row { cursor: pointer; transition: background 0.15s; }
    .td-option-pos-row:hover { background: rgba(168,85,247,0.08) !important; }
    .td-option-pos-row.dd-active { background: rgba(168,85,247,0.1) !important; border-left-color: #a855f7 !important; }

    .td-option-dd-panel {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .td-option-dd-panel.dd-open {
      max-height: 600px;
    }

    .dd-inner {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(168,85,247,0.15);
      border-top: none;
      border-radius: 0 0 6px 6px;
      padding: 10px 12px 12px;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
    }

    .dd-thesis {
      font-size: 0.78rem;
      color: rgba(255,255,255,0.9);
      line-height: 1.5;
      margin-bottom: 10px;
      padding: 8px 10px;
      background: rgba(168,85,247,0.08);
      border-left: 2px solid #a855f7;
      border-radius: 0 4px 4px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-weight: 400;
    }

    .dd-rr-section { margin-bottom: 10px; }

    .dd-rr-track {
      position: relative;
      height: 8px;
      border-radius: 4px;
      overflow: visible;
      margin: 6px 0 4px;
    }
    .dd-rr-fill {
      position: absolute;
      inset: 0;
      border-radius: 4px;
    }
    .dd-rr-marker {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 3px;
      height: 14px;
      background: #fff;
      border-radius: 2px;
      box-shadow: 0 0 4px rgba(0,0,0,0.8);
    }
    .dd-rr-marker-label {
      position: absolute;
      top: -18px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.56rem;
      color: #fff;
      white-space: nowrap;
      background: rgba(0,0,0,0.7);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
    }
    .dd-rr-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.58rem;
      opacity: 0.85;
      margin-top: 6px;
    }

    .dd-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
      gap: 6px 10px;
    }
    .dd-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .dd-label {
      font-size: 0.55rem;
      color: rgba(255,255,255,0.35);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .dd-val {
      font-size: 0.72rem;
      color: rgba(255,255,255,0.85);
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
})();

// ─── Trading Desk: Option DD Panel Content Builder ───
function buildOptionDDPanel(pos) {
  const MONO = "font-family:var(--font-mono,'JetBrains Mono',monospace)";

  // Extract thesis from pos.notes
  // Format: "strike/spread expiry xQty. [THESIS TEXT]"
  const notesRaw = pos.notes || '';
  const sepIdx = notesRaw.indexOf('. ');
  const thesis = sepIdx > -1 ? notesRaw.slice(sepIdx + 2).trim() : notesRaw.trim();

  const entry   = pos.entry_price   || 0;
  const current = pos.current_price || entry;
  const qty     = pos.quantity      || 0;
  const short   = pos.direction === 'short' ? -1 : 1;
  const stop    = pos.stop_loss    || 0;
  const target  = pos.target_price || 0;

  // P&L
  const costBasis    = entry * qty * 100;
  const currentValue = current * qty * 100;
  const pnl    = pos.current_pnl != null
    ? pos.current_pnl
    : (current - entry) * qty * 100 * short;
  const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
  const pnlColor = pnl >= 0 ? '#22c55e' : '#ef4444';

  // DTE
  const expiry = pos.expiry || '';
  let dteDisplay = '';
  if (expiry) {
    const now = new Date();
    const exp = new Date(expiry + 'T16:00:00');
    const dteNum = Math.max(0, Math.ceil((exp - now) / (1000 * 60 * 60 * 24)));
    dteDisplay = dteNum + 'd';
  }

  // Entry date
  const rawDate = pos.entry_date || pos.created_at || '';
  const entryDateDisplay = rawDate
    ? new Date(rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  // Risk/Reward bar
  let rrBarHTML = '';
  if (stop > 0 && target > 0 && entry > 0) {
    const low  = Math.min(stop, entry, current, target);
    const high = Math.max(stop, entry, current, target);
    const range = high - low || 1;
    const pct = v => (((v - low) / range) * 100).toFixed(1);
    const stopP    = pct(stop);
    const entryP   = pct(entry);
    const currentP = Math.min(100, Math.max(0, parseFloat(pct(current))));
    const targetP  = pct(target);

    rrBarHTML = `
      <div class="dd-rr-section">
        <div class="dd-label">RISK / REWARD</div>
        <div class="dd-rr-track">
          <div class="dd-rr-fill" style="background:linear-gradient(to right,#ef4444 0%,#ef4444 ${stopP}%,#eab308 ${stopP}%,#eab308 ${entryP}%,#22c55e ${entryP}%,#22c55e 100%)"></div>
          <div class="dd-rr-marker" style="left:${currentP}%">
            <div class="dd-rr-marker-label">$${current.toFixed(2)}</div>
          </div>
        </div>
        <div class="dd-rr-labels">
          <span style="color:#ef4444">Stop $${stop.toFixed(2)}</span>
          <span style="color:#eab308">Entry $${entry.toFixed(2)}</span>
          <span style="color:#22c55e">Target $${target.toFixed(2)}</span>
        </div>
      </div>`;
  }

  const vehicle   = (pos.vehicle   || 'calls').toUpperCase();
  const direction = (pos.direction || 'long').toUpperCase();

  // Grid cells — only include meaningful ones
  const cells = [
    { label: 'ENTRY',      val: entry   > 0 ? `$${entry.toFixed(2)}`   : '—' },
    { label: 'MARK',       val: current > 0 ? `$${current.toFixed(2)}` : '—' },
    ...(stop   > 0 ? [{ label: 'STOP',   val: `$${stop.toFixed(2)}`,   color: '#ef4444' }] : []),
    ...(target > 0 ? [{ label: 'TARGET', val: `$${target.toFixed(2)}`, color: '#22c55e' }] : []),
    { label: 'COST BASIS', val: costBasis > 0 ? `$${costBasis.toFixed(0)}` : '—' },
    { label: 'CURR VALUE', val: currentValue > 0 ? `$${currentValue.toFixed(0)}` : '—' },
    { label: 'UNREALIZED', val: `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(0)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`, color: pnlColor },
    { label: 'DIRECTION',  val: direction },
    { label: 'TYPE',       val: vehicle },
    { label: 'CONTRACTS',  val: qty + 'x' },
    ...(dteDisplay ? [{ label: 'DTE', val: dteDisplay }] : []),
    { label: 'ENTERED',    val: entryDateDisplay },
  ];

  const gridHTML = cells.map(c =>
    `<div class="dd-cell"><span class="dd-label">${c.label}</span><span class="dd-val"${c.color ? ` style="color:${c.color}"` : ''}>${escapeHTML(String(c.val))}</span></div>`
  ).join('');

  return `<div class="dd-inner">
    ${thesis ? `<div class="dd-thesis">${escapeHTML(thesis)}</div>` : ''}
    ${rrBarHTML}
    <div class="dd-grid">${gridHTML}</div>
  </div>`;
}

// ─── Trading Desk: Options (Positions + Pending Plays) ───
function buildOptionPlays(plays, openPositions) {
  // Filter openPositions to options only
  const optPositions = (openPositions || []).filter(pos => {
    const v = pos.vehicle || 'shares';
    return v === 'calls' || v === 'puts' || v === 'spread';
  });

  // Tickers that already have an active position
  const positionTickers = new Set(optPositions.map(p => (p.ticker || '').toUpperCase()));

  // Strategist plays whose ticker is NOT yet in positions (pending)
  // Also filter out plays older than 16 hours (auto-expire stale plays)
  const sixteenHoursAgo = Date.now() - 16 * 60 * 60 * 1000;
  const pendingPlays = (plays || []).filter(play => {
    if (positionTickers.has((play.ticker || '').toUpperCase())) return false;
    const created = play.created_at ? new Date(play.created_at + 'Z').getTime() : 0;
    if (created && created < sixteenHoursAgo) return false;
    return true;
  });

  if (optPositions.length === 0 && pendingPlays.length === 0) return '';

  // Cost basis: entry_price × contracts × 100
  const totalCost = optPositions.reduce((sum, pos) =>
    sum + (pos.entry_price || 0) * (pos.quantity || 0) * 100, 0);

  // ── DTE helper ──────────────────────────────────────────
  function dteBadge(expiry) {
    if (!expiry) return { label: '', cls: 'td-option-dte-safe' };
    const now = new Date();
    const exp = new Date(expiry + 'T16:00:00');
    const dte = Math.max(0, Math.ceil((exp - now) / (1000 * 60 * 60 * 24)));
    let cls = 'td-option-dte-safe';
    if (dte < 3)       cls = 'td-option-dte-critical';
    else if (dte <= 7)  cls = 'td-option-dte-warning';
    else if (dte <= 14) cls = 'td-option-dte-caution';
    return { label: dte + 'd', cls };
  }

  const MONO = "font-family:var(--font-mono,'JetBrains Mono',monospace)";

  // ── Active position rows ─────────────────────────────────
  const positionRows = optPositions.map((pos, idx) => {
    const ticker  = pos.ticker || '—';
    const vehicle = pos.vehicle || 'calls';
    const isCall  = vehicle === 'calls';
    const typeLabel = vehicle === 'spread' ? 'SPD' : (isCall ? 'C' : 'P');
    const strike  = pos.strike || '';
    const expiry  = pos.expiry || '';
    const expiryShort = expiry ? expiry.replace(/^\d{4}-/, '') : '—';
    const dte     = dteBadge(expiry);
    const entry   = pos.entry_price   || 0;
    const current = pos.current_price || entry;
    const qty     = pos.quantity      || 0;
    const short   = pos.direction === 'short' ? -1 : 1;

    // Prefer API-supplied P&L if present, otherwise compute
    const costBasis = entry * qty * 100;
    const pnl    = pos.current_pnl != null
      ? pos.current_pnl
      : (current - entry) * qty * 100 * short;
    const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
    const pnlColor = pnl >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';

    const entryDisplay   = entry   > 0 ? `$${entry.toFixed(2)}`   : '—';
    const currentDisplay = current > 0 ? `$${current.toFixed(2)}` : '—';
    const pnlDisplay = (entry === 0 && current === 0)
      ? 'no data'
      : `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(0)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;

    // DD panel setup
    const posId = `optpos-${(ticker).toLowerCase().replace(/[^a-z0-9]/g, '')}-${idx}`;
    optPosDataMap.set(posId, pos);
    const ddPanelHTML = buildOptionDDPanel(pos);

    return `
      <div class="td-option-row td-option-pos-row" style="border-left:2px solid ${pnlColor}" data-pos-id="${posId}">
        <span class="td-option-ticker">${escapeHTML(ticker)}</span>
        <span class="td-option-strike">$${strike}${typeLabel}</span>
        <span class="td-option-expiry">${expiryShort}</span>
        <span class="td-option-dte ${dte.cls}">${dte.label}</span>
        <span class="td-option-entry" style="${MONO}">${entryDisplay}</span>
        <span class="td-option-current" style="${MONO}">${currentDisplay}</span>
        <span class="td-option-pnl" style="color:${pnlColor};${MONO}">${pnlDisplay}</span>
        <span class="td-option-contracts" style="color:var(--os-text-muted)">${qty}x</span>
      </div>
      <div class="td-option-dd-panel" id="dd-${posId}">${ddPanelHTML}</div>
    `;
  }).join('');

  // ── Pending play rows ────────────────────────────────────
  const pendingRows = pendingPlays.map(play => {
    const setup   = typeof play.setup === 'string' ? JSON.parse(play.setup || '{}') : (play.setup || {});
    const ticker  = play.ticker || '—';
    const vehicle = play.vehicle || 'calls';
    const isCall  = vehicle === 'calls';
    const typeLabel = vehicle === 'spread' ? 'SPD' : (isCall ? 'C' : 'P');
    const strike  = setup.strike    || 0;
    const expiry  = setup.expiry    || '';
    const expiryShort = expiry ? expiry.replace(/^\d{4}-/, '') : '—';
    const dte       = dteBadge(expiry);
    const ask       = setup.entry_price || 0;
    const contracts = setup.contracts   || 0;

    return `
      <div class="td-option-row td-option-pending-row" data-play-id="${play.id}">
        <span class="td-option-ticker">${escapeHTML(ticker)}</span>
        <span class="td-option-strike">$${strike}${typeLabel}</span>
        <span class="td-option-expiry">${expiryShort}</span>
        <span class="td-option-dte ${dte.cls}">${dte.label}</span>
        <span class="td-option-entry" style="${MONO}">${ask > 0 ? `$${ask.toFixed(2)}` : '—'}</span>
        <span class="td-option-current" style="color:var(--os-text-muted)">pending</span>
        <span class="td-option-pnl" style="color:var(--os-text-muted)">—</span>
        <span class="td-option-contracts" style="color:var(--os-text-muted)">${contracts}x</span>
        <button class="td-play-dismiss" onclick="dismissPlay(${play.id}, this)" title="Dismiss play">✕</button>
      </div>
    `;
  }).join('');

  const pendingSection = pendingRows
    ? `<div class="td-pending-divider">PENDING</div>${pendingRows}`
    : '';

  return `
    <div class="td-section">
      <div class="td-section-header">
        <span class="td-section-title">🎰 Options</span>
        <div class="td-section-header-right">
          ${totalCost > 0 ? `<span class="td-options-total">$${totalCost.toLocaleString()}</span>` : ''}
          <span class="td-section-count">${optPositions.length}</span>
        </div>
      </div>
      <div class="td-option-header-row">
        <span class="td-option-ticker">Ticker</span>
        <span class="td-option-strike">Strike</span>
        <span class="td-option-expiry">Exp</span>
        <span class="td-option-dte">DTE</span>
        <span class="td-option-entry">Entry</span>
        <span class="td-option-current">Mark</span>
        <span class="td-option-pnl">P&amp;L</span>
        <span class="td-option-contracts">Qty</span>
      </div>
      <div class="td-option-list">
        ${positionRows}
        ${pendingSection}
      </div>
    </div>
  `;
}

// ─── Trading Desk: Dismiss Pending Play ───
async function dismissPlay(playId, btn) {
  if (!playId) return;
  const row = btn.closest('.td-option-pending-row');
  if (row) { row.style.opacity = '0.2'; row.style.pointerEvents = 'none'; }
  try {
    const res = await fetch(`${API_BASE}/plays/${playId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'dismissed' }) });
    if (!res.ok) throw new Error(`API ${res.status}`);
    if (row) row.remove();
    // Remove divider if no more pending rows
    const container = document.querySelector('.td-option-list');
    if (container && !container.querySelector('.td-option-pending-row')) {
      const divider = container.querySelector('.td-pending-divider');
      if (divider) divider.remove();
    }
  } catch (e) {
    console.error('Failed to dismiss play:', e);
    if (row) { row.style.opacity = ''; row.style.pointerEvents = ''; }
  }
}

// ─── Trading Desk: Sparkline SVG ───
function buildSparklineSVG(prices) {
  if (!prices || prices.length < 2) return '';
  const w = 48, h = 16, pad = 1;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const points = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (p - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? '#22c55e' : '#ef4444';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="td-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ─── Trading Desk: Regime History Strip ───
function buildRegimeStrip(history) {
  if (!history || history.length === 0) return '';
  // Show last 7 days as small circles with day labels on hover
  const days = [];
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const match = history.find(h => h.date === dateStr);
    days.push({ date: dateStr, signal: match ? match.signal : null, dayLabel: dayNames[d.getDay()] });
  }

  // Summary counts
  const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
  days.forEach(d => { if (d.signal && counts[d.signal] !== undefined) counts[d.signal]++; });
  const summaryParts = [];
  if (counts.RED > 0) summaryParts.push(`<span class="td-rs-count td-rs-red-text">${counts.RED}R</span>`);
  if (counts.YELLOW > 0) summaryParts.push(`<span class="td-rs-count td-rs-yellow-text">${counts.YELLOW}Y</span>`);
  if (counts.GREEN > 0) summaryParts.push(`<span class="td-rs-count td-rs-green-text">${counts.GREEN}G</span>`);
  const summary = summaryParts.join(' ');

  const circles = days.map(d => {
    const cls = d.signal === 'GREEN' ? 'td-rs-green' : d.signal === 'YELLOW' ? 'td-rs-yellow' : d.signal === 'RED' ? 'td-rs-red' : 'td-rs-none';
    return `<div class="td-rs-circle ${cls}" title="${d.dayLabel} ${d.date} — ${d.signal || 'No data'}"></div>`;
  }).join('');

  return `<div class="td-regime-strip-compact"><div class="td-rs-circles">${circles}</div><div class="td-rs-summary">${summary}</div></div>`;
}

// ─── Trading Desk: Fear & Greed Gauge ───
function buildFearGreedGauge(data) {
  if (!data) return '';
  const score = data.score || 50;
  const label = data.label || 'Neutral';
  // Color based on score
  let color, bg;
  if (score >= 75) { color = '#22c55e'; bg = 'rgba(34,197,94,0.1)'; }
  else if (score >= 55) { color = '#86efac'; bg = 'rgba(134,239,172,0.08)'; }
  else if (score >= 45) { color = '#eab308'; bg = 'rgba(234,179,8,0.08)'; }
  else if (score >= 25) { color = '#f97316'; bg = 'rgba(249,115,22,0.08)'; }
  else { color = '#ef4444'; bg = 'rgba(239,68,68,0.1)'; }

  // Arc gauge
  const angle = (score / 100) * 180;
  const rad = angle * Math.PI / 180;
  const r = 40, cx = 50, cy = 50;
  const x = cx + r * Math.cos(Math.PI - rad);
  const y = cy - r * Math.sin(Math.PI - rad);
  const largeArc = angle > 90 ? 1 : 0;

  return `
    <div class="td-fg-gauge" style="background:${bg}">
      <div class="td-fg-header">FEAR & GREED</div>
      <svg viewBox="0 0 100 55" class="td-fg-arc">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10" stroke-linecap="round"/>
        <path d="M 10 50 A 40 40 0 ${largeArc} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
      </svg>
      <div class="td-fg-score" style="color:${color}">${score}</div>
      <div class="td-fg-label">${escapeHTML(label)}</div>
    </div>
  `;
}

// ─── Trading Desk: Trade History (Closed Positions) ───
function buildTradeHistory(closedPositions) {
  if (!closedPositions || closedPositions.length === 0) return '';

  const MONO = "font-family:var(--font-mono,'JetBrains Mono',monospace)";

  // Sort by exit_date descending (most recent first)
  const sorted = [...closedPositions].sort((a, b) =>
    new Date(b.exit_date || 0) - new Date(a.exit_date || 0)
  );

  const rows = sorted.map(pos => {
    const ticker = pos.ticker || '—';
    const vehicle = pos.vehicle || 'shares';
    const typeLabel = vehicle === 'shares' ? 'STK' : vehicle === 'spread' ? 'SPD' : (vehicle === 'calls' ? 'C' : 'P');
    const strike = pos.strike ? `$${pos.strike}` : '';
    const entry = pos.entry_price || 0;
    const exit = pos.exit_price || 0;
    const pnl = pos.pnl || 0;
    const costBasis = vehicle === 'shares'
      ? entry * (pos.quantity || 0)
      : entry * (pos.quantity || 0) * 100;
    const pnlPct = costBasis > 0 ? (pnl / costBasis * 100) : 0;
    const pnlColor = pnl >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';
    const icon = pnl >= 0 ? '✅' : '❌';
    const exitDate = pos.exit_date ? new Date(pos.exit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const reason = (pos.notes || '').replace('Dealer auto-close: ', '').replace(/_/g, ' ');

    return `
      <div class="td-option-row" style="border-left:2px solid ${pnlColor}">
        <span style="width:20px">${icon}</span>
        <span class="td-option-ticker">${escapeHTML(ticker)}</span>
        <span class="td-option-strike">${strike}${typeLabel}</span>
        <span style="color:var(--os-text-muted);font-size:0.7rem;min-width:50px">${exitDate}</span>
        <span style="${MONO};min-width:50px">$${entry.toFixed(2)}</span>
        <span style="color:var(--os-text-muted);min-width:15px">→</span>
        <span style="${MONO};min-width:50px">$${exit.toFixed(2)}</span>
        <span class="td-option-pnl" style="color:${pnlColor};${MONO}">${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(0)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(0)}%)</span>
        <span style="color:var(--os-text-muted);font-size:0.65rem">${escapeHTML(reason)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="td-section" style="margin-top:12px">
      <div class="td-section-header">
        <span class="td-section-title">📜 Trade History</span>
        <span class="td-section-count">${sorted.length}</span>
      </div>
      <div class="td-option-list">${rows}</div>
    </div>
  `;
}

// ─── Trading Desk: Sector Heatmap ───
function buildSectorHeatmap(sectors) {
  if (!sectors || sectors.length === 0) return '';
  const cells = sectors.map(s => {
    const pct = s.daily_pct || 0;
    const wk = s.weekly_pct || 0;
    let bg, textColor;
    if (pct >= 1.5) { bg = 'rgba(34,197,94,0.35)'; textColor = '#4ade80'; }
    else if (pct >= 0.5) { bg = 'rgba(34,197,94,0.15)'; textColor = '#86efac'; }
    else if (pct >= -0.5) { bg = 'rgba(255,255,255,0.04)'; textColor = 'rgba(255,255,255,0.6)'; }
    else if (pct >= -1.5) { bg = 'rgba(239,68,68,0.15)'; textColor = '#fca5a5'; }
    else { bg = 'rgba(239,68,68,0.35)'; textColor = '#ef4444'; }

    const shortName = s.name.replace('Consumer ', '').replace('Real Estate', 'RE').replace('Communication Services', 'Comm Svcs').replace('Information Technology', 'Info Tech');
    return `
      <div class="td-sector-cell" style="background:${bg}" title="${escapeHTML(s.name)}">
        <span class="td-sector-name">${escapeHTML(shortName)}</span>
        <span class="td-sector-pct" style="color:${textColor}">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>
        <span class="td-sector-wk">${wk >= 0 ? '+' : ''}${wk.toFixed(1)}% wk</span>
      </div>
    `;
  }).join('');

  return `
    <div class="td-sector-map">
      <div class="td-widget-title">📊 Sectors</div>
      <div class="td-sector-grid">${cells}</div>
    </div>
  `;
}

// ─── Trading Desk: Calendar Widget ───
function buildCalendarWidget(econ, earnings) {
  const econEvents = (econ || []).slice(0, 6);
  const earningsEvents = (earnings || []).slice(0, 5);
  
  if (econEvents.length === 0 && earningsEvents.length === 0) return '';

  const impactIcon = { critical: '🔴', high: '🟡', medium: '⚪', low: '⚫' };
  
  const econHtml = econEvents.map(e => {
    const icon = impactIcon[e.impact] || '⚪';
    const dateShort = (e.date || '').slice(5); // MM-DD
    return `<div class="td-cal-row"><span class="td-cal-date">${dateShort}</span>${icon} <span class="td-cal-event">${escapeHTML(e.event)}</span><span class="td-cal-note">${escapeHTML(e.note || '')}</span></div>`;
  }).join('');

  const earningsHtml = earningsEvents.map(e => {
    return `<div class="td-cal-row"><span class="td-cal-date">${(e.date || '').slice(5)}</span>📊 <span class="td-cal-event">${escapeHTML(e.ticker)}</span><span class="td-cal-note">in ${e.days_until}d</span></div>`;
  }).join('');

  return `
    <div class="td-calendar">
      <div class="td-widget-title">📅 Calendar</div>
      ${econHtml}
      ${earningsHtml ? `<div class="td-cal-divider"></div>${earningsHtml}` : ''}
    </div>
  `;
}

// ─── Trading Desk: Structured Morning Brief ───
function buildStructuredBrief(d) {
  const regimeEmoji = {GREEN: '🟢', YELLOW: '🟡', RED: '🔴'}[d.regime?.signal] || '⚪';
  
  // Market indices
  const indices = d.market?.indices || {};
  
  // Check if market data is all zeros/empty
  const sp500Price = (indices['S&P 500']?.price || 0);
  const nasdaqPrice = (indices['NASDAQ']?.price || 0);
  const hasMarketData = sp500Price > 0 || nasdaqPrice > 0;
  
  const indexRows = ['S&P 500', 'NASDAQ', 'Russell 2000'].map(name => {
    const idx = indices[name] || {};
    const price = idx.price || 0;
    if (price === 0) return ''; // Skip zero prices
    const chg = idx.daily_change_pct || 0;
    const wk = idx.weekly_change_pct || 0;
    const arrow = chg >= 0 ? '▲' : '▼';
    const color = chg >= 0 ? 'var(--sig-green, #22c55e)' : 'var(--sig-red, #ef4444)';
    return `<div class="td-brief-idx"><span class="td-brief-idx-name">${name}</span><span class="td-brief-idx-price">${price.toLocaleString('en-US', {maximumFractionDigits: 0})}</span><span style="color:${color}">${arrow}${Math.abs(chg).toFixed(1)}%</span><span class="td-brief-idx-wk">${wk >= 0 ? '+' : ''}${wk.toFixed(1)}% wk</span></div>`;
  }).filter(row => row !== '').join('');

  // VIX
  const vix = d.market?.vix || {};
  const vixLevel = vix.level || '—';
  const vixRegime = vix.regime || '';
  const vixColor = vixLevel > 25 ? 'var(--sig-red)' : vixLevel > 18 ? '#eab308' : 'var(--sig-green)';

  // Sector rotation
  const leaders = (d.market?.sector_leaders || []).join(', ');
  const laggards = (d.market?.sector_laggards || []).join(', ');

  // Regime reasoning
  const reasoning = (d.regime?.reasoning || []).map(r => 
    `<div class="td-brief-reason">${escapeHTML(r.substring(0, 200))}</div>`
  ).join('');

  // Strategy
  const strat = d.regime?.strategy || {};
  const sizing = strat.position_sizing || '';
  const strategies = strat.strategies || '';

  // Avoid list  
  const avoid = (d.avoid || []).join(', ');

  // News
  const newsHtml = (d.news_headlines || []).map(h => 
    `<div class="td-brief-news-item">• ${escapeHTML(h.substring(0, 120))}</div>`
  ).join('');

  return `
    <div class="td-section td-brief-section">
      <div class="td-section-header">
        <span class="td-section-title">📋 Morning Brief</span>
        <span class="td-brief-date">${escapeHTML(d.date || '')}</span>
      </div>
      <div class="td-brief-structured">
        ${hasMarketData ? `
        <div class="td-brief-block">
          <div class="td-brief-block-title">Market Snapshot</div>
          <div class="td-brief-indices">${indexRows}</div>
          <div class="td-brief-vix">VIX: <span style="color:${vixColor};font-weight:600">${vixLevel}</span> <span class="td-brief-dim">${escapeHTML(vixRegime)}</span></div>
          ${leaders ? `<div class="td-brief-sectors"><span class="td-brief-dim">Leading:</span> ${escapeHTML(leaders)}</div>` : ''}
          ${laggards ? `<div class="td-brief-sectors"><span class="td-brief-dim">Lagging:</span> ${escapeHTML(laggards)}</div>` : ''}
        </div>
        ` : ''}

        <div class="td-brief-block">
          <div class="td-brief-block-title">${regimeEmoji} Regime Analysis</div>
          ${reasoning}
          ${sizing ? `<div class="td-brief-strat"><span class="td-brief-dim">Sizing:</span> ${escapeHTML(sizing)}</div>` : ''}
          ${strategies ? `<div class="td-brief-strat"><span class="td-brief-dim">Strategy:</span> ${escapeHTML(strategies.substring(0, 200))}</div>` : ''}
        </div>

        ${avoid ? `
        <div class="td-brief-block">
          <div class="td-brief-block-title">🚫 Avoid</div>
          <div class="td-brief-avoid">${escapeHTML(avoid)}</div>
        </div>
        ` : ''}

        ${newsHtml ? `
        <div class="td-brief-block">
          <div class="td-brief-block-title">📰 Catalysts & News</div>
          ${newsHtml}
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── Trading Desk: Fallback Raw Brief ───
function buildBriefSection(body) {
  if (!body) return '';
  // Truncate for preview, keep first ~600 chars
  const preview = body.length > 600 ? body.substring(0, 600) + '…' : body;
  // Simple markdown-ish rendering: **bold**, newlines
  const rendered = escapeHTML(preview)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  return `
    <div class="td-section td-brief-section">
      <div class="td-section-header">
        <span class="td-section-title">📋 Morning Brief</span>
        <span class="td-brief-toggle" onclick="this.closest('.td-brief-section').classList.toggle('td-brief-expanded')">expand</span>
      </div>
      <div class="td-brief-body">${rendered}</div>
    </div>
  `;
}

// Keep legacy function names as no-ops for compatibility
function buildPlaysSection(data) { return ''; }
function buildPortfolioStrip() { return ''; }
function buildDegenPlay() { return ''; }

function formatCurrency(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


/* ═══════════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════════ */
function initChat() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  if (!input || !sendBtn) return;

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    addChatMessage(text, 'user');
    input.value = '';
    soundClick();
    setTimeout(() => {
      addChatMessage('Atlas OS v0.1 — chat integration coming soon. For now, use Telegram to reach me.', 'atlas');
    }, 600);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
  sendBtn.addEventListener('click', send);
}

function addChatMessage(text, sender) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg msg-${sender}`;
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}


/* ═══════════════════════════════════════════════════
   MOBILE NAV
   ═══════════════════════════════════════════════════ */
function initMobileNav() {
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const windowId = btn.dataset.window;
      if (!windowId) return;

      // On mobile, scroll to the window card
      if (state.isMobile) {
        openWindow(windowId);
        // Find the window element and scroll to it
        const win = state.windows.get(windowId);
        if (win && win.el) {
          win.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Update active state
        document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('nav-active'));
        btn.classList.add('nav-active');
      } else {
        openWindow(windowId);
      }
    });
  });
}

function updateMobileNavBadge() {
  const badge = document.getElementById('mobileInboxBadge');
  if (!badge) return;
  const pending = state.inbox.filter(i => i.status === 'pending').length;
  if (pending > 0) {
    badge.textContent = pending;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}


/* ═══════════════════════════════════════════════════
   DESKTOP ICONS
   ═══════════════════════════════════════════════════ */
function initDesktopIcons() {
  document.querySelectorAll('.desktop-icon').forEach(icon => {
    icon.addEventListener('dblclick', () => {
      const windowId = icon.dataset.window;
      if (windowId) openWindow(windowId);
    });
    icon.addEventListener('click', () => {
      if (state.isMobile) {
        const windowId = icon.dataset.window;
        if (windowId) openWindow(windowId);
      }
    });
  });
}


/* ═══════════════════════════════════════════════════
   BACKGROUND CANVAS
   ═══════════════════════════════════════════════════ */
function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Sparse particle system
  const particles = [];
  const PARTICLE_COUNT = 35;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.08,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.15 + 0.05,
      hue: Math.random() > 0.7 ? 260 : Math.random() > 0.5 ? 190 : 220,
    });
  }

  let frame = 0;

  function draw() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    const spacing = 80;
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.018)';
    ctx.lineWidth = 0.5;
    for (let x = spacing; x < canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = spacing; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Intersection dots
    for (let x = spacing; x < canvas.width; x += spacing) {
      for (let y = spacing; y < canvas.height; y += spacing) {
        const wave = Math.sin((x * 0.01) + (y * 0.01) + frame * 0.006) * 0.5 + 0.5;
        ctx.globalAlpha = 0.05 + wave * 0.05;
        ctx.fillStyle = 'rgba(167, 139, 250, 1)';
        ctx.beginPath();
        ctx.arc(x, y, 0.7 + wave * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Floating particles
    ctx.globalAlpha = 1;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;

      const breathe = Math.sin(frame * 0.01 + p.x * 0.005) * 0.5 + 0.5;
      ctx.globalAlpha = p.alpha * (0.5 + breathe * 0.5);
      ctx.fillStyle = `hsla(${p.hue}, 60%, 70%, 1)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.8 + breathe * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  draw();
}


/* ═══════════════════════════════════════════════════
   AGENT DETAIL PANEL
   ═══════════════════════════════════════════════════ */
function openAgentDetail(agentName) {
  const windowId = `agent-detail-${agentName}`;

  // If already open, focus it
  if (state.windows.has(windowId)) {
    const win = state.windows.get(windowId);
    if (win.el.classList.contains('window-minimized')) {
      win.el.classList.remove('window-minimized');
    }
    focusWindow(windowId);
    return;
  }

  const agent = state.agents.find(a => a.name === agentName);
  if (!agent) return;

  const glyph = GLYPH_MAP[agentName] || '●';
  const color = agent.signature_color || 'var(--sig-atlas)';

  // Register dynamic window def
  WINDOW_DEFS[windowId] = {
    title: `${agentName.toUpperCase()} — Detail`,
    icon: glyph,
    template: 'tmpl-agent-detail',
  };

  // Open window (uses standard window manager)
  const container = document.getElementById('windowContainer');
  const tmpl = document.getElementById('tmpl-agent-detail');
  if (!tmpl) return;

  const win = document.createElement('div');
  win.className = 'window';
  win.dataset.windowId = windowId;
  win.style.setProperty('--agent-accent', color);

  const titlebar = document.createElement('div');
  titlebar.className = 'window-titlebar';
  titlebar.innerHTML = `
    <span class="window-titlebar-icon">${glyph}</span>
    <span class="window-titlebar-text">${agentName.toUpperCase()} — Personnel File</span>
    <div class="window-controls">
      <button class="window-ctrl window-ctrl-minimize" title="Minimize"></button>
      <button class="window-ctrl window-ctrl-maximize" title="Maximize"></button>
      <button class="window-ctrl window-ctrl-close" title="Close"></button>
    </div>
  `;

  const body = tmpl.content.cloneNode(true);

  const resizeHandles = ['n','s','e','w','ne','nw','se','sw'].map(dir => {
    const handle = document.createElement('div');
    handle.className = `window-resize window-resize-${dir}`;
    handle.dataset.resizeDir = dir;
    return handle;
  });

  win.appendChild(titlebar);
  win.appendChild(body);
  resizeHandles.forEach(h => win.appendChild(h));
  container.appendChild(win);

  // Position: offset from center, slightly random to avoid exact overlap
  if (!state.isMobile) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(520, vw - 80);
    const h = Math.min(600, vh - 120);
    const x = Math.floor((vw - w) / 2) + (Math.random() * 40 - 20);
    const y = Math.floor((vh - h - 48) / 2) + (Math.random() * 30 - 15);
    win.style.left = x + 'px';
    win.style.top = Math.max(0, y) + 'px';
    win.style.width = w + 'px';
    win.style.height = h + 'px';
  }

  state.windows.set(windowId, {
    el: win,
    config: WINDOW_DEFS[windowId],
    maximized: false,
    preMaxBounds: null,
  });

  requestAnimationFrame(() => win.classList.add('window-visible'));

  // Drag
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-controls')) return;
    startDrag(e, windowId);
  });
  titlebar.addEventListener('touchstart', (e) => {
    if (e.target.closest('.window-controls')) return;
    startDrag(e, windowId);
  }, { passive: false });
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.window-controls')) return;
    maximizeWindow(windowId);
  });

  win.querySelector('.window-ctrl-minimize').addEventListener('click', () => minimizeWindow(windowId));
  win.querySelector('.window-ctrl-maximize').addEventListener('click', () => maximizeWindow(windowId));
  win.querySelector('.window-ctrl-close').addEventListener('click', () => closeWindow(windowId));

  resizeHandles.forEach(h => {
    h.addEventListener('mousedown', (e) => startResize(e, windowId, h.dataset.resizeDir));
  });

  win.addEventListener('mousedown', () => focusWindow(windowId));
  focusWindow(windowId);
  updateTaskbarWindows();
  soundOpen();

  // ─── Populate header ───
  const headerEl = win.querySelector('.agent-detail-header');
  headerEl.querySelector('.agent-detail-glyph').textContent = glyph;
  headerEl.querySelector('.agent-detail-name').textContent = agentName.toUpperCase();
  headerEl.querySelector('.agent-detail-domain').textContent = agent.domain.toUpperCase();
  headerEl.querySelector('.agent-detail-tier').textContent = agent.model_tier;

  const statusDot = headerEl.querySelector('.agent-detail-status-dot');
  statusDot.classList.add(`status-${agent.status || 'idle'}`);
  headerEl.querySelector('.agent-detail-status-text').textContent = agent.status || 'idle';

  // Current task
  if (agent.current_task) {
    const taskEl = win.querySelector('.agent-detail-task');
    taskEl.textContent = agent.current_task;
    taskEl.style.display = '';
  }

  // ─── File tabs ───
  const fileCache = {};
  const fileContentEl = win.querySelector('.agent-detail-file-content');
  const fileTabs = win.querySelectorAll('.agent-file-tab');

  async function loadFile(fileName) {
    if (fileCache[fileName] !== undefined) {
      renderFileContent(fileCache[fileName], fileContentEl);
      return;
    }

    fileContentEl.innerHTML = '<div class="agent-file-loading">Loading...</div>';

    const data = await apiFetch(`/agents/${agentName}/files/${encodeURIComponent(fileName)}`);
    if (data && data.content) {
      fileCache[fileName] = data.content;
      renderFileContent(data.content, fileContentEl);
    } else {
      fileCache[fileName] = null;
      fileContentEl.innerHTML = '<div class="agent-file-empty">No file data. Seed with PUT /api/agents/' + escapeHtml(agentName) + '/files/' + escapeHtml(fileName) + '</div>';
    }
  }

  fileTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      fileTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadFile(tab.dataset.file);
    });
  });

  // Load default tab
  loadFile('AGENT.md');

  // ─── Work History ───
  loadAgentHistory(agentName, win.querySelector('.agent-detail-timeline'), color);
}

function renderFileContent(content, container) {
  if (!content) {
    container.innerHTML = '<div class="agent-file-empty">No content available.</div>';
    return;
  }

  container.innerHTML = `<div class="md-rendered">${renderMarkdown(content)}</div>`;
}

/* ─── Markdown renderer — handles headings, bold, italic, code, lists, tables, blockquotes, hr ─── */
function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inCode = false;
  let codeBlock = '';
  let inList = false;
  let listType = 'ul'; // 'ul' or 'ol'
  let inTable = false;
  let tableRows = [];

  function flushList() {
    if (inList) { html += `</${listType}>`; inList = false; }
  }
  function flushTable() {
    if (inTable && tableRows.length > 0) {
      html += '<table>';
      tableRows.forEach((row, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        const cells = row.split('|').filter(c => c.trim() !== '');
        html += '<tr>' + cells.map(c => `<${tag}>${inlineMarkdown(c.trim())}</${tag}>`).join('') + '</tr>';
      });
      html += '</table>';
      tableRows = [];
      inTable = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeBlock)}</code></pre>`;
        codeBlock = '';
        inCode = false;
      } else {
        flushList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBlock += (codeBlock ? '\n' : '') + line;
      continue;
    }

    // Table rows (pipe-separated)
    if (line.includes('|') && line.trim().startsWith('|')) {
      flushList();
      // Skip separator row (|---|---|)
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      if (!inTable) inTable = true;
      tableRows.push(line.trim());
      continue;
    } else {
      flushTable();
    }

    // Horizontal rule
    if (/^(\-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      html += '<hr>';
      continue;
    }

    // Headings
    if (line.startsWith('### ')) { flushList(); html += `<h3>${inlineMarkdown(line.slice(4))}</h3>`; continue; }
    if (line.startsWith('## '))  { flushList(); html += `<h2>${inlineMarkdown(line.slice(3))}</h2>`; continue; }
    if (line.startsWith('# '))   { flushList(); html += `<h1>${inlineMarkdown(line.slice(2))}</h1>`; continue; }

    // Blockquote
    if (line.startsWith('> ')) { flushList(); html += `<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`; continue; }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      if (!inList || listType !== 'ul') { flushList(); html += '<ul>'; inList = true; listType = 'ul'; }
      html += `<li>${inlineMarkdown(line.replace(/^[\s]*[-*+]\s/, ''))}</li>`;
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      if (!inList || listType !== 'ol') { flushList(); html += '<ol>'; inList = true; listType = 'ol'; }
      html += `<li>${inlineMarkdown(line.replace(/^[\s]*\d+\.\s/, ''))}</li>`;
      continue;
    }

    flushList();

    // Empty line
    if (line.trim() === '') { continue; }

    // Paragraph
    html += `<p>${inlineMarkdown(line)}</p>`;
  }

  // Close any open blocks
  if (inCode) html += `<pre><code>${escapeHtml(codeBlock)}</code></pre>`;
  flushList();
  flushTable();

  return html;
}

/* ─── Inline markdown: bold, italic, code, links ─── */
function inlineMarkdown(text) {
  let s = escapeHtml(text);
  // Code (backtick) — must be first to prevent further processing inside code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold + italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return s;
}

async function loadAgentHistory(agentName, timelineEl, color) {
  timelineEl.innerHTML = '<div class="agent-file-loading">Loading history...</div>';

  const data = await apiFetch(`/activity?agent=${encodeURIComponent(agentName)}&limit=20`);
  const items = Array.isArray(data) ? data : (data || []);

  if (items.length === 0) {
    timelineEl.innerHTML = '<div class="timeline-empty">No recorded activity yet.</div>';
    return;
  }

  timelineEl.innerHTML = '';
  items.forEach((item, i) => {
    const time = formatTime(item.created_at);
    const bodyText = parseActivityBody(item.body);

    const el = document.createElement('div');
    el.className = 'timeline-item';
    el.style.animationDelay = (i * 40) + 'ms';

    el.innerHTML = `
      <div class="timeline-item-dot"></div>
      <div class="timeline-item-content">
        <div class="timeline-item-title">${escapeHtml(item.title)}</div>
        ${bodyText ? `<div class="timeline-item-body">${escapeHtml(bodyText)}</div>` : ''}
      </div>
      <div class="timeline-item-time">${time}</div>
    `;

    timelineEl.appendChild(el);
  });
}


/* ═══════════════════════════════════════════════════
   PERSISTENCE
   ═══════════════════════════════════════════════════ */
function saveWindowState() {
  const ids = [...state.windows.keys()];
  try { localStorage.setItem('atlas-os-windows', JSON.stringify(ids)); } catch {}
}

function loadWindowState() {
  try { return JSON.parse(localStorage.getItem('atlas-os-windows')); } catch { return null; }
}

function saveWindowPos(id, x, y) {
  try { localStorage.setItem(`atlas-os-pos-${id}`, JSON.stringify({ x, y })); } catch {}
}

function loadWindowPos(id) {
  try { return JSON.parse(localStorage.getItem(`atlas-os-pos-${id}`)); } catch { return null; }
}

function saveWindowSize(id, w, h) {
  try { localStorage.setItem(`atlas-os-size-${id}`, JSON.stringify({ w, h })); } catch {}
}

function loadWindowSize(id) {
  try { return JSON.parse(localStorage.getItem(`atlas-os-size-${id}`)); } catch { return null; }
}


/* ═══════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════ */
function formatTime(dateStr) {
  if (!dateStr) return '';
  // Normalize "YYYY-MM-DD HH:MM:SS" → ISO with T and Z (API returns UTC without markers)
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    normalized = dateStr.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    normalized = dateStr + 'Z';
  }
  const d = new Date(normalized);
  if (isNaN(d)) return '';
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 0) return 'just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ═══════════════════════════════════════════════════
   NEURAL TASKS — Synaptic network visualization
   Tasks as nodes in a living neural network.
   ═══════════════════════════════════════════════════ */

// Neural color mapping
const NEURAL_COLORS = {
  backlog: { fill: '#4a5568', glow: 'rgba(74, 85, 104, 0.2)', pulse: false },
  active:  { fill: '#22d3ee', glow: 'rgba(34, 211, 238, 0.35)', pulse: true },
  review:  { fill: '#fbbf24', glow: 'rgba(251, 191, 36, 0.3)', pulse: true },
  done:    { fill: '#34d399', glow: 'rgba(52, 211, 153, 0.15)', pulse: false },
};

const PRIORITY_SIZES = { critical: 1.5, high: 1.25, medium: 1.0, low: 0.8, urgent: 1.5, normal: 1.0 };

// ─── Task view state ───
let neuralState = null;
let currentTaskView = 'list';
let agentRosterCache = null;
let doneColumnCollapsed = true;

async function getAgentRoster() {
  if (agentRosterCache) return agentRosterCache;
  try {
    const resp = await fetch(`${API_BASE}/agents/roster`);
    const data = await resp.json();
    agentRosterCache = data.success ? data.data : (Array.isArray(data) ? data : []);
  } catch (e) {
    console.error('Failed to fetch agent roster:', e);
    agentRosterCache = [];
  }
  return agentRosterCache;
}

function getAgentColor(agentName) {
  if (!agentName || !agentRosterCache) return 'var(--os-text-muted)';
  const agent = agentRosterCache.find(a => a.name === agentName);
  return agent?.signature_color || 'var(--os-text-muted)';
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    normalized = dateStr.replace(' ', 'T') + 'Z';
  }
  const d = new Date(normalized);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function niceDate(dateStr) {
  if (!dateStr) return '';
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    normalized = dateStr.replace(' ', 'T') + 'Z';
  }
  const d = new Date(normalized);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Basic Markdown renderer (safe, no external deps) ──
function renderBasicMarkdown(md) {
  if (!md) return '';
  // Escape HTML first for safety
  let html = escapeHtml(md);
  // Headers: ### → h3, ## → h2, # → h1
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (but not inside **)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Inline code: `text`
  html = html.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // Unordered list items: - item
  html = html.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li class="md-li">.*?<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');
  // Line breaks: double newline → paragraph break
  html = html.replace(/\n\n/g, '</p><p class="md-p">');
  // Single newlines → <br>
  html = html.replace(/\n/g, '<br>');
  return '<p class="md-p">' + html + '</p>';
}

// ── Comments CRUD ──
async function fetchComments(taskId) {
  try {
    const resp = await fetch(`${API_BASE}/tasks/${taskId}/comments`);
    const data = await resp.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

async function postComment(taskId, body, commentType) {
  try {
    const resp = await fetch(`${API_BASE}/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'koa', body, comment_type: commentType }),
    });
    return await resp.json();
  } catch { return null; }
}

async function deleteComment(taskId, commentId) {
  try {
    await fetch(`${API_BASE}/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' });
  } catch { /* ignore */ }
}

// ── Deliverables CRUD ──
async function fetchDeliverables(taskId) {
  try {
    const resp = await fetch(`${API_BASE}/tasks/${taskId}/deliverables`);
    const data = await resp.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

async function postDeliverable(taskId, delivData) {
  try {
    const resp = await fetch(`${API_BASE}/tasks/${taskId}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...delivData, author: 'koa' }),
    });
    return await resp.json();
  } catch { return null; }
}

async function deleteDeliverable(taskId, delivId) {
  try {
    await fetch(`${API_BASE}/tasks/${taskId}/deliverables/${delivId}`, { method: 'DELETE' });
  } catch { /* ignore */ }
}

// Normalize API tasks to have `owner` and `deps` for backward compat with neural map
function normalizeTasks(apiTasks) {
  return apiTasks.map(t => ({
    ...t,
    owner: t.assigned_agent || null,
    deps: [],
    priority: t.priority || 'medium',
    status: t.status || 'backlog',
    domain: t.domain || 'work',
  }));
}

async function fetchTasks() {
  try {
    const resp = await fetch(`${API_BASE}/tasks?limit=500`);
    const data = await resp.json();
    if (data.success) {
      state.tasks = normalizeTasks(data.data);
    }
  } catch (e) {
    console.error('Failed to fetch tasks:', e);
    if (!state.tasks) state.tasks = [];
  }
}

async function syncClickUp() {
  const btn = document.getElementById('tasksSyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Syncing…'; }
  try {
    const resp = await fetch(`${API_BASE}/tasks/sync`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
      const d = data.data;
      showTaskToast(`Synced: ${d.created} new, ${d.updated} updated, ${d.unchanged} unchanged`);
      await fetchTasks();
      renderTaskList();
      renderTaskBoard();
      updateTaskStats();
      if (currentTaskView === 'neural' && neuralState) {
        neuralState = null;
        initNeuralTasks();
      }
    }
  } catch (e) {
    showTaskToast('Sync failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync'; }
  }
}

function showTaskToast(msg) {
  let toast = document.getElementById('taskToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'taskToast';
    toast.style.cssText = 'position:fixed;bottom:60px;right:20px;background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.4);color:#22d3ee;padding:8px 16px;border-radius:6px;font-size:12px;font-family:var(--os-font-mono);z-index:9999;opacity:0;transition:opacity 0.3s;backdrop-filter:blur(8px)';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

async function createTask(taskData) {
  try {
    const resp = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData),
    });
    const data = await resp.json();
    if (data.success) {
      await fetchTasks();
      renderTaskList();
      renderTaskBoard();
      updateTaskStats();
      showTaskToast('Task created');
    }
    return data;
  } catch (e) {
    showTaskToast('Failed to create task');
    return null;
  }
}

async function updateTask(id, updates) {
  try {
    const resp = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await resp.json();
    if (data.success) {
      await fetchTasks();
      renderTaskList();
      renderTaskBoard();
      updateTaskStats();
      showTaskToast('Task updated');
    }
    return data;
  } catch (e) {
    showTaskToast('Failed to update task');
    return null;
  }
}

/* ═══ Task board + neural toggle ═══ */
async function initTasksWindow() {
  const container = document.getElementById('tasksList');
  if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--os-text-muted);font-family:var(--os-font-mono);font-size:12px">Loading tasks…</div>';
  await fetchTasks();
  renderTaskList();
  renderTaskBoard();
  updateTaskStats();
  initTaskViewToggle();
  initTaskDetailClose();
  initTaskToolbarActions();
}

function initTaskDetailClose() {
  const overlay = document.getElementById('taskDetailOverlay');
  const closeBtn = document.getElementById('taskDetailClose');
  if (!overlay) return;

  function hideDetail() { overlay.style.display = 'none'; }

  if (closeBtn) closeBtn.addEventListener('click', hideDetail);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideDetail(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      e.stopPropagation();
      hideDetail();
    }
  });
}

function initTaskViewToggle() {
  document.querySelectorAll('.tasks-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === currentTaskView) return;
      currentTaskView = view;

      document.querySelectorAll('.tasks-view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const listView = document.getElementById('tasksListView');
      const boardView = document.getElementById('tasksBoardView');
      const neuralView = document.getElementById('tasksNeuralView');
      const titleText = document.querySelector('.tasks-title-text');

      listView.style.display = 'none';
      boardView.style.display = 'none';
      neuralView.style.display = 'none';

      if (view === 'list') {
        listView.style.display = '';
        if (titleText) titleText.textContent = 'TASK LIST';
      } else if (view === 'board') {
        boardView.style.display = '';
        if (titleText) titleText.textContent = 'TASK BOARD';
      } else {
        neuralView.style.display = '';
        if (titleText) titleText.textContent = 'NEURAL MAP';
        if (!neuralState) initNeuralTasks();
      }
      soundClick();
    });
  });
}

/* ═══ List View (default — scannable) ═══ */
function renderTaskList() {
  const container = document.getElementById('tasksList');
  if (!container) return;
  container.innerHTML = '';

  const groups = [
    { key: 'active',  label: 'Active' },
    { key: 'review',  label: 'Review' },
    { key: 'backlog', label: 'Backlog' },
    { key: 'done',    label: 'Done' },
  ];

  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  groups.forEach(group => {
    const tasks = state.tasks
      .filter(t => t.status === group.key)
      .sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));
    if (tasks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'tl-group';

    const dotColor = NEURAL_COLORS[group.key]?.fill || '#4a5568';
    section.innerHTML = `<div class="tl-group-header">
      <span class="tl-group-dot" style="background:${dotColor};${group.key === 'active' || group.key === 'review' ? 'box-shadow:0 0 6px ' + dotColor : ''}"></span>
      <span class="tl-group-label">${group.label}</span>
      <span class="tl-group-count">${tasks.length}</span>
    </div>`;

    tasks.forEach((task, i) => {
      const ownerAgent = task.owner ? state.agents.find(a => a.name === task.owner) : null;
      const ownerColor = ownerAgent?.signature_color || 'var(--os-text-muted)';
      const ownerGlyph = task.owner ? (GLYPH_MAP[task.owner] || '●') : '';
      const priClass = task.priority === 'urgent' ? 'tl-pri-urgent' :
                        task.priority === 'high' ? 'tl-pri-high' :
                        task.priority === 'low' ? 'tl-pri-low' : 'tl-pri-normal';

      // Session badge for list view
      let sessionBadgeHtml = '';
      if (task.session_url && task.status === 'active') {
        sessionBadgeHtml = `<a class="tl-session-badge tl-session-live" href="${escapeHtml(task.session_url)}" target="_blank" onclick="event.stopPropagation()"><span class="session-live-dot"></span>Live</a>`;
      } else if (task.session_url) {
        sessionBadgeHtml = `<a class="tl-session-badge tl-session-replay" href="${escapeHtml(task.session_url)}" target="_blank" onclick="event.stopPropagation()">📼</a>`;
      }

      const row = document.createElement('div');
      row.className = 'tl-row' + (group.key === 'done' ? ' tl-row-done' : '');
      row.innerHTML = `
        <span class="tl-pri ${priClass}"></span>
        <span class="tl-title">${escapeHtml(task.title)}</span>
        ${sessionBadgeHtml}
        ${task.owner ? `<span class="tl-owner" style="color:${ownerColor}">${ownerGlyph} ${escapeHtml(task.owner)}</span>` : '<span class="tl-owner tl-owner-none">—</span>'}
        <span class="tl-domain">${escapeHtml(task.domain)}</span>
      `;
      row.addEventListener('click', () => { showTaskDetail(task); soundClick(); });
      section.appendChild(row);
    });

    container.appendChild(section);
  });
}

/* ═══ Board View ═══ */
function renderTaskBoard() {
  const statuses = ['backlog', 'active', 'review', 'done'];
  statuses.forEach(status => {
    const container = document.querySelector(`.tasks-column-cards[data-status="${status}"]`);
    if (!container) return;
    container.innerHTML = '';

    const tasks = state.tasks.filter(t => t.status === status);

    // Sort: urgent first, then high, then by created date
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    tasks.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    // Done column: collapsed by default, show last 10 only
    const isDone = status === 'done';
    if (isDone && tasks.length > 0) {
      const header = container.closest('.tasks-column')?.querySelector('.tasks-column-header');
      if (header && !header.querySelector('.tasks-column-toggle')) {
        const toggle = document.createElement('button');
        toggle.className = 'tasks-column-toggle';
        toggle.textContent = '▸';
        toggle.title = 'Expand/collapse';
        toggle.onclick = (e) => {
          e.stopPropagation();
          container.classList.toggle('collapsed');
          toggle.textContent = container.classList.contains('collapsed') ? '▸' : '▾';
        };
        header.appendChild(toggle);
        container.classList.add('collapsed');
      }
    }

    const displayTasks = isDone ? tasks.slice(0, 10) : tasks;

    // Column drop zone for drag-and-drop
    container.ondragover = (e) => { e.preventDefault(); container.classList.add('drag-over'); };
    container.ondragleave = () => container.classList.remove('drag-over');
    container.ondrop = async (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');
      const taskId = parseInt(e.dataTransfer.getData('text/plain'));
      if (taskId) {
        await updateTask(taskId, { status });
        const t = state.tasks.find(t => t.id === taskId);
        if (t) t.status = status;
      }
    };

    displayTasks.forEach((task, i) => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.priority = task.priority;
      card.style.setProperty('--card-delay', (i * 60) + 'ms');
      card.draggable = true;

      card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      };
      card.ondragend = () => {
        card.classList.remove('dragging');
        container.querySelectorAll('.card-drop-before,.card-drop-after').forEach(c => c.classList.remove('card-drop-before','card-drop-after'));
      };
      card.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragging = container.querySelector('.dragging');
        if (!dragging || dragging === card) return;
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        card.classList.toggle('card-drop-before', e.clientY < mid);
        card.classList.toggle('card-drop-after', e.clientY >= mid);
      };
      card.ondragleave = () => card.classList.remove('card-drop-before','card-drop-after');
      card.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('card-drop-before','card-drop-after');
        container.classList.remove('drag-over');
        const dragging = container.querySelector('.dragging');
        if (!dragging || dragging === card) return;
        const rect = card.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        container.insertBefore(dragging, before ? card : card.nextSibling);
      };

      const agentColor = getAgentColor(task.owner);

      const showPriority = task.priority === 'critical' || task.priority === 'high';
      const priStripe = task.priority === 'critical' ? '#f87171' : task.priority === 'high' ? '#f97316' : '';

      // Session badge for board cards
      let cardSessionHtml = '';
      if (task.session_url && task.status === 'active') {
        cardSessionHtml = `<a class="task-card-session task-card-session-live" href="${escapeHtml(task.session_url)}" target="_blank" onclick="event.stopPropagation()"><span class="session-live-dot"></span>Live</a>`;
      } else if (task.session_url) {
        cardSessionHtml = `<a class="task-card-session task-card-session-replay" href="${escapeHtml(task.session_url)}" target="_blank" onclick="event.stopPropagation()">📼 Session</a>`;
      }

      card.innerHTML = `
        ${priStripe ? `<div class="task-card-pri-stripe" style="background:${priStripe}"></div>` : ''}
        <div class="task-card-title">${escapeHtml(task.title)}</div>
        ${cardSessionHtml}
        <div class="task-card-footer">
          ${task.owner ? `<span class="task-card-owner"><span class="task-card-owner-dot" style="background:${agentColor}"></span>${escapeHtml(task.owner)}</span>` : '<span class="task-card-owner" style="opacity:0.3">unassigned</span>'}
          ${showPriority ? `<span class="task-card-priority-badge" data-priority="${task.priority}">${task.priority}</span>` : ''}
          <span class="task-card-domain">${escapeHtml(task.domain)}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        showTaskDetail(task);
        soundClick();
      });

      container.appendChild(card);
    });

    // Update column count
    const countEl = document.querySelector(`.tasks-column-count[data-count="${status}"]`);
    if (countEl) countEl.textContent = tasks.length;
  });
}

/* ═══ Neural Map (lazy init) ═══ */
function initNeuralTasks() {
  const canvas = document.getElementById('neuralCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const wrap = canvas.closest('.tasks-canvas-wrap');

  // Size canvas to container
  function resize() {
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    if (neuralState) {
      neuralState.w = rect.width;
      neuralState.h = rect.height;
      layoutNodes(neuralState);
    }
  }

  // Build node graph from tasks
  const nodes = state.tasks.map((task, i) => {
    const sizeMultiplier = PRIORITY_SIZES[task.priority] || 1.0;
    const baseRadius = 18;
    return {
      id: task.id,
      task,
      x: 0, y: 0,
      targetX: 0, targetY: 0,
      vx: 0, vy: 0,
      radius: baseRadius * sizeMultiplier,
      color: NEURAL_COLORS[task.status] || NEURAL_COLORS.backlog,
      phase: Math.random() * Math.PI * 2,   // animation phase offset
      pulsePhase: Math.random() * Math.PI * 2,
      hovered: false,
    };
  });

  // Build synapse connections from deps
  const synapses = [];
  state.tasks.forEach(task => {
    (task.deps || []).forEach(depId => {
      const fromNode = nodes.find(n => n.id === depId);
      const toNode = nodes.find(n => n.id === task.id);
      if (fromNode && toNode) {
        synapses.push({
          from: fromNode,
          to: toNode,
          pulseOffset: Math.random(),
          active: task.status === 'active' || task.status === 'review',
        });
      }
    });
  });

  const rect = wrap.getBoundingClientRect();
  neuralState = {
    ctx, canvas, wrap,
    nodes, synapses,
    w: rect.width,
    h: rect.height,
    frame: 0,
    hoveredNode: null,
    mouse: { x: -1000, y: -1000 },
    animId: null,
  };

  resize();
  layoutNodes(neuralState);

  // Initial position — start at target
  nodes.forEach(n => { n.x = n.targetX; n.y = n.targetY; });

  // Start render loop
  neuralState.animId = requestAnimationFrame(() => renderNeuralFrame(neuralState));

  // Mouse interaction
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    neuralState.mouse.x = e.clientX - rect.left;
    neuralState.mouse.y = e.clientY - rect.top;
    updateHover(neuralState);
  });

  canvas.addEventListener('mouseleave', () => {
    neuralState.mouse.x = -1000;
    neuralState.mouse.y = -1000;
    neuralState.hoveredNode = null;
    canvas.style.cursor = 'default';
    neuralState.nodes.forEach(n => n.hovered = false);
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const clicked = findNodeAt(neuralState, mx, my);
    if (clicked) {
      showTaskDetail(clicked.task);
      soundClick();
    }
  });

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    // Reset scale before resize
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resize();
  });
  resizeObserver.observe(wrap);

  // Update stats
  updateTaskStats();
}

// ─── Layout: organic cluster by status ───
function layoutNodes(ns) {
  const w = ns.w;
  const h = ns.h;
  const cx = w / 2;
  const cy = h / 2;
  const pad = 50;

  // Status zones — radial from center
  // Done = outer ring (settled), Active = inner core (firing), Backlog = mid ring, Review = near-inner
  const statusZones = {
    active:  { radiusMin: 0,   radiusMax: 0.25 },
    review:  { radiusMin: 0.2, radiusMax: 0.4 },
    backlog: { radiusMin: 0.35, radiusMax: 0.65 },
    done:    { radiusMin: 0.55, radiusMax: 0.85 },
  };

  // Group nodes by status
  const groups = {};
  ns.nodes.forEach(n => {
    const s = n.task.status;
    if (!groups[s]) groups[s] = [];
    groups[s].push(n);
  });

  const maxR = Math.min(w, h) / 2 - pad;

  Object.entries(groups).forEach(([status, groupNodes]) => {
    const zone = statusZones[status] || statusZones.backlog;
    const count = groupNodes.length;

    groupNodes.forEach((node, i) => {
      // Distribute around a ring within the zone
      const angle = (i / count) * Math.PI * 2 + (status === 'done' ? 0.3 : status === 'backlog' ? 0.8 : 0);
      const ringR = maxR * (zone.radiusMin + (zone.radiusMax - zone.radiusMin) * 0.5);
      // Add slight variation
      const rVariation = maxR * (zone.radiusMax - zone.radiusMin) * 0.3 * (Math.sin(node.id * 2.7) * 0.5 + 0.5);
      const r = ringR + rVariation;

      node.targetX = cx + Math.cos(angle) * r;
      node.targetY = cy + Math.sin(angle) * r;

      // Clamp to visible area
      node.targetX = Math.max(pad, Math.min(w - pad, node.targetX));
      node.targetY = Math.max(pad, Math.min(h - pad, node.targetY));
    });
  });
}

// ─── Find node under cursor ───
function findNodeAt(ns, mx, my) {
  // Check in reverse order (top-drawn nodes first)
  for (let i = ns.nodes.length - 1; i >= 0; i--) {
    const n = ns.nodes[i];
    const dx = mx - n.x;
    const dy = my - n.y;
    const hitR = n.radius + 6; // generous hit area
    if (dx * dx + dy * dy < hitR * hitR) return n;
  }
  return null;
}

// ─── Update hover state ───
function updateHover(ns) {
  const prev = ns.hoveredNode;
  ns.hoveredNode = findNodeAt(ns, ns.mouse.x, ns.mouse.y);
  ns.canvas.style.cursor = ns.hoveredNode ? 'pointer' : 'default';

  ns.nodes.forEach(n => {
    n.hovered = (n === ns.hoveredNode);
  });
}

// ─── Render frame ───
function renderNeuralFrame(ns) {
  ns.frame++;
  const { ctx, w, h, nodes, synapses, frame } = ns;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // ─── Ambient grid (very subtle) ───
  const gridSpacing = 60;
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.015)';
  ctx.lineWidth = 0.5;
  for (let x = gridSpacing; x < w; x += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = gridSpacing; y < h; y += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // ─── Physics: gentle spring toward target ───
  const springK = 0.03;
  const damping = 0.88;
  const drift = 0.15; // gentle organic drift

  nodes.forEach(n => {
    // Spring force toward target
    const dx = n.targetX - n.x;
    const dy = n.targetY - n.y;
    n.vx += dx * springK;
    n.vy += dy * springK;

    // Organic drift (breathing movement)
    const driftX = Math.sin(frame * 0.008 + n.phase) * drift;
    const driftY = Math.cos(frame * 0.006 + n.phase * 1.3) * drift;
    n.vx += driftX;
    n.vy += driftY;

    // Damping
    n.vx *= damping;
    n.vy *= damping;

    // Apply
    n.x += n.vx;
    n.y += n.vy;
  });

  // ─── Draw synapses (connections) ───
  synapses.forEach(syn => {
    const from = syn.from;
    const to = syn.to;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);

    // Curved connection
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const perpX = -(to.y - from.y) * 0.15;
    const perpY = (to.x - from.x) * 0.15;
    ctx.quadraticCurveTo(midX + perpX, midY + perpY, to.x, to.y);

    // Base line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ─── Pulse along synapse (if active) ───
    if (syn.active) {
      const pulseT = ((frame * 0.012 + syn.pulseOffset) % 1);

      // Calculate point along curve
      const t = pulseT;
      const t2 = 1 - t;
      const px = t2 * t2 * from.x + 2 * t2 * t * (midX + perpX) + t * t * to.x;
      const py = t2 * t2 * from.y + 2 * t2 * t * (midY + perpY) + t * t * to.y;

      // Pulse glow
      const pulseColor = to.color.fill;
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, 12);
      gradient.addColorStop(0, pulseColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fill();

      // Pulse dot
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = pulseColor;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Brighter line
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(midX + perpX, midY + perpY, to.x, to.y);
      ctx.strokeStyle = `rgba(${hexToRgb(pulseColor)}, 0.08)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // ─── Draw nodes ───
  nodes.forEach(n => {
    const { x, y, radius, color, task, hovered } = n;
    const isActive = task.status === 'active';
    const isReview = task.status === 'review';
    const isDone = task.status === 'done';

    // Outer glow (for active/review)
    if (color.pulse || hovered) {
      const breathe = Math.sin(frame * 0.04 + n.pulsePhase) * 0.5 + 0.5;
      const glowR = radius + 12 + (hovered ? 8 : 0) + breathe * 8;
      const gradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowR);
      gradient.addColorStop(0, color.glow);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── Agent ownership ring ───
    if (task.owner) {
      const ownerAgent = state.agents.find(a => a.name === task.owner);
      const ringColor = ownerAgent?.signature_color || 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = hovered ? 0.8 : 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Orbiting dot (agent marker)
      if (isActive) {
        const orbitAngle = frame * 0.025 + n.phase;
        const ox = x + Math.cos(orbitAngle) * (radius + 4);
        const oy = y + Math.sin(orbitAngle) * (radius + 4);
        ctx.fillStyle = ringColor;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ─── Node body ───
    const nodeAlpha = isDone ? 0.4 : 1;
    ctx.globalAlpha = nodeAlpha;

    // Fill
    const nodeGrad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
    nodeGrad.addColorStop(0, lightenColor(color.fill, 30));
    nodeGrad.addColorStop(0.7, color.fill);
    nodeGrad.addColorStop(1, darkenColor(color.fill, 20));
    ctx.fillStyle = nodeGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = hovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.stroke();

    ctx.globalAlpha = 1;

    // ─── Priority indicator (inner diamond for urgent/high) ───
    if (task.priority === 'urgent') {
      ctx.fillStyle = '#f87171';
      ctx.globalAlpha = 0.9;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      const ds = 4;
      ctx.fillRect(-ds, -ds, ds * 2, ds * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (task.priority === 'high') {
      ctx.fillStyle = '#f97316';
      ctx.globalAlpha = 0.7;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      const ds = 3;
      ctx.fillRect(-ds, -ds, ds * 2, ds * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ─── Label ───
    const labelAlpha = isDone ? 0.3 : hovered ? 1 : 0.7;
    ctx.globalAlpha = labelAlpha;
    ctx.font = hovered ? 'bold 11px "IBM Plex Sans", sans-serif' : '10px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Truncate title
    const maxLabelW = 90;
    let label = task.title;
    if (ctx.measureText(label).width > maxLabelW) {
      while (label.length > 3 && ctx.measureText(label + '...').width > maxLabelW) {
        label = label.slice(0, -1);
      }
      label += '...';
    }
    ctx.fillText(label, x, y + radius + 6);

    // Owner label (small, below title)
    if (task.owner) {
      ctx.font = '600 8px "Space Mono", monospace';
      ctx.fillStyle = (state.agents.find(a => a.name === task.owner)?.signature_color) || 'rgba(255,255,255,0.4)';
      ctx.globalAlpha = labelAlpha * 0.7;
      ctx.fillText(task.owner.toUpperCase(), x, y + radius + 19);
    }

    ctx.globalAlpha = 1;
  });

  // ─── Center label — "NEURAL MAP" watermark ───
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.font = '900 60px "Orbitron", monospace';
  ctx.fillStyle = '#22d3ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NEURAL', w / 2, h / 2 - 20);
  ctx.font = '400 20px "Orbitron", monospace';
  ctx.fillText('T A S K   M A P', w / 2, h / 2 + 25);
  ctx.restore();

  // Continue
  ns.animId = requestAnimationFrame(() => renderNeuralFrame(ns));
}

// ─── Show task detail panel (rich tabbed) ───
async function showTaskDetail(task) {
  const overlay = document.getElementById('taskDetailOverlay');
  if (!overlay) return;

  const panel = document.getElementById('taskDetailPanel');
  panel.dataset.status = task.status;
  panel.dataset.taskId = task.id;

  // Ensure roster is cached
  await getAgentRoster();

  // ── Title (click to edit) ──
  const titleText = document.getElementById('tdTitleText');
  const titleInput = document.getElementById('tdTitleInput');
  titleText.textContent = task.title;
  titleText.style.display = '';
  titleInput.style.display = 'none';

  titleText.onclick = () => {
    titleInput.value = task.title;
    titleText.style.display = 'none';
    titleInput.style.display = '';
    titleInput.focus();
  };

  const saveTitleFn = async () => {
    const v = titleInput.value.trim();
    if (v && v !== task.title) {
      await updateTask(task.id, { title: v });
      task.title = v;
    }
    titleText.textContent = task.title;
    titleInput.style.display = 'none';
    titleText.style.display = '';
  };
  titleInput.onblur = saveTitleFn;
  titleInput.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    if (e.key === 'Escape') { titleInput.style.display = 'none'; titleText.style.display = ''; }
  };

  // ── Description (click to edit) ──
  const descText = document.getElementById('tdDescText');
  const descInput = document.getElementById('tdDescInput');
  if (task.description) {
    descText.textContent = task.description;
    descText.classList.remove('td-placeholder');
  } else {
    descText.textContent = 'Add description...';
    descText.classList.add('td-placeholder');
  }
  descText.style.display = '';
  descInput.style.display = 'none';

  descText.onclick = () => {
    descInput.value = task.description || '';
    descText.style.display = 'none';
    descInput.style.display = '';
    descInput.focus();
  };

  const saveDescFn = async () => {
    const v = descInput.value.trim();
    if (v !== (task.description || '')) {
      await updateTask(task.id, { description: v || null });
      task.description = v || null;
    }
    if (task.description) {
      descText.textContent = task.description;
      descText.classList.remove('td-placeholder');
    } else {
      descText.textContent = 'Add description...';
      descText.classList.add('td-placeholder');
    }
    descInput.style.display = 'none';
    descText.style.display = '';
  };
  descInput.onblur = saveDescFn;
  descInput.onkeydown = (e) => {
    if (e.key === 'Escape') { descInput.style.display = 'none'; descText.style.display = ''; }
  };

  // ── Status dropdown ──
  const statusSel = document.getElementById('tdStatus');
  statusSel.innerHTML = '';
  ['backlog', 'active', 'review', 'done', 'blocked'].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s.toUpperCase();
    if (s === task.status) opt.selected = true;
    statusSel.appendChild(opt);
  });
  statusSel.style.color = NEURAL_COLORS[task.status]?.fill || '';
  statusSel.onchange = async () => {
    statusSel.style.color = NEURAL_COLORS[statusSel.value]?.fill || '';
    await updateTask(task.id, { status: statusSel.value });
    task.status = statusSel.value;
    panel.dataset.status = task.status;
  };

  // ── Priority dropdown ──
  const priSel = document.getElementById('tdPriority');
  priSel.innerHTML = '';
  const priColors = { critical: '#f87171', high: '#f97316', medium: '', low: '' };
  ['critical', 'high', 'medium', 'low'].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p.toUpperCase();
    if (p === task.priority) opt.selected = true;
    priSel.appendChild(opt);
  });
  priSel.style.color = priColors[task.priority] || '';
  priSel.onchange = async () => {
    priSel.style.color = priColors[priSel.value] || '';
    await updateTask(task.id, { priority: priSel.value });
    task.priority = priSel.value;
  };

  // ── Assigned dropdown (from roster) ──
  const assignSel = document.getElementById('tdAssigned');
  assignSel.innerHTML = '';
  const unOpt = document.createElement('option');
  unOpt.value = ''; unOpt.textContent = 'Unassigned';
  assignSel.appendChild(unOpt);
  (agentRosterCache || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = a.name;
    opt.style.color = a.signature_color || '';
    if (a.name === task.owner) opt.selected = true;
    assignSel.appendChild(opt);
  });
  assignSel.onchange = async () => {
    const val = assignSel.value || null;
    await updateTask(task.id, { assigned_agent: val });
    task.assigned_agent = val;
    task.owner = val;
  };

  // ── Domain dropdown ──
  const domainSel = document.getElementById('tdDomain');
  domainSel.innerHTML = '';
  ['work', 'system', 'trading', 'personal'].forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    if (d === task.domain) opt.selected = true;
    domainSel.appendChild(opt);
  });
  domainSel.onchange = async () => {
    await updateTask(task.id, { domain: domainSel.value });
    task.domain = domainSel.value;
  };

  // ── Created date + Session badge + ClickUp link ──
  document.getElementById('tdCreated').textContent = 'Created ' + niceDate(task.created_at);

  const sessionBadge = document.getElementById('tdSessionBadge');
  if (task.session_url) {
    sessionBadge.href = task.session_url;
    const isLive = task.status === 'active';
    sessionBadge.className = 'td-session-badge' + (isLive ? ' td-session-live' : ' td-session-replay');
    sessionBadge.innerHTML = isLive ? '<span class="session-live-dot"></span> Live' : '📼 Session';
    sessionBadge.style.display = '';
  } else {
    sessionBadge.style.display = 'none';
  }

  const clickupEl = document.getElementById('tdClickUp');
  if (task.clickup_id) {
    clickupEl.href = `https://app.clickup.com/t/${task.clickup_id}`;
    clickupEl.style.display = '';
  } else {
    clickupEl.style.display = 'none';
  }

  // ── Tabs setup ──
  const tabs = panel.querySelectorAll('.td-tab');
  const panes = panel.querySelectorAll('.td-tab-pane');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      panes.forEach(p => p.style.display = 'none');
      const target = panel.querySelector(`.td-tab-pane[data-pane="${tab.dataset.tab}"]`);
      if (target) target.style.display = '';
    };
  });

  // Reset to comments tab
  tabs.forEach(t => t.classList.remove('active'));
  tabs[0].classList.add('active');
  panes.forEach(p => p.style.display = 'none');
  panes[0].style.display = '';

  // Show overlay
  overlay.style.display = 'flex';

  // ── Load comments ──
  loadDetailComments(task.id);

  // ── Load deliverables ──
  loadDetailDeliverables(task.id);

  // ── Load log ──
  renderDetailLog(task);

  // ── Wire comment form ──
  const commentSendBtn = document.getElementById('tdCommentSend');
  commentSendBtn.onclick = async () => {
    const input = document.getElementById('tdCommentInput');
    const body = input.value.trim();
    if (!body) return;
    const type = document.getElementById('tdCommentType').value;
    commentSendBtn.disabled = true;
    commentSendBtn.textContent = '...';
    await postComment(task.id, body, type);
    input.value = '';
    commentSendBtn.disabled = false;
    commentSendBtn.textContent = 'Send';
    loadDetailComments(task.id);
  };

  // ── Wire deliverable form ──
  const delivAddBtn = document.getElementById('tdDelivAdd');
  delivAddBtn.onclick = async () => {
    const title = document.getElementById('tdDelivTitle').value.trim();
    if (!title) return;
    delivAddBtn.disabled = true;
    delivAddBtn.textContent = '...';
    await postDeliverable(task.id, {
      title,
      url: document.getElementById('tdDelivUrl').value.trim() || null,
      deliverable_type: document.getElementById('tdDelivType').value,
      content: document.getElementById('tdDelivContent').value.trim() || null,
    });
    document.getElementById('tdDelivTitle').value = '';
    document.getElementById('tdDelivUrl').value = '';
    document.getElementById('tdDelivContent').value = '';
    delivAddBtn.disabled = false;
    delivAddBtn.textContent = '+ Add Deliverable';
    loadDetailDeliverables(task.id);
  };
}

async function loadDetailComments(taskId) {
  const list = document.getElementById('tdCommentsList');
  list.innerHTML = '<div class="td-empty">Loading...</div>';
  const comments = await fetchComments(taskId);
  const countEl = document.getElementById('tdCommentCount');
  if (countEl) countEl.textContent = comments.length ? `(${comments.length})` : '';

  if (comments.length === 0) {
    list.innerHTML = '<div class="td-empty">No comments yet</div>';
    return;
  }

  list.innerHTML = '';
  comments.forEach(c => {
    const color = getAgentColor(c.author);
    const el = document.createElement('div');
    el.className = 'td-comment';
    el.innerHTML = `
      <div class="td-comment-header">
        <span class="td-comment-dot" style="background:${color}"></span>
        <span class="td-comment-author">${escapeHtml(c.author || 'unknown')}</span>
        <span class="td-comment-type" data-type="${escapeHtml(c.comment_type || 'comment')}">${escapeHtml(c.comment_type || 'comment')}</span>
        <span class="td-comment-time">${relativeTime(c.created_at)}</span>
      </div>
      <div class="td-comment-body">${escapeHtml(c.body || '')}</div>
    `;
    list.appendChild(el);
  });
}

async function loadDetailDeliverables(taskId) {
  const list = document.getElementById('tdDeliverablesList');
  list.innerHTML = '<div class="td-empty">Loading...</div>';
  const deliverables = await fetchDeliverables(taskId);
  const countEl = document.getElementById('tdDeliverableCount');
  if (countEl) countEl.textContent = deliverables.length ? `(${deliverables.length})` : '';

  if (deliverables.length === 0) {
    list.innerHTML = '<div class="td-empty">No deliverables yet</div>';
    return;
  }

  const typeIcons = { link: '🔗', note: '📄', screenshot: '📸', markdown: '📝', code: '💻', file: '📁' };
  list.innerHTML = '';
  deliverables.forEach(d => {
    const el = document.createElement('div');
    el.className = 'td-deliverable' + (d.deliverable_type === 'screenshot' ? ' td-deliverable-screenshot' : '') + (d.deliverable_type === 'markdown' ? ' td-deliverable-markdown' : '');
    const icon = typeIcons[d.deliverable_type] || '📄';

    // Render based on type
    let contentHtml = '';
    if (d.deliverable_type === 'screenshot' && d.url) {
      // Screenshot: render as clickable thumbnail
      contentHtml = `
        <div class="td-screenshot-wrap">
          <img class="td-screenshot-thumb" src="${escapeHtml(d.url)}" alt="${escapeHtml(d.title)}" loading="lazy" />
          <div class="td-screenshot-overlay" title="View full size">⤢</div>
        </div>
      `;
    } else if (d.deliverable_type === 'screenshot' && d.content) {
      // Screenshot with base64 content
      contentHtml = `
        <div class="td-screenshot-wrap">
          <img class="td-screenshot-thumb" src="data:image/png;base64,${d.content}" alt="${escapeHtml(d.title)}" loading="lazy" />
          <div class="td-screenshot-overlay" title="View full size">⤢</div>
        </div>
      `;
    } else if (d.deliverable_type === 'markdown' && d.content) {
      // Markdown: render inline with basic formatting
      contentHtml = `<div class="td-markdown-content">${renderBasicMarkdown(d.content)}</div>`;
    } else if (d.content) {
      contentHtml = `<div class="td-deliverable-preview">${escapeHtml(d.content)}</div>`;
    }

    el.innerHTML = `
      <span class="td-deliverable-icon">${icon}</span>
      <div class="td-deliverable-info">
        <div class="td-deliverable-title">${escapeHtml(d.title)}</div>
        ${d.url && d.deliverable_type !== 'screenshot' ? `<a class="td-deliverable-url" href="${escapeHtml(d.url)}" target="_blank">${escapeHtml(d.url)}</a>` : ''}
        ${contentHtml}
      </div>
      <button class="td-deliverable-delete" data-did="${d.id}" title="Delete">×</button>
    `;

    // Screenshot click-to-expand
    const thumb = el.querySelector('.td-screenshot-thumb');
    if (thumb) {
      const wrap = el.querySelector('.td-screenshot-wrap');
      wrap.onclick = () => wrap.classList.toggle('td-screenshot-expanded');
    }

    // Expand/collapse content preview (for non-markdown, non-screenshot)
    const preview = el.querySelector('.td-deliverable-preview');
    if (preview) preview.onclick = () => preview.classList.toggle('expanded');

    // Markdown expand/collapse
    const mdContent = el.querySelector('.td-markdown-content');
    if (mdContent) {
      const toggle = document.createElement('button');
      toggle.className = 'td-markdown-toggle';
      toggle.textContent = '▾ Expand';
      toggle.onclick = () => {
        mdContent.classList.toggle('expanded');
        toggle.textContent = mdContent.classList.contains('expanded') ? '▴ Collapse' : '▾ Expand';
      };
      el.querySelector('.td-deliverable-info').insertBefore(toggle, mdContent.nextSibling);
    }

    // Delete handler
    el.querySelector('.td-deliverable-delete').onclick = async (e) => {
      e.stopPropagation();
      await deleteDeliverable(taskId, d.id);
      loadDetailDeliverables(taskId);
    };
    list.appendChild(el);
  });
}

function renderDetailLog(task) {
  const list = document.getElementById('tdLogList');
  list.innerHTML = '';
  const entries = [
    { label: 'CREATED', value: task.created_at },
    { label: 'UPDATED', value: task.updated_at },
    { label: 'COMPLETED', value: task.completed_at },
  ];
  entries.forEach(e => {
    if (!e.value) return;
    const el = document.createElement('div');
    el.className = 'td-log-entry';
    el.innerHTML = `
      <span class="td-log-label">${e.label}</span>
      <span class="td-log-value">${niceDate(e.value)}</span>
      <span class="td-comment-time">${relativeTime(e.value)}</span>
    `;
    list.appendChild(el);
  });
  if (list.children.length === 0) {
    list.innerHTML = '<div class="td-empty">No log entries</div>';
  }
}

function initTaskToolbarActions() {
  const syncBtn = document.getElementById('tasksSyncBtn');
  const addBtn = document.getElementById('tasksAddBtn');

  if (syncBtn) syncBtn.addEventListener('click', () => { syncClickUp(); soundClick(); });

  if (addBtn) addBtn.addEventListener('click', () => {
    soundClick();
    showAddTaskModal();
  });
}

function showAddTaskModal() {
  let modal = document.getElementById('addTaskModal');
  if (modal) { modal.style.display = 'flex'; return; }

  modal = document.createElement('div');
  modal.id = 'addTaskModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)';

  modal.innerHTML = `
    <div style="background:var(--os-surface, #1a1a2e);border:1px solid rgba(34,211,238,0.2);border-radius:8px;padding:20px;width:360px;max-width:90vw;font-family:var(--os-font-mono)">
      <div style="color:#22d3ee;font-size:12px;margin-bottom:16px;letter-spacing:1px">◉ NEW TASK</div>
      <input id="addTaskTitle" placeholder="Task title…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:8px 10px;border-radius:4px;font-size:13px;font-family:inherit;margin-bottom:10px" />
      <textarea id="addTaskDesc" placeholder="Description (optional)" rows="2" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:8px 10px;border-radius:4px;font-size:12px;font-family:inherit;margin-bottom:10px;resize:vertical"></textarea>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <select id="addTaskPriority" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:6px 8px;border-radius:4px;font-size:12px;font-family:inherit">
          <option value="medium">Medium</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
        <select id="addTaskDomain" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:6px 8px;border-radius:4px;font-size:12px;font-family:inherit">
          <option value="work">Work</option>
          <option value="system">System</option>
          <option value="trading">Trading</option>
          <option value="personal">Personal</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="addTaskCancel" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#94a3b8;padding:6px 14px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit">Cancel</button>
        <button id="addTaskSubmit" style="background:rgba(34,211,238,0.15);border:1px solid rgba(34,211,238,0.3);color:#22d3ee;padding:6px 14px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.getElementById('addTaskCancel').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('addTaskSubmit').addEventListener('click', async () => {
    const title = document.getElementById('addTaskTitle').value.trim();
    if (!title) return;
    await createTask({
      title,
      description: document.getElementById('addTaskDesc').value.trim() || null,
      priority: document.getElementById('addTaskPriority').value,
      domain: document.getElementById('addTaskDomain').value,
      status: 'backlog',
    });
    document.getElementById('addTaskTitle').value = '';
    document.getElementById('addTaskDesc').value = '';
    modal.style.display = 'none';
  });

  document.getElementById('addTaskTitle').focus();
}

// ─── Update task stats in toolbar ───
function updateTaskStats() {
  const activeCount = state.tasks.filter(t => t.status === 'active').length;
  const totalCount = state.tasks.length;
  const el1 = document.getElementById('tasksActiveCount');
  const el2 = document.getElementById('tasksTotalCount');
  if (el1) el1.textContent = activeCount + ' active';
  if (el2) el2.textContent = totalCount + ' total';
}

// ─── Color utilities for neural rendering ───
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255';
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `rgb(${R}, ${G}, ${B})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
  const B = Math.max(0, (num & 0x0000FF) - amt);
  return `rgb(${R}, ${G}, ${B})`;
}

/* ═══════════════════════════════════════════════════
   SCOUT — Opportunity Radar
   ═══════════════════════════════════════════════════ */
const SCOUT_API = 'https://trading-desk-api-production.roguefamilyfarms.workers.dev/api/desk/scout';

async function renderScoutWindow() {
  const cardsEl = document.getElementById('scoutCards');
  const trendsEl = document.getElementById('scoutTrends');
  const metaEl = document.getElementById('scoutMeta');
  if (!cardsEl) return;

  try {
    const res = await fetch(SCOUT_API);
    if (!res.ok) throw new Error('No data');
    const data = await res.json();
    const opps = data.opportunities || [];

    metaEl.textContent = `${opps.length} opportunities • Last scan: ${data.scan_date || 'today'}`;

    // Trends
    if (data.trends_noticed?.length) {
      trendsEl.innerHTML = `
        <div class="scout-trends-title">TRENDS DETECTED</div>
        ${data.trends_noticed.map(t => `<div class="scout-trend-item">→ ${escapeHtml(t)}</div>`).join('')}
      `;
    }

    // Opportunity cards
    if (opps.length === 0) {
      cardsEl.innerHTML = '<div class="scout-empty">No opportunities passed the filter. Scout is selective.</div>';
      return;
    }

    cardsEl.innerHTML = opps.map(opp => {
      const scoreClass = opp.match_score >= 85 ? 'score-high' : opp.match_score >= 75 ? 'score-mid' : 'score-low';
      return `
        <div class="scout-card">
          <div class="scout-card-header">
            <div>
              <div class="scout-card-title">${escapeHtml(opp.title)}</div>
              <div class="scout-card-source">${escapeHtml(opp.source || '')}</div>
            </div>
            <div class="scout-score ${scoreClass}">${opp.match_score}%</div>
          </div>
          <div class="scout-card-body">${escapeHtml(opp.what || '')}</div>
          <div class="scout-card-grid">
            <div class="scout-stat"><div class="scout-stat-label">REVENUE</div><div class="scout-stat-value scout-revenue">${escapeHtml(opp.revenue_potential || '?')}</div></div>
            <div class="scout-stat"><div class="scout-stat-label">STARTUP</div><div class="scout-stat-value">${escapeHtml(opp.startup_cost || '?')}</div></div>
            <div class="scout-stat"><div class="scout-stat-label">TIME</div><div class="scout-stat-value">${escapeHtml(opp.time_investment || '?')}</div></div>
            <div class="scout-stat"><div class="scout-stat-label">WHY NOW</div><div class="scout-stat-value scout-whynow">${escapeHtml((opp.why_now || '').substring(0, 120))}</div></div>
          </div>
          <div class="scout-tags">${(opp.leverages || []).map(l => `<span class="scout-tag">${escapeHtml(l)}</span>`).join('')}</div>
          ${opp.nicole_role ? `<div class="scout-nicole"><span class="scout-nicole-label">Nicole's Role:</span> ${escapeHtml(opp.nicole_role)}</div>` : ''}
          <div class="scout-next-step"><strong>NEXT STEP</strong><br>${escapeHtml(opp.next_step || '')}</div>
        </div>`;
    }).join('');
  } catch (e) {
    cardsEl.innerHTML = '<div class="scout-empty">Scout data unavailable. Runs weekly on Sundays.</div>';
  }
}

/* ═══════════════════════════════════════════════════
   QUICK ACTIONS
   ═══════════════════════════════════════════════════ */
(function initQuickActions() {
  const btn = document.getElementById('qaNewTask');
  const modal = document.getElementById('newTaskModal');
  const cancelBtn = document.getElementById('newTaskCancel');
  const submitBtn = document.getElementById('newTaskSubmit');
  const titleInput = document.getElementById('newTaskTitle');
  if (!btn || !modal) return;

  btn.addEventListener('click', () => {
    modal.style.display = 'flex';
    titleInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  submitBtn?.addEventListener('click', async () => {
    const title = titleInput?.value?.trim();
    if (!title) return;
    try {
      await fetch(TASK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          priority: document.getElementById('newTaskPriority')?.value || 'normal',
          domain: document.getElementById('newTaskDomain')?.value || 'work',
          owner: document.getElementById('newTaskOwner')?.value || null,
          description: document.getElementById('newTaskDesc')?.value || '',
        }),
      });
      modal.style.display = 'none';
      titleInput.value = '';
      document.getElementById('newTaskDesc').value = '';
      // Refresh task board if open
      if (LIVE_TASKS) { await fetchTasks(); renderTaskList(); renderTaskBoard(); updateTaskStats(); }
    } catch (e) { console.error('Failed to create task:', e); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') modal.style.display = 'none';
  });
})();
