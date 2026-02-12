// ─── Shared Card Renderer — Pass 5: Dual Theme ─────────────────────────
// Used by both popup.js and panel.js to render notification cards.
// Supports two themes via document.body.dataset.theme:
//   'relay'   — Glass Console / Hologram Glitch (cyan/gold, transmission aesthetic)
//   'terrain' — Topographic / Land Survey (earth tones, cartographic aesthetic)
//
// Relay cards:  pulse monitor, decoded transmission, red alert VHS, signal toast
// Terrain cards: terrain cross-section, field report, warning post, trail marker

// ─── Theme Helper ─────────────────────────────────────────────────────

function getTheme() {
  return document.body.dataset.theme || 'relay';
}

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

  // Pulse / signal — activity line
  pulse: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,

  // Signal / radio
  signal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>`,

  // Chevron down — for expand/collapse
  chevronDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,

  // Mountain — terrain production icon
  mountain: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21l4-10 4 10"/><path d="M2 21l6-14 4 8"/><path d="M14 15l4-8 4 14"/><line x1="2" y1="21" x2="22" y2="21"/></svg>`,
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

function formatTimestamp(iso) {
  const d = new Date(iso || Date.now());
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();
}

/**
 * Highlight numbers in text with gold glow span.
 */
function highlightNumbers(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(\$?[\d,]+(?:\.\d+)?(?:\s*(?:%|lbs?|kg|oz|bags?|trimmers?|crew|mph|°[FC]?))?)\b/gi,
    '<span class="holo-number">$1</span>'
  );
}

/**
 * Extract a compact one-line summary from segment text.
 * Pulls key numbers, percentages, temperatures, locations.
 */
function extractSegmentSummary(text) {
  if (!text) return '';

  // Try to find meaningful condensed data
  const parts = [];

  // Temperatures: "45°F" patterns
  const tempMatch = text.match(/([\d.]+)\s*°\s*[FC]/i);

  // Percentages: "108.6%"
  const pctMatch = text.match(/([\d.]+)\s*%/);

  // Pounds: "93.3 lbs"
  const lbsMatch = text.match(/([\d.]+)\s*lbs?/i);

  // Weather conditions: common words after temperature
  const condMatch = text.match(/(?:clear|cloudy|rain|snow|overcast|sunny|partly|fog|storm|wind|haze|drizzle|showers)\s*(?:skies?)?/i);

  // Location arrows: city names near "→" or "to" or "ETA"
  const routeMatch = text.match(/(?:in\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:→|to|\.?\s*ETA)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const etaMatch = text.match(/ETA\s+(?:\w+\s+)?(\w+\s+\d+)/i);

  // Rate patterns: "1.25 rate" or "rate of 1.25"
  const rateMatch = text.match(/([\d.]+)\s*rate/i);

  // If we have lbs AND pct, it's likely production
  if (lbsMatch && pctMatch) {
    parts.push(`${lbsMatch[0].trim()}, ${pctMatch[0].trim()}`);
    if (rateMatch) parts[0] += `, ${rateMatch[1]} rate`;
  }
  // Temperature + conditions = weather
  else if (tempMatch) {
    parts.push(tempMatch[0].trim());
    if (condMatch) parts.push(condMatch[0].trim());
  }
  // Route/shipment info
  else if (routeMatch) {
    let route = `${routeMatch[1]} \u2192 ${routeMatch[2]}`;
    if (etaMatch) route += `, ${etaMatch[1]}`;
    parts.push(route);
  }
  // Fallback: just extract first number with context
  else {
    const numMatch = text.match(/([\d,]+(?:\.\d+)?(?:\s*(?:%|lbs?|kg|bags?|°[FC]?))?)/i);
    if (numMatch) {
      parts.push(numMatch[0].trim());
    }
  }

  if (parts.length === 0) {
    // Ultra-fallback: first 40 chars
    return text.length > 40 ? text.substring(0, 40) + '\u2026' : text;
  }

  return parts.join(', ');
}

/**
 * Pick a segment icon character for compact view.
 */
function getSegmentEmoji(iconKey, label) {
  const key = (iconKey || label || '').toLowerCase();
  if (key.includes('product') || key.includes('chart')) return '\u{1F4CA}';
  if (key.includes('weather') || key.includes('sun') || key.includes('cloud')) return '\u{1F324}';
  if (key.includes('ship') || key.includes('truck') || key.includes('route')) return '\u{1F69A}';
  if (key.includes('alert') || key.includes('warn')) return '\u{26A0}';
  if (key.includes('brief') || key.includes('report')) return '\u{1F4CB}';
  return '\u{1F4E1}';
}


// ═══════════════════════════════════════════════════════════════════════
//  TOAST CARD
// ═══════════════════════════════════════════════════════════════════════

// ─── Toast: Relay — "Signal" ─────────────────────────────────────────

function renderToastRelay(n) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="toast">
      <div class="card-scanlines"></div>
      <div class="card-vignette"></div>
      <div class="card-noise-line"></div>
      <div class="toast-scanner-beam"></div>
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">${SVG_ICONS.signal}</span>
          <span class="notif-title holo-flicker">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      <div class="card-timestamp">SIGNAL &bull; ${ts}</div>
    </div>
  `;
}

// ─── Toast: Terrain — "Trail Marker" ─────────────────────────────────

function renderToastTerrain(n) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="toast">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="terrain-trail-dot"></span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      <div class="card-timestamp">MARKER &bull; ${ts}</div>
    </div>
  `;
}

