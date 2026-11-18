-- 0071 harvest_cultivars.use_time — the best-time chip on the cultivar board.
--
-- When the flower smokes best: day | night | anytime, NULL until the cultivar
-- has been tasted. It comes from the "Occasion" line of the cultivar tasting
-- notes (rogue-farm-wiki/wiki/products/cultivar-profiles-2026.md) and can be
-- changed on the card's detail sheet afterwards.
--
-- Seeded from the notes as they stood on 2026-11-18. Where a note names two
-- times ("Daytime / any time", "Any time, best at night") the first one named
-- is the chip. Morning counts as day, evening as night, all day as anytime.
-- The WHERE use_time IS NULL guard means a re-run never overwrites a chip that
-- was changed by hand.

ALTER TABLE harvest_cultivars ADD COLUMN use_time TEXT;

UPDATE harvest_cultivars SET use_time = 'day'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'orange-pineapple-quik', 'orange-fritter', 'purple-snowman', 'tahitian',
  'sauciere', 'rocket-sauce', 'limey-lifter', 'mountain-apple',
  'blue-pineapple-quik', 'cream-cake', 'lemon'
 );

UPDATE harvest_cultivars SET use_time = 'night'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'rainbow-gmo-quik', 'strawberry-cream', 'gmo-belly', 'gmo-gas', 'kush-mintz'
 );

UPDATE harvest_cultivars SET use_time = 'anytime'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'mandarin-chocolate', 'sour-lifter', 'strawberry-doughnuts', 'puff-pastries',
  'snickerdoodle', 'critical-berries', 'strawberry-fritter', 'animal-muffins',
  'strawberry-sauce', 'spruce-dough', 'forbidden', 'platinum-delicata'
 );
