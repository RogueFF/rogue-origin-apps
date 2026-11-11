-- 0060: baskets waiting at the pickup spot (Koa 2026-11-11, "Yes, both").
-- Two weight-matched baskets per cell: at the chime the trimmer moves the full
-- basket to a marked pickup spot beside the cell and sets the matched empty one
-- on the scale, which closes the job (a pickup mark). The Cells board shows every
-- pickup not yet collected as "waiting at pickup spot" until bag/tag taps it
-- collected (?action=collectPickup).
-- Everything picked up before this migration counts as collected.
-- Apply by hand: cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0060-pickup-spot.sql
ALTER TABLE scale_marks ADD COLUMN collected_at TEXT;
UPDATE scale_marks SET collected_at = ts WHERE kind = 'pickup';
CREATE INDEX IF NOT EXISTS idx_scale_marks_waiting ON scale_marks(kind, collected_at, ts);
