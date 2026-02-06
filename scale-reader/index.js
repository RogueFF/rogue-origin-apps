/**
 * Scale Reader for Brecknell GP100
 *
 * Reads weight from USB scale, displays locally, and pushes to cloud API.
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
  serialBaud: 9600,       // Brecknell GP100 default
  stationId: 'line1',
  targetWeight: 5.0,      // kg
};

// State
let currentWeight = 0;
let isConnected = false;
let useMock = process.argv.includes('--mock');
let serialPort = null;

// Weight debouncing - prevents oscillation from noisy serial data
let lastStableWeight = 0;      // Last non-zero weight we read
let zeroReadingCount = 0;       // How many consecutive zero readings
const ZERO_READINGS_THRESHOLD = 5; // Need 5 consecutive zeros to actually go to zero (2.5s at 500ms polling)

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
    lastStableWeight = currentWeight;
    zeroReadingCount = 0;
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

      // Poll scale for weight every 500ms (Brecknell/NCI protocol)
      setInterval(() => {
        if (serialPort.isOpen) {
          // Send weight request command (NCI protocol: 'W' or 'P')
          serialPort.write('W\r\n');
        }
      }, 500);
    });

    serialPort.on('data', (data) => {
      // Buffer incoming bytes since scale sends one byte at a time
      buffer += data.toString('ascii');

      // Process complete lines (ending with \r\n or \n)
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        // Brecknell GP100 format: "  4.72 kg" or "    2.4lb"
        // Parse the weight value from the response
        const match = line.match(/([\d.]+)\s*(kg|lb)/i);
        if (match) {
          let weight = parseFloat(match[1]);
          const unit = match[2].toLowerCase();

          // Convert lbs to kg if needed
          if (unit === 'lb') {
            weight = weight * 0.453592;
          }

          let rawWeight = Math.max(0, Math.round(weight * 100) / 100);

          // Debouncing logic to prevent oscillation
          if (rawWeight === 0 || rawWeight < 0.05) {
            // Reading zero or near-zero
            zeroReadingCount++;
            if (zeroReadingCount >= ZERO_READINGS_THRESHOLD) {
              // Consistently reading zero - actually set to zero
              currentWeight = 0;
              lastStableWeight = 0;
              console.log(`  Weight: 0.00 kg (bag removed)`);
            } else {
              // Still seeing zeros, but not enough yet - keep last stable weight
              currentWeight = lastStableWeight;
            }
          } else {
            // Valid weight reading
            zeroReadingCount = 0;
            lastStableWeight = rawWeight;
            currentWeight = rawWeight;
            console.log(`  Weight: ${currentWeight.toFixed(2)} kg (${match[1]} ${unit})`);
          }
        }
      }
    });

    serialPort.on('error', (err) => {
      console.error('  Serial error:', err.message);
      isConnected = false;
    });

    serialPort.on('close', () => {
      console.log('  Serial port closed');
      isConnected = false;

      // Try to reconnect after 5 seconds
      setTimeout(initSerialPort, 5000);
    });

  } catch (error) {
    console.error('  Failed to initialize serial port:', error.message);
    console.log('  Run with --mock flag for testing without scale\n');
    isConnected = false;
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});
