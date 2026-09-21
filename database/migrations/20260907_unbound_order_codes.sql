-- Preserve foreign keys and per-order uniqueness; NULL allows independent codes.
ALTER TABLE "print-code" ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE "pickup-code" ALTER COLUMN order_id DROP NOT NULL;
