# Rogue Origin Operations Hub - Full Rewrite Design Document

**Date:** 2026-01-07
**Status:** Planning Complete
**Timeline:** 18-20 weeks

---

## Executive Summary

This document outlines the comprehensive plan to rewrite the Rogue Origin Hemp Processing Operations Hub from a vanilla JavaScript + Google Apps Script architecture to a modern, mobile-first PWA using SolidJS/React, TypeScript, and a proper backend infrastructure.

### Key Decisions
- **Frontend:** SolidJS (recommended) or React 19 with TypeScript
- **Build:** Vite + Tailwind CSS + Workbox PWA
- **Backend:** Hono on Cloudflare Workers with D1 (SQLite)
- **Auth:** Clerk (or Lucia Auth self-hosted)
- **Data Migration:** Dual-write period with Google Sheets sync maintained
- **Rollout:** Phased by risk level, starting with Scoreboard (lowest risk)

---

## Part 1: Current State Assessment

### Critical Issues Identified

| Category | Issues Found | Severity |
|----------|-------------|----------|
| **Security** | Password in URL, no server-side auth validation, XSS vulnerabilities | CRITICAL |
| **Architecture** | 3,319-line monolith (dashboard.js), 71 window.* exports, fake modularity | HIGH |
| **Performance** | 167+ DOM queries per render, 2.4s chart animations, no cleanup of intervals | HIGH |
| **Accessibility** | ZERO ARIA in scoreboard.html, missing lang attributes, 17x outline:none | CRITICAL |
| **Testing** | ~2% coverage, 0 unit tests, only 9 Puppeteer E2E tests | HIGH |
| **Error Handling** | 47+ crash scenarios, null pointer risks, memory leaks | HIGH |

### Files Requiring Major Refactoring

| File | Lines | Issues |
|------|-------|--------|
| `js/dashboard.js` | 3,319 | Monolithic, 75+ functions, 27+ globals |
| `apps-script/production-tracking/Code.gs` | 3,388 | No auth middleware, no validation |
| `apps-script/wholesale-orders/Code.gs` | ~800 | Password in URL, no RBAC |
| `scoreboard.html` | 600+ | Zero semantic structure, no ARIA |

---

## Part 2: Recommended Tech Stack

### Frontend Stack

```
SolidJS (1.8+)          → Fine-grained reactivity, 6KB runtime
  └─ solid-router       → File-based routing
  └─ @tanstack/solid-query → Server state management
  └─ solid-primitives   → Utility hooks
  └─ solid-dnd          → Drag-and-drop (replace Muuri)

TypeScript (5.3+)       → Type safety, better DX
Vite (5.0+)             → Fast HMR, optimized builds
Tailwind CSS (3.4+)     → Utility-first, design tokens
Chart.js (4.4+)         → Maintained charts (existing familiarity)

vite-plugin-pwa         → Service worker generation
Workbox (7.0+)          → Offline caching strategies
```

### Backend Stack

```
Hono (4.0+)             → Edge-first, tiny footprint
  └─ @hono/zod-validator → Request validation
  └─ hono-clerk         → Auth middleware

Cloudflare Workers      → Edge compute, global distribution
Cloudflare D1           → SQLite at the edge
Cloudflare R2           → Object storage (labels, exports)

Google Sheets API       → Maintained sync for reporting
Anthropic API           → AI chat (existing)
```

### Project Structure

```
rogue-origin-hub/
├── apps/
│   ├── web/                    # Main SPA
│   │   ├── src/
│   │   │   ├── routes/         # File-based routing
│   │   │   ├── components/     # Shared UI
│   │   │   ├── features/       # Domain modules
│   │   │   │   ├── dashboard/
│   │   │   │   ├── scoreboard/
│   │   │   │   ├── orders/
│   │   │   │   ├── kanban/
│   │   │   │   └── barcode/
│   │   │   ├── lib/            # Utilities
│   │   │   └── stores/         # Global state
│   │   └── public/
│   │
│   └── api/                    # Hono backend
│       ├── src/
│       │   ├── routes/
│       │   ├── middleware/
│       │   ├── services/
│       │   └── db/
│       └── wrangler.toml
│
├── packages/
│   ├── ui/                     # Shared component library
│   ├── types/                  # Shared TypeScript types
│   └── utils/                  # Shared utilities
│
├── docs/plans/                 # Design documents
└── tests/                      # E2E tests (Playwright)
```

