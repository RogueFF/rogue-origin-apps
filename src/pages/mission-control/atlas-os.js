/* ═══════════════════════════════════════════════════════════════
   ATLAS OS — Mission Control v0.1
   Window manager, data layer, UI controllers, sound design
   ═══════════════════════════════════════════════════════════════ */

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
  windows: new Map(),
  nextZ: 100,
  focusedWindow: null,
  dragState: null,
  resizeState: null,
  isMobile: window.innerWidth <= 768,
  soundEnabled: false, // User opts in via tray click
  connected: true,
};

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
  const [regime, plays, portfolio, positions, brief] = await Promise.all([
    apiFetch('/regime'),
    apiFetch('/plays'),
    apiFetch('/portfolio'),
    apiFetch('/positions?status=open'),
    apiFetch('/briefs/latest'),
  ]);

  if (regime || plays || portfolio) {
    renderTradingDesk(regime, plays, portfolio, positions, brief);
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

  container.innerHTML = `
    <div class="trading-status-bar">
      <span class="trading-market-status ${shiftActive ? 'market-open' : 'market-closed'}">${shiftIndicator}</span>
      <span class="trading-refresh-rate">${shiftActive ? 'Refreshing every 60s' : 'Refreshing every 5m'}</span>
    </div>
    <div class="work-grid">
      ${buildProductionCard(production)}
    </div>
  `;
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

  container.innerHTML = `
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
  `;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  if (id === 'trading') fetchTradingData();
  if (id === 'work') fetchWorkData();
  if (id === 'github') fetchGitHubData();
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
function renderTradingDesk(regime, plays, portfolio, positions, brief) {
  const container = document.getElementById('tradingMain');
  if (!container) return;

  const marketOpen = isMarketHours();
  const liveIndicator = marketOpen
    ? '<span class="live-dot"></span> LIVE'
    : 'CLOSED';

  const openPositions = Array.isArray(positions) ? positions : (portfolio?.positions || []);
  const degenPlay = brief?.degen_play || null;

  const html = `
    <div class="trading-status-bar">
      <span class="trading-market-status ${marketOpen ? 'market-open' : 'market-closed'}">${liveIndicator}</span>
      <span class="trading-refresh-rate">${marketOpen ? 'Refreshing every 60s' : 'Refreshing every 5m'}</span>
    </div>
    ${buildRegimeBanner(regime)}
    <div class="trading-desk-content">
      ${buildPlaysSection(plays)}
      ${buildPortfolioStrip(portfolio, openPositions)}
      ${degenPlay ? buildDegenPlay(degenPlay) : ''}
    </div>
  `;

  container.innerHTML = html;
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

// ─── NEW: Full-width regime banner (hero element) ───
function buildRegimeBanner(data) {
  if (!data) {
    return `
      <div class="regime-banner regime-neutral">
        <div class="regime-banner-signal">NEUTRAL</div>
        <div class="regime-banner-meta">
          <span class="regime-banner-label">No regime data</span>
        </div>
      </div>
    `;
  }

  const signal = (data.signal || 'NEUTRAL').toUpperCase();
  const signalClass = signal === 'GREEN' ? 'regime-green' : signal === 'YELLOW' ? 'regime-yellow' : signal === 'RED' ? 'regime-red' : 'regime-neutral';
  const label = data.label || '';

  // Parse SPY and VIX from the text data field if it exists
  let spy = '—';
  let vix = '—';
  let yield10y = '—';

  if (typeof data.data === 'string') {
    // Parse from text blob: "SPY: $681.75 (+0.07% today)" and "VIX: 20.6 (elevated)"
    const spyMatch = data.data.match(/SPY:\s*\$?([\d.,]+)/i);
    const vixMatch = data.data.match(/VIX:\s*([\d.]+)/i);
    const yieldMatch = data.data.match(/10Y\s+Yield:\s*([\d.]+%?)/i);

    if (spyMatch) spy = `$${spyMatch[1]}`;
    if (vixMatch) vix = vixMatch[1];
    if (yieldMatch) yield10y = yieldMatch[1];
  } else {
    // Fallback to object structure
    const mktData = data.data || {};
    spy = mktData.spy_price || data.spy_price || '—';
    vix = mktData.vix || mktData.vix_level || data.vix_level || data.vix || '—';
    yield10y = mktData.yield_10y || mktData['10y_yield'] || data.yield_10y || '—';
  }

  const strategyObj = data.strategy || {};
  const strategyNote = typeof strategyObj === 'string' ? strategyObj : (strategyObj.position_sizing || strategyObj.strategies || '');

  return `
    <div class="regime-banner ${signalClass}">
      <div class="regime-banner-signal">${escapeHtml(signal)}</div>
      <div class="regime-banner-content">
        ${label ? `<div class="regime-banner-label">${escapeHtml(label)}</div>` : ''}
        <div class="regime-banner-data">
          <span class="regime-banner-metric"><strong>SPY</strong> ${escapeHtml(String(spy))}</span>
          <span class="regime-banner-divider">·</span>
          <span class="regime-banner-metric"><strong>VIX</strong> ${escapeHtml(String(vix))}</span>
          ${yield10y !== '—' ? `<span class="regime-banner-divider">·</span><span class="regime-banner-metric"><strong>10Y</strong> ${escapeHtml(String(yield10y))}</span>` : ''}
        </div>
        ${strategyNote ? `<div class="regime-banner-strategy">${escapeHtml(strategyNote)}</div>` : ''}
      </div>
    </div>
  `;
}

// ─── Legacy regime card (kept for compatibility) ───
function buildRegimeCard(data) {
  if (!data) {
    return `
      <div class="trading-card regime-card">
        <div class="trading-card-header">
          <span class="trading-card-title">Market Regime</span>
        </div>
        <div class="trading-card-body">
          <div class="regime-error">Data unavailable</div>
        </div>
      </div>
    `;
  }

  const signal = (data.signal || 'NEUTRAL').toUpperCase();
  const signalColor = signal === 'GREEN' ? '#22c55e' : signal === 'YELLOW' ? '#eab308' : '#ef4444';
  const timestamp = data.created_at ? formatTime(data.created_at) : 'Unknown';

  // REGIME API: signal and label at top level, SPY/VIX in TEXT blob 'data' field
  let spy = '—';
  let vix = '—';
  let trend = '—';

  if (typeof data.data === 'string') {
    // Parse from text blob: "SPY: $681.75" and "VIX: 20.6"
    const spyMatch = data.data.match(/SPY:\s*\$?([\d.,]+)/i);
    const vixMatch = data.data.match(/VIX:\s*([\d.]+)/i);
    if (spyMatch) spy = `$${spyMatch[1]}`;
    if (vixMatch) vix = vixMatch[1];
  }

  // Fallback to legacy object structure if available
  const mktData = typeof data.data === 'object' ? data.data : {};
  if (spy === '—') spy = mktData.spy_price || data.spy_price || '—';
  if (vix === '—') vix = mktData.vix || mktData.vix_level || data.vix_level || data.vix || '—';
  trend = mktData.spy_trend || mktData.trend || data.trend || '—';
  const factors = Array.isArray(mktData.factors) ? mktData.factors : (Array.isArray(data.factors) ? data.factors : []);
  const reasoning = factors.length > 0 ? factors : (Array.isArray(data.reasoning) ? data.reasoning : []);
  const strategyObj = data.strategy || {};
  const strategy = typeof strategyObj === 'string' ? strategyObj : (strategyObj.position_sizing ? [
    strategyObj.position_sizing,
    strategyObj.strategies,
    strategyObj.stops,
    strategyObj.new_entries
  ].filter(Boolean).join(' · ') : '');

  return `
    <div class="trading-card regime-card">
      <div class="trading-card-header">
        <span class="trading-card-title">Market Regime</span>
        <span class="regime-timestamp">${escapeHtml(timestamp)}</span>
      </div>
      <div class="trading-card-body">
        <div class="regime-signal" style="--signal-color: ${signalColor}">
          <div class="regime-signal-indicator">${escapeHtml(signal)}</div>
          ${data.label ? `<div class="regime-signal-label">${escapeHtml(data.label)}</div>` : ''}
        </div>
        <div class="regime-data">
          <div class="regime-data-row">
            <span class="regime-data-label">SPY</span>
            <span class="regime-data-value">${escapeHtml(String(spy))}</span>
          </div>
          <div class="regime-data-row">
            <span class="regime-data-label">VIX</span>
            <span class="regime-data-value">${escapeHtml(String(vix))}</span>
          </div>
          <div class="regime-data-row">
            <span class="regime-data-label">Trend</span>
            <span class="regime-data-value">${escapeHtml(String(trend))}</span>
          </div>
        </div>
        ${reasoning.length > 0 ? `
          <div class="regime-reasoning">
            <div class="regime-reasoning-title">Analysis</div>
            <ul class="regime-reasoning-list">
              ${reasoning.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${strategy ? `
          <div class="regime-strategy">
            <div class="regime-strategy-title">Strategy</div>
            <div class="regime-strategy-text">${escapeHtml(strategy)}</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ─── NEW: Plays section with analyst scores (hero content) ───
function buildPlaysSection(data) {
  const plays = Array.isArray(data) ? data : (data?.plays || []);

  if (plays.length === 0) {
    return `
      <div class="plays-section">
        <div class="plays-section-header">
          <span class="plays-section-title">Today's Plays</span>
          <span class="plays-count">0 setups</span>
        </div>
        <div class="plays-empty">
          <div class="empty-glyph">◻</div>
          <p>No plays structured today. Atlas Squad is monitoring markets.</p>
        </div>
      </div>
    `;
  }

  // Sort plays by analyst_score descending, then by approved status
  const sortedPlays = [...plays].sort((a, b) => {
    const aApproved = a.status === 'approved' || a.analyst_verdict === 'APPROVED';
    const bApproved = b.status === 'approved' || b.analyst_verdict === 'APPROVED';
    if (aApproved && !bApproved) return -1;
    if (!aApproved && bApproved) return 1;
    return (b.analyst_score || 0) - (a.analyst_score || 0);
  });

  return `
    <div class="plays-section">
      <div class="plays-section-header">
        <span class="plays-section-title">Today's Plays</span>
        <span class="plays-count">${plays.length} setup${plays.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="plays-grid">
        ${sortedPlays.map(play => {
          const ticker = play.ticker || '—';
          const direction = (play.direction || 'LONG').toUpperCase();
          const directionClass = direction === 'BULL' || direction === 'BULLISH' || direction === 'LONG' ? 'bull' : 'bear';
          const vehicle = play.vehicle || play.type || '—';

          // PLAYS API: setup.entry.{strike, expiry, premium}, setup.target.price, setup.stop.price, setup.size
          const setupEntry = play.setup?.entry || {};
          const setupTarget = play.setup?.target || {};
          const setupStop = play.setup?.stop || {};

          const strike = setupEntry.strike || play.strike || '';
          const expiry = setupEntry.expiry || play.expiry;
          const formattedExpiry = expiry ? formatDate(expiry) : '';

          // Entry price: setup.entry.premium
          const entry = setupEntry.premium || play.entry_price || play.entry || 0;

          // Target: setup.target.price (handle "$3.10" string format)
          let target = setupTarget.price || play.target_price || play.target || 0;
          if (typeof target === 'string' && target.startsWith('$')) {
            target = parseFloat(target.replace('$', ''));
          }

          // Stop: setup.stop.price (handle "$0.00" string format)
          let stop = setupStop.price || play.stop_price || play.stop || 0;
          if (typeof stop === 'string' && stop.startsWith('$')) {
            stop = parseFloat(stop.replace('$', ''));
          }

          // Risk/reward and size: top level risk_reward, setup.size
          const rrRatio = play.risk_reward || play.rr_ratio || play.reward_risk || '—';
          const positionSize = play.setup?.size || play.position_size || play.size || '';

          // Analyst fields: top level analyst_score, analyst_verdict
          const analystScore = play.analyst_score || 0;
          const analystVerdict = (play.analyst_verdict || play.status || 'PENDING').toUpperCase();
          const isApproved = analystVerdict === 'APPROVED';
          const isRejected = analystVerdict === 'REJECTED' || analystVerdict === 'DECLINED';
          const thesis = play.thesis || play.rationale || '';

          const cardClass = isApproved ? 'play-approved' : isRejected ? 'play-rejected' : 'play-pending';
          const scoreColor = analystScore >= 8 ? '#22c55e' : analystScore >= 6 ? '#eab308' : '#ef4444';

          return `
            <div class="play-card ${cardClass}">
              <div class="play-card-header">
                <div class="play-card-ticker-row">
                  <span class="play-card-ticker">${escapeHtml(ticker)}</span>
                  <span class="play-card-direction ${directionClass}">${escapeHtml(direction)}</span>
                </div>
                <div class="play-card-score" style="--score-color: ${scoreColor}">
                  <span class="play-score-value">${analystScore.toFixed(1)}</span>
                  <span class="play-score-label">/10</span>
                </div>
              </div>
              <div class="play-card-vehicle">${escapeHtml(vehicle)}${strike ? ` · ${strike}` : ''}${expiry ? ` · exp ${expiry}` : ''}</div>
              <div class="play-card-prices">
                <div class="play-price-item">
                  <span class="play-price-label">Entry</span>
                  <span class="play-price-value">${formatCurrency(entry)}</span>
                </div>
                <div class="play-price-item">
                  <span class="play-price-label">Target</span>
                  <span class="play-price-value positive">${formatCurrency(target)}</span>
                </div>
                <div class="play-price-item">
                  <span class="play-price-label">Stop</span>
                  <span class="play-price-value negative">${formatCurrency(stop)}</span>
                </div>
                <div class="play-price-item">
                  <span class="play-price-label">R:R</span>
                  <span class="play-price-value">${escapeHtml(String(rrRatio))}</span>
                </div>
              </div>
              ${positionSize ? `<div class="play-card-size">Size: ${escapeHtml(positionSize)}</div>` : ''}
              <div class="play-card-verdict ${analystVerdict.toLowerCase()}">
                ${isApproved ? '✓' : isRejected ? '✗' : '○'} ${escapeHtml(analystVerdict)}
              </div>
              ${thesis ? `<div class="play-card-thesis">${escapeHtml(thesis)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── Legacy plays card (kept for compatibility) ───
function buildPlaysCard(data) {
  const plays = Array.isArray(data) ? data : (data?.plays || []);

  if (plays.length === 0) {
    return `
      <div class="trading-card plays-card">
        <div class="trading-card-header">
          <span class="trading-card-title">Today's Plays</span>
          <span class="plays-count">0 setups</span>
        </div>
        <div class="trading-card-body">
          <div class="plays-empty">No plays structured today</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="trading-card plays-card">
      <div class="trading-card-header">
        <span class="trading-card-title">Today's Plays</span>
        <span class="plays-count">${plays.length} setup${plays.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="trading-card-body">
        <div class="plays-list">
          ${plays.map(play => {
            const ticker = play.ticker || '—';
            const direction = play.direction || 'LONG';
            const vehicle = play.vehicle || '—';
            const thesis = play.thesis || '';
            const risk = play.risk_level || 'MEDIUM';
            const riskClass = risk.toLowerCase();

            return `
              <div class="play-item">
                <div class="play-header">
                  <span class="play-ticker">${escapeHtml(ticker)}</span>
                  <span class="play-direction ${direction.toLowerCase()}">${escapeHtml(direction)}</span>
                  <span class="play-risk ${riskClass}">${escapeHtml(risk)}</span>
                </div>
                <div class="play-vehicle">${escapeHtml(vehicle)}</div>
                ${thesis ? `<div class="play-thesis">${escapeHtml(thesis)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function buildPortfolioCard(data, closedTrades) {
  if (!data) {
    return `
      <div class="trading-card portfolio-card">
        <div class="trading-card-header">
          <span class="trading-card-title">Portfolio</span>
        </div>
        <div class="trading-card-body">
          <div class="portfolio-error">Data unavailable</div>
        </div>
      </div>
    `;
  }

  const bankroll = data.portfolio_value || data.bankroll || 0;
  const unrealizedPnl = data.unrealized_pnl || 0;
  const realizedPnl = data.realized_pnl || 0;
  const totalPnl = unrealizedPnl + realizedPnl;
  const winRate = data.win_rate || 0;
  const positions = Array.isArray(data.positions) ? data.positions : (Array.isArray(data.open_positions) ? data.open_positions : []);
  const closed = Array.isArray(closedTrades) ? closedTrades : [];

  const pnlClass = totalPnl >= 0 ? 'positive' : 'negative';
  const pnlSign = totalPnl >= 0 ? '+' : '';

  // Performance stats — show dashes when no closed trades
  const hasClosedTrades = closed.length > 0 || winRate > 0;
  const expectancy = data.expectancy || 0;
  const avgWin = data.avg_winner || 0;
  const avgLoss = data.avg_loser || 0;
  const openExposure = data.open_exposure || 0;
  const exposurePct = bankroll > 0 ? ((openExposure / bankroll) * 100).toFixed(1) : '0.0';

  // Equity bar segments
  const startingBankroll = data.starting_bankroll || bankroll;
  const realizedGains = Math.max(0, realizedPnl);
  const realizedLosses = Math.abs(Math.min(0, realizedPnl));
  const absUnrealized = Math.abs(unrealizedPnl);
  const equityTotal = realizedGains + realizedLosses + absUnrealized || 1;
  const greenPct = ((realizedGains / equityTotal) * 100).toFixed(1);
  const redPct = ((realizedLosses / equityTotal) * 100).toFixed(1);
  const grayPct = ((absUnrealized / equityTotal) * 100).toFixed(1);

  // Build closed trades HTML
  const closedTradesHtml = closed.length > 0 ? `
    <div class="portfolio-closed-trades">
      <div class="portfolio-positions-title">Closed Trades</div>
      <div class="closed-trades-list">
        ${closed.map(trade => {
          const ticker = trade.ticker || '—';
          const vehicle = trade.vehicle || trade.type || '';
          const pnl = trade.pnl || 0;
          const pnlColor = pnl > 0 ? 'var(--sig-green, #22c55e)' : pnl < 0 ? 'var(--sig-red, #ef4444)' : 'var(--os-text-muted)';
          const pnlPrefix = pnl > 0 ? '+' : '';
          const closedAt = trade.closed_at || trade.updated_at || '';
          const closeDate = closedAt ? new Date(closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          const notes = trade.notes || '';
          // Extract close reason — use first phrase from notes or 'closed'
          const reason = notes ? notes.split(/[.;,]/)[0].trim() : '';
          return `
            <div class="closed-trade-item">
              <div class="closed-trade-header">
                <span class="closed-trade-ticker">${escapeHtml(ticker)}</span>
                <span class="closed-trade-vehicle">${escapeHtml(vehicle)}</span>
                <span class="closed-trade-date">Closed ${escapeHtml(closeDate)}</span>
              </div>
              <div class="closed-trade-footer">
                <span class="closed-trade-pnl" style="color: ${pnlColor}">P&L: ${pnlPrefix}${formatCurrency(pnl)}</span>
                ${reason ? `<span class="closed-trade-reason">${escapeHtml(reason)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  return `
    <div class="trading-card portfolio-card">
      <div class="trading-card-header">
        <span class="trading-card-title">Portfolio</span>
      </div>
      <div class="trading-card-body">
        <div class="portfolio-stats">
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Bankroll</span>
            <span class="portfolio-stat-value">${formatCurrency(bankroll)}</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Total P&L</span>
            <span class="portfolio-stat-value ${pnlClass}">${pnlSign}${formatCurrency(totalPnl)}</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Win Rate</span>
            <span class="portfolio-stat-value">${hasClosedTrades ? winRate + '%' : '—'}</span>
          </div>
        </div>
        <div class="portfolio-perf-stats">
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Expectancy</span>
            <span class="portfolio-stat-value">${hasClosedTrades ? formatCurrency(expectancy) : '—'}</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Avg Win</span>
            <span class="portfolio-stat-value positive">${hasClosedTrades ? formatCurrency(avgWin) : '—'}</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Avg Loss</span>
            <span class="portfolio-stat-value negative">${hasClosedTrades ? formatCurrency(avgLoss) : '—'}</span>
          </div>
          <div class="portfolio-stat">
            <span class="portfolio-stat-label">Exposure</span>
            <span class="portfolio-stat-value">${exposurePct}%</span>
          </div>
        </div>
        <div class="equity-bar-container">
          <div class="equity-bar-label">Equity</div>
          <div class="equity-bar">
            <div class="equity-bar-segment equity-bar-green" style="width: ${greenPct}%"></div>
            <div class="equity-bar-segment equity-bar-red" style="width: ${redPct}%"></div>
            <div class="equity-bar-segment equity-bar-gray" style="width: ${grayPct}%"></div>
          </div>
        </div>
        ${positions.length > 0 ? `
          <div class="portfolio-positions">
            <div class="portfolio-positions-title">Open Positions</div>
            <div class="positions-list">
              ${positions.map(pos => {
                const ticker = pos.ticker || '—';
                const entry = pos.entry_price || pos.entry || 0;
                const target = pos.target_price || pos.target || 0;
                const currentPrice = pos.current_price || entry;
                const pnl = pos.current_pnl || 0;
                const size = pos.quantity || pos.size || 0;
                const vehicle = pos.vehicle || pos.type || 'shares';
                const direction = pos.direction || '';
                const notes = pos.notes || '';
                const isDegen = notes.includes('⭐');
                const pnlColor = pnl > 0 ? 'var(--sig-green, #22c55e)' : pnl < 0 ? 'var(--sig-red, #ef4444)' : 'var(--os-text-muted)';
                const pnlSign = pnl > 0 ? '+' : '';
                const strike = pos.strike || '';
                const expiry = pos.expiry || '';

                return `
                  <div class="position-item${isDegen ? ' position-degen' : ''}">
                    <div class="position-header">
                      <span class="position-ticker">${isDegen ? '⭐ ' : ''}${escapeHtml(ticker)}</span>
                      <span class="position-pnl" style="color: ${pnlColor}">${pnlSign}${formatCurrency(pnl)}</span>
                    </div>
                    <div class="position-meta">
                      <span>${escapeHtml(direction)} ${size}x ${escapeHtml(vehicle)}${strike ? ' $' + strike : ''}${expiry ? ' · ' + escapeHtml(expiry) : ''}</span>
                    </div>
                    <div class="position-levels">
                      <span class="position-level">Entry: ${formatCurrency(entry)}</span>
                      <span class="position-level">Now: <strong style="color: ${pnlColor}">${formatCurrency(currentPrice)}</strong></span>
                      <span class="position-level">Target: ${formatCurrency(target)}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
        ${closedTradesHtml}
      </div>
    </div>
  `;
}

// ─── NEW: Portfolio strip (persistent summary) ───
function buildPortfolioStrip(portfolio, openPositions) {
  if (!portfolio) {
    return `
      <div class="portfolio-strip">
        <div class="portfolio-strip-stat">
          <span class="portfolio-strip-label">Portfolio</span>
          <span class="portfolio-strip-value">—</span>
        </div>
      </div>
    `;
  }

  const bankroll = portfolio.portfolio_value || portfolio.bankroll || 0;
  const cash = portfolio.available_cash || portfolio.cash || 0;
  const totalPnl = (portfolio.unrealized_pnl || 0) + (portfolio.realized_pnl || 0);
  const winRate = portfolio.win_rate || 0;
  const pnlClass = totalPnl >= 0 ? 'positive' : 'negative';
  const pnlSign = totalPnl >= 0 ? '+' : '';
  const positions = Array.isArray(openPositions) ? openPositions : [];

  return `
    <div class="portfolio-strip">
      <div class="portfolio-strip-header">
        <span class="portfolio-strip-title">Portfolio</span>
        <div class="portfolio-strip-stats">
          <div class="portfolio-strip-stat">
            <span class="portfolio-strip-label">Value</span>
            <span class="portfolio-strip-value">${formatCurrency(bankroll)}</span>
          </div>
          <div class="portfolio-strip-stat">
            <span class="portfolio-strip-label">Cash</span>
            <span class="portfolio-strip-value">${formatCurrency(cash)}</span>
          </div>
          <div class="portfolio-strip-stat">
            <span class="portfolio-strip-label">P&L</span>
            <span class="portfolio-strip-value ${pnlClass}">${pnlSign}${formatCurrency(totalPnl)}</span>
          </div>
          <div class="portfolio-strip-stat">
            <span class="portfolio-strip-label">Win Rate</span>
            <span class="portfolio-strip-value">${winRate}%</span>
          </div>
        </div>
      </div>
      ${positions.length > 0 ? `
        <div class="portfolio-strip-positions">
          ${positions.map(pos => {
            const ticker = pos.ticker || '—';
            const direction = (pos.direction || '').toLowerCase();
            const entry = pos.entry_price || pos.entry || 0;
            const current = pos.current_price || entry;
            const pnl = pos.current_pnl || pos.pnl || 0;
            const pnlColor = pnl > 0 ? '#22c55e' : pnl < 0 ? '#ef4444' : 'var(--os-text-muted)';
            const pnlSign = pnl > 0 ? '+' : '';
            return `
              <div class="portfolio-strip-position">
                <span class="strip-pos-ticker ${direction}">${escapeHtml(ticker)}</span>
                <span class="strip-pos-entry">${formatCurrency(entry)} → ${formatCurrency(current)}</span>
                <span class="strip-pos-pnl" style="color: ${pnlColor}">${pnlSign}${formatCurrency(pnl)}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : '<div class="portfolio-strip-empty">No open positions</div>'}
    </div>
  `;
}

// ─── NEW: Degen play (YOLO section with danger styling) ───
function buildDegenPlay(degen) {
  if (!degen) return '';

  const ticker = degen.ticker || '—';
  const rrRatio = degen.rr_ratio || degen.reward_risk || '—';
  const thesis = degen.thesis || degen.rationale || '';
  const size = degen.position_size || degen.size || '1% max';
  const vehicle = degen.vehicle || degen.type || '';
  const entry = degen.entry_price || degen.entry || 0;
  const target = degen.target_price || degen.target || 0;
  const stop = degen.stop_price || degen.stop || 0;

  return `
    <div class="degen-play">
      <div class="degen-play-header">
        <div class="degen-play-title">
          <span class="degen-play-icon">⚠️</span>
          <span class="degen-play-label">DEGEN PLAY</span>
        </div>
        <div class="degen-play-warning">HIGH RISK · YOLO ONLY</div>
      </div>
      <div class="degen-play-content">
        <div class="degen-play-ticker-row">
          <span class="degen-play-ticker">${escapeHtml(ticker)}</span>
          <span class="degen-play-rr">R:R ${escapeHtml(String(rrRatio))}</span>
        </div>
        ${vehicle ? `<div class="degen-play-vehicle">${escapeHtml(vehicle)}</div>` : ''}
        ${thesis ? `<div class="degen-play-thesis">${escapeHtml(thesis)}</div>` : ''}
        <div class="degen-play-levels">
          <div class="degen-level-item">
            <span class="degen-level-label">Entry</span>
            <span class="degen-level-value">${formatCurrency(entry)}</span>
          </div>
          <div class="degen-level-item">
            <span class="degen-level-label">Target</span>
            <span class="degen-level-value">${formatCurrency(target)}</span>
          </div>
          <div class="degen-level-item">
            <span class="degen-level-label">Stop</span>
            <span class="degen-level-value">${formatCurrency(stop)}</span>
          </div>
        </div>
        <div class="degen-play-size">Max Size: ${escapeHtml(size)}</div>
      </div>
    </div>
  `;
}

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

const PRIORITY_SIZES = { urgent: 1.5, high: 1.25, normal: 1.0, low: 0.8 };

// Mock task data — will be replaced by API when endpoint exists
const MOCK_TASKS = [
  {
    id: 1, title: 'Error handling & loading states', description: 'Phase 3.1 — Add comprehensive error handling and loading states across all modules.',
    status: 'active', priority: 'high', owner: 'friday',
    deps: [3], domain: 'work', created_at: '2026-02-10T08:00:00Z',
  },
  {
    id: 2, title: 'WCAG AA accessibility audit', description: 'Phase 5.1 — Audit and fix accessibility issues. Contrast ratios, focus indicators, ARIA labels.',
    status: 'active', priority: 'high', owner: 'friday',
    deps: [], domain: 'work', created_at: '2026-02-10T09:00:00Z',
  },
  {
    id: 3, title: 'CSS consolidation', description: 'Phase 6.3 — Consolidate duplicate CSS, reduce bundle size, enforce shared-base.css as single source.',
    status: 'review', priority: 'normal', owner: 'friday',
    deps: [], domain: 'work', created_at: '2026-02-08T10:00:00Z',
  },
  {
    id: 4, title: 'Scoreboard optimization', description: 'Phase 4.1 — Optimize scoreboard rendering for floor TV. Reduce repaints, smooth animations.',
    status: 'backlog', priority: 'normal', owner: null,
    deps: [1], domain: 'work', created_at: '2026-02-07T10:00:00Z',
  },
  {
    id: 5, title: 'Morning trading brief — audio pipeline', description: 'Build TTS pipeline for morning briefs. Text-to-speech with Eleven Labs, auto-post to Telegram.',
    status: 'active', priority: 'urgent', owner: 'atlas',
    deps: [], domain: 'trading', created_at: '2026-02-12T06:00:00Z',
  },
  {
    id: 6, title: 'Viper scanner — sentiment v2', description: 'Upgrade sentiment analysis model. Better sarcasm detection, meme stock filtering.',
    status: 'backlog', priority: 'high', owner: 'viper',
    deps: [5], domain: 'trading', created_at: '2026-02-11T14:00:00Z',
  },
  {
    id: 7, title: 'Neural Tasks view', description: 'Build the neural network task visualization for Atlas OS Mission Control.',
    status: 'active', priority: 'urgent', owner: 'friday',
    deps: [], domain: 'system', created_at: '2026-02-13T00:00:00Z',
  },
  {
    id: 8, title: 'Agent SOUL.md authoring', description: 'Write personality and soul files for each agent. Voice, tone, decision-making style.',
    status: 'done', priority: 'normal', owner: 'atlas',
    deps: [], domain: 'system', created_at: '2026-02-05T10:00:00Z',
  },
  {
    id: 9, title: 'D1 migration — production hourly', description: 'Migrate production hourly entry from Google Sheets to D1. Complex — needs offline support.',
    status: 'backlog', priority: 'normal', owner: null,
    deps: [1, 3], domain: 'work', created_at: '2026-02-06T10:00:00Z',
  },
  {
    id: 10, title: 'Webhook security hardening', description: 'Add HMAC signature verification to all Shopify webhook handlers.',
    status: 'done', priority: 'high', owner: 'friday',
    deps: [], domain: 'work', created_at: '2026-02-04T10:00:00Z',
  },
  {
    id: 11, title: 'Darwin portfolio rebalance algo', description: 'Evolutionary algorithm for portfolio rebalancing. Multi-objective: risk, return, correlation.',
    status: 'review', priority: 'high', owner: 'darwin',
    deps: [6], domain: 'trading', created_at: '2026-02-09T10:00:00Z',
  },
  {
    id: 12, title: 'Agent fleet monitoring dashboard', description: 'Real-time health metrics for all agents. CPU, memory, error rates, task throughput.',
    status: 'backlog', priority: 'low', owner: null,
    deps: [7], domain: 'system', created_at: '2026-02-11T10:00:00Z',
  },
  {
    id: 13, title: 'Barcode label template v2', description: 'New label format with QR code, batch info, and COA link. Supports Grove Bag sizing.',
    status: 'done', priority: 'normal', owner: 'friday',
    deps: [], domain: 'work', created_at: '2026-02-03T10:00:00Z',
  },
  {
    id: 14, title: 'Telegram bot — Koa commands', description: 'Build Telegram bot for Koa to issue commands, check status, approve inbox items from phone.',
    status: 'backlog', priority: 'high', owner: 'wire',
    deps: [5], domain: 'system', created_at: '2026-02-12T10:00:00Z',
  },
];

// ─── Task view state ───
let neuralState = null;
let currentTaskView = 'list'; // 'list', 'board', or 'neural'

/* ═══ Task board + neural toggle ═══ */
function initTasksWindow() {
  renderTaskList();
  renderTaskBoard();
  updateTaskStats();
  initTaskViewToggle();
  initTaskDetailClose();
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
    const tasks = MOCK_TASKS
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

      const row = document.createElement('div');
      row.className = 'tl-row' + (group.key === 'done' ? ' tl-row-done' : '');
      row.innerHTML = `
        <span class="tl-pri ${priClass}"></span>
        <span class="tl-title">${escapeHtml(task.title)}</span>
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

    const tasks = MOCK_TASKS.filter(t => t.status === status);

    // Sort: urgent first, then high, then by created date
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    tasks.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    tasks.forEach((task, i) => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.priority = task.priority;
      card.style.setProperty('--card-delay', (i * 60) + 'ms');

      const ownerAgent = task.owner ? state.agents.find(a => a.name === task.owner) : null;
      const ownerColor = ownerAgent?.signature_color || 'var(--os-text-muted)';
      const ownerGlyph = task.owner ? (GLYPH_MAP[task.owner] || '●') : '';

      const showPriority = task.priority === 'urgent' || task.priority === 'high';

      card.innerHTML = `
        <div class="task-card-title">${escapeHtml(task.title)}</div>
        <div class="task-card-footer">
          ${task.owner ? `<span class="task-card-owner"><span class="task-card-owner-dot" style="background:${ownerColor}"></span>${escapeHtml(task.owner)}</span>` : '<span class="task-card-owner" style="opacity:0.3">unassigned</span>'}
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
  const nodes = MOCK_TASKS.map((task, i) => {
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
  MOCK_TASKS.forEach(task => {
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

// ─── Show task detail panel ───
function showTaskDetail(task) {
  const overlay = document.getElementById('taskDetailOverlay');
  if (!overlay) return;

  const panel = overlay.querySelector('.task-detail-panel');
  panel.dataset.status = task.status;

  panel.querySelector('.task-detail-title-text').textContent = task.title;
  panel.querySelector('.task-detail-description').textContent = task.description || '';

  // Meta
  panel.querySelector('.task-detail-status').textContent = task.status.toUpperCase();
  panel.querySelector('.task-detail-status').style.color = NEURAL_COLORS[task.status]?.fill || '';
  panel.querySelector('.task-detail-owner').textContent = task.owner ? task.owner.toUpperCase() : 'UNASSIGNED';
  panel.querySelector('.task-detail-priority').textContent = task.priority.toUpperCase();
  panel.querySelector('.task-detail-priority').style.color =
    task.priority === 'urgent' ? '#f87171' :
    task.priority === 'high' ? '#f97316' : '';
  panel.querySelector('.task-detail-created').textContent = formatTimeFull(task.created_at);

  // Connections
  const depList = panel.querySelector('.task-detail-dep-list');
  depList.innerHTML = '';
  const relatedTasks = MOCK_TASKS.filter(t =>
    (task.deps || []).includes(t.id) ||
    (t.deps || []).includes(task.id)
  );
  if (relatedTasks.length > 0) {
    relatedTasks.forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'task-dep-tag';
      const arrow = (task.deps || []).includes(t.id) ? '← ' : '→ ';
      tag.textContent = arrow + t.title;
      tag.style.borderColor = NEURAL_COLORS[t.status]?.fill || '';
      depList.appendChild(tag);
    });
    panel.querySelector('.task-detail-deps').style.display = '';
  } else {
    panel.querySelector('.task-detail-deps').style.display = 'none';
  }

  overlay.style.display = 'flex';
}

// ─── Update task stats in toolbar ───
function updateTaskStats() {
  const activeCount = MOCK_TASKS.filter(t => t.status === 'active').length;
  const totalCount = MOCK_TASKS.length;
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
