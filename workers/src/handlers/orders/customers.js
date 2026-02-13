/**
 * Orders — Customer management
 * getCustomers, saveCustomer, deleteCustomer
 */

import { query, queryOne, insert, update, deleteRows } from '../../lib/db.js';
import { successResponse } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';

async function getCustomers(env) {
  const customers = await query(env.DB, `
    SELECT id, company, name, email, phone, address, city, state, zip, notes, created_at
    FROM customers ORDER BY company
  `);

  return successResponse({
    success: true,
    customers: customers.map(c => ({
      id: c.id,
      companyName: c.company || '',
      contactName: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      shipToAddress: c.address || '',
      billToAddress: c.address || '',
      country: '',
      notes: c.notes || '',
      createdDate: c.created_at,
      lastOrderDate: null,
    }))
  });
}

async function saveCustomer(body, env) {
  if (!body.companyName) throw createError('VALIDATION_ERROR', 'Company name is required');

  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM customers WHERE id = ?', [body.id]) : null;

  if (existing) {
    await update(env.DB, 'customers', {
      company: (body.companyName || ''),
      name: (body.contactName || ''),
      email: (body.email || ''),
      phone: (body.phone || ''),
      address: (body.shipToAddress || ''),
      notes: (body.notes || ''),
    }, 'id = ?', [body.id]);
  } else {
    const count = await query(env.DB, 'SELECT COUNT(*) as cnt FROM customers');
    const newId = body.id || `CUST-${String((count[0]?.cnt || 0) + 1).padStart(3, '0')}`;
    await insert(env.DB, 'customers', {
      id: newId,
      company: (body.companyName || ''),
      name: (body.contactName || ''),
      email: (body.email || ''),
      phone: (body.phone || ''),
      address: (body.shipToAddress || ''),
      notes: (body.notes || ''),
    });
    body.id = newId;
  }

  return successResponse({ success: true, customer: body });
}

async function deleteCustomer(body, env) {
  if (!body.id) throw createError('VALIDATION_ERROR', 'Customer ID is required');
  const changes = await deleteRows(env.DB, 'customers', 'id = ?', [body.id]);
  if (changes === 0) throw createError('NOT_FOUND', 'Customer not found');
  return successResponse({ success: true });
}

export { getCustomers, saveCustomer, deleteCustomer };
