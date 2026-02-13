# Atlas Squad System — Master Plan

_Created: 2026-02-12 | Status: DRAFT | Author: Atlas + Koa_

---

## The Vision

Koa has one life. He works too much. He loves his job but it eats his bandwidth for everything else — trading, travel, Nicole, health, building wealth outside of RO.

**The Atlas Squad is a team of AI agents that compresses Koa's work, grows his wealth, and creates space for the life he wants.** Not a fancy to-do list. Not a chatbot collection. A coordinated intelligence network that thinks, acts, and delivers — across every domain of his life.

**The end state:** Koa wakes up, checks Mission Control on his wide Envy screen with coffee. He sees:
- Pre-market brief with today's plays and market conditions
- RO production status and anything that needs his attention
- Travel deals Nicole would love
- Side hustle opportunities worth exploring
- His portfolio performance and open positions
- Agent activity feed showing what got done overnight

He makes decisions. The agents execute. He goes to work with clarity, not chaos. After work, he and Nicole review trading ideas together, plan their next trip, and build toward freedom.

**North Star Metrics:**
- Hours saved per week at RO (target: 10+)
- Trading portfolio growth (starting $3K)
- Days traveled per year (current: ? → target: set with Koa)
- Side income streams launched

---

## The Three Domains

### 1. WORK — Rogue Origin Optimization

**Goal:** Compress Koa's RO workload. Better data, less manual tracking, smarter delegation.

**Current pain points:**
- Production tracking is manual/whiteboard-heavy
- Agronomy (plant health, water, soil, pests) is mostly gut feel
- War room tasks are verbal, not tracked
- Consignment intake/payouts require Koa's direct involvement
- Web apps are constantly changing and breaking

**Agents:**

#### Friday — Dev Agent
- Owns rogue-origin-apps codebase
- Gets assigned implementation tasks, writes code, runs tests, pushes commits
- Uses Claude Code CLI + Agent Teams
- Available 24/7 for bug fixes and feature work
- **Frees Koa from:** spending half his day coding/debugging the apps

#### Radar — Operations Analyst
- Monitors production data in real-time during shifts
- Tracks hour-by-hour output, cycle times, pace vs. target
- Flags anomalies before they become problems
- Compiles daily/weekly production reports automatically
- Learns seasonal patterns over time
- **Frees Koa from:** manually pulling and analyzing production numbers

#### Dispatch — Task & Project Manager
- Owns Mission Control task board
- Digitizes war room output — tasks assigned in meeting get tracked
- Sends reminders, flags overdue items
- Tracks who's doing what across the 20-person crew
- **Frees Koa from:** keeping task status in his head

#### Grower — Agronomy Agent (seasonal, grow season)
- Tracks planting schedules, seed/cultivar decisions, acre allocations
- Monitors weather data for the fields
- Logs plant health observations (pest, nutrient, water notes)
- Builds historical data so good seasons can be replicated
- Compares current conditions to past seasons
- Eventually: integrates soil sensors, drone imagery, satellite data
- **Frees Koa from:** being the only person who knows the grow history

### 2. TRADING — Financial Intelligence

**Goal:** Build a research and intelligence operation around Koa's $3K starting bankroll. Surface opportunities, track performance, learn together.

**Koa's profile:**
- Trading since 2018, experienced with options, momentum, long-term plays
- Loves risk, loves rumors, loves learning
- Robinhood for stocks/options, Aster for crypto leverage
- NOT building an auto-trader — building a research desk that makes him faster and smarter
- Nicole wants to learn — this needs to be accessible to a beginner too

**Agents:**

#### Viper — Market Intelligence
- Scans Reddit daily (r/wallstreetbets, r/options, r/daytrading, r/stocks, r/cryptocurrency) using free .json endpoints
- Filters signal from noise — sentiment spikes, unusual DD, momentum plays
- Tracks unusual options activity via free data sources
- Scores opportunities by risk level (conservative → degen)
- Morning pre-market summary delivered to Mission Control + Atlas Survey
- **What Koa gets:** "Here's what Reddit is buzzing about, here's what's actually worth looking at, here's what's garbage"

#### Wire — News & Catalyst Tracker
- Monitors earnings calendars, FDA decisions, FOMC dates, SEC filings, crypto regulatory news
- Catches breaking news that moves tickers
- Connects dots across sectors ("Company X got a contract, their supplier Y hasn't moved")
- During market hours: real-time alerts to Atlas Survey app for breaking catalysts
- **What Koa gets:** "NVDA earnings after close today, implied move is 8%, here's the options play if you want exposure"

