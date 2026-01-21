"""
Import Cannaflora payment/shipment data into Orders system
"""
import requests
import json
from datetime import datetime

API_URL = "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/orders"

def api_call(action, data=None):
    """Make API call"""
    if data:
        resp = requests.post(f"{API_URL}?action={action}", json=data)
    else:
        resp = requests.get(f"{API_URL}?action={action}")
    return resp.json()

# Check if Cannaflora customer exists
print("Checking customers...")
customers = api_call("getCustomers")
cannaflora = None
for c in customers.get("customers", []):
    if "cannaflora" in c.get("companyName", "").lower():
        cannaflora = c
        break

if not cannaflora:
    print("Creating Cannaflora AG customer...")
    result = api_call("saveCustomer", {
        "companyName": "Cannaflora AG",
        "contactName": "Benjamin Steffen",
        "email": "",
        "phone": "",
        "shipToAddress": "Switzerland",
        "notes": "Main wholesale customer - Robert Gerec contact"
    })
    cannaflora = result.get("customer", {})
    print(f"Created customer: {cannaflora.get('id')}")
else:
    print(f"Found existing customer: {cannaflora.get('id')} - {cannaflora.get('companyName')}")

customer_id = cannaflora.get("id")

# Create main order for Cannaflora
print("\nCreating main order...")
order_result = api_call("saveMasterOrder", {
    "customerID": customer_id,
    "customerName": "Cannaflora AG",
    "commitmentAmount": 735029,  # Total from spreadsheet
    "currency": "USD",
    "terms": "DAP",
    "notes": "Main wholesale order - 140kg pallets + extras. Total 1,850kg."
})
order = order_result.get("order", {})
order_id = order.get("id")
print(f"Created order: {order_id}")

