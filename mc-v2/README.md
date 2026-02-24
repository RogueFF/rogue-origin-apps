# Mission Control v2

Atlas Mission Control — the operational command center for Rogue Origin.

## Stack
- React 19 + TypeScript
- Vite 7
- Tailwind CSS 4
- Zustand (state)
- TanStack Query (data)
- React Router (views)

## Themes
Two switchable themes via `data-theme` attribute:
- **Relay** (default) — Holographic void aesthetic with particle field, chromatic aberration, breathing cards
- **Solaris** — Warm Japanese-inspired with grain texture, rounded forms, serif typography

## Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build  # outputs to dist/
```

## Phase 1 (Current)
- Layout shell (left sidebar, main content, right sidebar, bottom bar, header)
- Dashboard with KPI strip, agent fleet cards, sparkline chart, recent activity
- Agent fleet status in sidebar with live status dots
- Activity feed with filterable notification cards
- Dual theme system with instant switching
- All data is hardcoded — API integration is Phase 2

## Phase 2 (Planned)
- Gateway WebSocket client
- Live data from D1/API
- Full views (Production, Trading, Tasks, Monitor, System)
- Command palette (⌘K)
