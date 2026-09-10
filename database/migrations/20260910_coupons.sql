ALTER TABLE coupons ADD COLUMN IF NOT EXISTS deal_type TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS coupon_available_items JSONB NOT NULL DEFAULT '[]';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS condition_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS reduce_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS discount NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS rewarded_items JSONB NOT NULL DEFAULT '[]';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS coupon_scene_type JSONB NOT NULL DEFAULT '["商城"]';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS coupon_url TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE coupons SET deal_type=CASE WHEN discount_type='fixed' THEN 'money_off' ELSE 'percent_off' END,
 condition_amount=COALESCE(min_spend,0), reduce_amount=CASE WHEN discount_type='fixed' THEN COALESCE(discount_value,0) ELSE 0 END,
 discount=CASE WHEN discount_type='percentage' THEN LEAST(COALESCE(discount_value,0),100) ELSE 0 END,
 status='unpublished' WHERE deal_type IS NULL;
ALTER TABLE coupons ALTER COLUMN status SET DEFAULT 'unpublished';
CREATE UNIQUE INDEX IF NOT EXISTS coupons_claim_token_idx ON coupons(claim_token) WHERE claim_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS user_coupons (
 user_coupon_id TEXT PRIMARY KEY,
 coupon_id TEXT NOT NULL REFERENCES coupons(coupon_id),
 user_id TEXT NOT NULL REFERENCES users(user_id),
 coupon_use_status TEXT NOT NULL CHECK(coupon_use_status IN ('inactive','unused','used','expired')),
 order_id TEXT REFERENCES orders(order_id),
 checkout_id TEXT,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(coupon_id,user_id)
);
CREATE TABLE IF NOT EXISTS coupon_checkouts (
 checkout_id TEXT PRIMARY KEY,
 user_coupon_id TEXT NOT NULL REFERENCES user_coupons(user_coupon_id),
 user_id TEXT NOT NULL REFERENCES users(user_id),
 order_id TEXT NOT NULL REFERENCES orders(order_id),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','paid','failed')),
 quote JSONB NOT NULL,
 payment_request JSONB NOT NULL,
 payment_result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_coupons_user_idx ON user_coupons(user_id);
ALTER TABLE user_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_checkouts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='coupon_rules_check') THEN
 ALTER TABLE coupons ADD CONSTRAINT coupon_rules_check CHECK(deal_type IN ('money_off','percent_off','buy_x_get_y','free_product') AND condition_amount>=0 AND reduce_amount>=0 AND discount BETWEEN 0 AND 100 AND status IN ('unpublished','published') AND jsonb_typeof(coupon_available_items)='array' AND (status='unpublished' OR jsonb_array_length(coupon_available_items)>0));
 END IF;
END $$;

-- The old event stored nine confirmed product IDs as one string.
UPDATE promotion_discount_events SET target_product_ids='["123","124","125","126","127","128","129","130","131"]',
 price_rule_json=jsonb_set(COALESCE(NULLIF(price_rule_json,'')::jsonb,'{}'),'{target_product_ids}','["123","124","125","126","127","128","129","130","131"]')::text
 WHERE event_id=9 AND target_product_ids='["123 124 125 126 127 128 129 130 131"]';
