-- Reset all consignment data for fresh start
DELETE FROM consignment_sales;
DELETE FROM consignment_intakes;
DELETE FROM consignment_payments;
DELETE FROM consignment_partners;

-- Clear old strains and re-seed with actual cultivar names used by farms
DELETE FROM consignment_strains;
INSERT INTO consignment_strains (name) VALUES
  ('Alium OG'),
  ('Bubba Kush'),
  ('Cake Berry Brulee'),
  ('Critical Berries'),
  ('Lemon Octane'),
  ('Orange Fritter'),
  ('Puff Pastries'),
  ('Royal OG'),
  ('Sour Brulee'),
  ('Sour Lifter'),
  ('Sour Special Sauce'),
  ('Sour Suver Haze'),
  ('Super Sour Space'),
  ('White CBG');
