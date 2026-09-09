const crypto = require('node:crypto');
const cents = value => { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error('Invalid price or discount'); return Math.round(n * 100); };
function ids(value) { if (Array.isArray(value)) return value.map(String); if (!value) return []; try { const a=JSON.parse(value); if(Array.isArray(a)) return a.map(String); } catch {} return String(value).split(/[,，\n]/).map(x=>x.trim()).filter(Boolean); }
// Same percent/threshold/fixed-total semantics as promotion_pricing.py, using integer cents.
function applyRule(lines, rule) {
  const targets=ids(rule.target_product_ids);
  const selected=lines.map((line,i)=> rule.promo_scope==='selected_products' && !targets.includes(String(line.id)) ? -1 : i).filter(i=>i>=0);
  const subtotal=selected.reduce((n,i)=>n+lines[i].remaining,0);
  let extra={}; try {extra=JSON.parse(rule.price_rule_json||'{}');}catch{}
  const threshold=Math.max(cents(rule.min_spend||0),cents(extra.activation_min_spend||0),rule.discount_type==='threshold_amount_off'?cents(extra.threshold_spend||0):0);
  if(!subtotal || subtotal<threshold) return 0;
  const value=Number(rule.discount_value); let discount=0;
  if(rule.discount_type==='percent_off') { if(value>100)throw new Error('Invalid discount percentage'); discount=Math.round(subtotal*value/100); }
  else if(['amount_off','threshold_amount_off'].includes(rule.discount_type)) discount=cents(value);
  else if(rule.discount_type==='fixed_price') discount=Math.max(0,subtotal-cents(value));
  else throw new Error('Unknown discount type');
  if(!Number.isFinite(discount)||discount<0)throw new Error('Invalid discount');
  discount=Math.min(subtotal,discount,rule.max_discount==null?subtotal:cents(rule.max_discount));
  let allocated=0, cumulative=0;
  for(const i of selected){cumulative+=lines[i].remaining; const share=Math.round(discount*cumulative/subtotal)-allocated; allocated+=share; lines[i].remaining-=share;}
  return discount;
}
function createPromotionPricingService(pool, now=()=>Date.now()) {
 async function quote(items) {
  if(!Array.isArray(items)||!items.length||items.length>50)throw new Error('Supply 1–50 items');
  const products=(await pool.query('SELECT product_id,product_name,unit_price,status FROM products WHERE product_id=ANY($1::text[])',[items.map(x=>String(x.id))])).rows;
  const lines=items.map(item=>{const p=products.find(p=>String(p.product_id)===String(item.id)); if(!p||p.status!=='active')throw new Error(`Product unavailable: ${item.id}`); const qty=Number(item.qty??item.quantity??1);if(!Number.isSafeInteger(qty)||qty<1||qty>10000)throw new Error('Invalid quantity');const price=cents(p.unit_price); if(!Number.isSafeInteger(price*qty))throw new Error('Amount too large');return {...item,id:p.product_id,name:p.product_name,qty,price:price/100,remaining:price*qty};});
  const rules=(await pool.query("SELECT e.event_name,e.start_at,e.expires_at,p.* FROM promotion_discount_events p JOIN events e ON e.event_id=p.event_id WHERE e.status='active' AND e.event_type='promotion_discount' ORDER BY e.event_id")).rows.filter(r=>(!r.start_at||Date.parse(r.start_at)<=now())&&(!r.expires_at||Date.parse(r.expires_at)>now()));
  const subtotal=lines.reduce((n,l)=>n+l.remaining,0);let best={lines:structuredClone(lines),discount:0,applied:[]};
  const groups=[...rules.filter(r=>!Number(r.stackable)).map(r=>[r]),rules.filter(r=>Number(r.stackable))];
  for(const group of groups){const candidate=structuredClone(lines);let discount=0;const applied=[];for(const rule of group){const d=applyRule(candidate,rule);discount+=d;if(d)applied.push({eventId:String(rule.event_id),title:rule.event_name,discount:d/100});}if(discount>best.discount)best={lines:candidate,discount,applied};}
  const result={ok:true,subtotal:subtotal/100,discount:best.discount/100,total:(subtotal-best.discount)/100,applied:best.applied,items:best.lines.map(({remaining,...item})=>({...item,lineTotal:remaining/100,lineDiscount:(cents(item.price)*item.qty-remaining)/100}))};
  result.pricingKey=crypto.createHash('sha256').update(JSON.stringify({items:result.items.map(i=>[i.id,i.qty,i.price,i.lineTotal]),applied:result.applied})).digest('hex');return result;
 }
 return {quote};
}
module.exports={createPromotionPricingService,applyRule,ids};
