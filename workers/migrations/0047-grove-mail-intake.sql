-- Timestamp standard: every `at`/`*_at` value is ISO 8601 as new Date().toISOString() writes it; inserts set it explicitly.
-- Grove email intake + delivery tracking.
-- Design: docs/plans/2026-10-14-grove-bins-design.md §9b / §10b
--
-- A reorder request now carries what Grove's own emails say about it: how many
-- bags were ordered, the tracking number and carrier, when it shipped, when it
-- is expected and when the carrier said it was delivered. Nothing here changes
-- the open|ordered state machine of 0013.

ALTER TABLE kanban_reorder_requests ADD COLUMN qty_ordered         INTEGER;  -- bags, from the order/shipping email
ALTER TABLE kanban_reorder_requests ADD COLUMN tracking_no         TEXT;
ALTER TABLE kanban_reorder_requests ADD COLUMN carrier             TEXT;     -- ups | fedex | usps | other
ALTER TABLE kanban_reorder_requests ADD COLUMN expected_at         TEXT;     -- ISO; carrier estimate, else shipped_at + transit
ALTER TABLE kanban_reorder_requests ADD COLUMN vendor_ref          TEXT;     -- Grove order / invoice number
ALTER TABLE kanban_reorder_requests ADD COLUMN shipped_at          TEXT;     -- ISO
ALTER TABLE kanban_reorder_requests ADD COLUMN delivered_at        TEXT;     -- ISO, from the tracking callback
ALTER TABLE kanban_reorder_requests ADD COLUMN overdue_notified_at TEXT;     -- ISO; the daily cron tells Koa once per request

-- Lookup by the carrier's number when a tracking event lands.
CREATE INDEX IF NOT EXISTS idx_krr_tracking ON kanban_reorder_requests(tracking_no);

-- Every Grove email the poller forwarded, with what the parser made of it.
-- status: parsed (recognised, nothing applied yet) | applied (request updated)
--         | needs_review (size, qty or tracking missing — Koa was told)
--         | ignored (Koa marked it handled, or it was not a Grove order mail)
CREATE TABLE IF NOT EXISTS kanban_inbound_mail (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT,                              -- Gmail message id; the dedupe key
  received_at TEXT NOT NULL,                     -- ISO, the email's own date
  from_addr   TEXT,
  subject     TEXT,
  body_text   TEXT,
  parsed_json TEXT,                              -- parser output, including `missing`
  status      TEXT NOT NULL DEFAULT 'needs_review',
  request_id  INTEGER,                           -- kanban_reorder_requests.id it was applied to
  handled_at  TEXT,
  handled_by  TEXT,
  at          TEXT NOT NULL                      -- ISO, when the worker stored it
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kim_message ON kanban_inbound_mail(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kim_status ON kanban_inbound_mail(status, received_at);
