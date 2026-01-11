# Shipment Creation & Management Guide

This guide explains how to use the AI chat to create and query wholesale shipments.

---

## Overview

The AI chat can now manage wholesale shipments through natural language commands. Shipments are linked to existing master orders and automatically appear on the scoreboard.

**Key Features:**
1. **Create shipments** - AI creates shipments with line items
2. **Query shipments** - View all shipments for a customer
3. **Fuzzy matching** - Customer names don't need to be exact
4. **Auto-pricing** - Looks up prices from PriceHistory sheet
5. **Scoreboard integration** - Shipments appear in production queue

---

## Prerequisites

✅ Master Order exists for the customer (create manually in orders.html)
✅ Customer exists in Customers sheet with a CustomerID
✅ Production tracking backend deployed
✅ Wholesale orders backend deployed

---

## How to Create Shipments

### Single-Item Shipment

**Ask the AI:**
```
Create a shipment for Cannaflora, 500kg Lifter Tops
```

**Required Information:**
- Customer name (fuzzy match supported)
- Strain name (e.g., "Lifter", "Blue Dream")
- Product type: "Tops" or "Smalls"
- Quantity in kilograms

**AI Response:**
```
Shipment created successfully!

Shipment ID: SH-001-02
Master Order: MO-2026-001
Customer: Cannaflora AG
Line Items: 500kg Lifter Tops @ $X.XX/kg
Total: $X,XXX.XX
Status: Pending
Shipment Date: 2026-01-11
```

### Multi-Item Shipment (Multiple Strains in One Shipment)

**Ask the AI:**
```
Create a shipment for Cannaflora: 20kg Lifter Tops and 20kg Sour Lifter Tops
```

**or:**
```
Ship to Green Valley: 100kg Blue Dream Tops, 50kg Lifter Tops, 30kg Sour Lifter Smalls
```

**AI Response:**
```
Shipment created successfully!

Shipment ID: SH-001-09
Master Order: MO-2026-001
Customer: Cannaflora AG
Line Items: 20kg Lifter Tops @ $8.50/kg, 20kg Sour Lifter Tops @ $9.00/kg
Total: $350.00
Status: Pending
Shipment Date: 2026-01-11
```

**Benefits:**
- One shipment with multiple line items
- Each item priced individually from PriceHistory
- Combined total across all items
- Cleaner than creating separate shipments

### With Optional Details

**Ask the AI:**
```
New shipment: Mountain Organics, 50kg Blue Dream Smalls and 30kg Lifter Smalls, shipping Feb 15, notes: Priority shipment
```

**Optional Fields:**
- Shipment date (YYYY-MM-DD format)
- Notes (special instructions)

---

## How to Query Shipments

**Ask the AI:**
```
What shipments exist for Cannaflora?
```

**AI Response:**
```
Found 2 shipment(s) for Cannaflora AG

Shipment ID: SH-001-01
Date: 2026-01-11
Status: pending
Items: 500kg Lifter Tops
Total: $X,XXX.XX

Shipment ID: SH-001-02
Date: 2026-01-11
Status: pending
Items: 500kg Lifter Tops
Total: $X,XXX.XX
```

---

## Where Shipments Appear

### 1. AI Chat
- Create and query shipments through natural language
- Results display as formatted data cards

### 2. Scoreboard (Production TV)
- **URL:** https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html
- **🎯 WORKING ON:** Current shipment being processed
- **⏭ UP NEXT:** Next shipment in queue
- **Only shows "Tops"** (Smalls excluded from production queue)
- Progress tracking based on production data

### 3. Orders Page
- **URL:** https://rogueff.github.io/rogue-origin-apps/src/pages/orders.html
- Click on a master order → Shipments tab
- View all shipments, edit details, generate docs

---

## Data Model

### Master Order vs Shipment

**Master Order** (manually created):
- Large commitment contract (~$56K)
- Example: MO-2026-001 for Cannaflora AG
- Status: active, pending, completed, cancelled

**Shipment** (AI-created or manual):
- Individual delivery against master order
- Contains one or more line items (each with: strain, type, quantity, price)
- Example: SH-001-02 linked to MO-2026-001
- Auto-generated invoice number
- Can combine multiple strains/types in a single shipment

### Shipment Structure (Multi-Item Example)
```javascript
{
  id: "SH-001-09",
  orderID: "MO-2026-001",
  shipmentDate: "2026-01-11",
  status: "pending",
  lineItems: [
    {
      strain: "Lifter",
      type: "Tops",
      quantity: 20,
      unitPrice: 8.50,
      total: 170.00
    },
    {
      strain: "Sour Lifter",
      type: "Tops",
      quantity: 20,
      unitPrice: 9.00,
      total: 180.00
    }
  ],
  subTotal: 350.00,
  discount: 0,
  freightCost: 0,
  totalAmount: 350.00,
  notes: ""
}
```

---

## How It Works

### Customer Lookup (Fuzzy Matching)
1. AI sends customer name (e.g., "Cannaflora")
2. Backend searches Customers sheet
3. Calculates similarity using Levenshtein distance
4. Returns best match if >70% similar
5. Example: "Cannaflora" matches "Cannaflora AG" at 76.9%

