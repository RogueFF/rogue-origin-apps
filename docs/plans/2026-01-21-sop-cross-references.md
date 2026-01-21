# SOP Cross-References Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow SOPs to reference other SOPs with clickable previews and custom relationship labels.

**Architecture:** Store `linkedSops` as JSON on the SOP object and `refs` as JSON array within each step. Frontend renders clickable chips that show preview popups. Back navigation uses a stack variable.

**Tech Stack:** HTML/CSS/JS (no build), Cloudflare D1 (SQLite), existing modal patterns

---

## Task 1: Add Database Column

**Files:**
- Modify: `workers/schema.sql:43-57`

**Step 1: Add the linked_sops column to schema**

Add after line 54 (`steps TEXT,`):

```sql
  linked_sops TEXT,
```

**Step 2: Run migration on D1**

```bash
cd workers
npx wrangler d1 execute rogue-origin-db --remote --command "ALTER TABLE sops ADD COLUMN linked_sops TEXT;"
```

Expected: Success message

**Step 3: Commit**

```bash
git add workers/schema.sql
git commit -m "feat(sop): add linked_sops column to schema"
```

---

## Task 2: Update Backend - Create/Update SOP

**Files:**
- Modify: `workers/src/handlers/sop-d1.js:122-136` (createSOP)
- Modify: `workers/src/handlers/sop-d1.js:158-175` (updateSOP)

**Step 1: Update createSOP to include linked_sops**

In `createSOP` function, add after `steps: JSON.stringify(sop.steps || []),`:

```javascript
    linked_sops: JSON.stringify(sop.linkedSops || []),
```

**Step 2: Update updateSOP to include linked_sops**

In `updateSOP` function, add to the update object:

```javascript
    linked_sops: JSON.stringify(sop.linkedSops || []),
```

**Step 3: Verify existing read functions return linked_sops**

Check that `getSOPs` and `getSOP` already return all columns (they use `SELECT *`).

**Step 4: Test locally**

```bash
cd workers
npx wrangler dev
```

Test with curl:
```bash
curl "http://localhost:8787/api/sop?action=getSOPs"
```

Expected: SOPs returned with `linked_sops` field (null for existing)

**Step 5: Deploy and commit**

```bash
npx wrangler deploy
git add workers/src/handlers/sop-d1.js
git commit -m "feat(sop): store linkedSops in backend"
```

---

## Task 3: Add Preset Labels Constant

**Files:**
- Modify: `src/pages/sop-manager.html` (add after translations object ~line 720)

**Step 1: Add LINK_LABELS constant**

Add after the `translations` object closing brace:

```javascript
    // SOP link relationship labels (bilingual)
    const LINK_LABELS = [
      { en: 'Required before', es: 'Requerido antes' },
      { en: 'See also', es: 'Ver también' },
      { en: 'Related', es: 'Relacionado' },
      { en: 'Follow procedure', es: 'Seguir procedimiento' }
    ];
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add bilingual link label presets"
```

---

## Task 4: Add Link SOP Modal HTML

**Files:**
- Modify: `src/pages/sop-manager.html` (add after QR Modal ~line 230)

**Step 1: Add the modal HTML**

Add after the QR Modal closing `</div>`:

