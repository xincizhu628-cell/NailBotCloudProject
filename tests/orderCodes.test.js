const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { orderGetType } = require('../services/orderManagementService');
const { PGlite } = require('@electric-sql/pglite');
const { createOrderCodeService, printableUnits } = require('../services/orderCodeService');
const { createCodeConfirmationService } = require('../services/codeConfirmationService');
const { createOrderCodeRoutes } = require('../services/orderCodeRoutes');
const { createManufacturerIntegrationService } = require('../services/manufacturerIntegrationService');
async function fixture() {
  const db = new PGlite();
  await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));
  await db.exec('ALTER TABLE order_items ADD COLUMN item_snapshot TEXT; ALTER TABLE order_items ADD COLUMN size TEXT; ALTER TABLE orders ADD COLUMN bound_device_id TEXT; ALTER TABLE orders ADD COLUMN payment_provider_id TEXT; ALTER TABLE orders ADD COLUMN manufacturer_sync_status TEXT; ALTER TABLE orders ADD COLUMN manufacturer_sync_error TEXT; ALTER TABLE orders ADD COLUMN manufacturer_response TEXT;');
  await db.exec(fs.readFileSync('database/migrations/20260907_order_codes.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260907_unbound_order_codes.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260909_order_fulfillment.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260910_manual_codes.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260911_manufacturer_push_callbacks.sql','utf8'));
  // PGlite has one connection; serialize leases to exercise repeated concurrent service requests.
  let tail = Promise.resolve();
  const pool = { query: (...args) => db.query(...args), async connect() {
    const previous = tail; let release;
    tail = new Promise(resolve => { release = resolve; }); await previous;
    return { query: (...args) => db.query(...args), release };
  } };
  let n = 1;
  const codes = createOrderCodeService(pool, { randomInt: () => n++ });
  await db.exec(`INSERT INTO products(product_id,product_name) VALUES ('p','Red (PRINTING available)'),('n','Plain nail');
    INSERT INTO orders(order_id,user_id) VALUES ('o','u'),('plain','u');
    INSERT INTO order_items(order_item_id,order_id,product_id,quantity) VALUES ('i','o','p',3),('j','o','n',5),('k','plain','n',2);`);
  return { db, pool, codes };
}
test('printing classification uses authoritative saved name and validates quantity', () => {
  assert.equal(printableUnits([{product_name:'printing available',quantity:2}]).length,2);
  assert.equal(printableUnits([{product_name:'plain',item_snapshot:'{"name":"printing available"}',quantity:2}]).length,0);
  assert.equal(printableUnits([{product_name:'new name',item_snapshot:'{"product_name":"printing available"}',quantity:2}]).length,2);
  assert.throws(() => printableUnits([{product_name:'printing',quantity:-1}]));
});
test('migration, quantities, one pickup, repeat requests, collision and rollback', async () => {
  const {db,pool,codes} = await fixture();
  try {
    await db.exec(fs.readFileSync('database/migrations/20260907_order_codes.sql','utf8'));
    const runs = await Promise.all(Array.from({length:4}, () => codes.transaction(c => codes.generateForOrder(c,'o'))));
    assert.equal(runs[0].printCodes.length,0);
    assert.equal(new Set(runs.map(x=>x.pickupCode.code)).size,1);
    assert.equal(new Set([runs[0].pickupCode.code]).size,1);
    const plain = await codes.transaction(c=>codes.generateForOrder(c,'plain'));
    assert.equal(plain.printCodes.length,0); assert.match(plain.pickupCode.code,/^\d{6}$/);
    await assert.rejects(db.query('INSERT INTO "pickup-code"(code,order_id) VALUES ($1,$2)', [runs[0].pickupCode.code,'plain']));
    await db.exec("INSERT INTO orders(order_id,user_id) VALUES ('collision','u')");
    let attempts=0;
    const collision = createOrderCodeService(pool,{ randomInt:()=> ++attempts < 3 ? 1 : 987654 });
    const record = await collision.transaction(c=>collision.generatePickupCode(c,'collision'));
    assert.equal(record.code,'987654'); assert.equal(attempts,3);
    const doomed = createOrderCodeService(pool,{randomInt:()=>1});
    await assert.rejects(doomed.transaction(async c=> {await c.query("INSERT INTO orders(order_id,user_id) VALUES ('rolledback','u')");await doomed.generateForOrder(c,'rolledback');}), /exhausted/);
    assert.equal((await db.query("SELECT * FROM orders WHERE order_id='rolledback'")).rows.length,0);
    assert.equal((await codes.list('print')).length,0);
  } finally {await db.close();}
});
test('confirmation applies versions atomically and preserves cursor on invalid batch', async()=> {
  const {db,pool,codes}=await fixture();
  try {
    const {pickupCode:r}=await codes.transaction(c=>codes.generateForOrder(c,'o'));
    const update={type:'pickup',id:r.id,code:r.code,order_id:'o',use_status:'active',sync_status:'success',version:2};
    const worker=createCodeConfirmationService({pool,codes,env:{MANUFACTURER_CONFIRM_API_URL:'https://manufacturer.example/api/confirm',MANUFACTURER_API_TOKEN:'test'},fetchImpl:async()=>({ok:true,json:async()=>({cursor:'v2',updates:[update]})})});
    await worker.pollOnce(); await worker.pollOnce();
    await codes.transaction(c=>codes.applyConfirmations(c,[{...update,version:1,use_status:'inactive',sync_status:'pending'}]));
    assert.equal((await codes.list('pickup'))[0].use_status,'active');
    assert.equal((await db.query("SELECT cursor FROM order_code_sync_state")).rows[0].cursor,'v2');
    const bad=createCodeConfirmationService({pool,codes,env:{MANUFACTURER_CONFIRM_API_URL:'https://manufacturer.example/api/confirm',MANUFACTURER_API_TOKEN:'test'},fetchImpl:async()=>({ok:true,json:async()=>({cursor:'bad',updates:[{...update,version:3,sync_status:'fail'},{...update,version:4,use_status:'bogus'}]})})});
    await assert.rejects(bad.pollOnce(),/Invalid confirmation/);
    assert.equal((await codes.list('pickup'))[0].sync_status,'success');
    assert.equal((await db.query("SELECT cursor FROM order_code_sync_state")).rows[0].cursor,'v2');
    assert.equal((await createCodeConfirmationService({pool,codes,env:{},fetchImpl:()=>{throw Error('must not fetch');}}).pollOnce()).skipped,true);
  } finally {await db.close();}
});

