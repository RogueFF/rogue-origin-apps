# Shopify Manual Import Guide

## Overview

Import fulfilled Shopify orders as shipments in your wholesale order system with a simple CSV upload. The system automatically matches Shopify customers to your Master Orders.

---

## Step 1: Export Orders from Shopify

### 1.1 Access Shopify Orders

1. Log into your **Shopify Admin**
2. Click **Orders** in the left sidebar

### 1.2 Filter for Fulfilled Orders

1. Click the **Filter** button (funnel icon)
2. Select **Fulfillment status** → **Fulfilled**
3. Optionally add date range:
   - **Order date** → Last 7 days / Last 30 days / Custom range
4. Click **Apply filters**

### 1.3 Export to CSV

1. Click the **Export** button (top right)
2. Select format: **Plain CSV file**
3. Choose what to export:
   - **Filtered orders** (recommended) - exports only fulfilled orders
   - Or select custom date range
4. Click **Export orders**
5. Shopify will email you the CSV file (usually within 1-2 minutes)

### 1.4 Download the CSV

1. Check your email for "Your export from Shopify is ready"
2. Click **Download file**
3. Save to your computer (e.g., `shopify-orders-2026-01-06.csv`)

---

## Step 2: Import into Wholesale System

### 2.1 Open Import Tool

1. Open `orders.html` in your browser
2. Click the **🛒 Import Shopify** button (top right, next to "New Customer")

### 2.2 Upload CSV File

1. Click **Choose File** or drag the CSV file
2. Wait for the file to process (~1-2 seconds)

### 2.3 Review Matches

The system will show you two sections:

**✅ Matched Orders** (green)
- These Shopify orders match existing customers in your Master Orders
- Shows: Shopify Order # → Master Order ID
- Ready to import!

**⚠️ Unmatched Orders** (yellow)
- These customers don't exist in your Master Orders yet
- Will be skipped during import
- **Fix:** Create Master Orders for these customers first, then re-import

**Example Preview:**
```
✅ 3 order(s) matched
─────────────────────────
Shopify #1234  → MO-2026-001
Acme Corp • $2,500.00 • 3 items

Shopify #1235  → MO-2026-003
Global Hemp • $1,800.00 • 2 items

⚠️ 1 order(s) not matched
─────────────────────────
Shopify #1236
New Customer LLC • $950.00
```

### 2.4 Confirm Import

1. Review the matched orders
2. Click **Import X Shipments** button
3. Wait for confirmation (usually 2-5 seconds)
4. Success toast appears: "✅ Imported 3 shipment(s) from Shopify!"

### 2.5 Verify Imported Shipments

1. Find the relevant Master Order in the table
2. Click to open the order detail panel
3. Go to the **Shipments** tab
4. Look for shipments with purple **🛒 Shopify** badge

---

## How Customer Matching Works

The import tool matches Shopify orders to Master Orders using:

### Matching Methods (in order of priority):

1. **Email Match** (most reliable)
   - Shopify customer email = Master Order Ship-To Email
   - Example: `john@acmecorp.com` matches exactly

2. **Company Name Match** (flexible)
   - Case-insensitive partial match
   - "acme corp" matches "ACME CORPORATION"
   - "global hemp" matches "Global Hemp Solutions LLC"

### Examples

| Shopify Customer | Master Order | Match? | Why |
|------------------|--------------|--------|-----|
| john@acme.com<br>Acme Corp | MO-2026-001<br>Ship-To: john@acme.com | ✅ Yes | Email match |
| sarah@global.com<br>Global Hemp | MO-2026-002<br>Name: GLOBAL HEMP SOLUTIONS | ✅ Yes | Name partial match |
| info@newcustomer.com<br>New LLC | (no order) | ❌ No | Not in Master Orders |

### Tips for Better Matching

1. **Use consistent customer names** in Shopify and Master Orders
2. **Ensure emails match** between systems
3. **Create Master Orders first** before importing Shopify data
4. **Use company names** rather than individual names when possible

---

## What Gets Imported

### From Shopify CSV → Shipment

| Shopify Field | Becomes | Example |
|---------------|---------|---------|
| Order Number | Notes | "Auto-imported from Shopify Order #1234" |
| Lineitem name | Strain | "Cherry Diesel Tops 5kg" |
| Lineitem quantity | Quantity | 10 |
| Lineitem price | Unit Price | $50.00 |
| Total | Total Amount | $525.00 |
| Shipping | Freight Cost | $25.00 |

### Product Type Detection

- Product name contains **"small"** or **"smalls"** → Type: `smalls`
- Otherwise → Type: `tops` (default)

**Examples:**
```
"Cherry Diesel Tops" → tops
"OG Kush Smalls 5kg" → smalls
"Premium Lifter" → tops (default)
```

### Shipment Metadata

Each imported shipment includes:
```json
{
  "source": "shopify",
  "shopifyOrderNumber": "1234"
}
```

This metadata is used for:
- Displaying the purple Shopify badge
- Tracking which shipments came from Shopify
- Avoiding duplicate imports

---

## Handling Common Scenarios

### Scenario 1: Customer Not Matched

**Problem:** "⚠️ 5 order(s) not matched"

