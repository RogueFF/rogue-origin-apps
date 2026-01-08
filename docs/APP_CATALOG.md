# Rogue Origin - Master App Catalog

> **Last Updated**: January 2, 2026  
> **Version**: 2.0 (AI Agent Release)  
> **Purpose**: Complete technical reference for all production applications

---

## Table of Contents

1. [System Overview](#system-overview)
2. [App 1: Ops Hub + AI Agent](#app-1-ops-hub--ai-agent)
3. [App 2: Hourly Production Tracker](#app-2-hourly-production-tracker)
4. [App 3: SOP Manager](#app-3-sop-manager)
5. [App 4: Kanban Board](#app-4-kanban-board)
6. [App 5: Barcode Manager](#app-5-barcode-manager)
7. [Data Schemas](#data-schemas)
8. [API Reference](#api-reference)
9. [Shared Utilities](#shared-utilities)
10. [Integration Points](#integration-points)

---

## System Overview

### Complete Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 USER DEVICES                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  📱 Mobile (Boss)     💻 Desktop (Koa)     📺 TV Display     📱 Tablet (Floor)  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                      │
│                    GitHub Pages (rogueff.github.io/rogue-origin-apps/)           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                           Static HTML/CSS/JS                              │   │
│  ├────────────┬────────────┬────────────┬────────────┬────────────┐         │   │
│  │ ops-hub    │ scoreboard │sop-manager │ kanban     │ barcode    │         │   │
│  │ .html      │ .html      │ .html      │ .html      │ .html      │         │   │
│  │            │            │            │            │            │         │   │
│  │ ~2,300 ln  │ ~468KB     │ ~1,500 ln  │ ~600 ln    │ ~700 ln    │         │   │
│  │            │ (w/charts) │            │            │            │         │   │
│  │ Features:  │ Features:  │ Features:  │ Features:  │ Features:  │         │   │
│  │ • AI Chat  │ • Live     │ • CRUD     │ • Columns  │ • SKU mgmt │         │   │
│  │ • Tiles    │   metrics  │ • PDF      │ • D&D      │ • Barcodes │         │   │
│  │ • Quick    │ • Charts   │ • AI gen   │ • Filters  │ • Labels   │         │   │
│  │   actions  │ • Auto-    │ • ES/EN    │ • Archive  │ • Printing │         │   │
│  │ • Mobile   │   refresh  │ • Images   │            │            │         │   │
│  └────────────┴────────────┴────────────┴────────────┴────────────┘         │   │
│                                                                                  │
│  Dual-Mode Support:                                                              │
│  • GitHub Pages → fetch() API calls                                              │
│  • Apps Script → google.script.run                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ fetch() with text/plain (CORS-safe)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER                                       │
│                       Google Apps Script Web Apps                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    PRODUCTION TRACKING (Code.gs)                          │   │
│  │                    ~1,900 lines (with AI Agent)                           │   │
│  │                                                                           │   │
│  │  Sheet ID: REDACTED-PRODUCTION-SHEET-ID                   │   │
│  │  Deployment: REDACTED-API-PREFIXcedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X... │   │
│  │                                                                           │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │   │
│  │  │ Core Functions (45+)                                                │  │   │
│  │  │                                                                     │  │   │
│  │  │ WEB APP HANDLERS:                                                   │  │   │
│  │  │ • doGet(e) - Route GET requests                                     │  │   │
│  │  │ • doPost(e) - Route POST requests                                   │  │   │
│  │  │ • onOpen() - Add menu items                                         │  │   │
│  │  │                                                                     │  │   │
│  │  │ SCOREBOARD:                                                         │  │   │
│  │  │ • getScoreboardData() - Line 1 production metrics                   │  │   │
│  │  │ • getScoreboardWithTimerData() - Combined scoreboard + bags         │  │   │
│  │  │ • buildDashboardData() - Full dashboard dataset                     │  │   │
│  │  │ • getDashboardDataLive() - Live wrapper                             │  │   │
│  │  │                                                                     │  │   │
│  │  │ BAG TIMER:                                                          │  │   │
│  │  │ • getBagTimerData() - Bag counts, cycles                            │  │   │
│  │  │ • logManualBagCompletion(size) - Manual bag entry                   │  │   │
│  │  │ • logTimerPause(reason, duration) - Break start                     │  │   │
│  │  │ • logTimerResume(pauseId, duration) - Break end                     │  │   │
│  │  │ • is5kgBag(size) - Check bag type                                   │  │   │
│  │  │ • is10lbTopsBag(size, sku) - Check bag type                         │  │   │
│  │  │                                                                     │  │   │
│  │  │ CREW MANAGEMENT:                                                    │  │   │
│  │  │ • showCrewChangeSidebar() - Open crew UI                            │  │   │
│  │  │ • setCrewCounts(b1, b2, t1, t2) - Update counts                     │  │   │
│  │  │ • getCrewSnapshotForActiveRow() - Current crew                      │  │   │
│  │  │ • getCrewChangeLog_() - History log                                 │  │   │
│  │  │                                                                     │  │   │
│  │  │ HISTORICAL DATA:                                                    │  │   │
│  │  │ • getExtendedDailyDataLine1_(ss, tz, days) - N-day history          │  │   │
│  │  │ • getDailyStrainBreakdown_(ss, tz, days) - Strain by day            │  │   │
│  │  │ • getStrainHistoricalRate_(ss, tz, strain, days) - Rate lookup      │  │   │
│  │  │ • getComparisonDataLine1_(ss, tz, ...) - Compare periods            │  │   │
│  │  │ • calculateDayPercentageAtHourLine1_(...) - Point-in-time           │  │   │
│  │  │                                                                     │  │   │
│  │  │ GENERATION:                                                         │  │   │
│  │  │ • generateHourlyProductionTable() - Create daily template           │  │   │
│  │  │ • generateMasterSheet() - Consolidate data                          │  │   │
│  │  │ • setupMonthlySheet(sheet) - Initialize month                       │  │   │
│  │  │                                                                     │  │   │
│  │  │ LEAD TIME:                                                          │  │   │
│  │  │ • showLeadTimeEstimator() - Open estimator                          │  │   │
│  │  │ • calculateLeadTimeEstimator(formData) - Calculate ETA              │  │   │
│  │  │ • addWorkHours(start, hours, ...) - Work calendar math              │  │   │
│  │  │                                                                     │  │   │
│  │  │ AI AGENT (NEW):                                                     │  │   │
│  │  │ • handleChatRequest(data) - Main entry point                        │  │   │
│  │  │ • gatherProductionContext() - Collect all data                      │  │   │
│  │  │ • gatherHistoricalData(ss, tz) - 30-day analysis                    │  │   │
│  │  │ • buildSystemPrompt(context, corrections) - AI context              │  │   │
│  │  │ • callAnthropicForChat(system, history, msg) - API call             │  │   │
│  │  │ • extractCorrections(history) - Detect corrections                  │  │   │
│  │  │ • getRecentCorrections() - Load saved                               │  │   │
│  │  │ • saveCorrection(text, category) - Persist                          │  │   │
│  │  │ • logChatForTraining(msg, resp, turn) - Log chat                    │  │   │
│  │  │ • logChatFeedback(feedback) - Log 👍/👎                              │  │   │
│  │  │                                                                     │  │   │
│  │  │ UTILITIES:                                                          │  │   │
│  │  │ • jsonResponse(data) - Create JSON output                           │  │   │
│  │  │ • getLatestMonthSheet_(ss) - Find current tab                       │  │   │
│  │  │ • findDateRow_(vals, dateLabel) - Row lookup                        │  │   │
│  │  │ • getColumnIndices_(headers) - Column mapping                       │  │   │
│  │  │ • isEndOfBlock_(row) - Detect table end                             │  │   │
│  │  │ • getTimeSlotMultiplier(timeSlot) - Calc factor                     │  │   │
│  │  │ • getTodayHourlyTrimmers_(ss, tz) - Trimmer counts                  │  │   │
│  │  │ • getTrimmersForHour_(hourly, hour, fallback) - Hour lookup         │  │   │
│  │  │ • getCultivarList() - List strains                                  │  │   │
│  │  │ • getUiLocale() - Get language                                      │  │   │
│  │  │ • isSameDay(d1, d2) - Date compare                                  │  │   │
│  │  │                                                                     │  │   │
│  │  │ CONTEXT HELPERS:                                                    │  │   │
│  │  │ • assertMonthSheet_(sheetName) - Validate sheet                     │  │   │
│  │  │ • isValidHrxrDataRow_(sheet, row) - Validate row                    │  │   │
│  │  │ • getActiveHrxrContext_() - Get active context                      │  │   │
│  │  │ • readCrewFromRow_(ctx) - Read crew data                            │  │   │
│  │  │ • jumpToNewestHrHr_() - Navigate to latest                          │  │   │
│  │  │                                                                     │  │   │
│  │  │ TIMER:                                                              │  │   │
│  │  │ • showThroughputTimer() - Open timer UI                             │  │   │
│  │  │                                                                     │  │   │
│  │  │ ORDERS (Partial):                                                   │  │   │
│  │  │ • updateOrderStatuses_(ss) - Status updates                         │  │   │
│  │  │ • computeOrderProgress_(ss, tz, current) - Progress                 │  │   │
│  │  │ • computeProductionForCultivarSince_(...) - Cultivar prod           │  │   │
│  │  │ • getOrCreateOrdersSheet_() - Get orders tab                        │  │   │
│  │  │ • saveOrdersFromEstimator(formData) - Save order                    │  │   │
│  │  └─────────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                           │   │
│  │  HTML Templates (Bound Mode):                                             │   │
│  │  • ProductionScoreboard.html - Floor TV display (~60KB)                   │   │
│  │  • CrewChangeSidebar.html - Crew adjustment UI                            │   │
│  │  • LeadTimeEstimatorSidebar.html - Order estimation (~14KB)               │   │
│  │  • ThroughputTimerSidebar.html - Timer controls (~8KB)                    │   │
│  │  • ProductionDashboard.html - Dashboard view (~63KB)                      │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌───────────────────────────┐  ┌───────────────────────────┐                   │
│  │ SOP MANAGER (Code.gs)     │  │ KANBAN (Code.gs)          │                   │
│  │                           │  │                           │                   │
│  │ • doGet(e)                │  │ Sheet ID:                 │                   │
│  │ • doPost(e)               │  │ 19UW_tWY6c53lEydXqULAqC3  │                   │
│  │ • getSOPs()               │  │ Ffv1C20PDZMKnV6K-byQ      │                   │
│  │ • saveSOP(data)           │  │                           │                   │
│  │ • deleteSOP(id)           │  │ • doGet(e)                │                   │
│  │ • proxyAnthropicCall()    │  │ • doPost(e)               │                   │
│  │                           │  │ • getCards()              │                   │
│  │ Tab: SOPs                 │  │ • addCard(data)           │                   │
│  │ Columns: ID, Title,       │  │ • updateCard(data)        │                   │
│  │ Category, Steps,          │  │ • deleteCard(id)          │                   │
│  │ CreatedDate, etc.         │  │ • fetchProductInfo(url)   │                   │
│  └───────────────────────────┘  └───────────────────────────┘                   │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ BARCODE MANAGER (Code.gs)                                                 │  │
│  │ Sheet ID: REDACTED-BARCODE-SHEET-ID                    │  │
│  │                                                                           │  │
│  │ • doGet(e) - Serve page or API                                            │  │
│  │ • doPost(e) - Handle CRUD                                                 │  │
│  │ • getProducts() - List all products                                       │  │
│  │ • addProduct(data) - Create product                                       │  │
│  │ • updateProduct(data) - Update product                                    │  │
│  │ • deleteProduct(id) - Remove product                                      │  │
│  │ • importCSV(data) - Bulk import                                           │  │
│  │                                                                           │  │
│  │ Tab: Products                                                             │  │
│  │ Columns: SKU, Name, Weight, Unit, Price, BarcodeData, Active              │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ ANTHROPIC CLAUDE API │  │ SHOPIFY WEBHOOKS     │  │ TEC-IT BARCODE       │   │
│  │                      │  │                      │  │                      │   │
│  │ Endpoint:            │  │ Trigger:             │  │ Endpoint:            │   │
│  │ api.anthropic.com/   │  │ Order fulfillment    │  │ barcode.tec-it.com/  │   │
│  │ v1/messages          │  │ Bag tagged           │  │ barcode.ashx         │   │
│  │                      │  │                      │  │                      │   │
│  │ Model:               │  │ Payload:             │  │ Params:              │   │
│  │ claude-sonnet-4-20250514      │  │ Line items,          │  │ data=[SKU]           │   │
│  │                      │  │ Timestamps,          │  │ code=Code128         │   │
│  │ Max tokens: 1024     │  │ SKUs                 │  │                      │   │
│  │                      │  │                      │  │ Returns: Image       │   │
│  │ Key: Script Props    │  │ Target: Production   │  │                      │   │
│  │ ANTHROPIC_API_KEY    │  │ Tracking sheet       │  │ Free tier available  │   │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               DATA LAYER                                         │
│                            Google Sheets                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PRODUCTION SHEET (REDACTED-PRODUCTION-SHEET-ID)                │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: YYYY-MM (e.g., 2026-01)                                         │   ││
│  │  │ Purpose: Hour-by-hour production data                                │   ││
│  │  │                                                                      │   ││
│  │  │ Structure:                                                           │   ││
│  │  │ Row 1: Headers                                                       │   ││
│  │  │ Row 2: (Date row header like "Thursday, January 2, 2025")            │   ││
│  │  │ Rows 3-11: Hourly data (7AM, 8AM, 9AM, 10AM, 11AM, 12PM, 1PM, 2PM, 3PM)││
│  │  │ Row 12: (blank/separator)                                            │   ││
│  │  │ Row 13: Next date...                                                 │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Time Slot (e.g., "7:00 AM")                                       │   ││
│  │  │ B: Buckers Line 1                                                    │   ││
│  │  │ C: Buckers Line 2                                                    │   ││
│  │  │ D: Trimmers Line 1                                                   │   ││
│  │  │ E: Trimmers Line 2                                                   │   ││
│  │  │ F: Cultivar (e.g., "RO24-047 - Sour Lifter / Sungrown")              │   ││
│  │  │ G: Tops (lbs)                                                        │   ││
│  │  │ H: Smalls (lbs)                                                      │   ││
│  │  │ I: Trimmer Wage Rate                                                 │   ││
│  │  │ J: Trim Cost                                                         │   ││
│  │  │ K: (Additional columns as needed)                                    │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: Rogue Origin Production Tracking                                │   ││
│  │  │ Purpose: Shopify webhook bag completion log                          │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Timestamp (ISO format)                                            │   ││
│  │  │ B: Bag Type (e.g., "5kg", "10lb")                                    │   ││
│  │  │ C: Weight (lbs)                                                      │   ││
│  │  │ D: SKU                                                               │   ││
│  │  │ E: Source (webhook/manual)                                           │   ││
│  │  │                                                                      │   ││
│  │  │ Populated by: Shopify webhook or logManualBagCompletion()            │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: Timer Pause Log                                                 │   ││
│  │  │ Purpose: Track break/pause periods                                   │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Pause ID (UUID)                                                   │   ││
│  │  │ B: Start Time                                                        │   ││
│  │  │ C: End Time                                                          │   ││
│  │  │ D: Reason (e.g., "Lunch", "Morning Break", "Equipment")              │   ││
│  │  │ E: Estimated Duration (minutes)                                      │   ││
│  │  │ F: Actual Duration (seconds)                                         │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: CrewChangeLog                                                   │   ││
│  │  │ Purpose: Track crew count changes                                    │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Timestamp                                                         │   ││
│  │  │ B: Previous Buckers L1                                               │   ││
│  │  │ C: Previous Buckers L2                                               │   ││
│  │  │ D: Previous Trimmers L1                                              │   ││
│  │  │ E: Previous Trimmers L2                                              │   ││
│  │  │ F: New Buckers L1                                                    │   ││
│  │  │ G: New Buckers L2                                                    │   ││
│  │  │ H: New Trimmers L1                                                   │   ││
│  │  │ I: New Trimmers L2                                                   │   ││
│  │  │ J: User/Source                                                       │   ││
│  │  │ K: Notes                                                             │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: Data                                                            │   ││
│  │  │ Purpose: Reference data, configuration                               │   ││
│  │  │                                                                      │   ││
│  │  │ Sections:                                                            │   ││
│  │  │ • Cultivar List (strain names, target rates)                         │   ││
│  │  │ • Wage Rates (by date, hourly rates)                                 │   ││
│  │  │ • Target Rates (lbs/trimmer/hour by strain)                          │   ││
│  │  │ • Configuration (work hours, break times)                            │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: Master                                                          │   ││
│  │  │ Purpose: Auto-generated consolidation of all months                  │   ││
│  │  │                                                                      │   ││
│  │  │ Generated by: generateMasterSheet()                                  │   ││
│  │  │ Contains: Daily totals, running averages                             │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: AI_Chat_Log (NEW)                                               │   ││
│  │  │ Purpose: AI conversation history for training                        │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Timestamp                                                         │   ││
│  │  │ B: User Question                                                     │   ││
│  │  │ C: AI Response (truncated to 500 chars)                              │   ││
│  │  │ D: Conversation Turn Number                                          │   ││
│  │  │ E: Feedback (good/bad/null)                                          │   ││
│  │  │ F: Notes                                                             │   ││
│  │  │                                                                      │   ││
│  │  │ Populated by: logChatForTraining(), logChatFeedback()                │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐   ││
│  │  │ TAB: AI_Corrections (NEW)                                            │   ││
│  │  │ Purpose: Learned corrections from user feedback                      │   ││
│  │  │                                                                      │   ││
│  │  │ Columns:                                                             │   ││
│  │  │ A: Timestamp                                                         │   ││
│  │  │ B: Correction Text                                                   │   ││
│  │  │ C: Status (active/disabled)                                          │   ││
│  │  │ D: Category (rate/schedule/terminology/process/other)                │   ││
│  │  │                                                                      │   ││
│  │  │ Populated by: saveCorrection()                                       │   ││
│  │  │ Read by: getRecentCorrections()                                      │   ││
│  │  └─────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  BARCODE SHEET (REDACTED-BARCODE-SHEET-ID)                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ TAB: Products                                                               ││
│  │ Columns: SKU | Name | Weight | Unit | Price | BarcodeData | Active          ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  KANBAN SHEET (19UW_tWY6c53lEydXqULAqC3Ffv1C20PDZMKnV6K-byQ)                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ TAB: 12.12 Supplies                                                         ││
│  │ Columns: Item | URL | ImageFile | Supplier | OrderWhen | MinQty | MaxQty    ││
│  │          | CurrentQty | Status | Notes                                      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## App 1: Ops Hub + AI Agent

### Overview

| Property | Value |
|----------|-------|
| **Purpose** | Central dashboard + AI conversational assistant |
| **Frontend** | `ops-hub.html` (~2,300 lines) |
| **Backend** | Production Tracking Code.gs |
| **Sheet ID** | `REDACTED-PRODUCTION-SHEET-ID` |
| **Status** | ✅ Active (v2.0 with AI) |
| **Primary Users** | Boss (mobile), Koa (desktop) |

### File Structure

```
ops-hub.html
├── HTML Structure (lines 1-200)
│   ├── App tile grid
│   ├── Quick stats panel
│   └── AI chat widget container
│
├── CSS Styles (lines 200-800)
│   ├── CSS variables (brand colors)
│   ├── Dark mode styles
│   ├── Tile grid layout
│   ├── Responsive breakpoints
│   └── AI chat widget styles
│
├── App Tiles Section (lines 800-1000)
│   ├── Scoreboard tile
│   ├── SOP Manager tile
│   ├── Kanban tile
│   ├── Barcode tile
│   └── Lead Time tile
│
├── AI Chat Widget (lines 1000-1800)
│   ├── Chat container HTML
│   ├── Message list
│   ├── Input area
│   ├── Quick action buttons
│   ├── Chat JavaScript
│   │   ├── sendMessage()
│   │   ├── addMessage()
│   │   ├── handleFeedback()
│   │   └── API communication
│   └── Feedback UI
│
└── Main Scripts (lines 1800-2300)
    ├── loadDashboardData()
    ├── updateStats()
    ├── Navigation handlers
    └── Initialization
```

### AI Chat Widget Features

| Feature | Implementation | Status |
|---------|----------------|--------|
| Floating button | 🌿 emoji, bottom-right fixed | ✅ |
| Chat panel | Slide-up panel, dark mode | ✅ |
| Message history | Session-based in memory | ✅ |
| Quick actions | 4 preset buttons | ✅ |
| Typing indicator | Animated dots | ✅ |
| Feedback buttons | 👍/👎 per response | ✅ |
| Mobile support | Full-screen on small screens | ✅ |
| Keyboard support | Enter to send | ✅ |

### Quick Action Buttons

| Button | Query Sent |
|--------|------------|
| 📊 Status | "What's our production status for today?" |
| 📦 Bags | "How many bags have we completed today?" |
| ⚡ Rate | "What's our current production rate?" |
| 👥 Crew | "How many people are working right now?" |

---

## App 2: Hourly Production Tracker

### Overview

| Property | Value |
|----------|-------|
| **Purpose** | Hour-by-hour production logging, floor display |
| **Frontend** | `scoreboard.html` (~468KB with embedded charts) |
| **Backend** | Production Tracking Code.gs (~1,900 lines) |
| **Sheet ID** | `REDACTED-PRODUCTION-SHEET-ID` |
| **Status** | ✅ Active |
| **Primary Users** | Floor team (TV), supervisors |

### API Endpoints

#### GET Endpoints

| Endpoint | Function | Response |
|----------|----------|----------|
| `?action=scoreboard` | `getScoreboardWithTimerData()` | Full dashboard data |
| `?action=timer` | `getBagTimerData()` | Bag timer only |
| `?action=test` | — | `{ ok: true, timestamp }` |
| `?action=dashboard` | `buildDashboardData()` | Complete dashboard |
| (default) | — | API info |

#### POST Endpoints

| Endpoint | Function | Body | Response |
|----------|----------|------|----------|
| `?action=chat` | `handleChatRequest()` | `{ message, history }` | AI response |
| `?action=logBag` | `logManualBagCompletion()` | `{ bagType: "5kg" }` | Confirmation |
| `?action=logPause` | `logTimerPause()` | `{ reason, estimatedDuration }` | Pause ID |
| `?action=logResume` | `logTimerResume()` | `{ pauseId, actualDuration }` | Confirmation |
| `?action=setCrewCounts` | `setCrewCounts()` | `{ b1, b2, t1, t2 }` | Confirmation |

### Data Structures

#### Scoreboard Data Response

```javascript
{
  // Today's production
  todayLbs: 52.3,                    // Total tops produced today
  strain: "Sour Lifter / Sungrown", // Current cultivar
  lastHourLbs: 8.5,                  // Most recent hour's production
  lastTimeSlot: "10:00 AM",         // Which hour that was
  hoursLogged: 4,                    // Hours with data today
  
  // Target tracking
  todayPercentage: 96,               // % of target achieved
  todayTarget: 54.5,                 // Target lbs for logged hours
  projectedTotal: 78.2,              // End-of-day projection
  
  // Crew info
  currentHourTrimmers: 6,            // Trimmers this hour
  lastHourTrimmers: 6,               // Trimmers last hour
  
  // Rate info
  targetRate: 1.07,                  // Expected lbs/trimmer/hour
  strainTargetRate: 1.07,            // Strain-specific rate
  usingStrainRate: true,             // Using strain rate?
  
  // Comparisons
  vsYesterday: 5.2,                  // +/- vs yesterday at this hour
  vs7Day: -2.1,                      // +/- vs 7-day average
  
  // Metadata
  timestamp: "2026-01-02T15:30:00Z"
}
```

#### Bag Timer Data Response

```javascript
{
  // Today's counts
  bags5kgToday: 4,                   // 5kg bags completed today
  bags10lbToday: 2,                  // 10lb bags completed today
  bagsToday: 6,                      // Total bags today
  
  // Cycle times
  avgSecondsToday: 1823,             // Average seconds per bag today
  avgSeconds7Day: 1756,              // 7-day average cycle time
  
  // Last bag info
  lastBagTime: "2026-01-02T15:15:00Z", // When last bag completed
  secondsSinceLastBag: 900,          // Seconds since last bag
  
  // Timer state
  isPaused: false,                   // Is timer currently paused?
  pauseReason: null,                 // Why paused (if paused)
  
  // Metadata
  timestamp: "2026-01-02T15:30:00Z"
}
```

### Key Functions Detail

#### getScoreboardData()

```javascript
/**
 * Get Line 1 production data for the scoreboard
 * 
 * @returns {Object} Production metrics
 * 
 * Data sources:
 * - Current month sheet (YYYY-MM format)
 * - Data sheet (for target rates)
 * - Calculates: totals, rates, comparisons
 * 
 * Logic:
 * 1. Find today's date row in month sheet
 * 2. Sum all Tops column values for today
 * 3. Get current strain from last data row
 * 4. Look up strain-specific target rate
 * 5. Calculate % of target, projections
 * 6. Compare to yesterday/7-day average
 */
function getScoreboardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone();
  // ... implementation
}
```

#### getBagTimerData()

```javascript
/**
 * Get bag completion data from webhook log
 * 
 * @returns {Object} Bag timer metrics
 * 
 * Data sources:
 * - "Rogue Origin Production Tracking" sheet
 * - Timer Pause Log sheet
 * 
 * Logic:
 * 1. Filter webhook log for today's entries
 * 2. Separate 5kg and 10lb bags
 * 3. Calculate time between completions
 * 4. Average excluding outliers/pauses
 * 5. Check if timer currently paused
 */
function getBagTimerData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // ... implementation
}
```

#### getExtendedDailyDataLine1_(ss, timezone, days)

```javascript
/**
 * Get historical production data for N days
 * 
 * @param {Spreadsheet} ss - Active spreadsheet
 * @param {string} timezone - Spreadsheet timezone
 * @param {number} days - Number of days to retrieve
 * @returns {Array} Daily data objects
 * 
 * Used by: AI Agent for historical analysis
 * 
 * Returns array of:
 * {
 *   date: "2025-12-31",
 *   dayOfWeek: "Tuesday",
 *   topsLbs: 65.4,
 *   smallsLbs: 12.1,
 *   hoursWorked: 7.5,
 *   avgTrimmersPerHour: 6.2,
 *   avgRate: 1.05
 * }
 */
function getExtendedDailyDataLine1_(ss, timezone, days) {
  // ... implementation
}
```

---

## App 3: SOP Manager

### Overview

| Property | Value |
|----------|-------|
| **Purpose** | Standard Operating Procedure management |
| **Frontend** | `sop-manager.html` (~1,500 lines) |
| **Backend** | SOP Manager Code.gs |
| **Status** | ✅ Active |
| **Primary Users** | All (reference), Koa (management) |

### Features

| Feature | Description | Status |
|---------|-------------|--------|
| SOP Library | Create, edit, delete SOPs | ✅ |
| Step Management | Drag-and-drop reordering | ✅ |
| Image Annotation | Per-step images | ✅ |
| PDF Export | Multi-page, branded | ✅ |
| Bilingual | EN/ES toggle | ✅ |
| AI Generation | Claude-powered SOP creation | ✅ |
| QR Codes | Link to digital SOP | ✅ |
| Hybrid Cache | localStorage + API sync | ✅ |

### API Endpoints

| Endpoint | Method | Function | Response |
|----------|--------|----------|----------|
| `?action=sops` | GET | `getSOPs()` | Array of all SOPs |
| `?action=sop&id=X` | GET | `getSOP(id)` | Single SOP object |
| `?action=save` | POST | `saveSOP(data)` | Saved SOP |
| `?action=delete` | POST | `deleteSOP(id)` | `{ success: true }` |
| `?action=anthropic` | POST | `proxyAnthropicCall()` | AI response |

### SOP Data Structure

```javascript
{
  id: "sop_12345",
  title: "Scale Calibration",
  titleEs: "Calibración de Báscula",
  category: "Equipment",
  createdDate: "2025-06-15",
  updatedDate: "2025-12-20",
  author: "Koa",
  version: "1.2",
  steps: [
    {
      stepNumber: 1,
      instruction: "Turn on scale and wait for display",
      instructionEs: "Encienda la báscula y espere la pantalla",
      imageUrl: "https://...",
      imageAnnotations: [
        { x: 150, y: 200, label: "Power button" }
      ],
      warnings: ["Ensure scale is on level surface"],
      warningsEs: ["Asegúrese de que la báscula esté nivelada"]
    },
    // ... more steps
  ],
  qrCode: "https://rogueff.github.io/rogue-origin-apps/sop?id=sop_12345"
}
```

---

## App 4: Kanban Board (Supply Closet Inventory)

### Overview

| Property | Value |
|----------|-------|
| **Purpose** | Supply closet inventory management with printable cards |
| **Frontend** | `kanban.html` (~2,100 lines) |
| **Backend** | Kanban Code.gs (~350 lines) |
| **Sheet ID** | `19UW_tWY6c53lEydXqULAqC3Ffv1C20PDZMKnV6K-byQ` |
| **Status** | ✅ Active |
| **Primary Users** | Koa (management), Floor team (viewing) |

### Key Features

| Feature | Description |
|---------|-------------|
| **Supply Cards** | Create cards for each supply item with name, supplier, price, quantity, image |
| **Card Printing** | Print cards with QR codes linking to order URLs |
| **Interactive Tutorial** | 21-step hand-holding tutorial for new users |
| **Auto-fill** | Paste product URL to auto-fetch name, price, and image |
| **Search & Filter** | Find items by name or filter by supplier |
| **Grid/List Views** | Toggle between card grid and list table views |
| **Status Colors** | Green (in stock), Gold (low), Orange (critical) |

### Tutorial System

The Kanban app includes a comprehensive 21-step interactive tutorial:

**Part 1: Page Overview (Steps 1-8)**
- Welcome, header buttons, search/filter, card explanation, action buttons

**Part 2: Create a Card (Steps 9-19)**
- Opens Add Card modal
- Guides through each field: Item Name, Supplier, Quantity, Price, Delivery, Location, URL, Auto-fill, Image
- User actually fills in fields and saves

**Part 3: Print Cards (Steps 20-22)**
- Opens Print modal, select cards, print button, celebration

**Tutorial Elements:**
- Gold graduation cap button (bottom-right) starts tutorial
- Spotlight highlights current element
- Tooltips with tips and encouragement
- Progress dots show completion
- Confetti celebration on finish
- Remembers if user has seen tutorial (localStorage)

### API Endpoints

| Endpoint | Method | Function | Response |
|----------|--------|----------|----------|
| `?action=cards` | GET | `getCards()` | Array of cards |
| `?action=test` | GET | — | `{ ok: true }` |
| `?action=add` | POST | `addCard(data)` | New card |
| `?action=update` | POST | `updateCard(data)` | Updated card |
| `?action=delete` | POST | `deleteCard(id)` | `{ success: true }` |
| `?action=fetchProduct` | POST | `fetchProductInfo(url)` | Product data |

### Card Data Structure

```javascript
{
  id: 5,                           // Row number (auto)
  item: "Grove Bags 1lb",          // Item name
  url: "https://grovebags.com/...", // Product URL
  imageFile: "grove_1lb.jpg",      // Image filename
  supplier: "Grove Bags",          // Supplier name
  orderWhen: "Green Card Signal",  // Trigger condition
  minQty: 100,                     // Minimum quantity
  maxQty: 500,                     // Maximum quantity
  currentQty: 250,                 // Current stock
  status: "Green",                 // Red/Yellow/Green
  notes: "Lead time 2 weeks"       // Additional notes
}
```

---

## App 5: Barcode Manager

### Overview

| Property | Value |
|----------|-------|
| **Purpose** | Product labels and barcode printing |
| **Frontend** | `barcode.html` (~700 lines) |
| **Backend** | Barcode Manager Code.gs |
| **Sheet ID** | `REDACTED-BARCODE-SHEET-ID` |
| **Status** | ✅ Active |
| **Primary Users** | Packaging team |

### Label Specifications

| Property | Value |
|----------|-------|
| Printer | Bixolon thermal |
| Label Size | 1.65" × 0.5" |
| Barcode Format | Code128 |
| Barcode Service | tec-it.com |

### Barcode URL Pattern

```javascript
const barcodeUrl = `https://barcode.tec-it.com/barcode.ashx?` +
  `data=${encodeURIComponent(sku)}` +
  `&code=Code128` +
  `&translate-esc=true` +
  `&dmsize=Default`;
```

### API Endpoints

| Endpoint | Method | Function | Response |
|----------|--------|----------|----------|
| `?action=products` | GET | `getProducts()` | Array of products |
| `?action=test` | GET | — | `{ ok: true }` |
| `?action=add` | POST | `addProduct(data)` | New product |
| `?action=update` | POST | `updateProduct(data)` | Updated product |
| `?action=delete` | POST | `deleteProduct(id)` | `{ success: true }` |
| `?action=import` | POST | `importCSV(data)` | Import results |

### Product Data Structure

```javascript
{
  id: 1,                           // Row number
  sku: "RO-LIFT-5KG",              // SKU code
  name: "Lifter 5kg",              // Product name
  weight: 11.02,                   // Weight in lbs
  unit: "lbs",                     // Weight unit
  price: 250.00,                   // Price (optional)
  barcodeData: "RO-LIFT-5KG",      // Barcode content
  active: true                     // Is active product
}
```

---

## Data Schemas

### Monthly Production Sheet Schema

| Column | Header | Type | Example | Notes |
|--------|--------|------|---------|-------|
| A | Time Slot | String | "7:00 AM" | Hour label |
| B | Buckers L1 | Number | 2 | Line 1 buckers |
| C | Buckers L2 | Number | 0 | Line 2 buckers |
| D | Trimmers L1 | Number | 6 | Line 1 trimmers |
| E | Trimmers L2 | Number | 0 | Line 2 trimmers |
| F | Cultivar | String | "RO24-047 - Sour Lifter / Sungrown" | Strain |
| G | Tops | Number | 8.5 | Lbs tops produced |
| H | Smalls | Number | 1.2 | Lbs smalls produced |
| I | Wage Rate | Currency | $18.50 | Hourly wage |
| J | Trim Cost | Currency | $9.62 | Calculated cost |

### Bag Completion Log Schema

| Column | Header | Type | Example | Notes |
|--------|--------|------|---------|-------|
| A | Timestamp | DateTime | 2026-01-02T15:30:00Z | ISO format |
| B | Bag Type | String | "5kg" | Size category |
| C | Weight | Number | 11.02 | Actual weight |
| D | SKU | String | "RO-LIFT-5KG" | Product SKU |
| E | Source | String | "webhook" | webhook/manual |

### AI Chat Log Schema

| Column | Header | Type | Example | Notes |
|--------|--------|------|---------|-------|
| A | Timestamp | DateTime | 2026-01-02T15:30:00Z | When asked |
| B | Question | String | "How are we doing?" | User message |
| C | Response | String | "📊 We're at 52.3..." | Truncated to 500 chars |
| D | Turn | Number | 3 | Conversation turn |
| E | Feedback | String | "good" | good/bad/null |
| F | Notes | String | "" | Additional context |

### AI Corrections Schema

| Column | Header | Type | Example | Notes |
|--------|--------|------|---------|-------|
| A | Timestamp | DateTime | 2026-01-02T10:00:00Z | When saved |
| B | Correction | String | "We work half days Friday" | Text |
| C | Status | String | "active" | active/disabled |
| D | Category | String | "schedule" | Classification |

---

## API Reference

### Production API Base URL

```
https://script.google.com/macros/s/REDACTED-PRODUCTION-API-ID/exec
```

### Request Format

**GET Request:**
```javascript
fetch(`${API_URL}?action=scoreboard`)
  .then(r => r.json())
  .then(data => console.log(data));
```

**POST Request (CORS-safe):**
```javascript
fetch(`${API_URL}?action=chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain;charset=utf-8'  // Required for CORS
  },
  body: JSON.stringify({
    message: "How are we doing?",
    history: []
  }),
  redirect: 'follow'
}).then(r => r.json());
```

### Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-01-02T15:30:00Z"
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2026-01-02T15:30:00Z"
}
```

---

## Shared Utilities

### jsonResponse(data)

```javascript
/**
 * Create JSON response for Apps Script web app
 * @param {Object} data - Data to return
 * @returns {TextOutput} JSON response
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### getLatestMonthSheet_(ss)

```javascript
/**
 * Find the most recent month sheet (YYYY-MM format)
 * @param {Spreadsheet} ss - Spreadsheet object
 * @returns {Sheet} Month sheet
 */
function getLatestMonthSheet_(ss) {
  var sheets = ss.getSheets();
  var monthPattern = /^\d{4}-\d{2}$/;
  var monthSheets = sheets.filter(s => monthPattern.test(s.getName()));
  monthSheets.sort((a, b) => b.getName().localeCompare(a.getName()));
  return monthSheets[0];
}
```

### getColumnIndices_(headers)

```javascript
/**
 * Map column names to indices
 * @param {Array} headers - Header row values
 * @returns {Object} Column name -> index mapping
 */
function getColumnIndices_(headers) {
  var indices = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim().toLowerCase();
    if (name.includes('trimmer') && name.includes('1')) indices.trimmers1 = i;
    if (name.includes('trimmer') && name.includes('2')) indices.trimmers2 = i;
    if (name.includes('bucker') && name.includes('1')) indices.buckers1 = i;
    if (name.includes('bucker') && name.includes('2')) indices.buckers2 = i;
    if (name.includes('tops') || name === 'tops') indices.tops = i;
    if (name.includes('small')) indices.smalls = i;
    if (name.includes('cultivar') || name.includes('strain')) indices.cultivar = i;
  }
  return indices;
}
```

---

## Integration Points

### Shopify Webhooks

**Event**: Order fulfilled / Bag tagged  
**Target**: Production Tracking Sheet → "Rogue Origin Production Tracking" tab  
**Payload**: Line items with SKU, weight, timestamp

**Setup**:
1. Shopify Admin → Settings → Notifications → Webhooks
2. Add webhook for "Order fulfilled"
3. URL: Apps Script web app URL with `?action=webhook`
4. Format: JSON

### Anthropic Claude API

**Endpoint**: `https://api.anthropic.com/v1/messages`  
**Model**: `claude-sonnet-4-20250514`  
**Key Location**: Script Properties → `ANTHROPIC_API_KEY`

**Request Format**:
```javascript
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "system": "System prompt with context...",
  "messages": [
    { "role": "user", "content": "User message" }
  ]
}
```

### tec-it.com Barcode Service

**Endpoint**: `https://barcode.tec-it.com/barcode.ashx`  
**Format**: Code128  
**Free Tier**: Yes, with attribution

**URL Parameters**:
- `data`: Barcode content (URL encoded)
- `code`: Barcode type (Code128)
- `translate-esc`: Enable escape sequences
- `dmsize`: Size (Default)

---

## Changelog

### Version 2.0 (January 2, 2026)

**New Features:**
- ✅ AI Agent integrated into Ops Hub
- ✅ 30-day historical data analysis
- ✅ Per-strain daily breakdown
- ✅ Projection calculations
- ✅ Feedback system (👍/👎)
- ✅ Correction learning
- ✅ AI_Chat_Log sheet
- ✅ AI_Corrections sheet
- ✅ 10lb bag support

**Functions Added:**
- `handleChatRequest(data)`
- `gatherProductionContext()`
- `gatherHistoricalData(ss, tz)`
- `getDailyStrainBreakdown_(ss, tz, days)`
- `buildSystemPrompt(context, corrections)`
- `callAnthropicForChat(system, history, msg)`
- `extractCorrections(history)`
- `getRecentCorrections()`
- `saveCorrection(text, category)`
- `logChatForTraining(msg, response, turn)`
- `logChatFeedback(feedback)`

### Version 1.5 (December 2025)

- ✅ Added 10lb bag support to bag timer
- ✅ Expanded bag timer data structure

### Version 1.0 (2024)

- ✅ Initial release
- ✅ Hourly Production Tracker
- ✅ Bag Timer (5kg)
- ✅ SOP Manager
- ✅ Kanban Board
- ✅ Barcode Manager
- ✅ Ops Hub Dashboard
