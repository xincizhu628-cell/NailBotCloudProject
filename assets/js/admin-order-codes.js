(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  async function request(type, method = 'GET', data, after = '0') {
    const response = await fetch(`/api/admin/order-codes?type=${type}&after_id=${encodeURIComponent(after)}&limit=100`, {
      method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify({ type, ...data }) } : {})
    });
    if (response.status === 401) {
      const session = await fetch('/api/admin/session', { credentials:'same-origin', cache:'no-store' });
      if (session.status === 401) location.replace('/admin-login.html?return=' + encodeURIComponent('/admin.html'));
      throw new Error('后台登录状态无效，请刷新后重试。');
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Request failed');
    return result;
  }
  for (const panel of document.querySelectorAll('[data-code-panel]')) {
    const type = panel.dataset.codePanel;
    const isPrint = type === 'print';
    panel.innerHTML = `<article class="panel panel-pad"><h2>${isPrint ? '打印码' : '取货码'}</h2>
      <p>${isPrint ? '打印码由厂家激活回调写入，本页仅查看记录和使用状态。' : '可人工录入厂家已激活的六位取货码，初始为同步成功、未使用；取货码添加后不允许修改绑定。'}</p>
      <button class="create-btn" type="button" data-load>刷新</button>
      ${isPrint ? '' : `<form data-add-manual><label>六位码 <input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off"></label><label>订单 ID（可留空）<input name="order_id"></label><button class="create-btn" type="submit">添加取货码</button></form>`}
      <p role="status" data-status>正在加载，状态每 5 秒刷新。</p>
      <div class="taxonomy-table-wrap"><table class="admin-record-table"><thead><tr><th>ID</th><th>码</th><th>使用状态</th><th>打印使用状态</th><th>同步状态</th><th>订单</th><th>来源</th><th>操作</th></tr></thead><tbody></tbody></table></div>
      <button type="button" data-prev>上一页</button><button type="button" data-next>下一页</button></article>`;
    let after = '0', next = null, history = [], busy = false, connected = false;
    const status = panel.querySelector('[data-status]');
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const result = await request(type, 'GET', null, after);
        next = result.rows.length === 100 ? result.next_after_id : null;
        panel.querySelector('tbody').innerHTML = result.rows.map(row => `<tr><td>${escape(row.id)}</td><td><strong>${escape(row.code)}</strong></td><td>${row.use_status === 'active' ? '已使用' : '未使用'}</td><td>${escape(row.print_use_status === 'used' ? '已打印' : row.print_use_status === 'unused' ? '未打印' : '—')}</td><td>${escape({pending:'等待发送',success:'同步成功',fail:'同步失败'}[row.sync_status] || row.sync_status)}</td><td>${escape(row.order_id ?? "未绑定")}</td><td>${row.code_origin==='manufacturer'?'厂家回调':row.code_origin==='manual'?'人工录入':'系统生成'}</td><td>${isPrint?'只读':`<button class="row-action delete" type="button" data-delete="${escape(row.id)}" data-code="${escape(row.code)}">删除</button>`}</td></tr>`).join('') || '<tr><td colspan="8">暂无记录</td></tr>';
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
    panel.querySelector('[data-add-manual]')?.addEventListener('submit', async event => {
      event.preventDefault();if(busy)return;
      const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
      try{const data=new FormData(form);const result=await request(type,'POST',{code:data.get('code'),order_id:data.get('order_id')});form.reset();after='0';history=[];await refresh();status.textContent=`已录入 ${result.record.code}：同步成功、未使用`;}
      catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    });
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