**Solution:**
1. Review the unmatched orders in the preview
2. Create Master Orders for those customers:
   - Click **New Order** button
   - Fill in customer details
   - **Important:** Use the same email/company name as in Shopify
3. Re-upload the same CSV file
4. Orders should now match

---

### Scenario 2: Duplicate Imports

**Problem:** "I already imported this week's orders. Will re-uploading create duplicates?"

**Answer:** Yes, the system will create duplicate shipments.

**Prevention:**
- Keep track of what you've imported (use date ranges in Shopify export)
- Export "Last 7 days" for weekly imports
- Check the shipments tab before importing

**Fix if duplicates created:**
- Manually delete duplicate shipments in the detail panel

---

### Scenario 3: Wrong Master Order Assignment

**Problem:** Shipment was assigned to the wrong Master Order

**Cause:** Multiple customers with similar names/emails

**Solution:**
1. Delete the incorrectly assigned shipment
2. Update customer info in Master Orders to be more specific
3. Re-import the order

---

### Scenario 4: Missing Line Items

**Problem:** Shipment shows "$500 • 0 items"

**Cause:** Shopify export may group line items differently

**Fix:**
1. Edit the shipment manually
2. Add the missing line items
3. Click "Save Shipment"

---

## CSV Format Requirements

### Required Shopify CSV Columns

The import tool expects these column headers:

✅ **Required:**
- `Name` (order number)
- `Fulfillment Status`
- `Lineitem name`
- `Lineitem quantity`
- `Lineitem price`
- `Total`
- `Email`

⚠️ **Recommended:**
- `Shipping`
- `Billing Company`
- `Billing Name`

### Not Using Shopify?

If you're exporting from another e-commerce platform:

1. Ensure the CSV has the required columns
2. Map your column names to match Shopify's format
3. Or manually create shipments (no import needed)

---

## Best Practices

### Weekly Import Workflow

1. **Monday morning:** Export last week's fulfilled orders
   - Filter: Fulfilled + Date range: Last 7 days
2. **Review:** Check for new wholesale customers
3. **Import:** Upload CSV to wholesale system
4. **Verify:** Spot-check 2-3 shipments for accuracy
5. **Document:** Note any unmatched orders for follow-up

### Monthly Review

- [ ] Compare Shopify revenue to wholesale shipments totals
- [ ] Verify all wholesale customers are in Master Orders
- [ ] Check for duplicate shipments
- [ ] Update customer info if matching issues occurred

---

## Troubleshooting

### "No fulfilled orders found in CSV"

**Causes:**
- CSV only contains unfulfilled orders
- Wrong file uploaded
- CSV is empty or corrupted

**Fix:**
- Re-export with "Fulfillment status: Fulfilled" filter
- Verify the CSV opens correctly in Excel/Google Sheets

---

### "Error parsing CSV"

**Causes:**
- CSV has non-standard formatting
- File is corrupted
- Wrong file type (not .csv)

**Fix:**
- Open CSV in Excel and re-save as CSV
- Ensure no special characters in product names
- Use "Plain CSV file" format (not Excel CSV)

---

### Import Button Grayed Out

**Cause:** No matched orders found

**Fix:**
- Create Master Orders for the customers first
- Ensure customer names/emails match between systems

---

## FAQ

**Q: Can I import the same order twice?**
A: Yes, but it will create a duplicate shipment. Avoid re-importing the same data.

**Q: What happens to unfulfilled Shopify orders?**
A: They're automatically filtered out. Only fulfilled orders are imported.

**Q: Can I edit Shopify-imported shipments?**
A: Yes! They work just like manually created shipments. The Shopify badge is just a visual indicator.

**Q: Does this sync automatically?**
A: No, this is manual import only. You upload CSV files when needed.

**Q: How do I know which orders I've already imported?**
A: Check the shipments tab and look for the Shopify badge. Use date ranges in Shopify to avoid duplicates.

**Q: Can I import partial fulfillments?**
A: The CSV includes all line items from the order, even if partially fulfilled. You may need to edit quantities.

---

## Advanced: Customizing Product Type Detection

If your products don't follow the "tops/smalls" naming convention, you can update the detection logic:

**Location:** `orders.html` → `confirmShopifyImport()` function → line ~2302

**Current logic:**
```javascript
const type = item.title.toLowerCase().includes('small') ? 'smalls' : 'tops';
```

**Custom example (size-based):**
```javascript
let type = 'tops';
if (item.title.includes('Smalls')) type = 'smalls';
else if (item.title.includes('2kg')) type = 'smalls';
else if (item.title.includes('5kg')) type = 'tops';
```

---

## Support Checklist

Before asking for help:

- [ ] Exported "Fulfilled orders" from Shopify
- [ ] CSV file opens correctly in Excel
- [ ] Customers exist in Master Orders
- [ ] Customer names/emails match between systems
- [ ] Checked browser console for errors (F12)

---

## Next Steps

1. ✅ Export a test CSV with 2-3 orders
2. 📝 Create Master Orders for those customers (if needed)
3. 🧪 Test the import process
4. ✅ Verify shipments appear with Shopify badge
5. 🎉 Set up weekly import routine

---

**Last Updated:** January 6, 2026
**Version:** 1.0
