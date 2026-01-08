# Implementation Roadmap
## Rogue Origin Operations Hub - Full Rewrite

---

## Timeline Overview

```
Week:  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20
       ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤
Found. [████████]
Score        [████]
Barcode         [████]
SOP                 [████]
Kanban                   [████]
Dash                         [████████]
Orders                                 [████████████]
Stabil.                                              [████]
```

---

## Phase 1: Foundation (Weeks 1-3)

### Week 1: Project Setup

**Day 1-2: Monorepo & Tooling**
- [ ] Initialize pnpm workspace with Turborepo
- [ ] Create `apps/web` with Vite + SolidJS
- [ ] Create `apps/api` with Hono
- [ ] Create `packages/ui`, `packages/types`, `packages/utils`
- [ ] Configure TypeScript paths and references

**Day 3-4: Styling & Design System**
- [ ] Set up Tailwind CSS with custom config
- [ ] Port CSS variables from current `dashboard.css`
- [ ] Create base component primitives (Button, Input, Card)
- [ ] Set up dark/light theme system

**Day 5: CI/CD**
- [ ] GitHub Actions for build, test, lint
- [ ] Cloudflare Pages deployment for web
- [ ] Cloudflare Workers deployment for API

### Week 2: Authentication & Backend

**Day 1-2: Clerk Integration**
- [ ] Set up Clerk account and project
- [ ] Install `@clerk/clerk-react` in web app
- [ ] Create auth middleware for Hono
- [ ] Implement login/logout flow

**Day 3-4: Database Setup**
- [ ] Create D1 database on Cloudflare
- [ ] Write migration scripts for schema
- [ ] Set up Drizzle ORM
- [ ] Create seed data for development

**Day 5: API Foundation**
- [ ] Health check endpoints
- [ ] Error handling middleware
- [ ] Request validation with Zod
- [ ] Rate limiting implementation

### Week 3: Integration & Testing

**Day 1-2: Google Sheets Bridge**
- [ ] Create Sheets API adapter
- [ ] Implement read/write functions
- [ ] Set up dual-write infrastructure
- [ ] Create ID mapping table

**Day 3-4: Testing Infrastructure**
- [ ] Configure Vitest for unit tests
- [ ] Configure Playwright for E2E
- [ ] Write test utilities and fixtures
- [ ] Set up MSW for API mocking

**Day 5: PWA Setup**
- [ ] Configure vite-plugin-pwa
- [ ] Create manifest.json
- [ ] Implement service worker
- [ ] Test offline capabilities

---

## Phase 2: Scoreboard (Weeks 4-5) - LOWEST RISK

### Week 4: Development

**Day 1-2: UI Components**
- [ ] Port timer ring component
- [ ] Port KPI cards (Last Hour, Current Hour)
- [ ] Port daily progress bar
- [ ] Port comparison pills (vs Yesterday, vs 7-Day)

**Day 3-4: Real-time Data**
- [ ] Create scoreboard API endpoint
- [ ] Implement 30-second auto-refresh
- [ ] Add visibility API (pause when hidden)
- [ ] Implement stale-while-revalidate

**Day 5: Accessibility**
- [ ] Add semantic headings
- [ ] Add ARIA live regions for timer
- [ ] Add keyboard navigation
- [ ] Add Spanish translations

### Week 5: Rollout

**Day 1-2: Testing**
- [ ] Unit tests for timer calculations
- [ ] E2E tests for display updates
- [ ] Manual QA on mobile devices
- [ ] Accessibility audit (axe-core)

**Day 3-4: Shadow & Canary**
- [ ] Deploy to staging environment
- [ ] Run shadow mode (compare with old)
- [ ] Canary release (10% traffic)
- [ ] Monitor error rates

**Day 5: Full Rollout**
- [ ] Gradual rollout (25% -> 50% -> 100%)
- [ ] Document any issues
- [ ] Update user guide

---

## Phase 3: Barcode (Weeks 6-7) - LOW RISK

### Week 6: Development

**Day 1-2: SKU Management**
- [ ] Port cultivar dropdown
- [ ] Port product grid display
- [ ] Implement search/filter
- [ ] Create API endpoints for products

**Day 3-4: Label Printing**
- [ ] Integrate TEC-IT barcode API
- [ ] Port print preview modal
- [ ] Implement batch printing
- [ ] Add print confirmation

**Day 5: Mobile Optimization**
- [ ] Optimize for handheld scanners
- [ ] Large touch targets
- [ ] Quick-action buttons

### Week 7: Rollout

- [ ] Testing (unit, E2E, manual)
- [ ] Shadow mode
- [ ] Canary release
- [ ] Full rollout

---

## Phase 4: SOP Manager (Weeks 8-9) - MEDIUM-LOW RISK

### Week 8: Development

**Day 1-3: CRUD Operations**
- [ ] SOP list view with categories
- [ ] Create/Edit SOP modal
- [ ] Step management (add, reorder, delete)
- [ ] Image attachment support

**Day 4-5: AI Integration**
- [ ] Connect to Anthropic API
- [ ] Implement AI SOP generation
- [ ] Add feedback mechanism
- [ ] Store corrections for training

### Week 9: Rollout

- [ ] Testing
- [ ] PDF export functionality
- [ ] Shadow mode & canary
- [ ] Full rollout

---

