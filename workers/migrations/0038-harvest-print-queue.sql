-- Print queue — so the crew can print a tag from ANY phone.
--
-- Why: tag printing is `window.print()` in the crew's browser, which needs a
-- print dialog, a paper size and a margins setting. Chrome on the barn PC has
-- all three. iOS does not — WebKit ignores `@page`, so an iPhone cannot print
-- the edge-to-edge 4x2 tag at all. The crew runs a MIXED iPhone/Android fleet,
-- so iOS is the case that has to work.
--
-- The fix is to stop printing from the phone. The phone asks the server to
-- print; the server queues a job here; an agent on the barn PC drains the queue
-- and drives the printer. The phone only ever makes a web request, which every
-- handset does identically.
--
-- Design + the options rejected (AirPrint, Zebra Weblink):
-- wiki/operations/plans/2026-09-18-wireless-tag-printer.md

-- One row per physical tag that should come out of the printer.
--
-- WRITTEN IN THE SAME TRANSACTION AS THE SACK. Same rule the sack note already
-- follows: a job can never exist for a tag that was not allocated, and cannot
-- survive an allocation that failed.
--
-- status: 'pending'  — queued, nobody has taken it
--         'claimed'  — an agent has it and is printing
--         'done'     — a tag physically came out
--         'failed'   — the agent tried and could not; `error` says why
--
-- reason: 'print'    — a new tag, one new sack row
--         'reprint'  — a jam. SAME serial, NO new sack row. Distinguished so a
--                      reprint never reads as a second bag in any count.
CREATE TABLE IF NOT EXISTS harvest_print_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sack_id     TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'print',
  status      TEXT NOT NULL DEFAULT 'pending',
  is_test     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  claimed_at  TEXT,
  claimed_by  TEXT,
  done_at     TEXT,
  error       TEXT
);

-- The agent's hot path: "anything pending for me?", many times a minute.
CREATE INDEX IF NOT EXISTS idx_harvest_print_queue_pull
  ON harvest_print_queue(status, is_test, id);

-- The screen's path: "did MY tag print?"
CREATE INDEX IF NOT EXISTS idx_harvest_print_queue_sack
  ON harvest_print_queue(sack_id);

-- Which print agents exist and when each last checked in.
--
-- THIS IS A GATE, NOT A DASHBOARD. `sack_alloc` consults it BEFORE spending a
-- serial: if the mode says agent and no agent has checked in recently, printing
-- falls back to the browser rather than queueing a tag nobody will print. A
-- post-hoc "it never printed" message is too late — the number is already gone
-- and the Shopify count already moved.
CREATE TABLE IF NOT EXISTS harvest_print_agents (
  agent_id    TEXT PRIMARY KEY,
  printer     TEXT,
  last_seen   TEXT DEFAULT (datetime('now'))
);

-- Which way tags print. Absent (or anything but 'agent') means the browser
-- prints, exactly as it does today — so this migration changes NOTHING until
-- someone deliberately sets it:
--
--   INSERT INTO harvest_settings (key, value) VALUES ('print_mode', 'agent')
--     ON CONFLICT(key) DO UPDATE SET value = 'agent';
--
-- Resolved per allocation and returned in the sack_alloc response, never baked
-- into the page at render time: a phone can sit on a loaded takedown screen for
-- an hour, and a page-baked decision would have it print via its iframe while
-- the agent printed the same job — two physical tags on one serial, mid-rack.
