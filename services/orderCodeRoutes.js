const crypto = require('node:crypto');
function authorized(req, expected) {
  const value = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!expected || !value) return false;
  const left = Buffer.from(value), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function createOrderCodeRoutes({ codes, env, readJson, sendJson }) {
  return async function handle(req, res, url) {
    const admin = url.pathname === '/api/admin/order-codes';
    const manufacturer = url.pathname === '/api/manufacturer/codes';
    if (!admin && !manufacturer) return false;
    const token = admin ? env.ADMIN_CODE_API_TOKEN : env.MANUFACTURER_CODES_API_TOKEN;
    res.setHeader('Cache-Control', 'no-store');
    if (!authorized(req, token)) { sendJson(res, 401, { ok: false, error: 'Valid API token required' }); return true; }
    if (!codes) { sendJson(res, 503, { ok: false, error: 'Database not configured' }); return true; }
    try {
      let data;
      if (req.method === 'GET') {
        const type = url.searchParams.get('type') || 'print';
        const rows = await codes.list(type, url.searchParams.get('after_id') || '0', url.searchParams.get('limit'));
        data = { rows, next_after_id: rows.at(-1)?.id || null };
      } else if (admin && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body.order_id !== 'string' || !body.order_id.trim() || !['print','pickup'].includes(body.type)) throw new Error('type and order_id are required');
        data = await codes.transaction(client => codes.generateForOrder(client, body.order_id.trim(), body.type));
      } else if (admin && req.method === 'DELETE') {
        const body = await readJson(req);
        if (!/^\d+$/.test(String(body.id))) throw new Error('Invalid code id');
        data = await codes.remove(body.type, body.id);
      } else { sendJson(res, 405, { ok: false, error: 'Method not allowed' }); return true; }
      sendJson(res, 200, { ok: true, ...data });
    } catch (error) {
      console.error('Order code operation failed:', error.message);
      sendJson(res, 400, { ok: false, error: ['42P01','42703'].includes(error.code) ? 'Run the order-code migration first' : error.message });
    }
    return true;
  };
}
module.exports = { createOrderCodeRoutes, authorized };
