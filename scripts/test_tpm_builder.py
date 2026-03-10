"""Screenshot TPM builder page to verify it loads."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844})  # iPhone 14 size
    page.goto("http://localhost:8080/tpm-builder.html")
    page.wait_for_load_state("networkidle")
    page.screenshot(path="/tmp/tpm-builder-mobile.png", full_page=True)
    print("Mobile screenshot saved")

    page2 = browser.new_page(viewport={"width": 1200, "height": 900})
    page2.goto("http://localhost:8080/tpm-builder.html")
    page2.wait_for_load_state("networkidle")
    page2.screenshot(path="/tmp/tpm-builder-desktop.png", full_page=True)
    print("Desktop screenshot saved")
    browser.close()
