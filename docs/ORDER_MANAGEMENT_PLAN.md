# Order Management System - Implementation Plan

> **Created**: January 3, 2026
> **Status**: In Progress
> **Branch**: `claude/ai-order-management-4tGUy`

---

## Overview

Build a comprehensive order management system that integrates with the existing AI Agent to enable conversational order creation, automatic document attachment, and customer visibility.

---

## Completed Work

### Backend (Code.gs) - DONE

The following has been added to `/apps-script/production-tracking/Code.gs`:

1. **New API Endpoints** (added to `doGet`):
   - `getCultivars` - Returns list of all cultivars from Data sheet
   - `getCustomers` - Returns customer address book
   - `estimateLeadTime` - Calculates lead time for order items
   - `getPricing` - Returns pricing list for cultivars

2. **Customer Management Functions**:
   - `getCustomerList()` - Get all customers
   - `getCustomer(customerId)` - Get single customer
   - `saveCustomer(customerData)` - Create/update customer
   - `createCustomersSheet_(ss)` - Creates Customers sheet with headers

3. **Pricing Management Functions**:
   - `getPricingList()` - Get all cultivar pricing
   - `getCultivarPrice(cultivarName)` - Get price for specific cultivar

4. **Existing Functions** (already in codebase):
   - `getCultivarList()` - Returns sorted list of cultivars
   - `estimateLeadTime(formData)` - Calculates production time needed
   - `getOrders()`, `getOrder()`, `saveOrder()` - Order CRUD

---

## Remaining Work

### Phase A: Order UI Overhaul

**File**: `orders.html`

| Task | Description | Status |
|------|-------------|--------|
| Strain dropdown | Fetch cultivars from `?action=getCultivars` API | Pending |
| Multi-strain per pallet | Allow adding multiple strains with individual kg amounts | Pending |
| Auto-total calculation | Sum strain quantities automatically | Pending |
| Pricing input | Manual input OR pull from pricing sheet | Pending |
| Customer selection | Dropdown of customers from address book | Pending |
| New customer modal | Add new customer with address fields | Pending |

**New Pallet Structure**:
```javascript
{
  id: 'P001',
  strains: [
    { cultivar: 'Sour Lifter', weightKg: 25, pricePerKg: 150 },
    { cultivar: 'Lifter', weightKg: 25, pricePerKg: 140 }
  ],
  totalKg: 50,
  status: 'pending'
}
```

**New Order Structure**:
```javascript
{
  id: 'ORD-001',
  customerId: 'CUST-001',
  customer: 'Hamburg GmbH',  // Denormalized for display
  address: { street, city, state, zip, country },
  items: [
    { cultivar: 'Sour Lifter', quantityKg: 50, pricePerKg: 150, total: 7500 },
    { cultivar: 'Lifter', quantityKg: 50, pricePerKg: 140, total: 7000 }
  ],
  totalKg: 100,
  completedKg: 0,
  totalPrice: 14500,
  currency: 'USD',
  status: 'pending',
  pallets: [...],
  documents: [],
  createdDate: '2026-01-03',
  dueDate: '2026-02-01',
  notes: ''
}
```

### Phase B: Live KPIs Dashboard

**Location**: Top of `orders.html`

| KPI | Description | Data Source |
|-----|-------------|-------------|
| Strain Progress | % complete per cultivar across all orders | Calculate from order items |
| Order Progress | % complete per order | Order completedKg/totalKg |
| Estimated Lead Time | Days to complete remaining work | `estimateLeadTime` API |
| Active Orders | Count of non-completed orders | Order status filter |
| Total Pending Kg | Sum of pending order weights | Order aggregation |

### Phase C: AI Agent Integration

**File**: `apps-script/production-tracking/Code.gs` (AI section)

| Task | Description |
|------|-------------|
| Add order context to AI | Include order summary in `gatherProductionContext()` |
| Lead time intent | Detect "how long for X kg of Y" questions |
| Order creation offer | AI offers to create order after lead time estimate |
| Create order via AI | New function to create order from AI conversation |