#### Regime — Market Health Monitor
- Tracks overall market conditions daily
- Distribution day counts, breadth indicators, VIX levels, sector rotation
- Clear signal: "conditions favor buying" vs. "sit in cash" vs. "high risk, small positions only"
- Updated pre-market and mid-day
- **What Koa gets:** A traffic light for the market. Green/yellow/red. No guessing.

#### Ledger — Portfolio & Performance Tracker
- Tracks all positions (stocks, options, crypto)
- Logs entry thesis, exit thesis, outcome
- Calculates win rate, average gain/loss, best setups
- Weekly performance review
- Tracks what the agents recommended vs. what actually happened (agent accuracy scoring)
- **What Koa gets:** "You're up 12% this month. Your best plays were momentum breakouts. Your worst were earnings gambles. Here's what that means."

#### Nicole's View
- Not a separate agent — a filtered view of the trading domain
- Simplified explanations of what the agents found
- "Learn with me" mode: each alert includes a 2-sentence explainer of WHY this matters
- Gradually increases complexity as she learns
- **What Nicole gets:** A way into this world that doesn't feel overwhelming

### 3. LIFE — Personal Freedom

**Goal:** Create space for travel, health, side income, and the things that matter outside of work.

**Agents:**

#### Scout — Opportunity Finder
- Scans for side hustle opportunities matching Koa + Nicole's profile
- Looks at: online businesses, micro-SaaS, dropshipping, content, consulting, local opportunities
- Factors in: can be done remotely, scales without time, leverages existing skills (data, agriculture, tech)
- Delivers brief + pros/cons + startup cost + estimated time investment
- Not a firehose — 1-2 vetted opportunities per week max
- **What Koa gets:** "Found a niche opportunity in [X]. Here's the thesis. Here's what it would take."

#### Guide — Travel & Life Planner
- Tracks flight deals from Medford/Portland to destinations Koa + Nicole want
- Plans trips around RO's seasonal calendar (slower periods = travel windows)
- Handles logistics research — hotels, activities, budgets
- **What Koa gets:** "There's a $280 RT to Hawaii from Portland in March. RO is between seasons. Window is open."

#### Sensei — Goals & Accountability
- Tracks personal goals Koa sets (fitness, financial milestones, learning targets)
- Weekly check-ins, not daily nagging
- Connects goals to actions: "To hit your travel goal, your trading account needs to reach $X by Y date"
- **What Koa gets:** The big picture view of whether he's moving toward freedom or just staying busy

---

## Mission Control — The Dashboard

**Two experiences, one brain:**
1. **Atlas OS** — desktop OS-style interface for the wide Envy screen at work. Feels like a custom operating system. Draggable windows, taskbar, app icons, the works.
2. **Mission Control Web** — clean responsive website version accessible from iPhone, Legion, or anywhere with a browser.

Both pull from the same backend. Same data, same agents, different UX.

### Atlas OS (Desktop — Wide Screen)

Inspired by Muddy OS. A full desktop environment in the browser:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ☰ Atlas OS                                        🔔 3  ⚡ 11 agents  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────┐  ┌──────────────────────────────────────┐    │
│   │ 📊 Trading Brief    │  │ 🏭 Production                       │    │
│   │                     │  │                                      │    │
│   │ Market: 🟢 GREEN    │  │  Today: 142.3 lbs | 0.87 rate       │    │
│   │ SPY +0.8% pre-mkt   │  │  Target: 165 lbs | 86% pace        │    │
│   │                     │  │  ██████████░░░░ 86%                 │    │
│   │ Top Plays:          │  │                                      │    │
│   │ • $NVDA earnings    │  │  [Hour-by-Hour] [Cycle Times]       │    │
│   │ • $AMD momentum     │  │                                      │    │
│   │ • $COIN crypto run  │  └──────────────────────────────────────┘    │
│   │                     │                                               │
│   │ Reddit Buzz: 🔥     │  ┌──────────────────────────────────────┐    │
│   │ WSB hot on $GME     │  │ 📋 Inbox (3 items)                  │    │
│   └─────────────────────┘  │                                      │    │
│                             │ ⚡ Viper: $COIN unusual call vol    │    │
│   ┌─────────────────────┐  │   [View] [Approve] [Dismiss]        │    │
│   │ 💬 Agent Standup    │  │                                      │    │
│   │                     │  │ 🏭 Dispatch: 2 war room tasks       │    │
│   │ Morning standup     │  │   overdue                            │    │
│   │ complete. 4 action  │  │   [View] [Reassign] [Snooze]        │    │
│   │ items generated.    │  │                                      │    │
│   │                     │  │ 🌱 Scout: Side hustle brief ready   │    │
│   │ 🔊 Listen (2:34)   │  │   [Read] [Save] [Dismiss]           │    │
│   │ 📝 Read Transcript  │  │                                      │    │
│   └─────────────────────┘  └──────────────────────────────────────┘    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ 📊Trade │ 🏭Work │ 🌍Life │ 💬Chat │ 📈Portfolio │ 📋Tasks │ ⚙️Config │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Draggable/resizable windows** — arrange however you want on the wide screen
- **Taskbar** with app icons — each domain is an "app" you can open
- **System tray** — notification count, active agent count, cost tracker
- **Desktop icons** for quick access — Standup, Portfolio, Production, Chat with Atlas
- **Window snapping** for the wide screen — tile two or three windows side by side
- **Dark theme** — easy on the eyes, premium feel

