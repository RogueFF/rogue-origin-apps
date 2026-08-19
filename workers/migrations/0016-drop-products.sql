-- Drop the products table, orphaned with the Barcode/Label Printer.
--
-- 362 rows, last written 2026-01-19. Verified unreferenced two ways: no SQL
-- statement names it, and no call of the insert(env.DB, 'products', ...)
-- helper form either. Its only reader was handlers/barcode-d1.js, which was
-- removed with the app. No foreign key pointed at it.
--
-- Rows and schema exported to
-- ~/Desktop/rogue-scrub-backup/dropped-tables-2026-08-19/ before the drop.
DROP TABLE IF EXISTS products;
