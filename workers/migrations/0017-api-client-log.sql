-- Rollup of who calls the API, to inform what goes behind auth.
--
-- One row per distinct caller (path + action + origin + user-agent), not one
-- per request, so a display polling every 3 seconds contributes a single row
-- and then only increments `requests`. No IP addresses are stored.
CREATE TABLE IF NOT EXISTS api_client_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  referer TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  ua_hash TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 1,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(path, action, origin, ua_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_client_log_last_seen ON api_client_log(last_seen DESC);
