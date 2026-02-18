# Rogue Origin Apps

Operations hub for [Rogue Origin](https://rogueorigin.com) — a seed-to-sale hemp flower business in Southern Oregon. Production tracking, order management, AI-powered mission control, and an autonomous trading desk.

**Live:** [rogueff.github.io/rogue-origin-apps](https://rogueff.github.io/rogue-origin-apps)

---

## Architecture

```
GitHub Pages (Frontend)  ←→  Cloudflare Workers (API)  ←→  Cloudflare D1 (Database)
       ↑                              ↑
  atlas-os.js                   Two workers:
  (Mission Control)             • rogue-origin-api (operations)
                                • mission-control-api (Atlas OS)
```

### Stack
- **Frontend:** Vanilla JS, no framework — served via GitHub Pages
- **API:** Cloudflare Workers (two separate workers)
- **Database:** Cloudflare D1 (SQLite at edge)
- **AI Agents:** Node.js scripts orchestrated by Atlas (OpenClaw) via cron
- **CI:** GitHub Actions — tests run on every push

---

## Apps & Pages

| App | Path | Description |
|-----|------|-------------|
| **Mission Control** | `src/pages/mission-control/` | Atlas OS — agent fleet, trading desk, task board, production, activity feed |
| **Scoreboard** | `src/pages/scoreboard.html` | Real-time production scoreboard (lbs/hr, crew, targets) |
| **Pool Inventory** | `src/pages/pool-inventory.html` | Flower inventory by strain, grade, location |
| **Consignment** | `src/pages/consignment.html` | Partner farm intake → inventory → payment workflow |
| **Order Management** | `src/pages/orders.html` | Wholesale order tracking, shipments |
| **Barcode System** | `src/pages/barcode.html` | Label generation + scanning for bags/boxes |
| **SOP Manager** | `src/pages/sop-manager.html` | Standard operating procedures with versioning |
| **Kanban** | `src/pages/kanban.html` | Visual task board |
| **Complaints** | `src/pages/complaints.html` | Customer complaint tracking |
| **Scale Reader** | `scale-reader/` | USB scale integration for weighing stations |

---

## Workers (API)

### `rogue-origin-api`
**Path:** `workers/`
**URL:** `rogue-origin-api.roguefamilyfarms.workers.dev`

Core operations API:
- `/api/production` — real-time production tracking (scoreboard, dashboard, KPIs)
- `/api/pool` — flower inventory management
- `/api/consignment` — partner farm consignment workflow
- `/api/orders` — wholesale order management
- `/api/barcode` — barcode/label generation
- `/api/sop` — SOP versioning
- `/api/kanban` — task board
- `/api/prices` — live stock price proxy (Yahoo Finance)

### `mission-control-api`
**Path:** `workers/mission-control/`
**URL:** `mission-control-api.roguefamilyfarms.workers.dev`

Atlas OS backend:
- `/api/agents` — agent fleet status (register, update, query)
- `/api/activity` — activity feed (all agent actions logged here)
- `/api/tasks` — task management (neural task board)
- `/api/inbox` — Koa's decision inbox
- `/api/regime` — market regime signal (RED/YELLOW/GREEN)
- `/api/plays` — trading desk plays (Strategist recommendations)
- `/api/positions` — portfolio positions (open/closed)
- `/api/widgets` — dashboard widget config
- `/api/github` — GitHub proxy (commits, CI, issues, PRs)

---

## Atlas OS (Mission Control)

The command center. A single-page app with draggable, resizable windows:

- **Activity Feed** — real-time log of all agent actions
- **Agent Fleet** — status of every agent (active/idle/error)
- **Trading Desk** — regime signal, portfolio, positions, plays, trade history, sectors, calendar
- **Neural Tasks** — interactive task graph with domain clustering
- **Inbox** — items requiring Koa's decision
- **Production** — live scoreboard with auto-refresh (60s on shift, 5m off)
- **Atlas Chat** — direct AI chat interface
- **GitHub** — commits, CI status, issues, PRs, branch activity

---

## Agent Squad

Autonomous agents running on cron, orchestrated by Atlas:

### Trading Desk Agents

| Agent | Glyph | Schedule | Role |
|-------|-------|----------|------|
| **Regime** | 🛡️ | 6:30 AM daily | Market regime classification (RED/YELLOW/GREEN) — SPY, VIX, moving averages |
| **Wire** | 🔗 | 6:30 AM daily | Market scanning, news, watchlist generation |
| **Viper** | ⚡ | 6:30 AM daily | Options signals, earnings plays, unusual activity |
| **Strategist** | ♟️ | Every 30m, 7AM-1PM | Structures plays from Wire+Viper+Regime intelligence |
| **Analyst** | 💎 | 7:30 AM daily | Validates Strategist plays against regime (scoring, risk flags) |
| **Dealer** | 🎰 | Every 30m, 7AM-1PM | Position management — entries, exits, stop losses |
| **Ledger** | 📊 | 1:30 PM daily | Portfolio snapshot, daily P&L, trade journal |
| **Razor** | 🪒 | 2 PM daily + Fri weekly | Performance auditor — win/loss analysis, strategy drift, evolution proposals |

### System Agents

| Agent | Glyph | Schedule | Role |
|-------|-------|----------|------|
| **Friday** | 🔧 | On-demand | Coding agent (Claude Code CLI + Agent Teams) |
| **Darwin** | 🧬 | 11 PM nightly | System evolution — audits agents, proposes improvements |
| **Scout** | 🔭 | On-demand | Opportunity scanner (Reddit, deals, events) |

### Agent Data Flow

```
Wire + Viper → Strategist → Analyst (validates) → Dealer (executes)
                                                       ↓
Razor (audits) ← Ledger (snapshots) ← Positions API ←─┘
      ↓
Darwin (evolves configs based on Razor findings)
```

---

## Database Schema

### Operations DB (`rogue-origin-api`)
- `production_sessions` / `production_entries` — shift tracking, hourly logs
- `pool_inventory` — flower inventory by strain/grade/location
- `consignment_*` — partner intakes, inventory, payments
- `orders` / `shipments` — wholesale order lifecycle
- `barcodes` — label tracking
- `sops` — standard operating procedures

### Mission Control DB (`mission-control-api`)
- `agents` — fleet registry (name, domain, status, color)
- `activity` — full activity feed (every agent action)
- `tasks` — task board with status/priority/domain
- `inbox` — decision items for Koa
- `regime` — market regime history
- `trade_plays` — Strategist recommendations (with dismiss/fill status)
- `positions` — portfolio positions (open/closed, P&L tracking)
- `agent_files` — agent deliverables and config storage

---

## Development

### Prerequisites
- Node.js 22+
- Cloudflare account with Wrangler CLI authenticated
- GitHub CLI (`gh`) authenticated

### Local Development
```bash
# Install dependencies
npm install

# Run operations worker locally
cd workers && npx wrangler dev

# Run mission control worker locally
cd workers/mission-control && npx wrangler dev

# Run tests
npm test
```

### Deployment
```bash
# Operations API
npx wrangler deploy --config workers/wrangler.toml

# Mission Control API
npx wrangler deploy --config workers/mission-control/wrangler.toml

# Frontend (GitHub Pages)
git push origin master  # Auto-deploys via GitHub Pages
```

### Testing
```bash
npm test                    # Run all tests (node:test)
npx playwright test         # E2E tests
```

---

## Project Structure

```
rogue-origin-apps/
├── src/pages/                  # Frontend apps (HTML + JS)
│   ├── mission-control/        # Atlas OS (atlas-os.js + atlas-os.css)
│   ├── scoreboard.html         # Production scoreboard
│   ├── consignment.html        # Consignment workflow
│   ├── pool-inventory.html     # Flower inventory
│   └── ...                     # Other operational apps
├── workers/                    # Cloudflare Workers
│   ├── src/                    # Operations API
│   │   ├── index.js            # Router + handlers
│   │   └── handlers/           # Domain handlers (production, orders, etc.)
│   ├── mission-control/        # Mission Control API
│   │   ├── src/index.js        # Router + all handlers
│   │   └── schema.sql          # D1 schema
│   └── migrations/             # D1 migrations
├── tools/agents/               # Atlas agent squad (see Agent Squad above)
├── tests/                      # Test suite
├── scale-reader/               # USB scale integration
├── docs/                       # Design docs, plans, technical docs
└── scripts/                    # Utility scripts
```

---

## Philosophy

- **LEAN / Kaizen** — continuous improvement is the operating system, not a buzzword
- **No framework loyalty** — use whatever's best for the job
- **Ship production-grade** — no "good enough for now"
- **Agents do the work** — Atlas orchestrates, subagents execute
- **Every trade teaches** — Razor audits, Darwin evolves, the desk gets sharper

---

*Built and maintained by Atlas + Koa at Rogue Origin.*