test('manufacturer activation callback stores print codes and print usage callback updates status', async()=>{
  const {db,pool,codes}=await fixture();
  try {
    const {pickupCode}=await codes.transaction(c=>codes.generateForOrder(c,'o','pickup'));
    const stockPayloads=[];
    const service=createManufacturerIntegrationService({pool,codes,env:{MANUFACTURER_STOCK_API_URL:'https://manufacturer.example/stock'},fetchImpl:async(_url,options)=>{stockPayloads.push(JSON.parse(options.body));return {ok:true,text:async()=>JSON.stringify({stock:stockPayloads.length})};}});
    const activated=await service.confirmActivation({orderId:'o',pickupCode:pickupCode.code,status:'success',printCodes:[{code:'701001',productId:'p',orderItemId:'i',unitNumber:1},{code:'701002',productId:'p',orderItemId:'i',unitNumber:2}]});
    assert.equal(activated.pickupCode.sync_status,'success');
    assert.equal(activated.printCodes.length,2);
    const saved=await codes.list('print');
    assert.equal(saved.length,2);assert.equal(saved[0].code_origin,'manufacturer');assert.equal(saved[0].print_use_status,'unused');
    const used=await service.confirmPrintUsage({printCode:'701001',status:'used'});
    assert.equal(used.printCode.use_status,'active');assert.equal(used.printCode.print_use_status,'used');
    await assert.rejects(service.confirmActivation({orderId:'o',pickupCode:pickupCode.code,status:'success',printCodes:['bad']}),/Invalid printCode/);
    await db.query("UPDATE products SET bound_device_ids='dev-a,dev-b',device_channel_code='A01' WHERE product_id='p'");
    const stock=await service.queryStock({productId:'p'});
    assert.equal(stock.stocksByDevice.length,2);assert.deepEqual(stock.stocksByDevice.map(x=>x.boundDeviceId),['dev-a','dev-b']);assert.equal(stock.payload.deviceChannelCode,'A01');assert.equal(stock.stock,3);
  } finally {await db.close();}
});
test('code routes use admin sessions and reject retired manufacturer pull endpoint',async()=> {
  let response;
  const handler=createOrderCodeRoutes({codes:{list:async()=>[]},getAdminSession:async req=>({ok:req.headers.cookie==='admin-session'}),readJson:async()=>({}),sendJson:(res,status,body)=>{response={status,body};}});
  const res={setHeader(){}};
  await handler({method:'GET',headers:{}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
  await handler({method:'GET',headers:{authorization:'Bearer factory'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
  response=undefined; assert.equal(await handler({method:'GET',headers:{authorization:'Bearer factory'}},res,new URL('http://local/api/manufacturer/codes')),false); assert.equal(response,undefined);
  await handler({method:'GET',headers:{cookie:'admin-session'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,200);
  await handler({method:'GET',headers:{authorization:'Bearer admin'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
});
test('actual paid-order flow stores all codes and reuses order for payment retry',async()=> {
  const {db,pool,codes}=await fixture();
  try {
    const source=fs.readFileSync('server.js','utf8');
    const fn=source.slice(source.indexOf('async function createPaidOrderRecord('),source.indexOf('\nasync function ',source.indexOf('async function createPaidOrderRecord(')+1));
    const context={orderGetType,crypto,hasPostgresRuntime:()=>true,ensurePgAdminRuntimeSchema:async()=>{},pgPool:pool,orderCodes:codes,cleanPgText:x=>String(x||''),pgNumber:x=>Number(x||0),resolveOrderUserId:async()=> 'u',ensurePrintServiceProduct:async()=>null,notifyManufacturerOrder:async()=>({status:'not_configured',error:'',response:''}),splitDeviceIds:x=>String(x||'').split(/[，,;；\\s]+/).filter(Boolean)};
    vm.createContext(context); vm.runInContext(fn+'\nthis.create=createPaidOrderRecord',context);
    const body={amount:10,items:[{id:'p',qty:2},{id:'n',qty:1}]};
    const first=await context.create(body,{paymentId:'payment-1'});
    const again=await context.create(body,{paymentId:'payment-1'});
    assert.equal(first.orderId,again.orderId); assert.equal(first.printCodes.length,0); assert.equal(first.pickupCode,again.pickupCode); assert.equal(first.containsPrintable,true);
    const normal=await context.create({amount:1,items:[{id:'n',qty:1}]},{paymentId:'payment-2'});
    assert.equal(normal.printCode,null); assert.equal(normal.printCodes.length,0); assert.match(normal.pickupCode,/^\d{6}$/);
    await assert.rejects(context.create({items:[{id:'p',qty:0}]},{paymentId:'payment-invalid'}),/quantity/);
    assert.equal((await db.query("SELECT * FROM orders WHERE payment_provider_id='payment-invalid'")).rows.length,0);
  } finally {await db.close();}
});
test('unbound pickup routes create unique records, confirm null order, and delete; print creation is retired', async()=> {
  const {db,codes}=await fixture();
  try {
    await db.exec(fs.readFileSync('database/migrations/20260907_unbound_order_codes.sql','utf8'));
    let response, body;
    const route=createOrderCodeRoutes({codes,getAdminSession:async req=>({ok:req.headers.cookie==='admin-session'}),env:{},readJson:async()=>body,sendJson:(res,status,data)=>{response={status,data};}});
    const req={method:'POST',headers:{cookie:'admin-session'}};
    const res={setHeader(){}};const url=new URL('http://local/api/admin/order-codes');
    const created=[];
    body={type:'print',code:'800000'};await route(req,res,url);assert.equal(response.status,400);
    for(const type of ['pickup','pickup']) {
      body={type,code:String(800000+created.length)};await route(req,res,url);assert.equal(response.status,200);
      const r=response.data.record;assert.equal(r.order_id,null);assert.equal(r.use_status,'inactive');assert.equal(r.sync_status,'success');assert.equal(r.code_origin,'manual');assert.match(r.code,/^\d{6}$/);
      created.push({type,...r});
    }
    assert.equal(new Set(created.map(r=>r.code)).size,2);
    for(const r of created) {
      const update={type:r.type,id:r.id,code:r.code,order_id:null,use_status:'active',sync_status:'success',version:2};
      await codes.transaction(c=>codes.applyConfirmations(c,[update]));
      const row=(await codes.list(r.type)).find(x=>x.id===r.id);assert.equal(row.use_status,'active');
      await assert.rejects(codes.transaction(c=>codes.applyConfirmations(c,[{...update,order_id:undefined}])),/Invalid confirmation/);
      const deleted=await codes.remove(r.type,r.id);assert.equal(deleted.code,r.code);
    }
    assert.equal((await codes.list('print')).length,0);assert.equal((await codes.list('pickup')).length,0);
    body={type:'print',order_id:''};await route(req,res,url);assert.equal(response.status,400);
    body={type:'pickup',unbound:true,order_id:'o'};await route(req,res,url);assert.equal(response.status,400);
    body={type:'pickup',code:'876543',order_id:'o'};await route(req,res,url);assert.equal(response.status,200);
    await route(req,res,url);assert.equal(response.status,400);
  } finally {await db.close();}
});
test('Postgres admin authentication accepts existing Python-compatible hashes and expires/revokes sessions', async()=>{
  const {db,pool}=await fixture();const {createAdminAuthService}=require('../services/adminAuthService');const auth=createAdminAuthService(pool);
  try {
    const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync('test-pass',salt,180000,32,'sha256');
    await db.query('INSERT INTO admin_users(admin_id,password_hash,password_salt) VALUES ($1,$2,$3)',['test-admin',hash.toString('base64'),salt.toString('base64')]);
    assert.equal((await auth({action:'login',adminId:'test-admin',password:'wrong'})).ok,false);
    const login=await auth({action:'login',adminId:'test-admin',password:'test-pass'});assert.equal(login.ok,true);
    assert.equal((await auth({action:'session',token:login.session.token})).ok,true);
    assert.equal((await auth({action:'session',token:'invalid'})).ok,false);
    await db.query("UPDATE admin_sessions SET expires_at='2000-01-01T00:00:00Z'");
    assert.equal((await auth({action:'session',token:login.session.token})).ok,false);
    const again=await auth({action:'login',adminId:'test-admin',password:'test-pass'});await auth({action:'logout',token:again.session.token});
    assert.equal((await auth({action:'session',token:again.session.token})).ok,false);
    await db.query("UPDATE admin_users SET status='disabled'");assert.equal((await auth({action:'login',adminId:'test-admin',password:'test-pass'})).ok,false);
  } finally {await db.close();}
});

test('manual print creation and binding are retired; pickup duplicate protection remains',async()=>{
 const {db,codes}=await fixture();try{
 await assert.rejects(codes.addManual('print','001234','o'),/厂家生成/);
 await assert.rejects(codes.rebindManual('print',1,'plain'),/厂家回调/);
 await assert.rejects(codes.addManual('print','123',null),/厂家生成/);
 const pickup=await codes.addManual('pickup','001236','o');assert.equal(pickup.code,'001236');assert.equal(pickup.sync_status,'success');
 await assert.rejects(codes.rebindManual('pickup',pickup.id,'plain'),/不允许/);
 await assert.rejects(codes.addManual('pickup','001237','o'),/不允许替换/);
 }finally{await db.close();}
});



