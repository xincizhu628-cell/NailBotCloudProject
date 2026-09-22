(() => {
  const list = document.querySelector('#shop-coupon-list'), activities = document.querySelector('#coupon-activities');
  if (!list && !activities) return;
  const key = 'nailShopCouponSessionCacheV3';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const zh = () => document.documentElement.lang.toLowerCase().startsWith('zh');
  const tr = (cn,en) => zh() ? cn : en;
  const urlOf = v => { if (!v) return ''; try { const u = new URL(v, location.href); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const dateOf = v => !v ? tr('不限','Any time') : String(v).toLowerCase() === 'always' ? tr('永久','Always') : window.CouponPicker?.formatDate(v) || v;
  const productsOf = c => Array.isArray(c.applicable_products) ? c.applicable_products : [];
  const eventsOf = c => Array.isArray(c.events) ? c.events : [];
  const expiresAt = c => !c.expiry_date || String(c.expiry_date).toLowerCase() === 'always' ? Infinity : Date.parse(c.expiry_date);
  const expired = c => expiresAt(c) <= Date.now();
  const upcoming = c => c.start_date && Date.parse(c.start_date) > Date.now();
  const dealOf = c => ({money_off:tr('满减','Money off'),percent_off:tr('折扣','Percentage off'),buy_x_get_y:tr('买赠','Buy and get'),free_product:tr('赠品','Free gift')})[c.deal_type] || c.deal_type;
  const summary = c => {
    const threshold = Number(c.condition_amount || 0), discount = Number(c.discount || 0), reduction = Number(c.reduce_amount || 0);
    if (c.deal_type === 'money_off') return tr(`满 $${threshold} 减 $${reduction}`,`Spend $${threshold}, save $${reduction}`);
    if (c.deal_type === 'percent_off') return tr(`满 $${threshold} 减免 ${discount}%`,`Spend $${threshold}, save ${discount}%`);
    return tr(`满 $${threshold} 赠送商品或模板`,`Spend $${threshold} and receive a gift`);
  };
  const saving = c => c.deal_type === 'money_off' ? Number(c.reduce_amount || 0) : c.deal_type === 'percent_off' ? Number(c.condition_amount || 0) * Number(c.discount || 0) / 100 : 0;
  let request, coupons = [], tab = 'products';
  function load(force = false) {
    if (!force) { try { const cached = JSON.parse(sessionStorage.getItem(key) || 'null'); if (cached?.ok) return Promise.resolve(cached); } catch {} if (request) return request; }
    request = fetch('/api/shop/coupons',{cache:'no-store'}).then(async r => { const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error || tr('读取失败','Unable to load coupons')); sessionStorage.setItem(key,JSON.stringify(data)); return data; }).catch(e => { request = null; throw e; });
    return request;
  }
  function populateTypes() {
    const select = document.querySelector('#shop-coupon-product-type'); if (!select) return;
    const old = select.value, types = [...new Set(coupons.flatMap(c => productsOf(c).map(p => String(p.type || '').trim()).filter(Boolean)))].sort();
    select.innerHTML = `<option value="">${tr('全部商品','All products')}</option>${types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}`;
    select.value = types.includes(old) ? old : '';
    const eventSelect = document.querySelector('#shop-coupon-event');
    if (eventSelect) {
      const previous = eventSelect.value, events = new Map(coupons.flatMap(c => eventsOf(c)).map(event => [String(event.id), event.title]));
      eventSelect.innerHTML = `<option value="">${tr('全部活动','All activities')}</option>${[...events].map(([id,title]) => `<option value="${esc(id)}">${esc(title)}</option>`).join('')}`;
      eventSelect.value = events.has(previous) ? previous : '';
    }
  }
  function render() {
    if (!list || tab !== 'coupons') return;
    const deal = document.querySelector('#shop-coupon-deal')?.value || '', type = document.querySelector('#shop-coupon-product-type')?.value || '', eventId = document.querySelector('#shop-coupon-event')?.value || '', sort = document.querySelector('#shop-coupon-sort')?.value || '', query = (document.querySelector('#shop-coupon-search')?.value || '').trim().toLocaleLowerCase();
    const visible = coupons.filter(c => (!deal || c.deal_type === deal) && (!type || productsOf(c).some(p => p.type === type)) && (!eventId || eventsOf(c).some(event => String(event.id) === eventId)) && (!query || [c.coupon_name,summary(c),...productsOf(c).flatMap(p => [p.name,p.id]),...eventsOf(c).map(event => event.title)].join(' ').toLocaleLowerCase().includes(query)));
    if (sort === 'expiry') visible.sort((a,b) => expiresAt(a)-expiresAt(b));
    if (sort === 'value') visible.sort((a,b) => saving(b)-saving(a));
    list.innerHTML = visible.map(c => `<button class="shop-coupon-item" type="button" data-shop-coupon-index="${coupons.indexOf(c)}"><span class="shop-coupon-kind">${esc(dealOf(c))}</span><strong data-no-translate>${esc(c.coupon_name)}</strong><span class="shop-coupon-value">${esc(summary(c))}</span><span class="shop-coupon-dates">${esc(dateOf(c.start_date))} — ${esc(dateOf(c.expiry_date))}</span><span class="shop-coupon-status">${expired(c) ? tr('已过期','Expired') : upcoming(c) ? tr('即将生效','Upcoming') : tr('查看详情','View details')}</span></button>`).join('') || `<p class="shop-coupon-empty">${tr('没有符合条件的商城优惠券。','No shop coupons match these filters.')}</p>`;
  }
  function details(c) {
    const dialog = document.createElement('dialog'); dialog.className = 'shop-coupon-dialog';
    const url = urlOf(c.coupon_url), scope = productsOf(c).map(p => p.name || p.id).filter(Boolean).join('、');
    dialog.innerHTML = `<div class="shop-coupon-dialog-head"><span>${esc(dealOf(c))}</span><button type="button" data-close aria-label="Close">×</button></div><h2 data-no-translate>${esc(c.coupon_name)}</h2><p class="shop-coupon-dialog-value">${esc(summary(c))}</p><dl><div><dt>${tr('适用商品','Applicable products')}</dt><dd>${esc(scope || tr('指定商品','Selected products'))}</dd></div><div><dt>${tr('活动主题','Activities')}</dt><dd>${esc(eventsOf(c).map(event => event.title).join('、') || tr('未绑定活动','No linked activity'))}</dd></div><div><dt>${tr('最低消费','Minimum spend')}</dt><dd>$${esc(Number(c.condition_amount || 0).toFixed(2))}</dd></div><div><dt>${tr('有效时间','Validity')}</dt><dd>${esc(dateOf(c.start_date))} — ${esc(dateOf(c.expiry_date))}</dd></div><div><dt>${tr('领取方式','How to get it')}</dt><dd>${url ? tr('通过领取链接','Claim link') : tr('领取方式待公布','Claim method to be announced')}</dd></div></dl><div class="shop-coupon-dialog-actions"><button type="button" data-view-products>${tr('浏览适用商品','Browse products')}</button>${url && !expired(c) && !upcoming(c) ? `<a href="${esc(url)}">${tr('领取优惠券','Get coupon')}</a>` : ''}</div>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-view-products]').onclick = () => { dialog.close(); select('products'); document.querySelector('.shop-catalog')?.scrollIntoView({behavior:'smooth'}); };
    dialog.addEventListener('click',e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close',() => dialog.remove(),{once:true}); dialog.showModal();
  }
  function select(value, update = true) {
    tab = value === 'coupons' ? 'coupons' : 'products'; const showing = tab === 'coupons';
    const grid = document.querySelector('#product-grid'), productFilters = document.querySelector('.product-filter-board'), couponFilters = document.querySelector('#shop-coupon-filters');
    if (grid) grid.hidden = showing; if (list) list.hidden = !showing; if (productFilters) productFilters.hidden = showing; if (couponFilters) couponFilters.hidden = !showing;
    document.querySelectorAll('[data-shop-tab]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.shopTab === tab)));
    if (update) { const u = new URL(location.href); u.searchParams.set('shop',tab); history.replaceState(history.state,'',u); }
    if (showing && list) { list.textContent = tr('正在加载优惠券…','Loading coupons…'); load().then(data => { coupons = data.coupons || []; populateTypes(); render(); }).catch(e => { list.textContent = e.message; }); }
  }
  void load(); window.CouponPicker?.preloadWallet?.();
  if (list) {
    document.querySelectorAll('[data-shop-tab]').forEach(b => b.addEventListener('click',() => select(b.dataset.shopTab)));
    ['shop-coupon-deal','shop-coupon-product-type','shop-coupon-event','shop-coupon-sort'].forEach(id => document.getElementById(id)?.addEventListener('change',render));
    document.getElementById('shop-coupon-search')?.addEventListener('input',render);
    list.addEventListener('click',e => { const b = e.target.closest('[data-shop-coupon-index]'); if (b) details(coupons[Number(b.dataset.shopCouponIndex)]); });
    select(new URLSearchParams(location.search).get('shop'),false);
    window.addEventListener('popstate',() => select(new URLSearchParams(location.search).get('shop'),false));
    window.addEventListener('customer-language-change',() => { if (tab === 'coupons') { populateTypes(); render(); } });
  }
  if (activities) load().then(data => { activities.innerHTML = (data.activities || []).map(a => { const title = esc(a.title || a.event_name), url = urlOf(a.html_url); return url ? `<a href="${esc(url)}">${title}</a>` : `<p>${title}</p>`; }).join('') || '<p>No activities currently available.</p>'; }).catch(e => activities.textContent = e.message);
  window.ShopCoupons = {load,clear:() => sessionStorage.removeItem(key)};
})();
