/**
 * Which trim seat each scale station sits at (Koa 2026-11-25: "diego is actually at
 * cell 2"). A scale node posts under the station id it was set up with (table1 was
 * built for the old Cell 1), but the line's seats are numbered by where they are on
 * the floor (cells floor.mjs: 1 top-left, 2 below it, 3 top, ...). A station not
 * listed here is at the seat its number says. One place for the seat screen's
 * header, the Cells board's floor and panel, and the seat QR cards.
 */
export const STATION_SEAT = { table1: 2, table2: 1 };

/** The seat number a station is at. */
export function seatOf(stationId) {
  const id = String(stationId || '');
  if (STATION_SEAT[id]) return STATION_SEAT[id];
  const n = Number((id.match(/\d+/) || [])[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The station at seat n. */
export function stationAt(n) {
  const hit = Object.entries(STATION_SEAT).find(([, seat]) => seat === n);
  return hit ? hit[0] : `table${n}`;
}
