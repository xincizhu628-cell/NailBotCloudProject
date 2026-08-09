const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));

const csvDir = path.join(root, "migration_export", "postgres_csv");
const manifestPath = path.join(csvDir, "manifest.json");

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function coerceValue(value) {
  return value === "" ? null : value;
}

function normalizeCell(table, column, value) {
  const text = String(value ?? "").trim();

  if (table === "device_info" && column === "type") {
    const deviceTypeMap = new Map([
      ["主机", "main_unit"],
      ["main", "main_unit"],
      ["main_unit", "main_unit"],
      ["打印机", "printer"],
      ["printer", "printer"],
    ]);
    return deviceTypeMap.get(text) || value;
  }

  if (table === "promotion" && column === "promo_type") {
    const promoTypeMap = new Map([
      ["满减优惠", "money_off"],
      ["money_off", "money_off"],
      ["折扣优惠", "percent_off"],
      ["percent_off", "percent_off"],
      ["买送优惠", "buy_x_get_y"],
      ["buy_x_get_y", "buy_x_get_y"],
      ["免费商品", "free_product"],
      ["free_product", "free_product"],
    ]);
    return promoTypeMap.get(text) || value;
  }

  return value;
}

async function insertTable(client, tableInfo) {
  const filePath = path.join(csvDir, tableInfo.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[skip] Missing CSV: ${tableInfo.file}`);
    return { table: tableInfo.table, rows: 0, skipped: true };
  }
  const rows = parseCsv(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (rows.length < 2) return { table: tableInfo.table, rows: 0 };
  const columns = rows[0];
  const data = rows.slice(1).filter((row) => row.length && row.some((value) => value !== ""));
  if (!data.length) return { table: tableInfo.table, rows: 0 };

  const batchSize = 100;
  let inserted = 0;
  for (let offset = 0; offset < data.length; offset += batchSize) {
    const batch = data.slice(offset, offset + batchSize);
    const values = [];
    const groups = batch.map((row, rowIndex) => {
      const placeholders = columns.map((_, columnIndex) => {
        values.push(coerceValue(normalizeCell(tableInfo.table, columns[columnIndex], row[columnIndex] ?? "")));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql = [
      `INSERT INTO ${quoteIdent(tableInfo.table)} (${columns.map(quoteIdent).join(", ")})`,
      `VALUES ${groups.join(", ")}`,
      "ON CONFLICT DO NOTHING",
    ].join(" ");
    await client.query(sql, values);
    inserted += batch.length;
  }
  return { table: tableInfo.table, rows: inserted };
}

async function resetSequences(client) {
  const serials = await client.query(`
    SELECT sequence_schema, sequence_name, table_name, column_name
    FROM information_schema.sequences s
    JOIN information_schema.columns c
      ON c.column_default LIKE '%' || s.sequence_name || '%'
    WHERE sequence_schema = 'public'
  `);
  for (const row of serials.rows) {
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdent(row.column_name)}) FROM ${quoteIdent(row.table_name)}), 1), true)`,
      [`${row.sequence_schema}.${row.sequence_name}`],
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add your Supabase/Postgres connection string to .env first.");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing export manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const results = [];
  try {
    await client.query("BEGIN");
    for (const tableInfo of manifest.tables) {
      const result = await insertTable(client, tableInfo);
      results.push(result);
      console.log(`[import] ${result.table}: ${result.rows}`);
    }
    await resetSequences(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ ok: true, tables: results.length, rows: results.reduce((sum, item) => sum + item.rows, 0) }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
