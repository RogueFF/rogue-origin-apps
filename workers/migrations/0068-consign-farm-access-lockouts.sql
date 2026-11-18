-- Cap on PIN guesses for a farm's link (Koa 2026-11-17: "Yes, add the cap").
-- lockouts counts 15-minute locks in a row with no correct PIN in between. At three,
-- the link is turned off and the farm needs a new link from the owner.
ALTER TABLE cl_farm_access ADD COLUMN lockouts INTEGER NOT NULL DEFAULT 0;