function renderToastCard(n) {
  return getTheme() === 'terrain' ? renderToastTerrain(n) : renderToastRelay(n);
}


// ═══════════════════════════════════════════════════════════════════════
//  BRIEFING CARD
// ═══════════════════════════════════════════════════════════════════════

// ─── Briefing: Relay — "Decoded Transmission" ────────────────────────

function renderBriefingRelay(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const isPopup = options && options.popup;
  const isPanel = options && options.panel;

  let contentHtml = '';
  let segCount = 0;

  if (n.data && n.data.segments && n.data.segments.length > 0) {
    const segments = n.data.segments;
    segCount = segments.length;

    if (isPopup) {
      const compactLines = segments.map((seg, i) => {
        const emoji = getSegmentEmoji(seg.icon, seg.label);
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const summary = extractSegmentSummary(seg.text || seg.summary || '');
        return `
          <div class="compact-segment" style="animation-delay: ${i * 60}ms">
            <span class="compact-segment-emoji">${emoji}</span>
            <span class="compact-segment-label">${label}:</span>
            <span class="compact-segment-summary">${highlightNumbers(summary)}</span>
          </div>
        `;
      }).join('');
      contentHtml = `<div class="compact-transmission">${compactLines}</div>`;
    } else {
      const compactLines = segments.map((seg, i) => {
        const emoji = getSegmentEmoji(seg.icon, seg.label);
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const summary = extractSegmentSummary(seg.text || seg.summary || '');
        return `
          <div class="compact-segment" style="animation-delay: ${i * 60}ms">
            <span class="compact-segment-emoji">${emoji}</span>
            <span class="compact-segment-label">${label}:</span>
            <span class="compact-segment-summary">${highlightNumbers(summary)}</span>
          </div>
        `;
      }).join('');

      const segmentBlocks = segments.map((seg, i) => {
        const icon = getIcon(seg.icon);
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const text = seg.text || seg.summary || '';
        const bodyHtml = highlightNumbers(text);
        const delay = i * 120;
        return `
          <div class="decoded-segment" style="animation-delay: ${delay}ms">
            <div class="decoded-segment-header">
              <span class="decoded-segment-icon">${icon}</span>
              <span class="decoded-segment-label">${label}</span>
            </div>
            <div class="decoded-segment-body holo-typewriter" style="animation-delay: ${delay + 80}ms">${bodyHtml}</div>
          </div>
          ${i < segments.length - 1 ? '<div class="decoded-separator">\u2013 \u2013 \u2013 \u2013 \u2013 \u2013 \u2013 \u2013</div>' : ''}
        `;
      }).join('');

      contentHtml = `
        <div class="compact-transmission card-compact-content">${compactLines}</div>
        <div class="decoded-transmission card-expanded-content">
          ${segmentBlocks}
        </div>
      `;
    }
  } else if (n.body) {
    contentHtml = `<div class="notif-body">${escapeHtml(n.body)}</div>`;
    segCount = 1;
  }

  const audioHtml = n.audio_url ? `
    <div class="briefing-audio-controls">
      <button class="btn-audio" data-audio="${escapeHtml(n.audio_url)}" data-notif-id="${n.id}">
        ${SVG_ICONS.speaker} <span class="btn-audio-label">Replay</span>
      </button>
    </div>
  ` : '';

  const expandToggle = isPanel ? `
    <div class="card-expand-toggle" title="Expand">
      <span class="expand-chevron">${SVG_ICONS.chevronDown}</span>
    </div>
  ` : '';

  return `
    <div class="notif-card card-enter${unread}${isPanel ? ' card-collapsible' : ''}" data-id="${n.id}" data-type="briefing">
      <div class="card-scanlines"></div>
      <div class="card-vignette"></div>
      <div class="card-noise-line"></div>
      <div class="notif-header decoded-header">
        <div class="notif-header-left">
          <span class="decoded-pulse-dot"></span>
          <span class="decoded-incoming holo-chromatic">&#9654; INCOMING BRIEFING</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="decoded-title holo-flicker">${escapeHtml(n.title)}</div>
      ${contentHtml}
      ${audioHtml}
      <div class="card-timestamp">TRANSMISSION COMPLETE &bull; ${segCount} SEGMENT${segCount !== 1 ? 'S' : ''}</div>
      ${expandToggle}
    </div>
  `;
}

