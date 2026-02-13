/* ═══════════════════════════════════════════════════════════════
   ATLAS OS — Mission Control v0.1
   Window manager, data layer, UI controllers, sound design
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = 'https://mission-control-api.roguefamilyfarms.workers.dev/api';
const POLL_INTERVAL = 30000;

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
const WINDOW_DEFS = {
  activity: {
    title: 'Activity Feed',
    icon: '◉',
    template: 'tmpl-activity',
    defaultPos: { x: 140, y: 30 },
    defaultSize: { w: 460, h: 520 },
  },
  agents: {
    title: 'Agent Fleet',
    icon: '⬡',
    template: 'tmpl-agents',
    defaultPos: { x: 620, y: 30 },
    defaultSize: { w: 560, h: 520 },
  },
  inbox: {
    title: 'Inbox',
    icon: '▣',
    template: 'tmpl-inbox',
    defaultPos: { x: 340, y: 80 },
    defaultSize: { w: 480, h: 440 },
  },
  'atlas-chat': {
    title: 'Atlas Chat',
    icon: '◎',
    template: 'tmpl-atlas-chat',
    defaultPos: { x: 200, y: 100 },
    defaultSize: { w: 400, h: 400 },
  },
};


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
  initClock();
  initBgCanvas();
  initDesktopIcons();
  initTaskbar();
  initMobileNav();
  initKeyboard();
  updateTray();

  // Open default windows
  if (state.isMobile) {
    // Mobile: open all windows as stacked cards
    openWindow('agents');
    openWindow('activity');
    openWindow('inbox');
  } else {
    const saved = loadWindowState();
    if (saved && saved.length > 0) {
      saved.forEach(id => openWindow(id));
    } else {
      openWindow('activity');
      openWindow('agents');
    }
  }

  // Start polling
  setInterval(pollData, POLL_INTERVAL);

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

async function pollData() {
  await Promise.all([fetchAgents(), fetchActivity(), fetchInbox()]);
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

  // Position & size
  const pos = loadWindowPos(id) || def.defaultPos;
  const size = loadWindowSize(id) || def.defaultSize;

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
}

function closeWindow(id) {
  const win = state.windows.get(id);
  if (!win) return;
  soundClose();
  win.el.classList.remove('window-visible');
  setTimeout(() => {
    win.el.remove();
    state.windows.delete(id);
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
    // Ctrl+1-4 to open/focus windows
    if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const ids = ['activity', 'agents', 'inbox', 'atlas-chat'];
      const idx = parseInt(e.key) - 1;
      if (ids[idx]) openWindow(ids[idx]);
    }
    // Escape to close focused window
    if (e.key === 'Escape' && state.focusedWindow) {
      closeWindow(state.focusedWindow);
    }
  });
}


/* ═══════════════════════════════════════════════════
   TASKBAR
   ═══════════════════════════════════════════════════ */
function initTaskbar() {
  document.getElementById('menuBtn').addEventListener('click', () => {
    openWindow('activity');
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
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--agent-color', agent.signature_color);
    card.style.setProperty('--card-delay', (i * 50) + 'ms');

    const domainLabel = agent.domain.toUpperCase();

    card.innerHTML = `
      <div class="agent-glyph">${agent.signature_glyph || '●'}</div>
      <div class="agent-name">${escapeHtml(agent.name)}</div>
      <div class="agent-domain">${domainLabel}</div>
      <div class="agent-status">
        <span class="agent-status-dot status-${agent.status || 'idle'}"></span>
        <span>${agent.status || 'idle'}</span>
      </div>
      ${agent.current_task ? `<div class="agent-task" title="${escapeHtml(agent.current_task)}">${escapeHtml(agent.current_task)}</div>` : ''}
    `;

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
    const glyph = agent?.signature_glyph || '●';
    const time = formatTime(item.created_at);

    const el = document.createElement('div');
    el.className = 'activity-item';
    el.style.setProperty('--item-color', color);
    el.style.animationDelay = (i * 50) + 'ms';
    if (item.priority) el.dataset.priority = item.priority;

    el.innerHTML = `
      <div class="activity-item-glyph">${glyph}</div>
      <div class="activity-item-content">
        <div class="activity-item-title">${escapeHtml(item.title)}</div>
        ${item.body ? `<div class="activity-item-body">${escapeHtml(item.body)}</div>` : ''}
        <div class="activity-item-meta">
          <span class="activity-item-agent">${escapeHtml(item.agent_name)}</span>
          <span class="activity-item-time">${time}</span>
        </div>
      </div>
    `;

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
    const glyph = agent?.signature_glyph || '●';
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
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
