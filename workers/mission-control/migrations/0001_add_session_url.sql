-- Migration: Add session_url column to tasks table
-- This column stores the dispatch session viewer deep-link URL.
-- Dispatch writes it on start; MC UI renders it as a Live/Session badge.
ALTER TABLE tasks ADD COLUMN session_url TEXT;
