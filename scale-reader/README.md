# Scale Reader

**Rogue Origin Operations Hub**
Live scale weight display for the bag-packing station, with cloud sync to
the production dashboard and scoreboard.

---

## Hardware

- **OHAUS Defender 5000** indicator (100 lb × 0.005 lb)
- Connected via **RS-232** (DB9 cable) into an **FTDI USB-serial adapter**
  plugged into the station PC

---

## Setup

Don't follow this README for installation — it's not a step-by-step guide.
Use these instead:

- **[SETUP-INSTRUCTIONS.md](SETUP-INSTRUCTIONS.md)** — full install/config
  walkthrough for a station PC (driver check, `git pull`, `npm install`,
  COM port, auto-start, verifying the bag-logging workflow on
  [hourly-entry.html](https://rogueff.github.io/rogue-origin-apps/hourly-entry.html)).
- **[OPERATOR-SOP.md](OPERATOR-SOP.md)** — one-page floor procedure
  (English/Spanish) for filling and logging bags. Post this at the scale
  station.
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — diagnostics and fixes for
  a station that's already set up.

---

## What's in this folder

```
scale-reader/
├── index.js                     Main app: RS-232 reader + Express server
├── launcher.js                  pkg-built exe wrapper (auto-update + restart)
├── mock-server.py               Hardware-free mock backend for demos/testing
├── package.json                 Dependencies + pkg build config
├── start-scale-reader.bat       Windows launcher (COM port is set here)
├── install-autostart.bat        Registers auto-start (source build)
├── install-autostart-bat.bat    Registers auto-start (start-scale-reader.bat)
├── build.bat                    Builds the standalone ScaleReader.exe
├── raw-test.js / test-serial.js Low-level serial diagnostics
├── public/                      Local display (index.html / scale.css / scale.js)
├── SETUP-INSTRUCTIONS.md        Station PC install guide
├── OPERATOR-SOP.md              Floor procedure (EN/ES)
├── TROUBLESHOOTING.md           Diagnostics and fixes
├── BUILD.md                     Building the standalone .exe with pkg
└── README.md                    This file
```

There is no `config.js` — the COM port is set directly in
`start-scale-reader.bat` (see SETUP-INSTRUCTIONS.md), and other settings
(API URL, push interval, target weight) live in the `CONFIG` object at the
top of `index.js`.

---

## System flow

```
OHAUS Defender 5000 (RS-232)
    ↓ FTDI USB-serial adapter
COMx (9600 baud)
    ↓
Node.js Scale Reader (index.js)
    ├→ Local display (http://localhost:3000) — instant
    └→ Cloud API (pushed every 500ms)
           ↓
       D1 database
           ↓
       Scoreboard + Hourly Entry (poll every ~1s)
```

**Local API:** `GET /api/weight` → `{"weight":1.18,"targetWeight":5,"percentComplete":24,"isConnected":true}`

**Cloud API:**
`https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scaleWeight`

---

## Support

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) first.
2. Check `logs\scale-reader.log` in this folder.
3. Ask the manager — include the console window output if something's wrong.
