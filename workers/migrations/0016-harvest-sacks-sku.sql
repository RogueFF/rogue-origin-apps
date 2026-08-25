-- The Shopify supersack SKU a bag belongs to, e.g. SLIFT-SG-SUPRSAK-2026.
--
-- Stored rather than re-derived on read. The SKU is built from the cultivar's
-- sku_prefix, and a prefix could in principle be corrected later; a bag must
-- keep pointing at the SKU it was actually printed and counted against, not at
-- whatever the prefix says today.
--
-- This is the join to the sales side: the Shopify product for a harvested
-- cultivar tracks a COUNT of supersacks (199 on hand), while harvest_sacks
-- tracks the individuals. Same population, two systems — which is what makes
-- the standing raw-sack reconciliation (system ~1,318 vs whiteboard 1,232)
-- checkable instead of a standoff between two numbers.

ALTER TABLE harvest_sacks ADD COLUMN sku TEXT;

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_sku ON harvest_sacks(sku);
