-- Capataz v3: WhatsApp transport, reusing riego-whatsapp-mailbox as the Meta
-- broker. channel picks which lib does the outbound send, and (on
-- harvest_sms_inbox) which inbound source a row came from: the Twilio webhook
-- push, or the tick's WhatsApp mailbox drain.
-- Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v3)
ALTER TABLE harvest_foremen ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE harvest_sms_inbox ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
