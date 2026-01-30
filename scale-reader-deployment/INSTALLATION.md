# Scale Reader - Station PC Installation Guide

**Rogue Origin - Live Scale Weight Display**

This package contains everything needed to run the scale reader on your station PC.

---

## 📦 What This Does

- Reads weight from Brecknell GP100 scale via USB
- Displays live weight on local screen (instant feedback)
- Sends weight to cloud every 500ms
- Updates scoreboard TV automatically
- Auto-converts lbs → kg

---

## 🖥️ System Requirements

- **Windows 10/11** (any version)
- **USB port** for scale connection
- **Internet connection** for cloud sync
- **Node.js 18+** (we'll install this)

---

## 📋 Installation Steps

### Step 1: Install Node.js (if needed)

1. **Check if Node.js is already installed:**
   - Open Command Prompt (search "cmd" in Start menu)
   - Type: `node --version`
   - If you see a version number like `v25.2.1`, **skip to Step 2**

2. **If Node.js is NOT installed:**
   - Download from: https://nodejs.org/
   - Click "Download for Windows (x64)"
   - Run the installer (accept all defaults)
   - Restart computer

### Step 2: Copy Files to Station PC

1. Copy the entire `scale-reader-deployment` folder to:
   ```
   C:\RogueOrigin\scale-reader\
   ```
   (Create the folder if it doesn't exist)

### Step 3: Install Dependencies

1. Open Command Prompt **as Administrator**
   - Right-click Start menu → "Terminal (Admin)" or "Command Prompt (Admin)"

2. Navigate to the folder:
   ```cmd
   cd C:\RogueOrigin\scale-reader
   ```

3. Install required packages:
   ```cmd
   npm install
   ```
   (This takes 30-60 seconds)

### Step 4: Connect the Scale

1. Plug Brecknell GP100 into USB port
2. Wait for Windows to install drivers (automatic)
3. Note which COM port it uses (usually COM3)

**To find COM port:**
```cmd
powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"
```

### Step 5: Configure COM Port (if not COM3)

1. Open `config.js` in Notepad
2. Change `COM3` to your port (e.g., `COM4`)
3. Save and close

### Step 6: Test the Scale

1. Run the test command:
   ```cmd
   node index.js
   ```

2. You should see:
   ```
   Connected to scale on COM3
   Scale Reader running at http://localhost:3000
   ```

3. Open browser: http://localhost:3000
4. Place something on scale
5. Watch weight update!

6. Press `Ctrl+C` to stop the test

---

## ⚙️ Auto-Start on Boot (Recommended)

Make the scale reader start automatically when the PC boots.

### Option 1: Task Scheduler (Recommended)

1. Copy `start-scale-reader.bat` to startup location:
   ```cmd
   copy start-scale-reader.bat "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\"
   ```

2. Restart PC to test

3. Check system tray for "Scale Reader" icon

### Option 2: Manual Startup

Double-click `start-scale-reader.bat` whenever you need it running.

---

## 🌐 Opening the Display

The scale display runs locally at: **http://localhost:3000**

**To open on startup:**
1. Create desktop shortcut
2. Right-click Desktop → New → Shortcut
3. Location: `http://localhost:3000`
4. Name: "Scale Display"
5. Double-click to open in browser

**Full-screen mode:**
- Press `F11` or double-click the display
- Perfect for dedicated scale monitor!

---

## 🔧 Troubleshooting

### Scale not reading weight

**Problem:** Display shows 0.00 kg but scale has weight

**Solutions:**
1. Check scale display - is it showing weight?
2. Check COM port in `config.js` matches actual port
3. Scale might be in wrong mode - see Scale Configuration section
4. Try unplugging and replugging USB cable
5. Restart the scale reader

### "Port already in use" error

**Problem:** Another program is using the serial port

**Solutions:**
1. Close any other scale software
2. Check Task Manager for other `node.exe` processes
3. Restart computer
4. Run: `taskkill /F /IM node.exe` (kills all Node processes)

### Display not updating

**Problem:** Browser shows old weight or doesn't update

**Solutions:**
1. Hard refresh browser: `Ctrl+Shift+R`
2. Clear browser cache
3. Check if scale reader is running (check logs)
4. Restart scale reader

### Internet connection issues

**Problem:** Cloud API not receiving data (local display works)

**Solutions:**
1. Check internet connection
2. Local display continues to work (offline mode)
3. Cloud will sync when connection restored
4. Scoreboard will show "stale" indicator

---

## 📁 File Reference

| File | Purpose |
|------|---------|
| `index.js` | Main scale reader app |
| `package.json` | Dependencies list |
| `config.js` | Settings (COM port, API URL) |
| `start-scale-reader.bat` | Windows startup script |
| `public/index.html` | Local display HTML |
| `public/scale.css` | Display styles |
| `public/scale.js` | Display logic |
| `INSTALLATION.md` | This file |
| `TROUBLESHOOTING.md` | Detailed troubleshooting |

---

## 🔌 Scale Configuration

If scale doesn't send data, configure it:

### Enter Setup Mode
1. Press and hold **TARE** for 3-5 seconds
2. Release when display shows "UNITS"

### Configure Port Settings
1. Press **UNITS** until display shows "Port"
2. Press **TARE** to enter
3. Confirm protocol is **NCI**
4. Press **TARE** to accept

### Set Baud Rate
1. Press **UNITS** until display shows "bAud"
2. Press **TARE**, then **UNITS** to select **9600**
3. Press **TARE** to confirm
4. Press **ZERO** to exit

---

## 📊 Monitoring & Logs

### Check if it's running
```cmd
tasklist | find "node"
```

### View live logs
```cmd
cd C:\RogueOrigin\scale-reader
type logs\scale-reader.log
```

### Restart the service
```cmd
cd C:\RogueOrigin\scale-reader
start-scale-reader.bat
```

---

## 🆘 Support

**Issues?** Check:
1. TROUBLESHOOTING.md (detailed solutions)
2. logs\scale-reader.log (error messages)
3. System tray icon status

**Contact:** Your IT person or the developer who set this up

---

## ✅ Success Checklist

After installation, verify:

- [ ] Node.js installed (`node --version` works)
- [ ] Files copied to `C:\RogueOrigin\scale-reader\`
- [ ] Dependencies installed (`node_modules` folder exists)
- [ ] Scale connected (COM port found)
- [ ] Test run successful (weight appears)
- [ ] Auto-start configured (boots with Windows)
- [ ] Browser bookmark created (easy access to display)
- [ ] Full-screen mode tested (F11 key)

---

**Installation complete!** 🎉

Place a 5kg bag on the scale and watch the magic happen!
