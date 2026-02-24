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