# Shipments data from the spreadsheet
shipments = [
    # Pallet shipments (140kg tops each @ $56,000)
    {"invoice": "D6806", "date": "2025-12-03", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 1"},
    {"invoice": "D6807/25683", "date": "2025-12-04", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 2"},
    {"invoice": "D6808", "date": "2025-12-05", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 3"},
    {"invoice": "D6809/26395", "date": "2025-12-08", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 4"},
    {"invoice": "D6810/26656", "date": "2025-12-09", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 5"},
    {"invoice": "D6811/26840", "date": "2025-12-10", "amount": 56000, "kg": 140, "type": "Tops", "status": "delivered", "notes": "Pallet 6"},
    {"invoice": "D6812", "date": "2025-12-11", "amount": 56000, "kg": 140, "type": "Tops", "status": "pending", "notes": "Pallet 7"},
    {"invoice": "D6813", "date": "2025-12-12", "amount": 56000, "kg": 140, "type": "Tops", "status": "pending", "notes": "Pallet 8"},
    {"invoice": "D6814", "date": "2025-12-15", "amount": 56000, "kg": 140, "type": "Tops", "status": "pending", "notes": "Pallet 9"},

    # Transport invoices
    {"invoice": "D6832/25622", "date": "2025-12-16", "amount": 760.05, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping for Robert"},
    {"invoice": "D6887", "date": "2025-12-17", "amount": 3586.93, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 1"},
    {"invoice": "D6907/25683", "date": "2025-12-22", "amount": 3586.93, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 2"},
    {"invoice": "D6923-transport", "date": "2025-12-23", "amount": 3586.96, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 3"},
    {"invoice": "D6941-transport", "date": "2025-12-31", "amount": 3586.93, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 4"},
    {"invoice": "D6985-transport", "date": "2026-01-08", "amount": 3586.93, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 5"},
    {"invoice": "D7037-transport", "date": "2026-01-16", "amount": 3586.93, "kg": 0, "type": "Transport", "status": "pending", "notes": "Shipping Pallet 6"},

    # Additional product
    {"invoice": "D6876/25682", "date": "2025-12-16", "amount": 8000, "kg": 20, "type": "Tops", "status": "delivered", "notes": "Extra 20kg Pallet 1"},
    {"invoice": "D6888/25683", "date": "2025-12-17", "amount": 8000, "kg": 20, "type": "Tops", "status": "delivered", "notes": "Extra 20kg Pallet 2"},
    {"invoice": "D6902/25683", "date": "2025-12-19", "amount": 4000, "kg": 20, "type": "Smalls", "status": "delivered", "notes": "Small buds Pallet 2"},
    {"invoice": "D6923-extra1", "date": "2025-12-23", "amount": 2000, "kg": 5, "type": "Tops", "status": "delivered", "notes": "Extra 5kg Pallet 3"},
    {"invoice": "D6923-extra2", "date": "2025-12-23", "amount": 10000, "kg": 25, "type": "Tops", "status": "delivered", "notes": "Extra 25kg Pallet 3"},
    {"invoice": "D6923-smalls", "date": "2025-12-23", "amount": 3500, "kg": 20, "type": "Smalls", "status": "delivered", "notes": "Small buds Pallet 3"},
    {"invoice": "D6941/26395", "date": "2025-12-31", "amount": 20000, "kg": 50, "type": "Tops", "status": "pending", "notes": "Extra 50kg Pallet 4"},
    {"invoice": "D6985/26656", "date": "2026-01-08", "amount": 20000, "kg": 50, "type": "Tops", "status": "pending", "notes": "Extra 50kg Pallet 5"},
    {"invoice": "D7010/26786-tops", "date": "2026-01-14", "amount": 26000, "kg": 65, "type": "Tops", "status": "pending", "notes": "Pallet A - tops"},
    {"invoice": "D7010/26786-extra", "date": "2026-01-14", "amount": 10000, "kg": 25, "type": "Tops", "status": "pending", "notes": "Pallet A - extra tops"},
    {"invoice": "D7010/26786-smalls", "date": "2026-01-14", "amount": 17500, "kg": 100, "type": "Smalls", "status": "pending", "notes": "Pallet A - small buds"},
    {"invoice": "D7037/26840", "date": "2026-01-16", "amount": 20000, "kg": 50, "type": "Smalls", "status": "pending", "notes": "Pallet 6 - smalls"},
]

print(f"\nCreating {len(shipments)} shipments...")
for i, s in enumerate(shipments):
    line_items = [{
        "strain": "Mixed",
        "type": s["type"],
        "quantity": s["kg"],
        "unitPrice": s["amount"] / s["kg"] if s["kg"] > 0 else 0,
        "total": s["amount"]
    }] if s["kg"] > 0 else []

    result = api_call("saveShipment", {
        "orderID": order_id,
        "invoiceNumber": s["invoice"],
        "shipmentDate": s["date"],
        "status": s["status"],
        "totalAmount": s["amount"],
        "lineItems": line_items,
        "notes": s["notes"]
    })
    shipment = result.get("shipment", {})
    print(f"  [{i+1}/{len(shipments)}] {s['invoice']}: ${s['amount']:,.2f} ({s['kg']}kg {s['type']})")

# Payments from Steffen.xls (amounts are negative = received)
payments = [
    {"date": "2025-12-03", "amount": 56000, "ref": "D6806 #25682", "notes": "Pallet 1 payment"},
    {"date": "2025-12-04", "amount": 56000, "ref": "D6807 #25683", "notes": "Pallet 2 payment"},
    {"date": "2025-12-05", "amount": 56000, "ref": "D6808 #25822", "notes": "Pallet 3 payment"},
    {"date": "2025-12-08", "amount": 56000, "ref": "D6809 #25759", "notes": "Pallet 4 payment"},
    {"date": "2025-12-09", "amount": 56000, "ref": "D6810 #25880", "notes": "Pallet 5 payment"},
    {"date": "2025-12-10", "amount": 56000, "ref": "D6811 #25881", "notes": "Pallet 6 payment"},
    {"date": "2025-12-11", "amount": 56000, "ref": "D6812 #25950", "notes": "Pallet 7 payment"},
    {"date": "2025-12-12", "amount": 56000, "ref": "D6813 #25951", "notes": "Pallet 8 payment"},
    {"date": "2025-12-15", "amount": 56000, "ref": "D6814 #26017", "notes": "Pallet 9 payment"},
    {"date": "2025-12-16", "amount": 760.05, "ref": "D6832 #25622", "notes": "Shipping difference"},
    {"date": "2025-12-16", "amount": 8000, "ref": "D6876 #26019", "notes": "Extra 20kg Pallet 1"},
    {"date": "2025-12-17", "amount": 3586.93, "ref": "D6887 #26072", "notes": "Shipping Pallet 1"},
    {"date": "2025-12-17", "amount": 8000, "ref": "D6888 #26073", "notes": "Extra 20kg Pallet 2"},
    {"date": "2025-12-19", "amount": 4000, "ref": "D6902 #26139", "notes": "Additional smalls"},
    {"date": "2025-12-22", "amount": 3586.93, "ref": "D6907 #26195", "notes": "Shipping Pallet 2"},
    {"date": "2025-12-23", "amount": 19086.93, "ref": "D6923 #26176", "notes": "Extra product Pallet 3 + shipping"},
    {"date": "2025-12-31", "amount": 23586.93, "ref": "D6941 #26395", "notes": "Pallet 4 extras + shipping"},
]

print(f"\nCreating {len(payments)} payments...")
total_paid = 0
for i, p in enumerate(payments):
    result = api_call("savePayment", {
        "orderID": order_id,
        "paymentDate": p["date"],
        "amount": p["amount"],
        "method": "Wire Transfer",
        "reference": p["ref"],
        "notes": p["notes"]
    })
    total_paid += p["amount"]
    print(f"  [{i+1}/{len(payments)}] {p['date']}: ${p['amount']:,.2f} - {p['ref']}")

print(f"\n{'='*50}")
print(f"IMPORT COMPLETE")
print(f"{'='*50}")
print(f"Order ID: {order_id}")
print(f"Customer: Cannaflora AG")
print(f"Total Commitment: $735,029")
print(f"Shipments Created: {len(shipments)}")
print(f"Payments Created: {len(payments)}")
print(f"Total Paid: ${total_paid:,.2f}")
print(f"Balance Due: ${735029 - total_paid:,.2f}")
