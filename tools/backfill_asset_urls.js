const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));

const uploadResultsPath = path.join(root, "migration_export", "asset_upload_results.json");

const primaryKeys = {
  assets: "asset_id",
  products: "product_id",
  promotional_assets: "promo_asset_id",
  rewards: "reward_id",
};

const base64UrlColumns = {
  assets: { base64: "base64_data", url: "url" },
  products: { base64: "image_base64", url: "image_url" },
  promotional_assets: { base64: "image_base64", url: "image_url" },
  rewards: { base64: "image_base64", url: "image_url" },
};

const localPathColumns = [
  { table: "assets", column: "url" },
  { table: "materials", column: "image" },
  { table: "products", column: "image_url" },
  { table: "promotional_assets", column: "image_url" },
  { table: "rewards", column: "image_url" },
];

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

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function publicUrlFor(row) {
  if (row.public_url) return row.public_url;
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!publicBaseUrl || !row.target_key) return "";
  return `${publicBaseUrl}/${String(row.target_key).split("/").map(encodeURIComponent).join("/")}`;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env first.`);
  return value;
}

async function updateBase64Asset(client, row, publicUrl) {
  const table = row.table;
  const recordId = row.record_id;
  const config = base64UrlColumns[table];
  const primaryKey = primaryKeys[table];
  if (!config || !primaryKey || !recordId) return 0;

  const sql = [
    `UPDATE ${quoteIdent(table)}`,
    `SET ${quoteIdent(config.url)} = $1, ${quoteIdent(config.base64)} = NULL`,
    `WHERE ${quoteIdent(primaryKey)}::text = $2`,
  ].join(" ");
  const result = await client.query(sql, [publicUrl, String(recordId)]);
  return result.rowCount;
}

async function updateLocalPathReferences(client, row, publicUrl) {
  const localPath = row.local_path || row.current_url;
  if (!localPath) return 0;

  let changed = 0;
  for (const target of localPathColumns) {
    const sql = [
      `UPDATE ${quoteIdent(target.table)}`,
      `SET ${quoteIdent(target.column)} = $1`,
      `WHERE ${quoteIdent(target.column)} = $2`,
    ].join(" ");
    const result = await client.query(sql, [publicUrl, localPath]);
    changed += result.rowCount;
  }
  return changed;
}

async function main() {
  if (!fs.existsSync(uploadResultsPath)) {
    throw new Error(`Missing upload result file: ${uploadResultsPath}. Run npm run migrate:assets first.`);
  }
  const payload = JSON.parse(fs.readFileSync(uploadResultsPath, "utf8"));
  const rows = Array.isArray(payload.uploaded) ? payload.uploaded : [];
  if (!rows.length) throw new Error("asset_upload_results.json has no uploaded items.");

  const rowsWithUrl = rows
    .filter((row) => row.ok !== false)
    .map((row) => ({ ...row, resolved_public_url: publicUrlFor(row) }))
    .filter((row) => row.resolved_public_url);

  if (!rowsWithUrl.length) {
    throw new Error("No public URLs found. Set R2_PUBLIC_BASE_URL in .env, then run this script again.");
  }

  const client = new Client({
    connectionString: requireEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  let base64Rows = 0;
  let pathRows = 0;
  try {
    await client.query("BEGIN");
    for (const row of rowsWithUrl) {
      if (row.source === "database_base64") {
        base64Rows += await updateBase64Asset(client, row, row.resolved_public_url);
      }
      pathRows += await updateLocalPathReferences(client, row, row.resolved_public_url);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    ok: true,
    scanned_assets: rows.length,
    assets_with_public_url: rowsWithUrl.length,
    base64_records_updated: base64Rows,
    local_path_records_updated: pathRows,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    code: error.code || "",
    detail: error.detail || "",
    table: error.table || "",
    constraint: error.constraint || "",
  }, null, 2));
  process.exit(1);
});
