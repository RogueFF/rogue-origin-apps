"""Playwright verification of the per-strain biomass/trim UI on the live supersack-entry page.

Mocks all backend calls with predictable data, drives the form, and asserts that
per-strain inputs appear and that submit payloads include per-strain bio/trim.
"""
import json
import sys
from playwright.sync_api import sync_playwright

LIVE_URL = "https://rogueff.github.io/rogue-origin-apps/src/pages/supersack-entry.html"

# Mock data
FAKE_VARIANTS = [
    {"id": "v-lifter", "title": "2025 - Lifter / Sungrown", "quantity": 50, "_inventoryItemId": "i1", "_locationId": "l1", "_poolType": "supersack"},
    {"id": "v-godfather", "title": "2025 - Godfather OG / Sungrown", "quantity": 30, "_inventoryItemId": "i2", "_locationId": "l1", "_poolType": "supersack"},
]
FAKE_POOL_PRODUCTS = [
    {"id": "p-bio", "title": "CBD Biomass (Trim)", "quantity": 1000, "_poolType": "biomass"},
    {"id": "p-trim", "title": "Premium CBD Flower Trim", "quantity": 500, "_poolType": "smalls"},
]
FAKE_SCOREBOARD = {
    "hourlyRates": [
        {"strain": "2025 - Lifter / Sungrown", "lbs": 50, "smalls": 40},
        {"strain": "2025 - Godfather OG / Sungrown", "lbs": 20, "smalls": 15},
    ],
}
FAKE_DASHBOARD = {"daily": [], "strainSnapshot": []}
FAKE_HISTORY = {"entries": []}