## Phase 5: Kanban (Weeks 10-11) - MEDIUM RISK

### Week 10: Development

**Day 1-2: Card Management**
- [ ] Port card grid/list views
- [ ] Implement drag-and-drop (solid-dnd)
- [ ] Create/Edit card modal
- [ ] Image upload with R2 storage

**Day 3-4: Filtering & Search**
- [ ] Category filters
- [ ] Text search
- [ ] Sort options
- [ ] Print selection modal

**Day 5: Data Sync**
- [ ] API endpoints for cards
- [ ] Optimistic updates
- [ ] Offline queue

### Week 11: Rollout

- [ ] Testing
- [ ] Accessibility (drag alternatives)
- [ ] Shadow mode & canary
- [ ] Full rollout

---

## Phase 6: Dashboard (Weeks 12-14) - MEDIUM RISK

### Week 12: Core Layout

**Day 1-2: Navigation & Shell**
- [ ] Sidebar with app links
- [ ] Theme toggle (dark/light)
- [ ] Settings panel
- [ ] Quick stats header

**Day 3-4: Widget System**
- [ ] Widget grid with solid-dnd
- [ ] Widget size controls (S/M/L)
- [ ] Collapse/expand widgets
- [ ] Layout persistence

**Day 5: KPI Cards**
- [ ] Port all KPI card types
- [ ] Real-time data updates
- [ ] Comparison indicators

### Week 13: Charts & AI

**Day 1-3: Chart Components**
- [ ] Hourly production chart
- [ ] Daily trends chart
- [ ] Rate comparison chart
- [ ] Chart.js lazy loading

**Day 4-5: AI Chat**
- [ ] Chat panel UI
- [ ] Message history
- [ ] Anthropic API integration
- [ ] Feedback buttons

### Week 14: Rollout

- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] Shadow mode & canary
- [ ] Gradual rollout
- [ ] Old dashboard sunset

---

## Phase 7: Orders (Weeks 15-18) - HIGHEST RISK

### Week 15: Data Migration

**Day 1-2: Export & Transform**
- [ ] Export all Sheets data to JSON
- [ ] Create ID mapping table
- [ ] Transform to new schema
- [ ] Validate with Zod

**Day 3-4: Import & Verify**
- [ ] Import to D1 database
- [ ] Verify record counts
- [ ] Verify financial totals
- [ ] Create audit trail

**Day 5: Dual-Write Setup**
- [ ] Configure dual-write middleware
- [ ] Set up sync job (every 5 min)
- [ ] Create discrepancy alerts

### Week 16: Core UI

**Day 1-2: Customer Management**
- [ ] Customer list view
- [ ] Create/Edit customer modal
- [ ] Search and filter

**Day 3-4: Order Management**
- [ ] Master orders list
- [ ] Create order wizard
- [ ] Order detail view
- [ ] Status management

**Day 5: Shipments**
- [ ] Shipment list within order
- [ ] Line item management
- [ ] Tracking number entry

### Week 17: Financial & Portal

**Day 1-2: Payment Recording**
- [ ] Payment entry modal
- [ ] Payment history
- [ ] Balance calculations
- [ ] MFA for high-value

**Day 3-4: Customer Portal**
- [ ] Public order tracking page
- [ ] Secure token-based access
- [ ] Shipment status display
- [ ] Payment summary

**Day 5: Reporting**
- [ ] Financial dashboard
- [ ] Outstanding balances
- [ ] Export to CSV

### Week 18: Orders Rollout

**Day 1-2: Testing**
- [ ] 100% unit coverage on financials
- [ ] E2E for critical flows
- [ ] Security audit
- [ ] Performance testing

**Day 3-4: Dual-Write Monitoring**
- [ ] Start dual-write period
- [ ] Daily reconciliation checks
- [ ] Fix any discrepancies

**Day 5: Gradual Rollout**
- [ ] Power user testing
- [ ] 10% canary
- [ ] 25% -> 50% -> 100%

---

## Phase 8: Stabilization (Weeks 19-20)

### Week 19: Polish

- [ ] Address remaining bugs
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Documentation updates
- [ ] User training completion

### Week 20: Handoff

- [ ] Final QA pass
- [ ] Update CLAUDE.md
- [ ] Create maintenance guide
- [ ] Knowledge transfer
- [ ] Celebrate!

---

## Risk Mitigation

### Rollback Procedure (< 5 min)

1. Toggle feature flag to disable new system
2. Traffic automatically routes to old system
3. Notify users via in-app banner
4. Begin incident review

### Data Integrity Checks

Run daily during dual-write period:
```
✓ Customer count matches
✓ Order count matches
✓ Shipment count matches
✓ Payment totals match (within $0.01)
✓ No orphaned records
```

### Emergency Contacts

- **Production Issues:** [On-call rotation]
- **Data Discrepancies:** Immediate escalation
- **Rollback Decision:** Boss or lead developer

---

## Success Metrics

| Milestone | Metric | Target |
|-----------|--------|--------|
| Phase 2 Complete | Scoreboard live | Week 5 |
| Phase 4 Complete | 4 apps migrated | Week 9 |
| Phase 6 Complete | Dashboard live | Week 14 |
| Phase 7 Complete | Orders live | Week 18 |
| Final | All apps stable | Week 20 |

---

*Roadmap generated from comprehensive planning analysis.*
