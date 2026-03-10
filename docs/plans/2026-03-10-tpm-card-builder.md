# TPM Card Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standalone mobile-first TPM T-Card builder where any worker (EN/ES) can create, preview, print, and browse TPM cards using a step-by-step wizard with AI translation.

**Architecture:** New `tpm-builder.html` page with inline CSS/JS (matching existing patterns). D1 database for persistence via new `tpm-d1.js` Cloudflare Worker handler at `/api/tpm`. AI translation via existing Anthropic API integration. Print output matches the T-card template format already built in `tpm-tcards.html`.

**Tech Stack:** Vanilla HTML/CSS/JS, Cloudflare Workers + D1 (SQLite), Anthropic Claude API for translation, CSS print media queries for PDF output.

**Colors:** Daily = `#668971` (RO green), Weekly = `#62758d` (slate blue), Monthly = `#e4aa4f` (RO gold)

---

## Task 1: D1 Schema — Add tpm_cards table

**Files:**
- Modify: `workers/schema.sql` — append new table

**Step 1: Add schema**

Add to end of `workers/schema.sql`:

```sql
-- TPM Cards (T-Card builder)
CREATE TABLE IF NOT EXISTS tpm_cards (
  id TEXT PRIMARY KEY,
  frequency TEXT NOT NULL DEFAULT 'daily',
  title_en TEXT,
  title_es TEXT,
  equipment TEXT NOT NULL,
  shift TEXT,
  desc_en TEXT,
  desc_es TEXT,
  instr_en TEXT,
  instr_es TEXT,
  ppe TEXT DEFAULT '[]',
  hazards TEXT DEFAULT '[]',
  materials_en TEXT,
  materials_es TEXT,
  warning_en TEXT,
  warning_es TEXT,
  status TEXT DEFAULT 'needs_review',
  created_by TEXT,
  reviewed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
```

**Step 2: Apply schema to D1**

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --file=schema.sql
```

**Step 3: Commit**

```bash
git add workers/schema.sql
git commit -m "feat(tpm): add tpm_cards table to D1 schema"
```

---

## Task 2: Cloudflare Worker Handler — tpm-d1.js

**Files:**
- Create: `workers/src/handlers/tpm-d1.js`
- Modify: `workers/src/index.js` — add route

**Step 1: Create handler**

Create `workers/src/handlers/tpm-d1.js` following the exact pattern from `sop-d1.js`:

```javascript
import {
  getAction, parseBody, successResponse,
  createError, insert, update, deleteRows, queryAll, queryOne
} from '../lib/db.js';

// ── GET all cards ──
async function getCards(env) {
  const rows = await queryAll(env.DB, 'SELECT * FROM tpm_cards ORDER BY created_at DESC');
  const cards = rows.map(row => ({
    ...row,
    ppe: JSON.parse(row.ppe || '[]'),
    hazards: JSON.parse(row.hazards || '[]'),
  }));
  return successResponse({ success: true, cards });
}

// ── GET single card ──
async function getCard(body, env) {
  const id = body.id;
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');
  const row = await queryOne(env.DB, 'SELECT * FROM tpm_cards WHERE id = ?', [id]);
  if (!row) throw createError('NOT_FOUND', 'Card not found');
  row.ppe = JSON.parse(row.ppe || '[]');
  row.hazards = JSON.parse(row.hazards || '[]');
  return successResponse({ success: true, card: row });
}

// ── CREATE card ──
async function createCard(body, env) {
  const c = body.card;
  if (!c || !c.equipment) throw createError('VALIDATION_ERROR', 'Equipment is required');
  if (!c.title_en && !c.title_es) throw createError('VALIDATION_ERROR', 'Title is required in at least one language');

  const id = 'TPM-' + Date.now();
  const now = new Date().toISOString();

  await insert(env.DB, 'tpm_cards', {
    id,
    frequency: c.frequency || 'daily',
    title_en: c.title_en || '',
    title_es: c.title_es || '',
    equipment: c.equipment,
    shift: c.shift || '',
    desc_en: c.desc_en || '',
    desc_es: c.desc_es || '',
    instr_en: c.instr_en || '',
    instr_es: c.instr_es || '',
    ppe: JSON.stringify(c.ppe || []),
    hazards: JSON.stringify(c.hazards || []),
    materials_en: c.materials_en || '',
    materials_es: c.materials_es || '',
    warning_en: c.warning_en || '',
    warning_es: c.warning_es || '',
    status: 'needs_review',
    created_by: c.created_by || '',
    created_at: now,
    updated_at: now,
  });

  return successResponse({ success: true, message: 'Card created', id });
}

