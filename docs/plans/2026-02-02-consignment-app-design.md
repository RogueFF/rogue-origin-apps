# Consignment App — Design Document

**Date:** 2026-02-02
**Status:** Approved via brainstorm session with Koa

---

## Problem

Koa manages consignment product from 1-3 partner farms. Currently:
- No single source of truth for what's owed to each partner
- Partners ask for balance updates and Koa has to dig through records
- Intake/sale/payment tracking is scattered across spreadsheets and memory
- Physical inventory counts before payout are done manually with no system to record against

## Solution

A consignment tracking page inside rogue-origin-apps. Internal-only (no partner portal). Tracks intakes, sales, payments, and calculates balances owed to each partner farm.

## Architecture

- **Frontend:** `src/pages/consignment.html` + JS modules in `src/js/consignment/`
- **Backend:** New handler `workers/src/handlers/consignment-d1.js` in the existing Cloudflare Worker
- **Database:** New D1 tables alongside existing production/orders tables
- **Styling:** Extends shared-base.css, matches existing dark/light theme
- **Auth:** Same password auth as the rest of the dashboard
- **No external integrations.** No Shopify API. Fully self-contained.

## Data Model

### `consignment_partners`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Farm name |
| contact_name | TEXT | Nullable |
| email | TEXT | Nullable |
| phone | TEXT | Nullable |
| notes | TEXT | Nullable |
| created_at | TEXT | ISO timestamp |

### `consignment_strains`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT UNIQUE | Strain name |
| active | INTEGER | 1=active, 0=hidden |
| created_at | TEXT | ISO timestamp |

**Initial strains (13):**
Alium OG, Bubba Kush, Critical Berries, Lemon Octane, Orange Fritter, Puff Pastries, Royal OG, Sour Brulee, Sour Lifter, Sour Special Sauce, Sour Suver Haze, Super Sour Space Candy, White CBG

### `consignment_intakes`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| partner_id | INTEGER FK | References partners |
| date | TEXT | Date of intake |
| strain | TEXT | From strain dropdown |
| type | TEXT | "tops" or "smalls" |
| weight_lbs | REAL | Pounds received |
| price_per_lb | REAL | Agreed price to partner |
| notes | TEXT | Nullable |
| created_at | TEXT | ISO timestamp |

### `consignment_sales`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| partner_id | INTEGER FK | References partners |
| date | TEXT | Date of sale/count |
| strain | TEXT | From strain dropdown |
| type | TEXT | "tops" or "smalls" |
| weight_lbs | REAL | Pounds sold |
| sale_price_per_lb | REAL | What it sold for (your price, not partner's) |
| channel | TEXT | "retail" / "wholesale" / "other" |
| notes | TEXT | Nullable |
| created_at | TEXT | ISO timestamp |

### `consignment_payments`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| partner_id | INTEGER FK | References partners |
| date | TEXT | Date of payment |
| amount | REAL | Dollar amount paid |
| method | TEXT | "check" / "cash" / "transfer" |
| reference_number | TEXT | Check number, etc. Nullable |
| notes | TEXT | Nullable |
| created_at | TEXT | ISO timestamp |

## Key Calculations

**Balance owed to partner:**
```
Owed = Σ(sales.weight_lbs × intake.price_per_lb for matching partner+strain+type) − Σ(payments.amount)
```
Uses the partner's agreed intake price, not the sale price. Difference = Rogue Origin's margin.

**Inventory on hand (per partner, per strain, per type):**
```
On hand = Σ(intakes.weight_lbs) − Σ(sales.weight_lbs)
```

## UI Design

### Layout: 3 Zones

**Top: Partner Balance Cards**
- One card per active partner
- Shows: name, total owed ($), inventory on hand (lbs), last intake date, last payment date
- Color-coded: green (low/zero balance), gold (balance growing)
- Click card → expands to full partner history

**Middle: Quick Actions**
- 3 buttons: **New Intake** / **Record Sale** / **Record Payment**
- Each opens a modal

**Bottom: Activity Feed**
- Chronological list of all intakes, sales, payments
- Filterable by partner, date range, type

### Quick Action Modals

**New Intake Modal:**
- Partner: dropdown
- Strain: dropdown (searchable, from D1 strains table)
- Type: toggle switch (Tops ← → Smalls), defaults to Tops
- Weight: number input (lbs)
- Price per lb: number input, **auto-fills from last intake for same partner+strain+type combo**
- Notes: optional text
- Date: defaults to today, editable

**Record Sale Modal:**
- Partner: dropdown
- Strain: dropdown (filtered to strains this partner has in inventory)
- Type: toggle switch
- Weight: number input (lbs). Shows available inventory for reference.
- Sale price per lb: number input (your selling price)
- Channel: dropdown (Retail / Wholesale / Other)
- Notes: optional text
- Date: defaults to today, editable

**Record Payment Modal:**
- Partner: dropdown. Shows current balance owed for reference.
- Amount: number input ($)
- Method: dropdown (Check / Cash / Transfer)
- Reference #: optional text (check number, etc.)
- Notes: optional text
- Date: defaults to today, editable

### UX Requirements
- **Strain dropdown:** Searchable, alphabetically sorted, pulls from D1
- **Tops/Smalls toggle:** Large, thumb-friendly toggle switch. Defaults to Tops.
- **Price memory:** Auto-fills price_per_lb from most recent intake matching partner+strain+type. Always editable.
- **Dark/light theme:** Matches existing dashboard
- **Mobile responsive:** Works on phone for quick entries on the floor
- **Consistent styling:** Same fonts, colors, card styles, modals as existing rogue-origin-apps pages

## API Endpoints

All under existing Worker, routed via `action` parameter.

### Reads
- `getConsignmentPartners` — All partners with calculated balances + inventory
- `getConsignmentPartnerDetail&id=` — Single partner with full history (intakes, sales, payments)
- `getConsignmentInventory` — On-hand by partner × strain × type
- `getConsignmentStrains` — Strain list for dropdowns
- `getConsignmentActivity` — Recent activity feed, supports `partner_id`, `type`, `limit`, `offset` filters

### Writes
- `saveConsignmentPartner` — Add or edit partner (POST)
- `saveConsignmentIntake` — Log intake (POST)
- `saveConsignmentSale` — Log sale (POST)
- `saveConsignmentPayment` — Log payment (POST)
- `saveConsignmentStrain` — Add new strain (POST)

## What This Is NOT (v1)
- No partner-facing portal (Koa is the interface to partners)
- No Shopify integration (company preference)
- No automatic sale detection
- No lot-level traceability (tracked by partner+strain, not individual intakes)
- No consignment-specific reporting/charts (v2 candidate)

## Navigation
- New "Consignment" item in the sidebar, between existing pages
- Icon: matches existing Phosphor Icons style

## Future Candidates (not now)
- Partner portal with magic link access
- Shopify inventory sync for consignment-only strains
- Lot-level traceability
- Aging reports (product sitting too long)
- AI assistant integration ("what do we owe Farm X?")
