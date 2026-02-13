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

**What's already built (and must keep evolving):**
- **RO Operations Hub** (https://rogueff.github.io/rogue-origin-apps/) — Dashboard, Floor Manager, Scoreboard
- These track **Processing** (the floor production work) — Koa's first apps, living products that should always be improving
- Consignment intake handler (via Atlas/Telegram)
- Pool command handler (inventory updates via Telegram)
- **These are NOT done.** Friday continuously improves UX, adds features, fixes bugs, and refines the experience. The apps evolve as the operation evolves.

**What's NOT tracked yet (the gaps):**
- **Germination/Planting** — seed selection, germination rates, planting schedules, acre allocation
- **Grow Season** — plant health, water/soil, pest monitoring, nutrient tracking, field conditions
- **Harvest** — harvest planning, daily harvest output, field-by-field progress, crew allocation
- War room tasks are verbal, not tracked digitally
- Agronomy decisions are mostly gut feel — no historical data to replicate good seasons

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
- Calculates win rate, average gain/loss, best setups **BY STRATEGY TYPE**
- Weekly performance review
- Tracks what the agents recommended vs. what actually happened (agent accuracy scoring)
- **What Koa gets:** "You're up 12% this month. Your best plays were momentum breakouts. Your worst were earnings gambles. Here's what that means."

#### Strategist — Trade Setup Builder (NEW)
Builds concrete, actionable trade setups across ALL strategy types. Every setup includes two examples sized for the current bankroll.

**Strategy Types Covered:**
| Strategy | Timeframe | Example |
|----------|-----------|---------|
| Long-term holds | Weeks to months | "Buy 10 shares $NVDA at $890, target $1050, stop $830" |
| Swing trades | 2-10 days | "Buy $AMD $165 calls exp 3/14, entry on pullback to $158 support" |
| Momentum trades | Intraday to days | "Breakout above $42.50 on volume, ride to $45 resistance" |
| News/catalyst trades | Event-driven | "FOMC tomorrow — buy SPY straddle, sell before announcement" |
| 0DTE options | Same day | "SPY 0DTE $505 calls at $0.45, target $1.00, stop $0.20" |
| Credit spreads | 30-45 DTE | "Sell $AAPL $170/$165 put spread for $1.20 credit, 75% PoP" |
| Crypto leverage | Variable | "$BTC long 3x at $95K, target $100K, stop $92K on Aster" |

**Every setup includes:**
- **Two concrete examples** with exact tickers, strikes, expirations, entries, exits
- **Position size** calculated for current bankroll (respects sizing rules)
- **Probability of profit** — calculated from historical data when available
- **Risk/reward ratio** — max gain vs. max loss
- **Backtested data** — "This pattern has occurred 47 times in the last 2 years. Win rate: 68%. Avg gain: 12%. Avg loss: -6%."
- **Greeks breakdown** (for options) — Delta, Theta, Vega, IV rank
- **Plain English explanation** — what could go right, what could go wrong, and why this setup exists

#### Analyst — Strategy Evolution Agent (NEW)
The agent that makes the whole system smarter over time.

- **Post-trade review:** Every closed position gets analyzed. What was the thesis? What actually happened? What was missed? What would we do differently?
- **Lesson extraction:** Failed trades become documented lessons in `trading/lessons.md`. Patterns emerge: "We lose money on earnings plays when IV is above 80th percentile" → system learns to flag this.
- **Strategy scoring:** Which strategy types are working best for Koa? Which ones are bleeding? Adjust recommendations accordingly.
- **Internet scouring:** Scans trading subreddits, YouTube transcripts, blog posts, and forums for new strategies, tools, and approaches. Not to copy blindly — to evaluate and adapt.
- **Backtesting engine:** When a new strategy idea surfaces, Analyst runs historical backtests against available data. "This pattern works 72% of the time in bull markets but only 41% in choppy conditions."
- **Monthly evolution report:** "This month we tried X. Here's what worked. Here's what we should stop doing. Here's a new approach worth testing."
- **What Koa gets:** A system that gets smarter with every trade. Losses aren't just losses — they're tuition.

#### Nicole's View
- Not a separate agent — a filtered view of the trading domain
- Simplified explanations of what the agents found
- "Learn with me" mode: each alert includes a 2-sentence explainer of WHY this matters
- Gradually increases complexity as she learns
- Strategy explainers: "What is a credit spread? Why would you sell one instead of buying calls?"
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

**Three form factors:**
- **HP Envy wide screen** (work desk) — Atlas OS, full immersive desktop experience
- **Legion 7i** (home/on-the-go) — Atlas OS adapts, slightly condensed but same soul
- **iPhone** (floor/mobile) — Mission Control Web, card-based, fast, one-thumb usable

### Design Philosophy

**This should look like nothing else that exists.** Not a Notion clone. Not a Linear knockoff. Not "dark mode bootstrap with cards." Something that feels like it was built in 2030 by someone who thinks dashboards are an art form.

Design pillars:
- **Original, not derivative.** The aesthetic emerges from the design process — we don't lock it in upfront. Could be cinematic, could be organic, could be something that doesn't have a name yet. The only rule: it shouldn't remind you of anything else.
- **Motion with purpose.** Subtle animations that convey state — agents pulse when active, data flows like a living system, transitions feel physical. Not decoration, communication.
- **Typographic hierarchy.** Big bold numbers for the things that matter. Whisper-quiet labels. You should be able to read the room from 6 feet away on the Envy.
- **Color as language.** Not just "green good red bad." A full palette that encodes domains, urgency, agent identity, confidence levels. Each agent gets a signature color/glyph.
- **Spatial, not flat.** Depth, layers, glass effects, light bleed. Panels feel like they're floating in space. Not skeuomorphic — futuristic.
- **Sound design.** Optional subtle audio cues — a tone when a high-priority alert lands, a soft chime when a standup completes. The OS feels alive.
- **Easter eggs.** Little delights for Koa and Nicole. Personality baked in, not bolted on.

**Anti-patterns (what we will NOT do):**
- Generic card grids with rounded corners and shadow-sm
- "Clean and minimal" that actually means "boring and empty"
- Stock dashboard templates reskinned with dark mode
- Anything that looks like it was generated by AI without a human creative director

When it's time to build the UI, we load the frontend-design skill and bring the same fire we bring to every RO app. Multiple creative passes. Screenshot and review between each one. Fresh agent, fresh ideas every pass.

### Atlas OS (Desktop — Wide Screen)

A full desktop environment in the browser. Not "inspired by" Muddy OS — our own thing entirely:

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

- **Morning Trading Standup (7:00 AM):** Final planning session before market open. Trading desk has been active since 4:30 AM — this standup is where they lock in the day's plan, review any changes since the 5:30 AM brief, and finalize the Degen Plays. Produce action items + audio summary.
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

### Identity System — Deep Dive

Each agent is a fully defined "person" with context, memory, tools, and rules. Everything an agent needs to operate lives in its directory.

**Directory structure per agent:**
```
tools/agents/<name>/
├── AGENT.md            # Identity: role, personality, voice, rules, boundaries
├── SOUL.md             # Core character — what makes this agent think differently
├── MEMORY.md           # Long-term memory — curated, persistent across all invocations
├── memory/             # Session logs — raw daily logs (like Atlas's memory/ dir)
│   └── YYYY-MM-DD.md
├── SKILLS.md           # What tools/APIs/skills this agent has access to
├── CONTEXT.md          # Domain knowledge — the stuff this agent needs to know
│                       #   (e.g., Viper gets Reddit sub descriptions, trading terminology;
│                       #    Grower gets field maps, cultivar data, soil profiles)
├── current-task.md     # What it's actively working on (or null)
├── deliverables/       # Output folder — reports, briefs, specs this agent has produced
└── inbox/              # Tasks assigned to this agent, pending execution
```

**What each file does:**

#### AGENT.md — The Job Description
- Role definition: what this agent does and doesn't do
- Personality/voice: how it communicates (Viper is sharp and fast, Grower is methodical and patient)
- Rules: what it's allowed to do autonomously vs. what needs approval
- Boundaries: what it should NEVER do (e.g., Strategist never places trades, only recommends)
- Relationships: which agents it collaborates with, which it reports to
- Model assignment: which LLM runs this agent and why

#### SOUL.md — The Character
- Not just "you are a trading agent." WHO is this agent?
- Thinking style: analytical? creative? cautious? aggressive?
- Inspired by (optional): like Marcelo's Elon/Gary/Warren approach — not cosplay, but borrowed traits
- How it handles uncertainty, disagreement, failure
- What it cares about — every agent should have a "north star" beyond just its task
- This is what makes agent output feel different from generic LLM output

#### MEMORY.md — What It Remembers
- Curated long-term context (like Atlas's MEMORY.md)
- Key decisions made, lessons learned, patterns observed
- Updated by the agent itself after significant work
- Atlas reviews agent memories periodically for quality

#### memory/YYYY-MM-DD.md — Daily Logs
- Raw session logs — what happened, what was produced, what failed
- Feeds into MEMORY.md curation over time
- Darwin uses these for performance reviews

#### SKILLS.md — The Toolbox
Each agent gets a scoped set of capabilities. Not everyone gets everything.

| Agent | Skills/Tools |
|-------|-------------|
| Friday | Claude Code CLI, git, GitHub, Cloudflare wrangler, npm, test runners |
| Radar | RO Production API, D1 queries, chart generation |
| Viper | Reddit .json scraping, sentiment analysis, options flow APIs |
| Wire | News APIs (Finnhub), SEC EDGAR, earnings calendars, crypto feeds |
| Regime | Market data APIs, technical indicators, historical data |
| Strategist | Options chain APIs, Greeks calculators, backtesting scripts |
| Analyst | Access to ALL trading agent outputs, backtesting, internet research |
| Ledger | Portfolio state files, P&L calculators, Robinhood/Aster data |
| Dispatch | Mission Control API, task database, notification system |
| Scout | Web scraping, market research, business analysis |
| Guide | Flight/travel APIs, weather, calendar integration |
| Sensei | Goal tracking database, all domain summaries |
| Grower | Weather APIs, field data, soil sensors, agronomy databases |
| Darwin | ALL agent files (read access), system metrics, internet research |

Skills can be added/removed as agents evolve. Darwin tracks which skills each agent actually uses.

#### CONTEXT.md — Domain Knowledge
Pre-loaded knowledge the agent needs to do its job without asking:
- Viper: subreddit descriptions, common trading slang, what DD means, how to filter quality
- Grower: RO field layout, cultivar history, Southern Oregon climate patterns, soil types
- Radar: production targets, crew size, shift schedule, what "good" looks like
- Strategist: options terminology, strategy definitions, risk parameters, Koa's bankroll rules

This is the "training manual" each agent reads before every invocation.

### Orchestration — How Agents Get Called

**Three activation modes:**

**1. Scheduled (Atlas-driven)**
Atlas owns the master schedule. At the right time, Atlas wakes the right agents.
```
Atlas Heartbeat (every 10 min)
    │
    ├── Check schedule: who needs to run right now?
    ├── Check inboxes: any agent have pending tasks?
    ├── Check comms: any agent-to-agent messages waiting?
    │
    └── For each agent that needs to run:
            1. Load agent's full context (AGENT + SOUL + MEMORY + SKILLS + CONTEXT)
            2. Load current-task.md, inbox items, AND recent board activity
            3. Spawn agent session
            4. Agent does its work + checks board + contributes to others' work
            5. Agent updates its own memory + posts to Mission Control
            6. Result announced back to Atlas
```

**2. Reactive (Agent-triggered)**
Agents can trigger other agents when their output is relevant.
- Viper finds unusual activity → flags Strategist to build setups
- Wire catches breaking news → pings Regime to reassess conditions
- Analyst finishes a post-trade review → sends lessons to Strategist
- Atlas sees these triggers during heartbeat and activates the target agent next cycle

**3. Event-driven (External triggers)**
- Koa sends a message → Atlas routes to the right agent
- Consignment dropoff → intake handler fires
- Production API anomaly → Radar activates
- Market hours open/close → trading agents activate/deactivate

**Agents are aware of the bigger picture.** When invoked, every agent sees recent board activity and can contribute beyond their immediate task. They're team members, not isolated scripts.

### Agent Communication

Agents CAN and SHOULD talk to each other. That's how the best work happens — agents building on each other's output, jumping in when they have something to add, catching things other agents missed.

**Communication channels:**

1. **Mission Control Board** — the shared workspace. Every agent posts updates, deliverables, and insights here. All agents can see what's new. This is the "office" where work happens in the open.

2. **Direct messages** — agents can message specific agents when their work is relevant. Viper finds unusual options activity → messages Strategist directly: "Build setups for this." Wire catches breaking news → pings Regime: "Reassess market conditions."

3. **Broadcast** — an agent posts something all agents can see. "I found X, anyone have context?" Like the SiteGPT squad chat.

4. **Standup discussions** — structured conversations where agents discuss topics together, produce decisions and action items.

**How it works technically:**
- Agents write to a shared `comms/` directory or Mission Control DB
- During each agent's invocation, they check for new messages/activity relevant to their domain
- If they can contribute, they do. If not, they move on.
- Atlas has visibility on ALL communication (moderator role)

**Guardrails (light touch — Koa has excess usage, let them cook):**
- **Max 10 back-and-forth exchanges** between any two agents before Atlas reviews. Prevents infinite loops but gives real room for deep discussion.
- **Relevance filter:** Agents only engage with comms that match their domain. Grower doesn't need to weigh in on options plays.
- **No cost cap currently.** Let them communicate freely. We'll revisit if usage becomes a concern.
- **Atlas can mute channels** if something is generating noise without value.
- **Darwin monitors** communication patterns and flags if something looks wasteful — but doesn't throttle.

**The payoff:** Viper finds a Reddit post about a biotech catalyst → Wire confirms the FDA date → Regime checks sector conditions → Strategist builds the play → all without Koa or Atlas manually routing each step. That's how a real team works.

### Communication Flow
```
                         ┌─────────┐
                         │   Koa   │
                         │  (CEO)  │
                         └────┬────┘
                              │ Telegram / Mission Control
                         ┌────┴────┐
                         │  Atlas  │
                         │  (COO)  │
                         └────┬────┘
                              │ Delegates, monitors, synthesizes
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
        │   WORK    │  │  TRADING  │  │   LIFE    │
        │  Domain   │  │  Domain   │  │  Domain   │
        └─────┬─────┘  └─────┬─────┘  └─────┴─────┘
              │               │               │
     Friday ──┤      Viper ───┤      Scout ───┤
     Radar ───┤      Wire ────┤      Guide ───┤
     Dispatch─┤      Regime ──┤      Sensei ──┘
     Grower ──┘      Strategist┤
                     Analyst ──┤
                     Ledger ───┘

        ←──── Agents communicate freely within ────→
        ←──── and across domains via Mission    ────→
        ←──── Control Board + direct messages   ────→

                     ┌──────────┐
                     │  Darwin  │ (observes everything,
                     │          │  evolves the system)
                     └──────────┘
```

**How it flows:**
- **Koa → Atlas:** Requests, decisions, approvals, conversation
- **Atlas → Agents:** Delegation, scheduled invocations, context routing
- **Agent → Agent:** Direct messages, board posts, standup discussions. Agents proactively engage when they see relevant activity.
- **Agent → Atlas:** Completed work, questions needing Koa's input, escalations
- **Agent → Mission Control:** All output, activity, and status updates posted automatically
- **Darwin → Everything:** Observes all communication, proposes improvements, manages system health

### Agent Tiers (cost optimization)
- **Opus** — Atlas only (orchestration, synthesis, complex reasoning)
- **Sonnet** — Friday, Radar, Regime, Ledger, Strategist, Analyst (coding, analysis, moderate complexity)
- **Haiku** — Viper, Wire, Scout, Guide, Dispatch (scanning, filtering, simple tasks)
- **Local Ollama** — heartbeat checks, simple parsing, state management (free)
- **Tiers are not permanent.** Darwin recommends promotions/demotions based on performance. An agent doing complex work on Haiku that keeps failing gets upgraded. An agent doing simple work on Sonnet gets downgraded to save cost.

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

### Daily Rhythm — Full System

**Early Pre-Market (4:30–6:30 AM)**
```
4:30 AM   Wire: compile overnight news, futures movement, pre-market movers
          Viper: overnight Reddit digest + early morning sentiment
          → Both post findings to the board immediately
4:45 AM   Regime: market health assessment (green/yellow/red) based on
          futures, overnight global markets, VIX futures
5:00 AM   Strategist: builds setups based on overnight intelligence
          Analyst: checks if any setups align with historical patterns
          (full trading desk is awake and talking to each other)
5:30 AM   ☀️ FIRST BRIEF → Mission Control + Telegram
          "Here's what happened overnight. Here's what's setting up.
          Here's what needs your attention before open."
          🔊 Audio version ready

          Updates continue rolling in as pre-market develops.
          New ideas/setups posted to Mission Control as they form.

6:30 AM   UPDATED BRIEF if conditions changed since 5:30
```

**Pre-Market Hot Alert Protocol:**
When Wire or Viper catch something time-sensitive overnight or early AM — a catalyst that could move fast at open — they don't just post it. They wake up the FULL trading desk:
```
Wire/Viper spots something urgent
        │
        ▼
Broadcast to all trading agents: "Emergency huddle"
        │
        ▼
Regime: "Does this change the market picture?"
Strategist: "Here are the plays — entries, exits, sizing"
Analyst: "Historical precedent says X"
Ledger: "Current exposure allows Y more risk"
        │
        ▼
Trading desk produces a CONSENSUS recommendation
        │
        ▼
Atlas delivers to Koa with full context:
"The desk recommends [action] because [reasons].
Regime says [conditions]. Strategist built [setup].
Analyst found [precedent]. Your call."
```
This way Koa never gets a raw alert — he gets a team-reviewed, fully formed recommendation with the reasoning behind it.

**Late Pre-Market (6:30–9:30 AM)**
```
7:00 AM   Trading Standup: full desk discusses the day's plan
          → action items + audio summary
7:15 AM   Radar: pull overnight production data, prep daily view
7:30 AM   ☀️ MORNING BRIEF (full) → Mission Control + Atlas Survey + Telegram
          All domains: trading setups, RO status, any life domain alerts
          🔊 Audio version ready for Koa's drive to work
9:00 AM   Final pre-market update before open
9:15 AM   🎯 DAILY DEGEN PLAYS — Strategist's "Big Hitters"
          2-3 short expiration plays (0DTE, weeklies) with full breakdown:
          • Exact contract: "$SPY 505c 0DTE @ $0.85"
          • Why: "SPY holding above VWAP, volume confirming, 
            Regime says green, momentum into open"
          • Target: "$1.50 (76% gain)"
          • Stop: "$0.40 (53% loss)"
          • Risk/reward: 1.4:1
          • Historical hit rate: "This setup has hit 62% of the time 
            in the last 90 days"
          • Max position size based on bankroll rules
          • ⚠️ "This is a HIGH RISK play. Money you can lose today."
          
          These are the fun ones. Small positions, big swings. 
          Strategist picks them, Analyst validates the pattern, 
          Regime confirms conditions support it. The desk does its 
          homework — but Koa loves risk, and the plays should 
          reflect that. Not every trade needs a 70% probability. 
          Sometimes the 30% shot with a 5:1 payout is the move. 
          Include at least one "send it" play per day.
```

**Work Hours (9:00 AM–4:30 PM)**
```
9:00 AM   Dispatch: load today's task board from yesterday's war room
9:30 AM   Market opens — Wire goes live for breaking catalysts
          Viper: hourly Reddit momentum scans
          Strategist: updates setups as conditions change
          Regime: mid-day reassessment if conditions shift
          Radar: real-time production monitoring during shift
          Friday: works on assigned dev tasks
          All agents: checking board, contributing when relevant

12:00 PM  Radar: mid-shift production pulse
          Dispatch: task progress check — flag anything stalled

4:00 PM   Market closes
4:30 PM   RO shift ends
```

**Post-Market / Evening (4:30–10:00 PM)**
```
4:30 PM   Ledger: update positions, daily P&L
          Radar: end-of-day production summary
5:00 PM   Analyst: post-trade review on any closed positions
          Dispatch: daily task completion report
5:30 PM   📊 EVENING BRIEF → Mission Control
          Trading: P&L, what happened, tomorrow's catalysts
          Work: production summary, task status
          Life: any Scout/Guide/Sensei updates

7:00 PM   Evening build session — Friday works on app improvements
          Scout: opportunity scanning
          Guide: travel deal monitoring
          Darwin: system review and optimization
```

**Overnight (10:00 PM–6:00 AM)**
```
10:00 PM  Nightly build — Atlas orchestrates bigger projects
          Analyst: deeper research, backtesting, strategy evolution
          Darwin: self-evolution, agent performance review
          Friday: multi-pass development work

5:00 AM   Stop starting new work
          Write OVERNIGHT.md
          Update agent memories
```

**Weekend**
```
Saturday  Weekly performance review (Ledger + Analyst)
          Agent accuracy scoring (Darwin)
          Regime: weekly market outlook
          Scout: weekly opportunity brief
          Sensei: weekly goal check-in
          System maintenance and evolution

Sunday    Light — only Darwin running self-evolution
          Prep for Monday morning brief
```

**Key principles:**

**The trading desk never sleeps.** Markets are global and 24/7 (crypto, futures, pre/post-market, international). Wire and Viper run around the clock — scanning news, Reddit, crypto feeds, futures movement. Overnight Asian/European market moves that affect US open get caught. Crypto pumps at 3 AM get flagged. The schedule above is the *structured* rhythm, but the trading agents are always listening.

**Overnight trading coverage:**
- Wire: continuous news monitoring (RSS, feeds, breaking alerts)
- Viper: Reddit scans every 2 hours overnight (WSB doesn't sleep either)
- Regime: reassesses if futures move >1% overnight
- Strategist: pre-builds setups for overnight movers so they're ready by morning

**We can dial back if usage is too much.** Start aggressive, optimize later. Better to catch something important at 2 AM and not need it than miss it.

**Escalation chain:**
```
Something urgent happens
        │
        ▼
Agent flags Atlas immediately
        │
        ▼
Can Atlas handle it? ──── YES → Atlas resolves, logs it,
        │                        updates Mission Control,
        NO                       notifies Koa at next
        │                        natural touchpoint
        ▼
Atlas notifies Koa RIGHT NOW
via Telegram with full context:
what happened, why it's urgent,
what the options are, what Atlas
recommends
```

**What counts as "notify Koa immediately":**
- Major market event affecting open positions (flash crash, halt, earnings surprise)
- Breaking news on a held ticker or watchlist item
- Crypto position hitting stop loss or take profit
- System failure that affects trading capability
- Anything where waiting costs money or opportunity

**What Atlas handles without waking Koa:**
- Routine scans finding nothing notable
- Agent errors that can be retried
- System maintenance
- Low-priority insights that can wait for the morning brief

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

**Budget is reviewed daily by Atlas.** Actual token usage, API costs, and value delivered get tracked. If something is costing more than it's worth, Atlas flags it. If something cheap is delivering outsized value, we invest more. Budget section of this doc gets updated as real numbers come in.

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
6. **Strategist agent** — trade setup builder across all strategy types
7. **Ledger agent** — portfolio tracking
8. **Morning brief automation** — 4:30 AM trading desk wake-up, 5:30 AM first brief
9. **Mission Control v0.2** — trading domain panel

### Phase 3: Trading Desk v2 + RO Compression (Week 3)
10. **Analyst agent** — strategy evolution, backtesting, post-trade reviews
11. **Dispatch agent** — task tracking from war room
12. **Radar upgrades** — hour-by-hour charts, automated reports
13. **Mission Control v0.3** — work domain panel
14. **Daily Degen Plays** automation — 9:15 AM big hitter plays

### Phase 4: Life Domain + System Intelligence (Week 4)
15. **Scout agent** — opportunity scanning
16. **Guide agent** — travel deal monitoring (Hawaii, Thailand, Japan, Europe, Mexico)
17. **Sensei agent** — goal tracking
18. **Darwin agent** — system evolution, workflow auditing, external intel
19. **Nicole's learning mode** in trading
20. **Mission Control v1.0** — all three domains live

### Phase 5: Grow Season Prep (When Relevant)
21. **Grower agent** — agronomy tracking platform
22. **Field data integrations** — weather station, sensors
23. **Historical comparison engine** — this year vs. past years
24. **Ingest Koa's existing soil/weather data** (scattered but useful)

### Phase 6: Evolution (Ongoing)
- Agent accuracy scoring and improvement
- Side hustle execution support
- New agents as needs emerge (Atlas proposes, Koa approves)
- Darwin-driven self-evolution
- Margin trading / crypto expansion as Koa's interest develops

---

## System Self-Evolution — The Meta Layer

This is the thing that separates a static tool from a living system. The squad doesn't just do work — it constantly improves HOW it does work.

### Darwin — System Evolution Agent (NEW)
Named for obvious reasons. Darwin's entire job is making the system better.

**What Darwin does:**

1. **Workflow auditing:** Reviews how agents are communicating, delegating, and producing. Identifies bottlenecks, redundancies, and missed handoffs. "Viper and Wire are both scanning the same news sources. Consolidate or split the domain."

2. **External intelligence gathering:** Scans r/openclaw, r/ClaudeAI, r/LocalLLaMA, YouTube, and AI agent forums for new approaches, architectures, and tools that could improve our setup. Same way we found the SiteGPT video, the trading desk post, and the Clear Mud OS — but automated and continuous.

3. **Agent performance reviews:** Monthly review of each agent. Are they delivering value? Are their outputs being used or ignored? Should they be merged, split, upgraded, or retired? "Koa hasn't opened a Guide travel alert in 3 weeks. Either the recommendations suck or the timing is wrong. Investigating."

4. **Workflow experiments:** Proposes and tests changes to the system. "What if the morning standup ran at 6:30 instead of 7:00? What if Strategist presented 3 examples instead of 2? What if we added a crypto-specific scanner?" Tests for a week, measures results, keeps or reverts.

5. **Communication pattern optimization:** Analyzes how information flows between agents and to Koa. Are briefings too long? Too short? Wrong format? Wrong time? "Koa reads the trading brief in 45 seconds but spends 3 minutes on the RO production report. The trading brief might need more depth."

6. **Tool and model scouting:** New models drop constantly. New free APIs appear. New OpenClaw skills get published. Darwin evaluates whether any of these would improve agent performance or reduce cost. "Gemini Flash 3 is now free and handles the Reddit scanning Viper does at 1/10th the cost. Recommend switching."

7. **Cross-domain learning:** Applies lessons from one domain to another. "The backtesting approach that works for trading strategies could be applied to RO's grow season — compare this year's planting plan against historical yield data."

8. **System documentation:** Keeps the plan doc, agent configs, and architectural decisions current. When the system changes, the docs change with it.

**Darwin's rhythm:**
- Daily: quick scan of agent outputs and system health
- Weekly: deep review of one domain (rotates: Trading → Work → Life)
- Monthly: full system audit with recommendations report
- Continuous: monitors r/openclaw and AI forums for relevant innovations

**The rule:** Darwin proposes, Koa approves. No autonomous system changes without review. But Darwin should be opinionated — "I strongly recommend X because Y. Risk of not doing it: Z."

### How This Works In Practice

Week 1: System launches with the initial agent setup.
Week 4: Darwin notices the morning standup audio isn't being listened to — Koa reads the transcript instead. Recommends: shorten audio to 60-second highlights only.
Week 8: Darwin finds a Reddit post about a free options flow API. Evaluates it, backtests against Viper's current data quality. Recommends adding it.
Week 12: Darwin identifies that Strategist's swing trade setups have a 73% hit rate but 0DTE setups are at 38%. Recommends: reduce 0DTE frequency, increase swing trade focus.
Month 6: The system looks nothing like Month 1 — and that's the point.

**The system that evolves beats the system that was designed perfectly on day one. Every time.**

---

## Principles

1. **Research tool, not auto-anything.** Koa makes the calls. Agents surface information and execute tasks. No agent spends money or makes trades without explicit approval.
2. **Nicole is a first-class user.** Everything we build should be accessible to her, not just Koa.
3. **Data compounds.** Every observation logged, every trade tracked, every season recorded. The system gets smarter over time because the data gets richer.
4. **Start cheap, prove value, then invest.** The first version costs $11/mo extra. We earn the right to spend more by delivering results.
5. **Freedom is the metric.** If something doesn't move toward more time, more money, or more options — it doesn't get built.
6. **Nothing stays stagnant.** Always on the cutting edge. Always evolving.

---

## Agent Hiring & Outsourcing

**Think of the squad like a company, not a fixed roster.**

### Atlas Can Propose New Agents
Atlas has standing authority to identify gaps and propose:
- **New hires** — permanent agents filling a role the team needs long-term. Atlas writes up the proposal: role, justification, what it replaces or enables, model tier, estimated cost. Koa approves, agent gets onboarded.
- **Contractors** — temporary agents spun up for a specific job and decommissioned when done. Example: "Need a one-time data migration agent to restructure the trading logs." Spins up, does the work, gone.
- **Outsourced specialists** — for tasks outside the team's capability. Example: a vision model for chart pattern recognition, a code-specific model for a gnarly refactor, a research model for deep academic dives.

### How It Works
1. Atlas identifies a gap — something falling through cracks, a bottleneck, a capability the team lacks
2. Atlas writes a **hiring proposal** to Mission Control inbox:
   - Role name and description
   - Why it's needed (what problem it solves, what opportunity it creates)
   - Permanent hire vs. contractor
   - Model recommendation and cost estimate
   - What existing agents think (if relevant — e.g., "Dispatch is overwhelmed, recommends splitting task management from project planning")
3. Koa reviews and approves/rejects/modifies
4. Agent gets created with full identity (AGENT.md, memory, workspace)
5. Darwin tracks the new agent's performance and recommends keeping or cutting at 30-day review

### Skills, MCPs, Plugins, Tools
Same philosophy applies to the tooling layer:
- Atlas continuously scouts for new **OpenClaw skills** (clawhub.com), **MCPs** (Model Context Protocol servers), **plugins**, **APIs**, and **tools** that could improve the system
- Proposals go to Mission Control inbox: what it is, what it enables, cost, risk
- Nothing gets installed without review (security policy still applies)
- **Quarterly tool audit:** What tools are we using? What's dead weight? What's missing? What just launched that we should evaluate?

### The Roster Is Alive
- Agents can be **promoted** (given more responsibility/better models)
- Agents can be **demoted** (scaled back if not delivering value)
- Agents can be **fired** (decommissioned if redundant or ineffective)
- Agents can be **merged** (two roles that overlap get consolidated)
- Agents can be **split** (one role that's too broad gets divided)

Darwin manages the org health. Atlas makes the proposals. Koa makes the calls.

---

## Answered Questions
- **Travel wishlist:** Hawaii (Nicole's never been — gotta take her home), Thailand, Japan, Europe, Mexico. Guide will refine as it learns more about them.
- **Soil/weather data:** Koa has existing data but it's scattered. Will provide when relevant. Grower agent will ingest and structure it.
- **Crypto:** Interested in margin trading, no specific tokens/projects right now. Trading desk will scout opportunities.
- **Brief timing:** Koa checks his phone at all hours. Stays up late. First briefs at 4:30-5:30 AM are fine — he'll see them whenever he's up.
- **Nicole's device:** Has her own phone but unlikely to use a separate app. Nicole's View should be accessible through the same Mission Control URL, not a separate thing.

## Open Questions
- What's Koa + Nicole's realistic travel budget per trip?
- What existing side projects or business ideas have they talked about?
- What does Jacob (boss) think about more digital tooling for RO? Would he use Mission Control?
- What brokerages does Koa have funded and ready to trade? Just Robinhood + Aster?

---

_This document is alive. It evolves as we build, learn, and adapt. The plan is the starting point, not the ceiling._