// ─── Briefing: Terrain — "Field Report" ──────────────────────────────

function renderBriefingTerrain(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const isPopup = options && options.popup;
  const isPanel = options && options.panel;

  let contentHtml = '';
  let segCount = 0;

  if (n.data && n.data.segments && n.data.segments.length > 0) {
    const segments = n.data.segments;
    segCount = segments.length;

    if (isPopup) {
      // Compact view for popup — report entries with left margin line
      const compactLines = segments.map((seg, i) => {
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const summary = extractSegmentSummary(seg.text || seg.summary || '');
        return `
          <div class="terrain-report-entry compact-segment" style="animation-delay: ${i * 60}ms">
            <span class="terrain-report-label">${label}</span>
            <span class="terrain-report-summary">${highlightNumbers(summary)}</span>
          </div>
        `;
      }).join('');
      contentHtml = `<div class="terrain-report-entries">${compactLines}</div>`;
    } else {
      // Panel compact view
      const compactLines = segments.map((seg, i) => {
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const summary = extractSegmentSummary(seg.text || seg.summary || '');
        return `
          <div class="terrain-report-entry compact-segment" style="animation-delay: ${i * 60}ms">
            <span class="terrain-report-label">${label}</span>
            <span class="terrain-report-summary">${highlightNumbers(summary)}</span>
          </div>
        `;
      }).join('');

      // Full expanded view
      const segmentBlocks = segments.map((seg, i) => {
        const icon = getIcon(seg.icon);
        const label = escapeHtml(seg.label || seg.category || 'Update');
        const text = seg.text || seg.summary || '';
        const bodyHtml = highlightNumbers(text);
        const delay = i * 120;
        return `
          <div class="decoded-segment terrain-report-segment" style="animation-delay: ${delay}ms">
            <div class="decoded-segment-header">
              <span class="decoded-segment-icon">${icon}</span>
              <span class="decoded-segment-label">${label}</span>
            </div>
            <div class="decoded-segment-body" style="animation-delay: ${delay + 80}ms">${bodyHtml}</div>
          </div>
          ${i < segments.length - 1 ? '<div class="decoded-separator"></div>' : ''}
        `;
      }).join('');

      contentHtml = `
        <div class="terrain-report-entries card-compact-content">${compactLines}</div>
        <div class="decoded-transmission card-expanded-content">
          ${segmentBlocks}
        </div>
      `;
    }
  } else if (n.body) {
    contentHtml = `<div class="notif-body">${escapeHtml(n.body)}</div>`;
    segCount = 1;
  }

  const audioHtml = n.audio_url ? `
    <div class="briefing-audio-controls">
      <button class="btn-audio" data-audio="${escapeHtml(n.audio_url)}" data-notif-id="${n.id}">
        ${SVG_ICONS.speaker} <span class="btn-audio-label">Replay</span>
      </button>
    </div>
  ` : '';

  const expandToggle = isPanel ? `
    <div class="card-expand-toggle" title="Expand">
      <span class="expand-chevron">${SVG_ICONS.chevronDown}</span>
    </div>
  ` : '';

  return `
    <div class="notif-card card-enter${unread}${isPanel ? ' card-collapsible' : ''}" data-id="${n.id}" data-type="briefing">
      <div class="notif-header decoded-header">
        <div class="notif-header-left">
          <span class="decoded-incoming">\u{1F4CB} FIELD REPORT</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="decoded-title">${escapeHtml(n.title)}</div>
      ${contentHtml}
      ${audioHtml}
      <div class="card-timestamp">END OF REPORT &bull; ${segCount} ENTR${segCount !== 1 ? 'IES' : 'Y'}</div>
      ${expandToggle}
    </div>
  `;
}