```html
  <!-- Link SOP Modal -->
  <div class="modal" id="linkSopModal">
    <div class="modal-box small">
      <div class="modal-header">
        <h2><i class="ph-duotone ph-link"></i> <span data-i18n="linkSop">Link SOP</span></h2>
        <button class="modal-close" onclick="closeLinkSopModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" data-i18n="searchSops">Search SOPs</label>
          <input type="text" id="linkSopSearch" class="form-input" placeholder="Search..." oninput="filterLinkSops()">
        </div>
        <div id="linkSopList" class="link-sop-list"></div>
        <div class="form-group" style="margin-top:16px;">
          <label class="form-label" data-i18n="relationship">Relationship</label>
          <select id="linkLabelSelect" class="form-input" onchange="toggleCustomLabel()">
            <option value="Required before">Required before</option>
            <option value="See also">See also</option>
            <option value="Related">Related</option>
            <option value="Follow procedure">Follow procedure</option>
            <option value="__custom__">Other...</option>
          </select>
        </div>
        <div id="customLabelGroup" class="form-group" style="display:none;margin-top:8px;">
          <input type="text" id="customLabelEn" class="form-input" placeholder="Label (English)" style="margin-bottom:6px;">
          <input type="text" id="customLabelEs" class="form-input" placeholder="Label (Español)">
        </div>
      </div>
      <div class="modal-footer">
        <button class="header-btn" onclick="closeLinkSopModal()" data-i18n="cancel">Cancel</button>
        <button class="header-btn primary" onclick="confirmLinkSop()" data-i18n="addLink">Add Link</button>
      </div>
    </div>
  </div>

  <!-- SOP Preview Popup -->
  <div id="sopPreviewPopup" class="sop-preview-popup" style="display:none;">
    <div class="sop-preview-header">
      <span id="previewTitle"></span>
      <span id="previewDocNum"></span>
    </div>
    <div class="sop-preview-meta" id="previewMeta"></div>
    <div class="sop-preview-desc" id="previewDesc"></div>
    <button class="sop-preview-open" onclick="openPreviewedSop()">Open Full SOP</button>
    <button class="sop-preview-close" onclick="closePreviewPopup()">&times;</button>
  </div>
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add link modal and preview popup HTML"
```

---

## Task 5: Add CSS Styles

**Files:**
- Modify: `src/pages/sop-manager.html` (add to `<style>` section)

**Step 1: Add styles for link features**

Add before closing `</style>` tag:

```css
/* SOP Link Chips */
.sop-link-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-tertiary, #f0f0f0);
  border: 1px solid var(--border, #ddd);
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.sop-link-chip:hover {
  background: var(--ro-green);
  color: white;
  border-color: var(--ro-green);
}
.sop-link-chip i { font-size: 14px; }
.sop-link-chip .remove-link {
  margin-left: 4px;
  opacity: 0.6;
}
.sop-link-chip .remove-link:hover { opacity: 1; }

/* Linked SOPs Section */
.linked-sops-section {
  margin-top: 16px;
  padding: 12px;
  background: var(--bg-secondary, #fafafa);
  border-radius: 8px;
}
.linked-sops-group {
  margin-bottom: 10px;
}
.linked-sops-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.linked-sops-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Link SOP List in Modal */
.link-sop-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
}
.link-sop-item {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border, #eee);
}
.link-sop-item:last-child { border-bottom: none; }
.link-sop-item:hover { background: var(--bg-hover, #f5f5f5); }
.link-sop-item.selected { background: var(--ro-green-light, #e8f5e9); }
.link-sop-item input[type="radio"] { margin: 0; }
.link-sop-item-title { font-weight: 500; }
.link-sop-item-meta { font-size: 12px; color: var(--text-muted); }

/* Preview Popup */
.sop-preview-popup {
  position: fixed;
  z-index: 10001;
  background: white;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  padding: 16px;
  width: 300px;
  max-width: 90vw;
}
.sop-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.sop-preview-header #previewTitle {
  font-weight: 600;
  font-size: 15px;
}
.sop-preview-header #previewDocNum {
  font-size: 12px;
  color: var(--text-muted);
}
.sop-preview-meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.sop-preview-desc {
  font-size: 13px;
  line-height: 1.4;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sop-preview-open {
  width: 100%;
  padding: 8px;
  background: var(--ro-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}
.sop-preview-open:hover { background: var(--ro-green-dark); }
.sop-preview-close {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-muted);
}

/* Back button in view modal */
.view-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 12px;
}
.view-back-btn:hover { background: var(--bg-hover); }

/* Step refs display */
.step-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.step-ref-chip {
  font-size: 11px;
  padding: 2px 8px;
}
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add CSS styles for link chips and preview popup"
```

---

## Task 6: Add State Variables

**Files:**
- Modify: `src/pages/sop-manager.html` (add after existing state variables ~line 520)

**Step 1: Add link-related state variables**

Add after `let viewLang = 'en';`:

```javascript
    // SOP linking state
    let editingLinkedSops = [];        // Header-level links being edited
    let linkingContext = null;         // 'header' or step index
    let selectedLinkSopId = null;      // Selected SOP in link modal
    let sopViewStack = [];             // For back navigation
    let previewingSopId = null;        // Currently previewed SOP
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add state variables for SOP linking"
```

