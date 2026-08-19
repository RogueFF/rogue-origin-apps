-- Drop tables left orphaned by the app cleanup.
--
--   tpm_cards      — the TPM Card Builder was retired
--   price_history  — only read by orders/financials.js, which went with the
--                    wholesale-orders UI
--   coa_index      — only read by orders/coa.js, same; it was empty anyway
--
-- The pool tables (bins, bin_balances, pool_transactions) lived in
-- mission-control-db and were dropped there directly; pool-schema.sql, which
-- created them, is removed in the same commit.
--
-- Deliberately NOT dropped: customers, because orders has a foreign key to it
-- and orders is being kept for the replacement order queue.
DROP TABLE IF EXISTS tpm_cards;
DROP TABLE IF EXISTS price_history;
DROP TABLE IF EXISTS coa_index;
