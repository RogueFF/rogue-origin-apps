// ─── Shared Card Renderer — Glass Console Pass 2 ────────────────────
// Used by both popup.js and panel.js to render notification cards.
// All emoji replaced with inline SVG icons. Premium briefing redesign.

// ─── SVG Icon Library ───────────────────────────────────────────────
// Monoline 16px icons, use currentColor or explicit accent color.

const SVG_ICONS = {
  // Alert / Warning — triangle with exclamation
  alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  warning: null, // alias

  // Production / Chart — bar chart
  chart: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  production: null, // alias

  // Weather — sun
  weather: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  sun: null, // alias
  cloud: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,

  // Shipment / Route — truck
  shipment: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  truck: null, // alias
  route: null, // alias

  // Default pin / update — map pin
  pin: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  update: null, // alias

  // Briefing — file text
  briefing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,

  // Toast / info — info circle
  toast: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,

  // Audio speaker
  speaker: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,

  // Clock
  clock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,

  // Mission control / command
  command: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>`,
};

// Set up aliases
SVG_ICONS.warning = SVG_ICONS.alert;
SVG_ICONS.production = SVG_ICONS.chart;
SVG_ICONS.sun = SVG_ICONS.weather;
SVG_ICONS.truck = SVG_ICONS.shipment;
SVG_ICONS.route = SVG_ICONS.shipment;
SVG_ICONS.update = SVG_ICONS.pin;

/**
 * Get an SVG icon by key. Returns the SVG string or a fallback dot.
 */
function getIcon(key) {
  if (!key) return SVG_ICONS.pin;
  const normalized = key.toLowerCase().trim();
  return SVG_ICONS[normalized] || SVG_ICONS.pin;
}

// ─── Utilities ──────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Extract a hero stat from segment text.
 * Looks for patterns like "93.3 lbs", "$4,200", "12 trimmers", "78°F", "108.6%", etc.
 */
function extractHeroStat(text) {
  if (!text) return null;
  // Match numbers with optional decimals, commas, dollar signs, percent, degree, unit suffixes
  const patterns = [
    /(\$[\d,]+(?:\.\d+)?)/,                           // $4,200
    /([\d,]+(?:\.\d+)?\s*%)/,                          // 108.6%
    /([\d,]+(?:\.\d+)?°[FC]?)/,                        // 78°F
    /([\d,]+(?:\.\d+)?\s*(?:lbs?|kg|oz|tons?))\b/i,    // 93.3 lbs
    /([\d,]+(?:\.\d+)?\s*(?:bags?|boxes|units?))\b/i,  // 12 bags
    /([\d,]+(?:\.\d+)?\s*(?:trimmers?|crew))\b/i,      // 12 trimmers
    /([\d,]+(?:\.\d+)?\s*(?:mph|km\/h))\b/i,           // 15 mph
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }

  // Fallback: first standalone number with optional decimal
  const numMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return numMatch ? numMatch[1] : null;
}

// ─── Toast Card ─────────────────────────────────────────────────────

function renderToastCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="toast">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">${SVG_ICONS.toast}</span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
    </div>
  `;
}

// ─── Premium Briefing Card — Intel Brief Design ─────────────────────

function renderBriefingCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';

  let contentHtml = '';
  if (n.data && n.data.segments && n.data.segments.length > 0) {
    const segments = n.data.segments;

    // Build the timeline layout with hero stat extraction
    const segmentCards = segments.map((seg, i) => {
      const icon = getIcon(seg.icon);
      const label = escapeHtml(seg.label || seg.category || 'Update');
      const text = seg.text || seg.summary || '';
      const heroStat = extractHeroStat(text);

      // Remove the hero stat from the body text to avoid duplication
      let bodyText = text;
      if (heroStat) {
        bodyText = text.replace(heroStat, '').replace(/^\s*[,.\-—:]+\s*/, '').trim();
        // If removing the stat left us with nothing meaningful, show original
        if (bodyText.length < 5) bodyText = text;
      }

      const heroHtml = heroStat
        ? `<div class="intel-hero-stat">${escapeHtml(heroStat)}</div>`
        : '';

      const delay = i * 80;

      return `
        <div class="intel-segment" style="animation-delay: ${delay}ms">
          <div class="intel-timeline-node">
            <div class="intel-node-dot"></div>
            ${i < segments.length - 1 ? '<div class="intel-node-line"></div>' : ''}
          </div>
          <div class="intel-segment-card">
            <div class="intel-segment-header">
              <span class="intel-segment-icon">${icon}</span>
              <span class="intel-segment-label">${label}</span>
            </div>
            ${heroHtml}
            <div class="intel-segment-body">${escapeHtml(bodyText)}</div>
          </div>
        </div>
      `;
    }).join('');

    contentHtml = `<div class="intel-timeline">${segmentCards}</div>`;
  } else if (n.body) {
    contentHtml = `<div class="notif-body">${escapeHtml(n.body)}</div>`;
  }

  // Audio controls for panel view
  const audioHtml = n.audio_url ? `
    <div class="briefing-audio-controls">
      <button class="btn-audio" data-audio="${escapeHtml(n.audio_url)}" data-notif-id="${n.id}">
        ${SVG_ICONS.speaker} <span class="btn-audio-label">Replay</span>
      </button>
    </div>
  ` : '';

  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="briefing">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">${SVG_ICONS.briefing}</span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      ${contentHtml}
      ${audioHtml}
    </div>
  `;
}

// ─── Alert Card ─────────────────────────────────────────────────────

function renderAlertCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const acked = n.acknowledged ? ' acknowledged' : '';
  const ackBtn = n.acknowledged ? '' : `
    <div class="alert-footer">
      <button class="btn-acknowledge" data-ack-id="${n.id}">Acknowledge</button>
    </div>
  `;

  return `
    <div class="notif-card card-enter${unread}${acked}" data-id="${n.id}" data-type="alert">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg notif-icon-alert">${SVG_ICONS.alert}</span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      ${ackBtn}
    </div>
  `;
}

// ─── Production Card with Fixed SVG Gauges ──────────────────────────

function renderProductionCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';
  const pct = d.percentOfTarget || 0;

  // Stats
  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '—';
  const target = pct || 0;
  const crew = d.trimmers || d.crew || 0;
  const rate = d.rate ? d.rate.toFixed(2) : '0';

  // Color based on pace
  const gaugeColor = paceClass === 'ahead' ? 'green' : paceClass === 'behind' ? 'red' : 'gold';

  // ─── FIXED GAUGE FILL MATH ──────────────────────
  // LBS: fill based on percent of target. If target is known, lbs/expectedLbs.
  //       Use percentOfTarget as proxy: if 108.6% of target → 108.6% fill (capped at visual max 120%)
  const lbsFill = Math.min(pct, 120);

  // TARGET: the percentage itself. 100% = full ring. >100% shows overflow glow.
  const targetFill = Math.min(target, 120);

  // RATE: max baseline ~2.0 lbs/person/hr. So fill = (rate / 2.0) * 100
  const rateNum = parseFloat(rate) || 0;
  const rateFill = Math.min((rateNum / 2.0) * 100, 120);

  // CREW: max baseline ~20. So fill = (crew / 20) * 100
  const crewFill = Math.min((crew / 20) * 100, 100);

  // Sparkline from hourly data
  let sparkHtml = '';
  if (d.hourly && d.hourly.length > 0) {
    const maxVal = Math.max(...d.hourly.map(h => h.actual || 0), 1);
    sparkHtml = `<div class="prod-sparkline">
      ${d.hourly.map(h => {
        const height = Math.max(((h.actual || 0) / maxVal) * 100, 5);
        const barPace = (h.actual || 0) >= (h.target || d.targetRate || 0) ? 'ahead' : 'behind';
        return `<div class="prod-sparkline-bar ${barPace}" style="height:${height}%"></div>`;
      }).join('')}
    </div>`;
  }

  return `
    <div class="notif-card card-enter${unread} pace-${paceClass}" data-id="${n.id}" data-type="production-card">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">${SVG_ICONS.chart}</span>
          <span class="notif-title">${escapeHtml(n.title || 'Hourly Production')}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="prod-stats-grid">
        ${renderGaugeStat(lbs, 'LBS', gaugeColor, lbsFill, target > 100)}
        ${renderGaugeStat(target + '%', 'TARGET', gaugeColor, targetFill, target > 100)}
        ${renderGaugeStat(crew, 'CREW', gaugeColor, crewFill, false)}
        ${renderGaugeStat(rate, 'RATE', gaugeColor, rateFill, false)}
      </div>
      ${sparkHtml}
      <div class="prod-pace">
        <span class="prod-pace-text ${paceClass}">${paceLabel}</span>
        <span class="prod-pace-pct ${paceClass}">${pct}%</span>
      </div>
    </div>
  `;
}

// ─── SVG Circular Gauge with Overflow Glow ──────────────────────────

function renderGaugeStat(value, label, color, percent, overflow) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  // Clamp visual fill at 100% for the ring, overflow gets a glow effect
  const visualPercent = Math.min(percent, 100);
  const offset = circumference - (visualPercent / 100) * circumference;

  // Overflow glow class when exceeding 100%
  const overflowClass = overflow ? ' gauge-overflow' : '';
  const glowFilter = overflow
    ? `<filter id="glow-${label}"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    : '';
  const filterAttr = overflow ? ` filter="url(#glow-${label})"` : '';

  return `
    <div class="prod-stat${overflowClass}">
      <svg class="prod-gauge" viewBox="0 0 60 60">
        <defs>${glowFilter}</defs>
        <circle class="prod-gauge-bg" cx="30" cy="30" r="${radius}"></circle>
        <circle class="prod-gauge-fill ${color}" cx="30" cy="30" r="${radius}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"${filterAttr}></circle>
        <text class="prod-gauge-value" x="30" y="34" text-anchor="middle" dominant-baseline="central">${value}</text>
      </svg>
      <div class="prod-stat-label">${label}</div>
    </div>
  `;
}

// ─── Sound Wave Animation (for audio buttons) ──────────────────────

function renderSoundWave() {
  return `<span class="sound-wave"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>`;
}

// ─── Main Dispatcher ────────────────────────────────────────────────

function renderCard(n) {
  switch (n.type) {
    case 'briefing': return renderBriefingCard(n);
    case 'alert': return renderAlertCard(n);
    case 'production-card': return renderProductionCard(n);
    default: return renderToastCard(n);
  }
}
