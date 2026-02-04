-- Add batch_id to consignment_intakes for grouping multi-line intakes
ALTER TABLE consignment_intakes ADD COLUMN batch_id TEXT;

-- Create index for faster batch queries
CREATE INDEX IF NOT EXISTS idx_consignment_intakes_batch ON consignment_intakes(batch_id);
