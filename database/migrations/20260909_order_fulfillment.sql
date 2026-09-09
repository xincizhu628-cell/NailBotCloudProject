-- Keep legacy order_status temporarily so older deployed servers remain compatible.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_get_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_status TEXT;
ALTER TABLE orders ALTER COLUMN delivery_status DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN delivery_status DROP DEFAULT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_snapshot TEXT;

CREATE OR REPLACE FUNCTION nail_order_method(snapshot TEXT, fallback TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE method TEXT;
BEGIN
  BEGIN method := NULLIF(snapshot::jsonb->>'pickup_method',''); EXCEPTION WHEN others THEN method := NULL; END;
  method := lower(COALESCE(method,fallback,'both'));
  RETURN CASE WHEN method IN ('shipping','delivery') THEN 'delivery' WHEN method='pickup' THEN 'pickup' ELSE 'both' END;
END $$;

CREATE OR REPLACE FUNCTION nail_order_get_type(target TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*)=0 THEN NULL
    WHEN bool_and(nail_order_method(i.item_snapshot,p.pickup_method)='pickup') THEN 'pickup'
    WHEN bool_and(nail_order_method(i.item_snapshot,p.pickup_method)='delivery') THEN 'delivery'
    ELSE 'both' END
  FROM order_items i LEFT JOIN products p ON p.product_id=i.product_id WHERE i.order_id=target
$$;

UPDATE orders SET order_get_type=nail_order_get_type(order_id) WHERE order_get_type IS NULL;
UPDATE orders SET delivery_status=CASE
  WHEN order_get_type NOT IN ('delivery','both') OR order_get_type IS NULL OR payment_status NOT IN ('paid','completed','COMPLETED') THEN NULL
  WHEN delivery_status IN ('delivered','已送达') THEN '已送达'
  WHEN delivery_status IN ('shipped','in_transit','待送达') THEN '待送达'
  ELSE '待发货' END;
UPDATE orders o SET pickup_status=CASE
  WHEN order_get_type NOT IN ('pickup','both') OR order_get_type IS NULL OR payment_status NOT IN ('paid','completed','COMPLETED') THEN NULL
  WHEN EXISTS(SELECT 1 FROM "pickup-code" c WHERE c.order_id=o.order_id AND c.use_status='active') THEN '已取货'
  ELSE '待取货' END;

CREATE OR REPLACE FUNCTION nail_order_fulfillment_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_get_type IS NULL THEN NEW.order_get_type:=nail_order_get_type(NEW.order_id); END IF;
  IF NEW.payment_status NOT IN ('paid','completed','COMPLETED') THEN
    NEW.delivery_status:=NULL; NEW.pickup_status:=NULL; RETURN NEW;
  END IF;
  IF NEW.order_get_type IN ('delivery','both') THEN
    NEW.delivery_status:=CASE WHEN NEW.delivery_status IN ('delivered','已送达') THEN '已送达'
      WHEN NEW.delivery_status IN ('shipped','in_transit','待送达') THEN '待送达' ELSE '待发货' END;
  ELSE NEW.delivery_status:=NULL; END IF;
  IF NEW.order_get_type IN ('pickup','both') THEN
    NEW.pickup_status:=CASE WHEN EXISTS(SELECT 1 FROM "pickup-code" c WHERE c.order_id=NEW.order_id AND c.use_status='active') THEN '已取货' ELSE '待取货' END;
  ELSE NEW.pickup_status:=NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS order_fulfillment_before ON orders;
CREATE TRIGGER order_fulfillment_before BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION nail_order_fulfillment_before();

CREATE OR REPLACE FUNCTION nail_order_items_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','UPDATE') THEN UPDATE orders SET order_get_type=nail_order_get_type(OLD.order_id) WHERE order_id=OLD.order_id; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN UPDATE orders SET order_get_type=nail_order_get_type(NEW.order_id) WHERE order_id=NEW.order_id; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS order_items_fulfillment ON order_items;
CREATE TRIGGER order_items_fulfillment AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION nail_order_items_fulfillment();

CREATE OR REPLACE FUNCTION nail_pickup_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','UPDATE') AND OLD.order_id IS NOT NULL THEN UPDATE orders SET pickup_status=pickup_status WHERE order_id=OLD.order_id; END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.order_id IS NOT NULL THEN UPDATE orders SET pickup_status=pickup_status WHERE order_id=NEW.order_id; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS pickup_fulfillment ON "pickup-code";
CREATE TRIGGER pickup_fulfillment AFTER INSERT OR UPDATE OR DELETE ON "pickup-code" FOR EACH ROW EXECUTE FUNCTION nail_pickup_fulfillment();

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_get_type_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_get_type_check CHECK (order_get_type IN ('pickup','delivery','both'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_delivery_progress_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_delivery_progress_check CHECK (delivery_status IN ('待发货','待送达','已送达'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_pickup_progress_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_pickup_progress_check CHECK (pickup_status IN ('待取货','已取货'));
  END IF;
END $$;
