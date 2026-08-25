-- Whether printing a tag has been reflected in the Super Sack Inventory count.
--
-- Printing a tag means a sack now exists, so the count goes UP by one; opening
-- it later brings the count back down (0017). Between them the Shopify number
-- becomes "sacks tagged and not yet opened" by construction, instead of a
-- figure somebody maintains by hand and re-counts when it drifts.
--
-- Tracked separately from the decrement because both can happen to one bag and
-- either can fail on its own. A bag added but never removed, or removed but
-- never added, are different problems with different fixes — collapsing them
-- into one flag would hide which one occurred.
--
-- Void subtracts back: a voided tag is a number retired without a sack behind
-- it, so leaving the +1 in place would be phantom inventory. Reprint does NOT
-- add again — it is the same sack wearing a new label.

ALTER TABLE harvest_sacks ADD COLUMN shopify_added_at TEXT;
ALTER TABLE harvest_sacks ADD COLUMN shopify_add_error TEXT;

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_unadded
  ON harvest_sacks(shopify_added_at);
