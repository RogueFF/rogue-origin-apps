-- Migration 0007: Drop seed-to-sale Field Tracking Hub tables
-- The Field Tracking Hub feature was discontinued (never went live).
-- Created by migration 0004-tracking-tables.sql; superseded here.
-- Dropped in FK-safe order (children before parents). IF EXISTS for idempotency
-- and so a fresh DB (where 0004 was never applied) does not error.

DROP TABLE IF EXISTS tracking_lot_lineage;
DROP TABLE IF EXISTS tracking_stage_transitions;
DROP TABLE IF EXISTS tracking_observations;
DROP TABLE IF EXISTS tracking_environmental;
DROP TABLE IF EXISTS tracking_inputs;
DROP TABLE IF EXISTS tracking_planting_passes;
DROP TABLE IF EXISTS tracking_replants;
DROP TABLE IF EXISTS tracking_lots;
DROP TABLE IF EXISTS tracking_locations;
