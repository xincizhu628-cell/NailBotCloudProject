function createUserOrdersService({ pool, getSession }) {
  return async function listOrders(body = {}) {
    const session = await getSession(body.sessionId);
    if (!session.ok) return { ok: false, error: 'Please sign in to view your orders.' };
    const offset = Number(body.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid order offset');
    const pageSize = 20;
    const result = await pool.query(`
      SELECT o.order_id, o.total_price, o.pay_method, o.payment_status, o.delivery_status,
             o.order_status, o.print_code,
             COALESCE((SELECT pc.code FROM "pickup-code" pc WHERE pc.order_id=o.order_id),NULLIF(o.pickup_code,'000000')) AS pickup_code,
             o.created_at, o.paid_at,
             COALESCE((SELECT json_agg(json_build_object('product_id',i.product_id,
               'product_name',p.product_name,'quantity',i.quantity,'unit_price',i.unit_price)
               ORDER BY i.order_item_id) FROM order_items i LEFT JOIN products p ON p.product_id=i.product_id
               WHERE i.order_id=o.order_id), '[]'::json) AS items,
             COALESCE((SELECT json_agg(json_build_object('code',c.code,'use_status',c.use_status)
               ORDER BY c.id) FROM "print-code" c WHERE c.order_id=o.order_id), '[]'::json) AS print_codes
      FROM orders o
      WHERE o.user_id=$1
      ORDER BY o.created_at DESC, o.order_id DESC
      LIMIT $2 OFFSET $3`, [session.user.userId, pageSize + 1, offset]);
    const hasMore = result.rows.length > pageSize;
    return { ok: true, orders: result.rows.slice(0, pageSize), hasMore, nextOffset: offset + Math.min(pageSize, result.rows.length) };
  };
}
module.exports = { createUserOrdersService };
