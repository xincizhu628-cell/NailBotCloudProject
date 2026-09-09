const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const {createOrderManagementService,orderGetType}=require('../services/orderManagementService');const {createOrderCodeService}=require('../services/orderCodeService');
test('fulfillment classification, independent states, confirmations, rollback and database triggers',async()=>{
 const db=new PGlite();try{
 await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));
 await db.exec(fs.readFileSync('database/migrations/20260907_order_codes.sql','utf8'));
 await db.exec(fs.readFileSync('database/migrations/20260907_unbound_order_codes.sql','utf8'));
 await db.exec("INSERT INTO products(product_id,product_name,pickup_method) VALUES ('p','pickup','pickup'),('d','delivery','shipping'),('b','both','both'); INSERT INTO orders(order_id,user_id,payment_status,delivery_status) VALUES('legacy','u','paid','shipped'); INSERT INTO order_items(order_item_id,order_id,product_id) VALUES('legacy-i','legacy','d');");
 await db.exec(fs.readFileSync('database/migrations/20260909_order_fulfillment.sql','utf8'));
 const pool={query:(...x)=>db.query(...x),connect:async()=>({query:(...x)=>db.query(...x),release(){}})},service=createOrderManagementService(pool),codes=createOrderCodeService(pool);
 assert.equal((await service.detail('legacy')).order.delivery_status,'待送达');
 for(const [id,products,type] of [['pickup',['p'],'pickup'],['delivery',['d'],'delivery'],['mixed',['p','d'],'both'],['both',['b'],'both']]){
  await db.query("INSERT INTO orders(order_id,user_id,payment_status) VALUES($1,'u','paid')",[id]);
  for(const product of products)await db.query('INSERT INTO order_items(order_item_id,order_id,product_id) VALUES($1,$2,$3)',[id+product,id,product]);
  const o=(await service.detail(id)).order;assert.equal(o.order_get_type,type);assert.equal(o.delivery_status,type==='pickup'?null:'待发货');assert.equal(o.pickup_status,type==='delivery'?null:'待取货');assert.equal(o.order_status,undefined);
 }
 assert.equal(orderGetType([{pickup_method:'pickup'},{pickup_method:'shipping'}]),'both');assert.equal(orderGetType([{pickup_method:'both'}]),'both');
 const pickup=await codes.transaction(c=>codes.generatePickupCode(c,'mixed'));
 await codes.transaction(c=>codes.applyConfirmations(c,[{type:'pickup',id:String(pickup.id),code:pickup.code,order_id:'mixed',use_status:'active',sync_status:'success',version:1}]));
 let o=(await service.detail('mixed')).order;assert.equal(o.pickup_status,'已取货');assert.equal(o.delivery_status,'待发货');
 o=(await service.update('mixed',{action:'shipment',confirmed:true,expectedStatus:'待发货'})).order;assert.equal(o.delivery_status,'待送达');assert.equal(o.pickup_status,'已取货');
 o=(await service.update('mixed',{action:'delivery',confirmed:true,expectedStatus:'待送达'})).order;assert.equal(o.delivery_status,'已送达');assert.equal(o.pickup_status,'已取货');
 o=(await service.update('mixed',{action:'delivery',confirmed:false,expectedStatus:'已送达'})).order;assert.equal(o.delivery_status,'待送达');
 await service.update('mixed',{action:'delivery',confirmed:true,expectedStatus:'待送达'});
 o=(await service.update('mixed',{action:'shipment',confirmed:false,expectedStatus:'已送达'})).order;assert.equal(o.delivery_status,'待发货');assert.equal(o.pickup_status,'已取货');
 await assert.rejects(service.update('mixed',{action:'delivery',confirmed:true,expectedStatus:'待发货'}),/先确认/);
 await assert.rejects(service.update('mixed',{action:'shipment',confirmed:true,expectedStatus:'待送达'}),/已变化/);
 await assert.rejects(service.update('pickup',{action:'shipment',confirmed:true,expectedStatus:null}),/不支持/);
 await db.query("UPDATE \"pickup-code\" SET use_status='inactive' WHERE id=$1",[pickup.id]);assert.equal((await service.detail('mixed')).order.pickup_status,'待取货');
 const delCode=await codes.transaction(c=>codes.generatePickupCode(c,'delivery'));await db.query("UPDATE \"pickup-code\" SET use_status='active' WHERE id=$1",[delCode.id]);assert.equal((await service.detail('delivery')).order.pickup_status,null);
 await db.exec("INSERT INTO orders(order_id,user_id,payment_status) VALUES('unpaid','u','pending'); INSERT INTO order_items(order_item_id,order_id,product_id) VALUES('unpaid-i','unpaid','b');");
 o=(await service.detail('unpaid')).order;assert.equal(o.delivery_status,null);assert.equal(o.pickup_status,null);await assert.rejects(service.update('unpaid',{action:'shipment',confirmed:true,expectedStatus:null}),/尚未支付/);
 await db.exec("UPDATE orders SET payment_status='paid' WHERE order_id='unpaid'");o=(await service.detail('unpaid')).order;assert.equal(o.delivery_status,'待发货');assert.equal(o.pickup_status,'待取货');
 await db.exec(fs.readFileSync('database/migrations/20260909_order_fulfillment.sql','utf8'));assert.equal((await service.detail('mixed')).order.order_get_type,'both');
 }finally{await db.close();}
});
