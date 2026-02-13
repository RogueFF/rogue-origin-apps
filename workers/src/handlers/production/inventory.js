/**
 * Inventory webhook handler.
 */

import { insert } from '../../lib/db.js';
import { appendSheet } from '../../lib/sheets.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { SHEETS, incrementDataVersion } from '../../lib/production-utils.js';

async function inventoryWebhook(body, env, request) {
  const webhookSecret = env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = request?.headers?.get('X-Webhook-Secret');
    const url = new URL(request?.url || 'http://localhost');
    const paramSecret = url.searchParams.get('secret');

    if (headerSecret !== webhookSecret && paramSecret !== webhookSecret) {
      console.warn('Webhook rejected: invalid or missing secret');
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }
  }

  const data = body.data || body;

  const product = data.product || {};
  const variant = data.variant || {};
  const inventory = data.inventory || {};
  const context = data.context || {};

  const timestamp = data.Timestamp || data.timestamp || inventory.updated_at || new Date().toISOString();
  const sku = data.SKU || data.sku || variant.sku || '';
  const productName = data['Product Name'] || data.product_name || product.title || '';
  const variantTitle = data['Variant Title'] || data.variant_title || variant.title || '';
  const strainName = data['Strain Name'] || data.strain_name || '';

  let size = data.Size || data.size || '';
  if (!size && variant.weight && variant.weight_unit) {
    const weight = parseFloat(variant.weight);
    const unit = String(variant.weight_unit).toLowerCase();
    if (unit.includes('kilogram') || unit === 'kg') {
      if (Math.abs(weight - 5) < 0.25) {
        size = '5kg';
      } else {
        size = `${weight}kg`;
      }
    } else if (unit.includes('pound') || unit === 'lb') {
      if (Math.abs(weight - 11) < 0.5) {
        size = '5kg';
      } else if (Math.abs(weight - 10) < 0.5) {
        size = '10lb';
      } else {
        size = `${weight}lb`;
      }
    }
  }
  if (!size && variantTitle) {
    const match = variantTitle.match(/(\d+)\s*kg/i);
    if (match) size = `${match[1]}kg`;
  }

  const quantityAdjusted = parseInt(data['Quantity Adjusted'] || data.quantity_adjusted || 0, 10);
  const newTotalAvailable = parseInt(data['New Total Available'] || data.new_total_available || inventory.available_quantity || 0, 10);
  const previousAvailable = parseInt(data['Previous Available'] || data.previous_available || 0, 10);
  const location = data.Location || data.location || inventory.location_name || '';
  const productType = data['Product Type'] || data.product_type || product.type || '';
  const barcode = data.Barcode || data.barcode || variant.barcode || '';
  const price = parseFloat(data.Price || data.price || variant.price || 0);
  const flowRunId = data['Flow Run ID'] || data.flow_run_id || context.flow_run_id || `manual-${Date.now()}`;
  const eventType = data['Event Type'] || data.event_type || 'inventory_adjustment';
  const adjustmentSource = data['Adjustment Source'] || data.adjustment_source || context.source || '';
  const normalizedStrain = data['Normalized Strain'] || data.normalized_strain || '';

  const errors = [];
  let d1Success = false;
  let sheetsSuccess = false;

  try {
    await insert(env.DB, 'inventory_adjustments', {
      timestamp,
      sku,
      product_name: productName,
      variant_title: variantTitle,
      strain_name: strainName,
      size,
      quantity_adjusted: quantityAdjusted,
      new_total_available: newTotalAvailable,
      previous_available: previousAvailable,
      location,
      product_type: productType,
      barcode,
      price,
      flow_run_id: flowRunId,
      event_type: eventType,
      adjustment_source: adjustmentSource,
      normalized_strain: normalizedStrain,
    });
    d1Success = true;
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      d1Success = true;
    } else {
      errors.push(`D1 error: ${err.message}`);
    }
  }

  try {
    const sheetId = env.PRODUCTION_SHEET_ID;

    const row = [
      timestamp,
      sku,
      productName,
      variantTitle,
      strainName,
      size,
      quantityAdjusted > 0 ? `+${quantityAdjusted}` : String(quantityAdjusted),
      newTotalAvailable,
      previousAvailable,
      location,
      productType,
      barcode,
      price,
      flowRunId,
      eventType,
      adjustmentSource,
      normalizedStrain,
    ];

    await appendSheet(sheetId, `'${SHEETS.tracking}'!A:Q`, [row], env);
    sheetsSuccess = true;
  } catch (err) {
    errors.push(`Sheets error: ${err.message}`);
  }

  if (d1Success && sheetsSuccess) {
    await incrementDataVersion(env);
    return successResponse({
      success: true,
      message: 'Inventory adjustment recorded (D1 + Sheets)',
      flowRunId,
      sku,
      quantityAdjusted,
    });
  } else if (d1Success || sheetsSuccess) {
    await incrementDataVersion(env);
    return successResponse({
      success: true,
      partial: true,
      message: `Recorded to ${d1Success ? 'D1' : ''}${d1Success && sheetsSuccess ? ' + ' : ''}${sheetsSuccess ? 'Sheets' : ''}`,
      errors,
      flowRunId,
    });
  } else {
    return errorResponse(`Failed to record: ${errors.join('; ')}`, 'INTERNAL_ERROR', 500);
  }
}

export { inventoryWebhook };
