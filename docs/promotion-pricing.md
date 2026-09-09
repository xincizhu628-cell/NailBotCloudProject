# Activity pricing

`POST /api/checkout-quote` accepts `{items:[{id,qty}]}` and returns authoritative product prices, line totals, subtotal, discount, total, applied activities and pricingKey. Additional item metadata is retained. Catalogue base prices are not overwritten. Cart and checkout display computed line totals.

The Node service ports the arithmetic from promotion_pricing.py to integer cents and connects it to PostgreSQL. Only active products and active promotion_discount events within their time window participate. Blank dates are unbounded. Selected-product thresholds apply to the selected subtotal. Percent 20 means 20% OFF. Fixed price means the total price of all matched units, matching the existing Python function, not a per-unit price. Empty selected-product lists cannot be saved.

Non-stackable activities compete with the group of stackable activities; the larger discount wins. Stackable activities apply sequentially in event ID order to remaining amounts. max_discount caps each activity. Allocation rounds in cents and preserves line-total/order-total equality.

Admin event create/edit saves events and promotion_discount_events transactionally, validates product IDs and values, and returns fresh rows. Existing promotion wallet coupons are a separate feature and are not redeemed by this service.

Checkout retrieves a quote before display and again before payment. The payment handler recomputes using database prices and rejects a changed pricingKey or total before calling Square. Orders store original authoritative unit prices and line discounts/final amounts in item_snapshot. The PRINT-SERVICE fallback must exist as an active product with a configured price; client-provided prices cannot create a billable product.

No schema migration required. No production payments are used in tests. Run node --test --test-concurrency=1 tests/promotionPricing.test.js.
