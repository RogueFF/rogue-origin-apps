-- Scale node battery and Wi-Fi signal (Koa 2026-11-10: "Are we able to see
-- feather battery % somewhere too?"). The Feather ESP32 V2 reads its own LiPo
-- through the VBAT divider on GPIO 35 and sends it with each post (firmware
-- v6.5+), with its Wi-Fi RSSI. The Worker keeps the latest per station and
-- turns millivolts into a percent (lib/battery.js).
--
--   scale_readings.batt_mv    battery millivolts, latest
--   scale_readings.rssi       Wi-Fi signal, dBm, latest
--   scale_readings.batt_at    when the node last sent them (UTC, SQLite text)
--   scale_stations.batt_low_at  when the low-battery Telegram went out; cleared
--                               once the battery reads charged again
--
-- ALTER TABLE ADD COLUMN can't be repeated: apply ONCE, by hand.
--   cd workers && npx wrangler d1 execute rogue-origin-db --remote --file=migrations/0055-scale-node-battery.sql
-- Until it is applied the Worker ignores the new fields; nothing breaks.

ALTER TABLE scale_readings ADD COLUMN batt_mv INTEGER;
ALTER TABLE scale_readings ADD COLUMN rssi INTEGER;
ALTER TABLE scale_readings ADD COLUMN batt_at TEXT;
ALTER TABLE scale_stations ADD COLUMN batt_low_at TEXT;
