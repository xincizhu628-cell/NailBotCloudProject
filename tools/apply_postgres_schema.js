const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add your Supabase/Postgres connection string first.");
  }
  const schemaPath = path.join(root, "database", "schema.postgres.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Missing schema file: ${schemaPath}`);
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(fs.readFileSync(schemaPath, "utf8"));
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ ok: true, schema: schemaPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