---

## Part 3: Security Architecture

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────>│    Clerk    │────>│   Backend   │
│             │<────│   (Auth)    │<────│   (Hono)    │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │  JWT + Session     │   Validate JWT     │
      │  Cookie            │                    │
      └────────────────────┴────────────────────┘
```

### Role-Based Access Control

| Role | Dashboard | Scoreboard | Orders | Kanban | Barcode | Admin |
|------|-----------|------------|--------|--------|---------|-------|
| Admin | Full | Full | Full | Full | Full | Full |
| Manager | Full | Full | Full | Full | Full | - |
| Operator | View | Full | View | Create/Edit | Print | - |
| Viewer | View | View | View | View | - | - |
| Public | - | - | Track Own | - | - | - |

### Security Improvements Required

1. **Remove password from URL** - Use POST body with HTTPS
2. **Server-side session validation** - Every request validates JWT
3. **Rate limiting** - 5 attempts/min for auth, 60/min for reads
4. **Input validation** - Zod schemas on all endpoints
5. **XSS prevention** - CSP headers, proper escaping, no innerHTML
6. **MFA for high-value operations** - Orders > $10K, payments

---

## Part 4: Database Schema

### Core Tables

```sql
-- Customers
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Master Orders (wholesale commitments)
CREATE TABLE master_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  commitment_amount REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  terms TEXT,
  due_date TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Shipments (line items within orders)
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES master_orders(id),
  cultivar TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'lb',
  price_per_unit REAL NOT NULL,
  tracking_number TEXT,
  shipped_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Production Logs
CREATE TABLE production_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at INTEGER NOT NULL,
  trimmers INTEGER NOT NULL,
  lbs REAL NOT NULL,
  strain TEXT,
  time_slot TEXT,
  notes TEXT
);

-- Kanban Items
CREATE TABLE kanban_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT DEFAULT 'todo',
  image_url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
```

### Migration Strategy

1. **Phase 1:** Export all Google Sheets data to JSON backup
2. **Phase 2:** Transform and import to D1 with ID mapping
3. **Phase 3:** Dual-write period (write to both systems)
4. **Phase 4:** Verify data integrity (automated daily checks)
5. **Phase 5:** Sunset Google Sheets as primary (keep for reporting)

---

## Part 5: Performance Optimization

### Bundle Targets

| Route | Target (gzipped) | Current |
|-------|------------------|---------|
| Core Shell | 50KB | ~120KB |
| Dashboard | 80KB | Embedded |
| Charts | 120KB | ~200KB |
| Scoreboard | 60KB | ~468KB |

### Key Optimizations

1. **Code Splitting** - Lazy load routes and heavy components
2. **Virtual DOM** - SolidJS fine-grained reactivity (no diff)
3. **Memoization** - useMemo for expensive calculations
4. **Virtual Scrolling** - @tanstack/virtual for large lists
5. **Chart Optimization** - Disable animations on updates, decimation
6. **Visibility API** - Pause refreshes when tab hidden
7. **Request Deduplication** - TanStack Query handles automatically

### Cleanup Patterns

```typescript
// Safe interval hook with cleanup
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);  // CLEANUP
  }, [delay]);
}
```

---

## Part 6: Accessibility Remediation

### Critical Fixes (P0)

| Fix | Files | Effort |
|-----|-------|--------|
| Add `lang` attribute | scoreboard.html, kanban.html, barcode.html | Low |
| Add heading structure | scoreboard.html | Medium |
| Add aria-live to timer | scoreboard.html | Medium |
| Fix outline:none issues | All CSS files (17 instances) | Medium |
| Add skip links | All HTML files | Low |
| Add landmarks | scoreboard.html, kanban.html, barcode.html | Medium |

### WCAG 2.1 AA Compliance Targets

- **1.1.1 Non-text Content** - Charts need alt text/data tables
- **1.4.3 Contrast** - Fix gold text (#e4aa4f -> #d4940a)
- **2.1.1 Keyboard** - Full keyboard navigation
- **2.4.7 Focus Visible** - Replace outline:none with visible focus
- **3.1.1 Language** - Add lang attribute to all pages
- **4.1.2 Name, Role, Value** - ARIA for all interactive elements

---

## Part 7: Testing Strategy

### Coverage Targets

| Type | Phase 1 | Phase 2 | Long-term |
|------|---------|---------|-----------|
| Unit | 40% | 60% | 85% |
| Integration | 20% | 35% | 60% |
| E2E | 15 tests | 25 tests | 40 tests |

### Tools

- **Unit:** Vitest + Testing Library
- **E2E:** Playwright (replace Puppeteer)
- **Visual:** Playwright screenshots
- **Accessibility:** axe-core + pa11y-ci

### Critical Path Tests

1. **Financial Calculations** - 100% unit coverage
2. **Timer Logic** - 100% unit coverage
3. **Authentication** - 100% E2E coverage
4. **Data Persistence** - 100% integration coverage

---

## Part 8: Mobile & PWA Strategy

### PWA Configuration

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default {
  plugins: [
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Rogue Origin Operations Hub',
        short_name: 'RO Hub',
        theme_color: '#668971',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'portrait'
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-cache' }
          }
        ]
      }
    })
  ]
};
```

