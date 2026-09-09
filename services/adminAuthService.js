const crypto = require('node:crypto');
const { promisify } = require('node:util');
const pbkdf2 = promisify(crypto.pbkdf2);
const maxAge = 8 * 60 * 60;
const publicAdmin = row => ({ adminId: row.admin_id, displayName: row.display_name || row.admin_id, role: row.role, status: row.status });
function createAdminAuthService(pool) {
  return async function run(payload) {
    if (payload.action === 'login') {
      const id = String(payload.adminId || '').trim();
      const password = String(payload.password || '');
      const row = (await pool.query('SELECT * FROM admin_users WHERE admin_id=$1', [id])).rows[0];
      const expected = Buffer.from(row?.password_hash || '', 'base64');
      const actual = await pbkdf2(password, Buffer.from(row?.password_salt || 'AAAAAAAAAAAAAAAAAAAAAA==', 'base64'), 180000, 32, 'sha256');
      if (!id || !password || !row || row.status !== 'active' || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false, error: 'Admin ID or password is incorrect.' };
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
      await pool.query('INSERT INTO admin_sessions(session_id,admin_id,expires_at) VALUES ($1,$2,$3)', [token,id,expiresAt]);
      await pool.query('UPDATE admin_users SET last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE admin_id=$1',[id]);
      return {ok:true,admin:publicAdmin(row),session:{token,maxAge,expiresAt}};
    }
    if (payload.action === 'logout') {
      await pool.query('DELETE FROM admin_sessions WHERE session_id=$1',[payload.token || '']);
      return {ok:true};
    }
    if (payload.action === 'create_admin') {
      const id=String(payload.adminId || '').trim(), password=String(payload.password || '');
      if (!id || password.length < 6) return {ok:false,error:'Admin ID and a password of at least 6 characters are required.'};
      const salt=crypto.randomBytes(16);const hash=await pbkdf2(password,salt,180000,32,'sha256');
      const result=await pool.query(`INSERT INTO admin_users(admin_id,display_name,password_hash,password_salt,role,status)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (admin_id) DO NOTHING RETURNING *`,
      [id,String(payload.displayName || id),hash.toString('base64'),salt.toString('base64'),String(payload.role || 'admin'),payload.status==='disabled'?'disabled':'active']);
      return result.rows.length ? {ok:true,admin:publicAdmin(result.rows[0])} : {ok:false,error:'This Admin ID already exists.'};
    }
    if (!payload.token) return {ok:false,error:'Admin login required.'};
    const row=(await pool.query(`SELECT u.*,s.expires_at FROM admin_sessions s JOIN admin_users u ON u.admin_id=s.admin_id WHERE s.session_id=$1`,[payload.token])).rows[0];
    if (!row || row.status!=='active' || !(Date.parse(row.expires_at)>Date.now())) return {ok:false,error:'Admin session is invalid or expired.'};
    return {ok:true,admin:publicAdmin(row),expiresAt:row.expires_at};
  };
}
module.exports={createAdminAuthService};
