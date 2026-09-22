CREATE TABLE IF NOT EXISTS coupon_events (
  coupon_id TEXT NOT NULL REFERENCES coupons(coupon_id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, event_id)
);

CREATE INDEX IF NOT EXISTS coupon_events_event_idx ON coupon_events(event_id, coupon_id);
ALTER TABLE coupon_events ENABLE ROW LEVEL SECURITY;
