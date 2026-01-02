# Rogue Origin Apps - Setup Package

## What's Inside

```
rogue-origin-package/
├── CLAUDE.md                           ← AI context file (repo root)
├── PROJECT_STRUCTURE.md                ← Folder organization
├── README.md                           ← This file
│
├── frontend/
│   └── ops-hub.html                    ← Dashboard + AI Agent
│
├── apps-script/
│   ├── production-tracking/
│   │   ├── Code.gs                     ← Full backend (~1,900 lines)
│   │   └── AI_AGENT_FUNCTIONS.gs       ← AI functions only (if adding)
│   │
│   └── barcode-manager/
│       └── Code.gs
│
└── docs/
    ├── APP_CATALOG.md                  ← Technical reference (all apps)
    └── CODEBASE_INVENTORY.md           ← File/function inventory
```

## Documentation Overview

### CLAUDE.md
The main context file for Claude Code. Put this in your repo root.

**Contents:**
- Quick reference table (Sheet IDs, URLs, colors)
- Company overview and production metrics
- Complete app inventory with status
- Architecture diagram
- Standard code patterns (dual-mode, CORS, bilingual)
- User personas and their needs
- **Full project roadmap with phases**
- File structure reference
- Development guidelines

### docs/APP_CATALOG.md
Comprehensive technical reference for all 5 apps.

**Contents:**
- System architecture diagrams
- Full API endpoint reference for each app
- Key functions with status indicators
- Sheet IDs and deployment info
- AI Agent data flow and capabilities
- Shared patterns (bilingual, error handling, brand colors)
- Deployment reference

### docs/CODEBASE_INVENTORY.md
Detailed file-by-file technical inventory.

**Contents:**
- All frontend and backend files with line counts
- Every function in Production Code.gs with status
- Sheet tabs inventory
- External integrations status
- Removed/deprecated code log
- Known issues and resolutions
- Architecture Decision Records (ADRs)
- Recommendations (short/medium/long-term)
- Technical debt tracking

## Quick Setup

### 1. GitHub Repo
```bash
# Copy files to your local repo
cp CLAUDE.md /path/to/rogue-origin-apps/
cp -r docs/ /path/to/rogue-origin-apps/
cp frontend/ops-hub.html /path/to/rogue-origin-apps/

# Push to GitHub
cd /path/to/rogue-origin-apps
git add .
git commit -m "Add AI Agent and documentation"
git push
```

### 2. Apps Script
1. Open Production Tracking spreadsheet
2. Extensions → Apps Script
3. Replace Code.gs with `apps-script/production-tracking/Code.gs`
4. File → Project Settings → Script Properties
5. Add: `ANTHROPIC_API_KEY` = your key
6. Deploy → Manage deployments → New version

### 3. Claude Code
1. Open Claude Code app
2. Select your rogue-origin-apps folder
3. Claude will automatically read CLAUDE.md
4. Start asking questions!

## Project Roadmap (from CLAUDE.md)

| Phase | Weeks | Status | Focus |
|-------|-------|--------|-------|
| **Phase 1** | 1-3 | 🔄 ~70% | AI Agent Foundation |
| **Phase 2** | 3-5 | 📋 Next | Customer Order Dashboard |
| **Phase 3** | 5-7 | 📋 Planned | Consignment System Rebuild |
| **Phase 4** | 7-9 | 📋 Planned | Processing Floor Enhancement |
| **Phase 5** | 9-12 | 📋 Planned | Value Stream Mapping |
| **Phase 6** | Ongoing | 💭 Future | Product Packaging |

### Phase 1 Status (~70% Complete)
- ✅ AI chat interface in Ops Hub
- ✅ Production data tools (get_production_today, get_crew_count)
- ✅ Historical analysis & projections
- ✅ Feedback & correction learning
- 📋 Voice input/output (moved to Phase 4)
- 📋 Order tools (Phase 2)
- 📋 Consignment tools (Phase 3)

## AI Agent Features

The ops-hub.html includes a floating chat button (🌿) that can:
- Answer status questions ("How are we doing today?")
- Analyze history ("Compare this week to last week")
- Calculate projections ("How long for 40kg with 5 trimmers?")
- Learn from corrections ("Actually, we work half days Friday")

See `docs/APP_CATALOG.md` for complete documentation.
