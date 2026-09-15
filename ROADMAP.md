# Rogue Origin Development Roadmap

> Timeline assumes ~10-15 hours/week development time
> Phases can overlap if resources allow

## Vision

Transform Rogue Origin's operations into a data-driven, AI-assisted system that:
1. Provides instant answers to business questions across all data sources
2. Gives customers visibility into their orders
3. Enables continuous improvement through LEAN/Kaizen methodology
4. Becomes a productizable platform for other businesses

---

## Code Quality Overhaul (January 2026)

**Objective**: Modernize codebase architecture, fix technical debt, improve reliability and maintainability.

### Completed Phases

| Phase | Description | Status | Completed |
|-------|-------------|--------|-----------|
| 2.1-2.2 | Architecture Cleanup - ES6 Modules | ✅ Done | Jan 2026 |
| 1.1 | Memory Leak Fixes | ✅ Done | Jan 2026 |
| 1.2 | Security Hardening | ✅ Done | Jan 2026 |
| **3.1** | **Error Handling & Loading States** | ✅ Done | **Jan 13, 2026** |
| **4.1** | **Scoreboard Declutter & No-Scroll** | ✅ Done | **Feb 4, 2026** |

**Phase 3.1 Deliverables**:
- ✅ Connection status bar with 3 states (connecting, connected, error)
- ✅ Auto-retry logic (single retry after 5 seconds)
- ✅ Manual retry button
- ✅ Connection state tracking (lastSuccessfulFetch, retryCount)
- ✅ Muuri grid fallback with flexbox layout
- ✅ Widget layout fixes (no stacking)
- ✅ Status module (`status.js`) with state management
- ✅ Live deployment and testing

**Documentation**:
- `docs/sessions/2026-01-13-error-handling-implementation.md`
- `docs/plans/2026-01-13-error-handling-design.md`

**Phase 4.1 Deliverables**:
- ✅ FAB menu system (8 buttons → 1 floating action button)
- ✅ Responsive breakpoints (TV/Desktop/Mobile)
- ✅ Vertical space optimization (1,250px → 700px)
- ✅ OLED-optimized TV mode
- ✅ Keyboard navigation and accessibility
- ✅ Chart/Order Queue hidden by default
- ✅ Compact header (strain + time merged)

**Documentation**:
- `docs/plans/2026-02-04-scoreboard-declutter-design.md`
- `docs/plans/2026-02-04-scoreboard-declutter-implementation.md`
- `docs/sessions/2026-02-04-scoreboard-declutter-testing.md`

### Remaining Phases

| Phase | Description | Priority |
|-------|-------------|----------|
| 5.1 | Accessibility fixes (WCAG AA) | High |
| 6.3 | CSS consolidation execution | Medium |
| 4.2-4.3 | Lazy loading optimizations | Medium |

**Next Up**: Phase 5.1 (Accessibility) or Phase 6.3 (CSS consolidation)

---

## Scale Reader / Live Weight System

**Objective**: Real-time scale weight display on production floor with cloud sync via D1 for instant visibility into bag filling progress.

### Components Built

| Component | Status | Notes |
|-----------|--------|-------|
| Node.js serial reader | ✅ Done | OHAUS Defender 5000, RS-232 via FTDI USB-serial adapter |
| Express local web display | ✅ Done | Live weight view at `http://localhost:3000` |
| D1 cloud API endpoints | ✅ Done | `get/set` scale weight with stale detection |
| Mock mode for testing | ✅ Done | Simulates scale without hardware |
| Deployment package | ✅ Done | Setup docs in `scale-reader/SETUP-INSTRUCTIONS.md` |

**Files**:
- `scale-reader/index.js` - Serial reader + Express server
- `scale-reader/mock-server.py` - Python mock scale
- `workers/src/handlers/production-d1.js` - D1 API endpoints (`/scale/get`, `/scale/set`)

### Remaining Work

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Scale readings table in D1 | 📋 Pending | Schema deployment to production |
| Scoreboard integration | 📋 Pending | Show live weight on floor TV |
| Bag completion auto-detection | 📋 Pending | Weight threshold triggers bag timer |
| Multi-station support | 📋 Pending | Line1/Line2 separate scales |

**Success Criteria**:
- Floor TV displays real-time scale weight
- Bag completion auto-detects when weight crosses threshold
- System handles network interruptions gracefully
- Support multiple scales for different production lines

---

## Phase 1: AI Agent Foundation — ~70% Complete

**Objective**: Create an AI assistant that can answer the boss's top 5 questions.

### 1.1 Data Layer Standardization

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Unified API for production data | ✅ Done | getScoreboardData(), getBagTimerData() |
| Unified API for consignment data | 📋 Pending | Phase 3 |
| Unified API for order data | 📋 Pending | Phase 2 |
| Document API response formats | ✅ Done | APP_CATALOG.md |
| Error handling and validation | ✅ Done | Try/catch throughout |

