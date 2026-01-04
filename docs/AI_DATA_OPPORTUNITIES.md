# AI Agent Data Opportunities

> **Last Updated**: January 2, 2026
> **Purpose**: Document what data the AI can access and opportunities for more

---

## Currently Available Data (V2)

### Real-Time Production Data
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Today's tops (lbs) | getScoreboardData() | "How much have we done today?" |
| Today's target | getScoreboardData() | "What's our target?" |
| Current strain | Monthly sheet | "What strain are we working on?" |
| Performance % | Calculated | "Are we on track?" |
| Projected total | Calculated | "How much will we finish with?" |

### Hour-by-Hour Breakdown (NEW V2)
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Tops per hour | Monthly sheet | "How much did we do at 10am?" |
| Smalls per hour | Monthly sheet | "How many smalls this morning?" |
| Trimmers per hour | Monthly sheet | "How many trimmers at 2pm?" |
| Buckers per hour | Monthly sheet | "Did we have buckers at 9am?" |
| Rate per hour | Calculated | "What was our best hour?" |
| Strain per hour | Monthly sheet | "What strain at 11am?" |

### Line 1 vs Line 2 (NEW V2)
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Line 1 tops | Monthly sheet | "How much did Line 1 produce?" |
| Line 2 tops | Monthly sheet | "Is Line 2 running?" |
| Line 1 trimmers | Monthly sheet | "How many on Line 1?" |
| Line 2 trimmers | Monthly sheet | "Split between lines?" |
| Combined totals | Calculated | "Total across both lines?" |

### Crew Data (NEW V2)
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Current trimmers | Monthly sheet | "How many trimmers now?" |
| Current buckers | Monthly sheet | "Any buckers today?" |
| Crew change history | CrewChangeLog | "When did crew change?" |
| Who changed crew | CrewChangeLog | "Who updated the count?" |
| Change details | CrewChangeLog | "What was the change?" |

### Bag Timer Data
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| 5kg bags today | Production Tracking | "How many 5kg bags?" |
| 10lb bags today | Production Tracking | "How many 10lb bags?" |
| Avg cycle time | Calculated | "How long per bag?" |
| Last bag time | Production Tracking | "When was last bag?" |
| Timer paused? | Timer Pause Log | "Is timer paused?" |
| Pause reason | Timer Pause Log | "Why is timer paused?" |

### Break/Pause History (NEW V2)
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Pause times | Timer Pause Log | "When did we take breaks?" |
| Pause reasons | Timer Pause Log | "Why did we pause?" |
| Pause durations | Timer Pause Log | "How long was lunch?" |

### Quality Metrics (NEW V2)
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Tops percentage | Calculated | "What % is tops?" |
| Smalls percentage | Calculated | "How much smalls?" |
| Tops:Smalls ratio | Calculated | "What's the ratio?" |
| Best hour rate | Calculated | "Best performing hour?" |
| Worst hour rate | Calculated | "Slowest hour?" |

### Historical Data
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Last 7 days | Monthly sheets | "How was yesterday?" |
| Last 30 days | Monthly sheets | "Best day this month?" |
| Week over week | Calculated | "Better than last week?" |
| Strain performance | Monthly sheets | "Fastest strain to trim?" |
| Daily strain breakdown | Monthly sheets | "Lifter on Tuesday?" |

### AI Learning
| Data Point | Source | AI Can Answer |
|------------|--------|---------------|
| Saved corrections | AI_Corrections | Applies learned info |
| Chat history | AI_Chat_Log | For review/training |
| Feedback ratings | AI_Chat_Log | Track accuracy |

---

## Data NOT Currently Captured (Opportunities)

### High Value - Should Add

| Data Point | Why Valuable | How to Capture |
|------------|--------------|----------------|
| **Individual worker productivity** | Track top performers, identify training needs | Add worker ID column to hourly sheet |
| **T-Zero machine output** | Understand machine vs hand trim ratio | Already have column - need to use it |
| **Weather data** | Correlate with productivity, plant quality | OpenWeather API (free tier) |
| **Order deadlines** | Answer "will we make the deadline?" | Orders sheet (Phase 2) |
| **Inventory levels** | Answer "how much Lifter do we have?" | Inventory sheet (Phase 3) |

### Medium Value - Nice to Have

