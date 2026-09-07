function createCodeConfirmationService({ pool, codes, env = process.env, fetchImpl = globalThis.fetch, logger = console }) {
  const endpoint = env.MANUFACTURER_CONFIRM_API_URL || 'api/confirm';
  let timer, stopped = true, failures = 0;
  async function pollOnce() {
    if (!/^https?:\/\//i.test(endpoint)) return { skipped: true, reason: 'Manufacturer endpoint is a placeholder' };
    if (!env.MANUFACTURER_API_TOKEN) throw new Error('MANUFACTURER_API_TOKEN is required');
    return codes.transaction(async client => {
      // Transaction-scoped lock works through Supabase transaction pooling and across replicas.
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(73612094) AS acquired");
      if (!lock.rows[0].acquired) return { skipped: true };
      const state = (await client.query("SELECT cursor FROM order_code_sync_state WHERE name='manufacturer'")).rows[0];
      const url = new URL(endpoint);
      if (state?.cursor) url.searchParams.set('cursor', state.cursor);
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.MANUFACTURER_API_TOKEN}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Manufacturer confirmation HTTP ${response.status}`);
      const body = await response.json();
      if (typeof body.cursor !== 'string' || body.cursor.length > 4096) throw new Error('Invalid confirmation cursor');
      await codes.applyConfirmations(client, body.updates);
      await client.query("UPDATE order_code_sync_state SET cursor=$1 WHERE name='manufacturer'", [body.cursor]);
      return { count: body.updates.length };
    });
  }
  async function tick() {
    try { await pollOnce(); failures = 0; }
    catch (error) { failures++; logger.error('Code confirmation failed:', error.message); }
    if (!stopped) {
      const interval = Math.max(1000, Number(env.MANUFACTURER_CONFIRM_INTERVAL_MS) || 5000);
      timer = setTimeout(tick, Math.min(60000, interval * 2 ** Math.min(failures, 4)));
      timer.unref?.();
    }
  }
  return { pollOnce, start() { if (stopped && /^https?:\/\//i.test(endpoint)) { stopped = false; void tick(); } }, stop() { stopped = true; clearTimeout(timer); } };
}
module.exports = { createCodeConfirmationService };
