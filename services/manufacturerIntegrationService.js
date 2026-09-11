const crypto = require("node:crypto");

function clean(value) {
  return String(value ?? "").trim();
}

function tokenOk(req, expected) {
  const header = clean(req.headers.authorization).replace(/^Bearer\s+/i, "");
  if (!expected || !header) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function jsonPreview(value) {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return "";
  }
}

function useStatus(value) {
  const text = clean(value).toLowerCase();
  if (["active", "used", "已使用", "success"].includes(text)) return "active";
  if (["inactive", "unused", "未使用", "pending"].includes(text)) return "inactive";
  throw new Error("Invalid use status");
}

function syncStatus(value) {
  const text = clean(value).toLowerCase();
  if (["success", "succeeded", "ok", "active", "activated", "已激活", "成功"].includes(text)) return "success";
  if (["fail", "failed", "error", "失败"].includes(text)) return "fail";
  if (["pending", "waiting", "处理中"].includes(text)) return "pending";
  throw new Error("Invalid sync status");
}

function splitDeviceIds(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean);
  return String(value || "").split(/[，,;；\s]+/).map((item) => clean(item)).filter(Boolean);
}

function firstDevice(...values) {
  for (const value of values) {
    const ids = splitDeviceIds(value);
    if (ids.length) return ids[0];
  }
  return "";
}

function sixDigit(value, label = "code") {
  const code = clean(value);
  if (!/^\d{6}$/.test(code)) throw new Error(`Invalid ${label}`);
  return code;
}

