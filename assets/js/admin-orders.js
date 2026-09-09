(() => {
  const dialog=document.createElement('dialog');
  dialog.style.cssText='width:min(960px,94vw);max-height:90vh;overflow:auto;border:1px solid #ead4df;border-radius:16px;padding:24px';
  document.body.append(dialog);
  const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={order_id:'订单 ID',user_id:'用户 ID',address_id:'地址 ID',total_price:'订单金额',pay_method:'支付方式',payment_status:'支付状态',order_get_type:'取货方式',delivery_status:'配送状态',pickup_status:'取货状态',created_at:'创建时间',paid_at:'支付时间',pickup_code:'取货码',print_code:'首个打印码',bound_device_id:'设备',payment_provider_id:'支付流水',manufacturer_sync_status:'厂家同步状态',manufacturer_sync_error:'厂家同步错误',manufacturer_response:'厂家响应'};
  let currentId=null,record=null,busy=false,loading=false;
  async function request(method,body){const response=await fetch('/api/admin/order-detail'+(method==='GET'?'?id='+encodeURIComponent(currentId):''),{method,credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'订单读取失败');return data;}
  function render(data){record=data.order;const delivery=['delivery','both'].includes(record.order_get_type);const paid=['paid','completed','COMPLETED'].includes(record.payment_status);
    const codes=(rows,label)=>`<section><h3>${label}</h3>${rows.length?rows.map(c=>`<p><strong>${esc(c.code)}</strong> · ${c.use_status==='active'?'已使用':'未使用'} · 同步：${esc(c.sync_status)}</p>`).join(''):'<p>无记录</p>'}</section>`;
    dialog.innerHTML=`<button type="button" data-close style="float:right">关闭</button><h2>订单详情</h2><div style="padding:16px;background:#fff0f6;border-radius:10px;font-size:20px;font-weight:bold">配送：${esc(record.delivery_status||'不适用 / 未支付')}<br>取货：${esc(record.pickup_status||'不适用 / 未支付')}</div><dl style="display:grid;grid-template-columns:150px 1fr;gap:8px">${Object.entries(record).map(([k,v])=>`<dt>${esc(names[k]||k)}</dt><dd style="margin:0;overflow-wrap:anywhere;white-space:pre-wrap">${esc(typeof v==='object'&&v!==null?JSON.stringify(v):v)}</dd>`).join('')}</dl>
    ${delivery?`<div><button type="button" data-shipment ${!paid?'disabled':''}>${record.delivery_status==='待发货'?'确认已发货':'撤回已发货'}</button> <button type="button" data-delivery ${!paid||record.delivery_status==='待发货'?'disabled':''}>${record.delivery_status==='已送达'?'撤回已送达':'确认已送达'}</button><p>撤回已发货会同时撤回已送达。取货状态由取货码自动更新。</p></div>`:''}
    <h3>订单商品</h3>${data.items.map(i=>`<p>${esc(i.product_name||i.product_id)} × ${esc(i.quantity)} · 单价 ${esc(i.unit_price)}<details><summary>商品记录</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(i,null,2))}</pre></details></p>`).join('')}
    ${codes(data.printCodes,'打印码及使用状态')}${codes(data.pickupCodes,'取货码及使用状态')}<p role="status" data-status>每 5 秒刷新状态</p>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-shipment]')?.addEventListener('click',()=>update('shipment',record.delivery_status==='待发货'));
    dialog.querySelector('[data-delivery]')?.addEventListener('click',()=>update('delivery',record.delivery_status!=='已送达'));
    window.dispatchEvent(new CustomEvent('order-updated',{detail:record}));
  }
  async function refresh(){if(busy||loading||!currentId)return;loading=true;const id=currentId;try{const data=await request('GET');if(dialog.open&&currentId===id)render(data);}catch(e){if(dialog.open&&id===currentId){const status=dialog.querySelector('[data-status]');if(status)status.textContent=e.message;}}finally{loading=false;}}
  async function update(action,confirmed){if(busy||loading)return;busy=true;dialog.querySelectorAll('[data-shipment],[data-delivery]').forEach(b=>b.disabled=true);try{render(await request('PATCH',{id:currentId,action,confirmed,expectedStatus:record.delivery_status}));}catch(e){const error=e.message;busy=false;await refresh();dialog.querySelector('[data-status]').textContent=error;}finally{busy=false;}}
  document.addEventListener('click',event=>{const button=event.target.closest('[data-order-detail]');if(!button||busy||loading)return;currentId=button.dataset.orderDetail;dialog.innerHTML='<button type="button" data-close>关闭</button><p data-status>正在读取订单…</p>';dialog.querySelector('[data-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();void refresh();});
  setInterval(()=>{if(dialog.open&&!document.hidden)void refresh();},5000);
})();
