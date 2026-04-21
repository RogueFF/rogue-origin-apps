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
git checkout master
git pull
```

**Note:** If the repo lives somewhere else on this PC, replace the first
line with the correct path. If the repo isn't on this PC yet, clone it
first with `git clone https://github.com/RogueFF/rogue-origin-apps.git`.

**During active development:** If Aidan tells you to test a specific
feature branch, use `git checkout <branch-name>` in place of
`git checkout master`. Otherwise `master` is the right target.

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

## Step 5.5 — Verify the bag-logging workflow

The scale drives two different bag SKUs: **5 kg bags** and **10 lb bags**.
The indicator's **UNIT** key is the switch — whichever unit is displayed
on the scale tells the app which bag you're packing.

- Scale shows **g** or **kg** → 5 kg workflow, only the **5 KG Bag
  Complete** button appears
- Scale shows **lb** → 10 lb workflow, only the **10 LB Bag Complete**
  button appears

Each button only becomes clickable when the weight is inside the correct
window (bag + product gross weight). Outside the window, the button is
greyed out.

**To test on the station PC:**

1. Leave the scale reader running (from Step 5).
2. Open http://localhost:3000 in a browser — you should see live grams.
3. On a second browser tab, open the scoreboard:
   https://rogueff.github.io/rogue-origin-apps/scoreboard-v2.html
4. With the scale in **grams** mode: place a full 5kg bag on the scale
   (~5,200 g total). The 5 KG Bag Complete button should appear and
   become clickable.
5. On the indicator, press **UNIT** until the display changes to **lb**.
   Within a few seconds the scoreboard should swap: 5 KG button hides,
   10 LB Bag Complete appears.
6. Put a full 10 lb bag on (~10.3 lb). The 10 LB button should become
   clickable.

If the buttons don't swap when you change the indicator unit, the scale
reader isn't forwarding the unit correctly — grab the console output and
ping Aidan.

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

You don't have to do anything on the PC. The reader runs in the
background whenever the computer is on.

- **Console window open:** good — it's working.
- **Console window closed:** if you close it by mistake, double-click
  *Rogue Origin Scale Reader* in the Startup folder (`shell:startup`) or
  reboot the PC.
- **Live display:** http://localhost:3000 (bookmark it).
- **Stopping the reader:** close the console window, or press `Ctrl+C`
  inside it.

**Switching between 5 kg and 10 lb bags during the day:**
The operator at the scale presses the **UNIT** key on the OHAUS
indicator. That's it — the scoreboard, tablet, and hourly-entry page all
detect the unit change within ~5 seconds and show the matching Log Bag
button. No app-side toggle needed.

- Packing 5 kg bags → indicator shows **g** (grams)
- Packing 10 lb bags → indicator shows **lb** (pounds)

The "Bags Today" counter keeps the two totals separate:
`5kg · N | 10lb · M`.

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

**Buttons don't swap when changing the indicator's UNIT key:** the scale
reader isn't forwarding the unit field. Check the console window — each
weight line should show the unit (`raw: 5000.000 g` or
`raw: 10.250 lb`). If it only shows grams regardless of what the
indicator displays, restart the scale reader (`Ctrl+C` then run
`start-scale-reader.bat` again).

**Both buttons appear at the same time:** either the scale is
disconnected (offline failsafe — both buttons stay enabled so production
can't halt) or the backend hasn't picked up the unit yet (check
`http://localhost:3000` — connection status at the top should be
green).

---

## Removing auto-start

Press `Win + R`, type `shell:startup`, press Enter. Delete the
**Rogue Origin Scale Reader** shortcut. The reader will no longer launch
at login. The manual `start-scale-reader.bat` still works.

---

## Questions

Contact Aidan. Include the console window contents if something's going
wrong.