function renderBriefingCard(n, options) {
  return getTheme() === 'terrain' ? renderBriefingTerrain(n, options) : renderBriefingRelay(n, options);
}


// ═══════════════════════════════════════════════════════════════════════
//  ALERT CARD
// ═══════════════════════════════════════════════════════════════════════

// ─── Alert: Relay — "Red Alert" ──────────────────────────────────────

function renderAlertRelay(n) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const acked = n.acknowledged ? ' acknowledged' : '';
  const ackBtn = n.acknowledged
    ? '<div class="alert-footer"><div class="alert-acked-inline">[ CONFIRMED ]</div></div>'
    : `<div class="alert-footer">
        <button class="btn-acknowledge" data-ack-id="${n.id}">[ ACKNOWLEDGE ]</button>
      </div>`;

  return `
    <div class="notif-card card-enter${unread}${acked}" data-id="${n.id}" data-type="alert">
      <div class="card-scanlines"></div>
      <div class="card-vignette"></div>
      <div class="card-noise-line"></div>
      ${!n.acknowledged ? '<div class="alert-glitch-overlay"></div>' : ''}
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg notif-icon-alert holo-chromatic-strong">${SVG_ICONS.alert}</span>
          <span class="notif-title holo-chromatic-strong holo-flicker">\u26A0 ALERT</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="alert-body-text">${escapeHtml(n.title)}</div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      ${ackBtn}
    </div>
  `;
}

// ─── Alert: Terrain — "Warning Post" ─────────────────────────────────

function renderAlertTerrain(n) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const acked = n.acknowledged ? ' acknowledged' : '';
  const ackBtn = n.acknowledged
    ? '<div class="alert-footer"><div class="alert-acked-inline">[ ACKNOWLEDGED ]</div></div>'
    : `<div class="alert-footer">
        <button class="btn-acknowledge" data-ack-id="${n.id}">[ ACKNOWLEDGED ]</button>
      </div>`;

  return `
    <div class="notif-card card-enter${unread}${acked}" data-id="${n.id}" data-type="alert">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg notif-icon-alert">${SVG_ICONS.alert}</span>
          <span class="notif-title terrain-warning-title">\u26A1 WARNING</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="alert-body-text">${escapeHtml(n.title)}</div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      ${ackBtn}
    </div>
  `;
}

function renderAlertCard(n) {
  return getTheme() === 'terrain' ? renderAlertTerrain(n) : renderAlertRelay(n);
}


// ═══════════════════════════════════════════════════════════════════════
//  PRODUCTION CARD
// ═══════════════════════════════════════════════════════════════════════

// ─── Production: Relay — "Pulse Monitor" ─────────────────────────────

function renderProductionRelay(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const isPanel = options && options.panel;

  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '0.0';
  const pct = d.percentOfTarget || 0;
  const crew = d.trimmers || d.crew || 0;
  const rate = d.rate ? d.rate.toFixed(2) : '0.00';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';

  const chartHtml = renderPulseChart(d, paceClass);

  const compactLine = `
    <div class="compact-production card-compact-content">
      <span class="compact-prod-lbs holo-number">${lbs} lbs</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-pct ${paceClass}">${pct}%</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-detail">${crew} crew</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-detail">${rate} rate</span>
      <span class="compact-prod-sep">&mdash;</span>
      <span class="compact-prod-pace ${paceClass}">${paceLabel}</span>
    </div>
  `;

  const expandToggle = isPanel ? `
    <div class="card-expand-toggle" title="Expand">
      <span class="expand-chevron">${SVG_ICONS.chevronDown}</span>
    </div>
  ` : '';

  const fullChart = `
    <div class="pulse-monitor card-expanded-content${isPanel ? '' : ' expanded'}">
      <div class="pulse-chart-area">
        ${chartHtml}
        <div class="pulse-stat pulse-stat-lbs holo-flicker">
          <span class="pulse-stat-value holo-chromatic">${lbs}</span>
          <span class="pulse-stat-unit">LBS</span>
        </div>
        <div class="pulse-stat pulse-stat-pct">
          <span class="pulse-stat-value ${paceClass}">${pct}%</span>
        </div>
        <div class="pulse-stat pulse-stat-crew">
          <span class="pulse-stat-value">${crew}</span>
          <span class="pulse-stat-unit">CREW</span>
        </div>
        <div class="pulse-stat pulse-stat-rate">
          <span class="pulse-stat-value">${rate}</span>
          <span class="pulse-stat-unit">RATE</span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="notif-card card-enter${unread} pace-${paceClass}${isPanel ? ' card-collapsible' : ''}" data-id="${n.id}" data-type="production-card">
      <div class="card-scanlines"></div>
      <div class="card-vignette"></div>
      <div class="card-noise-line"></div>
      <div class="toast-scanner-beam"></div>
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg" style="color:var(--gold)">${SVG_ICONS.pulse}</span>
          <span class="notif-title holo-flicker">Pulse Monitor</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      ${isPanel ? compactLine : ''}
      ${fullChart}
      <div class="card-timestamp">SIGNAL LOCKED &bull; ${ts}</div>
      ${expandToggle}
    </div>
  `;
}

