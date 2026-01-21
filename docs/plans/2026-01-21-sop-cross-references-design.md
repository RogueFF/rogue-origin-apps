# SOP Cross-References Design

**Date**: 2026-01-21
**Status**: Approved
**Feature**: Allow SOPs to reference other SOPs

---

## Overview

Add the ability to link SOPs to each other, both at the header level (prerequisites/related) and within individual steps. References appear as clickable chips that show a quick preview popup.

## Data Model

### Header-level references (new field on SOP object)

```javascript
{
  id: "1768419041470",
  title: "Retail Line",
  // ... existing fields ...

  linkedSops: [
    {
      sopId: "1768419098765",
      label: "Required before",
      label_es: "Requerido antes"
    },
    {
      sopId: "1768419054321",
      label: "See also",
      label_es: "Ver también"
    }
  ]
}
```

### Step-level references (new field on step object)

```javascript
{
  title: "Clean the trimming station",
  description: "Wipe down surfaces...",
  // ... existing fields ...

  refs: [
    {
      sopId: "1768419012345",
      label: "Follow procedure",
      label_es: "Seguir procedimiento"
    }
  ]
}
```

### Preset Labels (Bilingual)

| English | Spanish |
|---------|---------|
| Required before | Requerido antes |
| See also | Ver también |
| Related | Relacionado |
| Follow procedure | Seguir procedimiento |

Custom labels supported via "Other" option (prompts for both EN and ES).

---

## UI Components

### View Mode: Header Section

Below the SOP title/description, a "Linked SOPs" section:

```
┌─────────────────────────────────────────────────────┐
│ Retail Line                             EN | ES    │
│ Production • SOP-001 • Rev 1.0                     │
│ Description text here...                           │
│                                                    │
│ ┌─ Linked SOPs ──────────────────────────────────┐ │
│ │ Required before:                               │ │
│ │    [Machine Cleaning] [Safety Check]           │ │
│ │                                                │ │
│ │ See also:                                      │ │
│ │    [Quality Inspection]                        │ │
│ └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- Grouped by relationship label
- Each reference is a clickable chip/badge
- Tap shows quick preview popup

### View Mode: Quick Preview Popup

```
┌──────────────────────────────────┐
│ Machine Cleaning         SOP-003 │
│ ─────────────────────────────────│
│ Production • 5 steps • Published │
│                                  │
│ Clean and sanitize all trimming  │
│ equipment between batches...     │
│                                  │
│ [Open Full SOP]                  │
└──────────────────────────────────┘
```

- Shows: title, doc number, department, step count, status
- Truncated description (2-3 lines)
- "Open Full SOP" replaces modal content with back button

### Edit Mode: Header Section

Below tags, add "Linked SOPs" section:

```
┌─────────────────────────────────────────────────────┐
│ Tags:  [safety ×] [quality ×]  [+ Add]             │
│                                                    │
│ Linked SOPs:                                       │
│ ┌────────────────────────────────────────────────┐ │
│ │ Required before: [Machine Cleaning ×]          │ │
│ │ See also: [Quality Inspection ×]               │ │
│ │                                                │ │
│ │ [Link SOP]                                     │ │
│ └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Edit Mode: Link SOP Modal

```
┌─────────────── Link SOP ───────────────┐
│                                        │
│ Search: [________________]             │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ○ Machine Cleaning (SOP-003)       │ │
│ │ ○ Safety Check (SOP-007)           │ │
│ │ ○ Quality Inspection (SOP-012)     │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Relationship:                          │
│ [Required before ▼]                    │
│  ├─ Required before                    │
│  ├─ See also                           │
│  ├─ Related                            │
│  ├─ Follow procedure                   │
│  └─ Other: [__________]                │
│                                        │
│ [Cancel]                    [Add Link] │
└────────────────────────────────────────┘
```

### Edit Mode: Step-Level References

```
┌─ Step 3 ─────────────────────────────────────────┐
│ [Title input...                              ]   │
│ [Description textarea...                     ]   │
│                                                  │
│ Refs: [Machine Cleaning ×]  [+]                 │
│                                                  │
│ [Camera] [Video] [Link] [Safety] [Quality] [Del]│
└──────────────────────────────────────────────────┘
```

---

## Interactions

### Preview Popup Behavior

- **Trigger**: Tap/click on any SOP reference chip
- **Position**: Centered on mobile, near chip on desktop
- **Dismiss**: Tap outside, X button, or Escape key
- **"Open Full SOP"**: Replaces modal content, adds back button

### Back Navigation

```
┌─────────────────────────────────────────────────────┐
│ ← Back to "Retail Line"              EN | ES       │
│ ───────────────────────────────────────────────────│
│ Machine Cleaning                                   │
│ ...                                                │
└─────────────────────────────────────────────────────┘
```

- Back button when viewing linked SOP
- Returns to original SOP at same scroll position
- Stack is 1 deep only (no nested back)

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Linked SOP deleted | Show "[Deleted SOP]" in gray, auto-remove on next save |
| Circular references (A→B→A) | Allowed - back button prevents loops |
| Self-reference | Blocked - can't link SOP to itself |
| SOP renamed | References use ID, title updates automatically |

---

## Bilingual Behavior

- Labels show in current view language (EN/ES toggle)
- Preset labels have built-in translations
- Custom labels: store both `label` and `label_es`
- "Other" option prompts for both languages

---

## Implementation Notes

### Files to Modify

- `src/pages/sop-manager.html` - UI components and JavaScript
- `workers/src/handlers/sop-d1.js` - Backend to store/retrieve linkedSops
- `workers/schema.sql` - May need new table for references (or store as JSON)

### Database Options

1. **JSON field** - Store `linkedSops` as JSON in existing `sops` table (simpler)
2. **Separate table** - `sop_references(id, sop_id, linked_sop_id, label, label_es)` (more queryable)

Recommendation: JSON field for simplicity, since we always load full SOP data anyway.
