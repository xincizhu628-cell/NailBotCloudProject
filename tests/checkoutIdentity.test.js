const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('server.js','utf8');
test('checkout sends auth session and signed-in order cannot silently become guest',async()=>{
 assert.match(fs.readFileSync('checkout.html','utf8'),/sessionId: localStorage.getItem\("nailStudioUserAuthSessionV1"\)/);
 const start=source.indexOf('async function resolveOrderUserId'),end=source.indexOf('async function notifyManufacturerOrder',start);let queries=0;
 const c={cleanPgText:x=>String(x||''),getPgAuthSession:async id=>id==='valid'?{ok:true,user:{userId:'quanshan-id'}}:{ok:false}};vm.createContext(c);vm.runInContext(source.slice(start,end)+';this.resolve=resolveOrderUserId',c);
 const client={query:async()=>{queries++;return {rows:[]}}};assert.equal(await c.resolve(client,{sessionId:'valid',userId:'spoof'}),'quanshan-id');await assert.rejects(c.resolve(client,{sessionId:'expired'}),/失效/);assert.equal(queries,0);
});
