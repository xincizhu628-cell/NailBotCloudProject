const DEFAULT_SQUARE_VERSION = "2026-05-20";

function createSquarePaymentService(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;

  function config() {
    const environment = normalizeEnvironment(env.SQUARE_ENV);
    const apiBase = environment === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";
    const sdkUrl = environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";

    return {
      provider: "square",
      environment,
      apiBase,
      sdkUrl,
      applicationId: stringValue(env.SQUARE_APP_ID),
      locationId: stringValue(env.SQUARE_LOCATION_ID),
      accessToken: stringValue(env.SQUARE_ACCESS_TOKEN),
      version: stringValue(env.SQUARE_VERSION) || DEFAULT_SQUARE_VERSION,
      currency: stringValue(env.SQUARE_CURRENCY).toUpperCase() || "AUD",
      country: stringValue(env.SQUARE_COUNTRY).toUpperCase() || "AU",
    };
  }

  function hasConfig() {
    const square = config();
    return Boolean(square.applicationId && square.locationId && square.accessToken);
  }

  function browserConfig() {
    const square = config();
    const enabled = hasConfig();
    return {
      ok: true,
      provider: "square",
      environment: square.environment,
      applicationId: square.applicationId,
      locationId: square.locationId,
      currency: square.currency,
      country: square.country,
      enabled,
      demoMode: !enabled,
      sdkUrl: square.sdkUrl,
    };
  }

  async function createPayment(input = {}) {
    const square = config();
    const amount = Number(input.amount);
    const currency = stringValue(input.currency || square.currency).toUpperCase();
    const sourceId = stringValue(input.sourceId);
    const note = stringValue(input.note) || "AI Nail Studio test checkout";
    const idempotencyKey = stringValue(input.idempotencyKey) || randomId();
    const orderSummary = Array.isArray(input.items) ? input.items.slice(0, 25) : [];
    const buyer = input.buyer && typeof input.buyer === "object" ? input.buyer : {};

    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        httpStatus: 400,
        body: { ok: false, error: "A valid amount is required." },
      };
    }

    if (!hasConfig()) {
      return {
        httpStatus: 200,
        body: {
          ok: true,
          provider: "square",
          demo: true,
          paymentId: `demo_${Date.now()}`,
          status: "COMPLETED",
          amount,
          currency,
          message: "Square is not configured yet. Returned a local demo payment success so the checkout UI can still be tested.",
        },
      };
    }

    if (!sourceId) {
      return {
        httpStatus: 400,
        body: { ok: false, error: "sourceId is required." },
      };
    }

    const payload = {
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      location_id: square.locationId,
      autocomplete: true,
      amount_money: {
        amount: Math.round(amount * 100),
        currency,
      },
      note,
    };

    const buyerEmail = stringValue(buyer.email);
    if (buyerEmail) payload.buyer_email_address = buyerEmail;

    const givenName = stringValue(buyer.givenName);
    const familyName = stringValue(buyer.familyName);
    if (givenName || familyName) {
      payload.billing_address = {
        first_name: givenName,
        last_name: familyName,
        address_line_1: stringValue(buyer.address1),
        address_line_2: stringValue(buyer.address2),
        locality: stringValue(buyer.city),
        administrative_district_level_1: stringValue(buyer.state),
        postal_code: stringValue(buyer.postalCode),
        country: square.country,
      };
    }

    if (orderSummary.length) {
      payload.reference_id = orderSummary
        .map((item) => `${item.id || "item"}x${item.qty || 1}`)
        .join(",")
        .slice(0, 40);
    }

    if (typeof fetchImpl !== "function") {
      return {
        httpStatus: 500,
        body: {
          ok: false,
          provider: "square",
          error: "Fetch is not available in this Node runtime.",
        },
      };
    }

    let response;
    let rawText = "";
    try {
      response = await fetchImpl(`${square.apiBase}/v2/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${square.accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": square.version,
        },
        body: JSON.stringify(payload),
      });
      rawText = await response.text();
    } catch (error) {
      return {
        httpStatus: 502,
        body: {
          ok: false,
          error: `Square request failed: ${error.message || "network error"}`,
          provider: "square",
        },
      };
    }

    const parsed = parseJsonOrRaw(rawText);
    if (!response.ok) {
      const failure = formatSquareFailure(parsed, response.status);
      return {
        httpStatus: response.status,
        body: {
          ok: false,
          error: "Payment failed.",
          message: failure.message,
          failureReason: failure.reason,
          provider: "square",
          status: response.status,
          errors: failure.errors,
          details: parsed.errors || parsed,
        },
      };
    }

    const payment = parsed.payment || {};
    return {
      httpStatus: 200,
      body: {
        ok: true,
        provider: "square",
        paymentId: payment.id || "",
        status: payment.status || "COMPLETED",
        receiptUrl: payment.receipt_url || "",
        amount,
        currency,
        payment,
      },
    };
  }

  return {
    browserConfig,
    config,
    createPayment,
    hasConfig,
  };
}

function normalizeEnvironment(value) {
  return stringValue(value).toLowerCase() === "production" ? "production" : "sandbox";
}

function stringValue(value) {
  return String(value || "").trim();
}

function parseJsonOrRaw(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function formatSquareFailure(parsed, status) {
  const sourceErrors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  const errors = sourceErrors.map((item) => ({
    category: stringValue(item.category),
    code: stringValue(item.code),
    detail: stringValue(item.detail || item.message),
    field: stringValue(item.field),
  }));
  const details = errors
    .map((item) => [item.code, item.detail].filter(Boolean).join(": "))
    .filter(Boolean);
  const fallback = stringValue(parsed?.error || parsed?.message || parsed?.raw);
  const reason = details.join(" | ") || fallback || `Square returned HTTP ${status}.`;
  return {
    reason,
    message: `Payment failed: ${reason}`,
    errors,
  };
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  createSquarePaymentService,
};
