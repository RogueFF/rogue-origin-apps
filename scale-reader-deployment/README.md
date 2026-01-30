# Scale Reader - Deployment Package

**Rogue Origin Operations Hub**
Live scale weight display for 5kg bag packing station

---

## 📦 What's Included

This package contains everything needed to run the scale weight reader on your station PC.

```
scale-reader-deployment/
├── index.js                    # Main application
├── package.json                # Dependencies
├── config.js                   # Configuration (edit COM port here)
├── start-scale-reader.bat      # Windows startup script
├── public/                     # Local display files
│   ├── index.html
│   ├── scale.css
│   └── scale.js
├── INSTALLATION.md             # Step-by-step setup guide
├── TROUBLESHOOTING.md          # Common issues & fixes
└── README.md                   # This file
```

---

## 🚀 Quick Start

1. **Read INSTALLATION.md** - Complete setup instructions
2. **Install Node.js** - If not already installed
3. **Copy to PC** - `C:\RogueOrigin\scale-reader\`
4. **Run** - `npm install && node index.js`
5. **Open** - http://localhost:3000

---

## 🎯 Features

✅ **Real-time weight display**
- Circular progress ring
- Large, readable font
- Auto lbs → kg conversion
- Updates every 100-200ms

✅ **Bilingual support**
- English / Spanish toggle
- One-click language switch

✅ **Cloud integration**
- Syncs to Cloudflare API
- Updates scoreboard automatically
- Works offline (local display continues)

✅ **Production ready**
- Auto-start on Windows boot
- Error recovery
- Logging for troubleshooting

---

## 📋 Requirements

- Windows 10/11
- Node.js 18+
- Brecknell GP100 scale (USB)
- Internet connection (for cloud sync)

---

## 🔧 Configuration

Edit `config.js` to customize:

```javascript
{
  comPort: 'COM3',          // Your scale's COM port
  targetWeight: 5.0,        // Target bag weight (kg)
  stationId: 'line1',       // Station identifier
}
```

---

## 📱 Usage

### Local Display
Open http://localhost:3000 in any browser

**Features:**
- Press `F11` for full-screen
- Double-click for full-screen
- Click `ES` for Spanish

### Cloud Integration
Weight automatically syncs to:
```
https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight
```

Scoreboard polls this every 1 second.

---

## 🛠️ Support

**Issues?** Check these in order:

1. **INSTALLATION.md** - Setup instructions
2. **TROUBLESHOOTING.md** - Common problems
3. **Logs** - `logs/scale-reader.log`
4. **Contact IT** - If still stuck

---

## 🔄 Updates

To update to a new version:

1. Stop the running scale reader
2. Backup your `config.js`
3. Replace all files except `config.js`
4. Run `npm install`
5. Start scale reader

---

## 📊 System Flow

```
Brecknell GP100 Scale (USB)
    ↓
COM3 Serial Port (9600 baud)
    ↓
Node.js Scale Reader
    ├→ Local Display (localhost:3000) - INSTANT
    └→ Cloud API (500ms pushes)
           ↓
       D1 Database
           ↓
       Scoreboard (1s polling)
```

---

## ✅ Success Checklist

After installation, verify:

- [ ] Scale reader starts without errors
- [ ] Local display shows weight
- [ ] Weight updates when changed
- [ ] Lbs converts to kg correctly
- [ ] Cloud API receives data (check logs)
- [ ] Auto-start works (if configured)

---

**Version:** 1.0.0
**Last Updated:** January 2026
**Author:** Rogue Origin Dev Team

---

For detailed instructions, see **INSTALLATION.md**
