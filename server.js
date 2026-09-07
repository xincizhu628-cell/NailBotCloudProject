const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const crypto = require("crypto");
const { Pool } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { createSquarePaymentService } = require("./services/squarePaymentService");

const { createOrderCodeService } = require("./services/orderCodeService");
const { createCodeConfirmationService } = require("./services/codeConfirmationService");
const { createOrderCodeRoutes } = require("./services/orderCodeRoutes");

const root = path.resolve(__dirname || process.cwd());
loadEnvFile(path.join(root, ".env"));
const bundledPython = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");

const port = Number(process.env.PORT || 4174);
const squarePaymentService = createSquarePaymentService({ env: process.env });
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const pgPool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: String(process.env.DATABASE_SSL || "true").toLowerCase() === "false" ? false : { rejectUnauthorized: false },
}) : null;
const orderCodes = pgPool ? createOrderCodeService(pgPool) : null;
const codeRoutes = createOrderCodeRoutes({ codes: orderCodes, env: process.env, readJson, sendJson });
const codeConfirmation = pgPool ? createCodeConfirmationService({ pool: pgPool, codes: orderCodes }) : null;
const defaultModel = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
const defaultArkModel = process.env.ARK_IMAGE_MODEL || "seedream-4-5-251128";
const defaultArkEndpoint = process.env.ARK_IMAGE_ENDPOINT || "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
const defaultArkEditModel = process.env.ARK_EDIT_MODEL || "doubao-seededit-3-0-i2i-25062";
const defaultArkEditBaseUrl = process.env.ARK_EDIT_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const defaultArkEditEndpoint = process.env.ARK_EDIT_ENDPOINT || `${defaultArkEditBaseUrl.replace(/\/+$/, "")}/images/generations`;
const maxJsonBodyBytes = 256 * 1024 * 1024;
const adminCookieName = "nail_admin_session";
let pgAdminRuntimeSchemaReady = false;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  let url = null;
  try {
    url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    res.errorContext = requestErrorContext(req, url);
    if (await codeRoutes(req, res, url)) return;
    /*
    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      await handleAdminLogin(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/logout") {
      await handleAdminLogout(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/session") {
      await handleAdminSession(req, res);
      return;
    }
    */
    // Temporarily bypass admin auth while checking Railway/admin routing.
    // Restore this guard before production admin access is opened.
    // if (await rejectUnauthenticatedAdminRequest(req, res, url)) {
    //   return;
    // }
    /*
    if (req.method === "POST" && url.pathname === "/api/admin/create-account") {
      await handleAdminCreateAccount(req, res);
      return;
    }
    */
    if (req.method === "POST" && url.pathname === "/api/ai-generate") {
      await handleAiGenerate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/ai-preview-compose") {
      await handleAiPreviewCompose(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/seededit-test") {
      await handleSeedEditTest(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/db-url-diagnostic") {
      handleDbUrlDiagnostic(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/static-diagnostic") {
      handleStaticDiagnostic(req, res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/session") {
      await handleUserSession(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/login") {
      await handleUserLogin(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/request-code") {
      await handleUserRequestCode(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/create-account") {
      await handleUserCreateAccount(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/reset-password") {
      await handleUserResetPassword(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/logout") {
      await handleUserLogout(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/auth-session") {
      await handleUserAuthSession(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/profile") {
      await handleUserProfile(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/promos") {
      await handleUserPromos(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/print-records") {
      await handleUserPrintRecords(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/update-contact") {
      await handleUserUpdateContact(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/shipping-address") {
      await handleUserShippingAddress(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user/action") {
      await handleUserAction(req, res);
      return;
    }
    if (url.pathname === "/api/template-social" && ["GET", "POST"].includes(req.method)) {
      await handleTemplateSocial(req, res, url);
      return;
    }
    if (url.pathname === "/api/user/draft" && ["GET", "POST"].includes(req.method)) {
      await handleUserDraft(req, res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/official-template") {
      await handleAdminOfficialTemplate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/community-template") {
      await handleCommunityTemplate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/import-product") {
      await handleAdminImportProduct(req, res);
      return;
    }
    if (url.pathname === "/api/admin/taxonomy" && ["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
      await handleAdminTaxonomy(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/create-record") {
      await handleAdminCreateRecord(req, res);
      return;
    }
    if (url.pathname === "/api/admin/record" && ["PATCH", "DELETE"].includes(req.method)) {
      await handleAdminRecordMutation(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/models") {
      await handleAdminModels(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/product-image") {
      await handleAdminProductImage(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/gallery-taxonomy") {
      await handleGalleryTaxonomy(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/public-catalog") {
      await handlePublicCatalog(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/square-config") {
      await handleSquareConfig(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/square-payment") {
      await handleSquarePayment(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/ai-health") {
      sendJson(res, 200, {
        hasToken: Boolean(process.env.HF_TOKEN),
        hasArkKey: Boolean(process.env.ARK_API_KEY),
        hasArkEditKey: Boolean(arkEditToken()),
        hasReplicateToken: Boolean(process.env.REPLICATE_API_TOKEN),
        hasCozePreviewEndpoint: Boolean(process.env.COZE_PREVIEW_ENDPOINT),
        publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
        seedEditReady: Boolean(arkEditToken()),
        model: process.env.HF_IMAGE_MODEL || defaultModel,
        arkModel: process.env.ARK_IMAGE_MODEL || defaultArkModel,
        arkEditModel: defaultArkEditModel,
        previewProvider: previewComposeProvider(),
        port,
        mode: "huggingface-router-primary-with-legacy-fallback-and-byteplus-ark",
        endpoints: [
          ...huggingFaceEndpoints().map((item) => item.label),
          "byteplus-ark-images-generations",
          "byteplus-ark-seededit-preview-compose",
        ],
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    serveStatic(url.pathname, res, req.method === "HEAD");
  } catch (error) {
    sendError(res, error.statusCode || 500, error, {
      program: "server.js",
      module: "http-router",
      operation: url ? `${req.method} ${url.pathname}` : `${req.method} ${req.url || "/"}`,
    });
  }
});

const nailGenerationTargets = [
  { step: "step2-1", nail: "thumb", label: "Thumb" },
  { step: "step2-2", nail: "index finger", label: "Index" },
  { step: "step2-3", nail: "middle finger", label: "Middle" },
  { step: "step2-4", nail: "ring finger", label: "Ring" },
  { step: "step2-5", nail: "pinky finger", label: "Pinky" },
];

server.on("close", () => codeConfirmation?.stop());
server.listen(port, "0.0.0.0", () => {
  codeConfirmation?.start();
  console.log(`AI Nail Studio server running at http://127.0.0.1:${port}/`);
  console.log(`AI image model: ${process.env.HF_IMAGE_MODEL || defaultModel}`);
  console.log(`Ark image model: ${process.env.ARK_IMAGE_MODEL || defaultArkModel}`);
});

function databaseUrlDiagnostic() {
  const raw = process.env.DATABASE_URL || "";
  const cleaned = String(raw).trim();
  if (!cleaned) {
    return {
      configured: false,
      error: "DATABASE_URL is not set.",
      expectedFormat: "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres",
    };
  }
  try {
    const parsed = new URL(cleaned);
    const username = decodeURIComponent(parsed.username || "");
    const hostname = parsed.hostname || "";
    const pathname = parsed.pathname || "";
    const isPooler = hostname.includes(".pooler.supabase.com");
    const isDirect = hostname.startsWith("db.") && hostname.endsWith(".supabase.co");
    const projectRefFromUser = username.startsWith("postgres.") ? username.slice("postgres.".length) : "";
    const projectRefFromDirectHost = isDirect ? hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "") : "";
    const likelyProblems = [];
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      likelyProblems.push("Protocol should be postgres:// or postgresql://.");
    }
    if (raw.includes("\\")) {
      likelyProblems.push("DATABASE_URL contains backslashes. Remove backslashes.");
    }
    if (hostname.includes("[") || hostname.includes("]")) {
      likelyProblems.push("Host still contains a placeholder like [REGION].");
    }
    if (isPooler && !hostname.startsWith("aws-0-")) {
      likelyProblems.push("Supabase pooler host usually starts with aws-0-. This host may be missing the 0- segment.");
    }
    if (isPooler && !username.startsWith("postgres.")) {
      likelyProblems.push("Pooler username should look like postgres.<project-ref>.");
    }
    if (isDirect && username !== "postgres") {
      likelyProblems.push("Direct connection username should usually be postgres.");
    }
    if (!isPooler && !isDirect) {
      likelyProblems.push("Host does not look like a Supabase pooler or direct database host.");
    }
    return {
      configured: true,
      rawPreview: cleaned.replace(/:([^:@/]+)@/, ":***@"),
      hadLeadingOrTrailingWhitespace: raw !== cleaned,
      protocol: parsed.protocol,
      username,
      passwordPresent: Boolean(parsed.password),
      hostname,
      port: parsed.port || "(default)",
      database: pathname.replace(/^\//, "") || "(none)",
      connectionKind: isPooler ? "supabase-pooler" : isDirect ? "supabase-direct" : "unknown",
      projectRef: projectRefFromUser || projectRefFromDirectHost || "(not detected)",
      query: parsed.search || "",
      likelyProblems,
    };
  } catch (error) {
    return {
      configured: true,
      parseable: false,
      rawPreview: cleaned.replace(/:([^:@/]+)@/, ":***@"),
      hadLeadingOrTrailingWhitespace: raw !== cleaned,
      error: error.message || "DATABASE_URL could not be parsed.",
      expectedFormat: "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres",
    };
  }
}

function handleDbUrlDiagnostic(req, res) {
  sendJson(res, 200, {
    ok: true,
    diagnostic: databaseUrlDiagnostic(),
  }, { "Cache-Control": "no-store" });
}

function handleStaticDiagnostic(req, res, url) {
  const requested = url.searchParams.get("path") || "assets/materials/generated-nail-cutouts/material-124-finger-2.png";
  const cleanRequested = requested.replace(/^[/\\]+/, "");
  const normalized = path.normalize(cleanRequested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(root, normalized);
  const dirPath = path.dirname(filePath);
  const exists = filePath.startsWith(root) && fs.existsSync(filePath);
  const dirExists = dirPath.startsWith(root) && fs.existsSync(dirPath);
  const siblings = dirExists ? fs.readdirSync(dirPath).slice(0, 20) : [];
  sendJson(res, 200, {
    ok: true,
    root,
    requested,
    normalized,
    filePath,
    exists,
    dirPath,
    dirExists,
    siblings,
  }, { "Cache-Control": "no-store" });
}

async function handleAiGenerate(req, res) {
  const body = await readJson(req);
  const prompt = String(body.prompt || "").trim();
  const flow = body.flow === "asset" ? "asset" : "image";
  const requestedModel = String(body.model || process.env.HF_IMAGE_MODEL || defaultModel).trim();
  const references = Array.isArray(body.references) ? body.references.filter(Boolean) : [];
  const count = Math.max(1, Math.min(3, Number(body.count || 3)));
  const includePreview = Boolean(body.preview);
  if (!prompt) {
    sendJson(res, 400, { error: "Prompt is required." });
    return;
  }
  if (isArkModel(requestedModel)) {
    await handleArkGenerate(res, { prompt, flow, requestedModel, references, includePreview });
    return;
  }

  const token = process.env.HF_TOKEN;
  if (!token) {
    console.warn("[ai-generate] HF_TOKEN is not configured; using sample image.");
    const step2Images = nailGenerationTargets.map((target) => makeSampleImage(`${prompt} ${target.label}`, flow));
    const step3Image = includePreview ? makeSampleImage(`${prompt} hand preview`, "preview") : "";
    sendJson(res, 200, {
      provider: "sample",
      outputs: buildAiOutputs(step2Images, step3Image),
      images: step2Images,
      previewImage: step3Image,
      message: "HF_TOKEN is not configured. Returned a local sample image.",
    });
    return;
  }

  const errors = [];
  const images = [];
  let previewImage = "";
  let usedProvider = "";
  let usedEndpoint = "";
  for (const target of nailGenerationTargets) {
    const nailPrompt = buildPrompt(prompt, flow, references, "design", target);
    let generated = false;
    for (const endpoint of huggingFaceEndpoints(requestedModel)) {
      try {
        const result = await requestHuggingFace(endpoint, token, nailPrompt);
        images.push(`data:${result.contentType};base64,${result.buffer.toString("base64")}`);
        usedProvider = result.provider;
        usedEndpoint = endpoint.label;
        generated = true;
        break;
      } catch (error) {
        const message = `${endpoint.label}: ${networkErrorMessage(error)}`;
        errors.push(message);
        console.warn(`[ai-generate] ${message}`);
      }
    }
    if (!generated) {
      images.push(makeSampleImage(`${prompt} ${target.label}`, flow));
    }
  }
  if (images.length && includePreview) {
    const previewPrompt = buildPrompt(prompt, flow, references, "preview");
    for (const endpoint of huggingFaceEndpoints(requestedModel)) {
      try {
        const result = await requestHuggingFace(endpoint, token, previewPrompt);
        previewImage = `data:${result.contentType};base64,${result.buffer.toString("base64")}`;
        usedProvider = result.provider;
        usedEndpoint = endpoint.label;
        break;
      } catch (error) {
        const message = `${endpoint.label} preview: ${networkErrorMessage(error)}`;
        errors.push(message);
        console.warn(`[ai-generate] ${message}`);
      }
    }
  }
  if (!usedProvider && process.env.ARK_API_KEY) {
    await handleArkGenerate(res, {
      prompt,
      flow,
      requestedModel: defaultArkModel,
      references,
      includePreview,
      prependErrors: errors,
    });
    return;
  }
  if (images.length) {
    const step3Image = previewImage || makeSampleImage(`${prompt} hand preview`, "preview");
    sendJson(res, 200, {
      provider: usedProvider,
      endpoint: usedEndpoint,
      model: requestedModel,
      outputs: buildAiOutputs(images, step3Image),
      images,
      previewImage: step3Image,
    });
    return;
  }

  const step2Images = nailGenerationTargets.map((target) => makeSampleImage(`${prompt} ${target.label}`, flow));
  const step3Image = includePreview ? makeSampleImage(`${prompt} hand preview`, "preview") : "";
  sendJson(res, 200, {
    provider: "sample",
    outputs: buildAiOutputs(step2Images, step3Image),
    images: step2Images,
    previewImage: step3Image,
    message: `All Hugging Face endpoints failed: ${errors.join(" | ")}. Returned a local sample image.`,
  });
}

async function handleSquareConfig(req, res) {
  sendJson(res, 200, squarePaymentService.browserConfig());
}

async function handleSquarePayment(req, res) {
  const body = await readJson(req);
  const result = await squarePaymentService.createPayment(body);
  if (result.body?.ok && result.httpStatus >= 200 && result.httpStatus < 300) {
    try {
      result.body.order = await createPaidOrderRecord(body, result.body);
    } catch (error) {
      result.body.order = {
        ok: false,
        service: "orders",
        operation: "create-paid-order",
        error: error.message || "Payment succeeded, but order storage failed.",
      };
    }
  }
  sendJson(res, result.httpStatus, result.body);
}

function makeNumericCode(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, "0");
}

function itemLooksPrintable(item = {}, product = {}) {
  const values = [
    item.productType,
    item.product_type,
    item.printSourceType,
    item.type,
    item.name,
    item.zhName,
    item.id,
    product.product_type,
    product.product_name,
    product.product_id,
  ].filter(Boolean).join(" ").toLowerCase();
  return Boolean(item.isPrintService) || values.includes("print") || values.includes("打印甲") || values.includes("打印");
}

async function resolveOrderUserId(client, body = {}) {
  const sessionId = cleanPgText(body.sessionId);
  if (sessionId) {
    const session = await getPgAuthSession(sessionId).catch(() => null);
    if (session?.ok && session.user?.userId) return session.user.userId;
  }
  const guestId = `guest_checkout_${crypto.randomUUID().replace(/-/g, "")}`;
  await client.query(
    `
    INSERT INTO users (user_id, username, user_kind, recovery_code, last_seen_at)
    VALUES ($1, $2, 'guest', $3, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [guestId, `Guest ${guestId.slice(-6)}`, makeRecoveryCode()],
  );
  return guestId;
}

async function notifyManufacturerOrder(payload) {
  const endpoint = cleanPgText(process.env.MANUFACTURER_ORDER_API_URL);
  if (!endpoint) return { status: "not_configured", response: "", error: "" };
  try {
    const headers = { "Content-Type": "application/json" };
    const token = cleanPgText(process.env.MANUFACTURER_API_TOKEN);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) return { status: "failed", response: text.slice(0, 4000), error: `HTTP ${response.status}` };
    return { status: "synced", response: text.slice(0, 4000), error: "" };
  } catch (error) {
    return { status: "failed", response: "", error: error.message || "Manufacturer API request failed." };
  }
}

async function ensurePrintServiceProduct(client, items) {
  if (!items.some((item) => item.isPrintService && String(item.id) === "PRINT-SERVICE")) return null;
  return (await client.query(
    `
    INSERT INTO products (
      product_id, product_type, product_name, unit_price, product_info,
      stock_quantity, stock_s, stock_m, stock_l, stock_xl, pickup_method, status
    )
    VALUES ('PRINT-SERVICE', 'printing_nail', 'AI Nail Print Service (printing available)', $1, 'Printable nail order service', 9999, 9999, 9999, 9999, 9999, 'pickup', 'active')
    ON CONFLICT (product_id) DO UPDATE SET product_type=EXCLUDED.product_type, product_name=EXCLUDED.product_name
    RETURNING product_id, product_type, product_name, unit_price, bound_device_id
    `,
    [pgNumber(items.find((item) => item.isPrintService)?.price, 0)],
  )).rows[0];
}

async function createPaidOrderRecord(body = {}, payment = {}) {
  if (!hasPostgresRuntime()) return { ok: false, skipped: true, reason: "DATABASE_URL is not configured." };
  await ensurePgAdminRuntimeSchema();
  const items = Array.isArray(body.items) ? body.items.filter((item) => item && item.id).slice(0, 50) : [];
  if (!items.length) return { ok: false, skipped: true, reason: "No checkout items were supplied." };
  const client = await pgPool.connect();
  const orderId = `order_${crypto.randomUUID().replace(/-/g, "")}`;
  let pickupCode = "000000";
  let printCode = null;
  let generatedCodes = { printCodes: [], pickupCode: null };
  let boundDeviceId = "";
  let containsPrintable = false;
  try {
    await client.query("BEGIN");
    const paymentId = cleanPgText(payment.paymentId);
    if (!paymentId) throw new Error("A payment ID is required to create an order");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payment:${paymentId}`]);
    const existing = (await client.query("SELECT * FROM orders WHERE payment_provider_id=$1 ORDER BY created_at LIMIT 1", [paymentId])).rows[0];
    if (existing) {
      const saved = await orderCodes.getOrderCodes(client, existing.order_id);
      await client.query("COMMIT");
      return { ok: true, orderId: existing.order_id, pickupCode: saved.pickupCode?.code || existing.pickup_code,
        printCode: saved.printCodes[0]?.code || existing.print_code, printCodes: saved.printCodes,
        pickupCodeRecord: saved.pickupCode, containsPrintable: Boolean(saved.printCodes.length || existing.print_code),
        boundDeviceId: existing.bound_device_id, manufacturerSyncStatus: existing.manufacturer_sync_status };
    }
    const userId = await resolveOrderUserId(client, body);
    const serviceRow = await ensurePrintServiceProduct(client, items);
    const productRows = (await client.query(
      `
      SELECT product_id, product_type, product_name, unit_price, bound_device_id
      FROM products
      WHERE product_id = ANY($1::text[])
      `,
      [items.map((item) => String(item.id))],
    )).rows;
    const rows = serviceRow && !productRows.some((product) => product.product_id === serviceRow.product_id)
      ? [...productRows, serviceRow]
      : productRows;
    const products = new Map(rows.map((product) => [String(product.product_id), product]));

    boundDeviceId = cleanPgText(items.find((item) => item.pickupDeviceId)?.pickupDeviceId)
      || cleanPgText(items.find((item) => item.boundDeviceId)?.boundDeviceId)
      || cleanPgText(rows.find((product) => product.bound_device_id)?.bound_device_id);
    await client.query(
      `
      INSERT INTO orders (
        order_id, user_id, total_price, pay_method, payment_status, delivery_status, order_status,
        paid_at, pickup_code, print_code, bound_device_id, payment_provider_id,
        manufacturer_sync_status
      )
      VALUES ($1, $2, $3, 'square', 'paid', $4, 'paid', CURRENT_TIMESTAMP, $5, $6, $7, $8, 'pending')
      `,
      [
        orderId,
        userId,
        pgNumber(body.amount || payment.amount),
        boundDeviceId ? "pickup_pending" : "delivery_pending",
        pickupCode,
        printCode,
        boundDeviceId,
        cleanPgText(payment.paymentId),
      ],
    );
    for (const item of items) {
      const product = products.get(String(item.id));
      if (!product) throw new Error(`Product not found: ${item.id}`);
      const quantity = Number(item.qty ?? item.quantity ?? 1);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error("Invalid order quantity");
      await client.query(
        `
        INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price, size, item_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          `oi_${crypto.randomUUID().replace(/-/g, "")}`,
          orderId,
          String(item.id),
          quantity,
          pgNumber(item.price || product.unit_price),
          cleanPgText(item.size),
          JSON.stringify({ ...item, product_name: product.product_name }),
        ],
      );
    }
    generatedCodes = await orderCodes.generateForOrder(client, orderId);
    pickupCode = generatedCodes.pickupCode.code;
    printCode = generatedCodes.printCodes[0]?.code || null;
    containsPrintable = generatedCodes.printCodes.length > 0;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const manufacturerPayload = {
    orderId,
    paymentId: payment.paymentId || "",
    paymentStatus: payment.status || "COMPLETED",
    amount: payment.amount || body.amount,
    currency: body.currency || payment.currency || "AUD",
    pickupCode,
    printCode,
    printCodes: generatedCodes.printCodes,
    pickupCodeRecord: generatedCodes.pickupCode,
    containsPrintable,
    boundDeviceId,
    orderedAt: new Date().toISOString(),
    items,
  };
  const sync = await notifyManufacturerOrder(manufacturerPayload);
  await pgPool.query(
    `
    UPDATE orders
    SET manufacturer_sync_status=$1, manufacturer_sync_error=$2, manufacturer_response=$3
    WHERE order_id=$4
    `,
    [sync.status, sync.error, sync.response, orderId],
  ).catch(() => {});
  return {
    ok: true,
    orderId,
    pickupCode,
    printCode,
    printCodes: generatedCodes.printCodes,
    pickupCodeRecord: generatedCodes.pickupCode,
    containsPrintable,
    boundDeviceId,
    manufacturerSyncStatus: sync.status,
    manufacturerSyncError: sync.error,
  };
}

async function handleAiPreviewCompose(req, res) {
  const body = await readJson(req);
  const nailImages = Array.isArray(body.nailImages) ? body.nailImages.filter(Boolean).slice(0, 5) : [];
  const sourceImage = String(body.sourceImage || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!nailImages.length) {
    sendJson(res, 400, { error: "nailImages is required." });
    return;
  }
  try {
    const handImage = fileToDataUrl(path.join(root, "assets", "hand-preview-base.jpg"), "image/jpeg");
    const composePrompt = [
      "Create a realistic manicure preview by compositing the provided nail art decals onto the five visible fingernails in the hand image.",
      "Preserve the original hand photo, pose, skin, lighting, and background.",
      "Use the nail decal images in left-to-right finger order. Fit each decal exactly inside the visible fingernail area.",
      "Do not add extra fingers, text, logo, new jewelry, new hand pose, or a new background.",
      prompt ? `Original nail art request: ${prompt}` : "",
    ].filter(Boolean).join(" ");

    if (defaultArkEditModel && arkEditToken()) {
      const result = await requestBytePlusArkPreviewCompose({ prompt: composePrompt, sourceImage: sourceImage || handImage, handImage, nailImages });
      sendJson(res, 200, { provider: "byteplus-ark-seededit", image: result, message: "AI preview composed by BytePlus Ark SeedEdit." });
      return;
    }
    if (process.env.COZE_PREVIEW_ENDPOINT) {
      const result = await requestCozePreviewCompose({ prompt: composePrompt, handImage, nailImages });
      sendJson(res, 200, { provider: "coze", image: result, message: "AI preview composed by Coze workflow." });
      return;
    }
    if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_PREVIEW_MODEL) {
      const result = await requestReplicatePreviewCompose({ prompt: composePrompt, handImage, nailImages });
      sendJson(res, 200, { provider: "replicate", image: result, message: "AI preview composed by Replicate." });
      return;
    }
    sendJson(res, 200, {
      provider: "local",
      image: "",
      message: "No AI preview compose provider configured. Used local canvas fallback.",
    });
  } catch (error) {
    console.warn(`[ai-preview-compose] ${networkErrorMessage(error)}`);
    const errorDetails = providerErrorPayload(error);
    sendJson(res, 200, {
      provider: "local",
      image: "",
      message: `SeedEdit skipped/failed before preview output: ${errorDetails.message || networkErrorMessage(error)}. Used local canvas fallback.`,
      errorDetails,
    });
  }
}

async function handleSeedEditTest(req, res) {
  const body = await readJson(req);
  const sourceImage = String(body.image || body.sourceImage || "").trim();
  const prompt = String(body.prompt || "Refine this saved manicure preview image. Keep the original composition and only improve realism, edges, and nail-art blending.").trim();
  const source = {
    index: Number.isFinite(Number(body.sourceIndex)) ? Number(body.sourceIndex) : null,
    name: String(body.sourceName || "").trim(),
    id: String(body.sourceId || "").trim(),
    imageLength: sourceImage.length,
    imageType: sourceImage.startsWith("data:") ? sourceImage.slice(0, sourceImage.indexOf(";") + 1) : "url",
  };
  if (!sourceImage) {
    sendJson(res, 400, { error: "image is required.", reason: "The test function did not receive a saved image.", source });
    return;
  }
  if (!arkEditToken()) {
    sendJson(res, 400, { error: "ARK_EDIT_API_KEY is not configured.", reason: "The SeedEdit API key is missing from the server environment.", source });
    return;
  }
  try {
    const image = await requestBytePlusArkPreviewCompose({ prompt, sourceImage, handImage: "", nailImages: [] });
    sendJson(res, 200, {
      provider: "byteplus-ark-seededit",
      image,
      message: "SeedEdit test completed with a saved image.",
      prompt,
      source,
    });
  } catch (error) {
    const errorDetails = providerErrorPayload(error);
    sendJson(res, 500, {
      provider: "byteplus-ark-seededit",
      error: errorDetails.message || networkErrorMessage(error),
      reason: "SeedEdit returned an error or the request could not be completed.",
      errorDetails,
      prompt,
      source,
    });
  }
}

async function handleAdminOfficialTemplate(req, res) {
  const body = await readJson(req);
  const images = Array.isArray(body.images) ? body.images.filter((item) => item?.data || item?.image) : [];
  if (!body.image && !images.length) {
    sendJson(res, 400, { error: "at least one image is required" });
    return;
  }
  if (images.length > 6) {
    sendJson(res, 400, { error: "official template supports up to 6 images" });
    return;
  }
  if (!String(body.templateName || "").trim()) {
    sendJson(res, 400, { error: "templateName is required" });
    return;
  }
  try {
    if (hasPostgresRuntime()) {
      const result = await savePgTemplateUpload(body, "official");
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_template_insert.py"), body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to save official template." });
  }
}

async function handleCommunityTemplate(req, res) {
  const body = await readJson(req);
  if (!body.image) {
    sendJson(res, 400, { error: "image is required" });
    return;
  }
  if (!String(body.templateName || "").trim()) {
    sendJson(res, 400, { error: "templateName is required" });
    return;
  }
  try {
    if (hasPostgresRuntime()) {
      const result = await savePgTemplateUpload(body, "community");
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "community_template_insert.py"), body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to save community template." });
  }
}

function parseDataUrlImage(dataUrl) {
  const text = String(dataUrl || "");
  const match = text.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return { mimeType: "", base64: "" };
  return { mimeType: match[1], base64: match[2] };
}

async function savePgTemplateUpload(body, sourceType) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const templateId = body.templateId || `${sourceType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const images = Array.isArray(body.images) && body.images.length
      ? body.images
      : [{ data: body.image, width: body.width, height: body.height }].filter((item) => item.data);
    const assetIds = [];
    for (const image of images) {
      const { mimeType, base64 } = parseDataUrlImage(image.data || image.image || image);
      const assetId = `asset_${crypto.randomUUID().replace(/-/g, "")}`;
      await client.query(
        `
        INSERT INTO assets (asset_id, owner_user_id, asset_type, mime_type, url, base64_data, width, height)
        VALUES ($1, $2, 'template-image', $3, $4, $5, $6, $7)
        `,
        [
          assetId,
          body.userId || null,
          mimeType || "image/png",
          body.imageUrl || "",
          base64 || "",
          Number(image.width || body.width || 0) || null,
          Number(image.height || body.height || 0) || null,
        ],
      );
      assetIds.push(assetId);
    }
    const coverAssetId = assetIds[0] || null;
    await client.query(
      `
      INSERT INTO templates (
        template_id, author_user_id, source_type, template_name, template_title, description,
        template_type, design_type, nail_shape, material_type, shape_categories,
        style_categories, material_categories, topic_tags, tags, cover_asset_id,
        image_asset_id, image_asset_ids, author_display_name, visibility, status, published_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'nail', $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, 'public', 'active', CURRENT_TIMESTAMP)
      ON CONFLICT (template_id) DO UPDATE SET
        template_name=EXCLUDED.template_name,
        template_title=EXCLUDED.template_title,
        description=EXCLUDED.description,
        design_type=EXCLUDED.design_type,
        nail_shape=EXCLUDED.nail_shape,
        material_type=EXCLUDED.material_type,
        cover_asset_id=EXCLUDED.cover_asset_id,
        image_asset_id=EXCLUDED.image_asset_id,
        image_asset_ids=EXCLUDED.image_asset_ids,
        updated_at=CURRENT_TIMESTAMP
      `,
      [
        templateId,
        body.userId || null,
        sourceType,
        body.templateName || body.template_name || body.name || templateId,
        body.templateTitle || body.template_title || body.templateName || body.name || templateId,
        body.description || "",
        body.designType || body.design_type || "nail",
        body.nailShape || body.nail_shape || "",
        body.materialType || body.material_type || "",
        body.shapeCategories || body.shape_categories || body.nailShape || "",
        body.styleCategories || body.style_categories || "",
        body.materialCategories || body.material_categories || body.materialType || "",
        body.topicTags || body.topic_tags || "",
        body.tags || "",
        coverAssetId,
        JSON.stringify(assetIds),
        body.authorDisplayName || body.author_display_name || "Community Creator",
      ],
    );
    const galleryId = sourceType === "official" ? "official_factory" : "community_gallery";
    const galleryType = sourceType;
    const galleryTemplateId = `gt_${crypto.randomUUID().replace(/-/g, "")}`;
    await client.query(
      `
      INSERT INTO gallery_templates (gallery_template_id, gallery_type, gallery_id, template_id, user_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (gallery_type, gallery_id, template_id) DO NOTHING
      `,
      [galleryTemplateId, galleryType, galleryId, templateId, body.userId || null],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      templateId,
      imageAssetIds: assetIds,
      imageUrl: body.imageUrl || "",
      imageUrls: body.imageUrl ? [body.imageUrl] : [],
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to save template." };
  } finally {
    client.release();
  }
}

function cleanPgText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function pgNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pgInteger(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function pgFlag(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "featured"].includes(text) ? 1 : 0;
}

function pgDataUrlOrBase64(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  return `data:image/png;base64,${text}`;
}

function hasPostgresRuntime() {
  return Boolean(pgPool);
}

function requirePostgresRuntime(operation) {
  if (hasPostgresRuntime()) return;
  const error = new Error(`${operation} requires DATABASE_URL on the deployed server.`);
  error.code = "MISSING_DATABASE_URL";
  error.program = "postgres";
  error.operation = operation;
  throw error;
}

function makeGuestId() {
  return `guest_${crypto.randomUUID().replace(/-/g, "")}`;
}

function makeRecoveryCode() {
  return `NB-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function makeUserId() {
  return `user_${crypto.randomUUID().replace(/-/g, "")}`;
}

function publicPgUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    userKind: row.user_kind || "guest",
    recoveryCode: row.recovery_code || "",
    email: row.email || null,
    phone: row.phone || null,
    avatarText: String(row.username || "U").slice(0, 1).toUpperCase(),
  };
}

function verifyPgPassword(password, passwordHash, salt) {
  if (!passwordHash || !salt) return false;
  const digest = crypto.pbkdf2Sync(String(password || ""), String(salt), 120000, 32, "sha256").toString("hex");
  const stored = String(passwordHash);
  if (stored.length !== digest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(stored));
}

function hashPgPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const digest = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return { passwordHash: digest, passwordSalt: salt };
}

function normalizeContact(targetType, targetValue) {
  let type = String(targetType || "").trim().toLowerCase();
  let value = String(targetValue || "").trim();
  if (!type) type = value.includes("@") ? "email" : "phone";
  if (type === "email") {
    value = value.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error("Invalid email address.");
  } else {
    type = "phone";
    value = value.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{6,18}$/.test(value)) throw new Error("Invalid phone number.");
  }
  return { type, value };
}

function makeVerificationCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

async function pgEnsureMember(client, userId) {
  await client.query(
    `
    INSERT INTO members (member_id, user_id, tier, level, points_balance)
    VALUES ($1, $2, 'Aurora Member', 1, 0)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [`member_${userId}`, userId],
  );
}

async function pgEnsureUser(client, userId, recoveryCode) {
  let user = null;
  if (userId) {
    user = (await client.query("SELECT * FROM users WHERE user_id=$1", [userId])).rows[0] || null;
  }
  if (!user && recoveryCode) {
    user = (await client.query("SELECT * FROM users WHERE recovery_code=$1", [recoveryCode])).rows[0] || null;
  }
  if (user) {
    await client.query("UPDATE users SET last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [user.user_id]);
    await pgEnsureMember(client, user.user_id);
    return publicPgUser(user);
  }
  const newUserId = userId || makeGuestId();
  const newRecoveryCode = recoveryCode || makeRecoveryCode();
  const username = `Guest ${newUserId.slice(-6)}`;
  user = (await client.query(
    `
    INSERT INTO users (user_id, username, user_kind, recovery_code, last_seen_at)
    VALUES ($1, $2, 'guest', $3, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP
    RETURNING *
    `,
    [newUserId, username, newRecoveryCode],
  )).rows[0];
  await pgEnsureMember(client, user.user_id);
  return publicPgUser(user);
}

async function handlePgUserSession(body) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const user = await pgEnsureUser(client, body.userId, body.recoveryCode);
    await client.query("COMMIT");
    return { ok: true, user };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function handlePgUserLogin(body) {
  const client = await pgPool.connect();
  try {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const row = (await client.query(
      "SELECT * FROM users WHERE username=$1 AND auth_status='active'",
      [username],
    )).rows[0];
    if (!row || !verifyPgPassword(password, row.password_hash, row.password_salt)) {
      return { ok: false, error: "Username or password is incorrect." };
    }
    const sessionId = crypto.randomUUID();
    await client.query(
      `
      INSERT INTO user_auth_sessions (session_id, user_id, login_date, status)
      VALUES ($1, $2, CURRENT_DATE::text, 'active')
      `,
      [sessionId, row.user_id],
    );
    await client.query("UPDATE users SET last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [row.user_id]);
    return { ok: true, user: publicPgUser(row), sessionId };
  } finally {
    client.release();
  }
}

async function handlePgUserRequestCode(body) {
  const { type, value } = normalizeContact(body.targetType, body.target);
  const purpose = String(body.purpose || "create_account").trim();
  if (!["create_account", "reset_password", "profile_old_contact", "profile_new_contact"].includes(purpose)) {
    return { ok: false, error: "Unsupported verification purpose." };
  }
  const username = String(body.username || "").trim();
  if (purpose === "create_account") {
    const duplicate = (await pgPool.query(
      "SELECT user_id FROM users WHERE username=$1 OR email=$2 OR phone=$3 LIMIT 1",
      [username, type === "email" ? value : "", type === "phone" ? value : ""],
    )).rows[0];
    if (duplicate) return { ok: false, error: "This username, email, or phone is already registered." };
  }
  if (purpose === "reset_password") {
    const existing = (await pgPool.query(
      "SELECT user_id FROM users WHERE email=$1 OR phone=$2 LIMIT 1",
      [type === "email" ? value : "", type === "phone" ? value : ""],
    )).rows[0];
    if (!existing) return { ok: false, error: "No account is bound to this email or phone." };
  }
  const code = makeVerificationCode();
  const { passwordHash, passwordSalt } = hashPgPassword(code);
  const verificationId = `verify_${crypto.randomUUID().replace(/-/g, "")}`;
  await pgPool.query(
    `
    INSERT INTO auth_verification_codes (
      verification_id, target_type, target_value, purpose, code_hash, code_salt, expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
    `,
    [verificationId, type, value, purpose, passwordHash, passwordSalt],
  );
  return {
    ok: true,
    verificationId,
    targetType: type,
    target: value,
    expiresInSeconds: 300,
    delivery: {
      sent: false,
      provider: "development-code",
      message: `Verification code prepared for ${type}. Configure an email/SMS provider to send it automatically.`,
      devCode: code,
    },
  };
}

async function consumePgVerification(client, verificationId, code, purpose) {
  const row = (await client.query(
    `
    SELECT * FROM auth_verification_codes
    WHERE verification_id=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    `,
    [String(verificationId || ""), purpose],
  )).rows[0];
  if (!row) throw new Error("Verification code expired or does not exist.");
  if (!verifyPgPassword(String(code || "").trim(), row.code_hash, row.code_salt)) {
    throw new Error("Verification code is incorrect.");
  }
  await client.query("UPDATE auth_verification_codes SET consumed_at=CURRENT_TIMESTAMP WHERE verification_id=$1", [row.verification_id]);
  return row;
}

async function handlePgUserCreateAccount(body) {
  const client = await pgPool.connect();
  try {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return { ok: false, error: "Username and password are required." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    await client.query("BEGIN");
    const verification = await consumePgVerification(client, body.verificationId, body.code, "create_account");
    const duplicate = (await client.query(
      "SELECT user_id FROM users WHERE username=$1 OR email=$2 OR phone=$3 LIMIT 1",
      [username, verification.target_type === "email" ? verification.target_value : "", verification.target_type === "phone" ? verification.target_value : ""],
    )).rows[0];
    if (duplicate) throw new Error("This username, email, or phone is already registered.");
    const userId = makeUserId();
    const { passwordHash, passwordSalt } = hashPgPassword(password);
    const user = (await client.query(
      `
      INSERT INTO users (
        user_id, username, user_kind, recovery_code, password_hash, password_salt,
        auth_status, email, phone, last_seen_at
      )
      VALUES ($1, $2, 'member', $3, $4, $5, 'active', $6, $7, CURRENT_TIMESTAMP)
      RETURNING *
      `,
      [
        userId,
        username,
        makeRecoveryCode(),
        passwordHash,
        passwordSalt,
        verification.target_type === "email" ? verification.target_value : null,
        verification.target_type === "phone" ? verification.target_value : null,
      ],
    )).rows[0];
    await pgEnsureMember(client, user.user_id);
    const sessionId = crypto.randomUUID();
    await client.query(
      "INSERT INTO user_auth_sessions (session_id, user_id, login_date, status) VALUES ($1, $2, CURRENT_DATE::text, 'active')",
      [sessionId, user.user_id],
    );
    await client.query("COMMIT");
    return { ok: true, user: publicPgUser(user), sessionId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to create account." };
  } finally {
    client.release();
  }
}

async function handlePgUserResetPassword(body) {
  const client = await pgPool.connect();
  try {
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    await client.query("BEGIN");
    const verification = await consumePgVerification(client, body.verificationId, body.code, "reset_password");
    const user = (await client.query(
      "SELECT * FROM users WHERE email=$1 OR phone=$2 LIMIT 1",
      [verification.target_type === "email" ? verification.target_value : "", verification.target_type === "phone" ? verification.target_value : ""],
    )).rows[0];
    if (!user) throw new Error("No account is bound to this email or phone.");
    const { passwordHash, passwordSalt } = hashPgPassword(newPassword);
    await client.query("UPDATE users SET password_hash=$1, password_salt=$2, updated_at=CURRENT_TIMESTAMP WHERE user_id=$3", [passwordHash, passwordSalt, user.user_id]);
    await client.query("COMMIT");
    return { ok: true, user: publicPgUser(user) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to reset password." };
  } finally {
    client.release();
  }
}

async function handlePgUserAuthSession(body) {
  const row = (await pgPool.query(
    `
    SELECT s.session_id, u.*
    FROM user_auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.session_id=$1 AND s.status='active' AND u.auth_status='active'
    `,
    [String(body.sessionId || "")],
  )).rows[0];
  if (!row) return { ok: false, error: "Session expired." };
  await pgPool.query("UPDATE user_auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE session_id=$1", [row.session_id]);
  return { ok: true, user: publicPgUser(row) };
}

async function handlePgUserLogout(body) {
  const sessionId = String(body.sessionId || "").trim();
  if (sessionId) {
    await pgPool.query("UPDATE user_auth_sessions SET status='logged_out', last_seen_at=CURRENT_TIMESTAMP WHERE session_id=$1", [sessionId]);
  }
  return { ok: true };
}

async function getPgAuthSession(sessionId) {
  const row = (await pgPool.query(
    `
    SELECT s.session_id, u.*
    FROM user_auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.session_id=$1 AND s.status='active' AND u.auth_status='active'
    `,
    [String(sessionId || "")],
  )).rows[0];
  if (!row) return { ok: false, error: "Session expired." };
  await pgPool.query("UPDATE user_auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE session_id=$1", [row.session_id]);
  await pgPool.query("UPDATE users SET last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE user_id=$1", [row.user_id]);
  return { ok: true, user: publicPgUser(row), sessionId: row.session_id, row };
}

async function handlePgUserProfile(body) {
  const session = await getPgAuthSession(body.sessionId);
  if (!session.ok) return session;
  const accounts = await safePgRows(
    `
    SELECT platform, platform_user_id AS "platformUserId", username, access_status AS status, linked_at AS "linkedAt"
    FROM third_party_accounts
    WHERE user_id=$1
    ORDER BY linked_at DESC
    `,
    [session.user.userId],
  );
  return {
    ok: true,
    user: {
      ...session.user,
      createdAt: session.row.created_at,
      lastSeenAt: session.row.last_seen_at,
      thirdPartyAccounts: accounts,
    },
    sessionId: session.sessionId,
  };
}

async function handlePgUserUpdateContact(body) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const session = await getPgAuthSession(body.sessionId);
    if (!session.ok) {
      await client.query("ROLLBACK");
      return session;
    }
    const targetType = String(body.targetType || "").trim().toLowerCase() === "phone" ? "phone" : "email";
    const currentValue = targetType === "phone" ? session.row.phone : session.row.email;
    if (currentValue) {
      const oldCheck = await consumePgVerification(client, body.oldVerificationId, body.oldCode, "profile_old_contact");
      if (oldCheck.target_type !== targetType || oldCheck.target_value !== currentValue) {
        throw new Error("Old contact verification does not match this account.");
      }
    }
    const next = normalizeContact(targetType, body.newTarget);
    const newCheck = await consumePgVerification(client, body.newVerificationId, body.newCode, "profile_new_contact");
    if (newCheck.target_type !== next.type || newCheck.target_value !== next.value) {
      throw new Error("New contact verification does not match.");
    }
    const duplicate = (await client.query(
      `SELECT user_id FROM users WHERE ${next.type === "phone" ? "phone" : "email"}=$1 AND user_id<>$2 LIMIT 1`,
      [next.value, session.user.userId],
    )).rows[0];
    if (duplicate) throw new Error("This contact is already used by another account.");
    await client.query(
      `UPDATE users SET ${next.type === "phone" ? "phone" : "email"}=$1, updated_at=CURRENT_TIMESTAMP WHERE user_id=$2`,
      [next.value, session.user.userId],
    );
    await client.query("COMMIT");
    return { ok: true, user: { ...session.user, [next.type]: next.value } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to update contact." };
  } finally {
    client.release();
  }
}

async function handlePgUserPromos(body) {
  let userId = String(body.userId || "").trim();
  if (!userId && body.sessionId) {
    const session = await getPgAuthSession(body.sessionId);
    if (!session.ok) return session;
    userId = session.user.userId;
  }
  if (!userId) return { ok: false, error: "User is required." };
  const promos = await safePgRows(
    `
    SELECT
      up.user_promo_id,
      up.status AS user_status,
      up.assigned_at,
      up.used_at,
      p.promo_id,
      p.promo_title,
      p.promo_type,
      p.promo_content,
      p.expire_date,
      p.status
    FROM user_promo up
    JOIN promotion p ON p.promo_id = up.promo_id
    WHERE up.user_id=$1
    ORDER BY up.assigned_at DESC
    `,
    [userId],
  );
  return { ok: true, promos };
}

async function handlePgUserPrintRecords(body) {
  const session = await getPgAuthSession(body.sessionId);
  if (!session.ok) return session;
  await ensurePgAdminRuntimeSchema();
  const rows = (await pgPool.query(
    `
    SELECT
      o.order_id,
      o.total_price,
      o.payment_status,
      o.delivery_status,
      o.order_status,
      o.created_at,
      o.paid_at,
      o.pickup_code,
      o.print_code,
      (SELECT COALESCE(json_agg(pc ORDER BY pc.id), '[]'::json) FROM "print-code" pc WHERE pc.order_id=o.order_id) AS print_codes,
      o.bound_device_id,
      o.manufacturer_sync_status,
      COALESCE(string_agg(DISTINCT p.product_name, ', '), '') AS product_names
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    LEFT JOIN products p ON p.product_id = oi.product_id
    WHERE o.user_id=$1
      AND (
        NULLIF(o.print_code, '') IS NOT NULL
        OR p.product_type ILIKE '%print%'
        OR p.product_name ILIKE '%print%'
        OR p.product_type LIKE '%打印%'
        OR p.product_name LIKE '%打印%'
      )
    GROUP BY o.order_id
    ORDER BY COALESCE(o.paid_at, o.created_at) DESC
    LIMIT 80
    `,
    [session.user.userId],
  )).rows;
  return {
    ok: true,
    records: rows.map((item) => ({
      orderId: item.order_id,
      productNames: item.product_names || "",
      totalPrice: Number(item.total_price || 0),
      paymentStatus: item.payment_status || "",
      deliveryStatus: item.delivery_status || "",
      orderStatus: item.order_status || "",
      createdAt: item.created_at,
      paidAt: item.paid_at,
      pickupCode: item.pickup_code || "",
      printCode: item.print_code || "",
      printCodes: item.print_codes || [],
      boundDeviceId: item.bound_device_id || "",
      manufacturerSyncStatus: item.manufacturer_sync_status || "",
    })),
  };
}

function formatPgAddress(row) {
  if (!row) return "";
  return [row.receiver_name, row.phone, row.street, row.city, row.state, row.postcode, row.country]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" / ");
}

async function handlePgUserShippingAddress(body) {
  const session = await getPgAuthSession(body.sessionId);
  if (!session.ok) return session;
  if (body.mode === "save") {
    const addressText = String(body.address || "").trim();
    if (addressText.length < 6) return { ok: false, error: "Shipping address is too short." };
    const existing = (await pgPool.query(
      "SELECT address_id FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 1",
      [session.user.userId],
    )).rows[0];
    let addressId = existing?.address_id;
    if (addressId) {
      await pgPool.query(
        "UPDATE addresses SET street=$1, is_default=1 WHERE address_id=$2 AND user_id=$3",
        [addressText, addressId, session.user.userId],
      );
    } else {
      addressId = `addr_${crypto.randomUUID().replace(/-/g, "")}`;
      await pgPool.query(
        "INSERT INTO addresses (address_id, user_id, street, country, is_default) VALUES ($1, $2, $3, 'Australia', 1)",
        [addressId, session.user.userId, addressText],
      );
    }
    await pgPool.query("UPDATE users SET default_address_id=$1, updated_at=CURRENT_TIMESTAMP WHERE user_id=$2", [addressId, session.user.userId]);
  }
  const row = (await pgPool.query(
    "SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 1",
    [session.user.userId],
  )).rows[0];
  return { ok: true, address: formatPgAddress(row), addressId: row?.address_id || "" };
}

async function handlePgUserAction(body) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const user = await pgEnsureUser(client, body.userId, body.recoveryCode);
    const targetType = String(body.targetType || "").trim().toLowerCase();
    const targetId = String(body.targetId || "").trim();
    const actionType = String(body.actionType || "").trim().toLowerCase();
    if (!targetId) return { ok: false, error: "Target ID is required." };
    const actionId = `action_${crypto.randomUUID().replace(/-/g, "")}`;
    const action = (await client.query(
      `
      INSERT INTO user_actions (action_id, user_id, target_type, target_id, action_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, target_type, target_id, action_type) DO UPDATE SET created_at=user_actions.created_at
      RETURNING action_id, user_id, target_type, target_id, action_type, created_at
      `,
      [actionId, user.userId, targetType, targetId, actionType],
    )).rows[0];
    if (targetType === "template" && actionType === "like") {
      await client.query("UPDATE templates SET like_count=COALESCE(like_count, 0)+1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1", [targetId]);
    }
    if (targetType === "comment" && actionType === "like") {
      await client.query("UPDATE comments SET like_count=COALESCE(like_count, 0)+1 WHERE comment_id=$1", [targetId]);
    }
    await client.query("COMMIT");
    return { ok: true, user, action };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to record user action." };
  } finally {
    client.release();
  }
}

function draftPrimaryId(userId, draftId) {
  const cleanDraftId = String(draftId || "AUTO-DRAFT-D2-CANVAS").trim() || "AUTO-DRAFT-D2-CANVAS";
  return `${userId}:${cleanDraftId}`;
}

async function handlePgUserDraft(req, url) {
  if (req.method === "GET") {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const user = await pgEnsureUser(client, url.searchParams.get("userId") || "", url.searchParams.get("recoveryCode") || "");
      const requestedId = url.searchParams.get("draftId") || "";
      const row = requestedId
        ? (await client.query("SELECT * FROM draft_cache WHERE draft_id=$1", [draftPrimaryId(user.userId, requestedId)])).rows[0]
        : (await client.query(
          "SELECT * FROM draft_cache WHERE user_id=$1 AND draft_type='design_canvas' AND is_auto_draft=1 ORDER BY saved_at DESC LIMIT 1",
          [user.userId],
        )).rows[0];
      await client.query("COMMIT");
      return {
        ok: true,
        user,
        draft: row ? {
          draftId: row.draft_id,
          draftType: row.draft_type,
          savedAt: row.saved_at,
          isAutoDraft: Boolean(row.is_auto_draft),
          content: JSON.parse(row.draft_content_json || "{}"),
        } : null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const body = await readJson(req);
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const user = await pgEnsureUser(client, body.userId, body.recoveryCode);
    if (!body.content || typeof body.content !== "object") return { ok: false, error: "Draft content must be an object." };
    const draftId = draftPrimaryId(user.userId, body.draftId);
    const row = (await client.query(
      `
      INSERT INTO draft_cache (draft_id, user_id, draft_type, draft_content_json, preview_asset_id, saved_at, is_auto_draft)
      VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP, $5)
      ON CONFLICT (draft_id) DO UPDATE SET
        draft_content_json=EXCLUDED.draft_content_json,
        saved_at=CURRENT_TIMESTAMP,
        is_auto_draft=EXCLUDED.is_auto_draft
      RETURNING saved_at
      `,
      [
        draftId,
        user.userId,
        String(body.draftType || "design_canvas"),
        JSON.stringify(body.content),
        body.isAutoDraft ? 1 : 0,
      ],
    )).rows[0];
    await client.query("COMMIT");
    return { ok: true, user, draftId, savedAt: row?.saved_at || null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function pgTemplateAuthor(templateId) {
  const row = (await pgPool.query(
    `
    SELECT
      t.template_id,
      t.author_user_id,
      t.author_display_name,
      t.author_level,
      t.source_type,
      t.like_count,
      t.comment_count,
      u.username,
      u.user_kind,
      u.created_at AS user_created_at,
      m.tier,
      m.level
    FROM templates t
    LEFT JOIN users u ON u.user_id = t.author_user_id
    LEFT JOIN members m ON m.user_id = t.author_user_id
    WHERE t.template_id=$1
    `,
    [templateId],
  )).rows[0];
  if (!row) return null;
  const name = row.username || row.author_display_name || "";
  if (!name) return null;
  const levelParts = [row.author_level, row.tier, row.level ? `Lv.${row.level}` : ""].filter(Boolean);
  return {
    userId: row.author_user_id || "",
    name,
    avatarText: name.slice(0, 2).toUpperCase(),
    meta: [row.author_user_id, ...levelParts].filter(Boolean).join(" / "),
    sourceType: row.source_type,
    likeCount: row.like_count || 0,
    commentCount: row.comment_count || 0,
  };
}

async function pgTemplateComments(templateId) {
  const rows = await safePgRows(
    `
    SELECT
      c.comment_id,
      c.parent_comment_id,
      c.user_id,
      c.content,
      c.like_count,
      c.created_at,
      u.username
    FROM comments c
    LEFT JOIN users u ON u.user_id = c.user_id
    WHERE c.target_type='template'
      AND c.target_id=$1
      AND c.status='published'
    ORDER BY c.created_at ASC
    `,
    [templateId],
  );
  const comments = [];
  const byId = new Map();
  for (const row of rows) {
    const item = {
      id: row.comment_id,
      parentId: row.parent_comment_id || "",
      user: row.username || row.user_id || "User",
      userId: row.user_id,
      text: row.content,
      likes: row.like_count || 0,
      createdAt: row.created_at,
      replies: [],
    };
    byId.set(item.id, item);
    if (item.parentId && byId.has(item.parentId)) byId.get(item.parentId).replies.push(item);
    else comments.push(item);
  }
  return comments;
}

function countNestedComments(comments) {
  return comments.reduce((total, comment) => total + 1 + countNestedComments(comment.replies || []), 0);
}

async function handlePgTemplateSocial(req, url) {
  const payload = req.method === "GET"
    ? { action: "detail", templateId: url.searchParams.get("templateId") || "" }
    : await readJson(req);
  const action = String(payload.action || "detail");
  const templateId = String(payload.templateId || "").trim();
  if (!templateId && action !== "like_comment") return { ok: false, error: "templateId is required." };

  if (action === "detail") {
    const author = await pgTemplateAuthor(templateId);
    const comments = await pgTemplateComments(templateId);
    const counts = (await pgPool.query("SELECT like_count, comment_count FROM templates WHERE template_id=$1", [templateId])).rows[0] || {};
    return {
      ok: true,
      templateId,
      author,
      comments,
      counts: {
        comments: countNestedComments(comments),
        likes: counts.like_count || 0,
      },
    };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const user = await pgEnsureUser(client, payload.userId, payload.recoveryCode);
    if (action === "like_template") {
      const count = (await client.query(
        "UPDATE templates SET like_count=COALESCE(like_count, 0)+1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 RETURNING like_count",
        [templateId],
      )).rows[0];
      await client.query(
        `
        INSERT INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES ($1, $2, 'template', $3, 'like')
        ON CONFLICT (user_id, target_type, target_id, action_type) DO NOTHING
        `,
        [`action_${crypto.randomUUID().replace(/-/g, "")}`, user.userId, templateId],
      );
      await client.query("COMMIT");
      return { ok: true, user, likeCount: count?.like_count || 0 };
    }
    if (action === "add_comment") {
      const content = String(payload.content || "").trim();
      const parentId = String(payload.parentCommentId || "").trim();
      if (!content) return { ok: false, error: "Comment content is required." };
      const commentId = `comment_${crypto.randomUUID().replace(/-/g, "")}`;
      await client.query(
        `
        INSERT INTO comments (comment_id, target_type, target_id, parent_comment_id, user_id, content)
        VALUES ($1, 'template', $2, $3, $4, $5)
        `,
        [commentId, templateId, parentId || null, user.userId, content],
      );
      await client.query(
        `
        INSERT INTO user_comments (post_id, comment_type, user_id, comment_content)
        VALUES ($1, $2, $3, $4)
        `,
        [templateId, parentId ? "secondary" : "primary", user.userId, content],
      );
      const commentCount = (await client.query(
        `
        UPDATE templates
        SET comment_count=(
          SELECT COUNT(*) FROM comments WHERE target_type='template' AND target_id=$1 AND status='published'
        ), updated_at=CURRENT_TIMESTAMP
        WHERE template_id=$1
        RETURNING comment_count
        `,
        [templateId],
      )).rows[0]?.comment_count || 0;
      await client.query(
        `
        INSERT INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES ($1, $2, 'template', $3, $4)
        ON CONFLICT (user_id, target_type, target_id, action_type) DO NOTHING
        `,
        [`action_${crypto.randomUUID().replace(/-/g, "")}`, user.userId, templateId, parentId ? "reply" : "comment"],
      );
      await client.query("COMMIT");
      return { ok: true, user, commentId, commentCount, comments: await pgTemplateComments(templateId) };
    }
    if (action === "like_comment") {
      const commentId = String(payload.commentId || "").trim();
      const row = (await client.query(
        "UPDATE comments SET like_count=COALESCE(like_count, 0)+1 WHERE comment_id=$1 RETURNING target_id, like_count",
        [commentId],
      )).rows[0];
      await client.query(
        `
        INSERT INTO user_actions (action_id, user_id, target_type, target_id, action_type)
        VALUES ($1, $2, 'comment', $3, 'like')
        ON CONFLICT (user_id, target_type, target_id, action_type) DO NOTHING
        `,
        [`action_${crypto.randomUUID().replace(/-/g, "")}`, user.userId, commentId],
      );
      await client.query("COMMIT");
      return { ok: true, user, templateId: row?.target_id || "", likeCount: row?.like_count || 0 };
    }
    await client.query("ROLLBACK");
    return { ok: false, error: `Unsupported action: ${action}` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: error.message || "Failed to update template social data." };
  } finally {
    client.release();
  }
}

function adminModel(title, idKey, rows, extra = {}) {
  return {
    title,
    editable: extra.editable !== false,
    idKey,
    filters: extra.filters || [],
    columns: extra.columns || (rows[0] ? Object.keys(rows[0]).slice(0, 12) : [idKey]),
    fields: extra.fields || [],
    rows,
    ...(extra.kindKey ? { kindKey: extra.kindKey } : {}),
    ...(extra.productFields ? { productFields: extra.productFields } : {}),
    ...(extra.rewardFields ? { rewardFields: extra.rewardFields } : {}),
  };
}

async function handlePgAdminModels() {
  await ensurePgAdminRuntimeSchema();
  const [
    taxonomy,
    templates,
    products,
    rewards,
    events,
    tasks,
    promoAssets,
    promotions,
    users,
    orders,
    userActions,
    deviceInfo,
  ] = await Promise.all([
    loadPgTaxonomy(),
    loadPgTemplates(),
    loadPgProducts(),
    safePgRows("SELECT * FROM rewards ORDER BY created_at DESC"),
    loadPgEvents(),
    safePgRows("SELECT * FROM tasks ORDER BY created_at DESC"),
    safePgRows("SELECT promo_asset_id, image_url, image_base64, created_at FROM promotional_assets ORDER BY created_at DESC"),
    safePgRows("SELECT * FROM promotion ORDER BY created_at DESC"),
    safePgRows("SELECT user_id, username, user_kind, recovery_code, email, phone, gender, created_at, last_seen_at FROM users ORDER BY created_at DESC"),
    safePgRows(`
      SELECT o.order_id, o.user_id, u.username, o.total_price, o.pay_method, o.payment_status,
             o.delivery_status, o.order_status, o.print_code, o.pickup_code, o.created_at, o.paid_at
      FROM orders o
      LEFT JOIN users u ON u.user_id = o.user_id
      ORDER BY o.created_at DESC
    `),
    safePgRows(`
      SELECT ua.action_id, ua.user_id, u.username, ua.target_type, ua.target_id, ua.action_type, ua.created_at
      FROM user_actions ua
      LEFT JOIN users u ON u.user_id = ua.user_id
      ORDER BY ua.created_at DESC
    `),
    safePgRows("SELECT id, equip_id, type, address, status, created_at, updated_at FROM device_info ORDER BY created_at DESC"),
  ]);
  const officialRows = templates.filter((item) => item.source_type === "official").map((item) => ({
    id: item.template_id,
    template_id: item.template_id,
    template_name: item.template_name,
    template_title: item.template_title,
    design_type: item.design_type,
    nail_shape: item.nail_shape,
    material_type: item.material_type,
    status: "active",
    image: item.image_url,
    image_url: item.image_url,
    image_preview_url: item.image_url,
    like_count: item.like_count,
    comment_count: item.comment_count,
    published_at: item.published_at,
  }));
  const communityRows = templates.filter((item) => item.source_type === "community").map((item) => ({
    id: item.template_id,
    template_id: item.template_id,
    template_name: item.template_name,
    template_title: item.template_title,
    design_type: item.design_type,
    nail_shape: item.nail_shape,
    material_type: item.material_type,
    author_display_name: item.author_display_name,
    status: "active",
    image: item.image_url,
    image_url: item.image_url,
    image_preview_url: item.image_url,
    like_count: item.like_count,
    comment_count: item.comment_count,
    published_at: item.published_at,
  }));
  const productRows = products.map((item) => ({
    item_kind: "product",
    id: item.product_id,
    name: item.product_name,
    type: item.product_type,
    image: item.image_url || (item.image_base64 ? "[base64 image]" : ""),
    image_url: item.image_url,
    image_base64: "",
    image_preview_url: item.image_url || (item.image_base64 ? `/api/admin/product-image?itemKind=product&id=${encodeURIComponent(item.product_id)}` : ""),
    has_image_base64: Boolean(item.image_base64),
    info: item.product_info,
    nail_shape: item.nail_shape,
    style_tags: item.style_tags,
    bound_device_id: item.bound_device_id || "",
    price_or_points: item.unit_price,
    stock_quantity: item.stock_quantity,
    stock_s: item.stock_s,
    stock_m: item.stock_m,
    stock_l: item.stock_l,
    stock_xl: item.stock_xl,
    stock_by_size: `S:${item.stock_s || 0} / M:${item.stock_m || 0} / L:${item.stock_l || 0} / XL:${item.stock_xl || 0}`,
    pickup_method: item.pickup_method,
    is_featured: item.is_featured,
    status: item.status,
  }));
  const rewardRows = rewards.map((item) => ({
    item_kind: "reward",
    id: item.reward_id,
    name: item.reward_name,
    type: item.reward_type,
    image: item.image_url || (item.image_base64 ? "[base64 image]" : ""),
    image_url: item.image_url,
    image_base64: "",
    image_preview_url: item.image_url || (item.image_base64 ? `/api/admin/product-image?itemKind=reward&id=${encodeURIComponent(item.reward_id)}` : ""),
    has_image_base64: Boolean(item.image_base64),
    info: item.reward_info,
    nail_shape: "",
    style_tags: "",
    bound_device_id: item.bound_device_id || "",
    price_or_points: item.unit_point_cost,
    stock_quantity: item.stock_quantity,
    stock_s: item.stock_s,
    stock_m: item.stock_m,
    stock_l: item.stock_l,
    stock_xl: item.stock_xl,
    stock_by_size: `S:${item.stock_s || 0} / M:${item.stock_m || 0} / L:${item.stock_l || 0} / XL:${item.stock_xl || 0}`,
    pickup_method: item.pickup_method,
    is_featured: item.is_featured,
    status: item.status,
  }));
  const statusOptions = [
    { value: "active", label: "active" },
    { value: "draft", label: "draft" },
    { value: "hidden", label: "hidden" },
  ];
  const shapeOptions = [{ value: "", label: "Not selected" }, ...(taxonomy.shapes || []).map((item) => ({ value: item.name, label: item.name }))];
  const styleOptions = [{ value: "", label: "Null" }, ...(taxonomy.styles || []).map((item) => ({ value: item.name, label: item.name }))];
  const mainDeviceOptions = [{ value: "", label: "Not bound" }, ...deviceInfo
    .filter((item) => ["主机", "main_unit"].includes(String(item.type || "")) && String(item.status || "active") === "active")
    .map((item) => ({ value: item.equip_id, label: `${item.equip_id} · ${item.address || "No address"}` }))];
  return {
    ok: true,
    models: {
      product: adminModel("Official Product / Reward Library", "id", [...productRows, ...rewardRows], {
        kindKey: "item_kind",
        columns: ["item_kind", "id", "name", "type", "nail_shape", "bound_device_id", "price_or_points", "stock_by_size", "pickup_method", "is_featured", "status"],
        productFields: [
          { name: "product_name", label: "Product name", type: "text" },
          { name: "product_type", label: "Product type", type: "select", options: [{ value: "穿戴甲", label: "穿戴甲" }, { value: "打印甲", label: "打印甲" }, { value: "配件", label: "配件" }] },
          { name: "unit_price", label: "Unit price", type: "number" },
          { name: "nail_shape", label: "Nail shape", type: "select", options: shapeOptions },
          { name: "style_tags", label: "Style", type: "select", options: styleOptions },
          { name: "bound_device_id", label: "绑定设备", type: "select", options: mainDeviceOptions },
          { name: "stock_s", label: "Stock S", type: "number" },
          { name: "stock_m", label: "Stock M", type: "number" },
          { name: "stock_l", label: "Stock L", type: "number" },
          { name: "stock_xl", label: "Stock XL", type: "number" },
          { name: "is_featured", label: "是否精品", type: "select", options: [{ value: "0", label: "No" }, { value: "1", label: "Yes" }] },
          { name: "pickup_method", label: "支持取货方式", type: "select", options: [{ value: "pickup", label: "自取" }, { value: "shipping", label: "邮寄" }, { value: "both", label: "both" }] },
          { name: "image_file", label: "Upload image", type: "file" },
          { name: "image_url", label: "Image URL", type: "url" },
          { name: "product_info", label: "Product info", type: "textarea" },
          { name: "status", label: "Status", type: "select", options: statusOptions },
        ],
        rewardFields: [
          { name: "reward_name", label: "Reward name", type: "text" },
          { name: "reward_type", label: "Reward type", type: "select", options: [{ value: "coupon", label: "coupon" }, { value: "digital_template", label: "digital_template" }, { value: "physical_goods", label: "physical_goods" }, { value: "benefit", label: "benefit" }] },
          { name: "unit_point_cost", label: "Point cost", type: "number" },
          { name: "bound_device_id", label: "绑定设备", type: "select", options: mainDeviceOptions },
          { name: "stock_s", label: "Stock S", type: "number" },
          { name: "stock_m", label: "Stock M", type: "number" },
          { name: "stock_l", label: "Stock L", type: "number" },
          { name: "stock_xl", label: "Stock XL", type: "number" },
          { name: "is_featured", label: "是否精品", type: "select", options: [{ value: "0", label: "No" }, { value: "1", label: "Yes" }] },
          { name: "pickup_method", label: "支持取货方式", type: "select", options: [{ value: "pickup", label: "自取" }, { value: "shipping", label: "邮寄" }, { value: "both", label: "both" }] },
          { name: "image_file", label: "Upload image", type: "file" },
          { name: "image_url", label: "Image URL", type: "url" },
          { name: "reward_info", label: "Reward info", type: "textarea" },
          { name: "status", label: "Status", type: "select", options: statusOptions },
        ],
      }),
      "promo-assets": adminModel("Promotional Assets", "promo_asset_id", promoAssets.map((item) => ({
        ...item,
        image: item.image_url || item.image_base64 || "",
        image_preview_url: item.image_url || item.image_base64 || "",
        has_image_base64: Boolean(item.image_base64),
      })), {
        columns: ["promo_asset_id", "image", "created_at"],
        fields: [
          { name: "image_url", label: "Image URL", type: "text" },
          { name: "image_file", label: "Upload image", type: "file" },
        ],
      }),
      promotion: adminModel("Promotion", "promo_id", promotions, {
        columns: ["promo_id", "promo_title", "promo_type", "promo_content", "expire_date", "status"],
        fields: [
          { name: "promo_id", label: "Promo ID", type: "text" },
          { name: "promo_title", label: "Title", type: "text" },
          { name: "promo_type", label: "Type", type: "select", options: ["满减优惠", "折扣优惠", "买送优惠", "免费商品"].map((value) => ({ value, label: value })) },
          { name: "min_spend", label: "Min spend", type: "number", promoTypes: ["满减优惠"] },
          { name: "amount_off", label: "Amount off", type: "number", promoTypes: ["满减优惠"] },
          { name: "discount_percent", label: "Discount percent", type: "number", promoTypes: ["折扣优惠"] },
          { name: "buy_quantity", label: "Buy quantity", type: "number", promoTypes: ["买送优惠"] },
          { name: "gift_quantity", label: "Gift quantity", type: "number", promoTypes: ["买送优惠"] },
          { name: "free_product", label: "Free product", type: "text", promoTypes: ["免费商品"] },
          { name: "description", label: "Description", type: "textarea" },
          { name: "expire_date", label: "Expire date", type: "date" },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "active" }, { value: "inactive", label: "inactive" }] },
        ],
      }),
      official: adminModel("Official Factory Gallery", "template_id", officialRows, {
        columns: ["template_id", "template_name", "design_type", "nail_shape", "material_type", "like_count", "comment_count", "published_at"],
      }),
      community: adminModel("Community Template Library", "template_id", communityRows, {
        columns: ["template_id", "template_name", "author_display_name", "design_type", "nail_shape", "material_type", "like_count", "comment_count", "published_at"],
      }),
      users: adminModel("User Management", "user_id", users, {
        columns: ["user_id", "username", "user_kind", "email", "phone", "gender", "created_at", "last_seen_at"],
      }),
      event: adminModel("Events", "event_id", events, {
        columns: ["event_id", "event_name", "event_type", "html_url", "start_at", "expires_at", "status"],
        fields: [
          { name: "event_type", label: "Event type", type: "text" },
          { name: "event_name", label: "Event name", type: "text" },
          { name: "event_title", label: "Title", type: "text" },
          { name: "event_content", label: "Content", type: "textarea" },
          { name: "image_file", label: "Banner image", type: "file" },
          { name: "html_url", label: "HTML URL", type: "text" },
          { name: "start_at", label: "Start date", type: "date" },
          { name: "expires_at", label: "Expiry date", type: "date" },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "active" }, { value: "inactive", label: "inactive" }] },
        ],
      }),
      task: adminModel("Tasks", "task_id", tasks, {
        columns: ["task_id", "event_id", "task_type", "task_name", "submission_type", "allowed_platforms", "reward_points", "expires_at", "status"],
        fields: [
          { name: "event_id", label: "Bind event ID", type: "text" },
          { name: "task_type", label: "Task type", type: "text" },
          { name: "task_name", label: "Task name", type: "text" },
          { name: "task_title", label: "Title", type: "text" },
          { name: "task_content", label: "Content", type: "textarea" },
          { name: "submission_type", label: "Submission type", type: "select", options: [{ value: "text", label: "text" }, { value: "file", label: "file" }, { value: "url", label: "url" }] },
          { name: "allowed_platforms", label: "Allowed platforms", type: "text" },
          { name: "reward_points", label: "Reward points", type: "number" },
          { name: "image_file", label: "Promo image", type: "file" },
          { name: "start_at", label: "Start date", type: "date" },
          { name: "expires_at", label: "Expiry date", type: "date" },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "active" }, { value: "inactive", label: "inactive" }] },
        ],
      }),
      orders: adminModel("Orders", "order_id", orders, { editable: false }),
      "user-actions": adminModel("User Actions", "action_id", userActions, { editable: false }),
      "device-info": adminModel("Device Info", "id", deviceInfo, {
        columns: ["id", "equip_id", "type", "address", "status", "updated_at"],
        fields: [
          { name: "equip_id", label: "Equipment ID", type: "text" },
          { name: "type", label: "Type", type: "select", options: [{ value: "主机", label: "主机" }, { value: "打印机", label: "打印机" }] },
          { name: "address", label: "Address", type: "text" },
          { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "active" }, { value: "inactive", label: "inactive" }] },
        ],
      }),
      taxonomy: {
        title: "Taxonomy",
        editable: true,
        idKey: "id",
        rows: [
          ...taxonomy.styles.map((item) => ({ ...item, taxonomy_type: "style" })),
          ...taxonomy.shapes.map((item) => ({ ...item, taxonomy_type: "shape" })),
          ...taxonomy.materials.map((item) => ({ ...item, taxonomy_type: "material" })),
          ...taxonomy.topics.map((item) => ({ ...item, taxonomy_type: "topic" })),
        ],
        columns: ["taxonomy_type", "id", "name", "status"],
        filters: [],
        fields: [],
      },
    },
  };
}

async function handlePgAdminProductImage(url) {
  const itemKind = url.searchParams.get("itemKind") || "product";
  const id = url.searchParams.get("id") || "";
  let row = null;
  if (itemKind === "template") {
    row = (await pgPool.query(
      `
      SELECT COALESCE(a.url, '') AS image_url, a.base64_data
      FROM templates t
      LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
      WHERE t.template_id=$1
      `,
      [id],
    )).rows[0];
  } else if (itemKind === "asset") {
    row = (await pgPool.query("SELECT url AS image_url, base64_data FROM assets WHERE asset_id=$1", [id])).rows[0];
  } else if (itemKind === "promo") {
    row = (await pgPool.query("SELECT image_url, image_base64 AS base64_data FROM promotional_assets WHERE promo_asset_id=$1", [id])).rows[0];
  } else if (itemKind === "reward") {
    row = (await pgPool.query("SELECT image_url, image_base64 AS base64_data FROM rewards WHERE reward_id=$1", [id])).rows[0];
  } else {
    row = (await pgPool.query("SELECT image_url, image_base64 AS base64_data FROM products WHERE product_id=$1", [id])).rows[0];
  }
  return { ok: Boolean(row?.image_url || row?.base64_data), image_url: row?.image_url || "", image_base64: row?.base64_data || "" };
}

const pgTaxonomyTables = {
  styles: { id: "style_id", label: "style", table: "styles" },
  shapes: { id: "shape_id", label: "shape", table: "shapes" },
  materials: { id: "material_id", label: "material", table: "materials" },
  topics: { id: "topic_id", label: "topic", table: "topics" },
  tags: { id: "tag_id", label: "tag", table: "tags" },
};

function pgTaxonomyMeta(table) {
  const meta = pgTaxonomyTables[String(table || "")];
  if (!meta) throw new Error("Unsupported taxonomy table.");
  return meta;
}

async function listPgTaxonomyTable(table) {
  const meta = pgTaxonomyMeta(table);
  if (table === "topics") {
    return safePgRows(`SELECT topic_id, topic, view_number, attendance_number, status FROM topics ORDER BY created_at DESC`);
  }
  if (table === "tags") {
    return safePgRows(`SELECT tag_id, tag, viewed_number, attendance_number, created_by_type, status FROM tags ORDER BY created_at DESC`);
  }
  if (table === "materials") {
    return safePgRows(`SELECT material_id, material, image, status FROM materials ORDER BY created_at DESC`);
  }
  return safePgRows(`SELECT ${meta.id}, ${meta.label}, status FROM ${meta.table} ORDER BY created_at DESC`);
}

async function handlePgAdminTaxonomy(req, body, action) {
  if (action === "list") {
    const [styles, shapes, materials, topics, tags] = await Promise.all([
      listPgTaxonomyTable("styles"),
      listPgTaxonomyTable("shapes"),
      listPgTaxonomyTable("materials"),
      listPgTaxonomyTable("topics"),
      listPgTaxonomyTable("tags"),
    ]);
    return { ok: true, data: { styles, shapes, materials, topics, tags } };
  }
  const table = String(body.table || "");
  const meta = pgTaxonomyMeta(table);
  const item = body.item || {};
  if (action === "create") {
    const name = cleanPgText(item[meta.label] || item.name);
    if (!name) return { ok: false, error: "Name is required." };
    let row;
    if (table === "materials") {
      row = (await pgPool.query(
        "INSERT INTO materials (material, image, status) VALUES ($1, $2, COALESCE($3, 'on')) ON CONFLICT (material) DO UPDATE SET image=EXCLUDED.image, status=EXCLUDED.status, updated_at=CURRENT_TIMESTAMP RETURNING material_id AS id",
        [name, cleanPgText(item.image), cleanPgText(item.status, "on")],
      )).rows[0];
    } else if (table === "tags") {
      row = (await pgPool.query(
        "INSERT INTO tags (tag, status) VALUES ($1, COALESCE($2, 'on')) ON CONFLICT (tag) DO UPDATE SET status=EXCLUDED.status, updated_at=CURRENT_TIMESTAMP RETURNING tag_id AS id",
        [name, cleanPgText(item.status, "on")],
      )).rows[0];
    } else if (table === "topics") {
      row = (await pgPool.query(
        "INSERT INTO topics (topic, status) VALUES ($1, COALESCE($2, 'on')) RETURNING topic_id AS id",
        [name, cleanPgText(item.status, "on")],
      )).rows[0];
    } else {
      row = (await pgPool.query(
        `INSERT INTO ${meta.table} (${meta.label}, status) VALUES ($1, COALESCE($2, 'on')) ON CONFLICT (${meta.label}) DO UPDATE SET status=EXCLUDED.status, updated_at=CURRENT_TIMESTAMP RETURNING ${meta.id} AS id`,
        [name, cleanPgText(item.status, "on")],
      )).rows[0];
    }
    return { ok: true, id: row?.id, data: await listPgTaxonomyTable(table) };
  }
  const id = String(body.id || item.id || "").trim();
  if (!id) return { ok: false, error: "ID is required." };
  if (action === "delete") {
    await pgPool.query(`DELETE FROM ${meta.table} WHERE ${meta.id}=$1`, [id]);
    return { ok: true, id, data: await listPgTaxonomyTable(table) };
  }
  const status = item.status ? cleanPgText(item.status) : null;
  const name = item[meta.label] || item.name;
  if (table === "materials") {
    await pgPool.query(
      "UPDATE materials SET material=COALESCE(NULLIF($1, ''), material), image=COALESCE($2, image), status=COALESCE($3, status), updated_at=CURRENT_TIMESTAMP WHERE material_id=$4",
      [cleanPgText(name), item.image === undefined ? null : cleanPgText(item.image), status, id],
    );
  } else if (table === "topics") {
    await pgPool.query(
      "UPDATE topics SET topic=COALESCE(NULLIF($1, ''), topic), status=COALESCE($2, status) WHERE topic_id=$3",
      [cleanPgText(name), status, id],
    );
  } else {
    await pgPool.query(
      `UPDATE ${meta.table} SET ${meta.label}=COALESCE(NULLIF($1, ''), ${meta.label}), status=COALESCE($2, status), updated_at=CURRENT_TIMESTAMP WHERE ${meta.id}=$3`,
      [cleanPgText(name), status, id],
    );
  }
  return { ok: true, id, data: await listPgTaxonomyTable(table) };
}

async function handlePgAdminImportProduct(body, itemType) {
  await ensurePgAdminRuntimeSchema();
  if (body.source === "xlsx") {
    return { ok: false, error: "Cloud XLSX import is not enabled yet. Please use single item import for Railway." };
  }
  const item = body.item || {};
  const boundDeviceId = await validatePgBoundDevice(item.bound_device_id);
  if (itemType === "reward") {
    const rewardId = cleanPgText(item.reward_id || item.id, `reward_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`);
    const imageAsset = await resolvePgProductImageInput("rewards", "reward_id", rewardId, item, "reward-products");
    await pgPool.query(
      `
      INSERT INTO rewards (
        reward_id, reward_name, reward_type, unit_point_cost, reward_info, image_url, image_base64,
        bound_device_id, pickup_method, is_featured, stock_quantity, stock_s, stock_m, stock_l, stock_xl, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16, 'active'))
      ON CONFLICT (reward_id) DO UPDATE SET
        reward_name=EXCLUDED.reward_name,
        reward_type=EXCLUDED.reward_type,
        unit_point_cost=EXCLUDED.unit_point_cost,
        reward_info=EXCLUDED.reward_info,
        image_url=EXCLUDED.image_url,
        image_base64=EXCLUDED.image_base64,
        bound_device_id=EXCLUDED.bound_device_id,
        pickup_method=EXCLUDED.pickup_method,
        is_featured=EXCLUDED.is_featured,
        stock_quantity=EXCLUDED.stock_quantity,
        stock_s=EXCLUDED.stock_s,
        stock_m=EXCLUDED.stock_m,
        stock_l=EXCLUDED.stock_l,
        stock_xl=EXCLUDED.stock_xl,
        status=EXCLUDED.status
      `,
      [
        rewardId,
        cleanPgText(item.reward_name || item.name, rewardId),
        cleanPgText(item.reward_type || item.type, "coupon"),
        pgInteger(item.unit_point_cost || item.price_or_points),
        cleanPgText(item.reward_info || item.info),
        imageAsset.imageUrl,
        imageAsset.imageBase64,
        boundDeviceId,
        cleanPgText(item.pickup_method, "pickup"),
        pgFlag(item.is_featured),
        pgInteger(item.stock_quantity || item.stock),
        pgInteger(item.stock_s),
        pgInteger(item.stock_m),
        pgInteger(item.stock_l),
        pgInteger(item.stock_xl),
        cleanPgText(item.status, "active"),
      ],
    );
    return { ok: true, imported: 1, itemType: "reward", ids: [rewardId], models: await handlePgAdminModels() };
  }
  const productId = cleanPgText(item.product_id || item.id, `product_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`);
  const imageAsset = await resolvePgProductImageInput("products", "product_id", productId, item, "products");
  await pgPool.query(
    `
    INSERT INTO products (
      product_id, product_type, product_name, unit_price, product_info, image_url, image_base64,
      style_tags, nail_shape, bound_device_id, stock_quantity, stock_s, stock_m, stock_l, stock_xl,
      on_delivery, pickup_method, is_featured, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, COALESCE($19, 'active'))
    ON CONFLICT (product_id) DO UPDATE SET
      product_type=EXCLUDED.product_type,
      product_name=EXCLUDED.product_name,
      unit_price=EXCLUDED.unit_price,
      product_info=EXCLUDED.product_info,
      image_url=EXCLUDED.image_url,
      image_base64=EXCLUDED.image_base64,
      style_tags=EXCLUDED.style_tags,
      nail_shape=EXCLUDED.nail_shape,
      bound_device_id=EXCLUDED.bound_device_id,
      stock_quantity=EXCLUDED.stock_quantity,
      stock_s=EXCLUDED.stock_s,
      stock_m=EXCLUDED.stock_m,
      stock_l=EXCLUDED.stock_l,
      stock_xl=EXCLUDED.stock_xl,
      on_delivery=EXCLUDED.on_delivery,
      pickup_method=EXCLUDED.pickup_method,
      is_featured=EXCLUDED.is_featured,
      status=EXCLUDED.status
    `,
    [
      productId,
      cleanPgText(item.product_type || item.type, "Press-On Nail"),
      cleanPgText(item.product_name || item.name, productId),
      pgNumber(item.unit_price || item.price_or_points),
      cleanPgText(item.product_info || item.info),
      imageAsset.imageUrl,
      imageAsset.imageBase64,
      cleanPgText(item.style_tags),
      cleanPgText(item.nail_shape),
      boundDeviceId,
      pgInteger(item.stock_quantity || item.stock),
      pgInteger(item.stock_s),
      pgInteger(item.stock_m),
      pgInteger(item.stock_l),
      pgInteger(item.stock_xl),
      item.on_delivery === undefined ? 1 : pgFlag(item.on_delivery),
      cleanPgText(item.pickup_method, "both"),
      pgFlag(item.is_featured),
      cleanPgText(item.status, "active"),
    ],
  );
  return { ok: true, imported: 1, itemType: "product", ids: [productId], models: await handlePgAdminModels() };
}

function pgPromotionContent(item) {
  if (item.promo_content) return String(item.promo_content);
  const content = {};
  for (const key of ["min_spend", "amount_off", "discount_percent", "buy_quantity", "gift_quantity", "gift_product", "free_product", "description"]) {
    if (item[key] !== undefined && item[key] !== "") content[key] = item[key];
  }
  return JSON.stringify(content);
}

async function handlePgAdminCreateRecord(body) {
  const moduleName = String(body.module || "").trim();
  const item = body.item || {};
  if (moduleName === "promo-assets") {
    const row = (await pgPool.query(
      "INSERT INTO promotional_assets (image_url, image_base64) VALUES ($1, $2) RETURNING promo_asset_id",
      [cleanPgText(item.image_url), pgDataUrlOrBase64(item.image_base64)],
    )).rows[0];
    const models = await handlePgAdminModels();
    return { ok: true, id: row?.promo_asset_id, rows: models.models["promo-assets"]?.rows || [] };
  }
  if (moduleName === "promotion") {
    const promoId = cleanPgText(item.promo_id || item.id, `promo_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`);
    await pgPool.query(
      `
      INSERT INTO promotion (promo_id, promo_title, promo_type, promo_content, expire_date, status)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'active'))
      ON CONFLICT (promo_id) DO UPDATE SET
        promo_title=EXCLUDED.promo_title,
        promo_type=EXCLUDED.promo_type,
        promo_content=EXCLUDED.promo_content,
        expire_date=EXCLUDED.expire_date,
        status=EXCLUDED.status,
        updated_at=CURRENT_TIMESTAMP
      `,
      [
        promoId,
        cleanPgText(item.promo_title || item.title, promoId),
        cleanPgText(item.promo_type, "折扣优惠"),
        pgPromotionContent(item),
        cleanPgText(item.expire_date),
        cleanPgText(item.status, "active"),
      ],
    );
    const models = await handlePgAdminModels();
    return { ok: true, id: promoId, rows: models.models.promotion?.rows || [] };
  }
  if (moduleName === "event") {
    let promoAssetId = cleanPgText(item.promo_asset_id);
    if (!promoAssetId && (item.image_base64 || item.image_url)) {
      promoAssetId = (await pgPool.query(
        "INSERT INTO promotional_assets (image_url, image_base64) VALUES ($1, $2) RETURNING promo_asset_id",
        [cleanPgText(item.image_url), pgDataUrlOrBase64(item.image_base64)],
      )).rows[0]?.promo_asset_id;
    }
    const row = (await pgPool.query(
      `
      INSERT INTO events (event_type, event_name, event_title, event_content, promo_asset_id, html_url, start_at, expires_at, status, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'active'), $10)
      RETURNING event_id
      `,
      [
        cleanPgText(item.event_type, "general"),
        cleanPgText(item.event_name || item.name, "Untitled Event"),
        cleanPgText(item.event_title || item.title),
        cleanPgText(item.event_content || item.content),
        promoAssetId || null,
        cleanPgText(item.html_url),
        cleanPgText(item.start_at || item.start_date),
        cleanPgText(item.expires_at || item.expire_date),
        cleanPgText(item.status, "active"),
        pgInteger(item.sort_order),
      ],
    )).rows[0];
    const models = await handlePgAdminModels();
    return { ok: true, id: row?.event_id, rows: models.models.event?.rows || [] };
  }
  if (moduleName === "task") {
    let promoAssetId = cleanPgText(item.promo_asset_id);
    if (!promoAssetId && (item.image_base64 || item.image_url)) {
      promoAssetId = (await pgPool.query(
        "INSERT INTO promotional_assets (image_url, image_base64) VALUES ($1, $2) RETURNING promo_asset_id",
        [cleanPgText(item.image_url), pgDataUrlOrBase64(item.image_base64)],
      )).rows[0]?.promo_asset_id;
    }
    const row = (await pgPool.query(
      `
      INSERT INTO tasks (
        event_id, task_type, task_name, task_title, task_content, promo_asset_id,
        submission_type, allowed_platforms, reward_points, start_at, expires_at, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'active'))
      RETURNING task_id
      `,
      [
        cleanPgText(item.event_id || item.eventId) || null,
        cleanPgText(item.task_type, "design_upload"),
        cleanPgText(item.task_name || item.name, "Untitled Task"),
        cleanPgText(item.task_title || item.title),
        cleanPgText(item.task_content || item.content),
        promoAssetId || null,
        cleanPgText(item.submission_type, "text"),
        cleanPgText(item.allowed_platforms),
        pgInteger(item.reward_points),
        cleanPgText(item.start_at || item.start_date),
        cleanPgText(item.expires_at || item.expire_date),
        cleanPgText(item.status, "active"),
      ],
    )).rows[0];
    const models = await handlePgAdminModels();
    return { ok: true, id: row?.task_id, rows: models.models.task?.rows || [] };
  }
  if (moduleName === "community") {
    const result = await savePgTemplateUpload({
      ...item,
      image: item.image_base64 || item.image,
      templateName: item.template_name || item.templateName || item.name,
    }, "community");
    const models = await handlePgAdminModels();
    return { ...result, id: result.templateId, rows: models.models.community?.rows || [] };
  }
  if (moduleName === "device-info") {
    const row = (await pgPool.query(
      "INSERT INTO device_info (equip_id, type, address, status) VALUES ($1, $2, $3, COALESCE($4, 'active')) RETURNING id",
      [cleanPgText(item.equip_id || item.id, `equip_${Date.now()}`), cleanPgText(item.type, "打印机"), cleanPgText(item.address), cleanPgText(item.status, "active")],
    )).rows[0];
    const models = await handlePgAdminModels();
    return { ok: true, id: row?.id, rows: models.models["device-info"]?.rows || [] };
  }
  return { ok: false, error: `Cloud create is not implemented for ${moduleName}.` };
}

async function handlePgAdminRecordMutation(body, action) {
  const moduleName = String(body.module || "").trim();
  const id = String(body.id || "").trim();
  const item = body.item || {};
  if (!id) return { ok: false, error: "ID is required." };
  if (action === "delete") {
    const deleteMap = {
      product: body.itemKind === "reward" ? ["rewards", "reward_id"] : ["products", "product_id"],
      event: ["events", "event_id"],
      task: ["tasks", "task_id"],
      "promo-assets": ["promotional_assets", "promo_asset_id"],
      promotion: ["promotion", "promo_id"],
      official: ["templates", "template_id"],
      community: ["templates", "template_id"],
      users: ["users", "user_id"],
      "device-info": ["device_info", "id"],
    };
    const target = deleteMap[moduleName];
    if (!target) return { ok: false, error: `Delete is not implemented for ${moduleName}.` };
    if (moduleName === "official" || moduleName === "community") {
      await pgPool.query("UPDATE templates SET status='deleted', visibility='private', updated_at=CURRENT_TIMESTAMP WHERE template_id=$1", [id]);
    } else {
      await pgPool.query(`DELETE FROM ${target[0]} WHERE ${target[1]}=$1`, [id]);
    }
    const models = await handlePgAdminModels();
    return { ok: true, id, rows: models.models[moduleName]?.rows || [] };
  }
  if (moduleName === "product") {
    const importResult = await handlePgAdminImportProduct({ item: { ...item, id }, source: "single" }, body.itemKind === "reward" ? "reward" : "product");
    const models = await handlePgAdminModels();
    return { ok: importResult.ok, id, rows: models.models.product?.rows || [], error: importResult.error };
  }
  if (moduleName === "promotion") {
    await handlePgAdminCreateRecord({ module: "promotion", item: { ...item, promo_id: id } });
  } else if (moduleName === "event") {
    await pgPool.query(
      "UPDATE events SET event_type=COALESCE(NULLIF($1, ''), event_type), event_name=COALESCE(NULLIF($2, ''), event_name), event_title=$3, event_content=$4, html_url=$5, start_at=$6, expires_at=$7, status=COALESCE(NULLIF($8, ''), status), sort_order=$9 WHERE event_id=$10",
      [cleanPgText(item.event_type), cleanPgText(item.event_name || item.name), cleanPgText(item.event_title || item.title), cleanPgText(item.event_content || item.content), cleanPgText(item.html_url), cleanPgText(item.start_at || item.start_date), cleanPgText(item.expires_at || item.expire_date), cleanPgText(item.status), pgInteger(item.sort_order), id],
    );
  } else if (moduleName === "task") {
    await pgPool.query(
      "UPDATE tasks SET task_type=COALESCE(NULLIF($1, ''), task_type), task_name=COALESCE(NULLIF($2, ''), task_name), task_title=$3, task_content=$4, submission_type=COALESCE(NULLIF($5, ''), submission_type), allowed_platforms=$6, reward_points=$7, start_at=$8, expires_at=$9, status=COALESCE(NULLIF($10, ''), status) WHERE task_id=$11",
      [cleanPgText(item.task_type), cleanPgText(item.task_name || item.name), cleanPgText(item.task_title || item.title), cleanPgText(item.task_content || item.content), cleanPgText(item.submission_type), cleanPgText(item.allowed_platforms), pgInteger(item.reward_points), cleanPgText(item.start_at || item.start_date), cleanPgText(item.expires_at || item.expire_date), cleanPgText(item.status), id],
    );
  } else if (moduleName === "promo-assets") {
    await pgPool.query("UPDATE promotional_assets SET image_url=$1, image_base64=$2 WHERE promo_asset_id=$3", [cleanPgText(item.image_url), pgDataUrlOrBase64(item.image_base64), id]);
  } else if (moduleName === "official" || moduleName === "community") {
    await pgPool.query(
      "UPDATE templates SET template_name=COALESCE(NULLIF($1, ''), template_name), template_title=$2, description=$3, design_type=COALESCE(NULLIF($4, ''), design_type), nail_shape=$5, material_type=$6, status=COALESCE(NULLIF($7, ''), status), updated_at=CURRENT_TIMESTAMP WHERE template_id=$8",
      [cleanPgText(item.template_name || item.name), cleanPgText(item.template_title || item.title), cleanPgText(item.description || item.info), cleanPgText(item.design_type), cleanPgText(item.nail_shape), cleanPgText(item.material_type), cleanPgText(item.status), id],
    );
  } else if (moduleName === "device-info") {
    await pgPool.query("UPDATE device_info SET equip_id=COALESCE(NULLIF($1, ''), equip_id), type=COALESCE(NULLIF($2, ''), type), address=$3, status=COALESCE(NULLIF($4, ''), status), updated_at=CURRENT_TIMESTAMP WHERE id=$5", [cleanPgText(item.equip_id), cleanPgText(item.type), cleanPgText(item.address), cleanPgText(item.status), id]);
  } else {
    return { ok: false, error: `Update is not implemented for ${moduleName}.` };
  }
  const models = await handlePgAdminModels();
  return { ok: true, id, rows: models.models[moduleName]?.rows || [] };
}

async function handleUserSession(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserSession(body);
      sendJson(res, 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "session",
      userId: body.userId,
      recoveryCode: body.recoveryCode,
    });
    sendJson(res, result.ok === false ? 400 : 200, result);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to initialize user session." });
  }
}

async function handleUserLogin(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserLogin(body);
      sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "login",
      username: body.username,
      password: body.password,
      guestUserId: body.guestUserId,
      guestRecoveryCode: body.guestRecoveryCode,
    });
    sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 401, { ok: false, error: error.message || "Failed to login." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserRequestCode(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserRequestCode(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "request_code",
      targetType: body.targetType,
      target: body.target,
      username: body.username,
      purpose: body.purpose,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to request verification code." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserCreateAccount(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserCreateAccount(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "create_account",
      username: body.username,
      password: body.password,
      verificationId: body.verificationId,
      code: body.code,
      guestUserId: body.guestUserId,
      guestRecoveryCode: body.guestRecoveryCode,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to create account." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserResetPassword(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserResetPassword(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "reset_password",
      verificationId: body.verificationId,
      code: body.code,
      newPassword: body.newPassword,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to reset password." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserLogout(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserLogout(body);
      sendJson(res, 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "logout",
      sessionId: body.sessionId,
    });
    sendJson(res, 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to logout." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserAuthSession(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserAuthSession(body);
      sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "auth_session",
      sessionId: body.sessionId,
    });
    sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 401, { ok: false, error: error.message || "Failed to verify session." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserProfile(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserProfile(body);
      sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "profile",
      sessionId: body.sessionId,
    });
    sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to load profile." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserPromos(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserPromos(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "promotion_admin.py"), {
      action: "public_user_promos",
      sessionId: body.sessionId,
      userId: body.userId,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to load user promotions." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserPrintRecords(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserPrintRecords(body);
      sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    sendJson(res, 200, { ok: true, records: [], fallback: true }, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      service: "user-print-records",
      operation: "load",
      error: error.message || "Failed to load print records.",
    }, { "Cache-Control": "no-store" });
  }
}

async function handleUserUpdateContact(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserUpdateContact(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "update_contact",
      sessionId: body.sessionId,
      targetType: body.targetType,
      newTarget: body.newTarget,
      oldVerificationId: body.oldVerificationId,
      oldCode: body.oldCode,
      newVerificationId: body.newVerificationId,
      newCode: body.newCode,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to update contact." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserShippingAddress(req, res) {
  const body = await readJson(req);
  const mode = body.mode === "save" ? "save_shipping_address" : "get_shipping_address";
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserShippingAddress(body);
      sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: mode,
      sessionId: body.sessionId,
      address: body.address,
    });
    sendJson(res, result.ok === false ? 401 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to sync shipping address." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserAction(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserAction(body);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "record_action",
      userId: body.userId,
      recoveryCode: body.recoveryCode,
      targetType: body.targetType,
      targetId: body.targetId,
      actionType: body.actionType,
    });
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || "Failed to record user action." }, { "Cache-Control": "no-store" });
  }
}

async function handleTemplateSocial(req, res, url) {
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgTemplateSocial(req, url);
      sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
      return;
    }
    const body = req.method === "GET"
      ? {
          action: "detail",
          templateId: url.searchParams.get("templateId") || "",
        }
      : await readJson(req);
    const result = await runPythonJsonScript(path.join(root, "database", "template_social.py"), body);
    sendJson(res, result.ok === false ? 400 : 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to load template social data." }, { "Cache-Control": "no-store" });
  }
}

async function handleUserDraft(req, res, url) {
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgUserDraft(req, url);
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    if (req.method === "GET") {
      const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
        action: "load_draft",
        userId: url.searchParams.get("userId") || "",
        recoveryCode: url.searchParams.get("recoveryCode") || "",
        draftId: url.searchParams.get("draftId") || "",
      });
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const body = await readJson(req);
    const result = await runPythonJsonScript(path.join(root, "database", "user_persistence.py"), {
      action: "save_draft",
      ...body,
    });
    sendJson(res, result.ok === false ? 400 : 200, result);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to sync user draft." });
  }
}

/*
async function handleAdminLogin(req, res) {
  const body = await readJson(req);
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "admin_auth.py"), {
      action: "login",
      adminId: body.adminId,
      password: body.password,
    });
    if (!result.ok) {
      sendJson(res, 401, result);
      return;
    }
    const maxAge = Number(result.session?.maxAge || 8 * 60 * 60);
    sendJson(res, 200, result, {
      "Set-Cookie": `${adminCookieName}=${encodeURIComponent(result.session.token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store",
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to login." });
  }
}

async function handleAdminLogout(req, res) {
  try {
    await runPythonJsonScript(path.join(root, "database", "admin_auth.py"), {
      action: "logout",
      token: adminSessionToken(req),
    });
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": `${adminCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store",
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to logout." });
  }
}

async function handleAdminSession(req, res) {
  const result = await getAdminSession(req);
  sendJson(res, result.ok ? 200 : 401, result, { "Cache-Control": "no-store" });
}

async function handleAdminCreateAccount(req, res) {
  const body = await readJson(req);
  if (String(body.password || "") !== String(body.confirmPassword || "")) {
    sendJson(res, 400, { ok: false, error: "Passwords do not match." });
    return;
  }
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "admin_auth.py"), {
      action: "create_admin",
      adminId: body.adminId,
      displayName: body.displayName,
      password: body.password,
      role: body.role,
      status: body.status,
    });
    sendJson(res, result.ok ? 200 : 400, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Failed to create admin account." });
  }
}
*/

async function handleAdminImportProduct(req, res) {
  const body = await readJson(req);
  const itemType = body.itemType === "reward" ? "reward" : "product";
  if (body.source === "xlsx" && !body.xlsx) {
    sendJson(res, 400, { error: "xlsx file data is required" });
    return;
  }
  if (body.source !== "xlsx" && !body.item) {
    sendJson(res, 400, { error: "item data is required" });
    return;
  }
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgAdminImportProduct(body, itemType);
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_product_import.py"), { ...body, itemType });
    sendJson(res, result.ok === false ? 400 : 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to import product data." });
  }
}

async function handleAdminTaxonomy(req, res) {
  let body = {};
  if (req.method !== "GET") {
    body = await readJson(req);
  }
  const action = req.method === "GET"
    ? "list"
    : req.method === "POST"
      ? "create"
      : req.method === "PATCH"
        ? "update"
        : "delete";
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgAdminTaxonomy(req, body, action);
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_taxonomy.py"), { ...body, action });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to manage taxonomy data." });
  }
}

async function handleAdminModels(req, res) {
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgAdminModels();
      sendJson(res, 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_models.py"), {});
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load admin models." });
  }
}

async function handleAdminProductImage(req, res, url) {
  try {
    const result = hasPostgresRuntime()
      ? await handlePgAdminProductImage(url)
      : await runPythonJsonScript(path.join(root, "database", "admin_media.py"), {
        itemKind: url.searchParams.get("itemKind") || "product",
        id: url.searchParams.get("id") || "",
      });
    if (!result.ok) {
      sendJson(res, 404, { error: result.error || "Image not found." });
      return;
    }
    if (result.image_url) {
      res.writeHead(302, { Location: result.image_url });
      res.end();
      return;
    }
    const dataUrl = String(result.image_base64 || "");
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    const mimeType = match ? match[1] : "image/png";
    const encoded = match ? match[2] : dataUrl;
    if (!encoded) {
      sendJson(res, 404, { error: "Image not found." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=300",
    });
    res.end(Buffer.from(encoded, "base64"));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load product image." });
  }
}

async function handleAdminCreateRecord(req, res) {
  const body = await readJson(req);
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgAdminCreateRecord(body);
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_record_create.py"), body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to create admin record." });
  }
}

async function handleAdminRecordMutation(req, res) {
  const body = await readJson(req);
  const action = req.method === "DELETE" ? "delete" : "update";
  try {
    if (hasPostgresRuntime()) {
      const result = await handlePgAdminRecordMutation(body, action);
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }
    const result = await runPythonJsonScript(path.join(root, "database", "admin_record_manage.py"), { ...body, action });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to update admin record." });
  }
}

function splitPgValues(value) {
  return String(value || "").replace(/[|]/g, ",").split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePgJsonList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : splitPgValues(text);
  } catch {
    return splitPgValues(text);
  }
}

function parsePgImageList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  if (/^(data:image\/|https?:\/\/)/i.test(text)) return [text];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed || "")].filter(Boolean);
  } catch {
    return splitPgValues(text);
  }
}

