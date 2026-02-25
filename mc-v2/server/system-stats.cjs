#!/usr/bin/env node
/**
 * System Stats API — lightweight Express server on port 9501
 * Returns CPU, memory, disk, load, uptime, and process counts.
 * MC v2 Vite proxy forwards /api/system here.
 */

const http = require('http');
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = 9501;

// CPU usage tracking
let prevIdle = 0, prevTotal = 0;

function getCpuPercent() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const line = stat.split('\n')[0]; // cpu aggregate
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    const dIdle = idle - prevIdle;
    const dTotal = total - prevTotal;
    prevIdle = idle;
    prevTotal = total;
    if (dTotal === 0) return 0;
    return Math.round((1 - dIdle / dTotal) * 100);
  } catch { return 0; }
}

function getDisk() {
  try {
    const out = execSync('df -B1 / 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const parts = out.split('\n')[1]?.split(/\s+/);
    if (!parts) return { used: 0, total: 0 };
    return {
      used: Math.round(Number(parts[2]) / 1e9 * 10) / 10,
      total: Math.round(Number(parts[1]) / 1e9 * 10) / 10,
    };
  } catch { return { used: 0, total: 0 }; }
}

function getProcessCounts() {
  try {
    const out = execSync("ps -eo comm= 2>/dev/null", { encoding: 'utf8', timeout: 3000 });
    const procs = out.trim().split('\n');
    const counts = {};
    const track = ['node', 'chromium', 'python', 'claude', 'docker'];
    for (const p of procs) {
      const name = p.trim().toLowerCase();
      for (const t of track) {
        if (name.includes(t)) { counts[t] = (counts[t] || 0) + 1; }
      }
    }
    counts.total = procs.length;
    return counts;
  } catch { return { total: 0 }; }
}

function getServices() {
  const services = [];
  const checks = [
    { name: 'mc-v2-vite', unit: 'mc-v2-vite' },
    { name: 'system-stats', unit: 'system-stats' },
    { name: 'gateway', cmd: 'openclaw' },
  ];

  for (const svc of checks) {
    try {
      if (svc.unit) {
        const out = execSync(`systemctl --user show ${svc.unit} --property=ActiveState,MainPID,ExecMainStartTimestamp 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
        const state = out.match(/ActiveState=(\w+)/)?.[1] || 'unknown';
        const pid = parseInt(out.match(/MainPID=(\d+)/)?.[1] || '0');
        const startStr = out.match(/ExecMainStartTimestamp=(.+)/)?.[1] || '';
        const startMs = startStr ? new Date(startStr).getTime() : 0;
        const uptime = startMs ? Math.floor((Date.now() - startMs) / 1000) : 0;
        services.push({ name: svc.name, status: state === 'active' ? 'active' : 'inactive', pid, uptime });
      }
    } catch { services.push({ name: svc.name, status: 'unknown', pid: 0, uptime: 0 }); }
  }

  // Check n8n docker
  try {
    const out = execSync('docker inspect n8n --format="{{.State.Status}} {{.State.StartedAt}}" 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const [status, started] = out.trim().split(' ');
    const uptime = started ? Math.floor((Date.now() - new Date(started).getTime()) / 1000) : 0;
    services.push({ name: 'n8n', status: status === 'running' ? 'active' : 'inactive', type: 'docker', uptime });
  } catch { services.push({ name: 'n8n', status: 'unknown', type: 'docker', uptime: 0 }); }

  // Check gateway process
  try {
    const out = execSync('pgrep -f "openclaw.*gateway" 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const pid = parseInt(out.trim().split('\n')[0]) || 0;
    if (pid) {
      const statFile = `/proc/${pid}/stat`;
      let uptime = 0;
      try {
        const boottime = Number(fs.readFileSync('/proc/stat', 'utf8').match(/btime (\d+)/)?.[1] || 0);
        const startTicks = Number(fs.readFileSync(statFile, 'utf8').split(' ')[21]);
        uptime = Math.floor(Date.now() / 1000 - boottime - startTicks / 100);
      } catch {}
      services.push({ name: 'gateway', status: 'active', pid, uptime: Math.max(uptime, 0) });
    } else {
      services.push({ name: 'gateway', status: 'inactive', pid: 0, uptime: 0 });
    }
  } catch { services.push({ name: 'gateway', status: 'unknown', pid: 0, uptime: 0 }); }

  // Chromium count
  try {
    const out = execSync('pgrep -c chromium 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const count = parseInt(out.trim()) || 0;
    services.push({ name: 'chromium', status: count > 0 ? 'active' : 'inactive', count });
  } catch { services.push({ name: 'chromium', status: 'inactive', count: 0 }); }

  return services;
}

// Prime CPU reading
getCpuPercent();

const server = http.createServer((req, res) => {
  if (req.url !== '/stats' && req.url !== '/') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;

  const data = {
    cpu: getCpuPercent(),
    mem: {
      used: Math.round(memUsed / 1e9 * 10) / 10,
      total: Math.round(memTotal / 1e9 * 10) / 10,
    },
    disk: getDisk(),
    loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100),
    uptime: Math.floor(os.uptime()),
    processes: getProcessCounts(),
    services: getServices(),
    timestamp: Date.now(),
  };

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[system-stats] listening on 127.0.0.1:${PORT}`);
});
