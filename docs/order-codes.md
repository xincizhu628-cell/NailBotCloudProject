# 订单打印码与取货码（2026-09-07）

## 当前交付与上线前步骤

已读取 Supabase public schema：迁移前 54 张表、487 个字段，核对订单字段、主键、约束、索引、RLS 和触发器。已执行新增码表迁移。云端回滚事务验证了按数量生成、普通订单、唯一性、重复调用、确认版本顺序；测试订单未保留。厂家接口尚未提供，确认协议如下为待对接协议。新服务代码仍在本地，尚未发布到线上网站。

1. 在项目 `.env` 配置 DATABASE_URL（不要提交 Git），执行 `npm run inspect:schema`。读取 work/supabase-schema.json，比对线上表、列、约束、索引、RLS、触发器后再迁移。脚本只导出元数据。
2. 执行 `npm run migrate:order-codes`。事务内执行 database/migrations/20260907_order_codes.sql，可重复执行，不重新导入整个数据库。
3. 设置独立高强度 ADMIN_CODE_API_TOKEN、MANUFACTURER_CODES_API_TOKEN。现有项目后台登录被注释，新接口独立鉴权；令牌仅留在页面内存，不写 localStorage。
4. 启动服务。后台「打印码」「取货码」输入管理令牌，刷新、输入订单 ID 生成、分页、删除。订单创建自动调用两类生成服务，无需手工点按钮。
5. 厂家提供地址后配置 MANUFACTURER_CONFIRM_API_URL（绝对 HTTPS URL）和 MANUFACTURER_API_TOKEN。默认 api/confirm 是占位，不发送网络请求。轮询默认 5 秒、10 秒超时、最多 60 秒退避，不重叠请求；多进程通过事务级 advisory lock 协调。

## 数据设计

表名严格为 `"print-code"` 和 `"pickup-code"`。列沿用项目下划线命名：id、code、use_status、sync_status、order_id。未激活/已激活保存为 inactive/active；同步状态为 pending/success/fail。码是六字符字符串，保留前导零。

打印码额外记录 order_item_id、product_id、unit_number，以便准确对应每一件商品并避免重复生成。取货码对 order_id 有 UNIQUE 约束。两表都有 created_at、updated_at、confirm_version。

order_code_registry 是全局唯一码登记表：加密随机生成候选值，通过主键索引 INSERT ON CONFLICT DO NOTHING 竞争，不下载整表、不做先查后插。碰撞重试，128 次仍冲突则报错并回滚。打印/取货码相互也不会重复。迁移预留订单旧字段中的六位码，但不自动把历史单个打印码拆成多条记录；历史订单是否补码需根据线上数据另行确定。

六位数字最多一百万种组合。删除时保留登记，防止旧码被厂家误用于新订单，因此长期需要规划扩位或有确认作废流程的回收机制。后台删除不会自动撤销厂家已缓存的数据，当前厂家尚未给出撤销协议。

## 订单业务

Square 支付成功 -> 事务内锁定支付 ID -> 已有订单直接返回 -> 保存订单商品快照 -> 读取快照商品名（以服务端产品名为准） -> 名称不区分大小写包含 printing 时每件生成一码 -> 每单生成一个取货码 -> 同事务提交。

普通商品不生成打印码。AI 内置打印服务名称补上 `(printing available)`，符合相同匹配规则。数量必须是正整数。重复付款回调使用同一 paymentId 返回原订单；重复码生成按商品行/件序号和 order_id 复用原码。删码后管理员可再次执行生成，补齐缺少的码。

保留 orders.print_code（首个打印码）和 orders.pickup_code 兼容旧前端；订单响应新增 printCodes 数组和 pickupCodeRecord 数据对象，打印记录响应也提供 printCodes。旧订单级 manufacturer_sync_status 独立于各码的同步状态，不能把发送订单成功视作所有码已同步。

## 厂家读取接口

`GET /api/manufacturer/codes?type=print&after_id=0&limit=100`

请求头 `Authorization: Bearer <MANUFACTURER_CODES_API_TOKEN>`。type 可为 print/pickup。返回 `{ok:true, rows:[完整码记录], next_after_id:"100"}`。每页最多 500 条。

该接口是分页快照，不是持久事件流。厂家持续轮询两种类型；每个完整扫描周期从 after_id=0 重新开始，以免事务提交顺序不同造成漏码，并按 type+id 去重。空页或不足一页表示本轮结束。厂家应核对已删除记录，并在使用前确认记录仍存在；撤销推送需未来商定。

## 厂家确认接口（待厂家实现）

本服务 GET `<MANUFACTURER_CONFIRM_API_URL>?cursor=<上次游标>`，请求头 `Authorization: Bearer <MANUFACTURER_API_TOKEN>`。

厂家返回示例：

```json
{
  "cursor": "event-123",
  "updates": [{
    "type": "print",
    "id": "1",
    "code": "001234",
    "order_id": "order_example",
    "use_status": "active",
    "sync_status": "success",
    "version": 2
  }]
}
```

每条记录 version 从 1 开始，状态变化递增；必须包含 type/id/code/order_id 四项标识，防止混淆。每批最多 1000 条。游标必须可重放，厂家不能仅因 GET 就永久删除事件；我们可能在收到消息后、事务提交前中断。状态更新和游标同事务提交，失败会重试旧游标。旧版本/重复版本忽略，已删除的码不重建。无更新时返回空 updates 和有效字符串游标。

同步未配置或请求失败不会把码误标为 success；厂家明确返回 fail 才改为 fail。使用状态同样仅按厂家确认变化。

## 管理接口

`/api/admin/order-codes` 使用 `Authorization: Bearer <ADMIN_CODE_API_TOKEN>`。

- GET：与厂家接口相同分页参数。
- POST：`{"type":"print","order_id":"..."}`，补齐该订单打印码；type=pickup 获取或生成唯一取货码。返回 printCodes、pickupCode 对象。
- DELETE：`{"type":"print","id":"1"}`。实际删除码行、更新订单兼容字段，保留登记。厂家接口不允许修改或删除。

## 验证

`npm run test:order-codes` 使用 PGlite 的 PostgreSQL 引擎，运行真实迁移与 SQL，无须连接生产数据库。覆盖数量、普通单、前导零、重复请求、碰撞重试、整体回滚、删后补齐、确认版本/游标、接口鉴权、实际 createPaidOrderRecord 函数。

PGlite 单连接测试不能代替真实 Supabase 多连接并发测试。上线前还需云端 schema 核对、迁移、真实并发验证及厂家协议联调。

参考：PostgreSQL INSERT / ON CONFLICT https://www.postgresql.org/docs/current/sql-insert.html；Supabase RLS https://supabase.com/docs/guides/database/postgres/row-level-security 。
