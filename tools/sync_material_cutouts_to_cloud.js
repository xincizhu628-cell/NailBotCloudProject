const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env"));

const materialIds = ["123", "124", "125", "126", "127", "128", "129", "130"];
const sourceDir = path.join(root, "assets", "materials", "generated-nail-cutouts");

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

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function r2PublicUrl(publicBaseUrl, key) {
  return `${publicBaseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function materialFile(materialNumber, fingerIndex) {
  return path.join(sourceDir, `material-${materialNumber}-finger-${fingerIndex}.png`);
}

function materialKey(materialNumber, fingerIndex) {
  return `materials/generated-nail-cutouts/material-${materialNumber}-finger-${fingerIndex}.png`;
}

async function uploadCutouts() {
  const endpoint = process.env.R2_ENDPOINT || `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const bucket = requireEnv("R2_BUCKET");
  const publicBaseUrl = requireEnv("R2_PUBLIC_BASE_URL");
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });

  const urlsByMaterial = new Map();
  for (const materialNumber of materialIds) {
    const urls = [];
    for (let fingerIndex = 1; fingerIndex <= 5; fingerIndex += 1) {
      const filePath = materialFile(materialNumber, fingerIndex);
      if (!fs.existsSync(filePath)) throw new Error(`Missing cutout file: ${filePath}`);
      const key = materialKey(materialNumber, fingerIndex);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.readFileSync(filePath),
        ContentType: "image/png",
      }));
      urls.push(r2PublicUrl(publicBaseUrl, key));
      console.log(`[r2] uploaded ${key}`);
    }
    urlsByMaterial.set(materialNumber, urls);
  }
  return urlsByMaterial;
}

async function updatePostgres(urlsByMaterial) {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  try {
    for (const [materialNumber, urls] of urlsByMaterial.entries()) {
      const result = await pool.query(
        `
        UPDATE materials
        SET image=$1, updated_at=CURRENT_TIMESTAMP
        WHERE material_id=$2
           OR material_id=$3
           OR material ILIKE $4
        `,
        [JSON.stringify(urls), `m${materialNumber}`, materialNumber, `${materialNumber}%`],
      );
      console.log(`[postgres] material ${materialNumber}: ${result.rowCount} row(s) updated`);
      if (!result.rowCount) {
        console.warn(`[warn] no material row matched ${materialNumber}`);
      }
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  if (!fs.existsSync(sourceDir)) throw new Error(`Missing source directory: ${sourceDir}`);
  const urlsByMaterial = await uploadCutouts();
  await updatePostgres(urlsByMaterial);
  console.log(JSON.stringify({
    ok: true,
    materialCount: urlsByMaterial.size,
    imageCount: [...urlsByMaterial.values()].reduce((sum, urls) => sum + urls.length, 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, program: "sync_material_cutouts_to_cloud", error: error.message }, null, 2));
  process.exit(1);
});