function createManufacturerIntegrationService({ pool, codes, env = process.env, fetchImpl = globalThis.fetch }) {
  async function postJson(endpoint, payload) {
    if (!endpoint) return { status: "not_configured", response: "", error: "" };
    try {
      const headers = { "Content-Type": "application/json" };
      const token = clean(env.MANUFACTURER_API_TOKEN);
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await response.text();
      if (!response.ok) return { status: "failed", response: text.slice(0, 4000), error: `HTTP ${response.status}` };
      return { status: "synced", response: text.slice(0, 4000), error: "" };
    } catch (error) {
      return { status: "failed", response: "", error: error.message || "Manufacturer API request failed." };
    }
  }

  async function orderPayload(client, orderId, pickupCodeRecord, bodyItems = []) {
    const order = (await client.query("SELECT * FROM orders WHERE order_id=$1", [orderId])).rows[0];
    if (!order) throw new Error("Order not found");
    const items = (await client.query(`
      SELECT i.order_item_id,i.product_id,i.quantity,i.unit_price,i.size,i.item_snapshot,
             p.product_name,p.product_type,p.bound_device_id,p.bound_device_ids,p.device_channel_code,p.pickup_method,
             p.manufacturer_channel,p.manufacturer_slot,p.manufacturer_sku
      FROM order_items i
      LEFT JOIN products p ON p.product_id=i.product_id
      WHERE i.order_id=$1
      ORDER BY i.order_item_id
    `, [orderId])).rows.map((item) => {
      let snapshot = {};
      try { snapshot = typeof item.item_snapshot === "string" ? JSON.parse(item.item_snapshot) : item.item_snapshot || {}; } catch {}
      const source = bodyItems.find((bodyItem) => String(bodyItem.id) === String(item.product_id)) || {};
      return {
        orderItemId: item.order_item_id,
        productId: item.product_id,
        productName: item.product_name || snapshot.product_name || source.name || "",
        productType: item.product_type || "",
        quantity: Number(item.quantity || 0),
        size: item.size || source.size || "",
        unitPrice: Number(item.unit_price || 0),
        boundDeviceId: firstDevice(source.pickupDeviceId, source.boundDeviceId, source.boundDeviceIds, item.bound_device_ids, item.bound_device_id, order.bound_device_id),
        boundDeviceIds: [...new Set([...splitDeviceIds(source.boundDeviceIds || source.bound_device_ids), ...splitDeviceIds(source.pickupDeviceId || source.boundDeviceId), ...splitDeviceIds(item.bound_device_ids || item.bound_device_id)])],
        deviceChannelCode: clean(source.deviceChannelCode || source.device_channel_code || item.device_channel_code),
        pickupMethod: item.pickup_method || snapshot.pickup_method || "",
        channel: clean(source.channel || source.manufacturer_channel || item.manufacturer_channel),
        slot: clean(source.slot || source.manufacturer_slot || item.manufacturer_slot),
        manufacturerSku: clean(source.manufacturerSku || source.manufacturer_sku || item.manufacturer_sku),
      };
    });
    return {
      orderId,
      pickupCode: pickupCodeRecord?.code || order.pickup_code || "",
      pickupCodeId: pickupCodeRecord?.id || null,
      boundDeviceId: order.bound_device_id || "",
      paidAt: order.paid_at || "",
      getType: order.order_get_type || "",
      items,
    };
  }

  async function pushOrder(orderId, pickupCodeRecord, bodyItems = []) {
    const client = await pool.connect();
    try {
      const payload = await orderPayload(client, orderId, pickupCodeRecord, bodyItems);
      return { ...await postJson(clean(env.MANUFACTURER_PICKUP_CODE_API_URL || env.MANUFACTURER_ORDER_API_URL), payload), payload };
    } finally {
      client.release();
    }
  }

  async function confirmActivation(input) {
    const orderId = clean(input.orderId || input.order_id);
    const pickupCode = sixDigit(input.pickupCode || input.pickup_code || input.code, "pickupCode");
    const status = syncStatus(input.syncStatus || input.sync_status || input.status);
    const printCodes = Array.isArray(input.printCodes || input.print_codes) ? input.printCodes || input.print_codes : [];
    return codes.transaction(async (client) => {
      const pickup = (await client.query('UPDATE "pickup-code" SET sync_status=$1,manufacturer_activation_payload=$2,confirm_version=confirm_version+1,updated_at=now() WHERE order_id=$3 AND code=$4 RETURNING *', [status, jsonPreview(input), orderId, pickupCode])).rows[0];
      if (!pickup) throw new Error("Pickup code not found");
      const savedPrintCodes = [];
      for (const item of printCodes) {
        const code = sixDigit(typeof item === "string" ? item : item.code || item.printCode || item.print_code, "printCode");
        await client.query("INSERT INTO order_code_registry(code) VALUES ($1) ON CONFLICT DO NOTHING", [code]);
        const row = (await client.query(`
          INSERT INTO "print-code"(code,order_id,product_id,order_item_id,unit_number,sync_status,use_status,print_use_status,code_origin,manufacturer_activation_payload)
          VALUES($1,$2,$3,$4,$5,$6,'inactive','unused','manufacturer',$7)
          ON CONFLICT(code) DO UPDATE SET
            order_id=EXCLUDED.order_id,
            product_id=COALESCE(EXCLUDED.product_id,"print-code".product_id),
            order_item_id=COALESCE(EXCLUDED.order_item_id,"print-code".order_item_id),
            unit_number=COALESCE(EXCLUDED.unit_number,"print-code".unit_number),
            sync_status=EXCLUDED.sync_status,
            manufacturer_activation_payload=EXCLUDED.manufacturer_activation_payload,
            updated_at=now()
          RETURNING *
        `, [code, orderId, clean(item.productId || item.product_id) || null, clean(item.orderItemId || item.order_item_id) || null, Number(item.unitNumber || item.unit_number) || null, status, jsonPreview(item)])).rows[0];
        savedPrintCodes.push(row);
      }
      await client.query(`UPDATE orders SET print_code=(SELECT code FROM "print-code" WHERE order_id=$1 ORDER BY id LIMIT 1), manufacturer_sync_status=$2, manufacturer_response=$3 WHERE order_id=$1`, [orderId, status === "success" ? "synced" : status, jsonPreview(input)]);
      return { ok: true, pickupCode: pickup, printCodes: savedPrintCodes };
    });
  }

  async function confirmPrintUsage(input) {
    const code = sixDigit(input.printCode || input.print_code || input.code, "printCode");
    const status = useStatus(input.useStatus || input.use_status || input.status);
    const row = (await pool.query(`
      UPDATE "print-code"
      SET use_status=$1,print_use_status=$2,manufacturer_last_used_at=CASE WHEN $1='active' THEN now() ELSE manufacturer_last_used_at END,manufacturer_activation_payload=$3,confirm_version=confirm_version+1,updated_at=now()
      WHERE code=$4
      RETURNING *
    `, [status, status === "active" ? "used" : "unused", jsonPreview(input), code])).rows[0];
    if (!row) throw new Error("Print code not found");
    return { ok: true, printCode: row };
  }

  async function queryStock(input = {}) {
    const productId = clean(input.productId || input.product_id);
    if (!productId) throw new Error("productId is required");
    const product = (await pool.query("SELECT product_id,product_name,bound_device_id,bound_device_ids,device_channel_code,manufacturer_channel,manufacturer_slot,manufacturer_sku FROM products WHERE product_id=$1", [productId])).rows[0];
    if (!product) throw new Error("Product not found");
    const basePayload = {
      orderId: clean(input.orderId || input.order_id),
      productId,
      productName: product.product_name || "",
      channel: clean(input.channel || product.manufacturer_channel),
      slot: clean(input.slot || product.manufacturer_slot),
      deviceChannelCode: clean(input.deviceChannelCode || input.device_channel_code || product.device_channel_code),
      manufacturerSku: clean(input.manufacturerSku || product.manufacturer_sku),
    };
    const deviceIds = [...new Set([...splitDeviceIds(input.boundDeviceIds || input.bound_device_ids), ...splitDeviceIds(input.boundDeviceId || input.bound_device_id), ...splitDeviceIds(product.bound_device_ids || product.bound_device_id)])];
    const targets = deviceIds.length ? deviceIds : [""];
    const stocksByDevice = [];
    for (const deviceId of targets) {
      const payload = { ...basePayload, boundDeviceId: deviceId, boundDeviceIds: deviceIds };
      const sync = await postJson(clean(env.MANUFACTURER_STOCK_API_URL), payload);
      let stock = null;
      try {
        const body = JSON.parse(sync.response || "{}");
        stock = Number(body.stock ?? body.quantity ?? body.inventory);
        if (!Number.isFinite(stock)) stock = null;
      } catch {}
      stocksByDevice.push({ ok: sync.status !== "failed", ...sync, stock, boundDeviceId: deviceId, payload });
    }
    const quantities = stocksByDevice.map((item) => item.stock).filter((value) => value !== null);
    const quantity = quantities.length ? quantities.reduce((sum, value) => sum + value, 0) : null;
    if (quantity !== null) {
      await pool.query("UPDATE products SET manufacturer_stock_quantity=$1,manufacturer_stock_payload=$2,manufacturer_stock_checked_at=now() WHERE product_id=$3", [Math.max(0, Math.floor(quantity)), JSON.stringify(stocksByDevice).slice(0, 4000), productId]);
    }
    return { ok: stocksByDevice.some((item) => item.ok), status: stocksByDevice.some((item) => item.status === "failed") ? "partial" : "synced", error: stocksByDevice.find((item) => item.error)?.error || "", response: JSON.stringify(stocksByDevice).slice(0, 4000), stock: quantity, stocksByDevice, productId, payload: { ...basePayload, boundDeviceIds: deviceIds } };
  }

  async function queryOrderStocks(orderId) {
    const id = clean(orderId);
    if (!id) throw new Error("orderId is required");
    const rows = (await pool.query(`
      SELECT i.order_item_id,i.product_id,i.quantity,p.product_name,p.bound_device_id,p.bound_device_ids,p.device_channel_code,p.manufacturer_channel,p.manufacturer_slot,p.manufacturer_sku
      FROM order_items i
      LEFT JOIN products p ON p.product_id=i.product_id
      WHERE i.order_id=$1
      ORDER BY i.order_item_id
    `, [id])).rows;
    const results = [];
    for (const row of rows) {
      results.push(await queryStock({
        orderId: id,
        productId: row.product_id,
        boundDeviceIds: row.bound_device_ids || row.bound_device_id,
        deviceChannelCode: row.device_channel_code,
        channel: row.manufacturer_channel,
        slot: row.manufacturer_slot,
        manufacturerSku: row.manufacturer_sku,
      }).then((result) => ({ ...result, orderItemId: row.order_item_id, productName: row.product_name, quantity: Number(row.quantity || 0) })).catch((error) => ({ ok: false, productId: row.product_id, orderItemId: row.order_item_id, productName: row.product_name, status: "failed", error: error.message })));
    }
    return { ok: true, orderId: id, results };
  }

  async function queryAllProductStocks() {
    const rows = (await pool.query("SELECT product_id FROM products WHERE status='active' ORDER BY product_id")).rows;
    const results = [];
    for (const row of rows) results.push(await queryStock({ productId: row.product_id }).catch((error) => ({ ok: false, productId: row.product_id, status: "failed", error: error.message })));
    return { ok: true, results };
  }

  return { tokenOk, pushOrder, confirmActivation, confirmPrintUsage, queryStock, queryOrderStocks, queryAllProductStocks };
}

module.exports = { createManufacturerIntegrationService };
