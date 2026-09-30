-- Which trailer brought a barn load: 1-6, the number on its QR decal.
--
-- Koa, 2026-09-28: one crew, six trailers, and the DRIVER logs each load by
-- scanning the decal on the trailer (/t/<n>) instead of the water spider
-- logging it at a door. The trailer is the fact that actually arrives at the
-- barn, so it is recorded on the load row.
--
-- NULLABLE ON PURPOSE, same reasoning as bay in 0030: every load before this
-- column existed has none, and a load logged at the fallback door page has
-- none either. The bins must never be refused for want of a trailer.
ALTER TABLE harvest_scan_log ADD COLUMN trailer INTEGER;

-- The trailer screen reads this trailer's newest load twice per scan: for its
-- bay default and for the five-minute repeat guard.
CREATE INDEX IF NOT EXISTS idx_harvest_scan_trailer
  ON harvest_scan_log (trailer, is_test, occurred_at);
