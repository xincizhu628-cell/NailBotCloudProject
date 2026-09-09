(() => {
  const list = document.querySelector('#orders-list'), status = document.querySelector('#orders-status');
  const refresh = document.querySelector('#refresh-orders'), more = document.querySelector('#load-more'), signIn = document.querySelector('#sign-in');
  let offset = 0, loading = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const label = value => String(value || '—').replace(/_/g, ' ');
  const date = value => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(); };
  const amount = value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
  function card(order) {
    const prints = order.print_codes?.length ? order.print_codes : order.print_code ? [{code:order.print_code}] : [];
    const pickup = order.pickup_code || '';
    const field = (name,value) => `<div><dt>${name}</dt><dd>${escape(value)}</dd></div>`;
    return `<article class="order-card"><div class="order-top"><div><h2>${escape(order.order_id)}</h2><p>${escape(date(order.created_at))}</p></div><span class="order-total">$${amount(order.total_price)}</span></div>
      <dl class="order-meta">${field('Fulfillment',label(order.order_get_type))}${field('Payment',label(order.payment_status))}${field('Delivery',label(order.delivery_status))}${field('Pickup',label(order.pickup_status))}${field('Payment method',label(order.pay_method))}${field('Paid at',date(order.paid_at))}</dl>
      <ul class="order-items">${(order.items || []).map(item=>`<li><span>${escape(item.product_name || item.product_id)} × ${escape(item.quantity)}</span><span>$${amount(item.unit_price)}</span></li>`).join('')}</ul>
      ${pickup ? `<p>Pickup code<br><span class="order-code">${escape(pickup)}</span></p>` : ''}
      ${prints.length ? `<p>Print codes<br>${prints.map(p=>`<span class="order-code">${escape(p.code)}</span>`).join('')}</p>` : ''}</article>`;
  }
  async function load(reset = false) {
    if (loading) return;
    let sessionId = ''; try { sessionId = localStorage.getItem('nailStudioUserAuthSessionV1') || ''; } catch {}
    if (!sessionId) { list.innerHTML=''; more.hidden=true; signIn.hidden=false; status.textContent='Please sign in to view your orders.'; return; }
    loading=true; refresh.disabled=true; more.disabled=true; signIn.hidden=true;
    if (reset) { offset=0; list.innerHTML=''; more.hidden=true; }
    status.textContent='Loading your orders…';
    try {
      const response=await fetch('/api/user/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,offset})});
      const data=await response.json();
      if (response.status===401) { list.innerHTML='';more.hidden=true;signIn.hidden=false;throw new Error('Your session has expired. Please sign in again.'); }
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to load orders. Please try again.');
      list.insertAdjacentHTML('beforeend',data.orders.map(card).join(''));
      offset=data.nextOffset;more.hidden=!data.hasMore;
      status.textContent=offset ? `${offset} order${offset===1?'':'s'} loaded.` : 'You have no orders yet.';
    } catch(error) {status.textContent=error.message;}
    finally {loading=false;refresh.disabled=false;more.disabled=false;}
  }
  refresh.onclick=()=>load(true);more.onclick=()=>load();void load(true);
})();
