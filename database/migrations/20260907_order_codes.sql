-- Additive migration; run only after reviewing the live schema.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_snapshot TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider_id TEXT;
CREATE INDEX IF NOT EXISTS order_payment_provider_idx ON orders(payment_provider_id) WHERE payment_provider_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS order_code_registry (
  code TEXT PRIMARY KEY CHECK (code ~ '^[0-9]{6}$')
);
-- Reserve legacy codes too; retained after deletion to prevent accidental reuse.
INSERT INTO order_code_registry(code)
SELECT print_code FROM orders WHERE print_code ~ '^[0-9]{6}$'
UNION SELECT pickup_code FROM orders WHERE pickup_code ~ '^[0-9]{6}$'
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS "print-code" (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE REFERENCES order_code_registry(code),
  use_status TEXT NOT NULL DEFAULT 'inactive' CHECK (use_status IN ('inactive','active')),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('success','fail','pending')),
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  order_item_id TEXT REFERENCES order_items(order_item_id),
  product_id TEXT,
  unit_number INTEGER CHECK (unit_number > 0),
  confirm_version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_item_id, unit_number)
);
CREATE TABLE IF NOT EXISTS "pickup-code" (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE REFERENCES order_code_registry(code),
  use_status TEXT NOT NULL DEFAULT 'inactive' CHECK (use_status IN ('inactive','active')),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('success','fail','pending')),
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(order_id),
  confirm_version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_code_order_idx ON "print-code"(order_id);
CREATE TABLE IF NOT EXISTS order_code_sync_state (
  name TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT ''
);
INSERT INTO order_code_sync_state(name) VALUES ('manufacturer') ON CONFLICT DO NOTHING;
-- No anonymous Supabase access: manufacturer reads through our authenticated API.
ALTER TABLE "print-code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pickup-code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_code_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_code_sync_state ENABLE ROW LEVEL SECURITY;
