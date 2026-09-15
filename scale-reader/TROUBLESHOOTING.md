# Scale Reader - Troubleshooting Guide

Common issues and how to fix them.

Hardware: **OHAUS Defender 5000**, connected via RS-232 through an FTDI
USB-serial adapter. If you haven't done initial setup yet, see
[SETUP-INSTRUCTIONS.md](SETUP-INSTRUCTIONS.md) instead.

---

## 🔍 Quick Diagnostics

### Is the scale reader running?

```cmd
tasklist | find "node"
```

**Expected:** You should see `node.exe` in the list
**If not:** Start it with `start-scale-reader.bat`

### Is the scale connected?

```cmd
powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"
```

**Expected:** Shows a COM port (e.g. `COM4`)
**If empty:** FTDI adapter not connected or drivers not installed — see
Step 1 of SETUP-INSTRUCTIONS.md

### Can you access the display?

Open: http://localhost:3000

**Expected:** Scale display loads
**If not:** Scale reader isn't running

---

## ❌ Common Errors

### Error: "Cannot find module 'express'"

**Cause:** Dependencies not installed

**Fix:**
```cmd
cd <path-to-repo>\scale-reader
npm install
```

### Error: "Port COMx not found" / reader connects to the wrong port

**Cause:** The COM port changed — Windows sometimes renumbers FTDI
adapters after a reboot or after using a different USB port.

**Fix:**
1. Find the correct port:
   ```cmd
   powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"
   ```
2. Edit `start-scale-reader.bat` — the COM port is hardcoded on **lines
   29, 32, and 43** (`COM4` by default). Change all three to match.
3. Restart the scale reader.

There is no `config.js` for this — the port lives directly in
`start-scale-reader.bat`. If you're running `node index.js` manually
instead of the `.bat`, pass the port as an argument: `node index.js COM4`.

### Error: "Address already in use"

**Cause:** Port 3000 is being used by another program

