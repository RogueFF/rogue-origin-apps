-- Every part a supersack breaks into, not just tops and smalls.
--
-- A sack holds whole dried branches. Bucking and trimming split it into tops,
-- smalls, biomass and trim -- and the floor already records all four per day
-- per strain in `supersack_entries`, alongside a fifth column, waste. Recording
-- only two of them threw away most of what a lot actually produced (Koa,
-- 2026-09-02).
--
-- WASTE IS NOT A MEASUREMENT. `supersack_entries` derives it as
--     waste = raw - tops - smalls - biomass - trim,  raw = sacks x 37
-- so it is the plug that absorbs every error in the other four, plus the known
-- overstatement from the light last sack off each rack. It is stored because
-- the material balance is worth having, and stamped apart from the rest so it
-- is never read as something anyone weighed.
--
-- A consequence worth stating so nobody later builds a check on it: the five
-- parts sum to 37 lb BY CONSTRUCTION, because waste is defined to make them.
-- That identity can never fail, so it reconciles nothing.

ALTER TABLE harvest_sacks ADD COLUMN biomass_lbs REAL;
ALTER TABLE harvest_sacks ADD COLUMN trim_lbs REAL;
ALTER TABLE harvest_sacks ADD COLUMN waste_lbs REAL;   -- derived residual, see above
