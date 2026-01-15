// @ts-check
const { test, expect } = require('@playwright/test');

const ORDERS_URL = 'https://rogueff.github.io/rogue-origin-apps/src/pages/orders.html';

test.describe('Document Generation Tests', () => {

  test('should load orders page and test document generation', async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => {
      console.log(`[Browser ${msg.type()}]: ${msg.text()}`);
    });

    // Track downloads
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);

    console.log('Navigating to orders page...');
    await page.goto(ORDERS_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Take screenshot of initial state
    await page.screenshot({ path: 'tests/screenshots/orders-initial.png' });
    console.log('Screenshot saved: orders-initial.png');

    // Handle password authentication
    console.log('Looking for password input...');
    const passwordInput = page.locator('input[placeholder*="password"], input[type="password"]');
    if (await passwordInput.count() > 0) {
      console.log('Password input found, authenticating...');
      await passwordInput.fill('13003Hwy62');

      // Click Unlock button
      const unlockBtn = page.locator('button:has-text("Unlock")');
      if (await unlockBtn.count() > 0) {
        await unlockBtn.click();
        console.log('Clicked Unlock button');
        await page.waitForTimeout(5000); // Wait for data to load
      }
    }

    // Wait for orders to load
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/orders-loaded.png' });
    console.log('Screenshot saved: orders-loaded.png');

    // Look for order rows - try multiple selectors
    let orderRows = page.locator('tbody tr');
    let orderCount = await orderRows.count();
    console.log(`Found ${orderCount} table rows`);

    // Filter to only order rows (should have order ID starting with MO-)
    if (orderCount === 0) {
      orderRows = page.locator('tr:has-text("MO-")');
      orderCount = await orderRows.count();
      console.log(`Found ${orderCount} order rows via MO- text`);
    }

    if (orderCount > 0) {
      // Click first order to open detail
      console.log('Opening first order...');
      await orderRows.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'tests/screenshots/order-detail.png' });
      console.log('Screenshot saved: order-detail.png');

      // Click on Shipments tab
      const shipmentsTab = page.locator('button:has-text("Shipments"), [role="tab"]:has-text("Shipments"), .tab:has-text("Shipments")');
      if (await shipmentsTab.count() > 0) {
        console.log('Clicking Shipments tab...');
        await shipmentsTab.first().click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'tests/screenshots/shipments-tab.png' });
        console.log('Screenshot saved: shipments-tab.png');
      }

      // Check if there are existing shipments or create one
      const noShipmentsText = page.locator('text=No shipments yet');
      if (await noShipmentsText.count() > 0) {
        console.log('No shipments exist, creating test shipment...');

        // Click Add Shipment button
        const addShipmentBtn = page.locator('button:has-text("Add Shipment")');
        if (await addShipmentBtn.count() > 0) {
          await addShipmentBtn.click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'tests/screenshots/add-shipment-modal.png' });

          // Scroll down in modal to see Line Items
          const modal = page.locator('#shipment-modal .modal-body, .modal-overlay:visible .modal-body');
          if (await modal.count() > 0) {
            await modal.first().evaluate(el => el.scrollTop = el.scrollHeight);
          }
          await page.waitForTimeout(500);
          await page.screenshot({ path: 'tests/screenshots/modal-scrolled.png' });

          // Find and click Add Line Item button
          const addLineBtn = page.locator('button:has-text("Add Line Item")');
          if (await addLineBtn.count() > 0) {
            console.log('Clicking Add Line Item...');
            await addLineBtn.click();
            await page.waitForTimeout(1000);
            await page.screenshot({ path: 'tests/screenshots/line-item-added.png' });

            // Look for strain select/input
            const strainSelect = page.locator('select').first();
            if (await strainSelect.count() > 0) {
              console.log('Found strain dropdown');
              await strainSelect.selectOption({ index: 1 });
              await page.waitForTimeout(500);
            }

            // Look for quantity input in the line item row
            const lineItemRow = page.locator('.line-item, [class*="line-item"]').last();
            const qtyInputs = lineItemRow.locator('input[type="number"]');
            if (await qtyInputs.count() > 0) {
              await qtyInputs.first().fill('50');
            }
          }

          await page.screenshot({ path: 'tests/screenshots/before-save.png' });

          // Click Save & Generate Docs button (gold button)
          const saveGenDocsBtn = page.locator('button:has-text("Save & Generate")');
          if (await saveGenDocsBtn.count() > 0) {
            console.log('Clicking Save & Generate Docs...');
            await saveGenDocsBtn.click();
            await page.waitForTimeout(10000);
            await page.screenshot({ path: 'tests/screenshots/after-save-generate.png' });
          } else {
            // Fallback to regular save
            const saveBtn = page.locator('button:has-text("Save Shipment")');
            if (await saveBtn.count() > 0) {
              console.log('Clicking Save Shipment...');
              await saveBtn.click();
              await page.waitForTimeout(3000);
              await page.screenshot({ path: 'tests/screenshots/shipment-created.png' });
            }
          }
        }
      }

      // Now look for PDF button on existing shipments
      const pdfButton = page.locator('button:has(.ph-file-pdf), button[title*="Generate Documents"], .btn-icon:has(.ph-file-pdf), button:has(i.ph-file-pdf)');
      const pdfButtonCount = await pdfButton.count();
      console.log(`Found ${pdfButtonCount} PDF buttons`);

      if (pdfButtonCount > 0) {
        console.log('Clicking PDF generate button...');
        await pdfButton.first().click();

        // Wait for document generation (watch for toasts)
        await page.waitForTimeout(8000);
        await page.screenshot({ path: 'tests/screenshots/generating-docs.png' });

        // Check for download
        const download = await downloadPromise;
        if (download) {
          console.log(`Download started: ${download.suggestedFilename()}`);
          const path = await download.path();
          console.log(`Download path: ${path}`);
          await page.screenshot({ path: 'tests/screenshots/download-complete.png' });
        } else {
          console.log('No download detected, checking console for errors...');
          await page.screenshot({ path: 'tests/screenshots/after-wait.png' });
        }
      } else {
        console.log('No PDF button found after shipment creation');
        await page.screenshot({ path: 'tests/screenshots/no-pdf-button.png' });
      }
    } else {
      console.log('No orders found in table');
    }

    // Final screenshot
    await page.screenshot({ path: 'tests/screenshots/doc-gen-final.png' });
    console.log('Test complete');
  });
});