async function safePgRows(query, params = []) {
  try {
    return (await pgPool.query(query, params)).rows;
  } catch (error) {
    if (["42P01", "42703"].includes(error.code)) return [];
    throw error;
  }
}

async function ensurePgAdminRuntimeSchema() {
  if (!hasPostgresRuntime() || pgAdminRuntimeSchemaReady) return;
  await pgPool.query("ALTER TABLE assets ADD COLUMN IF NOT EXISTS sha256 TEXT");
  await pgPool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256) WHERE sha256 IS NOT NULL AND sha256 <> ''");
  await pgPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS bound_device_id TEXT");
  await pgPool.query("ALTER TABLE rewards ADD COLUMN IF NOT EXISTS bound_device_id TEXT");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_code TEXT");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT NOT NULL DEFAULT '000000'");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS bound_device_id TEXT");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider_id TEXT");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS manufacturer_sync_status TEXT DEFAULT 'not_required'");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS manufacturer_sync_error TEXT");
  await pgPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS manufacturer_response TEXT");
  await pgPool.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size TEXT");
  await pgPool.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_snapshot TEXT");
  await pgPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_print_code_digits'
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_print_code_digits
        CHECK (print_code IS NULL OR print_code ~ '^[0-9]{6}$');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_pickup_code_digits'
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_pickup_code_digits
        CHECK (pickup_code ~ '^[0-9]+$');
      END IF;
    END $$;
  `);
  pgAdminRuntimeSchemaReady = true;
}

function parseImageDataUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^data:([^;,]+);base64,(.+)$/);
  const mimeType = match ? match[1] : "image/png";
  const encoded = match ? match[2] : text;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) return null;
  const extension = mimeType.includes("jpeg") || mimeType.includes("jpg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : "png";
  return {
    mimeType,
    encoded,
    dataUrl: `data:${mimeType};base64,${encoded}`,
    buffer,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    extension,
  };
}

function r2UploadConfig() {
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
  const bucket = process.env.R2_BUCKET || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

async function uploadBufferToR2(buffer, key, contentType) {
  const config = r2UploadConfig();
  if (!config) return "";
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function resolvePgUploadedImageAsset(imageBase64, imageUrl, assetType = "product-image") {
  const existingUrl = cleanPgText(imageUrl);
  const parsed = parseImageDataUrl(imageBase64);
  if (!parsed) {
    return { imageUrl: existingUrl, imageBase64: "", assetId: "" };
  }
  await ensurePgAdminRuntimeSchema();
  const existing = (await pgPool.query(
    "SELECT asset_id, url, base64_data FROM assets WHERE sha256=$1 LIMIT 1",
    [parsed.sha256],
  )).rows[0];
  if (existing?.url) {
    return { imageUrl: existing.url, imageBase64: "", assetId: existing.asset_id };
  }

  const assetId = existing?.asset_id || `asset_${assetType}_${parsed.sha256.slice(0, 18)}`;
  let publicUrl = "";
  try {
    publicUrl = await uploadBufferToR2(parsed.buffer, `${assetType}/${parsed.sha256}.${parsed.extension}`, parsed.mimeType);
  } catch (error) {
    console.warn(`[asset-upload] ${assetType} R2 upload failed: ${error.message || error}`);
  }

  await pgPool.query(
    `
    INSERT INTO assets (asset_id, asset_type, mime_type, url, base64_data, sha256)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (asset_id) DO UPDATE SET
      mime_type=EXCLUDED.mime_type,
      url=COALESCE(NULLIF(EXCLUDED.url, ''), assets.url),
      base64_data=CASE WHEN NULLIF(EXCLUDED.url, '') IS NULL THEN EXCLUDED.base64_data ELSE '' END,
      sha256=EXCLUDED.sha256
    `,
    [assetId, assetType, parsed.mimeType, publicUrl, publicUrl ? "" : parsed.dataUrl, parsed.sha256],
  );

  return {
    imageUrl: publicUrl || "",
    imageBase64: publicUrl ? "" : parsed.dataUrl,
    assetId,
  };
}

async function resolvePgProductImageInput(table, idColumn, id, item, assetType) {
  const parsed = parseImageDataUrl(item.image_base64);
  if (parsed) return resolvePgUploadedImageAsset(item.image_base64, item.image_url, assetType);
  const explicitUrl = cleanPgText(item.image_url);
  if (explicitUrl) return { imageUrl: explicitUrl, imageBase64: "", assetId: "" };
  const existing = (await pgPool.query(
    `SELECT image_url, image_base64 FROM ${table} WHERE ${idColumn}=$1`,
    [id],
  )).rows[0];
  return {
    imageUrl: existing?.image_url || "",
    imageBase64: existing?.image_base64 || "",
    assetId: "",
  };
}

async function validatePgBoundDevice(value) {
  const deviceId = cleanPgText(value);
  if (!deviceId) return "";
  await ensurePgAdminRuntimeSchema();
  const row = (await pgPool.query(
    `
    SELECT equip_id
    FROM device_info
    WHERE equip_id=$1
      AND type IN ('主机', 'main_unit')
      AND COALESCE(status, 'active')='active'
    `,
    [deviceId],
  )).rows[0];
  if (!row) throw new Error("设备不存在无法添加");
  return deviceId;
}

async function pgTaxonomyMap(targetType) {
  const links = await safePgRows(
    "SELECT taxonomy_type, taxonomy_id, target_id FROM taxonomy_links WHERE target_type=$1",
    [targetType],
  );
  const result = new Map();
  for (const link of links) {
    const list = result.get(link.target_id) || [];
    list.push(`${link.taxonomy_type}:${link.taxonomy_id}`, String(link.taxonomy_id));
    result.set(link.target_id, list);
  }
  return result;
}

function pgAssetSource(asset) {
  if (!asset) return "";
  if (asset.url) return asset.url;
  const base64 = String(asset.base64_data || asset.image_base64 || "").trim();
  if (base64) {
    if (base64.startsWith("data:")) return base64;
    return `data:${asset.mime_type || "image/png"};base64,${base64}`;
  }
  return "";
}

async function pgAssetMap() {
  const assets = await safePgRows("SELECT asset_id, url, base64_data, mime_type FROM assets");
  return new Map(assets.map((asset) => [asset.asset_id, asset]));
}

async function loadPgTaxonomy() {
  const [
    officialGalleries,
    communityGalleries,
    shapes,
    styles,
    materials,
    topics,
  ] = await Promise.all([
    safePgRows("SELECT official_gallery_id AS id, gallery_name AS name, description, sort_order, status FROM official_galleries WHERE status='active' ORDER BY sort_order ASC, created_at DESC"),
    safePgRows("SELECT community_gallery_id AS id, gallery_name AS name, description, 'active' AS status FROM community_galleries ORDER BY created_at DESC"),
    safePgRows("SELECT shape_id AS id, shape AS name, status FROM shapes WHERE status='on' ORDER BY created_at ASC"),
    safePgRows("SELECT style_id AS id, style AS name, status FROM styles WHERE status='on' ORDER BY created_at ASC"),
    safePgRows("SELECT material_id AS id, material AS name, image, status FROM materials WHERE status='on' ORDER BY created_at ASC"),
    safePgRows("SELECT topic_id AS id, topic AS name, status FROM topics WHERE status='on' ORDER BY created_at ASC"),
  ]);
  return {
    official_galleries: officialGalleries,
    community_galleries: communityGalleries,
    shapes,
    styles,
    materials,
    topics,
  };
}

async function loadPgTemplates() {
  const [assets, templateLinks, galleryLinks] = await Promise.all([
    pgAssetMap(),
    pgTaxonomyMap("template"),
    safePgRows("SELECT gallery_type, gallery_id, template_id FROM gallery_templates"),
  ]);
  const galleryMap = new Map();
  for (const link of galleryLinks) {
    const list = galleryMap.get(link.template_id) || [];
    list.push(String(link.gallery_id), `${link.gallery_type}:${link.gallery_id}`);
    galleryMap.set(link.template_id, list);
  }
  const items = await safePgRows(`
    SELECT
      t.template_id,
      t.source_type,
      t.template_name,
      t.template_title,
      t.description,
      t.design_type,
      t.nail_shape,
      t.material_type,
      t.shape_categories,
      t.style_categories,
      t.material_categories,
      t.topic_tags,
      t.tags,
      t.author_user_id,
      t.author_display_name,
      t.author_level,
      t.view_count,
      t.heat_count,
      t.like_count,
      t.favorite_count,
      t.comment_count,
      t.published_at,
      t.image_asset_ids,
      COALESCE(a.asset_id, '') AS image_asset_id,
      COALESCE(a.url, '') AS image_url,
      COALESCE(a.base64_data, '') AS image_base64,
      COALESCE(a.mime_type, '') AS image_mime_type
    FROM templates t
    LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
    WHERE t.status='active' AND t.visibility='public' AND t.source_type IN ('official', 'community')
    ORDER BY COALESCE(t.published_at, t.created_at) DESC
  `);
  return items.map((item) => {
    const imageList = [];
    for (const assetId of parsePgJsonList(item.image_asset_ids)) {
      const source = pgAssetSource(assets.get(assetId));
      if (source) imageList.push(source);
    }
    if (!imageList.length) {
      const coverSource = pgAssetSource({
        url: item.image_url,
        base64_data: item.image_base64,
        mime_type: item.image_mime_type,
      });
      if (coverSource) imageList.push(coverSource);
    }
    const categoryIds = [
      ...(templateLinks.get(item.template_id) || []),
      ...(galleryMap.get(item.template_id) || []),
      ...splitPgValues(item.shape_categories),
      ...splitPgValues(item.style_categories),
      ...splitPgValues(item.material_categories),
      ...splitPgValues(item.topic_tags),
      ...splitPgValues(item.tags),
    ];
    if (item.nail_shape) categoryIds.push(item.nail_shape, `shapes:${item.nail_shape}`);
    if (item.material_type) categoryIds.push(item.material_type, `materials:${item.material_type}`);
    if (item.design_type) categoryIds.push(`type-${item.design_type}`);
    return {
      ...item,
      image_url: item.image_url || imageList[0] || "",
      image_base64: "",
      image_list: imageList,
      category_ids: [...new Set(categoryIds)].sort(),
    };
  });
}

async function loadPgMaterialBases() {
  const [assets, materialRows] = await Promise.all([
    pgAssetMap(),
    safePgRows("SELECT material_id, material, image, status FROM materials WHERE status='on' ORDER BY created_at ASC"),
  ]);
  const items = await safePgRows(`
    SELECT
      t.template_id,
      t.source_type,
      t.template_name,
      t.template_title,
      t.nail_shape,
      t.material_type,
      t.shape_categories,
      t.material_categories,
      t.image_asset_ids,
      COALESCE(a.asset_id, '') AS image_asset_id,
      COALESCE(a.url, '') AS image_url,
      COALESCE(a.base64_data, '') AS image_base64,
      COALESCE(a.mime_type, '') AS image_mime_type
    FROM templates t
    LEFT JOIN assets a ON a.asset_id = COALESCE(t.cover_asset_id, t.image_asset_id)
    WHERE t.source_type='official'
      AND COALESCE(t.status, 'active')='active'
      AND (
        t.template_id LIKE '%123%'
        OR t.template_id LIKE '%124%'
        OR t.template_id LIKE '%125%'
        OR t.template_id LIKE '%126%'
        OR t.template_id LIKE '%127%'
        OR t.template_id LIKE '%128%'
        OR t.template_id LIKE '%129%'
        OR t.template_id LIKE '%130%'
        OR t.template_id LIKE 'official_%_printing-nail-%'
        OR t.material_type IS NOT NULL
        OR t.design_type IN ('nail', 'printing_nail', 'printable_nail', '甲片')
      )
    ORDER BY COALESCE(t.updated_at, t.created_at) DESC
  `);
  const templateItems = items.map((item) => {
    const imageList = [];
    for (const assetId of parsePgJsonList(item.image_asset_ids)) {
      const source = pgAssetSource(assets.get(assetId));
      if (source) imageList.push(source);
    }
    if (!imageList.length) {
      const coverSource = pgAssetSource({
        url: item.image_url,
        base64_data: item.image_base64,
        mime_type: item.image_mime_type,
      });
      if (coverSource) imageList.push(coverSource);
    }
    return {
      ...item,
      image_base64: "",
      image_url: item.image_url || imageList[0] || "",
      image_list: imageList,
    };
  }).filter((item) => item.image_list.length || item.image_url);
  const materialItems = materialRows.map((item) => {
    const imageList = parsePgImageList(item.image)
      .map((source) => pgAssetSource(assets.get(source)) || source)
      .filter(Boolean);
    return {
      template_id: `material_${item.material_id}_${item.material}`,
      source_type: "official",
      template_name: item.material,
      template_title: item.material,
      nail_shape: "",
      material_type: item.material,
      shape_categories: "",
      material_categories: item.material,
      image_asset_ids: "",
      image_asset_id: "",
      image_url: imageList[0] || "",
      image_base64: "",
      image_list: imageList,
    };
  }).filter((item) => item.image_list.length || item.image_url);
  return [...materialItems, ...templateItems];
}

async function loadPgProducts() {
  await ensurePgAdminRuntimeSchema();
  const productLinks = await pgTaxonomyMap("product");
  const items = await safePgRows(`
    SELECT
      p.product_id,
      p.product_type,
      p.product_name,
      p.unit_price,
      p.product_info,
      p.style_tags,
      p.nail_shape,
      p.bound_device_id,
      p.image_base64,
      p.stock_quantity,
      p.stock_s,
      p.stock_m,
      p.stock_l,
      p.stock_xl,
      p.pickup_method,
      p.is_featured,
      p.status,
      COALESCE(NULLIF(p.image_url, ''), a.url, '') AS image_url
    FROM products p
    LEFT JOIN assets a ON a.asset_id = p.cover_asset_id
    WHERE p.status='active'
    ORDER BY p.created_at DESC
  `);
  return items.map((item) => {
    const categoryIds = [...(productLinks.get(item.product_id) || []), ...splitPgValues(item.style_tags)];
    if (item.nail_shape) categoryIds.push(item.nail_shape, `shapes:${item.nail_shape}`);
    if (item.product_type) categoryIds.push(`product-type:${item.product_type}`);
    const pickupMethod = ["pickup", "shipping", "both"].includes(String(item.pickup_method || "").toLowerCase())
      ? String(item.pickup_method).toLowerCase()
      : "both";
    return {
      ...item,
      image_base64: item.image_base64 || "",
      category_ids: [...new Set(categoryIds)].sort(),
      delivery_mode: pickupMethod,
      supports_pickup: ["pickup", "both"].includes(pickupMethod),
      supports_shipping: ["shipping", "both"].includes(pickupMethod),
    };
  });
}

async function loadPgEvents() {
  const assets = await pgAssetMap();
  const items = await safePgRows(`
    SELECT
      e.event_id,
      e.event_type,
      e.event_name,
      e.event_title,
      e.event_content,
      e.html_url,
      e.start_at,
      e.expires_at,
      e.sort_order,
      e.status,
      e.banner_asset_id,
      e.promo_asset_id,
      COALESCE(pa.image_url, '') AS promo_image_url
    FROM events e
    LEFT JOIN promotional_assets pa ON pa.promo_asset_id = e.promo_asset_id
    WHERE e.status='active'
    ORDER BY e.sort_order ASC, e.created_at DESC
  `);
  return items.map((item) => ({
    ...item,
    promo_image_base64: "",
    image: pgAssetSource(assets.get(item.banner_asset_id)) || item.promo_image_url || "",
  }));
}

async function loadPgArticles() {
  const articleLinks = await pgTaxonomyMap("article");
  const items = await safePgRows(`
    SELECT
      ar.article_id,
      ar.article_type,
      ar.title,
      ar.content,
      ar.related_topics,
      ar.heat_count,
      ar.created_at,
      COALESCE(u.username, u.user_id) AS author_name
    FROM articles ar
    LEFT JOIN users u ON u.user_id = ar.author_user_id
    WHERE ar.status='published'
    ORDER BY ar.created_at DESC
  `);
  return items.map((item) => {
    const categoryIds = [...(articleLinks.get(item.article_id) || []), ...splitPgValues(item.related_topics)];
    if (item.article_type) categoryIds.push(`article-type:${item.article_type}`);
    return { ...item, category_ids: [...new Set(categoryIds)].sort() };
  });
}

async function handleGalleryTaxonomy(req, res) {
  try {
    requirePostgresRuntime("load gallery taxonomy");
    const taxonomy = await loadPgTaxonomy();
    sendJson(res, 200, {
      ok: true,
      data: {
        official_galleries: taxonomy.official_galleries,
        community_galleries: taxonomy.community_galleries,
        shapes: taxonomy.shapes,
        styles: taxonomy.styles,
        materials: taxonomy.materials,
      },
    }, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load gallery taxonomy data." }, { "Cache-Control": "no-store" });
  }
}

async function handlePublicCatalog(req, res) {
  try {
    requirePostgresRuntime("load public catalog");
    const [taxonomy, templates, materialBases, products, events, community, deviceInfo] = await Promise.all([
      loadPgTaxonomy(),
      loadPgTemplates(),
      loadPgMaterialBases(),
      loadPgProducts(),
      loadPgEvents(),
      loadPgArticles(),
      safePgRows("SELECT id, equip_id, type, address, status FROM device_info WHERE COALESCE(status, 'active')='active' ORDER BY created_at DESC"),
    ]);
    sendJson(res, 200, {
      ok: true,
      data: {
        taxonomy,
        templates,
        material_bases: materialBases,
        products,
        events,
        community,
        device_info: deviceInfo,
      },
    }, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load public catalog data." }, { "Cache-Control": "no-store" });
  }
}

function buildAiOutputs(step2Images, step3Image) {
  const images = Array.isArray(step2Images) ? step2Images : [step2Images].filter(Boolean);
  const step2Outputs = nailGenerationTargets.map((target, index) => ({
    step: target.step,
    order: index + 1,
    nail: target.nail,
    kind: "single-nail-flat-design",
    image: images[index] || images[0] || "",
  }));
  return [
    ...step2Outputs,
    {
      step: "step3",
      kind: "hand-mockup-preview",
      image: step3Image || images[0] || "",
    },
  ];
}

async function handleArkGenerate(res, { prompt, flow, requestedModel, references, includePreview, prependErrors = [] }) {
  const token = process.env.ARK_API_KEY;
  if (!token) {
    const step2Images = nailGenerationTargets.map((target) => makeSampleImage(`${prompt} ${target.label}`, flow));
    const step3Image = includePreview ? makeSampleImage(`${prompt} hand preview`, "preview") : "";
    sendJson(res, 200, {
      provider: "sample",
      model: requestedModel,
      outputs: buildAiOutputs(step2Images, step3Image),
      images: step2Images,
      previewImage: step3Image,
      message: "ARK_API_KEY is not configured. Returned local sample images.",
    });
    return;
  }

  const errors = Array.isArray(prependErrors) ? [...prependErrors] : [];
  const designJobs = nailGenerationTargets.map((target) => {
    const promptSpec = buildPrompt(prompt, flow, references, "design", target);
    return submitArkGenerationJob({
      token,
      model: requestedModel || defaultArkModel,
      promptSpec,
      fallbackImage: makeSampleImage(`${prompt} ${target.label}`, flow),
      errorLabel: target.step,
    });
  });
  const previewJob = includePreview
    ? submitArkGenerationJob({
        token,
        model: requestedModel || defaultArkModel,
        promptSpec: buildPrompt(prompt, flow, references, "preview"),
        fallbackImage: makeSampleImage(`${prompt} hand preview`, "preview"),
        errorLabel: "step3",
      })
    : Promise.resolve({ image: "", meta: null, error: "" });

  const [designResults, previewResult] = await Promise.all([
    Promise.all(designJobs),
    previewJob,
  ]);
  const images = designResults.map((result) => result.image);
  const step2Metas = designResults.map((result) => result.meta);
  for (const result of [...designResults, previewResult]) {
    if (result.error) errors.push(result.error);
  }
  const previewImage = previewResult.image || "";
  const step3Meta = previewResult.meta;

  const outputs = attachAiOutputMeta(buildAiOutputs(images, previewImage), step2Metas, step3Meta);
  sendJson(res, 200, {
    provider: "byteplus-ark",
    endpoint: "byteplus-ark-images-generations",
    model: requestedModel || defaultArkModel,
    outputs,
    images,
    previewImage,
    asyncMode: "parallel-image-generation",
    message: errors.length
      ? `Ark image generation completed with fallbacks: ${errors.join(" | ")}`
      : "Ark image generation completed.",
  });
}

async function submitArkGenerationJob({ token, model, promptSpec, fallbackImage, errorLabel }) {
  try {
    const result = await requestBytePlusArkImage(defaultArkEndpoint, token, model, promptSpec);
    return {
      image: extractImageFromArkResponse(result) || fallbackImage,
      meta: compactArkResult(result),
      error: "",
    };
  } catch (error) {
    return {
      image: fallbackImage,
      meta: { error: networkErrorMessage(error) },
      error: `${errorLabel}: ${networkErrorMessage(error)}`,
    };
  }
}

function attachAiOutputMeta(outputs, step2Metas = [], step3Meta = null) {
  return outputs.map((output) => {
    if (/^step2-\d+$/.test(output.step)) {
      return { ...output, task: step2Metas[(output.order || 1) - 1] || null };
    }
    if (output.step === "step3") return { ...output, task: step3Meta };
    return output;
  });
}

function isArkModel(model) {
  const value = String(model || "").toLowerCase();
  return value === String(defaultArkModel).toLowerCase() || value.includes("seedream") || value.includes("seedance") || value.includes("bytedance");
}

function huggingFaceEndpoints(model = process.env.HF_IMAGE_MODEL || defaultModel) {
  const modelPath = String(model || defaultModel).split("/").map(encodeURIComponent).join("/");
  return [
    {
      label: "router-hf-inference",
      url: `https://router.huggingface.co/hf-inference/models/${modelPath}`,
    },
    {
      label: "legacy-api-inference",
      url: `https://api-inference.huggingface.co/models/${modelPath}`,
    },
  ];
}

