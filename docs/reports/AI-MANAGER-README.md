# AI Manager Implementation Guide

## Overview

This implementation adds a **Mem0-inspired AI Manager** to the Rogue Origin hemp processing dashboard with persistent memory, task execution, feedback learning, and context-aware responses.

## Features Implemented

### 1. **Persistent Memory System** (Mem0-inspired)
- **3-tier storage**: short (24h), mid (7 days), long (7+ days)
- **Token efficiency**: 90% savings using layered search
- **Auto-extraction**: Keywords and entities extracted from conversations
- **Storage**: AI_Memory Google Sheet with 12 columns

**Frontend (memory.js):**
- Session ID generation
- Conversation history in sessionStorage
- Max 50 messages cached locally
- Export for backend API

**Backend (Code.gs):**
- `getOrCreateMemorySheet_()` - Creates AI_Memory sheet
- `saveToMemory_()` - Stores messages with metadata
- `searchMemory_()` - 3-layer search (keyword → timeline → details)
- `updateMemoryTiers_()` - Ages memory across tiers

### 2. **Task Execution Framework** (LangChain-inspired)
- **6 executable tasks** with schema validation
- **TASK_REGISTRY** defines parameters and constraints
- **Automatic detection** from AI responses
- **Execution logging** in AI_Tasks sheet

**Available Tasks:**
```javascript
{
  update_crew_count: {line, role, count},
  log_bag_completion: {bagType, weight, notes},
  schedule_order: {customer, totalKg, dueDate, cultivars, notes},
  pause_timer: {reason, notes},
  resume_timer: {},
  get_order_status: {orderId},
  create_shipment: {customerName, items: [{strain, type, quantity}, ...], shipmentDate?, notes?},
  get_shipments: {customerName}
}
```

**How It Works:**
1. AI includes task in response:
```
I'll update the crew for you.
```task
{"task":"update_crew_count","params":{"line":1,"role":"trimmers","count":5}}
```
Done! Line 1 now has 5 trimmers.
```

2. Backend extracts, validates, executes, and logs task
3. Task blocks removed from user-visible response

### 3. **Feedback & Learning System**
- **👍👎 buttons** on every AI response
- **Visual confirmation** when clicked
- **Backend logging** in AI_Chat_Log sheet
- **Future**: Train on helpful vs unhelpful patterns

### 4. **Context-Aware Responses**
- Memory search integrated into chat handler
- Relevant past conversations included in system prompt
- AI references previous discussions automatically
- Maintains context across sessions

### 5. **Voice Mode** ✅
- Speech-to-text using browser's Web Speech API (free)
- Text-to-speech using Google Cloud TTS API (free tier: 4M chars/month)
- Smart mode: Short responses read aloud, long responses summarized
- Visual indicators for listening and speaking states
- See `docs/VOICE_MODE_SETUP.md` for setup guide

### 6. **Shipment Management** ✅ NEW
- Create wholesale shipments through natural language
- **Multi-item shipments** - combine multiple strains/types in one shipment
- Query shipments for any customer
- Fuzzy customer name matching (>70% similarity)
- Auto-pricing from PriceHistory sheet (per line item)
- Scoreboard integration for production queue
- See `docs/SHIPMENT_CREATION_SETUP.md` for full guide

**Example Commands:**
```
"Create a shipment for Cannaflora, 500kg Lifter Tops"
"Create a shipment for Cannaflora: 20kg Lifter Tops and 20kg Sour Lifter Tops"
"Ship to Green Valley: 100kg Blue Dream Tops, 50kg Lifter Tops, 30kg Sour Lifter Smalls"
"What shipments exist for Green Valley?"
"New shipment: Mountain Organics, 100kg Blue Dream Smalls, shipping Feb 15"
```

**Features:**
- **Multi-item support** - one shipment with multiple line items
- Links to existing master orders automatically
- Each item priced individually from PriceHistory
- Supports Tops and Smalls product types
- Optional shipment date and notes
- Results display as formatted data cards
- Shipments appear on scoreboard TV display

---

## Architecture

