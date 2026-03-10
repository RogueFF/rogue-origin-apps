"""Screenshot the T-Cards page and generate a print-ready PDF."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/tpm-tcards.html"
SCREENSHOT = "/tmp/tcard-screenshot.png"
PDF_OUT = "C:/Users/Koasm/Desktop/tpm-tcards-v3.pdf"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Screenshot of screen view
    page = browser.new_page(viewport={"width": 1200, "height": 900})
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.screenshot(path=SCREENSHOT, full_page=True)
    print(f"Screenshot saved: {SCREENSHOT}")

    # PDF generation - letter portrait to match PPTX template (7.5x10 content)
    pdf_page = browser.new_page()
    pdf_page.goto(URL)
    pdf_page.wait_for_load_state("networkidle")
    pdf_page.pdf(
        path=PDF_OUT,
        format="Letter",
        landscape=False,
        margin={"top": "0.5in", "right": "0.5in", "bottom": "0.5in", "left": "0.5in"},
        print_background=True,
    )
    print(f"PDF saved: {PDF_OUT}")

    browser.close()
