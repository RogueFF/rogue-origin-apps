# Trailer QR intake + one-crew harvest — design

Date: 2026-09-28 · Status: validated with Koa, not yet built

## Why

Barn loads were landing on no lot. Barn door 1 is labelled Crew A and only
looks for Crew A sessions, but two phones scan zone signs — one tagged Crew A,
one untagged. Every load cut under an untagged session saved with a NULL
attribution and dropped off the lot ledger (4 R1 loads on 9/24, 4 Z8 loads on
9/28, 1 Z10 load on 9/23). The two tag chains also leave two lots open at once,
because each phone only closes its own.

The operation is also changing: one large crew (two cutting groups, always in
the same zone and cultivar), trailers arriving from both sides of the barn, and
drivers logging their own loads instead of the waterspider.

## Design

### Zone side: one crew, one open lot
- Crew A / Crew B cards retire. Zone scans ignore the `rf_crew` cookie; new
  sessions are written with crew NULL.
- Exactly one open lot at a time. Scanning a zone sign closes whatever is open,
  regardless of the crew value on the old row (so the two parallel chains
  collapse on first scan after deploy).

### Trailer side: one QR per trailer
- Six trailers, T1–T6. New route `/t/<n>`, same pattern as `/z/<zone>`,
  `/b/<n>`, `/c/A`. No login, no cookie, any phone.
- Scan screen shows: trailer name, the lot it will log against (zone ·
  cultivar · cut), a 12-bay grid with **this trailer's last bay** pre-selected,
  and one big Log Load button.
- Bins default to 24 and are not an input. A "Partial" tap opens a small
  bin-count picker — the last trailer out of every zone is short (9/28 had 14,
  16, 22, each seconds before the next zone scan).
- Bay default is per trailer, not per crew or global: a trailer runs a loop to
  one side of the barn, so its own last bay is the best guess, and the two
  sides can fill different bays at once without handing each other defaults.
- "Different lot?" link opens the existing recent-lots picker (`pickedLot`).

### Data
- New nullable `trailer` column on `harvest_scan_log` (migration, manual per
  the D1 deploy rule). Old rows untouched.
- Unlocks loads per trailer per day and round-trip time per trailer.

### Edge cases
- **Double scan:** same trailer within **5 minutes** shows "T3 was logged at
  2:14 — log another?" instead of writing a duplicate.
- **No lot open:** the screen requires the driver to tap the zone they came
  from. A load is never saved unattributed again.
- **Zone change mid-trip:** existing 6-minute barn grace still sends the
  trailer to the lot it was cut in.
- **Both sides at once:** same lot, different bays. Nothing special.

### Kept
- `/b/1`, `/b/2` barn door pages stay as a fallback (torn decal, dead phone),
  without the crew label, using the same one-lot attribution.

### Printing
- `print_codes` gains a trailer packet: one page per trailer, huge T-number +
  QR, sized for a weatherproof decal. The printed number becomes the trailer's
  name.

## Data cleanup (separate step, needs Koa's call on Z8/Z21)

| Rows | Logged as | Proposed attribution |
|---|---|---|
| 140, 141, 142, 144 | R1, 9/24 | 139 R1 Strawberry Doughnuts cut 1 |
| 153 | Z8, 9/28 10:32 | 152 Z8 Orange Pineapple Quik cut 2 |
| 155, 156, 157 | Z8, 9/28 11:10–11:39 | 152, if the 10:55 Z21 scan was a mis-scan |
| 136 | Z10, 9/23 | 137 Z10 Strawberry Cream cut 2 (logged 5 min before scan) |
| 143 | Z10, 9/24 | attached to 137, but crew was in R1 all day — maybe 139 |

## Testing
- Unit: one-lot attribution with mixed crew values on open rows; per-trailer
  bay default; 5-minute double-scan window; partial bins; no-lot forced pick.
- Mock-routed Playwright for the `/t/<n>` screen, with the ctx-level
  workers.dev abort guard (never hit the live API from a new tab).
