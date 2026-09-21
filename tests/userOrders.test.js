const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');const {createUserOrdersService}=require('../services/userOrdersService');
test('personal order list contains all order types, paginates, and cannot read another user',async()=>{
 const db=new PGlite();try{
 await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));await db.exec(fs.readFileSync('database/migrations/20260907_order_codes.sql','utf8'));
 await db.exec(`INSERT INTO orders(order_id,user_id,total_price,payment_status) SELECT 'mine-'||n,'me',n,CASE WHEN n%2=0 THEN 'paid' ELSE 'pending' END FROM generate_series(1,23) n;
 INSERT INTO orders(order_id,user_id) VALUES ('other-secret','other');
 INSERT INTO products(product_id,product_name) VALUES ('plain','Ordinary nail'),('print','printing available');
 INSERT INTO order_items(order_item_id,order_id,product_id,quantity) VALUES ('item1','mine-1','plain',2),('item2','mine-2','print',3),('secret','other-secret','plain',1);
 INSERT INTO order_code_registry(code) VALUES ('000000');
 INSERT INTO "pickup-code"(code,order_id) VALUES ('000000','mine-1');`);
 const service=createUserOrdersService({pool:db,getSession:async id=>id==='valid'?{ok:true,user:{userId:'me'}}:{ok:false}});
 assert.equal((await service({sessionId:'invalid',userId:'me'})).ok,false);
 const first=await service({sessionId:'valid',userId:'other'});assert.equal(first.orders.length,20);assert.equal(first.hasMore,true);
 const second=await service({sessionId:'valid',offset:first.nextOffset});assert.equal(second.orders.length,3);assert.equal(second.hasMore,false);
 const all=[...first.orders,...second.orders];assert.equal(new Set(all.map(o=>o.order_id)).size,23);assert.ok(!all.some(o=>o.order_id==='other-secret'));
 assert.equal(all.find(o=>o.order_id==='mine-1').items[0].product_name,'Ordinary nail');assert.equal(all.find(o=>o.order_id==='mine-2').items[0].quantity,3);
 assert.equal(all.find(o=>o.order_id==='mine-1').pickup_code,'000000');assert.equal(all.find(o=>o.order_id==='mine-3').pickup_code,null);
 await assert.rejects(service({sessionId:'valid',offset:-1}),/Invalid/);
 const empty=createUserOrdersService({pool:db,getSession:async()=>({ok:true,user:{userId:'empty'}})});assert.deepEqual((await empty({})).orders,[]);
 }finally{await db.close();}
});
