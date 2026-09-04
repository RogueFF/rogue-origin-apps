# Tag & Desk — Design (v1, live trial)

**Date:** 2026-09-03
**Status:** Approved by Koa to deploy as a new page beside `kanban.html` for a live trial, with migration to follow.
**Builds on:** the Supply Kanban review + prototype (artifacts "Supply Kanban Review" and "Tag & Desk", 2026-09-03), `2026-08-10-grove-reorder-alert-design.md` (Damon email lane), `2026-09-02-grove-bag-bins-design.md` (bins; folded in as the Grove tab, not yet backed by tables).

The live Supply Kanban is a catalogue of 93 printed-card previews with a cart bolted on. The two jobs it exists for — a floor worker confirming one scan, and the orderer placing one complete order per vendor on a check day — have no screen of their own. Tag & Desk gives each one: the **Tag** (what a phone shows after a scan) and the **Desk** (an Ops Hub page organised around the next check day).

## 1. What Koa settled (2026-09-03, asked one by one)

| Question | Decision |
|---|---|
| Order cadence | Cart vendors (Uline, Amazon, Walmart) are **checked Mon / Wed / Fri** and pushed off when stocked. No fixed Friday. |
| Levels | **Two-bin system** for everything but cardboard boxes. Green card between the bins; **red card at the very bottom = completely out, must never fire**. Never over-order; repeated run-outs raise the carry level. |
| Zones | Grove Rack A-1 is the Grove Bags Rack (merge). T-Zero Rack ≠ T-Zero Room. Unplaced cards: Koa places them in the app. |
| Data | Strapping cards 70 + 105 are one card at $77/kit. Gloves are 100 per box ($13). |
| Print | All four families in use today (6×4 stack, 8.5×11 sheet, small labels, Sticker Mule); standardize later. |
| Scans | Anonymous. No device-name prompt. |
| Legacy cards | Old `?flag=` cards keep working 60 days after a vendor's reprint. |
| Auth | Free scans, locked desk (Phase A — not in v1, parity with today). |
| Sticker Mule | List the other two, Koa decides. |
| Rags | Still Uline, keep the check. |
| Receipt | One tap, no order number / total fields. |
| Phone | **No orders are placed from the phone.** It scans, reviews, receives. |

## 2. v1 scope: a new page, the worker untouched

`src/pages/tag-desk.html` + `src/css/tag-desk.css` + `src/js/tag-desk/*` (ESM), deployed on Pages next to `kanban.html`. Both pages read and write the same D1 tables through the existing `/api/kanban` actions, so the trial can run for weeks with either page in use.

**Reads:** `cards`, `getCart`, `getOrderHistory?limit=500`, `getReorderRequests?status=all`. Cadence (order days, median gap, expected next run-out, silent) is computed in the page from the order log, exactly as the review specified.

**Writes (existing actions):**

| Desk / Tag action | API |
|---|---|
| Scan (Tag), Add from the desk | `addToCart {cardId, qty: suggested, addedBy:'tag'|'desk'}` — the Tag first reads the cart and does **not** call it for a card already queued (idempotent re-scan; the worker itself sums). |
| Red card | `addToCart {…, note:'RED CARD'}` (if already queued: add 1 with the note, then `updateCartQty` back). The Desk reads the note → OUT alarm. |
| Tell the desk it's urgent | same trick with `note:'URGENT'` |
| +1 | `addToCart {qty:1, addedBy:'tag+1'}` (sums) |
| Quantity, Remove | `updateCartQty`, `removeFromCart` |
| Mark N ordered | `markOrdered {vendor, placedBy:'desk'}` |
| Levels / slot / vendor / name | `update` with the **full merged row** (`orderQty:'x<fill>'`, `orderWhen:'<reorder>'` or `'Green Card Signal'`, `crumbtrail:'<Zone> > <slot>'`) |
| New card | `add` |
| Delete permanently | `delete` (confirm) |
| Grove: Ask Damon again | `addToCart` on the Grove card → `already_open` + email retry |

**Desk memory (this device, `localStorage` key `ro-tagdesk-v1`):** receipts (per-item received / not shipped, arrival date, 10-minute undo), push-offs ("Stocked · push to Mon"), red-card acknowledgements, Grove "ordered with Damon" and bins, print state, per-card unit / print format, archived (hidden) cards, level-change dates. These have no tables yet; the page says so in its footer. Phase A moves them into D1 (`kanban_orders` status columns, `kanban_scans`, `kanban_prints`, `kanban_bins`).

**Undo after Mark ordered** re-adds the items to the cart and marks the `kanban_orders` row as undone in desk memory (there is no delete-order action). History shows it struck through.

**Not in v1:** password on desk writes (Phase A, with the worker), the Worker-served `/k/<token>` route (v1 QRs encode `tag-desk.html?flag=<id>` and `&red=1`), edge labels, `kanban_prints`.

## 3. The Tag (`tag-desk.html?flag=<id>`, `&red=1` for the red card)

Full-screen, one language at a time (the phone's), no app chrome. Outcomes: **Queued** (green, number, item, "next check Fri Sep 4"), **Already on the list** (green), **Counted · waiting for the check day**, **On order**, **Requested from Damon** (Grove), **OUT · red card** (red, zero), **Not saved** (red, Try again), **Card not recognised**. Undo for 30 s removes the worker's own scan. Nothing on the Tag places an order; escalation is "Tell the desk it's urgent".

## 4. The Desk

Order (vendor tiles → three lanes: Queued · About to run out · Check the shelf · plus "Due by the Wed check"; receipt + on-order strip with per-item Received / Not shipped; late orders; Next-vendor button), Cards (photo grid, filters, editor with two-bin levels), Print (green 6×4, red 6×4, full sheet; a work queue by vendor), Grove (With Damon · Bag bins), Tag (preview of every state). Phone: no order controls; review and receive.

"About to run out" = the order history says it runs out before the *following* check plus the card's own lead days could restock it. A just-received item can only be "due by the Wed check" or OK.

## 5. Migration path

1. v1 live beside `kanban.html`; new prints carry the new URL. 2. Phase A: worker auth on desk writes, `kanban_orders` lifecycle columns, `kanban_scans`, `/k/<token>` route, Grove bins tables — desk memory moves server-side. 3. `kanban.html?flag=` redirects to the Tag; 60 days after each vendor's reprint the old route is retired. 4. `kanban.html` removed from the rail.