**Example AI Flow**:
```
User: "Cannaflora wants 50kg Lifter and 50kg Sour Lifter. How long will that take?"

AI: "Based on historical data:
- Lifter (50kg): ~2.1 days at current crew size
- Sour Lifter (50kg): ~1.9 days
- Total: ~4 work days (estimated completion: Jan 9)

Would you like me to create this order for Cannaflora?"

User: "Yes"

AI: "Order ORD-004 created for Cannaflora:
- 50kg Lifter @ $140/kg = $7,000
- 50kg Sour Lifter @ $150/kg = $7,500
- Total: $14,500
- Estimated delivery: January 9, 2026

View order: [link]"
```

### Phase D: Document Management

| Task | Description |
|------|-------------|
| Documents array on orders | Store document references |
| View Documents button | Modal showing all attached docs |
| Google Drive integration | Store docs in order-specific folders |
| COA auto-linking | Match cultivar COAs from Drive folder |

**Document Structure**:
```javascript
{
  type: 'COA',  // COA, Invoice, BOL, AirwayBill, Other
  name: 'COA-SourLifter-2025.pdf',
  url: 'https://drive.google.com/...',
  uploadedDate: '2026-01-03'
}
```

### Phase E: Invoice & BOL Generation

| Task | Description |
|------|-------------|
| Commercial Invoice template | User will provide template link |
| BOL template | Design simple BOL |
| PDF generation | Use Google Docs template + export |
| Auto-save to Drive | Save to order folder |

### Phase F: Freight Email Draft

**Freight Forwarder**: Fide Freight
**Contact**: Randen (Randen@fidefreight.com)

| Task | Description |
|------|-------------|
| Email template | Format based on examples (user will provide) |
| Draft email button | Generate email content for order |
| Gmail integration | Open compose window or copy to clipboard |

### Phase G: Notifications

| Task | Description |
|------|-------------|
| Email notifications | Send on status change |
| SMS notifications | Optional (need Twilio or similar) |
| Customer notification | Email customer when status changes |

### Phase H: Gmail Document Aggregation

| Task | Description |
|------|-------------|
| Gmail search | Find docs by subject/sender patterns |
| Airway bill detection | User will provide email patterns |
| Auto-attach to order | Link found documents to order |

---

## Pending Information From User

| Item | Description | Status |
|------|-------------|--------|
| Google Drive COA folder | Link to folder containing COAs | Pending |
| Commercial Invoice template | Existing template to use | Pending |
| Freight email examples | Sample emails with Randen | Pending |
| Pricing sheet | Cultivar pricing (user creating from Shopify) | Pending |
| Gmail patterns | How to identify airway bills, pallet docs | Pending |
| SMS preference | Twilio? Or email-only for now? | Pending |

---

## API Reference

### Existing Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=scoreboard` | GET | Production scoreboard data |
| `?action=getOrders` | GET | All orders |
| `?action=getOrder&id=X` | GET | Single order |
| `?action=saveOrder` | POST | Create/update order |

### New Endpoints (Added)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=getCultivars` | GET | List of all cultivars |
| `?action=getCustomers` | GET | Customer address book |
| `?action=getPricing` | GET | Cultivar pricing list |
| `?action=estimateLeadTime` | GET | Lead time calculation |

### Planned Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=saveCustomer` | POST | Create/update customer |
| `?action=getOrderDocuments&id=X` | GET | Documents for order |
| `?action=generateInvoice&id=X` | POST | Generate invoice PDF |
| `?action=generateBOL&id=X` | POST | Generate BOL PDF |

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps-script/production-tracking/Code.gs` | Added API endpoints, customer mgmt, pricing mgmt |
| `orders.html` | Needs complete UI overhaul (pending) |
| `order.html` | Customer portal - may need updates for new structure |

---

## Quick Start for New Chat

1. Read this plan file first
2. Read `apps-script/production-tracking/Code.gs` to see completed backend work
3. Read current `orders.html` to understand existing UI
4. Start with **Phase A: Order UI Overhaul** - rebuild `orders.html`

---

## Notes

- All work is on branch `claude/ai-order-management-4tGUy`
- Use existing AI Agent infrastructure (don't build separate)
- Follow existing code patterns (see CLAUDE.md)
- Test API endpoints with `?action=test`