### 1.2 AI Agent Core

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Web interface with chat input | ✅ Done | ops-hub.html floating widget |
| Voice input (Web Speech API) | 📋 Pending | Planned for Phase 4 |
| Voice output (Speech Synthesis) | 📋 Pending | Planned for Phase 4 |
| Claude API integration | ✅ Done | claude-sonnet-4-20250514 |
| Mobile-responsive design | ✅ Done | Full-screen chat on mobile |

### 1.3 Initial AI Tools

| Tool | Status | Function | Returns |
|------|--------|----------|---------|
| `get_production_today` | ✅ Done | getScoreboardData() | Lbs, crew, rate, % target |
| `get_production_rate` | ✅ Done | getScoreboardData() | Lbs/trimmer/hour |
| `get_consignment_balance` | 📋 Phase 3 | (TBD) | Total owed by farm |
| `get_crew_count` | ✅ Done | getScoreboardData() | Current trimmers/buckers |
| `get_order_progress` | 📋 Phase 2 | (TBD) | % complete, ETA |

### 1.4 Integration with Ops Dashboard

| Deliverable | Status | Notes |
|-------------|--------|-------|
| AI chat component added | ✅ Done | Floating 🌿 button |
| Mobile-friendly design | ✅ Done | Full-screen mode |
| Quick action buttons | ✅ Done | Status, Bags, Rate, Crew |
| Feedback system | ✅ Done | 👍/👎 buttons |
| Correction learning | ✅ Done | "Actually..." detection |

**Success Criteria**:
- ✅ Boss can ask "How are we doing today?" → Accurate answer
- 📋 Boss can ask "How much do we owe Mountain Farm?" → Needs Phase 3
- 📋 Boss can ask "When will Hamburg order be done?" → Needs Phase 2
- 📋 Works on mobile via voice → Needs voice implementation

---

## Phase 2: Customer Order Dashboard — ~80% Complete

**Objective**: Give wholesale customers visibility into their orders with a professional, branded experience.

### 2.1 Order Data Restructure

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Create clean Orders schema | ✅ Done | In orders.html |
| Migrate Hamburg order data | ✅ Done | Demo data included |
| Connect to production for progress | 📋 Pending | Need backend API |

**Orders Schema**:
```javascript
{
  id: 'ORD-001',
  customer: 'Hamburg GmbH',
  totalKg: 1400,
  completedKg: 580,
  status: 'pending|processing|ready|shipped|completed',
  createdDate: '2025-12-15',
  dueDate: '2026-02-01',
  notes: 'Order notes...',
  pallets: [
    { id: 'P001', cultivars: 'Sour Lifter, Lifter', weightKg: 300, status: 'completed' }
  ]
}
```

### 2.2 Customer Portal

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Private link access (no login) | ✅ Done | Base64-encoded order ID |
| Order overview page | ✅ Done | Progress %, kg remaining |
| Pallet breakdown view | ✅ Done | Status per pallet |
| Current pallet detail | ✅ Done | Cultivars, weight, status |
| TIVE tracking embed/link | 📋 Deferred | Add later |
| RO branding | ✅ Done | Professional green/gold theme |

**Customer Portal URL**: `https://rogueff.github.io/rogue-origin-apps/order.html?id={base64EncodedOrderId}`

### 2.3 Internal Order Management

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Order entry form | ✅ Done | orders.html modal |
| Pallet configuration | ✅ Done | Add/remove pallets with cultivars |
| Status updates | ✅ Done | Dropdown per order/pallet |
| Commercial invoice generation | 📋 Pending | Future enhancement |
| COA attachment workflow | 📋 Pending | Future enhancement |

**AI Integration** (Pending):
- Add `get_order_progress(order_id)` tool
- Enable: "When will the Hamburg order be done?"

---

## Phase 3: Consignment System Rebuild

**Objective**: Replace manual spreadsheets with a proper consignment tracking system.

### 3.1 Data Model

| Entity | Fields | Notes |
|--------|--------|-------|
| Partners | ID, Name, Contact, PaymentTerms | Farm/partner info |
| Intakes | ID, PartnerID, Date, Strain, GrossWeight, QCWeight, QCNotes | Received material |
| Sales | ID, IntakeID, Date, Quantity, Price, Channel | Link to sold product |
| Payments | ID, PartnerID, Date, Amount, CheckNumber, Notes | Money paid out |

**Balance Calculation**: `Balance Owed = (Sum of Sales × Partner Share) - (Sum of Payments)`

