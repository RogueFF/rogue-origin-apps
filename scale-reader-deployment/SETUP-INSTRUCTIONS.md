# Scale Reader Setup — Station PC

Complete setup instructions for installing the OHAUS Defender 5000 scale
reader on a Windows station PC.

**Time required:** ~10 minutes
**Prerequisites:** Windows 10/11, internet connection, admin rights (only
for driver install)

---

## What you're installing

A small program that reads live weight from the OHAUS Defender 5000 scale
(via the USB-serial adapter) and pushes it to the Rogue Origin dashboard.
It starts automatically when the computer boots and restarts itself if it
crashes.

---

## Hardware check

Before starting, confirm the following are plugged in:

- OHAUS Defender 5000 indicator powered on
- DB9 cable from indicator to the USB-serial adapter
- FTDI USB-serial adapter plugged into the PC

---

## Step 1 — Confirm the FTDI driver is installed

1. Plug the USB-serial adapter into the PC.
2. Press `Win + X` then choose **Device Manager**.
3. Expand **Ports (COM & LPT)**.
4. You should see an entry like **USB Serial Port (COM4)**.

**Write down the COM number.** These instructions assume COM4 — if yours
is different, substitute your number everywhere you see `COM4`.

If no COM port appears, download the FTDI VCP driver from
https://ftdichip.com/drivers/ , install it, and try again.

---

## Step 2 — Open a Command Prompt

Press `Win + R`, type `cmd`, press Enter.

---

## Step 3 — Pull the latest code

Copy/paste this block into the Command Prompt:

```
cd C:\Users\Koasm\Desktop\Dev\rogue-origin-apps
git fetch origin
git checkout claude/integrate-ohaus-scale-8GpXY
git pull
```

**Note:** If the repo lives somewhere else on this PC, replace the first
line with the correct path. If the repo isn't on this PC yet, clone it
first with `git clone https://github.com/RogueFF/rogue-origin-apps.git`.

---

## Step 4 — Install dependencies

```
cd scale-reader-deployment
npm install
```

This takes about 10 seconds. Warnings about deprecated packages are
normal and can be ignored.

---

## Step 5 — Smoke-test the reader manually

```
start-scale-reader.bat
```

A console window will open and you should see:

```
Starting scale reader on COM4...
Connected to scale on COM4

  Weight: 0.136 kg  (raw: 136.000 g)
```

Open a browser to http://localhost:3000 — you'll see a live grams display
with a circular progress ring. Place a known weight on the scale and
confirm the display tracks it.

**If you see "NO DATA RECEIVED" or connection errors:** the COM port is
wrong or the indicator isn't in the right output mode. Press `Ctrl+C` and
contact Aidan before continuing.

Once you've confirmed it works, press `Ctrl+C` to stop.

---

## Step 6 — Install auto-start

```
install-autostart-bat.bat
```

You'll see a confirmation: `[OK] Scale reader will auto-start on next
login.`

This places a shortcut in your Windows Startup folder. From now on, every
time you log into Windows, the scale reader will launch automatically.

---

## Step 7 — Verify auto-start works

Two ways to test:

**Without rebooting:**
1. Press `Win + R`, type `shell:startup`, press Enter.
2. Double-click **Rogue Origin Scale Reader**.
3. A console window should pop up and start reading the scale.

**With rebooting:**
1. Restart Windows.
2. Log back in.
3. After ~15 seconds, a console window should appear automatically
   showing live weight readings.

---

## Daily use

You don't have to do anything. The reader runs in the background whenever
the PC is on.

- **Console window open:** good — it's working.
- **Console window closed:** if you close it by mistake, double-click
  *Rogue Origin Scale Reader* in the Startup folder (`shell:startup`) or
  reboot the PC.
- **Live display:** http://localhost:3000 (bookmark it).
- **Stopping the reader:** close the console window, or press `Ctrl+C`
  inside it.

---

## Troubleshooting

**"Connected" shows but weight stays at 0:** the indicator isn't in Print
or Continuous mode. Check the indicator menu → RS-232 → set Print mode to
Stable or Continuous, baud to 9600.

**"No data received" or connection errors:** the COM port changed.
Windows sometimes renumbers FTDI adapters after reboots. Check Device
Manager for the new number and edit lines 29 and 43 of
`start-scale-reader.bat` to match.

**"Port already open" errors:** you have two instances running. Close one
(check the taskbar for duplicate console windows).

**`git pull` fails at startup:** no internet or a conflict. The reader
will still start with whatever code was last pulled. Resolve the git
issue on your own time — nothing blocks the crew.

**Reader exits immediately at startup:** likely a Node.js version issue.
Confirm with `node --version` — needs v18 or newer.

---

## Removing auto-start

Press `Win + R`, type `shell:startup`, press Enter. Delete the
**Rogue Origin Scale Reader** shortcut. The reader will no longer launch
at login. The manual `start-scale-reader.bat` still works.

---

## Questions

Contact Aidan. Include the console window contents if something's going
wrong.
