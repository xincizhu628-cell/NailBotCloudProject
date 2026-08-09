const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));

const manifestPath = path.join(root, "migration_export", "asset_manifest.csv");
const dbExtractDir = path.join(root, "migration_export", "db_extracted_assets");
const outputPath = path.join(root, "migration_export", "asset_upload_results.json");

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
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsFromCsv(filePath) {
  const parsed = parseCsv(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const headers = parsed[0] || [];
  return parsed.slice(1).filter((row) => row.length).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] || "";
    });
    return item;
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env first.`);
  return value;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function localFileFor(row) {
  if (row.source === "file") return path.join(root, row.local_path);
  if (row.source === "database_base64") return path.join(dbExtractDir, row.target_key);
  return "";
}

async function main() {
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
  const bucket = requireEnv("R2_BUCKET");
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("R2_ENDPOINT or R2_ACCOUNT_ID is missing.");
  if (!publicBaseUrl) throw new Error("R2_PUBLIC_BASE_URL is missing.");
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing asset manifest: ${manifestPath}`);

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  const rows = rowsFromCsv(manifestPath);
  const uploaded = [];
  for (const row of rows) {
    const filePath = localFileFor(row);
    if (!filePath || !fs.existsSync(filePath)) {
      uploaded.push({ ...row, ok: false, error: "local file missing", public_url: "" });
      console.warn(`[missing] ${row.target_key}`);
      continue;
    }
    const body = fs.readFileSync(filePath);
    const contentType = row.mime_type || "application/octet-stream";
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: row.target_key,
      Body: body,
      ContentType: contentType,
    }));
    const publicUrl = `${publicBaseUrl}/${row.target_key.split("/").map(encodeURIComponent).join("/")}`;
    uploaded.push({ ...row, ok: true, size_bytes: body.length, sha256: sha256(body), public_url: publicUrl });
    console.log(`[upload] ${row.target_key}`);
  }
  fs.writeFileSync(outputPath, JSON.stringify({ ok: true, uploaded }, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, output: outputPath, count: uploaded.length }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
