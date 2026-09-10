const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
for (const line of (fs.existsSync(path.join(root,'.env')) ? fs.readFileSync(path.join(root,'.env'),'utf8') : '').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL in .env first');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (process.argv.includes('--apply-manual')) {
      await client.query('BEGIN');
      try {await client.query(fs.readFileSync(path.join(root,'database/migrations/20260910_manual_codes.sql'),'utf8'));await client.query('COMMIT');console.log('Manual code migration applied');}catch(error){await client.query('ROLLBACK');throw error;}
    } else if (process.argv.includes('--apply-fulfillment')) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(73612096)');
        await client.query(fs.readFileSync(path.join(root,'database/migrations/20260909_order_fulfillment.sql'),'utf8'));
        await client.query('COMMIT');
        console.log('Order fulfillment migration applied');
      } catch(error){await client.query('ROLLBACK');throw error;}
    } else if (process.argv.includes('--apply')) {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(73612095)");
        await client.query(fs.readFileSync(path.join(root,'database/migrations/20260907_order_codes.sql'),'utf8'));
        await client.query(fs.readFileSync(path.join(root,'database/migrations/20260907_unbound_order_codes.sql'),'utf8'));
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
      console.log('Order-code migration applied');
    } else {
      // Metadata only. Never export customer records or credentials.
      const columns = (await client.query("SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
      const constraints = (await client.query("SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname")).rows;
      const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
      const policies = (await client.query("SELECT * FROM pg_policies WHERE schemaname='public'")).rows;
      const tables = (await client.query("SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r'")).rows;
      const triggers = (await client.query("SELECT event_object_table,trigger_name,action_statement FROM information_schema.triggers WHERE trigger_schema='public'")).rows;
      const dir = path.join(root,'work'); fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'supabase-schema.json'),JSON.stringify({columns,constraints,indexes,policies,tables,triggers},null,2));
      console.log(`Schema snapshot saved: ${tables.length} tables, ${columns.length} columns (work/supabase-schema.json)`);
    }
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