---

## Task 7: Add Link Modal Functions

**Files:**
- Modify: `src/pages/sop-manager.html` (add after modal management functions ~line 1980)

**Step 1: Add link modal functions**

```javascript
    // =====================================================
    // SOP Linking Functions
    // =====================================================

    function openLinkSopModal(context) {
      // context: 'header' or step index (number)
      linkingContext = context;
      selectedLinkSopId = null;
      document.getElementById('linkSopSearch').value = '';
      document.getElementById('linkLabelSelect').value = 'Required before';
      document.getElementById('customLabelGroup').style.display = 'none';
      renderLinkSopList();
      openModal('linkSopModal');
    }

    function closeLinkSopModal() {
      closeModal('linkSopModal');
      linkingContext = null;
      selectedLinkSopId = null;
    }

    function filterLinkSops() {
      renderLinkSopList();
    }

    function renderLinkSopList() {
      const search = document.getElementById('linkSopSearch').value.toLowerCase();
      const list = document.getElementById('linkSopList');

      // Filter out current SOP and already linked SOPs
      const alreadyLinked = linkingContext === 'header'
        ? editingLinkedSops.map(l => l.sopId)
        : (editingSteps[linkingContext]?.refs || []).map(r => r.sopId);

      const available = sops.filter(s =>
        s.id != currentSopId &&
        !alreadyLinked.includes(s.id) &&
        (s.title.toLowerCase().includes(search) || (s.docNum || '').toLowerCase().includes(search))
      );

      if (available.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No SOPs available</div>';
        return;
      }

      list.innerHTML = available.map(s =>
        '<label class="link-sop-item' + (selectedLinkSopId == s.id ? ' selected' : '') + '">' +
          '<input type="radio" name="linkSop" value="' + s.id + '" onchange="selectLinkSop(\'' + s.id + '\')"' + (selectedLinkSopId == s.id ? ' checked' : '') + '>' +
          '<div>' +
            '<div class="link-sop-item-title">' + esc(s.title) + '</div>' +
            '<div class="link-sop-item-meta">' + (s.docNum || 'No ID') + ' • ' + s.dept + ' • ' + (s.steps?.length || 0) + ' steps</div>' +
          '</div>' +
        '</label>'
      ).join('');
    }

    function selectLinkSop(id) {
      selectedLinkSopId = id;
      renderLinkSopList();
    }

    function toggleCustomLabel() {
      const select = document.getElementById('linkLabelSelect');
      const customGroup = document.getElementById('customLabelGroup');
      customGroup.style.display = select.value === '__custom__' ? 'block' : 'none';
    }

    function confirmLinkSop() {
      if (!selectedLinkSopId) {
        showToast('Select an SOP', 'error');
        return;
      }

      const select = document.getElementById('linkLabelSelect');
      let labelEn, labelEs;

      if (select.value === '__custom__') {
        labelEn = document.getElementById('customLabelEn').value.trim();
        labelEs = document.getElementById('customLabelEs').value.trim();
        if (!labelEn) {
          showToast('Enter English label', 'error');
          return;
        }
        if (!labelEs) labelEs = labelEn; // Fallback
      } else {
        const preset = LINK_LABELS.find(l => l.en === select.value);
        labelEn = preset.en;
        labelEs = preset.es;
      }

      const link = { sopId: selectedLinkSopId, label: labelEn, label_es: labelEs };

      if (linkingContext === 'header') {
        editingLinkedSops.push(link);
        renderEditLinkedSops();
      } else {
        // Step-level link
        if (!editingSteps[linkingContext].refs) {
          editingSteps[linkingContext].refs = [];
        }
        editingSteps[linkingContext].refs.push(link);
        renderSteps();
      }

      closeLinkSopModal();
    }

    function removeLinkedSop(index) {
      editingLinkedSops.splice(index, 1);
      renderEditLinkedSops();
    }

    function removeStepRef(stepIndex, refIndex) {
      editingSteps[stepIndex].refs.splice(refIndex, 1);
      renderSteps();
    }

    function getSopById(id) {
      return sops.find(s => s.id == id);
    }
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add link modal functions"
```

---

## Task 8: Add Preview Popup Functions

**Files:**
- Modify: `src/pages/sop-manager.html` (add after link modal functions)

