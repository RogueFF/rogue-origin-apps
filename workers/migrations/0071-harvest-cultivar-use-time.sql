-- 0071 harvest_cultivars.use_time — the best-time chips on the cultivar board.
--
-- When the flower smokes best: one time (day | night | anytime) or a time
-- paired with anytime (day_anytime | night_anytime). NULL until it is set.
-- The card shows one chip per time, so a pair reads "Daytime" + "Anytime".
-- It can be changed on the card's detail sheet.
--
-- Seeded from Koa's list of 2026-11-18 (farm repo:
-- outputs/cultivar-profiles/best-time-2026.json). Only cultivars already sent
-- for photos need one; the rest stay NULL until they are sent.
-- The WHERE use_time IS NULL guard means a re-run never overwrites a chip
-- that was changed by hand.

ALTER TABLE harvest_cultivars ADD COLUMN use_time TEXT;

UPDATE harvest_cultivars SET use_time = 'day'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'blue-pineapple-quik'
 );

UPDATE harvest_cultivars SET use_time = 'day_anytime'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'cream-cake', 'daiquiri-factory', 'lemon', 'lifter', 'limey-lifter',
  'mandarin-chocolate', 'orange-fritter', 'orange-pineapple-quik',
  'peytons-strawberries', 'puff-pastries', 'purple-snowman', 'rocket-sauce',
  'sauciere', 'sour-brulee', 'sour-diesel', 'sour-lifter',
  'strawberry-doughnuts', 'strawberry-gobbler', 'strawberry-sauce',
  'tahitian', 'tropicana-cherry', 'undead-og'
 );

UPDATE harvest_cultivars SET use_time = 'night'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'bubba-kush', 'gmo-belly', 'gmo-gas', 'platinum-m-a4'
 );

UPDATE harvest_cultivars SET use_time = 'night_anytime'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'animal-muffins', 'critical-berries', 'demi-glaze', 'forbidden',
  'kush-mintz', 'mountain-apple', 'platinum-india', 'rainbow-gmo-quik',
  'royal-og', 'snickerdoodle', 'strawberry-cream', 'strawberry-fritter'
 );

UPDATE harvest_cultivars SET use_time = 'anytime'
 WHERE use_time IS NULL AND cultivar_slug IN (
  'angel-cake', 'key-lime-cbg', 'platinum-delicata', 'rainbow-cake',
  'runtz-bravo', 'spruce-dough', 'white-cbg'
 );