### Mobile-First Design Principles

1. **Touch Targets** - Minimum 44x44px
2. **Responsive** - Mobile-first breakpoints
3. **Gestures** - Swipe navigation, pull-to-refresh
4. **Offline** - Queue mutations, sync on reconnect
5. **Battery Aware** - Reduce refresh rate on low battery

---

## Part 9: Migration & Rollout Plan

### Phase Order (By Risk)

| Phase | App | Risk | Weeks |
|-------|-----|------|-------|
| 1 | Foundation | Low | 1-3 |
| 2 | Scoreboard | Lowest | 4-5 |
| 3 | Barcode | Low | 6-7 |
| 4 | SOP Manager | Medium-Low | 8-9 |
| 5 | Kanban | Medium | 10-11 |
| 6 | Dashboard | Medium | 12-14 |
| 7 | Orders | Highest | 15-18 |
| 8 | Stabilization | - | 19-20 |

### Rollback Triggers

| Trigger | Action |
|---------|--------|
| Error rate > 10% | Automatic rollback |
| P99 latency > 10s | Automatic rollback |
| Financial delta > $500 | Pause + alert |
| Boss requests rollback | Immediate rollback |

### Dual-Write Period

- **Scoreboard:** 1 week
- **Orders:** 4 weeks (highest risk)
- Daily reconciliation reports
- Automated discrepancy alerts

---

## Part 10: Success Criteria

### Technical Metrics

| Metric | Target |
|--------|--------|
| Page load (LCP) | < 2.5s |
| Time to Interactive | < 3s |
| Error rate | < 0.1% |
| Uptime | 99.9% |
| Unit test coverage | 85% |
| Lighthouse score | 95+ |

### User Adoption

| Week | DAU Target |
|------|------------|
| 1 | 50% |
| 4 | 75% |
| 8 | 90% |
| 12 | 95% |

### Zero Data Loss Requirement

- Record counts must match between systems
- Financial totals verified daily
- All historical data preserved with audit trail

---

## Appendix A: Implementation Checklist

### Foundation (Weeks 1-3)
- [ ] Set up monorepo with pnpm workspaces
- [ ] Configure Vite + SolidJS + TypeScript
- [ ] Set up Tailwind with design tokens
- [ ] Configure Clerk authentication
- [ ] Set up Hono backend on Cloudflare
- [ ] Create D1 database schema
- [ ] Set up CI/CD with GitHub Actions
- [ ] Configure Vitest + Playwright

### Per-App Migration
- [ ] Port HTML/CSS to SolidJS components
- [ ] Implement API endpoints with Zod validation
- [ ] Add ARIA and keyboard navigation
- [ ] Write unit tests (target 70%)
- [ ] Write E2E tests for critical paths
- [ ] Shadow mode testing
- [ ] Canary release (10%)
- [ ] Gradual rollout (25% -> 50% -> 100%)

---

## Appendix B: Team & Resources

### Estimated Effort
- **Development:** 1 senior developer, 18-20 weeks
- **Testing:** Integrated with development
- **Training:** 1-2 hours per user group

### External Dependencies
- Cloudflare Workers/D1 account
- Clerk authentication account
- Anthropic API (existing)
- TEC-IT barcode API (existing)

---

*Document generated from 9 parallel Opus planning agents analyzing the full codebase.*
