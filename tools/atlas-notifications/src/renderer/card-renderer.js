// ─── Shared Card Renderer ──────────────────────────────────────────
// Used by popup.js to render notification cards.
// Panel.js has its own renderers that shadow these.

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

// ─── Toast Card ─────────────────────────────────────────────────────

function renderToastCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="toast">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
    </div>
  `;
}

// ─── Briefing Card ──────────────────────────────────────────────────

function renderBriefingCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';

  let segmentsHtml = '';
  if (n.data && n.data.segments && n.data.segments.length > 0) {
    segmentsHtml = `<div class="briefing-segments">
      ${n.data.segments.map(seg => `
        <div class="briefing-segment">
          <div class="briefing-segment-header">
            <span class="briefing-segment-icon">${seg.icon || '\uD83D\uDCCC'}</span>
            <span class="briefing-segment-label">${escapeHtml(seg.label || seg.category || 'Update')}</span>
          </div>
          <div class="briefing-segment-text">${escapeHtml(seg.text || seg.summary || '')}</div>
        </div>
      `).join('')}
    </div>`;
  } else if (n.body) {
    segmentsHtml = `<div class="notif-body">${escapeHtml(n.body)}</div>`;
  }

  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="briefing">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      ${segmentsHtml}
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
          <span class="notif-icon">\u26A0\uFE0F</span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      ${ackBtn}
    </div>
  `;
}

// ─── Production Card with SVG Circular Gauges ───────────────────────

function renderProductionCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';
  const pct = d.percentOfTarget || 0;

  // Stats with circular gauges
  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '—';
  const target = pct || 0;
  const crew = d.trimmers || d.crew || 0;
  const rate = d.rate ? d.rate.toFixed(2) : 0;

  // Color based on pace
  const gaugeColor = paceClass === 'ahead' ? 'green' : paceClass === 'behind' ? 'red' : 'gold';

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
          <span class="notif-title">Hourly Production</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="prod-stats-grid">
        ${renderGaugeStat(lbs, 'lbs', gaugeColor, Math.min(target, 100))}
        ${renderGaugeStat(target + '%', 'target', gaugeColor, target)}
        ${renderGaugeStat(crew, 'crew', gaugeColor, Math.min((crew / 10) * 100, 100))}
        ${renderGaugeStat(rate, 'rate', gaugeColor, Math.min((rate / 5) * 100, 100))}
      </div>
      ${sparkHtml}
      <div class="prod-pace">
        <span class="prod-pace-text ${paceClass}">${paceLabel}</span>
        <span class="prod-pace-pct ${paceClass}">${pct}%</span>
      </div>
    </div>
  `;
}

// ─── SVG Circular Gauge Helper ─────────────────────────────────────

function renderGaugeStat(value, label, color, percent) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return `
    <div class="prod-stat">
      <svg class="prod-gauge" viewBox="0 0 60 60">
        <circle class="prod-gauge-bg" cx="30" cy="30" r="${radius}"></circle>
        <circle class="prod-gauge-fill ${color}" cx="30" cy="30" r="${radius}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"></circle>
        <text class="prod-gauge-value" x="30" y="35" text-anchor="middle">${value}</text>
      </svg>
      <div class="prod-stat-label">${label}</div>
    </div>
  `;
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
