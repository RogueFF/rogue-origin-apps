-- Voiding a sack tag. The likeliest takedown error is double-tapping PRINT TAG:
-- two serials issued, one physical sack. Without a void the lot count silently
-- drifts, and the orphan serial reads later as a LOST sack rather than one that
-- never existed. A voided row explains the gap in the sequence.
--
-- Voided serials are never reused — a gap is safe, a reused number is not.

ALTER TABLE harvest_sacks ADD COLUMN voided_at TEXT;

CREATE INDEX IF NOT EXISTS idx_harvest_sacks_voided ON harvest_sacks(voided_at);
