const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {PGlite}=require('@electric-sql/pglite');const {createPromotionPricingService}=require('../services/promotionPricingService');
test('real event saving and pricing: targeted items, edits, dates, caps, stacking and trusted prices',async()=>{
 const db=new PGlite();try{
 await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));
 await db.exec("INSERT INTO products(product_id,product_name,unit_price,status) VALUES('a','A',100,'active'),('b','B',50,'active')");
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 const source=fs.readFileSync('server.js','utf8');const start=source.indexOf('async function savePromotionEvent(');const end=source.indexOf('async function handlePgAdminCreateRecord',start);
 const context={pgPool:pool,require:p=>require('../services/promotionPricingService'),cleanPgText:x=>x||'',pgDataUrlOrBase64:x=>x||null,pgInteger:x=>Number(x)||0};vm.createContext(context);vm.runInContext(source.slice(start,end)+';this.save=savePromotionEvent',context);
 const service=createPromotionPricingService(pool,()=>Date.parse('2026-09-08T00:00:00Z'));
 const items=[{id:'a',qty:2,price:0.01},{id:'b',qty:1,price:0.01}];
 const event=await context.save({event_type:'promotion_discount',event_name:'Sale',promo_scope:'selected_products',target_product_ids:'a',discount_type:'percent_off',discount_value:20,min_spend:0,status:'active'});
 let q=await service.quote(items);assert.equal(q.subtotal,250);assert.equal(q.total,210);assert.equal(q.items[0].lineTotal,160);assert.equal(q.items[1].lineTotal,50);assert.equal(q.items[0].price,100);
 await context.save({discount_value:10},event.id);q=await service.quote(items);assert.equal(q.total,230);
 await context.save({min_spend:201},event.id);assert.equal((await service.quote(items)).discount,0);
 await context.save({min_spend:0,expires_at:'2026-09-07'},event.id);assert.equal((await service.quote(items)).discount,0);
 await context.save({expires_at:'2027-01-01',max_discount:5},event.id);assert.equal((await service.quote(items)).discount,5);
 await context.save({max_discount:'',discount_type:'fixed_price',discount_value:80},event.id);assert.equal((await service.quote(items)).total,130);
 await context.save({status:'inactive'},event.id);assert.equal((await service.quote(items)).total,250);
 await assert.rejects(context.save({promo_scope:'selected_products',target_product_ids:'missing'},event.id),/does not exist/);
 assert.equal((await service.quote(items)).total,250);
 await context.save({event_type:'promotion_discount',event_name:'stack1',promo_scope:'selected_products',target_product_ids:'a',discount_type:'percent_off',discount_value:10,stackable:1});
 await context.save({event_type:'promotion_discount',event_name:'stack2',promo_scope:'selected_products',target_product_ids:'a',discount_type:'percent_off',discount_value:10,stackable:1});
 q=await service.quote(items);assert.equal(q.discount,38);assert.equal(q.items[1].lineDiscount,0);assert.equal(q.items.reduce((n,i)=>n+i.lineTotal,0),q.total);
 await context.save({event_type:'promotion_discount',event_name:'best',discount_type:'threshold_amount_off',discount_value:50});assert.equal((await service.quote(items)).discount,50);
 await assert.rejects(service.quote([{id:'a',qty:0}]),/quantity/);await assert.rejects(service.quote([{id:'unknown',qty:1}]),/unavailable/);
 }finally{await db.close();}
});
test('payment rejects changed quote before charging and replaces client prices',async()=>{
 const source=fs.readFileSync('server.js','utf8');const start=source.indexOf('async function handleSquarePayment('),end=source.indexOf('\nfunction makeNumericCode',start);
 const quote={ok:true,total:80,pricingKey:'trusted',items:[{id:'a',qty:1,price:100,lineTotal:80}]};let body={amount:1,pricingKey:'wrong',items:[]},charged=0,result;
 const ctx={readJson:async()=>body,promotionPricing:{quote:async()=>quote},squarePaymentService:{browserConfig:()=>({currency:'AUD'}),createPayment:async input=>{charged++;assert.equal(input.amount,80);assert.equal(input.items[0].price,100);return {httpStatus:200,body:{ok:true}};}},createPaidOrderRecord:async()=>({ok:true}),sendJson:(_r,status,data)=>result={status,data}};vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';this.pay=handleSquarePayment',ctx);
 await ctx.pay({},{});assert.equal(charged,0);assert.equal(result.status,409);
 body={amount:80,pricingKey:'trusted',items:[{price:0.01}]};await ctx.pay({},{});assert.equal(charged,1);
});