**Fix Option 1 - Kill other process:**
```cmd
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

**Fix Option 2 - Use a different port:**
Edit the `port` value in the `CONFIG` object at the top of `index.js`,
then restart. (This is a code edit, not a config file — commit it if you
want it to persist across `git pull`.)

### Error: "Access is denied" (COM port)

**Cause:** Another program is using the scale

**Fix:**
1. Close any shipping software (UPS WorldShip, etc.)
2. Close other scale readers
3. Restart computer
4. Try again

---

## 📊 Scale Not Reading Weight

### Scale display shows weight but app shows 0.00 / "NO DATA RECEIVED"

**Cause:** The indicator isn't in the right RS-232 output mode.

**Fix - Configure the indicator:**

1. Open the indicator's setup menu and navigate to **RS-232** settings.
2. Set the print mode to **Stable** or **Continuous** (either works —
   Continuous streams weight constantly, Stable prints on settle).
3. Set baud rate to **9600**, 8-N-1.
4. Exit setup and confirm the indicator's display is stable.
5. Test: place weight on the scale and watch the scale-reader console —
   you should see `Weight: X.XXX kg` lines.

If you're not sure how to reach the RS-232 menu on your indicator model,
check the OHAUS Defender 5000 manual or ask the manager.

### App shows "Connected" but still 0.00

**Cause:** Indicator isn't printing/streaming weight

**Fix:**
1. Check the console for `Weight: X.XX kg` messages.
2. If none appear, re-check the RS-232 print mode above.
3. Restart the scale reader.

---

## 🌐 Cloud Sync Issues

### "API push failed: 404"

**Cause:** Cloud API endpoint not deployed

**Fix:** Contact the manager - backend needs deployment

### Display works but scoreboard shows stale

**Cause:** No internet connection or cloud API down

**Fix:**
1. Check internet connection
2. Test API manually:
   ```cmd
   curl https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight
   ```
3. Local display continues working offline
4. Cloud will sync when connection restored

---

## 🖥️ Display Issues

### Display shows but doesn't update

**Cause:** JavaScript error or browser cache

**Fix:**
1. Hard refresh: `Ctrl + Shift + R`
2. Clear browser cache
3. Try different browser
4. Check browser console (F12) for errors

### Ring animation stuttering

**Cause:** Computer performance issue

**Fix:**
1. Close other programs
2. Use Chrome or Edge (better performance)
3. Reduce visual effects (acceptable tradeoff)

### Wrong language showing

**Cause:** Language setting stuck

**Fix:**
1. Click EN/ES button in corner
2. Clear browser localStorage:
   - Open browser console (F12)
   - Type: `localStorage.clear()`
   - Refresh page

---

## 🔄 Auto-Start Issues

### Scale reader doesn't start on boot

**Cause:** Startup shortcut not registered

**Fix:**
1. Check the Startup folder (`Win+R` → `shell:startup`)
2. Should see "Rogue Origin Scale Reader"
3. If missing, run `install-autostart-bat.bat` again

### Startup script runs but scale reader fails

**Cause:** Script runs before the scale/adapter is ready, or the COM
port is wrong (see "Port COMx not found" above)

**Fix:** Edit `start-scale-reader.bat` and add a delay before the first
`node index.js COM4` line:
```batch
REM Wait 10 seconds for system to fully boot
timeout /t 10 /nobreak
```

---

## 📝 Checking Logs

### View current log file

```cmd
type logs\scale-reader.log
```
(run from inside the `scale-reader` folder)

### View last 20 lines (recent activity)

```cmd
powershell -Command "Get-Content logs\scale-reader.log -Tail 20"
```

### Common log messages

**Good:**
```
Connected to scale on COM4
Weight: 1.18 kg (2.6 lb)
Weight: 2.34 kg (5.2 lb)
```

**Bad:**
```
Serial error: Port COM4 not found
Error: Cannot find module 'express'
API push failed: 404
```

---

## 🔧 Advanced Diagnostics

### Test serial communication directly

```cmd
node raw-test.js
```
(run from inside the `scale-reader` folder)

This sends both the OHAUS `P\r\n` print command and a legacy `W\r\n`
weight-request command, and prints whatever comes back — useful when
you're not sure the indicator is transmitting at all.

### Test API connection

```cmd
curl http://localhost:3000/api/weight
```

Expected:
```json
{"weight":1.18,"targetWeight":5,"percentComplete":24,"isConnected":true}
```

### Manual scale command test

```cmd
node test-serial.js
```

Follow the console output to see raw and parsed serial data.

---

## 🆘 When All Else Fails

### Training / demo mode (no scale needed)

Before assuming hardware is broken, confirm the *software* is healthy by
running mock mode — it exercises everything except the physical scale:
```cmd
node index.js --mock --mock-demo
```
See SETUP-INSTRUCTIONS.md's "Training / demo mode" section for details.

### Complete Reset

1. **Stop everything:**
   ```cmd
   taskkill /F /IM node.exe
   ```

2. **Unplug the FTDI adapter, wait 10 seconds, plug back in**

3. **Clear installation:**
   ```cmd
   rmdir /s /q node_modules
   del package-lock.json
   ```

4. **Reinstall:**
   ```cmd
   npm install
   ```

5. **Test:**
   ```cmd
   start-scale-reader.bat
   ```

### Check for Windows Updates

Sometimes USB/serial drivers need updates:
1. Settings → Windows Update
2. Check for updates
3. Install all updates
4. Restart computer

### Verify Node.js version

```cmd
node --version
```

Should be v18 or higher. If lower:
1. Download latest from https://nodejs.org/
2. Install (uninstalls old version automatically)
3. Restart computer
4. Try again

---

## 📞 Getting Help

**Before contacting the manager, gather:**

1. Error message (exact text)
2. Log file content (last 50 lines)
3. COM port number
4. Node.js version (`node --version`)
5. What you tried already

**Include in your message:**
- "Scale shows X on display but app shows Y"
- "Error appears when I do Z"
- "Logs show: [paste last 10 lines]"

---

## ✅ System Health Checklist

Run through this to verify everything is working:

- [ ] Node.js installed and working
- [ ] FTDI adapter plugged in, drivers installed
- [ ] COM port identified correctly
- [ ] `start-scale-reader.bat` has the correct COM port (lines 29, 32, 43)
- [ ] Dependencies installed (node_modules exists)
- [ ] Scale reader starts without errors
- [ ] Can access http://localhost:3000
- [ ] Weight shows on scale display
- [ ] Weight updates when changed
- [ ] Logs show "Weight: X.XX kg" messages
- [ ] Cloud API receiving data (if online)
- [ ] Auto-start working (if configured)

If all checked, system is healthy! 🎉
