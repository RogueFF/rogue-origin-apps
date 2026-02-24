#!/usr/bin/env node
/**
 * Shipment Alert Monitor
 * 
 * Monitors Rogue Origin shipments for:
 *   - Overdue (past ETA, no delivery confirmation)
 *   - Stale tracking (>24h since last update)
 *   - Status anomalies (customs hold, exceptions, etc.)
 *   - Sensor anomalies (temp, humidity, battery)
 * 
 * Usage:
 *   node monitor.js                  # Run once, check + alert
 *   node monitor.js --daemon         # Run continuously (poll interval from config)
 *   node monitor.js --dry-run        # Check but don't send notifications
 *   node monitor.js --verbose        # Detailed output
 *   node monitor.js --dashboard-only # Just rebuild the dashboard
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve, dirname } = require('path');

// --- Config ---
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const flags = {
  daemon: args.includes('--daemon'),
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  dashboardOnly: args.includes('--dashboard-only'),
};

// --- Alert History ---
const historyPath = resolve(__dirname, config.alertHistory);

function loadHistory() {
  if (!existsSync(historyPath)) return { alerts: [], lastCheck: null };
  try { return JSON.parse(readFileSync(historyPath, 'utf8')); }
  catch { return { alerts: [], lastCheck: null }; }
}

function saveHistory(history) {
  // Keep last 500 alerts
  history.alerts = history.alerts.slice(-500);
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

// --- Data Source ---
function loadShipments() {
  const dataPath = resolve(__dirname, config.dataSource);
  if (!existsSync(dataPath)) {
    console.error(`[SHIPMENT-ALERT] Data file not found: ${dataPath}`);
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    return data.shipments || [];
  } catch (e) {
    console.error(`[SHIPMENT-ALERT] Failed to parse data: ${e.message}`);
    return [];
  }
}

// --- ETA Parsing ---
function parseETA(etaStr) {
  if (!etaStr) return null;
  // Handle formats like "Feb 19, 3:30 PM CET"
  const cleaned = etaStr.replace(/\s+(CET|CEST|PST|PDT|EST|EDT|UTC|GMT)$/i, '');
  const tz = etaStr.match(/(CET|CEST|PST|PDT|EST|EDT|UTC|GMT)$/i)?.[1] || 'UTC';
  const tzMap = {
    CET: '+01:00', CEST: '+02:00',
    PST: '-08:00', PDT: '-07:00',
    EST: '-05:00', EDT: '-04:00',
    UTC: '+00:00', GMT: '+00:00',
  };
  
  // Try parsing with current year
  const year = new Date().getFullYear();
  const dateStr = `${cleaned}, ${year}`;
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    // Adjust for timezone
    const offset = tzMap[tz.toUpperCase()] || '+00:00';
    const [h, m] = offset.split(':').map(Number);
    const ms = (Math.abs(h) * 60 + Math.abs(m)) * 60000 * (h < 0 ? 1 : -1);
    return new Date(parsed.getTime() + ms);
  }
  
  // Fallback: try ISO
  const iso = new Date(etaStr);
  return isNaN(iso.getTime()) ? null : iso;
}

// --- Alert Detection ---
function analyzeShipment(shipment, now) {
  const alerts = [];
  const th = config.thresholds;
  
  // 1. Overdue check: past ETA with no delivery confirmation
  const deliveredStatuses = ['delivered', 'completed', 'arrived'];
  const isDelivered = deliveredStatuses.includes(shipment.status?.toLowerCase());
  
  if (shipment.eta && !isDelivered) {
    const eta = parseETA(shipment.eta);
    if (eta && now > eta) {
      const hoursOverdue = Math.round((now - eta) / 3600000);
      if (hoursOverdue > th.overdueHours) {
        alerts.push({
          type: 'overdue',
          severity: hoursOverdue > 48 ? 'critical' : hoursOverdue > 24 ? 'high' : 'medium',
          message: `${hoursOverdue}h past ETA (${shipment.eta}), status: ${shipment.status}`,
          hoursOverdue,
        });
      }
    }
  }
  
  // 2. Stale tracking check
  if (shipment.lastUpdate && !isDelivered) {
    const lastUpdate = new Date(shipment.lastUpdate);
    const hoursSinceUpdate = (now - lastUpdate) / 3600000;
    if (hoursSinceUpdate > th.staleTrackingHours) {
      alerts.push({
        type: 'stale-tracking',
        severity: hoursSinceUpdate > 72 ? 'critical' : hoursSinceUpdate > 48 ? 'high' : 'medium',
        message: `Tracking stale for ${Math.round(hoursSinceUpdate)}h (last: ${lastUpdate.toISOString()})`,
        hoursSinceUpdate: Math.round(hoursSinceUpdate),
      });
    }
  }
  
  // 3. Status anomalies
  const statusLower = shipment.status?.toLowerCase() || '';
  for (const anomaly of config.statusAnomalies) {
    if (statusLower.includes(anomaly)) {
      alerts.push({
        type: 'status-anomaly',
        severity: 'high',
        message: `Status anomaly detected: "${shipment.status}"`,
        anomaly,
      });
    }
  }
  
  // 4. Sensor anomalies (temp, humidity, battery)
  if (shipment.sensorData) {
    const sd = shipment.sensorData;
    
    // Temperature
    const tempMatch = sd.temp?.match(/([\d.]+)/);
    if (tempMatch) {
      const temp = parseFloat(tempMatch[1]);
      if (temp < th.tempMinF) {
        alerts.push({
          type: 'sensor-temp-low',
          severity: temp < 20 ? 'critical' : 'high',
          message: `Temperature too low: ${sd.temp} (min: ${th.tempMinF}°F)`,
        });
      }
      if (temp > th.tempMaxF) {
        alerts.push({
          type: 'sensor-temp-high',
          severity: temp > 100 ? 'critical' : 'high',
          message: `Temperature too high: ${sd.temp} (max: ${th.tempMaxF}°F)`,
        });
      }
    }
    
    // Humidity
    const humMatch = sd.humidity?.match(/([\d.]+)/);
    if (humMatch) {
      const hum = parseFloat(humMatch[1]);
      if (hum > th.humidityMaxPct) {
        alerts.push({
          type: 'sensor-humidity',
          severity: 'medium',
          message: `Humidity elevated: ${sd.humidity} (max: ${th.humidityMaxPct}%)`,
        });
      }
    }
    
    // Battery
    const batMatch = sd.battery?.match(/([\d.]+)/);
    if (batMatch) {
      const bat = parseFloat(batMatch[1]);
      if (bat < th.batteryMinPct) {
        alerts.push({
          type: 'sensor-battery',
          severity: bat < 10 ? 'high' : 'medium',
          message: `Sensor battery low: ${sd.battery} (min: ${th.batteryMinPct}%)`,
        });
      }
    }
  }
  
  return alerts;
}

function getShipmentHealth(shipment, alerts) {
  if (!alerts.length) return 'green';
  const severities = alerts.map(a => a.severity);
  if (severities.includes('critical')) return 'red';
  if (severities.includes('high')) return 'red';
  if (severities.includes('medium')) return 'yellow';
  return 'yellow';
}

// --- Notification ---
async function sendNotification(title, body, priority = 'high') {
  if (flags.dryRun) {
    console.log(`[DRY-RUN] Would notify: ${title} — ${body}`);
    return true;
  }
  
  const payload = JSON.stringify({ type: 'alert', title, body, priority, category: 'logistics' });
  const endpoints = [config.notify.primary, config.notify.fallback];
  
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.notify.timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        if (flags.verbose) console.log(`[NOTIFY] Sent to ${url}`);
        return true;
      }
    } catch (e) {
      if (flags.verbose) console.log(`[NOTIFY] Failed ${url}: ${e.message}`);
    }
  }
  console.error(`[NOTIFY] All endpoints failed for: ${title}`);
  return false;
}

// --- Dedup ---
function shouldAlert(shipmentId, alertType, history) {
  // Don't re-alert for the same shipment+type within 6 hours
  const cutoff = Date.now() - 6 * 3600000;
  return !history.alerts.some(a =>
    a.shipmentId === shipmentId &&
    a.type === alertType &&
    new Date(a.timestamp).getTime() > cutoff
  );
}

// --- Main Check ---
async function runCheck() {
  const now = new Date();
  const shipments = loadShipments();
  const history = loadHistory();
  
  if (!shipments.length) {
    console.log(`[SHIPMENT-ALERT] No shipments found.`);
    return { shipments: [], alerts: [], newAlerts: 0 };
  }
  
  const results = [];
  let newAlertCount = 0;
  
  for (const shipment of shipments) {
    const alerts = analyzeShipment(shipment, now);
    const health = getShipmentHealth(shipment, alerts);
    
    results.push({ shipment, alerts, health });
    
    // Send notifications for new alerts
    for (const alert of alerts) {
      if (shouldAlert(shipment.id, alert.type, history)) {
        const title = `Shipment Alert: ${shipment.customer} → ${shipment.destination}`;
        const body = `[${alert.severity.toUpperCase()}] ${alert.message}\nAWB: ${shipment.awb || 'N/A'} | Status: ${shipment.status}`;
        await sendNotification(title, body, alert.severity === 'critical' ? 'high' : 'normal');
        
        history.alerts.push({
          timestamp: now.toISOString(),
          shipmentId: shipment.id,
          customer: shipment.customer,
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          notified: !flags.dryRun,
        });
        newAlertCount++;
      }
    }
  }
  
  history.lastCheck = now.toISOString();
  saveHistory(history);
  
  // Print summary
  console.log(`\n[SHIPMENT-ALERT] Check complete — ${now.toISOString()}`);
  console.log(`  Shipments: ${shipments.length}`);
  console.log(`  New alerts: ${newAlertCount}`);
  for (const r of results) {
    const icon = r.health === 'green' ? '🟢' : r.health === 'yellow' ? '🟡' : '🔴';
    console.log(`  ${icon} ${r.shipment.customer} → ${r.shipment.destination} [${r.shipment.status}]`);
    if (flags.verbose && r.alerts.length) {
      for (const a of r.alerts) {
        console.log(`     ⚠ [${a.severity}] ${a.message}`);
      }
    }
  }
  
  return { shipments: results, alerts: history.alerts, newAlerts: newAlertCount };
}

// --- Dashboard Generation ---
function generateDashboard(results, history) {
  const now = new Date();
  const recentAlerts = history.alerts.slice(-50).reverse();
  
  const shipmentRows = results.shipments.map(r => {
    const s = r.shipment;
    const healthColor = r.health === 'green' ? '#00e676' : r.health === 'yellow' ? '#ffab00' : '#ff1744';
    const healthIcon = r.health === 'green' ? '●' : r.health === 'yellow' ? '◐' : '◉';
    const alertList = r.alerts.map(a =>
      `<div class="alert-item ${a.severity}"><span class="alert-badge">${a.severity}</span> ${a.message}</div>`
    ).join('');
    
    const lastUpdate = s.lastUpdate ? new Date(s.lastUpdate) : null;
    const hoursSinceUpdate = lastUpdate ? Math.round((now - lastUpdate) / 3600000) : '?';
    
    return `
      <div class="shipment-card" style="--health: ${healthColor}">
        <div class="shipment-header">
          <span class="health-dot" style="color: ${healthColor}">${healthIcon}</span>
          <div class="shipment-title">
            <h3>${s.customer}</h3>
            <span class="shipment-route">${s.origin || 'RO'} → ${s.finalDest || s.destination}</span>
          </div>
          <div class="shipment-status">${s.status || 'unknown'}</div>
        </div>
        <div class="shipment-meta">
          <div class="meta-item"><span class="meta-label">AWB</span><span class="meta-value">${s.awb || 'N/A'}</span></div>
          <div class="meta-item"><span class="meta-label">ETA</span><span class="meta-value">${s.eta || 'N/A'}</span></div>
          <div class="meta-item"><span class="meta-label">Last Update</span><span class="meta-value">${hoursSinceUpdate}h ago</span></div>
          <div class="meta-item"><span class="meta-label">Weight</span><span class="meta-value">${s.weight || 'N/A'}</span></div>
          ${s.sensorData ? `
          <div class="meta-item"><span class="meta-label">Temp</span><span class="meta-value">${s.sensorData.temp || 'N/A'}</span></div>
          <div class="meta-item"><span class="meta-label">Humidity</span><span class="meta-value">${s.sensorData.humidity || 'N/A'}</span></div>
          <div class="meta-item"><span class="meta-label">Battery</span><span class="meta-value">${s.sensorData.battery || 'N/A'}</span></div>
          ` : ''}
        </div>
        ${alertList ? `<div class="alert-list">${alertList}</div>` : '<div class="all-clear">✓ No issues detected</div>'}
      </div>`;
  }).join('');
  
  const alertRows = recentAlerts.map(a => `
    <tr>
      <td class="ts">${new Date(a.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${a.customer || a.shipmentId}</td>
      <td><span class="alert-badge ${a.severity}">${a.severity}</span></td>
      <td>${a.type}</td>
      <td>${a.message}</td>
      <td>${a.notified ? '✓' : '—'}</td>
    </tr>
  `).join('');
  
  const greenCount = results.shipments.filter(r => r.health === 'green').length;
  const yellowCount = results.shipments.filter(r => r.health === 'yellow').length;
  const redCount = results.shipments.filter(r => r.health === 'red').length;
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rogue Origin · Shipment Alerts</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0a0f;
    --card-bg: #12121a;
    --card-border: rgba(255,255,255,0.06);
    --green: #00e676;
    --yellow: #ffab00;
    --red: #ff1744;
    --cyan: #00bcd4;
    --text: #e4e4ef;
    --text-dim: #6b6b80;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'Outfit', sans-serif;
  }
  body {
    background: var(--bg);
    font-family: var(--sans);
    color: var(--text);
    min-height: 100vh;
    padding: 24px 16px 48px;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: 0;
  }
  .container { max-width: 960px; margin: 0 auto; position: relative; z-index: 1; }
  
  /* Header */
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--card-border);
  }
  .header h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.5px;
  }
  .header .subtitle {
    font-size: 13px;
    color: var(--text-dim);
    font-family: var(--mono);
  }
  .header .last-check {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--mono);
  }
  
  /* Summary bar */
  .summary {
    display: flex;
    gap: 16px;
    margin-bottom: 28px;
  }
  .summary-card {
    flex: 1;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 16px 20px;
    text-align: center;
  }
  .summary-card .count {
    font-size: 28px;
    font-weight: 700;
    font-family: var(--mono);
  }
  .summary-card .label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 4px;
  }
  
  /* Shipment cards */
  .shipment-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--health);
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 16px;
    transition: border-color 0.2s;
  }
  .shipment-card:hover { border-color: rgba(255,255,255,0.12); border-left-color: var(--health); }
  .shipment-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .health-dot { font-size: 20px; }
  .shipment-title h3 { font-size: 16px; font-weight: 600; }
  .shipment-route { font-size: 12px; color: var(--cyan); font-family: var(--mono); }
  .shipment-status {
    margin-left: auto;
    font-size: 12px;
    font-family: var(--mono);
    padding: 4px 10px;
    background: rgba(255,255,255,0.05);
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .shipment-meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px 16px;
    margin-bottom: 12px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; }
  .meta-value { font-size: 13px; font-family: var(--mono); }
  
  .alert-list { margin-top: 12px; }
  .alert-item {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .alert-item.critical { background: rgba(255,23,68,0.12); color: var(--red); }
  .alert-item.high { background: rgba(255,23,68,0.08); color: #ff5252; }
  .alert-item.medium { background: rgba(255,171,0,0.08); color: var(--yellow); }
  
  .alert-badge {
    font-size: 9px;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .alert-badge.critical { background: rgba(255,23,68,0.2); color: var(--red); }
  .alert-badge.high { background: rgba(255,82,82,0.2); color: #ff5252; }
  .alert-badge.medium { background: rgba(255,171,0,0.2); color: var(--yellow); }
  
  .all-clear {
    font-size: 13px;
    color: var(--green);
    font-family: var(--mono);
    opacity: 0.7;
  }
  
  /* Alert history table */
  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin: 36px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--card-border);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--card-border);
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    font-family: var(--mono);
    font-size: 12px;
  }
  .ts { color: var(--text-dim); white-space: nowrap; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  
  /* Mobile */
  @media (max-width: 640px) {
    .summary { flex-direction: column; gap: 8px; }
    .shipment-meta { grid-template-columns: 1fr 1fr; }
    .header { flex-direction: column; align-items: flex-start; }
    .header .last-check { margin-left: 0; }
    table { font-size: 11px; }
    td, th { padding: 6px 8px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>📦 Shipment Alerts</h1>
      <div class="subtitle">Rogue Origin Logistics Monitor</div>
    </div>
    <div class="last-check">Last check: ${now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PST</div>
  </div>
  
  <div class="summary">
    <div class="summary-card"><div class="count" style="color: var(--green)">${greenCount}</div><div class="label">Healthy</div></div>
    <div class="summary-card"><div class="count" style="color: var(--yellow)">${yellowCount}</div><div class="label">Warning</div></div>
    <div class="summary-card"><div class="count" style="color: var(--red)">${redCount}</div><div class="label">Critical</div></div>
    <div class="summary-card"><div class="count">${results.shipments.length}</div><div class="label">Total</div></div>
  </div>
  
  ${shipmentRows || '<div class="all-clear" style="text-align:center;padding:40px">No active shipments</div>'}
  
  <h2 class="section-title">Alert History</h2>
  <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Time</th><th>Customer</th><th>Severity</th><th>Type</th><th>Details</th><th>Sent</th></tr></thead>
      <tbody>${alertRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">No alerts recorded</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body>
</html>`;
  
  const outPath = resolve(__dirname, config.dashboard.outputPath);
  writeFileSync(outPath, html);
  console.log(`[SHIPMENT-ALERT] Dashboard written: ${outPath}`);
}

// --- Daemon Mode ---
async function daemon() {
  console.log(`[SHIPMENT-ALERT] Daemon started — polling every ${config.pollIntervalMin} min`);
  while (true) {
    try {
      const results = await runCheck();
      generateDashboard(results, loadHistory());
    } catch (e) {
      console.error(`[SHIPMENT-ALERT] Check failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, config.pollIntervalMin * 60000));
  }
}

// --- Entry ---
async function main() {
  if (flags.dashboardOnly) {
    const shipments = loadShipments();
    const now = new Date();
    const results = {
      shipments: shipments.map(s => {
        const alerts = analyzeShipment(s, now);
        return { shipment: s, alerts, health: getShipmentHealth(s, alerts) };
      }),
    };
    generateDashboard(results, loadHistory());
    return;
  }
  
  if (flags.daemon) {
    await daemon();
  } else {
    const results = await runCheck();
    generateDashboard(results, loadHistory());
  }
}

main().catch(e => {
  console.error(`[SHIPMENT-ALERT] Fatal: ${e.message}`);
  process.exit(1);
});
