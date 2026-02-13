/**
 * Orders — Scoreboard order queue
 * getScoreboardOrderQueue
 */

import { query } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { count5kgBagsForStrain } from './coa.js';

async function getScoreboardOrderQueue(env) {
  try {
    const orders = await query(env.DB, `SELECT * FROM orders WHERE status NOT IN ('completed', 'cancelled') ORDER BY priority, created_at`);
    const shipments = await query(env.DB, `SELECT * FROM shipments`);

    const topsLineItems = [];

    for (const shipment of shipments) {
      const parentOrder = orders.find(o => o.id === shipment.order_id);
      if (!parentOrder) continue;

      let lineItems = [];
      try { lineItems = JSON.parse(shipment.notes || '[]'); } catch { lineItems = []; }

      for (const item of lineItems) {
        if (item.type && item.type.toLowerCase() === 'tops') {
          topsLineItems.push({
            masterOrderId: parentOrder.id,
            shipmentId: shipment.id,
            customer: parentOrder.customer_id,
            strain: item.strain,
            type: item.type,
            quantityKg: parseFloat(item.quantity) || 0,
            completedKg: parseFloat(item.completedKg) || null,
            adjustmentKg: parseFloat(item.adjustmentKg) || 0,
            startDateTime: shipment.ship_date,
            dueDate: parentOrder.ship_date,
            orderPriority: parentOrder.priority,
            createdDate: parentOrder.created_at,
            invoiceNumber: shipment.invoice_number,
          });
        }
      }
    }

    topsLineItems.sort((a, b) => {
      if (a.orderPriority != null && b.orderPriority != null) return a.orderPriority - b.orderPriority;
      if (a.orderPriority != null) return -1;
      if (b.orderPriority != null) return 1;
      return new Date(a.createdDate) - new Date(b.createdDate);
    });

    const currentItems = [];
    let next = null;
    let currentShipmentId = topsLineItems.length > 0 ? topsLineItems[0].shipmentId : null;

    for (const item of topsLineItems) {
      if (item.shipmentId === currentShipmentId) {
        const bagCount = await count5kgBagsForStrain(item.strain, item.startDateTime, env);
        const bagKg = bagCount * 5;
        const adjustmentKg = item.adjustmentKg || 0;
        let completedKg = item.completedKg != null ? item.completedKg : bagKg + adjustmentKg;
        if (completedKg < 0) completedKg = 0;

        let percentComplete = item.quantityKg > 0 ? Math.round((completedKg / item.quantityKg) * 100) : 0;
        if (percentComplete > 100) percentComplete = 100;

        currentItems.push({
          masterOrderId: item.masterOrderId,
          shipmentId: item.shipmentId,
          customer: item.customer,
          strain: item.strain,
          type: item.type,
          quantityKg: item.quantityKg,
          completedKg,
          percentComplete,
          dueDate: item.dueDate,
          estimatedHoursRemaining: 0,
          invoiceNumber: item.invoiceNumber,
          bagCount,
          bagKg,
          adjustmentKg,
        });
      } else if (!next) {
        next = {
          masterOrderId: item.masterOrderId,
          shipmentId: item.shipmentId,
          customer: item.customer,
          strain: item.strain,
          type: item.type,
          quantityKg: item.quantityKg,
          dueDate: item.dueDate,
          invoiceNumber: item.invoiceNumber,
        };
      }
    }

    return successResponse({
      success: true,
      current: currentItems.length > 0 ? currentItems[0] : null,
      currentItems,
      next,
      queue: {
        totalShipments: topsLineItems.length,
        totalKg: topsLineItems.reduce((sum, item) => sum + item.quantityKg, 0),
      },
    });
  } catch (error) {
    console.error('[getScoreboardOrderQueue] Error:', error.message);
    throw createError('INTERNAL_ERROR', error.message);
  }
}

export { getScoreboardOrderQueue };
