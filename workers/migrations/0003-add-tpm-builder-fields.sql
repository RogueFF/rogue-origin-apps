-- Add builder-specific TPM card fields so annotations and custom hazard/PPE text persist
ALTER TABLE tpm_cards ADD COLUMN desc_image TEXT;
ALTER TABLE tpm_cards ADD COLUMN instr_image TEXT;
ALTER TABLE tpm_cards ADD COLUMN ppe_other TEXT;
ALTER TABLE tpm_cards ADD COLUMN hazard_other TEXT;