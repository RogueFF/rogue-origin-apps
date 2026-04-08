/**
 * Simple sortable ID generator (ULID-like)
 */
export function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${ts}-${rand}`;
}
