# Shipment Documents Bundle Design

**Date**: January 14, 2026
**Status**: Approved
**Feature**: Auto-generate merged PDF with Invoice, BOL, Packing Slip, and COAs

---

## Overview

When a shipment is created, generate a complete document bundle as a single merged PDF containing:
1. Commercial Invoice (existing)
2. Bill of Lading (new)
3. Packing Slip (new)
4. All matched COAs from Google Drive (new)

## Document Specifications

### Commercial Invoice
Already implemented in `orders.html` via `generateCommercialInvoice()`.

### Bill of Lading (BOL)
Basic format with:
- Shipper info (Rogue Origin address)
- Consignee info (customer ship-to address)
- Description of goods (strain names, quantities, package counts)
- Total weight and package count
- Signature lines for shipper and carrier

### Packing Slip
Matches existing Shopify packing slip format:
- ROGUE ORIGIN header with order # and date
- Ship To / Bill To addresses side by side
- Items table: strain name + quantity (X of X format)
- Optional notes section
- Footer with company info

### COA Matching
- COA files stored in Google Drive folder: `1efudtjpm8fsSA6PZUirhtsmCO5-oS2Me`
- File naming convention: `Sour_Lifter_COA.pdf` → strain "Sour Lifter"
- Fuzzy matching algorithm:
  1. Strip year prefixes: "2025 Sour Lifter" → "Sour Lifter"
  2. Normalize: lowercase, remove extra spaces/underscores
  3. Match against COA index strain names
  4. If no match found, skip (warn user, don't block)

## Technical Implementation

### Backend (Code.gs)

New function `getCOAsForStrains(strainList)`:
```javascript
function getCOAsForStrains(strainList) {
  // 1. Get COA index
  // 2. For each strain in strainList:
  //    - Normalize strain name (strip year, lowercase, etc.)
  //    - Find matching COA in index using fuzzy match
  //    - If found, get file from Drive and convert to base64
  // 3. Return array of { strain, matched, fileName, base64 }
}
```

### Frontend (orders.html)

**New functions:**
- `generateBOL(shipment, order)` - creates BOL PDF with jsPDF
- `generatePackingSlip(shipment, order)` - creates packing slip PDF
- `fetchMatchedCOAs(strains)` - calls backend to get COA PDFs
- `mergeDocumentBundle(invoice, bol, packingSlip, coas)` - uses pdf-lib to merge
- `generateShipmentDocuments(shipment, order)` - orchestrates full flow

**New library:**
- pdf-lib (~200KB) - for merging PDFs
- Lazy-loaded like jsPDF

### UI

Add "Generate Documents" button to shipment detail panel:
```html
<button onclick="generateShipmentDocuments(shipment, order)">
  📄 Generate Documents
</button>
```

**User flow:**
1. Click button
2. Toast: "Generating documents..."
3. Generate Invoice, BOL, Packing Slip locally
4. Toast: "Matching COAs..."
5. Fetch COAs from backend
6. Merge all PDFs
7. Auto-download: `Shipment_INV-2026-0015_Documents.pdf`
8. Toast: "Documents ready! (X COAs matched)"

**Error handling:**
- If COA not found: warn but continue
- If backend fails: show error, offer retry
- If pdf-lib fails to load: fallback to separate downloads

## Output

Single merged PDF file: `Shipment_{invoiceNumber}_Documents.pdf`

Page order:
1. Commercial Invoice (1-2 pages)
2. Bill of Lading (1 page)
3. Packing Slip (1 page)
4. COA for Strain 1 (1+ pages)
5. COA for Strain 2 (1+ pages)
6. ... additional COAs

## Files to Modify

| File | Changes |
|------|---------|
| `apps-script/wholesale-orders/Code.gs` | Add `getCOAsForStrains()` endpoint |
| `src/pages/orders.html` | Add BOL generator, packing slip generator, pdf-lib, merge logic, UI button |

## Success Criteria

- [ ] Single click generates complete document bundle
- [ ] COAs automatically matched by strain name
- [ ] Missing COAs warn but don't block
- [ ] Packing slip matches existing Shopify format
- [ ] BOL includes all required basic fields
- [ ] Works with shipments that have multiple strains
