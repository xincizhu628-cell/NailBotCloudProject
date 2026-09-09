# Order fulfillment

Cloud migration: database/migrations/20260909_order_fulfillment.sql. Apply using `node tools/order_code_database.js --apply-fulfillment` after the order-code migrations. The 2026-09-09 migration was applied to the configured Supabase database.

The sole fulfillment-method field is order_get_type: pickup, delivery, both. All pickup-only products yield pickup; all shipping/delivery products yield delivery; a both product or a mixture yields both. New order item snapshots store the authoritative product pickup_method so later product edits do not change existing order classification.

The independent nullable states are delivery_status (待发货, 待送达, 已送达) and pickup_status (待取货, 已取货). Inapplicable states are NULL. Unpaid orders have NULL fulfillment states and retain their payment_status. Paid orders initialize the applicable states. The old order_status column remains solely for compatibility with previously deployed servers; new APIs and screens no longer use it.

Database triggers update classification when order items change and update pickup_status when pickup-code records are inserted, changed or deleted. active on a pickup code means used/collected; inactive means unused. Print-code use does not complete pickup. Delivery-only orders can still have their required pickup-code record, but do not receive pickup_status.

Admin GET /api/admin/order-detail?id=ORDER_ID returns all current order fields, order items, printCodes and pickupCodes. PATCH accepts id, action (shipment/delivery), confirmed (boolean), expectedStatus. Admin login cookie required. Delivery confirmation requires shipment first. Revoking delivery returns to 待送达. Revoking shipment returns to 待发货, including if previously delivered. Pickup progress is not manually editable. Concurrent stale operations are rejected; the detail dialog refreshes every five seconds while visible.

Validation: node --test --test-concurrency=1 tests/orderManagement.test.js tests/orderCodes.test.js tests/userOrders.test.js. Browser QA checks the real admin page with mocked endpoints. No test orders were created in production.
