const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { createSquarePaymentService } = require("./services/squarePaymentService");

const root = path.resolve(__dirname || process.cwd());
loadEnvFile(path.join(root, ".env"));
const bundledPython = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");

const port = Number(process.env.PORT || 4174);
const squarePaymentService = createSquarePaymentService({ env: process.env });
const defaultModel = process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
const defaultArkModel = process.env.ARK_IMAGE_MODEL || "seedream-4-5-251128";
const defaultArkEndpoint = process.env.ARK_IMAGE_ENDPOINT || "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
const defaultArkEditModel = process.env.ARK_EDIT_MODEL || "doubao-seededit-3-0-i2i-25062";
const defaultArkEditBaseUrl = process.env.ARK_EDIT_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const defaultArkEditEndpoint = process.env.ARK_EDIT_ENDPOINT || `${defaultArkEditBaseUrl.replace(/\/+$/, "")}/images/generations`;
const maxJsonBodyBytes = 256 * 1024 * 1024;
const adminCookieName = "nail_admin_session";

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
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
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
    // Temporarily bypass admin auth while checking Railway/admin routing.
    // Restore this guard before production admin access is opened.
    // if (await rejectUnauthenticatedAdminRequest(req, res, url)) {
    //   return;
    // }
    if (req.method === "POST" && url.pathname === "/api/admin/create-account") {
      await handleAdminCreateAccount(req, res);
      return;
    }
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
    sendJson(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
});

const nailGenerationTargets = [
  { step: "step2-1", nail: "thumb", label: "Thumb" },
  { step: "step2-2", nail: "index finger", label: "Index" },
  { step: "step2-3", nail: "middle finger", label: "Middle" },
  { step: "step2-4", nail: "ring finger", label: "Ring" },
  { step: "step2-5", nail: "pinky finger", label: "Pinky" },
];

server.listen(port, "0.0.0.0", () => {
  console.log(`AI Nail Studio server running at http://127.0.0.1:${port}/`);
  console.log(`AI image model: ${process.env.HF_IMAGE_MODEL || defaultModel}`);
  console.log(`Ark image model: ${process.env.ARK_IMAGE_MODEL || defaultArkModel}`);
});

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
  sendJson(res, result.httpStatus, result.body);
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
    const result = await runPythonJsonScript(path.join(root, "database", "community_template_insert.py"), body);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to save community template." });
  }
}

async function handleUserSession(req, res) {
  const body = await readJson(req);
  try {
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

async function handleUserUpdateContact(req, res) {
  const body = await readJson(req);
  try {
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
    const result = await runPythonJsonScript(path.join(root, "database", "admin_product_import.py"), { ...body, itemType });
    sendJson(res, 200, result);
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
    const result = await runPythonJsonScript(path.join(root, "database", "admin_taxonomy.py"), { ...body, action });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to manage taxonomy data." });
  }
}

async function handleAdminModels(req, res) {
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "admin_models.py"), {});
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load admin models." });
  }
}

async function handleAdminProductImage(req, res, url) {
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "admin_media.py"), {
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
    const result = await runPythonJsonScript(path.join(root, "database", "admin_record_manage.py"), { ...body, action });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to update admin record." });
  }
}

async function handleGalleryTaxonomy(req, res) {
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "gallery_taxonomy.py"), {});
    sendJson(res, 200, result, { "Cache-Control": "no-store" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load gallery taxonomy data." }, { "Cache-Control": "no-store" });
  }
}

async function handlePublicCatalog(req, res) {
  try {
    const result = await runPythonJsonScript(path.join(root, "database", "public_catalog.py"), {});
    sendJson(res, 200, result, { "Cache-Control": "no-store" });
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
    const python = process.env.PYTHON_EXE || (fs.existsSync(bundledPython) ? bundledPython : "python");
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Python script exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(new Error(`Invalid Python JSON response: ${stdout.slice(0, 500)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
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
