# 优惠券

优惠活动继续使用活动表；优惠券使用 `coupons`、`user_coupons`。`coupon_checkouts` 保存付款预留与重试结果，避免同一张券重复消费。数据库迁移：`database/migrations/20260910_coupons.sql`。

- 先计算有效商品活动，再应用一张用户优惠券；满减直接减金额，percent_off 按百分比减免（20 表示八折）。门槛按适用商品活动后的金额判断，仅优惠适用商品，不产生负数。
- 适用商品必选且支持多个；场景支持商城、积分兑换、任务奖励、第三方平台。购物车结算仅使用带“商城”场景的券。
- 免费赠品、买送使用所选赠品列表，每种一份；商品以零元显示并入单，模板在下单成功后写入个人收藏。
- 后台可创建、编辑、上下架、发放给指定用户、生成领取链接。同一优惠券每个用户最多领取一次。官方优惠券 ID 不返回 C 端钱包；选券使用用户关系记录 ID，并在服务端校验归属。
- 状态：生效前 inactive（未激活），生效后 unused（未使用），付款与订单完成后 used（已使用），到期未用 expired（已过期）。钱包读取、报价和每分钟后台刷新都会更新；已使用状态保留。
- 付款前建立待支付订单并绑定用户券；付款明确失败后解除绑定；结果不确定时保留预留，原请求重试使用相同支付编号。零元订单不发起扣款。

接口：

- GET /api/admin/coupons：后台列表、用户券关系与表单选项，需管理员登录。
- POST /api/admin/coupons：`{item:{...}}` 创建；`{action:"grant",id,userIds:[]}` 发放；`{action:"link",id}` 生成领取链接。
- PATCH /api/admin/coupons：`{id,item:{...}}` 编辑。
- POST /api/user/coupons：`{sessionId}` 读取本人钱包；增加 `action:"claim",token` 领取。
- POST /api/checkout-quote：`{items,sessionId,couponSelection}` 报价。
- POST /api/square-payment：沿用支付接口，传 couponSelection、pricingKey 与 idempotencyKey。

历史迁移保留旧优惠券字段和记录。旧记录缺少必填适用商品，转为未上架，管理员补齐后可上架。迁移只修正活动 9 错误合并的商品编号，不更改活动日期。

验证：`node --test --test-concurrency=1 tests/coupons.test.js tests/promotionPricing.test.js tests/orderCodes.test.js tests/userOrders.test.js tests/orderManagement.test.js`。测试使用独立临时数据库，不生成真实订单或扣款。