| Data Point | Why Valuable | How to Capture |
|------------|--------------|----------------|
| **Wage costs per hour** | Real-time labor cost tracking | Already in sheet - expose to AI |
| **Break timing accuracy** | Compare planned vs actual breaks | Log actual break start/end times |
| **Equipment downtime** | Track T-Zero issues | Add downtime log |
| **Quality grades** | A/B/C grade breakdown | Add grade column |
| **Moisture content** | Track drying quality | Manual entry field |

### Lower Value - Future Consideration

| Data Point | Why Valuable | How to Capture |
|------------|--------------|----------------|
| **Ambient temp/humidity** | Facility conditions | IoT sensors |
| **Worker check-in/out** | Accurate labor hours | Badge system |
| **Customer feedback** | Product quality | Survey system |
| **Supplier lead times** | Material planning | Supplier sheet |

---

## Recommended Next Steps

### Immediate (This Week)

1. **Use T-Zero data already in sheet**
   - Column exists: T-Zero 1, T-Zero 2
   - Add to AI context to track machine usage
   - "How much went through T-Zero today?"

2. **Expose wage/cost data**
   - Already calculated in sheet
   - Add to AI: "What's our labor cost today?"
   - "Cost per lb today?"

### Short-Term (This Month)

3. **Add worker ID tracking**
   - Simple dropdown in hourly sheet
   - Track individual rates over time
   - "Who's our fastest trimmer?"

4. **Weather API integration**
   - Free OpenWeather API
   - Store daily high/low/conditions
   - "How's weather affecting output?"

### Medium-Term (Q1)

5. **Orders integration (Phase 2)**
   - Customer, quantity, deadline
   - "When will Hamburg order be done?"
   - "Are we on track for Friday deadline?"

6. **Inventory tracking (Phase 3)**
   - What's in stock by strain
   - "How much Lifter tops in inventory?"
   - "Do we need to restock smalls?"

---

## Example Questions by Data Source

### Current Capability
```
Production:
- "How are we doing today?"
- "What's our rate right now?"
- "How does this compare to yesterday?"

Crew:
- "How many trimmers do we have?"
- "When did crew change today?"
- "Who updated the crew count?"

Bags:
- "How many bags have we done?"
- "What's our average cycle time?"
- "When was the last bag completed?"

Quality:
- "What percent is tops vs smalls?"
- "What was our best hour?"
- "Which hour was slowest?"

Historical:
- "How did we do last week?"
- "What's our best day this month?"
- "How fast do we trim Lifter?"
```

### With Proposed Additions
```
Costs:
- "What's our labor cost today?"
- "Cost per lb for this strain?"
- "Are we profitable at this rate?"

Machine:
- "How much went through T-Zero?"
- "Machine vs hand trim ratio?"
- "Is the machine running efficiently?"

Weather:
- "How's weather affecting us?"
- "Best production on sunny days?"
- "Correlate rain with slowdowns?"

Orders:
- "When will order #123 be done?"
- "Are we on track for deadline?"
- "How much is left on Hamburg?"

Inventory:
- "How much Lifter in stock?"
- "Do we need to process more?"
- "What strains are low?"
```

---

## Implementation Priority Matrix

| Feature | Value | Effort | Priority |
|---------|-------|--------|----------|
| Expose T-Zero data | High | Low | 1 |
| Expose wage data | High | Low | 1 |
| Weather API | Medium | Medium | 2 |
| Worker ID tracking | High | Medium | 2 |
| Orders integration | High | High | 3 |
| Inventory tracking | High | High | 3 |
| Quality grades | Medium | Low | 4 |
| IoT sensors | Low | High | 5 |

---

## Technical Notes

### Adding New Data to AI

1. **Gather the data** - Create function in Code.gs
2. **Add to context** - Update `gatherProductionContext()`
3. **Add to prompt** - Update `buildSystemPrompt()`
4. **Test** - Run `testAIAgentV2()`
5. **Deploy** - New Apps Script version

### Sheet Structure for New Data

```
Proposed: Worker Performance Tab
| Date | Time Slot | Worker ID | Tops | Smalls | Rate |

Proposed: Weather Tab
| Date | High | Low | Conditions | Humidity | Notes |

Proposed: Equipment Tab
| Date | Time | Equipment | Status | Notes | Duration |
```

---

*This document should be updated as new data sources are added or identified.*
