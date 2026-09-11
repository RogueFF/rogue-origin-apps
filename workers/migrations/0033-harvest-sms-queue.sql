-- Capataz v2: the inbox is now a queue the FERN relay drains, in the shape of
-- riego-whatsapp-mailbox's wa_inbox. Commands (EMPEZAR/PARAR/AYUDA) are still
-- answered inline by the worker and land here already processed; chat texts
-- wait for the relay. Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v2)
ALTER TABLE harvest_sms_inbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';       -- 'command' | 'chat'
ALTER TABLE harvest_sms_inbox ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE harvest_sms_inbox ADD COLUMN delivered_at TEXT;
ALTER TABLE harvest_sms_inbox ADD COLUMN replied_at TEXT;
CREATE INDEX IF NOT EXISTS idx_harvest_sms_inbox_queue ON harvest_sms_inbox(processed, received_at);