// ── UPDATE card ──
async function updateCard(body, env) {
  const c = body.card;
  if (!c || !c.id) throw createError('VALIDATION_ERROR', 'Card ID is required');

  const existing = await queryOne(env.DB, 'SELECT id FROM tpm_cards WHERE id = ?', [c.id]);
  if (!existing) throw createError('NOT_FOUND', 'Card not found');

  const now = new Date().toISOString();

  await update(env.DB, 'tpm_cards', {
    frequency: c.frequency || 'daily',
    title_en: c.title_en || '',
    title_es: c.title_es || '',
    equipment: c.equipment || '',
    shift: c.shift || '',
    desc_en: c.desc_en || '',
    desc_es: c.desc_es || '',
    instr_en: c.instr_en || '',
    instr_es: c.instr_es || '',
    ppe: JSON.stringify(c.ppe || []),
    hazards: JSON.stringify(c.hazards || []),
    materials_en: c.materials_en || '',
    materials_es: c.materials_es || '',
    warning_en: c.warning_en || '',
    warning_es: c.warning_es || '',
    status: c.status || 'needs_review',
    reviewed_by: c.reviewed_by || '',
    updated_at: now,
  }, 'id = ?', [c.id]);

  return successResponse({ success: true, message: 'Card updated' });
}

// ── DELETE card ──
async function deleteCard(body, env) {
  const id = body.id;
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');
  const changes = await deleteRows(env.DB, 'tpm_cards', 'id = ?', [id]);
  if (changes === 0) throw createError('NOT_FOUND', 'Card not found');
  return successResponse({ success: true, message: 'Card deleted' });
}

// ── APPROVE card ──
async function approveCard(body, env) {
  const id = body.id;
  const reviewer = body.reviewed_by || '';
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');

  const now = new Date().toISOString();
  await update(env.DB, 'tpm_cards', {
    status: 'approved',
    reviewed_by: reviewer,
    updated_at: now,
  }, 'id = ?', [id]);

  return successResponse({ success: true, message: 'Card approved' });
}