// ─── Production: Terrain — "Terrain Survey" ──────────────────────────

function renderProductionTerrain(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const isPanel = options && options.panel;

  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '0.0';
  const pct = d.percentOfTarget || 0;
  const crew = d.trimmers || d.crew || 0;
  const rate = d.rate ? d.rate.toFixed(2) : '0.00';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';

  const chartHtml = renderTerrainChart(d, paceClass);

  const compactLine = `
    <div class="compact-production card-compact-content">
      <span class="compact-prod-lbs holo-number">${lbs} lbs</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-pct ${paceClass}">${pct}%</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-detail">${crew} crew</span>
      <span class="compact-prod-sep">&bull;</span>
      <span class="compact-prod-detail">${rate} rate</span>
      <span class="compact-prod-sep">&mdash;</span>
      <span class="compact-prod-pace ${paceClass}">${paceLabel}</span>
    </div>
  `;

  const expandToggle = isPanel ? `
    <div class="card-expand-toggle" title="Expand">
      <span class="expand-chevron">${SVG_ICONS.chevronDown}</span>
    </div>
  ` : '';

  const fullChart = `
    <div class="pulse-monitor card-expanded-content${isPanel ? '' : ' expanded'}">
      <div class="pulse-chart-area">
        ${chartHtml}
        <div class="pulse-stat pulse-stat-lbs">
          <span class="pulse-stat-value">${lbs}</span>
          <span class="pulse-stat-unit">ELEVATION</span>
        </div>
        <div class="pulse-stat pulse-stat-pct">
          <span class="pulse-stat-value ${paceClass}">${pct}%</span>
          <span class="pulse-stat-unit">SUMMIT</span>
        </div>
        <div class="pulse-stat pulse-stat-crew">
          <span class="pulse-stat-value">${crew}</span>
          <span class="pulse-stat-unit">PARTY</span>
        </div>
        <div class="pulse-stat pulse-stat-rate">
          <span class="pulse-stat-value">${rate}</span>
          <span class="pulse-stat-unit">PACE</span>
        </div>
      </div>
    </div>
  `;

  return `
    <div class="notif-card card-enter${unread} pace-${paceClass}${isPanel ? ' card-collapsible' : ''}" data-id="${n.id}" data-type="production-card">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg" style="color:var(--accent-blue)">${SVG_ICONS.mountain}</span>
          <span class="notif-title">Terrain Survey</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      ${isPanel ? compactLine : ''}
      ${fullChart}
      <div class="card-timestamp">SURVEY COMPLETE &bull; ${ts}</div>
      ${expandToggle}
    </div>
  `;
}

function renderProductionCard(n, options) {
  return getTheme() === 'terrain' ? renderProductionTerrain(n, options) : renderProductionRelay(n, options);
}


// ═══════════════════════════════════════════════════════════════════════
//  PULSE MONITOR SVG — Relay
// ═══════════════════════════════════════════════════════════════════════