captured_submit = {"payload": None}
console_errors = []

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"PAGE ERROR: {e}"))

        def handle_api(route, req):
            url = req.url
            method = req.method
            body = {}
            if "action=get_supersack_variants" in url:
                body = {"variants": FAKE_VARIANTS}
            elif "action=list_products" in url:
                body = {"products": FAKE_POOL_PRODUCTS}
            elif "action=scoreboard" in url:
                body = FAKE_SCOREBOARD
            elif "action=dashboard" in url:
                body = FAKE_DASHBOARD
            elif "action=get_supersack_recent_changes" in url or "action=get_recent_changes" in url:
                body = {"entries": []}
            elif "action=history" in url:
                body = FAKE_HISTORY
            elif "action=submit" in url and method == "POST":
                try:
                    captured_submit["payload"] = json.loads(req.post_data or "{}")
                except Exception as e:
                    captured_submit["payload"] = f"parse-error: {e}"
                body = {"success": True, "entries": 1}
            elif "action=update_supersack_inventory" in url or "action=update_pool" in url:
                body = {"success": True}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        page.route("**/rogue-origin-api.roguefamilyfarms.workers.dev/**", handle_api)

        print(f"Loading {LIVE_URL}")
        page.goto(LIVE_URL)
        page.wait_for_load_state("networkidle", timeout=15000)
        page.wait_for_timeout(800)  # extra time for async state to settle

        # --- ASSERTION 1: page rendered, no JS errors ---
        if console_errors:
            print("FAIL: console errors during load:")
            for e in console_errors[:10]:
                print(f"  {e}")
            sys.exit(1)
        print("PASS: page loaded without JS errors")

        # --- ASSERTION 2: strain counters rendered ---
        rows = page.locator(".strain-row").count()
        if rows < 2:
            print(f"FAIL: expected at least 2 strain rows, got {rows}")
            page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-failed-1.png", full_page=True)
            sys.exit(1)
        print(f"PASS: {rows} strain rows rendered")

        # --- ASSERTION 3: no bio/trim inputs visible yet (sacks=0) ---
        weights_visible = page.locator(".strain-row-weights").count()
        if weights_visible != 0:
            print(f"FAIL: weights row should be hidden at sacks=0, found {weights_visible}")
            sys.exit(1)
        print("PASS: per-strain weight inputs hidden at sacks=0")

        # --- ACTION: add a sack to the first strain ---
        first_inc = page.locator(".strain-row .mini-btn").nth(1)  # nth(1) = the '+' button (nth(0) is '−')
        first_inc.click()
        page.wait_for_timeout(200)

        # --- ASSERTION 4: bio/trim inputs appear for that strain ---
        weights_visible = page.locator(".strain-row-weights").count()
        if weights_visible < 1:
            print(f"FAIL: bio/trim inputs should appear after sack added, got {weights_visible}")
            page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-failed-2.png", full_page=True)
            sys.exit(1)
        print(f"PASS: {weights_visible} weight row(s) appeared after sack increment")

        # --- ACTION: type biomass and trim values ---
        bio_input = page.locator(".strain-weight-input input").nth(0)
        trim_input = page.locator(".strain-weight-input input").nth(1)
        bio_input.fill("25.5")
        bio_input.dispatch_event("change")
        trim_input.fill("3.2")
        trim_input.dispatch_event("change")
        page.wait_for_timeout(200)

        # --- ASSERTION 5: material balance reflects per-strain values ---
        bd_bio = page.locator("#bd-biomass").text_content()
        bd_trim = page.locator("#bd-trim").text_content()
        if "25.5" not in bd_bio or "3.2" not in bd_trim:
            print(f"FAIL: material balance not updated. bio='{bd_bio}', trim='{bd_trim}'")
            page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-failed-3.png", full_page=True)
            sys.exit(1)
        print(f"PASS: material balance updated — bio={bd_bio}, trim={bd_trim}")

        # --- ACTION: add a sack to the SECOND strain too (multi-strain day) ---
        second_inc = page.locator(".strain-row .mini-btn").nth(3)  # row 2 + button
        second_inc.click()
        page.wait_for_timeout(200)

        # Enter per-strain bio/trim for the second strain
        all_bio_inputs = page.locator(".strain-weight-input input")
        # Inputs come in pairs (bio, trim) per strain — strain 1 bio=0, strain 1 trim=1, strain 2 bio=2, strain 2 trim=3
        bio_input_2 = all_bio_inputs.nth(2)
        trim_input_2 = all_bio_inputs.nth(3)
        bio_input_2.fill("12.0")
        bio_input_2.dispatch_event("change")
        trim_input_2.fill("1.5")
        trim_input_2.dispatch_event("change")
        page.wait_for_timeout(200)

        # --- ASSERTION 6: totals summed across both strains ---
        bd_bio = page.locator("#bd-biomass").text_content()
        bd_trim = page.locator("#bd-trim").text_content()
        # 25.5 + 12.0 = 37.5,  3.2 + 1.5 = 4.7
        if "37.5" not in bd_bio or "4.7" not in bd_trim:
            print(f"FAIL: multi-strain sum incorrect. bio='{bd_bio}' (expect 37.5), trim='{bd_trim}' (expect 4.7)")
            page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-failed-4.png", full_page=True)
            sys.exit(1)
        print(f"PASS: per-strain values sum to day-total — bio={bd_bio}, trim={bd_trim}")

        # --- ACTION: click submit, capture payload ---
        page.locator("#submit-btn").click()
        page.wait_for_timeout(2000)  # let pool updates + submit fire

        # --- ASSERTION 7: submit payload includes per-strain biomass/trim ---
        payload = captured_submit["payload"]
        if not payload:
            print("FAIL: submit was not captured (form never POSTed)")
            page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-failed-5.png", full_page=True)
            sys.exit(1)
        if isinstance(payload, str):
            print(f"FAIL: submit payload not JSON parseable: {payload}")
            sys.exit(1)
        strains = payload.get("strains", {})
        print(f"Submit payload strains: {json.dumps(strains, indent=2)}")
        lifter = strains.get("2025 - Lifter / Sungrown") or {}
        godfather = strains.get("2025 - Godfather OG / Sungrown") or {}
        ok = True
        if not isinstance(lifter, dict) or lifter.get("biomass") != 25.5 or lifter.get("trim") != 3.2:
            print(f"FAIL: Lifter strain missing/wrong bio/trim: {lifter}")
            ok = False
        if not isinstance(godfather, dict) or godfather.get("biomass") != 12.0 or godfather.get("trim") != 1.5:
            print(f"FAIL: Godfather strain missing/wrong bio/trim: {godfather}")
            ok = False
        if not ok:
            sys.exit(1)
        print("PASS: submit payload contains correct per-strain biomass/trim values")

        # --- Final screenshot for visual sanity ---
        page.screenshot(path="C:/Users/Koasm/Desktop/Dev/rogue-origin-apps/tools/verify-final.png", full_page=True)
        print("\nALL CHECKS PASS")
        browser.close()

if __name__ == "__main__":
    main()