**Step 1: Add preview popup functions**

```javascript
    // =====================================================
    // SOP Preview Popup Functions
    // =====================================================

    function showSopPreview(sopId, event) {
      event.stopPropagation();
      const s = getSopById(sopId);
      if (!s) return;

      previewingSopId = sopId;
      const lang = viewLang;

      document.getElementById('previewTitle').textContent = s['title_' + lang] || s.title;
      document.getElementById('previewDocNum').textContent = s.docNum || '';
      document.getElementById('previewMeta').textContent = s.dept + ' • ' + (s.steps?.length || 0) + ' steps • ' + (s.status || 'draft');
      document.getElementById('previewDesc').textContent = s['desc_' + lang] || s.description || 'No description';

      const popup = document.getElementById('sopPreviewPopup');
      popup.style.display = 'block';

      // Position popup
      const rect = event.target.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();

      // Center on mobile, near element on desktop
      if (window.innerWidth < 600) {
        popup.style.left = '50%';
        popup.style.top = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
      } else {
        popup.style.left = Math.min(rect.left, window.innerWidth - popupRect.width - 20) + 'px';
        popup.style.top = (rect.bottom + 10) + 'px';
        popup.style.transform = 'none';
      }
    }

    function closePreviewPopup() {
      document.getElementById('sopPreviewPopup').style.display = 'none';
      previewingSopId = null;
    }

    function openPreviewedSop() {
      if (!previewingSopId) return;
      closePreviewPopup();

      // Save current SOP to stack for back navigation
      if (currentSopId) {
        sopViewStack.push({
          sopId: currentSopId,
          scrollTop: document.getElementById('viewModalBody')?.scrollTop || 0
        });
      }

      // Open the previewed SOP
      const s = getSopById(previewingSopId);
      if (s) {
        currentSopId = previewingSopId;
        renderViewSOP(s);
      }
    }

    function goBackSop() {
      if (sopViewStack.length === 0) return;

      const prev = sopViewStack.pop();
      const s = getSopById(prev.sopId);
      if (s) {
        currentSopId = prev.sopId;
        renderViewSOP(s);
        // Restore scroll position
        setTimeout(() => {
          const body = document.getElementById('viewModalBody');
          if (body) body.scrollTop = prev.scrollTop;
        }, 50);
      }
    }

    // Close preview on click outside
    document.addEventListener('click', function(e) {
      const popup = document.getElementById('sopPreviewPopup');
      if (popup && popup.style.display === 'block' && !popup.contains(e.target) && !e.target.closest('.sop-link-chip')) {
        closePreviewPopup();
      }
    });
```

**Step 2: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add preview popup and back navigation functions"
```

---

## Task 9: Add Edit Mode UI for Header Links

**Files:**
- Modify: `src/pages/sop-manager.html` (add HTML after tags section ~line 165)
- Modify: `src/pages/sop-manager.html` (add renderEditLinkedSops function)

**Step 1: Add HTML for linked SOPs edit section**

Add after the tags form-group (after line ~165):

```html
          <div class="form-group">
            <label class="form-label">Linked SOPs</label>
            <div id="editLinkedSopsList" class="linked-sops-section"></div>
            <button type="button" class="header-btn" onclick="openLinkSopModal('header')" style="margin-top:8px;">
              <i class="ph-duotone ph-link"></i> Link SOP
            </button>
          </div>
```

**Step 2: Add renderEditLinkedSops function**

Add after the renderEditTags function:

```javascript
    function renderEditLinkedSops() {
      const container = document.getElementById('editLinkedSopsList');
      if (!container) return;

      if (editingLinkedSops.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No linked SOPs</div>';
        return;
      }

      // Group by label
      const groups = {};
      editingLinkedSops.forEach((link, i) => {
        const label = appLang === 'es' ? (link.label_es || link.label) : link.label;
        if (!groups[label]) groups[label] = [];
        groups[label].push({ ...link, index: i });
      });

      container.innerHTML = Object.entries(groups).map(([label, links]) =>
        '<div class="linked-sops-group">' +
          '<div class="linked-sops-label">' + esc(label) + ':</div>' +
          '<div class="linked-sops-chips">' +
            links.map(link => {
              const s = getSopById(link.sopId);
              const title = s ? (s['title_' + appLang] || s.title) : '[Deleted SOP]';
              return '<span class="sop-link-chip">' +
                '<i class="ph-duotone ph-file-text"></i> ' + esc(title) +
                ' <span class="remove-link" onclick="removeLinkedSop(' + link.index + ')">&times;</span>' +
              '</span>';
            }).join('') +
          '</div>' +
        '</div>'
      ).join('');
    }
