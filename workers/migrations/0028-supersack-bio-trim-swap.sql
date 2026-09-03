-- Premium #1 Trim can never outweigh Biomass (#2 trim).
--
-- A sack's premium fraction is a small share of its bulk trim: across every
-- clean 2026 row it runs about 0.17x biomass and never above 0.27x. From
-- 2026-07-27 to 2026-09-02 the tracker took 49 rows (31 days) where "trim"
-- was 2.5x to 10x "biomass" -- the two weights typed into each other's box.
-- The short labels under each strain read "Bio" and "Trim", and biomass IS
-- trim ("Biomass (trim)" / "Biomasa (recorte)"), so the bulk number landed
-- under Trim. Nothing in between the two populations, so every hit is a swap.
--
-- Applied to rogue-origin-db on 2026-09-03 (49 rows changed). Waste is
-- untouched: it is the remainder of raw minus all four, and a swap does not
-- move the sum. The API and the tracker now refuse the swap, so re-running
-- this is a no-op by construction.
--
-- Independent of 0027 (harvest_sacks columns), which was still unapplied when
-- this ran; the two touch different tables.
UPDATE supersack_entries
SET biomass_lbs = trim_lbs,
    trim_lbs    = biomass_lbs,
    updated_at  = datetime('now')
WHERE trim_lbs > biomass_lbs;
