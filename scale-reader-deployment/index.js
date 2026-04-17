/**
 * Scale Reader for OHAUS Defender 5000 (100 lb x 0.005 lb)
 *
 * Reads weight from RS-232 scale (via USB-serial adapter), displays locally,
 * and pushes to cloud API.
 *
 * Usage:
 *   npm start              - Connect to real scale
 *   npm run dev            - Use mock data for testing (no scale needed)
 *   node index.js COM3     - Specify COM port
 */

const express = require('express');
const path = require('path');
const http = require('http');

// Configuration
const CONFIG = {
  port: 3000,
  apiUrl: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight',
  pushInterval: 500,      // Push to API every 500ms
  serialBaud: 9600,       // OHAUS Defender 5000 default (8-N-1)
  pollInterval: 500,      // How often to request a weight reading (ms)
  stationId: 'line1',
  targetWeight: 5.0,      // kg (displayed/stored in kg; scale reads lb)
};

const LB_TO_KG = 0.453592;
const OZ_TO_KG = 0.0283495;

// State
let currentWeight = 0;
let isConnected = false;
let useMock = process.argv.includes('--mock');
let serialPort = null;

// Parse one line of OHAUS Defender 5000 output.
// Each Print (P\r\n) returns up to 4 lines, e.g.:
//   "          4     g     "    no marker  (displayed value)
//   "          4     g    G"    Gross
//   "         4     g    N"     Net   ← preferred when scale is tared
//   "          0     g    T"    Tare  ← MUST be ignored, not a current reading
// Indicator unit may be g, kg, lb, or oz depending on configuration.
// Unstable readings carry a '?' suffix; we still accept them so the live
// display tracks the bag as it fills.
// Returns { kg, raw, unit, marker, stable } or null if the line should be skipped.
function parseOhausLine(line) {
  if (!line || !line.trim()) return null;

  // Match number + unit. Order matters: kg before g so "kg" wins over "g".
  const match = line.match(/(-?\d+(?:\.\d+)?)\s*(kg|lb|oz|g)\b/i);
  if (!match) return null;

  // Detect line type marker (G=gross, N=net, T=tare). Anything else = unmarked.
  const markerMatch = line.match(/\b([GNT])\s*$/);
  const marker = markerMatch ? markerMatch[1] : '';

  // Tare lines report the tare offset, not current weight — never use as reading.
  if (marker === 'T') return null;

  const raw = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const stable = !/\?/.test(line);

  let kg;
  switch (unit) {
    case 'kg': kg = raw; break;
    case 'g':  kg = raw / 1000; break;
    case 'lb': kg = raw * LB_TO_KG; break;
    case 'oz': kg = raw * OZ_TO_KG; break;
  }

  return {
    kg: Math.max(0, Math.round(kg * 1000) / 1000),
    raw,
    unit,
    marker,
    stable,
  };
}

// Express app
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API endpoint for local display to get weight
app.get('/api/weight', (req, res) => {
  res.json({
    weight: currentWeight,
    targetWeight: CONFIG.targetWeight,
    percentComplete: Math.min(100, Math.round((currentWeight / CONFIG.targetWeight) * 100)),
    isConnected,
    timestamp: new Date().toISOString(),
  });
});

// Manual weight set (for testing)
app.post('/api/weight', (req, res) => {
  if (typeof req.body.weight === 'number') {
    currentWeight = Math.max(0, req.body.weight);
    console.log(`Manual weight set: ${currentWeight.toFixed(2)} kg`);
  }
  res.json({ success: true, weight: currentWeight });
});

// Start server
const server = http.createServer(app);
server.listen(CONFIG.port, () => {
  console.log(`\n  Scale Reader running at http://localhost:${CONFIG.port}`);
  console.log(`  Mode: ${useMock ? 'MOCK (simulated weight)' : 'LIVE (serial port)'}\n`);
});

// Push weight to cloud API
async function pushToCloud() {
  try {
    const response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weight: currentWeight,
        stationId: CONFIG.stationId,
      }),
    });

    if (!response.ok) {
      console.error('API push failed:', response.status);
    }
  } catch (error) {
    // Silently fail - local display still works
  }
}

// Start cloud push interval
setInterval(pushToCloud, CONFIG.pushInterval);

// Mock mode: simulate weight changes
if (useMock) {
  console.log('  Mock mode: Weight will simulate filling a bag\n');
  isConnected = true;

  let direction = 1;
  setInterval(() => {
    // Simulate weight going 0 -> 5 -> 0 (bag cycle)
    currentWeight += direction * 0.05;

    if (currentWeight >= 5.1) {
      // Bag removed (simulate taking it off scale)
      direction = -1;
    } else if (currentWeight <= 0) {
      // New bag started
      direction = 1;
      currentWeight = 0;
    }

    currentWeight = Math.max(0, Math.round(currentWeight * 100) / 100);
  }, 100);

} else {
  // Real serial port mode
  initSerialPort();
}

// Initialize serial port connection
function initSerialPort() {
  try {
    const { SerialPort } = require('serialport');
    const { ReadlineParser } = require('@serialport/parser-readline');

    // Find COM port from command line or auto-detect
    const comPort = process.argv.find(arg => arg.startsWith('COM')) || 'COM3';

    console.log(`  Connecting to scale on ${comPort}...`);

    serialPort = new SerialPort({
      path: comPort,
      baudRate: CONFIG.serialBaud,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    });

    let buffer = '';

    serialPort.on('open', () => {
      console.log(`  Connected to scale on ${comPort}\n`);
      isConnected = true;

      // Poll scale for weight (OHAUS Print command: 'P' requests a stable reading).
      // If the indicator is set to Continuous/Auto-Print, these requests are ignored
      // and we simply parse the unsolicited stream.
      setInterval(() => {
        if (serialPort.isOpen) {
          serialPort.write('P\r\n');
        }
      }, CONFIG.pollInterval);
    });

    serialPort.on('data', (data) => {
      // Buffer incoming bytes since scale sends one byte at a time
      buffer += data.toString('ascii');

      // Process complete lines (ending with \r\n or \n)
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const parsed = parseOhausLine(line);
        if (parsed === null) continue;

        currentWeight = parsed.kg;
        console.log(`  Weight: ${parsed.kg.toFixed(3)} kg  (raw: ${parsed.raw.toFixed(3)} ${parsed.unit}${parsed.stable ? '' : ' ?'})`);
      }
    });

    serialPort.on('error', (err) => {
      console.error('  Serial error:', err.message);
      isConnected = false;
      scheduleReconnect();
    });

    serialPort.on('close', () => {
      console.log('  Serial port closed');
      isConnected = false;
      scheduleReconnect();
    });

  } catch (error) {
    console.error('  Failed to initialize serial port:', error.message);
    console.log('  Run with --mock flag for testing without scale\n');
    isConnected = false;
  }
}

// Reconnect guard — prevents multiple simultaneous reconnect attempts
let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  console.log('  Reconnecting in 5 seconds...');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initSerialPort();
  }, 5000);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});
