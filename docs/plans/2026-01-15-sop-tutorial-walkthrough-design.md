# SOP Tutorial Walkthrough Design

**Date**: 2026-01-15
**Purpose**: Guide new users through the complete SOP creation process

## Overview

When users click "New SOP", a guided tutorial walks them through every field with:
- Gold highlighted border on current field
- Fixed banner at top with hint text and navigation
- Auto-advance when field is filled, Skip button for optional fields
- Bilingual hints (EN/ES) based on selected language

## Tutorial Steps (12 total)

| Step | Field | Trigger to Advance |
|------|-------|-------------------|
| 1 | Language Toggle | Click EN or ES |
| 2 | Title | Input text |
| 3 | Department | Select option |
| 4 | Doc Number | Input or Skip |
| 5 | Revision | Input or Skip |
| 6 | Status | Select option |
| 7 | Description | Input or Skip |
| 8 | Tags | Add tag or Skip |
| 9 | Add Step Button | Click Add |
| 10 | Step Title | Input text |
| 11 | Step Instructions | Input text |
| 12 | Step Media | Add media or Skip |

## Visual Design

### Tutorial Banner
- Position: Fixed at top of modal body
- Background: `rgba(0,0,0,0.85)`
- Border: `2px solid var(--gold)`
- Contains: Step counter, hint text, Skip/Next buttons, progress bar

### Field Highlight
- Border: `3px solid var(--gold)`
- Box shadow: Gold glow effect
- Auto-scroll into view

### Completion State
- Message: "Tutorial Complete! You're ready to create SOPs."
- Single "Got it" button dismisses banner

## Behavior

- **Always shows**: Tutorial runs every time "New SOP" is clicked
- **Auto-advance**: When user fills required fields
- **Skip button**: For optional fields (Doc Number, Revision, Description, Tags, Media)
- **Language-aware**: Hints display in selected language after step 1