// ── TRANSLATE via Anthropic ──
async function translateCard(body, env) {
  const { text, from, to } = body;
  if (!text || !from || !to) throw createError('VALIDATION_ERROR', 'text, from, and to are required');

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw createError('CONFIG_ERROR', 'ANTHROPIC_API_KEY not set');

  const langNames = { en: 'English', es: 'Spanish' };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Translate the following ${langNames[from]} text to ${langNames[to]}. This is for a TPM (Total Productive Maintenance) card used in a hemp processing facility. Keep it concise, clear, and appropriate for floor workers. Return ONLY the translated text, nothing else.\n\n${text}`
      }]
    })
  });

  const result = await response.json();
  const translated = result.content?.[0]?.text || '';
  return successResponse({ success: true, translated });
}

// ── GET unique equipment list ──
async function getEquipment(env) {
  const rows = await queryAll(env.DB, 'SELECT DISTINCT equipment FROM tpm_cards ORDER BY equipment');
  const equipment = rows.map(r => r.equipment);
  return successResponse({ success: true, equipment });
}

// ── Router ──
export async function handleTpmD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    getCards: () => getCards(env),
    getCard: () => getCard(body, env),
    getEquipment: () => getEquipment(env),
    createCard: () => createCard(body, env),
    updateCard: () => updateCard(body, env),
    deleteCard: () => deleteCard(body, env),
    approveCard: () => approveCard(body, env),
    translate: () => translateCard(body, env),
    test: () => successResponse({ success: true, message: 'TPM API OK' }),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
```

**Step 2: Register route in index.js**

In `workers/src/index.js`, add import at top with other imports:
```javascript
import { handleTpmD1 } from './handlers/tpm-d1.js';
```

Add route in the `if/else if` chain (before the health check `else`):
```javascript
} else if (path.startsWith('/api/tpm')) {
  response = await handleTpmD1(request, env, ctx);
```

Add `/api/tpm` to the endpoints array in the health check response.

**Step 3: Deploy**

```bash
cd workers
npx wrangler deploy
```

**Step 4: Test**

```bash
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/tpm?action=test"
```

Expected: `{"success":true,"message":"TPM API OK"}`

**Step 5: Commit**

```bash
git add workers/src/handlers/tpm-d1.js workers/src/index.js
git commit -m "feat(tpm): add TPM card API handler with CRUD, translate, approve"
```

---

## Task 3: HTML Page Shell — tpm-builder.html

**Files:**
- Create: `src/pages/tpm-builder.html`

Build the page shell with: meta viewport, font imports (Outfit, DM Serif Display, JetBrains Mono), shared-base.css link, inline `<style>` block, and script skeleton.

**Key HTML structure:**

```
body
  #app
    #startScreen        — language toggle, Create button, card list
    #wizardScreen       — step-by-step card creation (hidden initially)
    #previewScreen      — front/back T-card preview (hidden initially)
    #viewCardScreen     — single card view from browse (hidden initially)
  #printPages           — hidden, for print output only
```

**CSS approach:**
- Mobile-first (base styles = phone)
- `@media (min-width: 768px)` for tablet
- `@media (min-width: 1024px)` for desktop
- 56px minimum touch targets (glove-friendly)
- `env(safe-area-inset-*)` for notched devices
- Frequency colors as CSS classes: `.freq-daily`, `.freq-weekly`, `.freq-monthly`

**Step 1: Create the file with full HTML shell, CSS, and empty JS functions**

The page should include:
- Sticky header with RO logo, title "TPM Cards" (bilingual), and language toggle button
- All screen divs with proper structure
- Wizard with progress bar (6 steps)
- Print container matching tpm-tcards.html format
- All CSS for mobile-first layout
- Translation object skeleton
- Navigation functions (showScreen, nextStep, prevStep)

**Step 2: Verify it loads**

Open `http://localhost:8080/tpm-builder.html` — should show the start screen with language toggle and empty card list.

**Step 3: Commit**

```bash
git add src/pages/tpm-builder.html
git commit -m "feat(tpm): add TPM card builder page shell"
```

---

## Task 4: Browse Screen — Card List with Filters

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Implement card list loading**

On page load, fetch cards from API:
```javascript
const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/tpm';

async function loadCards() {
  const res = await fetch(API_URL + '?action=getCards');
  const data = await res.json();
  allCards = data.cards || [];
  renderCardList();
}
```

**Step 2: Implement filter chips**

Filter chips: All | Daily | Weekly | Monthly | Needs Review
- Chips are scrollable horizontally on mobile
- Active chip gets frequency color background
- Filtering is instant (client-side)

**Step 3: Implement card row rendering**

Each card row shows:
- Left color bar (4px, frequency color)
- Title (in current language, falls back to other language)
- Equipment name
- Frequency badge (colored pill)
- Status badge ("Needs Review" orange, "Approved" green)
- Tap → opens view screen

**Step 4: Commit**

```bash
git commit -am "feat(tpm): add browse screen with card list and filters"
```

---

## Task 5: Wizard — Steps 1-3 (Frequency, Title/Equipment, Description)

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Wizard navigation**

- Progress bar at top: 6 dots, current dot filled with frequency color
- Back button (left arrow) and step label
- `currentStep` state variable, `nextStep()` / `prevStep()` functions
- Swipe gesture support (optional, touch events)

**Step 2: Step 1 — Frequency picker**

Three large cards (full width on mobile, side by side on tablet):
- Green card with icon: "Daily / Diario"
- Blue card: "Weekly / Semanal"
- Gold card: "Monthly / Mensual"
- Tapping sets `cardData.frequency` and calls `nextStep()`

**Step 3: Step 2 — Title & Equipment**

- Equipment: `<input>` with `<datalist>` populated from `getEquipment` API call (auto-suggest from existing cards)
- Shift: text input
- Title: textarea in current language
- "Translate" button → calls `/api/tpm?action=translate`, fills other language field
- Both language fields visible (primary language field larger, secondary smaller with label)

**Step 4: Step 3 — Description & Instruction**

- Description textarea (current language primary, other below)
- Instruction textarea (same layout)
- Translate button per field
- Character guidance: "Keep it concise for the card format"

**Step 5: Commit**

```bash
git commit -am "feat(tpm): add wizard steps 1-3 (frequency, title, description)"
```

---

## Task 6: Wizard — Steps 4-6 (PPE/Hazards, Materials, Preview)

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Step 4 — PPE & Hazards checkboxes**

PPE grid (2 columns, 56px rows):
- Goggles, Gloves, Face Shield, Apron, Add. Hearing, Other
- Each is a large checkbox with label (bilingual)

Hazards grid (2 columns):
- Fire, Slip/Trip, Shock, Pinch Point, Ergo, Hand Safety, Eye Safety, Laceration, Other, Head Safety
- Same large checkbox pattern

Store as arrays: `cardData.ppe = ['Gloves', 'Goggles']`

**Step 2: Step 5 — Materials & Warning**

- Materials textarea + translate button
- Warning textarea (optional) + translate button
- Live preview of warning bar styling below the warning input
- Helper text: "Leave blank if no specific warning needed"

**Step 3: Step 6 — Preview & Save**

- Render full T-card preview (front + back) using the same `buildFront()` / `buildBack()` functions from tpm-tcards.html
- Tab toggle: "Front" / "Back" (or swipe on mobile)
- Card rendered at actual proportions (3.86" wide scaled to fit screen)
- Three action buttons at bottom:
  - "Save & Print" (primary) → saves to D1, then triggers print
  - "Save" → saves to D1, returns to browse
  - "Back to Edit" → goes back to step 5

**Step 4: Implement save function**

```javascript
async function saveCard() {
  const res = await fetch(API_URL + '?action=createCard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardData })
  });
  const data = await res.json();
  if (data.success) {
    showToast(t('cardSaved'));
    showScreen('start');
    loadCards();
  }
}
```

**Step 5: Commit**

```bash
git commit -am "feat(tpm): add wizard steps 4-6 (PPE, materials, preview/save)"
```

---

## Task 7: Print Output — T-Card Format

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Implement print rendering**

Reuse the exact T-card template CSS from `tpm-tcards.html`:
- `@page { size: letter portrait; margin: 0.5in; }`
- 3.86" wide card centered, 9.3" tall
- Frequency color on header bars (daily=green, weekly=blue, monthly=gold)
- All sections: header, component, equip/shift, description, instruction, warning, yellow tag, footer
- Back: PPE grid, hazards grid, materials box
- `print-color-adjust: exact` on all colored elements

**Step 2: Print function**

```javascript
function printCard(card) {
  renderPrintCard(card);  // Builds front + back in #printPages
  window.print();
}
```

**Step 3: Commit**

```bash
git commit -am "feat(tpm): add T-card print output matching template format"
```

---

## Task 8: View/Edit/Approve — Card Detail Screen

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: View card screen**

When tapping a card from browse:
- Show full T-card preview (front/back tabs)
- Action buttons: Edit, Duplicate, Print, Approve (if needs_review)

**Step 2: Edit flow**

- "Edit" loads card data into wizard at step 2 (skip frequency, it's set)
- Save calls `updateCard` instead of `createCard`
- Uses same wizard UI

**Step 3: Duplicate flow**

- "Duplicate" copies card data, clears ID, opens wizard at step 2
- Save creates new card

**Step 4: Approve flow**

- "Approve" button calls `/api/tpm?action=approveCard`
- Prompts for reviewer name (simple text input)
- Updates badge to "Approved" immediately

**Step 5: Commit**

```bash
git commit -am "feat(tpm): add view, edit, duplicate, approve card flows"
```

---

## Task 9: Bilingual Translation System

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Full translations object**

Add complete EN/ES translations for all UI strings:
- Navigation: back, next, save, cancel, print, edit, duplicate, approve
- Wizard labels: frequency names, field labels, helper text, button labels
- Browse: filter names, status labels, empty state messages
- PPE names: all 6 items in both languages
- Hazard names: all 10 items in both languages
- Toast messages: saved, deleted, approved, error states

**Step 2: Language toggle**

- Prominent toggle button in header (matches SOP manager pattern)
- `appLang` variable, `toggleLang()` function
- `applyTranslations()` using `data-i18n` attributes
- Card content shows in current language (falls back to other if empty)

**Step 3: AI translate integration**

- "Translate" button on each text field
- Shows spinner while translating
- Fills the other language field
- Worker can edit the result
- Uses `/api/tpm?action=translate` endpoint

**Step 4: Commit**

```bash
git commit -am "feat(tpm): add full EN/ES bilingual support with AI translation"
```

---

## Task 10: Mobile Polish & Final Testing

**Files:**
- Modify: `src/pages/tpm-builder.html`

**Step 1: Mobile touch refinements**

- All buttons/checkboxes 56px minimum (glove operation)
- Input font-size 16px minimum (prevent iOS zoom)
- Safe area insets for notched devices
- Smooth transitions between wizard steps
- Scroll to top on step change
- Prevent double-tap zoom on buttons

**Step 2: Tablet layout (768px+)**

- Wizard content max-width 600px centered
- Browse list shows 2-column grid
- PPE/hazard grids stay 2-column but with more padding

**Step 3: Desktop layout (1024px+)**

- Split view: browse list on left, preview on right
- Wizard max-width 700px centered
- Card preview shows at actual print scale

**Step 4: Test all flows**

- Create card in Spanish → translate to English → save → verify in D1
- Browse → filter by frequency → tap card → approve
- Edit existing card → save → verify changes
- Duplicate card → modify → save as new
- Print card → verify T-card format matches tpm-tcards.html output
- Test on phone, tablet, desktop viewports

**Step 5: Commit**

```bash
git commit -am "feat(tpm): mobile/tablet/desktop polish and final testing"
```

---

## Task 11: Add Link to Ops Hub

**Files:**
- Modify: `src/pages/index.html` — add TPM Builder card to dashboard

**Step 1: Add dashboard card**

Add a new card in the tools/apps section linking to `tpm-builder.html`:
- Icon: wrench or clipboard
- Title: "TPM Cards" / "Tarjetas TPM"
- Subtitle: "Create & print T-cards" / "Crear e imprimir tarjetas T"

**Step 2: Commit**

```bash
git commit -am "feat(tpm): add TPM Card Builder link to ops hub dashboard"
```
