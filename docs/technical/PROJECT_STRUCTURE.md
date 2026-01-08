# Rogue Origin Apps - Complete Project Structure

This is the recommended folder structure for working with Claude Code on the full project.

## Folder Structure

```
rogue-origin-apps/
├── CLAUDE.md                          ← Claude Code reads this first
├── README.md                          ← Project overview
│
├── frontend/                          ← GitHub Pages (deployed)
│   ├── index.html
│   ├── ops-hub.html                   ← Ops Dashboard + AI Chat
│   ├── scoreboard.html
│   ├── sop-manager.html
│   ├── kanban.html
│   └── barcode.html
│
├── apps-script/                       ← Local copies of .gs files
│   ├── production-tracking/
│   │   ├── Code.gs
│   │   ├── CrewChangeSidebar.html
│   │   ├── LeadTimeEstimatorSidebar.html
│   │   ├── ProductionScoreboard.html
│   │   └── ThroughputTimerSidebar.html
│   │
│   ├── sop-manager/
│   │   └── Code.gs
│   │
│   ├── kanban/
│   │   └── Code.gs
│   │
│   └── barcode-manager/
│       └── Code.gs
│
└── docs/
    ├── APP_CATALOG.md                 ← Technical reference
    ├── CODEBASE_INVENTORY.md          ← File inventory
    └── DEPLOYMENT.md                  ← How to deploy changes
```

## Workflow with Claude Code

### Frontend Changes (HTML)
1. Open Claude Code → Select `rogue-origin-apps` folder
2. Ask Claude to make changes
3. Git commit and push
4. GitHub Pages auto-deploys

### Backend Changes (Apps Script)
1. Open Claude Code → Ask for changes to .gs files
2. Claude edits the local copy in `apps-script/`
3. **Manual step**: Copy the code to Google Apps Script
4. Deploy new version in Apps Script

### Syncing Apps Script Files
To keep local copies in sync with Google:

**Export from Google:**
1. Open Apps Script project
2. File → Download → Download files
3. Extract to the appropriate `apps-script/` subfolder

**Import to Google:**
1. Copy code from local file
2. Paste into Apps Script editor
3. Deploy → New version

## Sheet IDs Reference

| Project | Sheet ID |
|---------|----------|
| Production Tracking | `REDACTED-PRODUCTION-SHEET-ID` |
| Barcode Manager | `REDACTED-BARCODE-SHEET-ID` |

## Apps Script Deployment URLs

| Project | Web App URL |
|---------|-------------|
| Production Tracking | `https://script.google.com/macros/s/REDACTED-PRODUCTION-API-ID/exec` |

## Tips for Claude Code

Ask things like:
- "Show me all the files in this project"
- "Update the doPost function in apps-script/production-tracking/Code.gs to add X"
- "Find all TODO comments"
- "Add bilingual support to the crew change sidebar"
- "What functions call getScoreboardData?"

Claude Code will:
- Read CLAUDE.md for context automatically
- Edit files directly in your local folder
- Help you understand the codebase
- Generate new code that follows your patterns