### Mission Control Web (Mobile / Anywhere)

Clean, card-based responsive layout for iPhone:

- **Dashboard cards** — swipeable domain summaries
- **Inbox feed** — tap to expand, swipe to approve/dismiss
- **Quick actions** — "Start standup", "Check portfolio", "Ask Atlas"
- **Agent status** — simple online/offline indicators
- **Push notifications** via PWA (works like a native app on iPhone)

### Shared Features (Both Versions)
- **Agent activity feed** — real-time log of everything happening
- **Inbox** — items needing Koa's decision, sorted by priority
- **Standup viewer** — transcript + audio playback + action items
- **Nicole mode** — simplified view with trading explainers
- **Portfolio view** — positions, P&L, win rate
- **Deliverables library** — every doc/report/spec agents have produced
- **Goal tracker** — high-level objectives with progress bars

### Agent Standups (New Feature)

Inspired by Clear Mud. Agents hold autonomous discussions:

- **Morning Trading Standup (7:00 AM):** Regime, Viper, and Wire discuss market conditions. Produce a brief + action items. Atlas synthesizes into morning brief.
- **RO Daily Standup (8:30 AM):** Radar and Dispatch review production status, pending tasks, any flags. Produce action items for the day.
- **Weekly Strategy Standup:** All agents contribute to a weekly review — what worked, what didn't, what to focus on next week.

**Flow:**
1. Agents discuss autonomously (using shared context)
2. Transcript saved to Mission Control
3. Action items extracted automatically
4. Audio summary generated via open-source TTS (Microsoft model, free)
5. Koa gets a Telegram ping: "Morning standup complete. 🔊 Listen (2:34) or 📝 Read"
6. Koa reviews, approves/modifies action items
7. Agents execute approved items

### Audio Briefings

- Open-source TTS (Microsoft SpeechT5 or similar) — zero cost
- Morning trading brief as audio: listen while driving to work
- Standup summaries as audio: absorb info without reading
- Stored in Mission Control for replay

### Tech Stack
- Frontend: HTML/CSS/JS (vanilla for speed, no framework bloat)
- Backend: Cloudflare Worker API
- Data: D1 database + JSON files for agent state
- Hosting: Cloudflare Pages (free tier)
- Real-time: polling every 30s (WebSocket later if needed)
- TTS: open-source model running on Zephyrus
- PWA: for iPhone "app-like" experience

---

## Agent Architecture

### Identity System
Each agent lives in `tools/agents/<name>/`:
```
tools/agents/
├── friday/
│   ├── AGENT.md        # Role, personality, rules, capabilities
│   ├── memory.md       # Persistent memory between invocations
│   └── current-task.md # What it's working on right now
├── radar/
├── viper/
├── wire/
├── regime/
├── ledger/
├── scout/
├── guide/
├── sensei/
├── dispatch/
└── grower/
```

### Communication Flow
```
Koa ←→ Atlas (Telegram / Mission Control)
            ↓
        Atlas delegates to agents
            ↓
    ┌───────┼───────┐
    ↓       ↓       ↓
  Friday  Viper   Radar  ... (specialist agents)
    ↓       ↓       ↓
  Results flow back to Atlas
            ↓
        Atlas synthesizes + delivers to Koa
            ↓
    Mission Control updated in real-time
```