```

**Step 3: Update openCreateModal to initialize editingLinkedSops**

In `openCreateModal` function, add:

```javascript
      editingLinkedSops = [];
      renderEditLinkedSops();
```

**Step 4: Update editSOP to load existing linkedSops**

In `editSOP` function, add:

```javascript
      editingLinkedSops = s.linkedSops || [];
      renderEditLinkedSops();
```

**Step 5: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add edit mode UI for header-level links"
```

---

## Task 10: Update saveSOP to Include linkedSops

**Files:**
- Modify: `src/pages/sop-manager.html` (update saveSOP function ~line 1634)

**Step 1: Add linkedSops to sopData**

After `tags: getSelectedTags(),` add:

```javascript
        linkedSops: editingLinkedSops,
```

**Step 2: Add refs to steps mapping**

In the steps mapping, add after `quality: s.quality || false`:

```javascript
          refs: s.refs || []
```

**Step 3: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): save linkedSops and step refs to backend"
```

---

## Task 11: Update View Mode to Show Links

**Files:**
- Modify: `src/pages/sop-manager.html` (update renderViewSOP function ~line 2105)

**Step 1: Add linked SOPs section to view**

In `renderViewSOP`, after the description paragraph and before `stepsHtml`, add:

```javascript
      // Render linked SOPs section
      let linkedHtml = '';
      if (s.linkedSops && s.linkedSops.length > 0) {
        const groups = {};
        s.linkedSops.forEach(link => {
          const label = lang === 'es' ? (link.label_es || link.label) : link.label;
          if (!groups[label]) groups[label] = [];
          groups[label].push(link);
        });

        linkedHtml = '<div class="linked-sops-section" style="margin-top:16px;">' +
          Object.entries(groups).map(([label, links]) =>
            '<div class="linked-sops-group">' +
              '<div class="linked-sops-label"><i class="ph-duotone ph-link"></i> ' + esc(label) + ':</div>' +
              '<div class="linked-sops-chips">' +
                links.map(link => {
                  const linked = getSopById(link.sopId);
                  if (!linked) return '<span class="sop-link-chip" style="opacity:0.5;">[Deleted SOP]</span>';
                  const linkTitle = linked['title_' + lang] || linked.title;
                  return '<span class="sop-link-chip" onclick="showSopPreview(\'' + link.sopId + '\', event)">' +
                    '<i class="ph-duotone ph-file-text"></i> ' + esc(linkTitle) +
                  '</span>';
                }).join('') +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>';
      }

      // Back button if we came from another SOP
      const backBtn = sopViewStack.length > 0
        ? '<button class="view-back-btn" onclick="goBackSop()"><i class="ph-duotone ph-arrow-left"></i> Back to "' + esc(getSopById(sopViewStack[sopViewStack.length-1].sopId)?.title || 'Previous') + '"</button>'
        : '';
```

**Step 2: Update the innerHTML to include backBtn and linkedHtml**

Update the innerHTML assignment to include `backBtn` at start and `linkedHtml` after description:

```javascript
      document.getElementById('viewModalBody').innerHTML =
        backBtn +
        '<div class="view-sop-header">...' +
        (desc ? '<p style="margin-top:12px;color:var(--text-muted)">' + esc(desc) + '</p>' : '') +
        linkedHtml +
        '</div>' +
        ...
```

**Step 3: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): display linked SOPs in view mode with preview"
```

---

## Task 12: Add Step-Level Link UI

**Files:**
- Modify: `src/pages/sop-manager.html` (update renderSteps function ~line 2214)

**Step 1: Add refs display to step edit UI**

In `renderSteps`, before the closing `</div>` of step-content, add:

```javascript
            // Step refs
            '<div class="step-refs">' +
              (s.refs || []).map((ref, ri) => {
                const linked = getSopById(ref.sopId);
                const refTitle = linked ? (linked.title) : '[Deleted]';
                return '<span class="sop-link-chip step-ref-chip">' +
                  '<i class="ph-duotone ph-link"></i> ' + esc(refTitle) +
                  ' <span class="remove-link" onclick="event.stopPropagation();removeStepRef(' + i + ',' + ri + ')">&times;</span>' +
                '</span>';
              }).join('') +
              '<button type="button" class="sop-link-chip step-ref-chip" onclick="openLinkSopModal(' + i + ')" style="background:transparent;border-style:dashed;">' +
                '<i class="ph-duotone ph-plus"></i> Link' +
              '</button>' +
            '</div>' +
```

**Step 2: Update renderViewSOP to show step refs**

In the stepsHtml mapping, after stepDesc div, add:

```javascript
            // Step refs in view mode
            (st.refs && st.refs.length > 0
              ? '<div class="step-refs" style="margin-top:8px;">' +
                  st.refs.map(ref => {
                    const linked = getSopById(ref.sopId);
                    if (!linked) return '';
                    const refTitle = linked['title_' + lang] || linked.title;
                    return '<span class="sop-link-chip step-ref-chip" onclick="showSopPreview(\'' + ref.sopId + '\', event)">' +
                      '<i class="ph-duotone ph-link"></i> ' + esc(refTitle) +
                    '</span>';
                  }).join('') +
                '</div>'
              : '') +
```

**Step 3: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add step-level SOP reference UI"
```

---

## Task 13: Reset View Stack on Modal Close

**Files:**
- Modify: `src/pages/sop-manager.html` (update closeModal and viewSOP functions)

**Step 1: Clear sopViewStack when closing view modal**

In `closeModal` function, add:

```javascript
      if (id === 'viewModal') {
        sopViewStack = [];
      }
```

**Step 2: Clear sopViewStack when opening new SOP**

In `viewSOP` function, at the start:

```javascript
      sopViewStack = [];
```

**Step 3: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): reset view stack on modal close/open"
```

---

## Task 14: Add Translations

**Files:**
- Modify: `src/pages/sop-manager.html` (update translations object)

**Step 1: Add English translations**

In `translations.en`, add:

```javascript
        linkSop: 'Link SOP',
        searchSops: 'Search SOPs',
        relationship: 'Relationship',
        addLink: 'Add Link',
        linkedSops: 'Linked SOPs',
        noLinkedSops: 'No linked SOPs',
        backTo: 'Back to',
```

**Step 2: Add Spanish translations**

In `translations.es`, add:

```javascript
        linkSop: 'Vincular SOP',
        searchSops: 'Buscar SOPs',
        relationship: 'Relación',
        addLink: 'Agregar Vínculo',
        linkedSops: 'SOPs Vinculados',
        noLinkedSops: 'Sin SOPs vinculados',
        backTo: 'Volver a',
```

**Step 3: Commit**

```bash
git add src/pages/sop-manager.html
git commit -m "feat(sop): add bilingual translations for link feature"
```

---

## Task 15: Final Testing and Deploy

**Step 1: Test locally**

Open `src/pages/sop-manager.html` in browser and test:
- [ ] Create new SOP with linked SOPs
- [ ] Add step-level references
- [ ] View SOP shows linked SOPs section
- [ ] Click chip shows preview popup
- [ ] "Open Full SOP" navigates with back button
- [ ] Back button returns to original SOP
- [ ] ES/EN toggle shows correct labels
- [ ] Remove links works in edit mode

**Step 2: Push all changes**

```bash
git push
```

**Step 3: Test on live site**

Wait 1-2 minutes for GitHub Pages deployment, then test:
- https://rogueff.github.io/rogue-origin-apps/src/pages/sop-manager.html

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add database column |
| 2 | Update backend create/update |
| 3 | Add preset labels constant |
| 4 | Add link modal HTML |
| 5 | Add CSS styles |
| 6 | Add state variables |
| 7 | Add link modal functions |
| 8 | Add preview popup functions |
| 9 | Add edit mode UI for header links |
| 10 | Update saveSOP |
| 11 | Update view mode |
| 12 | Add step-level link UI |
| 13 | Reset view stack |
| 14 | Add translations |
| 15 | Final testing |