function renderPulseChart(d, paceClass) {
  const hourly = d.hourly || [];
  const targetRate = d.targetRate || 0;

  if (hourly.length === 0) {
    return `
      <svg class="pulse-chart-svg" viewBox="0 0 360 160" preserveAspectRatio="none">
        <line x1="0" y1="80" x2="360" y2="80" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="180" y="90" text-anchor="middle" fill="rgba(255,255,255,0.2)" font-size="12" font-family="'Space Mono', monospace">AWAITING DATA</text>
      </svg>
    `;
  }

  const width = 360;
  const height = 160;
  const padTop = 10;
  const padBottom = 10;
  const chartH = height - padTop - padBottom;

  const maxActual = Math.max(...hourly.map(h => h.actual || 0), targetRate, 1);
  const scale = chartH / (maxActual * 1.15);

  const stepW = width / Math.max(hourly.length - 1, 1);
  const points = hourly.map((h, i) => {
    const x = i * stepW;
    const y = padTop + chartH - (h.actual || 0) * scale;
    return { x, y, actual: h.actual || 0, target: h.target || targetRate };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

  const targetY = padTop + chartH - targetRate * scale;

  let areaSegments = '';
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const aboveTarget = p1.actual >= p1.target && p2.actual >= p2.target;
    areaSegments += `
      <rect x="${p1.x}" y="0" width="${stepW}" height="${height}" fill="url(#${aboveTarget ? 'pulseGradGreen' : 'pulseGradRed'})" opacity="0.6"/>
    `;
  }

  const lineColor = paceClass === 'behind' ? '#ff3344' : '#00ff88';

  return `
    <svg class="pulse-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="pulseGradGreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00ff88" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#00ff88" stop-opacity="0.02"/>
        </linearGradient>
        <linearGradient id="pulseGradRed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff3344" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#ff3344" stop-opacity="0.02"/>
        </linearGradient>
        <clipPath id="areaClip">
          <path d="${areaPath}"/>
        </clipPath>
        <filter id="lineGlow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Area fill clipped to the chart shape -->
      <g clip-path="url(#areaClip)">
        ${areaSegments}
      </g>

      <!-- Target line -->
      <line x1="0" y1="${targetY}" x2="${width}" y2="${targetY}"
        stroke="rgba(228,170,79,0.4)" stroke-width="1" stroke-dasharray="6 4"/>

      <!-- Main line with glow -->
      <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        filter="url(#lineGlow)"/>
      <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>

      <!-- Data point dots -->
      ${points.map(p => {
        const dotColor = p.actual >= p.target ? '#00ff88' : '#ff3344';
        return `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${dotColor}" opacity="0.8"/>`;
      }).join('')}
    </svg>
  `;
}


// ═══════════════════════════════════════════════════════════════════════
//  TERRAIN CROSS-SECTION SVG — Terrain
// ═══════════════════════════════════════════════════════════════════════

function renderTerrainChart(d, paceClass) {
  const hourly = d.hourly || [];
  const targetRate = d.targetRate || 0;

  if (hourly.length === 0) {
    return `
      <svg class="pulse-chart-svg" viewBox="0 0 360 160" preserveAspectRatio="none">
        <line x1="0" y1="80" x2="360" y2="80" stroke="rgba(196,164,106,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="180" y="90" text-anchor="middle" fill="rgba(196,164,106,0.25)" font-size="12" font-family="'IBM Plex Mono', monospace">AWAITING SURVEY</text>
      </svg>
    `;
  }

  const width = 360;
  const height = 160;
  const padTop = 10;
  const padBottom = 10;
  const chartH = height - padTop - padBottom;

  const maxActual = Math.max(...hourly.map(h => h.actual || 0), targetRate, 1);
  const scale = chartH / (maxActual * 1.15);

  const stepW = width / Math.max(hourly.length - 1, 1);
  const points = hourly.map((h, i) => {
    const x = i * stepW;
    const y = padTop + chartH - (h.actual || 0) * scale;
    return { x, y, actual: h.actual || 0, target: h.target || targetRate };
  });

  const linePath = buildSmoothPath(points);
  const areaPath = linePath + ` L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;
  const targetY = padTop + chartH - targetRate * scale;

  // Terrain elevation bands: earth (below target), green (at target), gold (above)
  // We create layered gradients clipped to the terrain shape
  // Contour lines at regular intervals
  const contourInterval = 2; // every 2 lbs
  const contourLines = [];
  if (maxActual > 0) {
    for (let v = contourInterval; v <= maxActual * 1.15; v += contourInterval) {
      const cy = padTop + chartH - v * scale;
      if (cy > padTop && cy < height - padBottom) {
        contourLines.push(cy);
      }
    }
  }

  // Earth tone colors
  const belowColor = '#5a4a32';    // brown/earth
  const atColor = '#6b9e5a';       // forest green
  const aboveColor = '#c4a46a';    // gold/summit

  return `
    <svg class="pulse-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <!-- Terrain elevation gradient — earth to green to gold -->
        <linearGradient id="terrainGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="${belowColor}" stop-opacity="0.5"/>
          <stop offset="${Math.min((targetRate / (maxActual * 1.15)) * 100, 100).toFixed(0)}%" stop-color="${atColor}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${aboveColor}" stop-opacity="0.35"/>
        </linearGradient>
        <clipPath id="terrainClip">
          <path d="${areaPath}"/>
        </clipPath>
      </defs>

      <!-- Terrain fill — elevation bands clipped to terrain shape -->
      <g clip-path="url(#terrainClip)">
        <rect x="0" y="0" width="${width}" height="${height}" fill="url(#terrainGrad)"/>
      </g>

      <!-- Contour lines overlaid on terrain -->
      ${contourLines.map(cy => `
        <line x1="0" y1="${cy}" x2="${width}" y2="${cy}"
          stroke="rgba(196,164,106,0.12)" stroke-width="0.5"
          clip-path="url(#terrainClip)"/>
      `).join('')}

      <!-- Target: dashed "trail" line -->
      <line x1="0" y1="${targetY}" x2="${width}" y2="${targetY}"
        stroke="rgba(196,164,106,0.5)" stroke-width="1.5" stroke-dasharray="8 4" stroke-linecap="round"/>

      <!-- Terrain ridge line -->
      <path d="${linePath}" fill="none" stroke="${paceClass === 'behind' ? '#c45a3e' : '#6b9e5a'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

      <!-- Survey marker dots -->
      ${points.map(p => {
        const dotColor = p.actual >= p.target ? '#6b9e5a' : '#c45a3e';
        return `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${dotColor}" stroke="rgba(42,39,32,0.6)" stroke-width="1"/>`;
      }).join('')}
    </svg>
  `;
}


// ═══════════════════════════════════════════════════════════════════════
//  SHARED SVG PATH BUILDER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a smooth SVG path through a set of points.
 * Uses Catmull-Rom to Bezier conversion for smooth curves.
 */
function buildSmoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return path;
}


// ─── Sound Wave Animation (for audio buttons) ──────────────────────

function renderSoundWave() {
  return `<span class="sound-wave"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>`;
}


// ═══════════════════════════════════════════════════════════════════════
//  WEATHER CARD
// ═══════════════════════════════════════════════════════════════════════

// ─── Weather: Relay — "Atmospheric Scanner" ──────────────────────────

function renderWeatherRelay(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const isPanel = options && options.panel;

  const d = n.data || {};
  const locations = d.locations || {};
  const defaultLoc = d.defaultLocation || Object.keys(locations)[0] || 'Unknown';
  const locData = locations[defaultLoc] || {};

  const temp = locData.temp || '--°F';
  const conditions = locData.conditions || 'Unknown';
  const high = locData.high || '--';
  const low = locData.low || '--';
  const precip = locData.precip || '--';
  const wind = locData.wind || '--';
  const humidity = locData.humidity || '--';

  // Encode locations as JSON in data attribute for JS access
  const locationsJson = escapeHtml(JSON.stringify(locations));

  const locationKeys = Object.keys(locations);
  const hasMultipleLocations = locationKeys.length > 1;

  const dropdownHtml = hasMultipleLocations ? `
    <div class="weather-dropdown" data-card-id="${n.id}">
      ${locationKeys.map(loc => `
        <div class="weather-dropdown-item" data-location="${escapeHtml(loc)}">${escapeHtml(loc)}</div>
      `).join('')}
    </div>
  ` : '';

  const chevronHtml = hasMultipleLocations ? `<span class="weather-chevron">${SVG_ICONS.chevronDown}</span>` : '';

  return `
    <div class="notif-card card-enter${unread} weather-card${isPanel ? ' card-collapsible' : ''}" 
         data-id="${n.id}" 
         data-type="weather"
         data-locations="${locationsJson}"
         data-current-location="${escapeHtml(defaultLoc)}">
      <div class="card-scanlines"></div>
      <div class="card-vignette"></div>
      <div class="card-noise-line"></div>
      <div class="toast-scanner-beam"></div>
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">${SVG_ICONS.weather}</span>
          <span class="weather-location-select" data-card-id="${n.id}">
            <span class="weather-location-name">${escapeHtml(defaultLoc)}</span>
            ${chevronHtml}
          </span>
          ${dropdownHtml}
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="weather-card-body">
        <div class="weather-temp-large holo-number">${escapeHtml(temp)}</div>
        <div class="weather-conditions">${escapeHtml(conditions)}</div>
        <div class="weather-stat-row">
          <span class="weather-stat">H: <span class="holo-number">${escapeHtml(high)}</span></span>
          <span class="weather-stat">L: <span class="holo-number">${escapeHtml(low)}</span></span>
          <span class="weather-stat">💧 <span class="holo-number">${escapeHtml(precip)}</span></span>
        </div>
        <div class="weather-stat-row">
          <span class="weather-stat">Wind: ${escapeHtml(wind)}</span>
          <span class="weather-stat">Humidity: ${escapeHtml(humidity)}</span>
        </div>
      </div>
      <div class="card-timestamp">SCAN LOCKED &bull; ${ts}</div>
    </div>
  `;
}

// ─── Weather: Terrain — "Weather Station" ────────────────────────────

function renderWeatherTerrain(n, options) {
  const time = formatTime(n.timestamp);
  const ts = formatTimestamp(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const isPanel = options && options.panel;

  const d = n.data || {};
  const locations = d.locations || {};
  const defaultLoc = d.defaultLocation || Object.keys(locations)[0] || 'Unknown';
  const locData = locations[defaultLoc] || {};

  const temp = locData.temp || '--°F';
  const conditions = locData.conditions || 'Unknown';
  const high = locData.high || '--';
  const low = locData.low || '--';
  const precip = locData.precip || '--';
  const wind = locData.wind || '--';
  const humidity = locData.humidity || '--';

  const locationsJson = escapeHtml(JSON.stringify(locations));

  const locationKeys = Object.keys(locations);
  const hasMultipleLocations = locationKeys.length > 1;

  const dropdownHtml = hasMultipleLocations ? `
    <div class="weather-dropdown" data-card-id="${n.id}">
      ${locationKeys.map(loc => `
        <div class="weather-dropdown-item" data-location="${escapeHtml(loc)}">${escapeHtml(loc)}</div>
      `).join('')}
    </div>
  ` : '';

  const chevronHtml = hasMultipleLocations ? `<span class="weather-chevron">${SVG_ICONS.chevronDown}</span>` : '';

  return `
    <div class="notif-card card-enter${unread} weather-card${isPanel ? ' card-collapsible' : ''}" 
         data-id="${n.id}" 
         data-type="weather"
         data-locations="${locationsJson}"
         data-current-location="${escapeHtml(defaultLoc)}">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon notif-icon-svg">⛰</span>
          <span class="notif-title">WEATHER STATION</span>
          <span class="weather-location-select" data-card-id="${n.id}">
            <span class="weather-location-name">${escapeHtml(defaultLoc)}</span>
            ${chevronHtml}
          </span>
          ${dropdownHtml}
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="weather-card-body">
        <div class="weather-temp-large">${escapeHtml(temp)}</div>
        <div class="weather-conditions">${escapeHtml(conditions)}</div>
        <div class="weather-stat-row">
          <span class="weather-stat">H: ${escapeHtml(high)}</span>
          <span class="weather-stat">L: ${escapeHtml(low)}</span>
          <span class="weather-stat">💧 ${escapeHtml(precip)}</span>
        </div>
        <div class="weather-stat-row">
          <span class="weather-stat">Wind: ${escapeHtml(wind)}</span>
          <span class="weather-stat">Humidity: ${escapeHtml(humidity)}</span>
        </div>
      </div>
      <div class="card-timestamp">OBSERVATION &bull; ${ts}</div>
    </div>
  `;
}

function renderWeatherCard(n, options) {
  return getTheme() === 'terrain' ? renderWeatherTerrain(n, options) : renderWeatherRelay(n, options);
}


// ═══════════════════════════════════════════════════════════════════════
//  MAIN DISPATCHER
// ═══════════════════════════════════════════════════════════════════════

function renderCard(n, options) {
  switch (n.type) {
    case 'briefing': return renderBriefingCard(n, options);
    case 'alert': return renderAlertCard(n);
    case 'production-card': return renderProductionCard(n, options);
    case 'weather': return renderWeatherCard(n, options);
    default: return renderToastCard(n);
  }
}
