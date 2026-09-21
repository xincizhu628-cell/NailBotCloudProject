(() => {
  const panel = document.querySelector("#admin-coupons");
  if (!panel) return;

  const labels = { money_off: "满减优惠", percent_off: "折扣优惠", buy_x_get_y: "买送优惠", free_product: "免费赠品" };
  const scenes = ["商城", "积分兑换", "任务奖励", "第三方平台"];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  const formatDate = (value) => {
    if (!value) return "不限";
    if (String(value).toLowerCase() === "always") return "永久";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" }).formatToParts(date).map(part => [part.type,part.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  };
  let data;

  const dialog = document.createElement("dialog");
  dialog.style.cssText = "width:min(850px,94vw);max-height:90vh;overflow:auto;padding:24px";
  document.body.append(dialog);

  async function api(method = "GET", body) {
    const response = await fetch("/api/admin/coupons", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || "请求失败");
    return result;
  }

  async function findRecord(kind, value) {
    const key = kind === "template" ? "template" : "product";
    const response = await fetch(`/api/admin/coupons?${key}=${encodeURIComponent(value)}`, { credentials: "same-origin", cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || "查询失败");
    return result[`${key}s`] || [];
  }

  function options(list, selected = []) {
    return list.map((item) => `<option value="${esc(item.value)}" ${selected.includes(String(item.value)) ? "selected" : ""}>${esc(item.label)} (${esc(item.value)})</option>`).join("");
  }

  function localDate(value) {
    if (!value || /^always$/i.test(String(value))) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function pickerMarkup({ kind, title, inputName, findAttr, messageAttr, resultsAttr, selectedAttr }) {
    const label = kind === "template" ? "模板名称或编号" : "商品名称或编号";
    const noun = kind === "template" ? "模板" : "商品";
    return `<fieldset>
      <legend>${title}</legend>
      <label>${label}<input name="${inputName}" placeholder="输入完整${noun}名称或编号"></label>
      <button type="button" ${findAttr}>查询${noun}</button>
      <p ${messageAttr} aria-live="polite"></p>
      <div ${resultsAttr}></div>
      <div ${selectedAttr}></div>
    </fieldset>`;
  }

  function bindLookup(map, config) {
    const datasetKey = `${config.action}${config.kind[0].toUpperCase()}${config.kind.slice(1)}`;
    const render = () => {
      const target = dialog.querySelector(config.selected);
      target.innerHTML = [...map].map(([id, name]) => `<p>${esc(name)} (${esc(id)}) <button type="button" data-${config.action}-${config.kind}="${esc(id)}">移除</button></p>`).join("") || `<p>${config.empty}</p>`;
      target.querySelectorAll(`[data-${config.action}-${config.kind}]`).forEach((button) => {
        button.onclick = () => {
          map.delete(button.dataset[datasetKey]);
          render();
        };
      });
    };
    render();
    dialog.querySelector(config.button).onclick = async () => {
      const message = dialog.querySelector(config.message);
      const results = dialog.querySelector(config.results);
      results.innerHTML = "";
      try {
        const rows = await findRecord(config.kind, dialog.querySelector(`[name="${config.input}"]`).value);
        message.textContent = rows.length ? "请选择要添加的记录（重复添加会自动去重）" : `数据库中没有这个${config.kind === "template" ? "模板" : "商品"}，请检查名称或编号`;
        results.innerHTML = rows.map((item) => `<button type="button" data-add-${config.kind}="${esc(item.value)}">添加 ${esc(item.label)} (${esc(item.value)})</button>`).join("");
        results.querySelectorAll(`[data-add-${config.kind}]`).forEach((button) => {
          button.onclick = () => {
            const addKey = `add${config.kind[0].toUpperCase()}${config.kind.slice(1)}`;
            const item = rows.find((row) => row.value === button.dataset[addKey]);
            map.set(item.value, item.label);
            render();
            message.textContent = "已添加";
          };
        });
      } catch (error) {
        message.textContent = error.message;
      }
    };
    return render;
  }

  async function load() {
    panel.innerHTML = "<p>正在读取优惠券…</p>";
    try {
      data = await api();
      panel.innerHTML = `<h2>优惠券管理</h2><button data-create-coupon>创建优惠券</button><p data-coupon-status></p>
        <div style="overflow:auto"><table class="admin-record-table"><thead><tr><th>Coupon ID</th><th>名称</th><th>类型</th><th>状态</th><th>有效期（悉尼）</th><th>操作</th></tr></thead><tbody>${data.rows.map((coupon) => `<tr><td>${esc(coupon.coupon_id)}</td><td>${esc(coupon.coupon_name)}</td><td>${esc(labels[coupon.deal_type])}</td><td>${coupon.status === "published" ? "上架" : "未上架"}</td><td>${esc(formatDate(coupon.expiry_date))}</td><td><button data-edit-coupon="${esc(coupon.coupon_id)}">编辑</button> <button data-grant-coupon="${esc(coupon.coupon_id)}">发放给用户</button> <button data-link-coupon="${esc(coupon.coupon_id)}">生成领取链接</button></td></tr>`).join("")}</tbody></table></div>
        <h3>用户优惠券记录</h3><div style="overflow:auto"><table class="admin-record-table"><thead><tr><th>优惠券</th><th>用户</th><th>状态</th><th>订单</th></tr></thead><tbody>${data.assignments.map((assignment) => `<tr><td>${esc(assignment.coupon_id)}</td><td>${esc(assignment.username || assignment.user_id)}</td><td>${esc({ inactive: "未激活", unused: "未使用", used: "已使用", expired: "已过期" }[assignment.coupon_use_status])}</td><td>${esc(assignment.order_id)}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (error) {
      panel.textContent = error.message;
    }
  }

  function edit(id) {
    const row = data.rows.find((coupon) => coupon.coupon_id === id) || { deal_type: "money_off", status: "unpublished", coupon_scene_type: ["商城"], coupon_available_items: [], rewarded_items: [] };
    const selectedProducts = new Map((row.coupon_available_items || []).map((productId) => [productId, data.options.products.find((item) => item.value === productId)?.label || productId]));
    const rewardProducts = new Map((row.rewarded_items || []).filter((item) => item.type === "product").map((item) => [item.id, data.options.products.find((product) => product.value === item.id)?.label || item.id]));
    const rewardTemplates = new Map((row.rewarded_items || []).filter((item) => item.type === "template").map((item) => [item.id, data.options.templates.find((template) => template.value === item.id)?.label || item.id]));
    const permanent = /^always$/i.test(String(row.expiry_date || ""));

    dialog.innerHTML = `<h2>${id ? "编辑" : "创建"}优惠券</h2><form>
      <label>名称<input name="coupon_name" required value="${esc(row.coupon_name)}"></label>
      <label>优惠类型<select name="deal_type">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${row.deal_type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      ${pickerMarkup({ kind: "product", title: "适用商品（至少一个）", inputName: "productLookup", findAttr: "data-find-product", messageAttr: "data-product-message", resultsAttr: "data-product-results", selectedAttr: "data-selected-products" })}
      <label>满足金额条件<input type="number" min="0" step="0.01" name="condition_amount" value="${esc(row.condition_amount || 0)}"></label>
      <label data-kind="money_off">减去金额<input type="number" min="0" step="0.01" name="reduce_amount" value="${esc(row.reduce_amount || 0)}"></label>
      <label data-kind="percent_off">减免百分比（20 表示八折）<input type="number" min="0" max="100" step="0.01" name="discount" value="${esc(row.discount || 0)}"></label>
      <div data-kind="gifts"><p>每种赠品一份，满足适用商品金额条件后赠送。</p>
        ${pickerMarkup({ kind: "product", title: "选择赠品", inputName: "rewardProductLookup", findAttr: "data-find-reward-product", messageAttr: "data-reward-product-message", resultsAttr: "data-reward-product-results", selectedAttr: "data-selected-reward-products" })}
        ${pickerMarkup({ kind: "template", title: "选择模板", inputName: "rewardTemplateLookup", findAttr: "data-find-reward-template", messageAttr: "data-reward-template-message", resultsAttr: "data-reward-template-results", selectedAttr: "data-selected-reward-templates" })}
      </div>
      <label>开始生效<input name="start_date" type="datetime-local" value="${localDate(row.start_date)}"></label>
      <label>过期时间<input name="expiry_date" type="datetime-local" value="${localDate(row.expiry_date)}" ${permanent ? "disabled" : ""}></label>
      <label><input name="expiry_always" type="checkbox" value="1" ${permanent ? "checked" : ""}> 永久有效</label>
      <label>上架状态<select name="status"><option value="unpublished">未上架</option><option value="published" ${row.status === "published" ? "selected" : ""}>上架</option></select></label>
      <label>使用场景<select name="scenes" multiple required>${options(scenes.map((value) => ({ value, label: value })), row.coupon_scene_type)}</select></label>
      <label>领取链接（可空）<input name="coupon_url" value="${esc(row.coupon_url)}"></label>
      <p role="status"></p><button type="submit">保存</button> <button type="button" data-close>取消</button>
    </form>`;

    bindLookup(selectedProducts, { kind: "product", action: "remove", input: "productLookup", button: "[data-find-product]", message: "[data-product-message]", results: "[data-product-results]", selected: "[data-selected-products]", empty: "尚未添加商品" });
    bindLookup(rewardProducts, { kind: "product", action: "remove", input: "rewardProductLookup", button: "[data-find-reward-product]", message: "[data-reward-product-message]", results: "[data-reward-product-results]", selected: "[data-selected-reward-products]", empty: "尚未添加赠品商品" });
    bindLookup(rewardTemplates, { kind: "template", action: "remove", input: "rewardTemplateLookup", button: "[data-find-reward-template]", message: "[data-reward-template-message]", results: "[data-reward-template-results]", selected: "[data-selected-reward-templates]", empty: "尚未添加赠品模板" });

    const form = dialog.querySelector("form");
    const sync = () => {
      form.querySelectorAll("[data-kind]").forEach((element) => {
        const hide = element.dataset.kind !== form.elements.deal_type.value && !(element.dataset.kind === "gifts" && ["free_product", "buy_x_get_y"].includes(form.elements.deal_type.value));
        element.hidden = hide;
        element.style.display = hide ? "none" : "";
      });
      form.elements.expiry_date.disabled = form.elements.expiry_always.checked;
    };
    form.elements.deal_type.onchange = sync;
    form.elements.expiry_always.onchange = sync;
    sync();

    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        const formData = new FormData(form);
        const item = {};
        for (const key of ["coupon_name", "deal_type", "condition_amount", "reduce_amount", "discount", "status", "coupon_url"]) item[key] = formData.get(key);
        item.start_date = formData.get("start_date") ? new Date(formData.get("start_date")).toISOString() : null;
        item.expiry_date = formData.get("expiry_always") ? "Always" : formData.get("expiry_date") ? new Date(formData.get("expiry_date")).toISOString() : null;
        item.coupon_available_items = [...selectedProducts.keys()];
        if (!item.coupon_available_items.length) throw Error("请先查询并添加至少一个商品");
        item.coupon_scene_type = formData.getAll("scenes");
        item.rewarded_items = [...[...rewardProducts.keys()].map((giftId) => ({ type: "product", id: giftId })), ...[...rewardTemplates.keys()].map((templateId) => ({ type: "template", id: templateId }))];
        await api(id ? "PATCH" : "POST", { id, item });
        dialog.close();
        await load();
      } catch (error) {
        form.querySelector("[role=status]").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.showModal();
  }

  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-create-coupon")) edit();
    else if (button.dataset.editCoupon) edit(button.dataset.editCoupon);
    else if (button.dataset.grantCoupon) {
      dialog.innerHTML = `<h3>发放给用户</h3><form><select name="users" multiple required size="10">${options(data.options.users)}</select><p role="status"></p><button type="submit">确认发放</button><button type="button" data-close>取消</button></form>`;
      dialog.querySelector("[data-close]").onclick = () => dialog.close();
      dialog.querySelector("form").onsubmit = async (submitEvent) => {
        submitEvent.preventDefault();
        try {
          await api("POST", { action: "grant", id: button.dataset.grantCoupon, userIds: new FormData(submitEvent.currentTarget).getAll("users") });
          dialog.close();
          await load();
        } catch (error) {
          dialog.querySelector("[role=status]").textContent = error.message;
        }
      };
      dialog.showModal();
    } else if (button.dataset.linkCoupon) {
      try {
        const result = await api("POST", { action: "link", id: button.dataset.linkCoupon });
        panel.querySelector("[data-coupon-status]").textContent = "领取链接：" + new URL(result.url, location.origin).href;
      } catch (error) {
        panel.querySelector("[data-coupon-status]").textContent = error.message;
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-admin-view="coupons"]')) void load();
  });
})();