### Memory Flow
```
User Message
    ↓
Frontend (memory.js)
    ├─ Generate/get session ID
    ├─ Add to sessionStorage
    └─ Send to backend with history
        ↓
Backend (Code.gs)
    ├─ Save user message
    ├─ Search memory for context
    ├─ Build prompt with memory
    ├─ Get AI response
    ├─ Save assistant response
    └─ Extract & execute tasks
        ↓
Google Sheets
    ├─ AI_Memory (conversations)
    ├─ AI_Tasks (execution log)
    └─ AI_Chat_Log (feedback)
```

### 3-Layer Search Pattern
```
Layer 1: Keyword Search
  ↓ Returns IDs (~50-100 tokens/result)
Layer 2: Timeline Context
  ↓ Gets surrounding messages (~200 tokens)
Layer 3: Full Details
  ↓ Fetches top 3 matches (~500 tokens)

Total: ~1,000 tokens vs. 10,000+ for full context
Savings: 90%
```

---

## Deployment Guide

### Frontend (Already Deployed)
✅ Pushed to GitHub Pages (commit 046e519)
⏳ CDN cache clearing (5-10 minutes)

Files deployed:
- `src/js/modules/memory.js` ✅
- `src/js/modules/voice.js` ✅
- `src/js/modules/panels.js` ✅
- `src/js/modules/index.js` ✅
- `src/css/ai-chat.css` ✅
- `src/pages/index.html` ✅

### Backend (Manual Step Required)

**⚠️ IMPORTANT: You must manually update Google Apps Script**

1. **Open Apps Script Editor:**
   - Go to: https://script.google.com
   - Open project: "Rogue Origin Production Tracking"

2. **Update Code.gs:**
   - Open local file: `apps-script/production-tracking/Code.gs`
   - Copy entire contents
   - Paste into Apps Script editor (replace all)
   - Click "Save" (💾)

3. **Deploy:**
   - Click "Deploy" → "Test deployments"
   - Verify web app URL matches your API_URL
   - No version update needed (using HEAD deployment)

4. **Test:**
   - Open dashboard
   - Send AI message
   - Check for AI_Memory sheet creation

**What gets created automatically:**
- `AI_Memory` sheet (on first message)
- `AI_Tasks` sheet (on first task execution)
- `AI_Chat_Log` sheet (already exists, enhanced)

---

## Testing Guide

### 1. Test Memory System

**Frontend Test:**
```javascript
// Open browser console on dashboard
sessionStorage.getItem('ai_session_id')  // Should return sess_xxxxx
sessionStorage.getItem('ai_conversation_history')  // Should return JSON array
```

**Backend Test:**
1. Send AI message: "What's today's production?"
2. Check Google Sheets → AI_Memory tab
3. Verify row added with:
   - Session ID
   - Timestamp
   - Message text
   - Keywords
   - Entities (JSON)
   - Tier (short)

### 2. Test Task Execution

**Test update_crew_count:**
1. Send message: "Set Line 1 trimmers to 5"
2. AI should respond with task execution
3. Check AI_Tasks sheet for log entry
4. Check production sheet for updated value

**Test log_bag_completion:**
1. Send: "Log a 5kg bag"
2. Check AI_Tasks sheet
3. Verify BagTracker sheet updated

### 3. Test Feedback System

**Frontend Test:**
1. Send any AI message
2. Click 👍 or 👎 button
3. Button should show checkmark briefly
4. Check AI_Chat_Log sheet for rating

### 4. Test Memory Search

**Multi-message test:**
1. Send: "How many trimmers do we have?"
2. Send: "What was the crew count we discussed?"
3. AI should reference the previous message
4. Check console for memory search results

### 5. Test Voice Stubs

```javascript
// Open browser console
window.toggleVoice()  // Should log voice mode toggle
window.isVoiceActive()  // Should return true/false
```

---

## Verification Checklist

### Frontend ✅
- [x] memory.js created and exported
- [x] voice.js created and exported
- [x] panels.js updated with feedback
- [x] index.js imports memory & voice
- [x] ai-chat.css styled feedback buttons
- [x] index.html has feedback UI
- [x] Committed to git
- [x] Pushed to GitHub

### Backend ⏳
- [ ] Code.gs copied to Apps Script
- [ ] Apps Script saved
- [ ] AI_Memory sheet auto-creates
- [ ] AI_Tasks sheet auto-creates
- [ ] Tasks execute successfully
- [ ] Memory search works
- [ ] Feedback logs correctly