### How Agents Run
- **Atlas** = always-on orchestrator (OpenClaw main session, Opus)
- **Specialist agents** = spawned on demand via `sessions_spawn` or Claude Code CLI
- **Scheduled work** = cron jobs trigger Atlas, Atlas delegates to the right agent
- **Persistent memory** = each agent reads/writes its own memory file between invocations
- **Shared state** = Mission Control database is the single source of truth

### Agent Tiers (cost optimization)
- **Opus** — Atlas only (orchestration, synthesis, complex reasoning)
- **Sonnet** — Friday, Radar, Regime, Ledger (coding, analysis, moderate complexity)
- **Haiku** — Viper, Wire, Scout, Guide, Dispatch (scanning, filtering, simple tasks)
- **Local Ollama** — heartbeat checks, simple parsing, state management (free)

---

## Trading Desk — Detailed Design

### Data Sources (Free / Low Cost)
| Source | What | Cost |
|--------|------|------|
| Reddit .json endpoints | Sentiment, DD, unusual buzz | Free |
| Yahoo Finance | Price data, fundamentals, earnings calendars | Free |
| Finviz | Screener data, heatmaps | Free |
| TradingView (scraping) | Technical levels, popular setups | Free |
| Tiingo | Real-time + historical price data | $10/mo (starter) |
| Unusual Whales / Quiver Quant | Options flow, political trades | Free tier |
| CoinGecko | Crypto data | Free |
| SEC EDGAR | Filings, insider transactions | Free |

### Daily Rhythm
```
6:00 AM   Wire scans overnight news + pre-market movers
6:30 AM   Regime assesses market conditions (green/yellow/red)
7:00 AM   Viper scans Reddit for overnight sentiment
7:30 AM   Morning Brief compiled → Mission Control + Atlas Survey
          "Market: GREEN. 3 setups worth watching. Reddit buzz on $TICKER."

9:30 AM   Market opens
9:30-4PM  Wire monitors for breaking catalysts (alerts to Atlas Survey)
          Viper scans Reddit every hour for momentum shifts

4:00 PM   Market closes
4:30 PM   Ledger updates positions, calculates daily P&L
5:00 PM   Evening review compiled → Mission Control
          "Today: +$X. Regime still green. Tomorrow's catalysts: [list]"

Weekend   Weekly performance review
          Agent accuracy scoring
          Regime weekly outlook
```

### Position Sizing Rules (built into Ledger)
- Starting bankroll: $3,000
- Max single position: 20% ($600)
- Max total exposure: 80% ($2,400)
- Always keep 20% cash
- Options: max 10% per play ($300) until account grows
- Crypto leverage: max 5% per play ($150)
- Stop loss on every position — no exceptions
- Rules adjust automatically as account grows

### Learning Mode (for Nicole)
Every alert from Viper/Wire includes:
- **The Play:** What the opportunity is
- **The Why:** 2-3 sentence explanation a beginner can understand
- **The Risk:** What could go wrong
- **The Learn:** One concept this trade teaches (Greeks, IV crush, support/resistance, etc.)

---

## RO Compression — Detailed Design

### War Room Digitization
- After each Gemba walk, Koa (or anyone) speaks or types tasks into Mission Control
- Dispatch assigns them, sets deadlines, tracks completion
- War room gets a tablet or screen showing the task board
- No more "did that get done?" — it's tracked

### Agronomy Data Platform
- Grower agent maintains a structured log:
  - Daily observations (weather, plant condition, water levels)
  - Pest/disease incidents with photos
  - Soil test results
  - Seed/cultivar performance by field and year
  - Harvest yields per acre per strain
- Over time, this becomes RO's institutional knowledge
- "What did we do differently in 2024 when Lifter yielded 20% more?"

### Production Auto-Reporting
- Radar already has API access to production data
- Automated daily report to Jacob + Koa: output, pace, anomalies
- Hour-by-hour charts generated and pushed to Mission Control
- No one has to ask "how are we doing?" — it's always visible

### Consignment Automation
- Already partially built (intake handler)
- Extend: auto-inventory tracking, auto-payout calculation, vendor payment history
- Vendor dashboard in Mission Control showing balances

---

## Side Hustle Framework

### What Scout Looks For
- **Remote-friendly** — can be done from anywhere
- **Scalable** — doesn't trade more time for more money
- **Leverages existing skills** — Koa's data/tech/agriculture/operations background
- **Low startup cost** — under $1K to test
- **AI-advantaged** — something where having Atlas + agents creates an unfair advantage

