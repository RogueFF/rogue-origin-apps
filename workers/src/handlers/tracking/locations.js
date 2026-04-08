/**
 * Tracking Locations CRUD
 * Manages physical locations: farms, greenhouses, fields, barns, zones, rooms
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'listLocations':
      return await listLocations(request, env);
    case 'getLocation':
      return await getLocation(request, env);
    case 'createLocation':
      return await createLocation(request, env);
    case 'updateLocation':
      return await updateLocation(request, env);
    case 'deleteLocation':
      return await deleteLocation(request, env);
    case 'seedLocations':
      return await seedLocations(request, env);
    default:
      throw new ApiError(`Unknown location action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function listLocations(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const parentId = url.searchParams.get('parent_id');

  let query = 'SELECT * FROM tracking_locations WHERE 1=1';
  const params = [];

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (parentId) {
    query += ' AND parent_id = ?';
    params.push(parentId);
  }

  query += ' ORDER BY name ASC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ locations: results });
}

async function getLocation(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    throw new ApiError('Missing id parameter', 'BAD_REQUEST', 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tracking_locations WHERE id = ?'
  ).bind(id).all();

  if (results.length === 0) {
    throw new ApiError('Location not found', 'NOT_FOUND', 404);
  }

  return jsonResponse({ location: results[0] });
}

async function createLocation(request, env) {
  const body = await request.json();
  const { name, type, capacity, capacity_unit, drying_method, parent_id, notes } = body;

  if (!name || !type) {
    throw new ApiError('Missing required fields: name, type', 'BAD_REQUEST', 400);
  }

  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO tracking_locations (id, name, type, capacity, capacity_unit, drying_method, parent_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, name, type, capacity || null, capacity_unit || null, drying_method || null, parent_id || null, notes || null).run();

  return jsonResponse({ location: { id, name, type, capacity, capacity_unit, drying_method, parent_id, notes } });
}

async function updateLocation(request, env) {
  const body = await request.json();
  const { id, ...fields } = body;

  if (!id) {
    throw new ApiError('Missing id', 'BAD_REQUEST', 400);
  }

  const allowedFields = ['name', 'type', 'capacity', 'capacity_unit', 'drying_method', 'parent_id', 'notes'];
  const updates = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (updates.length === 0) {
    throw new ApiError('No fields to update', 'BAD_REQUEST', 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  await env.DB.prepare(`
    UPDATE tracking_locations SET ${updates.join(', ')} WHERE id = ?
  `).bind(...params).run();

  return jsonResponse({ updated: true });
}

async function deleteLocation(request, env) {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    throw new ApiError('Missing id', 'BAD_REQUEST', 400);
  }

  // Check for child locations
  const children = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM tracking_locations WHERE parent_id = ?'
  ).bind(id).first();

  if (children.count > 0) {
    throw new ApiError(
      `Cannot delete: ${children.count} child location(s) depend on this location. Reassign or delete them first.`,
      'BAD_REQUEST', 400
    );
  }

  // Check for lots currently at this location
  const lots = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM tracking_lots WHERE current_location_id = ?'
  ).bind(id).first();

  if (lots.count > 0) {
    throw new ApiError(
      `Cannot delete: ${lots.count} lot(s) are currently at this location. Move them first.`,
      'BAD_REQUEST', 400
    );
  }

  await env.DB.prepare('DELETE FROM tracking_locations WHERE id = ?').bind(id).run();
  return jsonResponse({ deleted: true });
}

async function seedLocations(request, env) {
  // Idempotency guard: don't re-seed if locations already exist
  const existing = await env.DB.prepare('SELECT COUNT(*) as count FROM tracking_locations').first();
  if (existing.count > 0) {
    return jsonResponse({ seeded: false, message: 'Locations already exist. Delete existing locations first or use the form to add new ones.' });
  }

  const statements = [];

  // Farm
  const farmId = generateId();
  statements.push(env.DB.prepare(
    'INSERT INTO tracking_locations (id, name, type) VALUES (?, ?, ?)'
  ).bind(farmId, 'Mcloughlin Farm', 'farm'));

  // Greenhouse 1
  const ghId = generateId();
  statements.push(env.DB.prepare(
    'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(ghId, 'Greenhouse 1', 'greenhouse', farmId));

  // Fields A-N with zone children
  const fieldLetters = 'ABCDEFGHIJKLMN'.split('');
  for (const letter of fieldLetters) {
    const fieldId = generateId();
    statements.push(env.DB.prepare(
      'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
    ).bind(fieldId, `Field ${letter}`, 'field', farmId));

    const zoneId = generateId();
    statements.push(env.DB.prepare(
      'INSERT INTO tracking_locations (id, name, type, capacity, capacity_unit, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(zoneId, `Field ${letter} Zone 1`, 'zone', 1750, 'plants', fieldId));
  }

  // Upper Barn with 4 rooms
  const upperBarnId = generateId();
  statements.push(env.DB.prepare(
    'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(upperBarnId, 'Upper Barn', 'barn', farmId));

  for (let i = 1; i <= 4; i++) {
    const roomId = generateId();
    statements.push(env.DB.prepare(
      'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
    ).bind(roomId, `Upper Barn Room ${i}`, 'barn_room', upperBarnId));
  }

  // Bottom Barn with Side A Zone 1-3 and Side B Zone 1-3
  const bottomBarnId = generateId();
  statements.push(env.DB.prepare(
    'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
  ).bind(bottomBarnId, 'Bottom Barn', 'barn', farmId));

  for (const side of ['A', 'B']) {
    for (let z = 1; z <= 3; z++) {
      const roomId = generateId();
      statements.push(env.DB.prepare(
        'INSERT INTO tracking_locations (id, name, type, parent_id) VALUES (?, ?, ?, ?)'
      ).bind(roomId, `Side ${side} Zone ${z}`, 'barn_room', bottomBarnId));
    }
  }

  await env.DB.batch(statements);

  return jsonResponse({ seeded: true, count: statements.length });
}
