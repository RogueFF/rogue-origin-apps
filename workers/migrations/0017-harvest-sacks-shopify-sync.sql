-- Whether a bag's opening has been reflected in the Super Sack Inventory count.
--
-- Opening a bag decrements its cultivar-year variant by 1, so the Shopify count
-- maintains itself instead of being re-counted by hand. That count and
-- harvest_sacks describe the same population from two directions, which is what
-- makes the standing reconciliation (system ~1,318 vs whiteboard 1,232)
-- checkable rather than a standoff between two numbers.
--
-- The sync state is recorded rather than assumed. Three things can go wrong and
-- all of them are silent otherwise: the pool service is down, no variant exists
-- for that cultivar-year, or the decrement half-applied. A bag that was weighed
-- but never decremented has to be findable.
--
-- Recording weights NEVER fails because of this. The weight is the measurement;
-- the decrement is bookkeeping that follows it. Test rows (is_test=1) skip the
-- decrement entirely — test data must not move real inventory.

ALTER TABLE harvest_sacks ADD COLUMN shopify_synced_at TEXT;
ALTER TABLE harvest_sacks ADD COLUMN shopify_sync_error TEXT;
ALTER TABLE harvest_sacks ADD COLUMN shopify_variant_id TEXT;

-- Finds bags that were opened but never made it into the count.
CREATE INDEX IF NOT EXISTS idx_harvest_sacks_unsynced
  ON harvest_sacks(opened_at, shopify_synced_at);
