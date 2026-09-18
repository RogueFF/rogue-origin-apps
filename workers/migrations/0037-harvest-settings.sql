-- Settings the farm can change without a deploy.
--
-- Koa, 2026-09-18: "is there a button i can use to turn test mode on/off?"
-- Test mode was a wrangler.toml value, so every flip was an edit, a commit and
-- a deploy — slow enough that a test day either did not happen or happened on
-- live data, which is the failure this setting exists to prevent.
--
-- ONE ROW PER SETTING, TEXT VALUES. Nothing here is hot: the worker reads this
-- table once per request and caches it for a few seconds, so a flip reaches the
-- crew screens in about the time it takes to walk to them.
--
-- THE FLAG'S ABSENCE IS NOT "OFF". No row means "follow wrangler.toml", so the
-- deployed default still decides until someone deliberately overrides it, and
-- deleting the row hands control back rather than switching the season live.
CREATE TABLE IF NOT EXISTS harvest_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now')),
  updated_by  TEXT
);
