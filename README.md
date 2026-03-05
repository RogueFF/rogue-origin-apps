# Rogue Origin Apps

Operations hub for [Rogue Origin](https://rogueorigin.com) — a seed-to-sale hemp flower business in Southern Oregon. Production tracking, inventory management, order fulfillment, and floor tools for a bilingual (EN/ES) workforce.

**Live:** [rogueff.github.io/rogue-origin-apps](https://rogueff.github.io/rogue-origin-apps)

---

## Architecture

```
GitHub Pages (Frontend)  ←→  Cloudflare Workers (API)  ←→  Cloudflare D1 (Database)
```

### Stack
- **Frontend:** Vanilla JS (ES6 modules), no framework — served via GitHub Pages
- **API:** Cloudflare Workers (`rogue-origin-api`)
- **Database:** Cloudflare D1 (SQLite at edge)
- **Production Data Entry:** Google Sheets (manual hourly workflow)

---

## Apps

| App | Path | Description |
|-----|------|-------------|
| **Ops Hub** | `index.html` | Dashboard with drag-drop widgets, AI chat, dual themes |
| **Floor Manager** | `hourly-entry.html` | Hourly crew + production entry (main floor tool) |
| **Scoreboard** | `scoreboard.html` | Real-time production display for floor TV |
| **Pool Inventory** | `pool-inventory.html` | Flower inventory by strain/grade |
| **Consignment** | `consignment.html` | Partner farm intake → inventory → payment |
| **Orders** | `orders.html` | Wholesale order tracking + shipments |
| **Customer Portal** | `order.html` | Customer-facing order view |
| **Barcode** | `barcode.html` | Label generation + scanning |
| **SOP Manager** | `sop-manager.html` | Standard operating procedures with versioning |
| **Kanban** | `kanban.html` | Visual task board |
| **Complaints** | `complaints.html` | Customer complaint tracking |
| **Scale Display** | `scale-display.html` | USB scale integration for weighing stations |

---

## API

**URL:** `rogue-origin-api.roguefamilyfarms.workers.dev`

| Endpoint | Purpose |
|----------|---------|
| `/api/production` | Hourly production tracking, scoreboard data, KPIs |
| `/api/pool` | Flower inventory management |
| `/api/consignment` | Partner farm consignment workflow |
| `/api/orders` | Wholesale order management |
| `/api/barcode` | Barcode/label generation |
| `/api/sop` | SOP versioning |
| `/api/kanban` | Task board |

---

## Development

```bash
# Frontend (local testing)
python -m http.server

# Workers (local dev)
cd workers && npx wrangler dev

# Deploy Workers
cd workers && npx wrangler deploy

# Frontend deploys automatically on push to master (GitHub Pages)
git push origin master
```

---

## Project Structure

```
rogue-origin-apps/
├── src/
│   ├── pages/              # HTML applications
│   ├── js/                 # JavaScript modules
│   │   ├── modules/        # Ops Hub ES6 modules
│   │   ├── scoreboard/     # Scoreboard modules
│   │   └── shared/         # Shared utilities (auto-update, etc.)
│   ├── css/                # Per-page stylesheets
│   │   └── shared-base.css # Master CSS variables
│   └── assets/             # Icons, images
├── workers/                # Cloudflare Workers API
│   ├── src/handlers/       # Domain handlers
│   ├── src/lib/            # Shared utilities
│   └── schema.sql          # D1 database schema
├── scale-reader/           # USB scale hardware integration
├── docs/                   # Documentation
└── tests/                  # Playwright test suite
```

---

## Key Details

- **Bilingual:** All UI text has EN + ES translations
- **Mobile-first:** Floor manager uses phone — 44px touch targets, responsive layouts
- **Dual themes:** Light (cream) and Dark (organic industrial)
- **No build system:** Pure HTML/CSS/JS, no bundler
- **Auto-update:** Floor devices auto-refresh when new code is deployed

---

*Built for Rogue Origin by Koa.*