### Integration 🔄
- [ ] CDN cache cleared (wait 5-10 min)
- [ ] memory.js loads in browser
- [ ] voice.js loads in browser
- [ ] sessionStorage populates
- [ ] Messages save to AI_Memory
- [ ] AI references past conversations
- [ ] Tasks execute from AI responses
- [ ] Feedback buttons appear and work

---

## Known Issues & Notes

### Current Status (as of commit 8485d57)
1. **Frontend code deployed** ✅ (commits 046e519, 8485d57)
2. **GitHub Pages CDN caching** ⏳ (10-30 min propagation time)
   - Files deployed to origin server with cache-bust (v=4)
   - Multi-layer CDN still serving v=3
   - Confirmed: memory.js, voice.js, updated index.js exist on server
3. **Backend NOT deployed** ⚠️ (manual step required - see below)
4. **Testing blocked** until CDN propagates AND backend deployed

### Expected Behavior After Full Deployment
- First message creates AI_Memory sheet
- Session IDs generated automatically
- AI remembers past conversations
- Tasks execute from natural language
- Feedback tracked per response
- Voice stubs ready for future

### Troubleshooting

**"Module not found" error:**
- Clear browser cache (Ctrl+Shift+Del)
- Hard reload (Ctrl+Shift+R)
- Wait 10 minutes for GitHub Pages CDN

**"AI_Memory sheet not created":**
- Check Code.gs deployed to Apps Script
- Verify ANTHROPIC_API_KEY configured
- Check execution logs in Apps Script

**"Tasks not executing":**
- Verify TASK_REGISTRY present in Code.gs
- Check AI_Tasks sheet permissions
- Review Apps Script execution logs

**"Feedback not logging":**
- Verify AI_Chat_Log sheet exists
- Check browser console for errors
- Confirm action=feedback handler present

---

## Future Enhancements

### Immediate Next Steps
1. Deploy backend to Apps Script
2. Wait for CDN cache clear
3. Full end-to-end testing
4. Monitor AI_Memory growth
5. Tune memory tier lifecycle

### Phase 2 Features
- **Voice Integration**: Implement Web Speech API in voice.js
- **Task Library**: Add more executable tasks
- **Smart Summaries**: Auto-generate conversation summaries
- **Semantic Search**: Upgrade to embedding-based search
- **Multi-user**: Add user authentication and isolation
- **Memory Pruning**: Auto-archive old conversations
- **Task Scheduling**: Defer task execution to specific times

### Optimization Opportunities
- Cache frequently accessed memory
- Batch memory updates
- Compress old tier data
- Implement memory expiration policies
- Add memory export/import

---

## File Reference

### Modified Files
```
apps-script/production-tracking/Code.gs  (+1,100 lines)
src/css/ai-chat.css                      (+30 lines)
src/js/modules/index.js                  (+5 lines)
src/js/modules/panels.js                 (+80 lines)
src/pages/index.html                     (+10 lines)
```

### New Files
```
src/js/modules/memory.js   (108 lines)
src/js/modules/voice.js    (57 lines)
```

### Key Functions (Code.gs)
- `getOrCreateMemorySheet_()` - Line 3040
- `saveToMemory_()` - Line 3121
- `searchMemory_()` - Line 3410
- `extractTasks_()` - Line 3049
- `executeTask_()` - Line 3507
- `validateTaskParams_()` - Line 3442
- `buildSystemPrompt()` - Line 2614 (enhanced)

---

## Support & Resources

**Documentation:**
- Mem0 Concepts: https://mem0.ai/
- LangChain Tools: https://python.langchain.com/docs/modules/agents/tools/

**Google Sheets:**
- Production Tracking: [Your Sheet ID]
- AI_Memory: Auto-created on first use
- AI_Tasks: Auto-created on first task
- AI_Chat_Log: Enhanced existing sheet

**Code Repository:**
- GitHub: https://github.com/RogueFF/rogue-origin-apps
- Last Deploy: commit 046e519
- Deployment: https://rogueff.github.io/rogue-origin-apps/

---

**Implementation Complete:** January 9, 2026
**Version:** 2.0 (Mem0-inspired)
**Token Budget:** 200K (used: ~136K)
**Files Modified:** 7 files, +1,217 lines
