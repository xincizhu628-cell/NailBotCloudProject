ALTER TABLE "print-code" ADD COLUMN IF NOT EXISTS code_origin TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "pickup-code" ADD COLUMN IF NOT EXISTS code_origin TEXT NOT NULL DEFAULT 'system';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='print_code_origin_check') THEN ALTER TABLE "print-code" ADD CONSTRAINT print_code_origin_check CHECK(code_origin IN ('system','manual')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pickup_code_origin_check') THEN ALTER TABLE "pickup-code" ADD CONSTRAINT pickup_code_origin_check CHECK(code_origin IN ('system','manual')); END IF;
END $$;