async function requestBytePlusArkImage(endpoint, token, model, promptSpec) {
  const payload = bytePlusArkPayload(model, promptSpec);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : data.error?.message || data.message || `HTTP ${response.status}`);
  }
  return data;
}

function bytePlusArkPayload(model, promptSpec) {
  const spec = typeof promptSpec === "string" ? { prompt: promptSpec } : promptSpec;
  const { width, height } = arkImageSize(spec.width, spec.height);
  const guidance = clampNumber(spec.guidance ?? process.env.ARK_GUIDANCE_SCALE ?? 2.5, 1, 10);
  return {
    model,
    prompt: spec.prompt || "",
    negative_prompt: spec.negativePrompt || "",
    size: `${width}x${height}`,
    width,
    height,
    response_format: "b64_json",
    guidance_scale: guidance,
    num_inference_steps: Number(spec.steps ?? 4),
  };
}

function arkImageSize(inputWidth, inputHeight) {
  const minPixels = 3_686_400;
  let width = Number(inputWidth || process.env.ARK_IMAGE_WIDTH || 1536);
  let height = Number(inputHeight || process.env.ARK_IMAGE_HEIGHT || 2560);
  if (width * height < minPixels) {
    const scale = Math.sqrt(minPixels / (width * height));
    width = Math.ceil((width * scale) / 64) * 64;
    height = Math.ceil((height * scale) / 64) * 64;
  }
  return { width, height };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function extractImageFromArkResponse(value) {
  const found = findArkImageValue(value, new Set());
  if (!found) return "";
  if (/^data:image\//i.test(found)) return found;
  if (/^https?:\/\//i.test(found)) return found;
  if (/^[A-Za-z0-9+/=]+$/.test(found) && found.length > 400) return `data:image/png;base64,${found}`;
  return "";
}

function findArkImageValue(value, seen) {
  if (!value) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (/^data:image\//i.test(text)) return text;
    if (/^https?:\/\/.+\.(png|jpg|jpeg|webp)(\?.*)?$/i.test(text)) return text;
    if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length > 400) return text;
    return "";
  }
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  const preferredKeys = ["image", "image_url", "url", "b64_json", "base64", "content", "result"];
  for (const key of preferredKeys) {
    if (key in value) {
      const found = findArkImageValue(value[key], seen);
      if (found) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArkImageValue(item, seen);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(value)) {
      const found = findArkImageValue(item, seen);
      if (found) return found;
    }
  }
  return "";
}

function compactArkResult(result) {
  if (!result || typeof result !== "object") return result || null;
  const id = result.id || result.task_id || result.taskId || result.data?.id || result.data?.task_id || result.data?.taskId;
  const status = result.status || result.task_status || result.data?.status || result.data?.task_status;
  return {
    id: id || null,
    status: status || null,
    raw: id || status ? undefined : result,
  };
}

function previewComposeProvider() {
  if (defaultArkEditModel && arkEditToken()) return "byteplus-ark-seededit";
  if (process.env.COZE_PREVIEW_ENDPOINT) return "coze";
  if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_PREVIEW_MODEL) return "replicate";
  return "local";
}

function arkEditToken() {
  return process.env.ARK_EDIT_API_KEY || process.env.ARK_API_KEY || "";
}

function fileToDataUrl(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function requestBytePlusArkPreviewCompose({ prompt, sourceImage, handImage, nailImages }) {
  const payload = {
    model: defaultArkEditModel,
    prompt: [
      prompt,
      "The input image is a rough local manicure preview with the five nail-art decals already placed on the hand.",
      "Refine this existing manicure preview image. Keep the current hand photo, nail positions, decals, pose, skin texture, lighting, and background.",
      "Only improve realism, nail-surface blending, perspective fit, and edges of the nail art decals.",
    ].join(" "),
    image: sourceImage,
    negative_prompt: process.env.ARK_EDIT_NEGATIVE_PROMPT || "deformed hands, extra fingers, distorted nails, blurry, watermark, text, broken skin texture, duplicated fingers",
    seed: Number(process.env.ARK_EDIT_SEED || -1),
    guidance_scale: clampNumber(process.env.ARK_EDIT_GUIDANCE_SCALE || 5.5, 1, 10),
    response_format: process.env.ARK_EDIT_RESPONSE_FORMAT || "url",
    size: process.env.ARK_EDIT_SIZE || "adaptive",
    watermark: String(process.env.ARK_EDIT_WATERMARK || "false").toLowerCase() === "true",
  };
  const response = await fetch(defaultArkEditEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${arkEditToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response, "BytePlus Ark SeedEdit preview request failed");
  const image = extractImageFromArkResponse(data);
  if (!image) throw new Error("BytePlus Ark SeedEdit did not return an image.");
  return image;
}

function seedEditImageInputs(images) {
  const image_urls = [];
  const binary_data_base64 = [];
  images.filter(Boolean).forEach((image) => {
    const text = String(image).trim();
    if (/^https?:\/\//i.test(text)) {
      image_urls.push(text);
      return;
    }
    const base64 = imageToBase64Payload(text);
    if (base64) {
      binary_data_base64.push(base64);
      return;
    }
    throw new Error("SeedEdit image input must be a public image URL or a base64 data URL.");
  });
  return { image_urls, binary_data_base64 };
}

function imageToBase64Payload(image) {
  const match = String(image || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (match) return match[2];
  if (/^[A-Za-z0-9+/=]+$/.test(String(image || "")) && String(image || "").length > 400) return String(image);
  return "";
}

function materializePublicImageUrl(image, prefix) {
  if (/^https?:\/\//i.test(image)) return image;
  const match = String(image || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) throw new Error("SeedEdit requires a public image URL or a base64 data URL.");
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!publicBaseUrl) {
    throw new Error("SeedEdit visual API requires image_urls with public access. Set PUBLIC_BASE_URL to this server's public URL, or use local canvas fallback.");
  }
  const extension = match[1].includes("jpeg") || match[1].includes("jpg") ? "jpg" : match[1].includes("webp") ? "webp" : "png";
  const dir = path.join(root, "generated");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  fs.writeFileSync(path.join(dir, fileName), Buffer.from(match[2], "base64"));
  return `${publicBaseUrl}/generated/${fileName}`;
}

function utcCompactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function requestCozePreviewCompose({ prompt, handImage, nailImages }) {
  const response = await fetch(process.env.COZE_PREVIEW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(process.env.COZE_API_TOKEN ? { Authorization: `Bearer ${process.env.COZE_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      prompt,
      handImage,
      hand_image: handImage,
      nailImages,
      nail_images: nailImages,
    }),
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!response.ok) {
    throw new Error(typeof data === "string" ? data : data.error?.message || data.message || `HTTP ${response.status}`);
  }
  const image = extractImageFromArkResponse(data);
  if (!image) throw new Error("Coze workflow did not return an image.");
  return image;
}

async function requestReplicatePreviewCompose({ prompt, handImage, nailImages }) {
  const model = process.env.REPLICATE_PREVIEW_MODEL;
  const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({
      input: {
        prompt,
        image: handImage,
        input_image: handImage,
        hand_image: handImage,
        reference_images: nailImages,
        nail_images: nailImages,
        num_outputs: 1,
      },
    }),
  });
  const prediction = await parseJsonResponse(response, "Replicate preview request failed");
  const completed = await waitForReplicatePrediction(prediction);
  const image = extractImageFromArkResponse(completed.output || completed);
  if (!image) throw new Error("Replicate prediction did not return an image.");
  return image;
}

async function waitForReplicatePrediction(prediction) {
  let current = prediction;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    if (current.status === "succeeded") return current;
    if (["failed", "canceled"].includes(current.status)) {
      throw new Error(current.error || `Replicate prediction ${current.status}.`);
    }
    const getUrl = current.urls?.get;
    if (!getUrl) return current;
    await delay(2500);
    const response = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    });
    current = await parseJsonResponse(response, "Replicate preview polling failed");
  }
  throw new Error("Replicate prediction timed out.");
}

async function parseJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!response.ok) {
    const details = extractProviderErrorDetails(data, response, fallbackMessage);
    const error = new Error(`${fallbackMessage}: ${details.message || details.rawText || `HTTP ${response.status}`}`.slice(0, 1200));
    error.providerDetails = details;
    error.status = response.status;
    error.statusText = response.statusText;
    throw error;
  }
  return data;
}

function extractProviderErrorDetails(data, response, fallbackMessage = "Provider request failed") {
  const object = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const rawText = typeof data === "string" ? data : "";
  const responseMetadata = object.ResponseMetadata || object.response_metadata || object.responseMetadata || {};
  const metadataError = responseMetadata.Error || responseMetadata.error || {};
  const nestedError = object.error && typeof object.error === "object" ? object.error : {};
  const header = (name) => {
    try {
      return response?.headers?.get?.(name) || "";
    } catch (_) {
      return "";
    }
  };
  const code = firstText(
    object.code,
    object.error_code,
    object.errorCode,
    nestedError.code,
    nestedError.error_code,
    metadataError.Code,
    metadataError.code,
    responseMetadata.ErrorCode,
    responseMetadata.error_code
  );
  const message = firstText(
    object.message,
    object.msg,
    object.detail,
    typeof object.error === "string" ? object.error : "",
    nestedError.message,
    nestedError.msg,
    nestedError.detail,
    metadataError.Message,
    metadataError.message,
    rawText
  );
  const requestId = firstText(
    object.request_id,
    object.requestId,
    object.req_id,
    object.reqId,
    object.trace_id,
    object.traceId,
    responseMetadata.RequestId,
    responseMetadata.RequestID,
    responseMetadata.request_id,
    header("x-request-id"),
    header("x-tt-logid"),
    header("x-volc-request-id"),
    header("x-ark-request-id")
  );
  const id = firstText(
    object.id,
    object.task_id,
    object.taskId,
    object.data?.id,
    object.data?.task_id,
    object.data?.taskId,
    requestId
  );
  return {
    status: response?.status || null,
    statusText: response?.statusText || "",
    code: code || null,
    message: message || fallbackMessage,
    requestId: requestId || null,
    id: id || null,
    rawText: rawText ? rawText.slice(0, 2000) : "",
    raw: rawText ? null : compactProviderRaw(object),
  };
}

function providerErrorPayload(error) {
  if (error?.providerDetails) return error.providerDetails;
  return {
    status: error?.status || null,
    statusText: error?.statusText || "",
    code: error?.cause?.code || error?.code || null,
    message: networkErrorMessage(error),
    requestId: error?.requestId || null,
    id: error?.id || error?.requestId || null,
    rawText: "",
    raw: null,
  };
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function compactProviderRaw(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= 4000) return JSON.parse(text);
    return {
      truncated: true,
      preview: text.slice(0, 4000),
    };
  } catch (_) {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestHuggingFace(endpoint, token, promptSpec) {
  try {
    return await requestHuggingFaceWithFetch(endpoint.url, token, promptSpec, "huggingface");
  } catch (error) {
    console.warn(`[ai-generate] ${endpoint.label} fetch failed: ${networkErrorMessage(error)}. Trying Windows fallback...`);
    try {
      const fallback = await requestHuggingFaceWithPowerShell(endpoint.url, token, promptSpec);
      return { ...fallback, provider: "huggingface-powershell" };
    } catch (fallbackError) {
      throw new Error(`fetch failed: ${networkErrorMessage(error)}; Windows fallback failed: ${networkErrorMessage(fallbackError)}`);
    }
  }
}

async function requestHuggingFaceWithFetch(endpoint, token, promptSpec, provider) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify(huggingFacePayload(promptSpec)),
  });
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!response.ok) {
    throw new Error(responseErrorDetail(buffer) || `HTTP ${response.status}`);
  }
  if (!contentType.startsWith("image/")) {
    throw new Error(buffer.toString("utf8") || "Hugging Face did not return an image.");
  }
  return { provider, contentType, buffer };
}

function huggingFacePayload(promptSpec) {
  const spec = typeof promptSpec === "string" ? { prompt: promptSpec } : promptSpec;
  const parameters = {
    num_inference_steps: Number(spec.steps ?? process.env.HF_STEPS ?? 4),
    guidance_scale: Number(spec.guidance ?? process.env.HF_GUIDANCE ?? 0),
    width: Number(spec.width || process.env.HF_WIDTH || 768),
    height: Number(spec.height || process.env.HF_HEIGHT || 1024),
  };
  if (spec.negativePrompt) parameters.negative_prompt = spec.negativePrompt;
  return {
    inputs: spec.prompt || "",
    parameters,
    options: { wait_for_model: true },
  };
}

function responseErrorDetail(buffer) {
  let detail = buffer.toString("utf8");
  try {
    const parsed = JSON.parse(detail);
    detail = parsed.error || parsed.message || detail;
  } catch (_) {}
  return detail;
}

function requestHuggingFaceWithPowerShell(endpoint, token, promptSpec) {
  return new Promise((resolve, reject) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nail-ai-"));
    const bodyPath = path.join(tempRoot, "request.json");
    const outPath = path.join(tempRoot, "result.png");
    fs.writeFileSync(bodyPath, JSON.stringify(huggingFacePayload(promptSpec)));

    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$headers = @{ Authorization = \"Bearer $env:HF_TOKEN\"; Accept = 'image/png' }",
      `$body = Get-Content -Raw -LiteralPath '${escapePowerShellPath(bodyPath)}'`,
      `Invoke-WebRequest -Uri '${endpoint.replace(/'/g, "''")}' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -OutFile '${escapePowerShellPath(outPath)}'`,
      `Write-Output '${escapePowerShellPath(outPath)}'`,
    ].join("; ");

    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      env: { ...process.env, HF_TOKEN: token },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with ${code}`));
        return;
      }
      try {
        const buffer = fs.readFileSync(outPath);
        resolve({ buffer, contentType: "image/png" });
      } catch (error) {
        reject(error);
      } finally {
        fs.rm(tempRoot, { recursive: true, force: true }, () => {});
      }
    });
  });
}

function networkErrorMessage(error) {
  const message = error?.cause?.message || error?.message || String(error);
  const code = error?.cause?.code || error?.code;
  return code ? `${message} (${code})` : message;
}

function requestErrorContext(req, url) {
  const pathName = url?.pathname || req?.url || "/";
  const method = req?.method || "REQUEST";
  const parts = pathName.split("/").filter(Boolean);
  let module = parts[1] || parts[0] || "static";
  if (parts[0] === "api") module = parts[1] || "api";
  return {
    program: "server.js",
    module,
    operation: `${method} ${pathName}`,
    path: pathName,
  };
}

function errorDiagnostic(error, status, context = {}) {
  const requestId = crypto.randomUUID();
  const message = networkErrorMessage(error) || "Server error";
  const diagnostic = {
    requestId,
    program: context.program || "server.js",
    module: context.module || "unknown",
    operation: context.operation || "unknown operation",
    status,
    error: message,
  };
  const code = error?.code || error?.cause?.code;
  if (code) diagnostic.code = code;
  if (error?.severity) diagnostic.severity = error.severity;
  if (error?.table) diagnostic.table = error.table;
  if (error?.column) diagnostic.column = error.column;
  if (error?.constraint) diagnostic.constraint = error.constraint;
  if (error?.detail) diagnostic.detail = error.detail;
  if (error?.hint) diagnostic.hint = error.hint;
  return diagnostic;
}

function logErrorDiagnostic(diagnostic, payload = {}) {
  const base = `[${diagnostic.requestId}] ${diagnostic.program} ${diagnostic.operation} -> ${diagnostic.status}: ${diagnostic.error}`;
  const details = {
    module: diagnostic.module,
    code: diagnostic.code,
    table: diagnostic.table,
    column: diagnostic.column,
    constraint: diagnostic.constraint,
    detail: diagnostic.detail,
    hint: diagnostic.hint,
    payloadError: payload?.error,
    payloadReason: payload?.reason,
  };
  console.error(base, details);
}

function normalizeErrorPayload(res, status, payload) {
  if (!payload || typeof payload !== "object") return payload;
  const shouldDiagnose = status >= 400 || payload.ok === false;
  if (!shouldDiagnose || payload.diagnostic) return payload;
  const context = res?.errorContext || {};
  const message = payload.error || payload.reason || payload.message || `Request failed with status ${status}`;
  const error = new Error(String(message));
  if (payload.code) error.code = payload.code;
  if (payload.errorDetails && typeof payload.errorDetails === "object") {
    error.code = error.code || payload.errorDetails.code;
    error.detail = payload.errorDetails.detail || payload.errorDetails.message;
  }
  const diagnostic = errorDiagnostic(error, status, context);
  logErrorDiagnostic(diagnostic, payload);
  return {
    ok: payload.ok === undefined ? false : payload.ok,
    ...payload,
    error: payload.error || diagnostic.error,
    diagnostic,
  };
}

function sendError(res, status, error, context = {}, extra = {}, headers = {}) {
  const diagnostic = errorDiagnostic(error, status, { ...(res?.errorContext || {}), ...context });
  logErrorDiagnostic(diagnostic, extra);
  sendJson(res, status, {
    ok: false,
    error: diagnostic.error,
    ...extra,
    diagnostic,
  }, headers);
}

function escapePowerShellPath(filePath) {
  return filePath.replace(/'/g, "''");
}

function buildPrompt(prompt, flow, references = [], outputMode = "design", target = null) {
  const isPreview = outputMode === "preview";
  if (isPreview) {
    return {
      prompt: [
        "Create a simple realistic hand mockup preview.",
        "Show one front-facing open palm with five fingernails visible.",
        `Apply the same nail art theme from this design request: ${prompt}`,
        "The hand pose must be simple, palm open, front view, clean plain background, elegant beauty-tech presentation.",
        "No complex pose, no bottle, no tools, no table, no text, no logo.",
      ].join(" "),
      negativePrompt: [
        "complex pose",
        "side angle",
        "closed fist",
        "holding object",
        "bottle",
        "tools",
        "table",
        "room",
        "busy background",
        "text",
        "watermark",
        "logo",
        "extra fingers",
        "deformed fingers",
      ].join(", "),
      width: Number(process.env.ARK_PREVIEW_WIDTH || 2048),
      height: Number(process.env.ARK_PREVIEW_HEIGHT || 2048),
      steps: Number(process.env.HF_PREVIEW_STEPS || process.env.HF_STEPS || 4),
      guidance: Number(process.env.ARK_PREVIEW_GUIDANCE || process.env.ARK_GUIDANCE_SCALE || 2.5),
    };
  }
  const nailName = target?.nail || "one fingernail";
  const referenceHint = references.length
    ? "Use the provided nail-shape reference conceptually: artwork constrained inside the nail area."
    : "Use a transparent background nail-shaped printable canvas as the default base reference.";
  return {
    prompt: [
      `Create only the decorative artwork pattern that will be printed on the ${nailName}.`,
      `Design request: ${prompt}`,
      "Use the reference/example only for output format: a flat printable nail decal sheet with decorative elements arranged vertically and enough blank space through the middle for nail printing.",
      "Do not copy the reference/example motif. Freely design a new pattern based on the user's request, only preserving the print-template layout style.",
      "The example may have a white page, but the final output must replace every white/page area with transparency.",
      "Absolute output rule: transparent background only. The image must contain only the nail art decal/pattern pixels.",
      "Do not draw the fingernail itself. Do not draw a nail plate, nail tip, nail silhouette, nail outline, hand, finger, skin, product photo, background, shadow, paper, canvas, frame, label, text, logo, or watermark.",
      "The artwork should be a flat 2D print-ready decal layer that can be composited onto a separate nail photo. Keep the pattern centered, vertically aligned, mirror-balanced when appropriate, and safely inside the transparent canvas.",
      "Prefer clean vector-like edges, ornamental line art, small floral/petal accents, soft pink and black details, with no photographic lighting.",
      referenceHint,
      "Style: elegant futuristic AI manicure, soft pink beauty-tech style, clean high-resolution printable artwork.",
    ].join(" "),
    negativePrompt: [
      "background",
      "white background",
      "solid background",
      "colored background",
      "hands",
      "fingers",
      "skin",
      "person",
      "model",
      "human hand",
      "fingernail",
      "nail plate",
      "nail tip",
      "nail body",
      "nail silhouette",
      "nail outline",
      "blank nail",
      "lifestyle photo",
      "product photo",
      "bottle",
      "brush",
      "tools",
      "table",
      "room",
      "background scene",
      "shadow",
      "drop shadow",
      "reflection",
      "text",
      "watermark",
      "logo",
      "multiple nails",
      "nail set",
      "five nails in one image",
    ].join(", "),
    width: Number(process.env.ARK_DESIGN_WIDTH || 1536),
    height: Number(process.env.ARK_DESIGN_HEIGHT || 2560),
    steps: Number(process.env.HF_DESIGN_STEPS || process.env.HF_STEPS || 4),
    guidance: Number(process.env.ARK_DESIGN_GUIDANCE || process.env.ARK_GUIDANCE_SCALE || 2.5),
  };
}

function makeSampleImage(prompt, flow) {
  const title = flow === "asset" ? "AI Asset Sample" : flow === "preview" ? "AI Hand Preview Sample" : "AI Nail Sample";
  const safePrompt = escapeXml(prompt).slice(0, 90);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffe4ef"/>
          <stop offset="0.52" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#a6fff1"/>
        </linearGradient>
        <radialGradient id="shine" cx="48%" cy="18%" r="30%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="768" height="1024" fill="#fff8fb"/>
      <path d="M228 162 C238 80 536 80 546 162 C574 404 560 760 384 900 C208 760 200 404 228 162Z" fill="url(#bg)" stroke="#df5e93" stroke-width="8"/>
      <path d="M264 210 C296 144 474 138 510 210 C482 186 310 186 264 210Z" fill="url(#shine)"/>
      <path d="M282 592 C372 508 390 402 496 340" fill="none" stroke="#df5e93" stroke-width="18" stroke-linecap="round" opacity="0.72"/>
      <path d="M284 622 C386 568 438 488 548 466" fill="none" stroke="#8c7cff" stroke-width="10" stroke-linecap="round" opacity="0.64"/>
      <circle cx="292" cy="402" r="20" fill="#85e6d5"/>
      <circle cx="520" cy="574" r="16" fill="#ffd447"/>
      <text x="384" y="118" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="#2d2330">${title}</text>
      <text x="384" y="956" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#6d5c70">${safePrompt}</text>
    </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function serveStatic(requestPath, res, headOnly) {
  const cleanPath = decodeURIComponent(requestPath.split("?")[0]);
  const routePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^[/\\]+/, "");
  const normalized = path.normalize(routePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(root, normalized);
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    if (headOnly) res.end();
    else res.end(data);
  });
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf("=");
      const key = index >= 0 ? item.slice(0, index) : item;
      const value = index >= 0 ? item.slice(index + 1) : "";
      return [key, decodeURIComponent(value)];
    }));
}

/*
function adminSessionToken(req) {
  return parseCookies(req)[adminCookieName] || "";
}

async function getAdminSession(req) {
  return runPythonJsonScript(path.join(root, "database", "admin_auth.py"), {
    action: "session",
    token: adminSessionToken(req),
  });
}

function isAdminProtectedRequest(url) {
  if (url.pathname === "/admin.html") return true;
  if (!url.pathname.startsWith("/api/admin/")) return false;
  return ![
    "/api/admin/login",
    "/api/admin/logout",
    "/api/admin/session",
    "/api/admin/create-account",
    "/api/admin/product-image",
  ].includes(url.pathname);
}

async function rejectUnauthenticatedAdminRequest(req, res, url) {
  if (!isAdminProtectedRequest(url)) return false;
  const result = await getAdminSession(req);
  if (result.ok) return false;
  if (url.pathname === "/admin.html") {
    res.writeHead(302, {
      Location: `/admin-login.html?return=${encodeURIComponent(url.pathname)}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }
  sendJson(res, 401, { ok: false, error: "Admin login required." }, { "Cache-Control": "no-store" });
  return true;
}
*/

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxJsonBodyBytes) {
        tooLarge = true;
        raw = "";
        return;
      }
      if (!tooLarge) raw += chunk;
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Request body is too large. The current upload limit is 256MB.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function runPythonJsonScript(scriptPath, payload) {
  return new Promise((resolve, reject) => {
    const pythonCandidates = [
      process.env.PYTHON_EXE,
      process.env.PYTHON_BIN,
      fs.existsSync(bundledPython) ? bundledPython : "",
      "python3",
      "python",
      "py",
    ].filter(Boolean);
    let lastError = null;
    let index = 0;
    const trySpawn = () => {
      if (index >= pythonCandidates.length) {
        reject(new Error(`Python runtime not found. Tried: ${pythonCandidates.join(", ")}${lastError ? `. Last error: ${lastError.message}` : ""}`));
        return;
      }
      const python = pythonCandidates[index++];
      const child = spawn(python, [scriptPath], {
        cwd: root,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        if (error.code === "ENOENT") {
          lastError = error;
          trySpawn();
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `${python} exited with ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout || "{}"));
        } catch (error) {
          reject(new Error(`Invalid Python JSON response: ${stdout.slice(0, 500)}`));
        }
      });
      child.stdin.end(JSON.stringify(payload || {}));
    };
    trySpawn();
  });
}

function sendJson(res, status, payload, headers = {}) {
  const body = normalizeErrorPayload(res, status, payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) process.env[key] = value;
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