### 3.2 Internal Interface

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Partner dashboard | 📋 Planned | Balances, inventory, history |
| Intake entry form | 📋 Planned | Log received material |
| Payment entry form | 📋 Planned | Record payments |
| Inventory reconciliation | 📋 Planned | What's still in house |
| Margin analysis | 📋 Planned | Sell price vs cost |

### 3.3 Partner Portal (Future)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Private link per partner | 💭 Future | Like order portal |
| Their inventory levels | 💭 Future | What we have of theirs |
| Sales history | 💭 Future | When/where sold |
| Payment history | 💭 Future | What we've paid |

**AI Integration**:
- Add `get_consignment_balance(farm_name)` tool
- Enable: "How much do we owe Mountain Farm?"

**Success Criteria**:
- Can answer "How much do we owe X farm?" instantly
- No more manual spreadsheet reconciliation
- Zero over/under payment disputes

---

## Phase 4: Processing Floor Enhancement

**Objective**: Make the hour-by-hour system easier for floor workers to use.

### 4.1 Shop Floor Display

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Large-format TV view | ⚠️ Partial | scoreboard.html exists |
| Current hour progress | ⚠️ Partial | Needs visual enhancement |
| Target vs actual (color-coded) | ✅ Done | Green/red indicators |
| Daily totals and trends | ✅ Done | Chart included |
| Auto-refresh | ✅ Done | 30-second interval |

### 4.2 Mobile Input App

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Simple hourly data entry | 📋 Planned | New streamlined UI |
| Big buttons, minimal text | 📋 Planned | Touch-optimized |
| Bilingual (ES/EN) | ⚠️ Partial | Labels exist, needs UI work |
| Crew count adjustment | ✅ Done | CrewChangeSidebar |
| Break/lunch handling | ✅ Done | Timer pause/resume |

### 4.3 AI Voice Assistant

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Voice input (Web Speech API) | 📋 Planned | Browser native |
| Voice output (Speech Synthesis) | 📋 Planned | Browser native |
| Spanish language support | 📋 Planned | "¿Cuántas libras hoy?" |

**Success Criteria**:
- Floor supervisor can update hourly data in <30 seconds
- Team can see progress at a glance on TV display
- Voice queries work in Spanish

---

## Phase 5: Value Stream Mapping

**Objective**: Create framework for capturing upstream (growing) data in preparation for next season.

### 5.1 Activity Tracking System

| Deliverable | Status | Notes |
|-------------|--------|-------|
| QR code generation | 📋 Planned | Per activity type |
| Mobile scan-to-start/stop | 📋 Planned | Simple time tracking |
| Activity types | 📋 Planned | Irrigation, Pest, Harvest, etc. |
| Location tracking | 📋 Planned | Which block/field |
| Duration calculation | 📋 Planned | Automatic from scans |

**Activity Types**: Irrigation, Pest Management, Fertilization, Pruning/Training, Harvest, Drying Management, Equipment Maintenance

### 5.2 Weather Integration

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Automated weather capture | 📋 Planned | Free API (OpenWeather) |
| Historical data storage | 📋 Planned | Daily high/low/precip |
| Correlation analysis | 📋 Planned | Weather vs outcomes |

### 5.3 Value Stream Map

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Visual process flow | 📋 Planned | From seed to sale |
| Cycle time definitions | 📋 Planned | Per stage |
| Data collection points | 📋 Planned | Where to measure |
| Baseline establishment | 📋 Planned | Current state metrics |

**Success Criteria**:
- Know labor hours for irrigation vs pest vs harvest
- Can correlate weather with outcomes
- 80%+ of field labor hours categorized

---

## Phase 6: Product Packaging (Future)

**Objective**: Generalize Rogue Origin tools for sale to other businesses.

| Deliverable | Status |
|-------------|--------|
| Customizable branding | 💭 Future |
| Configurable data fields | 💭 Future |
| Multi-tenant architecture | 💭 Future |
| Subscription management | 💭 Future |
| User/setup guides | 💭 Future |
| Case study & ROI docs | 💭 Future |

---

## Technical Dependencies

| Phase | Dependency | Status |
|-------|------------|--------|
| 1 | Claude API key | ✅ Have it |
| 1 | Apps Script deployment | ✅ Done |
| 2 | GitHub Pages hosting | ✅ Done |
| 2 | TIVE API access | ❓ TBD |
| 3 | Shopify API | ⏳ Available |
| 3 | PDF generation (jsPDF) | ⏳ Available |
| 4 | TV display hardware | ✅ Have it |
| 5 | QR code printing | ✅ Barcode printer |
| 5 | Weather API | ⏳ OpenWeather free |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Team resistance to new tools | Start simple, get wins, build trust |
| Data quality issues | Validate on input, clean incrementally |
| Scope creep | Stick to phase boundaries |
| Boss too busy to test | Schedule dedicated 15-min feedback sessions |
| Staff turnover | Good documentation, simple interfaces |