### Master Order Lookup
1. Backend finds customer's CustomerID
2. Searches MasterOrders sheet for active/pending orders
3. Returns first match or error if none found

### Price Lookup
1. Searches PriceHistory sheet for strain + type
2. Prioritizes customer-specific pricing
3. Falls back to general pricing
4. Returns 0 if no price found (shows "Price TBD")

### Shipment Creation
1. Validates all required fields
2. Builds line items array
3. Calculates totals
4. Saves to Shipments sheet
5. Auto-generates shipment ID (e.g., SH-001-02)
6. Auto-generates invoice number

---

## AI Clarification

If you provide incomplete information, the AI will ask for clarification:

**You:** "Ship to Green Valley"
**AI:** "What strain, type (Tops/Smalls), and quantity should I ship?"

**Required fields:**
- Customer name ✅
- Strain name ✅
- Type (Tops/Smalls) ✅
- Quantity (kg) ✅

---

## Scoreboard Queue Logic

The scoreboard shows shipments in priority order:

**Filtering:**
- Only "Tops" products (Smalls excluded)
- Only active/pending master orders
- Excludes completed/cancelled orders

**Sorting:**
1. Manual priority (if set on master order)
2. Creation date (FIFO - first in, first out)

**Display:**
- **Current:** First shipment in queue + progress tracking
- **Next:** Second shipment in queue
- **Progress:** Based on actual production data from bags logged

---

## Troubleshooting

### "Customer not found"
- Check spelling (fuzzy match has 70% threshold)
- Verify customer exists in Customers sheet
- Ensure CustomerID field is populated

### "No active master order found"
- Customer needs an active or pending master order
- Create one manually in orders.html first
- Check master order status isn't "completed" or "cancelled"

### "Price TBD" shown
- No price exists in PriceHistory sheet for this strain+type
- Add price manually to PriceHistory sheet
- Format: Strain | Type | Price | Date | CustomerID (optional)

### Shipments not appearing on scoreboard
- Verify shipment type is "Tops" (Smalls don't show)
- Check master order status is active/pending
- Hard refresh scoreboard (Ctrl+F5)
- Wait 1-2 minutes for backend updates

---

## Examples

### Create Single-Item Shipment
```
User: "Create a shipment for Cannaflora, 500kg Lifter Tops"
AI: [Creates shipment with auto-generated ID and invoice number]
```

### Create Multi-Item Shipment
```
User: "Create a shipment for Cannaflora: 20kg Lifter Tops and 20kg Sour Lifter Tops"
AI: [Creates ONE shipment with TWO line items, each priced individually]
```

### Create with Date
```
User: "Ship to Mountain Organics: 50kg Blue Dream Smalls, 30kg Lifter Smalls, shipping Feb 15"
AI: [Creates multi-item shipment scheduled for Feb 15]
```

### Complex Multi-Item
```
User: "New shipment for Green Valley: 100kg Blue Dream Tops, 50kg Lifter Tops, 30kg Sour Lifter Smalls"
AI: [Creates shipment with 3 different line items, combined total]
```

### Query Shipments
```
User: "What shipments exist for Green Valley?"
AI: [Shows all shipments for Green Valley Farm]
```

---

## Backend Implementation

### Apps Script Backends

**Production Tracking** (`apps-script/production-tracking/Code.gs`):
- `executeCreateShipment_()` - Handles shipment creation
- `executeGetShipments_()` - Queries shipments for a customer
- `findCustomerByName_()` - Fuzzy customer matching
- Task registry includes: `create_shipment`, `get_shipments`

**Wholesale Orders** (`apps-script/wholesale-orders/Code.gs`):
- `getActiveMasterOrder(customerID)` - Finds active order
- `getPriceForStrain(strain, type, customerID)` - Price lookup
- `saveShipment(shipmentData)` - Persists to Shipments sheet
- `getShipments(orderID)` - Retrieves shipments
- `getScoreboardOrderQueue()` - Scoreboard data with progress

### Frontend

**AI Chat** (`src/js/modules/panels.js`):
- Task result formatting with `formatTaskResult()`
- Displays shipment data as cards
- Handles both creation and query results

---

## Best Practices

1. **Always create master orders first** - Shipments must link to existing orders
2. **Use consistent naming** - Keep strain names standardized
3. **Maintain price history** - Update PriceHistory sheet regularly
4. **Specify type clearly** - Always say "Tops" or "Smalls" explicitly
5. **Review before committing** - Check AI response summary

---

## Future Enhancements

- [ ] Bulk shipment creation
- [ ] Edit existing shipments via AI
- [ ] Delete/cancel shipments via AI
- [ ] Smart suggestions based on order history
- [ ] Shipment status updates via AI
- [ ] Integration with shipping carriers

---

## Support

**Issues?**
- Check Apps Script execution logs
- Verify all prerequisites are met
- Review error messages in AI chat

**Need Help?**
- Report issues on GitHub
- Include error messages and steps to reproduce

---

**Setup complete!** 🎉 You can now create and manage shipments through AI chat.
