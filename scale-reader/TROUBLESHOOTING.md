# Scale Reader - Troubleshooting Guide

Common issues and how to fix them.

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

**Expected:** Shows `COM3` (or COM4, COM5, etc.)
**If empty:** Scale not connected or drivers not installed

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
cd C:\RogueOrigin\scale-reader
npm install
```

### Error: "Port COM3 not found"

**Cause:** Scale on different port or not connected

**Fix:**
1. Find the correct port:
   ```cmd
   powershell -Command "[System.IO.Ports.SerialPort]::GetPortNames()"
   ```

2. Edit `config.js` to match your port:
   ```javascript
   comPort: 'COM4',  // Change to your port
   ```

3. Restart scale reader

### Error: "Address already in use"

**Cause:** Port 3000 is being used by another program

**Fix Option 1 - Kill other process:**
```cmd
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

**Fix Option 2 - Use different port:**
Edit `config.js`:
```javascript
serverPort: 3001,  // Use port 3001 instead
```

Then access at: http://localhost:3001

### Error: "Access is denied" (COM port)

**Cause:** Another program is using the scale

**Fix:**
1. Close any shipping software (UPS WorldShip, etc.)
2. Close other scale readers
3. Restart computer
4. Try again

---

## 📊 Scale Not Reading Weight

### Scale display shows weight but app shows 0.00

**Cause:** Scale not configured for USB output

**Fix - Configure scale:**

1. **Enter setup mode:**
   - Press and hold TARE for 3-5 seconds
   - Release when you see "UNITS"

2. **Navigate to Port settings:**
   - Press UNITS until display shows "Port"
   - Press TARE to enter

3. **Set protocol to NCI:**
   - Press UNITS to cycle through protocols
   - Stop at "NCI"
   - Press TARE to confirm

4. **Set baud rate to 9600:**
   - Press UNITS until display shows "bAud"
   - Press TARE, then UNITS to select 9600
   - Press TARE to confirm

5. **Exit setup:**
   - Press ZERO

6. **Test:**
   - Place weight on scale
   - Press HOLD button
   - Weight should appear in app

### App shows "Connected" but still 0.00

**Cause:** Scale needs polling command

**Fix:** This should be automatic, but verify:

1. Check logs for "Weight: X.XX kg" messages
2. If no messages, scale might be in wrong mode
3. Try pressing HOLD button on scale
4. Restart scale reader

### Weight updates very slowly

**Cause:** Polling interval too slow

**Fix:** Edit `config.js`:
```javascript
pushInterval: 200,  // Faster polling (200ms instead of 500ms)
```

---

## 🌐 Cloud Sync Issues

### "API push failed: 404"

**Cause:** Cloud API endpoint not deployed

**Fix:** Contact IT - backend needs deployment

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

**Cause:** Startup script not in right location

**Fix:**
1. Verify startup folder:
   ```cmd
   dir "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
   ```

2. Should see `start-scale-reader.bat`

3. If missing, copy it:
   ```cmd
   copy start-scale-reader.bat "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\"
   ```

### Startup script runs but scale reader fails

**Cause:** Script runs before scale is ready

**Fix:** Edit `start-scale-reader.bat`, add delay:
```batch
REM Wait 10 seconds for system to fully boot
timeout /t 10 /nobreak

REM Then start scale reader
node index.js
```

---

## 📝 Checking Logs

### View current log file

```cmd
type C:\RogueOrigin\scale-reader\logs\scale-reader.log
```

### View last 20 lines (recent activity)

```cmd
powershell -Command "Get-Content C:\RogueOrigin\scale-reader\logs\scale-reader.log -Tail 20"
```

### Common log messages

**Good:**
```
Connected to scale on COM3
Weight: 1.18 kg (2.6 lb)
Weight: 2.34 kg (5.2 lb)
```

**Bad:**
```
Serial error: Port COM3 not found
Error: Cannot find module 'express'
API push failed: 404
```

---

## 🔧 Advanced Diagnostics

### Test serial communication directly

```cmd
cd C:\RogueOrigin\scale-reader
node raw-test.js
```

This shows raw data from the scale. You should see:
```
Received: "    2.4lb\r\n"
```

If you see nothing, scale isn't transmitting.

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
cd C:\RogueOrigin\scale-reader
node test-serial.js
```

Follow prompts to test scale communication.

---

## 🆘 When All Else Fails

### Complete Reset

1. **Stop everything:**
   ```cmd
   taskkill /F /IM node.exe
   ```

2. **Unplug scale, wait 10 seconds, plug back in**

3. **Clear installation:**
   ```cmd
   cd C:\RogueOrigin\scale-reader
   rmdir /s /q node_modules
   del package-lock.json
   ```

4. **Reinstall:**
   ```cmd
   npm install
   ```

5. **Test:**
   ```cmd
   node index.js
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

**Before contacting support, gather:**

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
- [ ] Scale plugged in, drivers installed
- [ ] COM port identified correctly
- [ ] config.js has correct COM port
- [ ] Dependencies installed (node_modules exists)
- [ ] Scale reader starts without errors
- [ ] Can access http://localhost:3000
- [ ] Weight shows on scale display
- [ ] Weight updates when changed
- [ ] Logs show "Weight: X.XX kg" messages
- [ ] Cloud API receiving data (if online)
- [ ] Auto-start working (if configured)

If all checked, system is healthy! 🎉
