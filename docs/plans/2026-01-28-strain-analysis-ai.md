# AI Strain Analysis Capabilities

**Date**: 2026-01-28
**Status**: Design Complete
**Priority**: Medium

## Overview

Enable the AI assistant to analyze production data by strain, providing insights on efficiency, costs, and historical trends. Users should be able to ask natural questions like "How's Lifter doing?" or "Show me all our Sour Lifter data" and receive comprehensive analysis.

## Current State

**AI Context Today:**
- Overall production metrics (today's totals, rates, crew)
- Bag timer data (cycle times, completions)
- Historical aggregates (7-day, 30-day totals)
- Order summaries

**Missing:**
- Strain-specific production data
- Strain efficiency comparisons
- Strain labor cost breakdowns
- Historical strain performance

**Manual Workaround:**
Developer can run Playwright tests to analyze strain data, but this isn't accessible to users through the AI chat.

## Proposed Solution: Hybrid Two-Tier System

### Tier 1: Strain Snapshot (Context-Aware)

**What:**
Include top 5 active strains from the last 7 days in the AI's context automatically.

**Why:**
- Enables quick answers without extra API calls
- AI knows what strains are currently being processed
- Fast responses for common questions

**Data Included:**
For each of the top 5 strains:
- Total production (tops + smalls)
- Tops/smalls breakdown
- Average rate (lbs/crew-hour)
- Split labor costs (tops cost/lb, smalls cost/lb)
- Days worked in last 7 days

**Example AI Context Addition:**
```
RECENT STRAIN ACTIVITY (Last 7 Days):
1. 2025 - Lifter / Sungrown: 532.3 lbs (5 days, 0.86 lbs/hr, $47.71/lb tops, $13.89/lb smalls)
2. 2025 - Sour Lifter / Sungrown: 412.1 lbs (4 days, 0.92 lbs/hr, $45.20/lb tops, $12.34/lb smalls)
...
```

### Tier 2: Deep Analysis Tool (On-Demand)

**What:**
Add `analyze_strain` task that AI can call when users ask for detailed strain analysis.

**Why:**
- Flexible: any strain, any time range
- Comprehensive: full historical breakdown
- Only runs when needed (doesn't slow down every chat)

**Parameters:**
- `strain` (required): Strain name to analyze (fuzzy matching, e.g., "Lifter" matches all variants)
- `days` (optional): Number of days to analyze (default 90)

**Returns:**
- Matched strain variants
- Date range analyzed
- Production summary (total lbs, tops/smalls, days worked)
- Efficiency metrics (avg rate, best day, worst day)
- Labor breakdown (trimmer/bucker/tzero/waterspider hours)
- Split cost calculations (tops cost/lb, smalls cost/lb)
- Daily breakdown with rates and costs
- Sample production hours

## Implementation Details

### Backend: Cloudflare Workers (production-d1.js)

#### 1. Add Strain Snapshot to Dashboard Endpoint

**Function:** `getStrainSummary(env, days = 7)`

**SQL Query:**
```sql
SELECT
  cultivar1 as strain,
  SUM(tops_lbs1) as total_tops,
  SUM(smalls_lbs1) as total_smalls,
  SUM(trimmers_line1) as trimmer_hours,
  SUM(buckers_line1) as bucker_hours,
  SUM(tzero_line1) as tzero_hours,
  COUNT(CASE WHEN tops_lbs1 > 0 THEN 1 END) as active_hours,
  COUNT(DISTINCT production_date) as days_worked
FROM monthly_production
WHERE production_date >= date('now', '-' || ? || ' days')
  AND cultivar1 IS NOT NULL
  AND cultivar1 != ''
GROUP BY cultivar1
ORDER BY (total_tops + total_smalls) DESC
LIMIT 5
```

**Processing:**
```javascript
const HOURLY_RATE = 26.22;

rows.map(r => {
  const totalLbs = r.total_tops + r.total_smalls;
  const topsRatio = totalLbs > 0 ? r.total_tops / totalLbs : 0;
  const smallsRatio = 1 - topsRatio;

  const waterspiderHours = r.active_hours;
  const sharedHours = r.bucker_hours + r.tzero_hours + waterspiderHours;

  const topsLaborHours = r.trimmer_hours + (sharedHours * topsRatio);
  const smallsLaborHours = sharedHours * smallsRatio;

  const crewHours = r.trimmer_hours + r.bucker_hours + r.tzero_hours;
  const avgRate = crewHours > 0 ? totalLbs / crewHours : 0;

  return {
    strain: r.strain,
    totalLbs: Math.round(totalLbs * 10) / 10,
    tops: Math.round(r.total_tops * 10) / 10,
    smalls: Math.round(r.total_smalls * 10) / 10,
    avgRate: Math.round(avgRate * 100) / 100,
    topsCostPerLb: r.total_tops > 0 ? (topsLaborHours * HOURLY_RATE) / r.total_tops : 0,
    smallsCostPerLb: r.total_smalls > 0 ? (smallsLaborHours * HOURLY_RATE) / r.total_smalls : 0,
    daysWorked: r.days_worked
  };
});
```

**Add to Dashboard Response:**
```javascript
{
  success: true,
  data: {
    today: { ... },
    daily: [ ... ],
    strainSnapshot: [ /* top 5 strains */ ]
  }
}
```

#### 2. Add Strain Analysis Endpoint

**New Action:** `action=analyzeStrain`

**Function:** `async function analyzeStrain(params, env)`

**Parameters:**
- `strain` (required): Strain name (fuzzy matching via SQL LIKE)
- `days` (optional): Days to analyze (default 90)

**SQL Query:**
```sql
SELECT
  production_date,
  time_slot,
  cultivar1,
  tops_lbs1,
  smalls_lbs1,
  trimmers_line1,
  buckers_line1,
  tzero_line1
FROM monthly_production
WHERE production_date >= date('now', '-' || ? || ' days')
  AND (cultivar1 LIKE '%' || ? || '%' OR cultivar2 LIKE '%' || ? || '%')
  AND (tops_lbs1 > 0 OR smalls_lbs1 > 0)
ORDER BY production_date, time_slot
```

**Processing:**
- Group by date for daily breakdown
- Calculate totals, labor hours, costs
- Find best/worst days
- Format response matching Playwright test structure

**Response Format:**
```javascript
{
  success: true,
  data: {
    strain: "Lifter",
    matchedVariants: ["2023 - Lifter / Sungrown", "2024 - Lifter / Sungrown", "2025 - Lifter / Sungrown"],
    dateRange: {
      start: "2025-12-28",
      end: "2026-01-27",
      days: 31
    },
    summary: {
      totalLbs: 532.3,
      tops: 289.2,
      smalls: 243.1,
      topsPercent: 54.3,
      smallsPercent: 45.7,
      daysWorked: 5,
      productionHours: 38,
      avgRate: 0.86,
      topsCostPerLb: 47.71,
      smallsCostPerLb: 13.89,
      blendedCostPerLb: 32.26,
      totalLaborCost: 17174.10
    },
    labor: {
      trimmerHours: 373,
      buckerHours: 207,
      tzeroHours: 37,
      waterspiderHours: 38,
      totalOperatorHours: 655
    },
    byDate: [
      {
        date: "2025-12-28",
        totalLbs: 163.4,
        tops: 93.4,
        smalls: 70.0,
        hours: 10,
        crewHours: 179,
        rate: 0.91
      },
      // ... more days
    ],
    bestDay: {
      date: "2026-01-19",
      rate: 0.98,
      lbs: 144.4
    },
    worstDay: {
      date: "2026-01-27",
      rate: 0.63,
      lbs: 76.8
    }
  }
}
```

### Frontend: Apps Script (production-tracking/Code.gs)

#### 1. Update `gatherProductionContext()`

**Add after line 3318:**
```javascript
// Get strain snapshot from dashboard
if (dashboardData && dashboardData.strainSnapshot) {
  context.strainSnapshot = dashboardData.strainSnapshot;
}
```

#### 2. Update `buildSystemPrompt()`

**Add to system prompt (after production context):**
```javascript
if (context.strainSnapshot && context.strainSnapshot.length > 0) {
  prompt += 'RECENT STRAIN ACTIVITY (Last 7 Days):\n';
  context.strainSnapshot.forEach(function(s, idx) {
    prompt += (idx + 1) + '. ' + s.strain + ': ' +
              s.totalLbs + ' lbs (' + s.daysWorked + ' days, ' +
              s.avgRate + ' lbs/hr, $' + s.topsCostPerLb.toFixed(2) + '/lb tops, $' +
              s.smallsCostPerLb.toFixed(2) + '/lb smalls)\n';
  });
  prompt += '\n';
}
```

#### 3. Add Task to TASK_REGISTRY

**Add after existing tasks:**
```javascript
analyze_strain: {
  description: 'Analyze production data for a specific strain (efficiency, costs, historical trends)',
  parameters: {
    strain: 'String - Strain name to analyze (e.g., "Lifter", "Sour Lifter"). Fuzzy matching supported.',
    days: 'Number - Optional. Days to analyze (default 90). Use 30 for monthly, 7 for weekly.'
  }
}
```

#### 4. Add Task Executor Function

**Add after existing task executors (around line 4500):**
```javascript
/**
 * Execute analyze_strain task
 */
function executeTask_analyzeStrain(params) {
  if (!params.strain) {
    return { success: false, error: 'Strain name is required' };
  }

  var days = params.days || 90;
  var apiUrl = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
  var url = apiUrl + '?action=analyzeStrain&strain=' + encodeURIComponent(params.strain) + '&days=' + days;

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'GET',
      muteHttpExceptions: true
    });

    var result = JSON.parse(response.getContentText());

    if (!result.success) {
      return { success: false, error: result.error || 'Strain analysis failed' };
    }

    return {
      success: true,
      data: result.data
    };
  } catch (error) {
    return { success: false, error: 'Failed to analyze strain: ' + error.message };
  }
}
```

#### 5. Register Task in `executeTask()`

**Add to switch statement:**
```javascript
case 'analyze_strain':
  return executeTask_analyzeStrain(params);
```

## Data Flow

### Quick Question Flow (Tier 1)
```
User: "How's Lifter doing?"
  ↓
AI loads context (includes strainSnapshot)
  ↓
AI sees: "Lifter: 532.3 lbs (5 days, 0.86 lbs/hr, $47.71/lb tops)"
  ↓
AI responds: "Lifter's been solid this week - 532 lbs over 5 days at 0.86 lbs/hr.
Tops are running $47.71/lb, smalls at $13.89/lb."
```

### Deep Analysis Flow (Tier 2)
```
User: "Show me all our Lifter data from the last 30 days"
  ↓
AI recognizes need for detailed analysis
  ↓
AI calls task: {"task": "analyze_strain", "params": {"strain": "Lifter", "days": 30}}
  ↓
Apps Script → Cloudflare Workers → D1 Database
  ↓
Returns comprehensive analysis
  ↓
AI formats response with HTML data cards:
- Summary stats
- Daily breakdown
- Best/worst days
- Cost analysis
```

## Example AI Interactions

### Example 1: Quick Comparison
```
User: What's our most efficient strain?

AI: Based on the last 7 days, Sour Lifter is leading at 0.92 lbs/hr,
followed by Lifter at 0.86 lbs/hr. Sour Lifter also has lower tops
cost ($45.20/lb vs $47.71/lb).
```
*Uses Tier 1 context only - instant response*

### Example 2: Deep Dive
```
User: Analyze Lifter from the last 90 days

AI: Let me pull the full analysis for you.
```task
{"task": "analyze_strain", "params": {"strain": "Lifter", "days": 90}}
```

[Returns formatted analysis with data cards showing:]
- Total production: 532.3 lbs (289 tops, 243 smalls)
- Efficiency: 0.86 lbs/crew-hour average
- Labor costs: $47.71/lb tops, $13.89/lb smalls
- Best day: Jan 19 (0.98 lbs/hr)
- 5 production days across 3 strain variants
```
*Calls Tier 2 tool - comprehensive response*

### Example 3: Cost Optimization
```
User: Which strain costs us the least per pound?

AI: Looking at recent data, I need to compare all strains. Let me check.
```task
{"task": "analyze_strain", "params": {"strain": "Sour Lifter", "days": 30}}
```

Based on the analysis, Sour Lifter has the best tops cost at $45.20/lb,
beating Lifter's $47.71/lb. The difference comes from better efficiency
(0.92 vs 0.86 lbs/hr).
```
*AI can call tool multiple times to compare strains*

## Implementation Phases

### Phase 1: Tier 1 Snapshot (2-3 hours)
1. Add `getStrainSummary()` function to production-d1.js
2. Include in dashboard endpoint response
3. Update Apps Script context gathering
4. Update system prompt with strain snapshot
5. Test with simple questions

**Testing:**
- "What strains are we processing?"
- "How's Lifter doing?"
- "Which strain is most efficient?"

### Phase 2: Tier 2 Analysis Tool (4-5 hours)
1. Add `analyzeStrain()` function to production-d1.js
2. Add task to TASK_REGISTRY
3. Implement task executor in Apps Script
4. Test with complex questions

**Testing:**
- "Show me all Lifter data"
- "Analyze Sour Lifter from last 30 days"
- "Compare Lifter efficiency over time"

### Phase 3: AI Response Formatting (1-2 hours)
1. Update AI examples in system prompt
2. Add strain-specific response templates
3. Test response quality and formatting

**Testing:**
- Verify HTML data cards render correctly
- Check insights are actionable
- Ensure comparisons are clear

## Technical Considerations

### Performance
- Tier 1 snapshot adds ~100ms to dashboard endpoint (acceptable)
- Tier 2 queries limited to 90 days max (typically <500 rows, fast)
- D1 indexes on `production_date` and `cultivar1` ensure fast queries

### Fuzzy Matching
- SQL `LIKE '%strain%'` matches partial names
- Case-insensitive matching
- Matches all year variants (2023-Lifter, 2024-Lifter, etc.)

### Error Handling
- Strain not found → AI explains and suggests similar strains from snapshot
- No data in range → AI reports and suggests different time range
- API errors → AI gracefully falls back to context data

### Data Accuracy
- Uses same split cost formula as dashboard
- Consistent with existing metrics
- Waterspider hours included (1 per active hour)

## Success Metrics

**After Implementation, AI Should:**
- Answer 90%+ of strain questions without tool calls (Tier 1)
- Provide comprehensive analysis when asked (Tier 2)
- Give insights users can act on (efficiency, costs, trends)
- Match or exceed manual analysis quality

**User Experience:**
- Natural conversation ("How's Lifter?" works)
- Fast responses (<2s for context, <5s for tool calls)
- Actionable insights with numbers
- HTML formatted for readability

## Future Enhancements

### Potential Additions (Not in MVP)
- Strain comparison tool (compare 2+ strains side-by-side)
- Predicted completion time for strain-specific orders
- Strain efficiency trends over months
- Cost optimization recommendations
- Automatic alerts for underperforming strains

### Dependencies
- None (uses existing infrastructure)

### Backwards Compatibility
- Fully backwards compatible
- Existing AI functionality unchanged
- New capabilities are additive

## Files Changed

### New Files
None - all changes to existing files

### Modified Files
1. `workers/src/handlers/production-d1.js`
   - Add `getStrainSummary()` function
   - Add `analyzeStrain()` function
   - Update dashboard endpoint
   - Add new route case

2. `apps-script/production-tracking/Code.gs`
   - Update `gatherProductionContext()`
   - Update `buildSystemPrompt()`
   - Add `executeTask_analyzeStrain()`
   - Update TASK_REGISTRY
   - Update `executeTask()` switch

## Notes

- Strain snapshot shows top 5 strains only (keeps context size manageable)
- Analysis tool supports any strain (not limited to top 5)
- Fuzzy matching allows flexible queries ("lifter" matches "2025 - Lifter / Sungrown")
- Cost calculations use split allocation (trimmers→tops, shared roles→ratio)
- All monetary values assume $26.22/hour labor cost (includes 14% Oregon taxes)
