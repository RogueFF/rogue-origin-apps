-- Grove reorder alerts — vendor-routed reorder requests
-- See docs/plans/2026-08-10-grove-reorder-alert-design.md
--
-- Grove supplies are reordered by Damon on his own track, not through the
-- Friday cart. Scanning a Grove card writes a request row here and emails him
-- instead of touching kanban_cart.

CREATE TABLE IF NOT EXISTS kanban_reorder_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL,
  requested_at  TEXT DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'open',     -- open | ordered
  -- notify_state is what makes a request retryable: the row is committed before
  -- the send is attempted, so a failed email leaves a visible record instead of
  -- vanishing.
  notify_state  TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  notify_error  TEXT,
  close_token   TEXT NOT NULL,
  closed_at     TEXT,
  closed_by     TEXT,
  FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE
);

-- The dedup rule, enforced by the database rather than by application logic:
-- at most one OPEN request per card. A re-scan cannot create a second row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_krr_one_open
  ON kanban_reorder_requests(card_id) WHERE status = 'open';

-- Lookup by the token embedded in Damon's "mark as ordered" link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_krr_close_token
  ON kanban_reorder_requests(close_token);

CREATE INDEX IF NOT EXISTS idx_krr_status_requested
  ON kanban_reorder_requests(status, requested_at);
