ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_channel TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_slot TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_stock_quantity INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_stock_payload TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_stock_checked_at TIMESTAMPTZ;

ALTER TABLE "print-code" ADD COLUMN IF NOT EXISTS print_use_status TEXT NOT NULL DEFAULT 'unused';
ALTER TABLE "print-code" ADD COLUMN IF NOT EXISTS manufacturer_activation_payload TEXT;
ALTER TABLE "print-code" ADD COLUMN IF NOT EXISTS manufacturer_last_used_at TIMESTAMPTZ;
ALTER TABLE "pickup-code" ADD COLUMN IF NOT EXISTS manufacturer_activation_payload TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='print_code_origin_check') THEN
    ALTER TABLE "print-code" DROP CONSTRAINT print_code_origin_check;
  END IF;
  ALTER TABLE "print-code" ADD CONSTRAINT print_code_origin_check CHECK(code_origin IN ('system','manual','manufacturer'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pickup_code_origin_check') THEN
    ALTER TABLE "pickup-code" DROP CONSTRAINT pickup_code_origin_check;
  END IF;
  ALTER TABLE "pickup-code" ADD CONSTRAINT pickup_code_origin_check CHECK(code_origin IN ('system','manual'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='print_code_print_use_status_check') THEN
    ALTER TABLE "print-code" ADD CONSTRAINT print_code_print_use_status_check CHECK(print_use_status IN ('unused','used'));
  END IF;
END $$;
