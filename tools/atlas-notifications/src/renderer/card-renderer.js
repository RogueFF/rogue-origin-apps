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

// ─── Production Card ────────────────────────────────────────────────

function renderProductionCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';
  const pct = d.percentOfTarget || 0;

  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '\u2014';
  const target = pct ? pct + '%' : '\u2014';
  const crew = d.trimmers || d.crew || '\u2014';
  const rate = d.rate ? d.rate.toFixed(2) : '\u2014';

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
        <div class="prod-stat">
          <div class="prod-stat-value">${lbs}</div>
          <div class="prod-stat-label">lbs</div>
        </div>
        <div class="prod-stat">
          <div class="prod-stat-value">${target}</div>
          <div class="prod-stat-label">target</div>
        </div>
        <div class="prod-stat">
          <div class="prod-stat-value">${crew}</div>
          <div class="prod-stat-label">crew</div>
        </div>
        <div class="prod-stat">
          <div class="prod-stat-value">${rate}</div>
          <div class="prod-stat-label">rate</div>
        </div>
      </div>
      ${sparkHtml}
      <div class="prod-pace">
        <span class="prod-pace-text ${paceClass}">${paceLabel}</span>
        <span class="prod-pace-pct ${paceClass}">${pct}%</span>
      </div>
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
