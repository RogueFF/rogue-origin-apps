# Scale Reader - Deployment Checklist

Use this checklist when deploying to the station PC.

---

## 📦 Pre-Deployment (On Your Computer)

- [x] Scale reader package created
- [x] All files copied to `scale-reader-deployment/`
- [x] Documentation complete
- [x] Tested with real scale (working!)

---

## 🚚 Transfer to Station PC

### Option 1: USB Drive
- [ ] Copy entire `scale-reader-deployment/` folder to USB drive
- [ ] Safely eject USB
- [ ] Plug into station PC
- [ ] Copy folder to `C:\RogueOrigin\scale-reader\`

### Option 2: Network Share
- [ ] Share the `scale-reader-deployment/` folder
- [ ] Access from station PC via network
- [ ] Copy to `C:\RogueOrigin\scale-reader\`

### Option 3: Cloud (OneDrive/Dropbox)
- [ ] Upload `scale-reader-deployment/` folder
- [ ] Download on station PC
- [ ] Extract to `C:\RogueOrigin\scale-reader\`

---

## 🖥️ Station PC Setup

### System Check
- [ ] Windows 10 or 11
- [ ] Has internet connection
- [ ] Has USB port available
- [ ] User has admin rights (for installation)

### Node.js Installation
- [ ] Check if already installed: `node --version`
- [ ] If not: Download from https://nodejs.org/
- [ ] Install with default settings
- [ ] Restart computer if prompted
- [ ] Verify: `node --version` shows v18+

### Files in Place
- [ ] Folder exists: `C:\RogueOrigin\scale-reader\`
- [ ] Contains all files (see Package Contents below)
- [ ] Can see `start-scale-reader.bat`

---

## 🔌 Hardware Setup

### Scale Connection
- [ ] Brecknell GP100 plugged into USB
- [ ] Windows shows "Device ready" notification
- [ ] Check Device Manager for COM port
- [ ] Note COM port number (usually COM3)

### Find COM Port (if needed)
```cmd
powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"
```
- [ ] COM port identified: ____________

### Configure COM Port
- [ ] Edit `config.js` in Notepad
- [ ] Set `comPort: 'COM__'` to match your port
- [ ] Save and close

---

## ⚙️ Software Installation

### Dependencies
Open Command Prompt as Administrator:
```cmd
cd C:\RogueOrigin\scale-reader
npm install
```

Checklist:
- [ ] Ran `npm install`
- [ ] No errors shown
- [ ] `node_modules/` folder created
- [ ] Packages installed successfully

---

## 🧪 Testing

### First Run (Test Mode)
```cmd
node index.js
```

Check for:
- [ ] "Connected to scale on COM__" message
- [ ] "Scale Reader running at http://localhost:3000"
- [ ] No error messages
- [ ] Can open http://localhost:3000 in browser

### Weight Test
- [ ] Place something on scale
- [ ] Scale display shows weight
- [ ] Browser display shows same weight (converted to kg)
- [ ] Weight updates in real-time
- [ ] Remove item - weight returns to 0.00

### Stop Test
- [ ] Press `Ctrl+C` to stop
- [ ] Server stops cleanly

---

## 🚀 Auto-Start Configuration

### Copy Startup Script
```cmd
copy start-scale-reader.bat "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\"
```

Checklist:
- [ ] Startup script copied
- [ ] Verify file exists in Startup folder
- [ ] Test: Restart computer
- [ ] After reboot: Check if scale reader auto-started
- [ ] Verify http://localhost:3000 works

---

## 🌐 Display Setup

### Browser Shortcut
Create desktop shortcut:
- [ ] Right-click Desktop → New → Shortcut
- [ ] Location: `http://localhost:3000`
- [ ] Name: "Scale Display"
- [ ] Icon created on desktop

### Full-Screen Mode
- [ ] Open shortcut
- [ ] Press F11 for full-screen
- [ ] Test double-click for full-screen toggle
- [ ] Test ESC to exit full-screen

### Language Test
- [ ] Click "ES" button
- [ ] Interface switches to Spanish
- [ ] Click "EN" to switch back
- [ ] Language persists after refresh

---

## ☁️ Cloud Integration Test

### API Connection
```cmd
curl http://localhost:3000/api/weight
```

Expected response:
```json
{"weight":1.18,"targetWeight":5,"percentComplete":24,...}
```

Checklist:
- [ ] Local API responds
- [ ] Shows current weight
- [ ] `isConnected: true`

### Cloud API
```cmd
curl https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight
```

Checklist:
- [ ] Cloud API responds
- [ ] Shows current weight from scale
- [ ] `isStale: false` (if scale reader running)
- [ ] Weight matches local display

### Scoreboard Test
Open: https://rogueff.github.io/rogue-origin-apps/scoreboard.html

Checklist:
- [ ] Scoreboard loads
- [ ] Scale weight appears in timer panel
- [ ] Shows green dot (live indicator)
- [ ] Updates every 1 second
- [ ] Matches weight on local display (1-2 second delay acceptable)

---

## 📊 Final Verification

### System Health
- [ ] Scale reader auto-starts on boot
- [ ] Local display accessible
- [ ] Weight readings accurate
- [ ] Cloud API receiving data
- [ ] Scoreboard showing live weight
- [ ] No errors in logs

### Performance Check
- [ ] Weight updates are smooth (no lag)
- [ ] CPU usage < 5%
- [ ] Memory usage < 100MB
- [ ] No console errors in browser

### Documentation
- [ ] QUICK-START.txt on desktop for reference
- [ ] Troubleshooting guide accessible
- [ ] IT contact info documented

---

## 📁 Package Contents Verification

Files that should be present:

**Core Files:**
- [ ] `index.js` - Main application
- [ ] `package.json` - Dependencies list
- [ ] `config.js` - Configuration
- [ ] `start-scale-reader.bat` - Startup script

**Documentation:**
- [ ] `README.md` - Overview
- [ ] `INSTALLATION.md` - Setup guide
- [ ] `TROUBLESHOOTING.md` - Problem solving
- [ ] `QUICK-START.txt` - Quick reference
- [ ] `DEPLOYMENT-CHECKLIST.md` - This file

**Display Files (public/ folder):**
- [ ] `index.html` - Display page
- [ ] `scale.css` - Styles
- [ ] `scale.js` - Logic

**Test Tools (optional, for debugging):**
- [ ] `raw-test.js` - Serial diagnostic
- [ ] `test-serial.js` - Scale communication test

**After npm install:**
- [ ] `node_modules/` - Packages folder

---

## ✅ Sign-Off

### Installed By:
- Name: ___________________________
- Date: ___________________________
- Time: ___________________________

### Tested By:
- Name: ___________________________
- Date: ___________________________
- Notes: ___________________________

### Verified By:
- Name: ___________________________
- Date: ___________________________
- Notes: ___________________________

---

## 🆘 Support Contacts

**Technical Issues:**
- IT Department: ___________________________
- Phone: ___________________________
- Email: ___________________________

**Scale Hardware:**
- Vendor: Brecknell
- Model: GP100-USB
- Serial #: ___________________________

**Deployment Package:**
- Version: 1.0.0
- Created: January 2026
- Location: C:\RogueOrigin\scale-reader\

---

**Deployment Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete

**Date Completed:** ___________________
