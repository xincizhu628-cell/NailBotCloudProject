const crypto=require('node:crypto');
function createCouponCheckoutService({pool,coupons,payment,createOrder,getSession}){
 async function pay(body){const session=await getSession(body.sessionId);if(!session.ok)throw Error('请先登录');const userId=session.user.userId,key=String(body.idempotencyKey||'');if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))throw Error('付款请求编号无效');
 let attempt=(await pool.query('SELECT * FROM coupon_checkouts WHERE checkout_id=$1 AND user_id=$2',[key,userId])).rows[0];
 if(attempt && (attempt.user_coupon_id!==body.couponSelection || attempt.quote.pricingKey!==body.pricingKey))throw Error('有未完成的原付款，请恢复原订单后重试');
 if(!attempt){const quote=await coupons.quote(body.items,userId,body.couponSelection);if(quote.pricingKey!==body.pricingKey||Math.round(Number(body.amount)*100)!==Math.round(quote.total*100))throw Error('优惠或金额已变化，请刷新报价');
 attempt=await coupons.transaction(async c=>{
  const row=(await c.query('SELECT u.*,c.updated_at,c.status AS listing_status,c.start_date,c.expiry_date FROM user_coupons u JOIN coupons c ON c.coupon_id=u.coupon_id WHERE user_coupon_id=$1 AND user_id=$2 FOR UPDATE OF u,c',[body.couponSelection,userId])).rows[0];
  const same=(await c.query('SELECT * FROM coupon_checkouts WHERE checkout_id=$1 AND user_id=$2',[key,userId])).rows[0];if(same)return same;
  if(!row||row.coupon_use_status!=='unused'||row.checkout_id||row.listing_status!=='published'||(row.start_date&&Date.parse(row.start_date)>Date.now())||(row.expiry_date&&Date.parse(row.expiry_date)<=Date.now()))throw Error('优惠券已使用或有待完成的付款，请先完成原订单');
  if(new Date(row.updated_at).toISOString()!==quote.couponRevision)throw Error('优惠券已修改，请刷新报价');
  const id='order_'+crypto.randomUUID().replace(/-/g,'');await c.query("INSERT INTO orders(order_id,user_id,total_price,payment_status) VALUES($1,$2,$3,'pending')",[id,userId,quote.total]);
  await c.query('UPDATE user_coupons SET order_id=$1,checkout_id=$2 WHERE user_coupon_id=$3',[id,key,row.user_coupon_id]);
  const {sessionId: omittedSession, ...savedBody}=body; const request={...savedBody,amount:quote.total,currency:payment.browserConfig().currency,items:quote.items,idempotencyKey:key};
  return (await c.query('INSERT INTO coupon_checkouts(checkout_id,user_coupon_id,user_id,order_id,quote,payment_request) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[key,row.user_coupon_id,userId,id,JSON.stringify(quote),JSON.stringify(request)])).rows[0];
 });}
 if(attempt.status==='paid')return attempt.payment_result;
 if(attempt.status==='failed')return attempt.payment_result;
 // Retrying an uncertain payment uses exactly the same saved provider request and key.
 let result=attempt.payment_result;
 if(!result){result=Number(attempt.quote.total)===0?{httpStatus:200,body:{ok:true,paymentId:'coupon_zero_'+key,status:'COMPLETED',amount:0,currency:payment.browserConfig().currency}}:await payment.createPayment(attempt.payment_request);
 if(result.body?.ok && result.body.status==='COMPLETED')await pool.query('UPDATE coupon_checkouts SET payment_result=$1 WHERE checkout_id=$2',[JSON.stringify(result),key]);
 else {
  const definitive=[400,402,422].includes(result.httpStatus);
  if(definitive)await coupons.transaction(async c=>{await c.query("UPDATE coupon_checkouts SET status='failed',payment_result=$1 WHERE checkout_id=$2 AND status='reserved'",[JSON.stringify(result),key]);await c.query("UPDATE user_coupons SET order_id=NULL,checkout_id=NULL WHERE checkout_id=$1 AND coupon_use_status<>'used'",[key]);await c.query("UPDATE orders SET payment_status='failed' WHERE order_id=$1 AND payment_status='pending'",[attempt.order_id]);});
  return {...result,body:{...result.body,ok:false,retrySameAttempt:!definitive,error:result.body.error||'支付尚未确认成功，请重试原付款'}};
 }
 }
 const orderBody={...attempt.payment_request,sessionId:body.sessionId,reservedOrderId:attempt.order_id,couponSelection:attempt.user_coupon_id,couponUserId:userId,couponRewardTemplates:attempt.quote.rewardTemplates||[]};
 try{const order=await createOrder(orderBody,result.body);result={...result,body:{...result.body,order}};await pool.query("UPDATE coupon_checkouts SET status='paid',payment_result=$1,payment_request=payment_request-'sourceId' WHERE checkout_id=$2",[JSON.stringify(result),key]);return result;}
 catch(error){return {httpStatus:503,body:{ok:false,error:'支付已成功，订单正在完成，请用原付款重试。',retrySameAttempt:true}};}
 }
 return {pay};
}
module.exports={createCouponCheckoutService};
