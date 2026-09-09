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
async function fixture() {
  const db = new PGlite();
  await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));
  await db.exec('ALTER TABLE order_items ADD COLUMN item_snapshot TEXT; ALTER TABLE order_items ADD COLUMN size TEXT; ALTER TABLE orders ADD COLUMN bound_device_id TEXT; ALTER TABLE orders ADD COLUMN payment_provider_id TEXT; ALTER TABLE orders ADD COLUMN manufacturer_sync_status TEXT; ALTER TABLE orders ADD COLUMN manufacturer_sync_error TEXT; ALTER TABLE orders ADD COLUMN manufacturer_response TEXT;');
  await db.exec(fs.readFileSync('database/migrations/20260907_order_codes.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260907_unbound_order_codes.sql','utf8'));
  await db.exec(fs.readFileSync('database/migrations/20260909_order_fulfillment.sql','utf8'));
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
    assert.equal(runs[0].printCodes.length,3);
    assert.equal(new Set(runs.map(x=>x.pickupCode.code)).size,1);
    assert.equal(new Set([...runs[0].printCodes.map(x=>x.code),runs[0].pickupCode.code]).size,4);
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
    await codes.remove('print',runs[0].printCodes[0].id);
    const repaired = await codes.transaction(c=>codes.generateForOrder(c,'o','print'));
    assert.equal(repaired.printCodes.length,3);
    assert.ok(!repaired.printCodes.some(x=>x.code===runs[0].printCodes[0].code));
    assert.equal((await codes.list('print')).length,3);
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
test('code routes use admin sessions and retain manufacturer token isolation',async()=> {
  let response;
  const handler=createOrderCodeRoutes({codes:{list:async()=>[]},getAdminSession:async req=>({ok:req.headers.cookie==='admin-session'}),env:{ADMIN_CODE_API_TOKEN:'admin',MANUFACTURER_CODES_API_TOKEN:'factory'},readJson:async()=>({}),sendJson:(res,status,body)=>{response={status,body};}});
  const res={setHeader(){}};
  await handler({method:'GET',headers:{}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
  await handler({method:'GET',headers:{authorization:'Bearer factory'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
  await handler({method:'DELETE',headers:{authorization:'Bearer factory'}},res,new URL('http://local/api/manufacturer/codes')); assert.equal(response.status,405);
  await handler({method:'GET',headers:{authorization:'Bearer factory'}},res,new URL('http://local/api/manufacturer/codes')); assert.equal(response.status,200);
  await handler({method:'GET',headers:{cookie:'admin-session'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,200);
  await handler({method:'GET',headers:{authorization:'Bearer admin'}},res,new URL('http://local/api/admin/order-codes')); assert.equal(response.status,401);
});
test('actual paid-order flow stores all codes and reuses order for payment retry',async()=> {
  const {db,pool,codes}=await fixture();
  try {
    const source=fs.readFileSync('server.js','utf8');
    const fn=source.slice(source.indexOf('async function createPaidOrderRecord('),source.indexOf('\nasync function ',source.indexOf('async function createPaidOrderRecord(')+1));
    const context={orderGetType,crypto,hasPostgresRuntime:()=>true,ensurePgAdminRuntimeSchema:async()=>{},pgPool:pool,orderCodes:codes,cleanPgText:x=>String(x||''),pgNumber:x=>Number(x||0),resolveOrderUserId:async()=> 'u',ensurePrintServiceProduct:async()=>null,notifyManufacturerOrder:async()=>({status:'not_configured',error:'',response:''})};
    vm.createContext(context); vm.runInContext(fn+'\nthis.create=createPaidOrderRecord',context);
    const body={amount:10,items:[{id:'p',qty:2},{id:'n',qty:1}]};
    const first=await context.create(body,{paymentId:'payment-1'});
    const again=await context.create(body,{paymentId:'payment-1'});
    assert.equal(first.orderId,again.orderId); assert.equal(first.printCodes.length,2); assert.equal(first.pickupCode,again.pickupCode);
    const normal=await context.create({amount:1,items:[{id:'n',qty:1}]},{paymentId:'payment-2'});
    assert.equal(normal.printCode,null); assert.equal(normal.printCodes.length,0); assert.match(normal.pickupCode,/^\d{6}$/);
    await assert.rejects(context.create({items:[{id:'p',qty:0}]},{paymentId:'payment-invalid'}),/quantity/);
    assert.equal((await db.query("SELECT * FROM orders WHERE payment_provider_id='payment-invalid'")).rows.length,0);
  } finally {await db.close();}
});
test('unbound print/pickup routes create unique records, confirm null order, and delete', async()=> {
  const {db,codes}=await fixture();
  try {
    await db.exec(fs.readFileSync('database/migrations/20260907_unbound_order_codes.sql','utf8'));
    let response, body;
    const route=createOrderCodeRoutes({codes,getAdminSession:async req=>({ok:req.headers.cookie==='admin-session'}),env:{},readJson:async()=>body,sendJson:(res,status,data)=>{response={status,data};}});
    const req={method:'POST',headers:{cookie:'admin-session'}};
    const res={setHeader(){}};const url=new URL('http://local/api/admin/order-codes');
    const created=[];
    for(const type of ['print','print','pickup','pickup']) {
      body={type,unbound:true};await route(req,res,url);assert.equal(response.status,200);
      const r=response.data.record;assert.equal(r.order_id,null);assert.equal(r.use_status,'inactive');assert.equal(r.sync_status,'pending');assert.match(r.code,/^\d{6}$/);
      if(type==='print') {assert.equal(r.order_item_id,null);assert.equal(r.product_id,null);}
      created.push({type,...r});
    }
    assert.equal(new Set(created.map(r=>r.code)).size,4);
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
    body={type:'pickup',order_id:'o'};await route(req,res,url);assert.equal(response.status,200);
    const bound=response.data.pickupCode;await route(req,res,url);assert.equal(response.data.pickupCode.code,bound.code);
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
