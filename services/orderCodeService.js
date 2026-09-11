const crypto = require('node:crypto');
const TABLES = { print: '"print-code"', pickup: '"pickup-code"' };
function table(type) {
  if (!TABLES[type]) throw new Error('Unknown code type');
  return TABLES[type];
}
function printableUnits(items) {
  return items.flatMap(item => {
    let snapshot = item.item_snapshot || {};
    if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = {}; } }
    const name = snapshot.product_name || item.product_name || snapshot.name || '';
    if (!/printing/i.test(name)) return [];
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Invalid printable quantity');
    return Array.from({ length: quantity }, (_, i) => ({ order_item_id: item.order_item_id, product_id: item.product_id, unit_number: i + 1 }));
  });
}
function createOrderCodeService(pool, { randomInt = crypto.randomInt } = {}) {
  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function lockOrder(client, orderId) {
    const { rows } = await client.query('SELECT order_id FROM orders WHERE order_id=$1 FOR UPDATE', [orderId]);
    if (!rows.length) throw new Error('Order not found');
  }
  async function allocate(client) {
    // Index-backed INSERT handles concurrent collisions without aborting the transaction.
    for (let attempt = 0; attempt < 128; attempt++) {
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const result = await client.query('INSERT INTO order_code_registry(code) VALUES ($1) ON CONFLICT DO NOTHING RETURNING code', [code]);
      if (result.rows.length) return code;
    }
    throw new Error('Code space is busy or exhausted; retry later. No partial order was saved.');
  }
  async function generatePrintCode() {
    throw new Error('打印码由厂家生成，不再支持本地生成');
  }
  async function generatePickupCode(client, orderId = null) {
    if (orderId === null) {
      const code = await allocate(client);
      return (await client.query('INSERT INTO "pickup-code"(code,order_id) VALUES ($1,NULL) RETURNING *', [code])).rows[0];
    }
    await lockOrder(client, orderId);
    const existing = await client.query('SELECT * FROM "pickup-code" WHERE order_id=$1', [orderId]);
    if (existing.rows.length) return existing.rows[0];
    const code = await allocate(client);
    return (await client.query('INSERT INTO "pickup-code"(code,order_id) VALUES ($1,$2) RETURNING *', [code, orderId])).rows[0];
  }
  async function getOrderCodes(client, orderId) {
    const printCodes = (await client.query('SELECT * FROM "print-code" WHERE order_id=$1 ORDER BY id', [orderId])).rows;
    const pickupCode = (await client.query('SELECT * FROM "pickup-code" WHERE order_id=$1', [orderId])).rows[0] || null;
    return { printCodes, pickupCode };
  }
  async function updateLegacy(client, orderId) {
    await client.query(`UPDATE orders SET print_code=(SELECT code FROM "print-code" WHERE order_id=$1 ORDER BY id LIMIT 1),
      pickup_code=COALESCE((SELECT code FROM "pickup-code" WHERE order_id=$1),'000000') WHERE order_id=$1`, [orderId]);
  }
  async function generateForOrder(client, orderId, type = 'all') {
    if (!['all','pickup'].includes(type)) throw new Error('打印码由厂家生成，不再支持本地生成');
    await lockOrder(client, orderId);
    await generatePickupCode(client, orderId);
    await updateLegacy(client, orderId);
    return getOrderCodes(client, orderId);
  }
  function binding(value) {
    if(value==null || value==='')return null;
    if(typeof value!=='string')throw new Error('订单编号无效');
    return value.trim()||null;
  }
  async function checkPickupBinding(client,type,orderId,id=null) {
    if(type==='pickup' && orderId) {
      const result=await client.query('SELECT id FROM "pickup-code" WHERE order_id=$1 AND ($2::bigint IS NULL OR id<>$2)',[orderId,id]);
      if(result.rows.length)throw new Error('该订单已有取货码，不允许替换或重复绑定。');
    }
  }
  async function addManual(type,code,orderId) {
    if(type==='print')throw new Error('打印码由厂家生成，不再支持后台创建');
    const target=table(type);orderId=binding(orderId);
    if(typeof code!=='string'||!/^\d{6}$/.test(code))throw new Error('请输入六位纯数字码');
    return transaction(async client=>{
      if(orderId)await lockOrder(client,orderId);
      await checkPickupBinding(client,type,orderId);
      const reserved=await client.query('INSERT INTO order_code_registry(code) VALUES ($1) ON CONFLICT DO NOTHING RETURNING code',[code]);
      if(!reserved.rows.length)throw new Error('该码已存在或曾被使用，不能重复录入');
      const row=(await client.query(`INSERT INTO ${target}(code,order_id,code_origin,sync_status,use_status) VALUES($1,$2,'manual','success','inactive') RETURNING *`,[code,orderId])).rows[0];
      if(orderId)await updateLegacy(client,orderId);
      return row;
    });
  }
  async function rebindManual(type,id,orderId) {
    throw new Error(type==='print'?'打印码由厂家回调生成，不再支持后台修改绑定':'取货码不允许修改绑定');
  }
  async function list(type, after = '0', limit = 100) {
    table(type);
    if (!/^\d+$/.test(String(after))) throw new Error('Invalid after_id');
    return (await pool.query(`SELECT * FROM ${table(type)} WHERE id > $1 ORDER BY id LIMIT $2`, [after, Math.min(500, Math.max(1, Number(limit) || 100))])).rows;
  }
  async function remove(type, id) {
    return transaction(async client => {
      const row = (await client.query(`SELECT * FROM ${table(type)} WHERE id=$1`, [id])).rows[0];
      if (!row) throw new Error('Code not found');
      if (row.order_id !== null) await lockOrder(client, row.order_id);
      const deleted = (await client.query(`DELETE FROM ${table(type)} WHERE id=$1 RETURNING *`, [id])).rows[0];
      if (row.order_id !== null) await updateLegacy(client, row.order_id);
      return deleted;
    });
  }
  async function applyConfirmations(client, updates) {
    if (!Array.isArray(updates) || updates.length > 1000) throw new Error('Invalid confirmation batch');
    for (const update of updates) {
      const target = table(update.type);
      if (!/^\d+$/.test(String(update.id)) || !/^\d{6}$/.test(update.code) ||
          !(update.order_id === null || (typeof update.order_id === 'string' && update.order_id.trim())) ||
          !['inactive','active'].includes(update.use_status) || !['pending','success','fail'].includes(update.sync_status) ||
          !Number.isSafeInteger(update.version) || update.version < 1) throw new Error('Invalid confirmation');
      // Increasing manufacturer versions prevent duplicate/out-of-order responses reverting state.
      const result = await client.query(`UPDATE ${target} SET use_status=$1,sync_status=$2,confirm_version=$3,updated_at=now()
        WHERE id=$4 AND code=$5 AND order_id IS NOT DISTINCT FROM $6 AND confirm_version < $3 RETURNING id`,
      [update.use_status, update.sync_status, update.version, update.id, update.code, update.order_id]);
      if (!result.rows.length) {
        const existing = await client.query(`SELECT id FROM ${target} WHERE id=$1 AND code=$2 AND order_id IS NOT DISTINCT FROM $3`, [update.id, update.code, update.order_id]);
        // Deleted records are deliberately ignored; they must never be recreated by a confirmation.
        if (!existing.rows.length) continue;
      }
    }
  }
  return { addManual, rebindManual, transaction, generatePrintCode, generatePickupCode, generateForOrder, getOrderCodes, list, remove, applyConfirmations };
}
module.exports = { createOrderCodeService, printableUnits };


