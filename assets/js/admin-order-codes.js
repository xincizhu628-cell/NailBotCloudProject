(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  async function request(type, method = 'GET', data, after = '0') {
    const response = await fetch(`/api/admin/order-codes?type=${type}&after_id=${encodeURIComponent(after)}&limit=100`, {
      method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify({ type, ...data }) } : {})
    });
    if (response.status === 401) {
      // An individual module can reject an old token scheme without expiring the login cookie.
      let session;
      try { session = await fetch('/api/admin/session', { credentials:'same-origin', cache:'no-store' }); }
      catch { throw new Error('暂时无法验证后台登录状态，请稍后刷新。'); }
      if (session.status === 401) {
        location.replace('/admin-login.html?return=' + encodeURIComponent('/admin.html'));
        throw new Error('登录已过期，请重新登录后台。');
      }
      if (!session.ok) throw new Error('后台会话验证暂时不可用，请稍后刷新。');
      const verified = await session.json();
      if (!verified.ok) throw new Error('无法确认后台登录状态，请稍后刷新。');
      throw new Error('后台登录正常，但码接口拒绝访问。请同步部署 services/orderCodeRoutes.js，移除旧管理员令牌认证。');
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Request failed');
    return result;
  }
  for (const panel of document.querySelectorAll('[data-code-panel]')) {
    const type = panel.dataset.codePanel;
    panel.innerHTML = `<article class="panel panel-pad"><h2>${type === 'print' ? '打印码' : '取货码'}</h2>
      <p>${type === 'print' ? '按订单中 printing 商品的数量补齐打印码；重复点击不会重复生成。' : '每个订单一个取货码；已存在时返回原记录。'}</p>
      <button class="create-btn" type="button" data-load>刷新</button>
      <form data-generate><label>订单 ID <input name="order_id" required></label><button class="create-btn" type="submit">生成${type === 'print' ? '打印码' : '取货码'}</button></form>
      <div style="margin-top:16px"><button class="create-btn" type="button" data-generate-unbound>生成未绑定${type === 'print' ? '打印码' : '取货码'}</button><p>无需订单，每次生成一个新码，暂不绑定订单。</p></div>
      <p role="status" data-status>正在加载，状态每 5 秒刷新。</p>
      <div class="taxonomy-table-wrap"><table class="admin-record-table"><thead><tr><th>ID</th><th>码</th><th>使用状态</th><th>同步状态</th><th>订单</th><th>商品</th><th>操作</th></tr></thead><tbody></tbody></table></div>
      <button type="button" data-prev>上一页</button><button type="button" data-next>下一页</button></article>`;
    let after = '0', next = null, history = [], busy = false, connected = false;
    const status = panel.querySelector('[data-status]');
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const result = await request(type, 'GET', null, after);
        next = result.rows.length === 100 ? result.next_after_id : null;
        panel.querySelector('tbody').innerHTML = result.rows.map(row => `<tr><td>${escape(row.id)}</td><td><strong>${escape(row.code)}</strong></td><td>${row.use_status === 'active' ? '已激活' : '未激活'}</td><td>${escape({pending:'等待发送',success:'同步成功',fail:'同步失败'}[row.sync_status] || row.sync_status)}</td><td>${escape(row.order_id ?? "未绑定")}</td><td>${escape(row.product_id || '—')}</td><td><button class="row-action delete" type="button" data-delete="${escape(row.id)}" data-code="${escape(row.code)}">删除</button></td></tr>`).join('') || '<tr><td colspan="7">暂无记录</td></tr>';
        panel.querySelector('[data-prev]').disabled = !history.length;
        panel.querySelector('[data-next]').disabled = !next;
        status.textContent = `已更新 ${new Date().toLocaleTimeString()}`;
        connected = true;
      } catch (error) { status.textContent = error.message; connected = false; }
      finally { busy = false; }
    }
    panel.querySelector('[data-load]').onclick = () => { void refresh(); };
    panel.querySelector('[data-prev]').onclick = () => { if (!busy) { after = history.pop() || '0'; void refresh(); } };
    panel.querySelector('[data-next]').onclick = () => { if (!busy && next) { history.push(after); after = next; void refresh(); } };
    panel.querySelector('[data-generate]').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const button = event.currentTarget.querySelector('button'); button.disabled = true;
      try {
        await request(type, 'POST', { order_id: new FormData(event.currentTarget).get('order_id') });
        after = '0'; history = []; await refresh();
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    panel.querySelector('[data-generate-unbound]').onclick = async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      try {
        const result = await request(type, 'POST', { unbound: true });
        after = '0'; history = []; await refresh();
        status.textContent = `已生成未绑定${type === 'print' ? '打印码' : '取货码'}：${result.record.code}`;
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    panel.querySelector('tbody').onclick = async event => {
      const button = event.target.closest('[data-delete]');
      if (!button || !confirm(`确认删除码 ${button.dataset.code}？厂家已缓存的码需要由厂家另外作废。`)) return;
      button.disabled = true;
      try { await request(type, 'DELETE', { id: button.dataset.delete }); await refresh(); }
      catch (error) { status.textContent = error.message; button.disabled = false; }
    };
    void refresh();
    setInterval(() => { if (connected && !document.hidden && panel.getClientRects().length) void refresh(); }, 5000);
  }
})();
