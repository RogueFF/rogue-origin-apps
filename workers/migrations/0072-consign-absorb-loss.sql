-- "We absorb the loss" per lot (Koa 2026-11-18: "Most times we eat the loss, sometimes we
-- don't. On consignment, we usually pay out on after-loss amounts").
-- absorb_loss = 1 on a lot owed on dropoff: it is paid on the dropoff weight, and the
-- screening numbers still show the loss. 0: paid on the after-loss numbers (a credit to us
-- when it was paid up front). It has no effect on a lot owed as sold.
ALTER TABLE cl_lots ADD COLUMN absorb_loss INTEGER NOT NULL DEFAULT 0;
-- Lots already owed on dropoff take the usual case.
UPDATE cl_lots SET absorb_loss = 1 WHERE term = 'dropoff';