### Categories to Explore
1. **Micro-SaaS** — small software tool solving a niche problem (Koa can build, Atlas can help)
2. **Content/Education** — hemp industry knowledge, farming tech, AI operations (YouTube, courses)
3. **Consulting** — help other hemp/cannabis operations with data/process optimization
4. **E-commerce** — dropshipping or niche product (Nicole could co-run)
5. **Trading as income** — once the system is proven, it becomes a side income stream itself
6. **AI agent services** — literally sell what we're building to other businesses

Scout delivers 1-2 opportunities per week. Koa and Nicole review together. If something clicks, we build a plan and execute.

---

## Budget

### Current Spend
| Item | Cost/mo |
|------|---------|
| Anthropic (Claude Max) | $200 |
| ChatGPT | $20 |
| **Total** | **$220/mo** |

### Proposed Additions
| Item | Cost/mo | What it enables |
|------|---------|----------------|
| Tiingo market data API | $10 | Real-time stock data for trading agents |
| Domain for Mission Control | $1 | missioncontrol.yourdomain.com or similar |
| Cloudflare Pro (if needed) | $0 | Free tier should handle everything |
| **Total additions** | **~$11/mo** | |

### Hardware Wishlist (One-Time)
| Item | Est. Cost | Why |
|------|-----------|-----|
| Cheap tablet for war room | $100-150 | Display task board during Gemba/meetings |
| Soil moisture sensors (basic kit) | $50-100 | Feed real data to Grower agent during grow season |
| Weather station (personal) | $100-200 | Hyperlocal field data vs. generic forecasts |
| USB temperature/humidity logger | $30 | Drying room monitoring for quality control |

### What's Already Covered (Free)
- Cloudflare Pages/Workers/D1 — free tier handles our scale
- Reddit data — free .json endpoints
- Yahoo Finance, Finviz, SEC EDGAR — free
- The Zephyrus (my machine) — already running 24/7
- OpenClaw — already set up and running

---

## Build Order

### Phase 1: Foundation (This Week)
1. **Agent identity system** — persistent agent files with memory
2. **Mission Control v0.1** — basic web dashboard with activity feed + agent cards
3. **Viper agent** — Reddit scanner for trading intelligence (prove the concept fast)

### Phase 2: Trading Desk (Week 2)
4. **Wire agent** — news/catalyst monitoring
5. **Regime agent** — market health assessment
6. **Ledger agent** — portfolio tracking
7. **Morning brief automation** — daily pre-market summary
8. **Mission Control v0.2** — trading domain panel

### Phase 3: RO Compression (Week 3)
9. **Dispatch agent** — task tracking from war room
10. **Radar upgrades** — hour-by-hour charts, automated reports
11. **Mission Control v0.3** — work domain panel

### Phase 4: Life Domain (Week 4)
12. **Scout agent** — opportunity scanning
13. **Guide agent** — travel deal monitoring
14. **Sensei agent** — goal tracking
15. **Nicole's learning mode** in trading
16. **Mission Control v1.0** — all three domains live

### Phase 5: Grow Season Prep (When Relevant)
17. **Grower agent** — agronomy tracking platform
18. **Field data integrations** — weather station, sensors
19. **Historical comparison engine** — this year vs. past years

### Phase 6: Evolution (Ongoing)
- Agent accuracy scoring and improvement
- Side hustle execution support
- New agents as needs emerge
- Self-evolution — agents that get better at their jobs over time

---

## Principles

1. **Research tool, not auto-anything.** Koa makes the calls. Agents surface information and execute tasks. No agent spends money or makes trades without explicit approval.
2. **Nicole is a first-class user.** Everything we build should be accessible to her, not just Koa.
3. **Data compounds.** Every observation logged, every trade tracked, every season recorded. The system gets smarter over time because the data gets richer.
4. **Start cheap, prove value, then invest.** The first version costs $11/mo extra. We earn the right to spend more by delivering results.
5. **Freedom is the metric.** If something doesn't move toward more time, more money, or more options — it doesn't get built.

---

## Open Questions
- What destinations are on Koa + Nicole's travel wishlist?
- Does RO have existing soil/weather data from past seasons?
- What crypto projects/tokens is Koa currently interested in?
- What time does Koa typically check his phone first thing in the morning? (for brief timing)
- Does Nicole have her own phone/device she'd use for Mission Control?

---

_This document is alive. It evolves as we build, learn, and adapt. The plan is the starting point, not the ceiling._
