# Consignment App Implementation Plan

## Overview

Build a consignment tracking system for Rogue Origin with:
- **Internal Dashboard** — Partner balances, intake/sale/payment tracking, inventory view
- **Partner Portal** — Magic link access for partners to check their balances
- **Security** — Password-protected internal, token-based partner access

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `consignment.html` | Internal dashboard (new) |
| `partner-portal.html` | Partner-facing portal (new) |
| `css/consignment.css` | Styling (new) |
| `apps-script/consignment/Code.gs` | Backend API (new) |
| Google Sheets | New tabs: Partners, Intakes, Sales, Payments |

## Database Schema (Google Sheets)

**Partners:**
```
PartnerID | Name | Contact | Email | Phone | Address | Notes | MagicToken | CreatedDate
```

**Intakes:**
```
IntakeID | PartnerID | Date | Strain | GrossLbs | FinalLbs | PricePerLb | QCNotes | PhotoURLs
```

**Sales:**
```
SaleID | Date | Strain | Lbs | SalePrice | Channel
```

**Payments:**
```
PaymentID | PartnerID | Date | Amount | Method | CheckNumber | Notes
```

**Balance Calculation:**
```
Partner Balance = Σ(FinalLbs × PricePerLb for sold intakes) − Σ(Payments)
```

## Internal Dashboard (consignment.html)

**Widgets (Muuri grid):**
- Partner Balances — table with balance owed, last payment, last intake
- Inventory Summary — lbs on hand by strain
- Recent Activity — feed of intakes, sales, payments
- Financial Summary — total owed, monthly payments, trends
- Quick Actions — New Intake, Record Sale, Record Payment buttons

**Workflows:**
1. **New Intake:** Select partner → strain, gross lbs, final lbs, $/lb, QC notes, photos → Save
2. **Record Sale:** Select strain → lbs, sale price, channel → Save
3. **Record Payment:** Select partner → amount, method, check #, notes → Save

**Features:** Dark/light theme, EN/ES bilingual, mobile-responsive, 30s auto-refresh

## UI Consistency Requirements

Must match existing Rogue Origin apps styling:

**Typography (Google Fonts):**
- Display/Headings: DM Serif Display
- Data/Numbers: JetBrains Mono
- UI/Body: Outfit

**Colors (CSS Variables):**
- `--ro-green: #668971` (primary)
- `--ro-green-dark: #4a6b54`
- `--gold: #e4aa4f` (accent)
- `--danger: #c45c4a`
- Dark mode: `--bg-main: #1a1a1a`, `--bg-card: #2d2d2d`
- Light mode: `--bg-main: #faf8f5`, `--bg-card: #ffffff`

**Components:**
- Icons: Phosphor Icons (@phosphor-icons/web)
- Cards: Rounded corners, subtle borders, consistent shadows
- Modals: Same overlay style as orders.html
- Buttons: ro-green primary, gold accent actions
- Tables: Matching row hover, alternating backgrounds
- Forms: Consistent input styling, validation states

**Layout:**
- Muuri.js widget grid (same as ops hub)
- Mobile-first responsive breakpoints
- FAB buttons for settings/quick actions
- Toast notifications for feedback

**Reference:** Copy base styles from `css/dashboard.css`, adapt for consignment-specific needs

## Partner Portal (partner-portal.html)

**Access:** `partner-portal.html?token=<uuid>`

**Displays:**
- Current balance owed (large)
- Intake history (date, strain, lbs, $/lb, subtotal)
- Payment history (date, amount, method)
- Summary totals

**Security:**
- Read-only, token validated every request
- Can't see other partners, your sale prices, or internal notes
- Token regeneration from internal dashboard

## Backend API (apps-script/consignment/Code.gs)

**GET:**
- `validatePassword` — internal auth
- `validateToken&token=` — partner portal auth
- `getPartners` — list all
- `getPartner&id=` — single with balance
- `getIntakes`, `getSales`, `getPayments` — with filters
- `getDashboard` — aggregated data
- `getPortalData&token=` — partner's own data

**POST:**
- `savePartner`, `saveIntake`, `saveSale`, `savePayment`
- `regenerateToken&id=` — new magic link

**Patterns:**
- CORS-safe text/plain POST
- JSON responses: `{ success, data }`
- Server-side caching (5 min)
- Dual-mode detection (Apps Script + GitHub Pages)
- Password in Script Properties

## Implementation Phases

### Phase 1: Backend + Data Model
- [ ] Create Google Sheets with 4 tabs
- [ ] Build Code.gs with CRUD operations
- [ ] Balance calculation logic
- [ ] Authentication (password + tokens)
- [ ] Test endpoints

### Phase 2: Internal Dashboard
- [ ] consignment.html with Muuri grid
- [ ] Partner management modal
- [ ] Intake form with QC notes
- [ ] Sales recording modal
- [ ] Payment recording modal
- [ ] Dashboard widgets
- [ ] Dark/light theme

### Phase 3: Partner Portal
- [ ] partner-portal.html
- [ ] Token validation
- [ ] Balance + history display
- [ ] Token regeneration in internal dashboard
- [ ] Mobile optimization

### Phase 4: Polish
- [ ] Bilingual support (EN/ES)
- [ ] Add link to ops hub
- [ ] Update ROADMAP.md
- [ ] Testing

## Future Scope (not now)
- Shopify webhook integration for sales
- Lot-level traceability (link sales to specific intakes)
- AI agent tool: `get_consignment_balance(farm_name)`

## Reference Files (existing patterns)

| Pattern | Reference File |
|---------|----------------|
| Dashboard layout | `index.html`, `js/dashboard.js` |
| Customer portal | `order.html` |
| Backend API | `apps-script/production-tracking/Code.gs` |
| Auth flow | `apps-script/wholesale-orders/Code.gs` |
| Styling | `css/dashboard.css` |
| Caching | `js/api-cache.js` |
