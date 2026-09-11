function orderGetType(products) {
  if(!products.length) throw new Error('Order requires products');
  const types=products.map(p=>p.pickup_method==='pickup'?'pickup':['shipping','delivery'].includes(p.pickup_method)?'delivery':'both');
  return types.every(t=>t==='pickup')?'pickup':types.every(t=>t==='delivery')?'delivery':'both';
}
function createOrderManagementService(pool) {
  async function detail(id, client=pool) {
    const order=(await client.query('SELECT * FROM orders WHERE order_id=$1',[id])).rows[0];
    if(!order)throw new Error('Order not found');
    // Legacy status is retained in SQL for old deployments, not part of the new state model.
    delete order.order_status;
    const items=(await client.query('SELECT i.*,p.product_name,p.bound_device_id,p.bound_device_ids,p.device_channel_code,p.pickup_method,p.manufacturer_channel,p.manufacturer_slot,p.manufacturer_sku,p.manufacturer_stock_quantity,p.manufacturer_stock_checked_at FROM order_items i LEFT JOIN products p ON p.product_id=i.product_id WHERE i.order_id=$1 ORDER BY i.order_item_id',[id])).rows;
    const printCodes=(await client.query('SELECT * FROM "print-code" WHERE order_id=$1 ORDER BY id',[id])).rows;
    const pickupCodes=(await client.query('SELECT * FROM "pickup-code" WHERE order_id=$1 ORDER BY id',[id])).rows;
    return {ok:true,order,items,printCodes,pickupCodes};
  }
  async function update(id, input) {
    if(!['shipment','delivery'].includes(input.action)||typeof input.confirmed!=='boolean')throw new Error('Invalid confirmation');
    const c=await pool.connect();
    try {
      await c.query('BEGIN');
      const row=(await c.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[id])).rows[0];
      if(!row)throw new Error('Order not found');
      if(!['delivery','both'].includes(row.order_get_type))throw new Error('该订单不支持配送');
      if(!['paid','completed','COMPLETED'].includes(row.payment_status))throw new Error('订单尚未支付');
      if(input.expectedStatus!==row.delivery_status)throw new Error('配送状态已变化，请刷新后操作');
      let next;
      if(input.action==='shipment')next=input.confirmed?(row.delivery_status==='已送达'?'已送达':'待送达'):'待发货';
      else {if(input.confirmed && row.delivery_status==='待发货')throw new Error('请先确认已发货');next=input.confirmed?'已送达':(row.delivery_status==='待发货'?'待发货':'待送达');}
      await c.query('UPDATE orders SET delivery_status=$1 WHERE order_id=$2',[next,id]);
      const result=await detail(id,c);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  return {detail,update};
}
module.exports={createOrderManagementService,orderGetType};

