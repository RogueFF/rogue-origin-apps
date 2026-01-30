# Scale Reader Setup Guide

Complete instructions for setting up the Brecknell GP100 scale reader on a new computer.

---

## Prerequisites

1. **Node.js** installed (v16 or higher)
   - Download: https://nodejs.org
   - Verify installation: `node --version`

2. **Physical scale** (Brecknell GP100) connected via USB

---

## Setup Steps

### Step 1: Get the Code

**Option A - From Git:**
```bash
git clone https://github.com/rogueff/rogue-origin-apps.git
cd rogue-origin-apps/scale-reader
```

**Option B - Copy Files:**
- Copy the entire `scale-reader/` folder to the new computer

---

### Step 2: Install Dependencies

```bash
cd scale-reader
npm install
```

This installs:
- `express` - Web server
- `serialport` - USB scale communication

---

### Step 3: Find the COM Port (Windows)

**Method 1 - Device Manager:**
1. Plug in the scale via USB
2. Open Device Manager (Win + X → Device Manager)
3. Expand "Ports (COM & LPT)"
4. Look for "USB Serial Port (COM3)" or similar
5. Note the COM number (e.g., COM3, COM4, COM5)

**Method 2 - Command Line:**
```bash
npx @serialport/list
```

This will show all available COM ports and their details.

---

### Step 4: Configure (Optional)

Edit `index.js` if you need to change defaults:

```javascript
const CONFIG = {
  port: 3000,              // Web server port
  apiUrl: '...',           // Cloud API endpoint
  pushInterval: 500,       // Push to API every 500ms
  serialBaud: 9600,        // Scale baud rate
  stationId: 'line1',      // Change to 'line2', 'line3', etc.
  targetWeight: 5.0,       // Target bag weight in kg
};
```

**Common changes:**
- `stationId` - Set to 'line1', 'line2', etc. (identifies which packing station)
- `targetWeight` - If using different bag sizes
- `port` - If 3000 is already in use

---

### Step 5: Start the Program

**With real scale:**
```bash
npm start
```

**Specify COM port manually:**
```bash
node index.js COM4
```
*(Replace COM4 with your actual COM port)*

**Test without scale (mock mode):**
```bash
npm run dev
```

---

### Step 6: Verify It Works

You should see output like:
```
  Scale Reader running at http://localhost:3000
  Mode: LIVE (serial port)

  Connecting to scale on COM3...
  Connected to scale on COM3

  Weight: 0.00 kg (0.0 lb)
  Weight: 0.00 kg (0.0 lb)
```

---

### Step 7: Open the Web Interface

1. Open browser to: **http://localhost:3000**
2. You'll see a live weight display
3. Place something on scale to test

---

### Step 8: Test with Real Weight

1. Place a bag or object on the scale
2. Watch console output change: `Weight: 2.34 kg (5.2 lb)`
3. Watch web interface update in real-time
4. Verify data is being pushed to cloud API

---

## Troubleshooting

### "Cannot find module 'serialport'"
```bash
npm install
```

### "Error: Access denied" or "Port not found"
- Check COM port in Device Manager
- Close any other programs using the scale
- Try unplugging and replugging the USB cable
- Run with specific port: `node index.js COM4`

### "Address already in use" (port 3000 taken)
- Change port in `index.js` (line 18)
- Or kill the process using port 3000

### Scale connected but no weight readings
- Verify scale is powered on
- Check baud rate matches scale (default: 9600)
- Try different USB cable or port
- Scale might use different protocol (check manual)

---

## Quick Reference Card

**For printing at each packing station:**

```
═══════════════════════════════════════════════
  SCALE READER - QUICK START
═══════════════════════════════════════════════

1. Open Terminal/Command Prompt

2. Go to folder:
   cd scale-reader

3. Start program:
   npm start

4. Open browser:
   http://localhost:3000

5. Place bag on scale → watch display update

═══════════════════════════════════════════════
  TROUBLESHOOTING
═══════════════════════════════════════════════

❌ Can't find scale?
   → Check USB cable connected
   → Run: node index.js COM4
      (try COM3, COM4, COM5)

❌ Program crashes?
   → Run: npm install
   → Try again

Need help? Contact IT support
═══════════════════════════════════════════════
```

---

## Configuration Details

### Station IDs
- `line1` - First packing line
- `line2` - Second packing line
- `line3` - Third packing line (if applicable)

### API Integration
The scale automatically pushes weight data to:
```
https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight
```

Data format:
```json
{
  "weight": 2.34,
  "stationId": "line1"
}
```

### Scale Communication
- Protocol: NCI/Brecknell standard
- Baud rate: 9600
- Command: Sends 'W\r\n' every 500ms to request weight
- Response format: "  4.72 kg" or "    2.4lb"

---

## Next Steps

Once the scale is working:
1. Keep the terminal window open (minimize it)
2. Open the web interface in browser
3. Start packing bags
4. Weight data will automatically log to the cloud

**Future enhancements:**
- Auto-track bags per hour
- Real-time pace indicators
- Weight quality control
- Predictive end-of-day forecasts

---

*Last updated: 2026-01-30*
