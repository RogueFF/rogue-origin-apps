-- Sack notes can be edited.
--
-- Koa, 2026-09-16: on a bag's page, "can you make it so we can edit previous
-- notes". A note is typed on a phone in the barn, so a typo or a wrong bay is
-- the common case, and until now the only fix was a second note contradicting
-- the first.
--
-- edited_at marks a note as changed, so the page can say so — a note that reads
-- differently from what someone remembers should show that it was edited.
--
-- original_note keeps the words as first saved, set on the FIRST edit only and
-- never overwritten. The page shows the current wording; the original stays
-- recoverable, because a note is a record of what someone saw at the time.
ALTER TABLE harvest_sack_notes ADD COLUMN edited_at TEXT;
ALTER TABLE harvest_sack_notes ADD COLUMN original_note TEXT;
