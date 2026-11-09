-- Cell scale watch (Koa 2026-11-09): a table scale that goes silent mid-shift
-- sends Koa one Telegram message, and one more when it's back. down_since is the
-- last post before the outage, set when the alert goes out and cleared when the
-- scale posts again (workers/src/lib/scale-watch.js, 5-minute cron).
--
-- Run ONCE: ALTER TABLE ADD COLUMN is not idempotent in SQLite. Until it's
-- applied the cron logs an error and sends nothing; nothing else is affected.
-- Apply by hand:
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --command "ALTER TABLE scale_stations ADD COLUMN down_since TEXT"

ALTER TABLE scale_stations ADD COLUMN down_since TEXT;
