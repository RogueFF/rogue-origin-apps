-- Sack scan-out (docs/plans/2026-10-06-sack-scan-out-design.md).
-- opened_at stays THE "left inventory" timestamp; these say where it went and how.
ALTER TABLE harvest_sacks ADD COLUMN out_order_id TEXT;      -- orders.id, NULL = stock
ALTER TABLE harvest_sacks ADD COLUMN out_order_source TEXT;  -- 'queue' | 'manual' | NULL
ALTER TABLE harvest_sacks ADD COLUMN out_by TEXT;            -- 'scan' | 'typed' | 'page'
