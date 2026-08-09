# NailBot 数据迁移地图

这份文档按业务功能整理当前数据库。迁移时，先迁核心表，再迁图片和行为记录。

## 1. 用户与登录

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `users` | C 端用户资料、用户名、邮箱、手机号、密码 hash | 高 |
| `user_auth_sessions` | 用户当天登录 session | 中 |
| `auth_verification_codes` | 邮箱/短信验证码 | 中 |
| `addresses` | 用户邮寄地址 | 高 |
| `third_party_accounts` | Rednote/TikTok/Instagram 等绑定 | 中 |
| `admin_users` | B 端管理员账号 | 高 |
| `admin_sessions` | 管理员登录 session | 中 |

## 2. 会员、积分、奖励

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `members` | 会员等级、积分余额 | 高 |
| `achievements` | 成就配置 | 中 |
| `member_achievements` | 用户获得的成就 | 中 |
| `point_transactions` | 积分流水 | 高 |
| `rewards` | 积分商城 reward 商品 | 高 |
| `member_awards` | 用户获得的 reward/coupon | 高 |
| `reward_orders` | 积分兑换订单 | 高 |

## 3. 模板图库与素材

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `assets` | 图片/素材元数据和内容引用 | 高 |
| `templates` | 官方、社区、个人模板核心数据 | 高 |
| `official_galleries` | 官方图库分组 | 中 |
| `community_galleries` | 社区图库分组 | 中 |
| `personal_galleries` | 用户个人图库分组 | 中 |
| `gallery_templates` | 图库和模板之间的关系 | 高 |
| `draft_cache` | 画布草稿、自动保存草稿 | 高 |
| `styles` | 风格分类 | 中 |
| `shapes` | 甲形分类 | 中 |
| `materials` | 材质分类 | 中 |
| `tags` | 标签 | 中 |
| `topics` | 社区话题 | 中 |
| `taxonomy_links` | 模板/商品/活动与分类标签关系 | 高 |

## 4. 社区与互动

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `comments` | 模板详情页评论和二级回复 | 高 |
| `user_comments` | 用户评论记录 | 中 |
| `user_actions` | 点赞、收藏等行为 | 高 |
| `topics` | 社区话题 | 中 |

## 5. 活动、任务、优惠

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `events` | 活动主表 | 高 |
| `community_interaction_events` | 社区互动活动扩展 | 中 |
| `external_social_events` | 第三方社媒任务活动扩展 | 中 |
| `design_collection_events` | 设计征集活动扩展 | 中 |
| `promotion_discount_events` | 商品促销活动扩展 | 高 |
| `tasks` | 任务中心任务 | 高 |
| `task_condition_reward` | 任务条件和奖励规则 | 中 |
| `task_drafts` | 用户任务草稿 | 中 |
| `task_submissions` | 用户任务提交 | 高 |
| `task_records` | 用户任务记录 | 高 |
| `event_participation` | 用户参与活动记录 | 中 |
| `promotion` | 优惠券/福利券配置 | 高 |
| `user_promo` | 用户持有的优惠券/福利券关系 | 高 |
| `coupons` | 旧优惠券表/会员福利券表 | 中 |

注意：当前 `promotion.promo_type` 的 CHECK 枚举里有乱码，生产前建议改成稳定英文 code，比如 `money_off`、`percent_off`、`buy_x_get_y`、`free_product`，页面再翻译成中文/英文。

## 6. 商品、订单、支付

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `products` | 穿戴甲商品、库存、图片、配送/自提配置 | 高 |
| `cart_items` | 购物车 | 高 |
| `orders` | 商品订单主表 | 高 |
| `order_items` | 订单商品明细 | 高 |

正式支付上线后还建议补充：

- `payments`：记录 Square payment id、状态、金额、receipt URL
- `payment_webhook_events`：记录 Square webhook 原始事件，便于排错
- `refunds`：退款记录
- `pickup_codes`：自提码

## 7. 设备、打印、AI

| 表 | 用途 | 正式迁移优先级 |
| --- | --- | --- |
| `devices` | 打印机/售卖机设备列表 | 高 |
| `device_info` | 设备扩展信息 | 中 |
| `print_jobs` | 打印任务 | 高 |
| `ai_jobs` | AI 生图任务和错误记录 | 中 |

正式对接厂家时，建议补充：

- 设备鉴权 token/密钥表
- 打印任务状态回调记录
- 远程出货任务记录
- 设备库存同步记录

## 8. 迁移建议

短期：保留 SQLite，先把 `data/nail_studio.db` 整体备份和上传。

中期：迁移到 PostgreSQL，字段结构尽量沿用当前表名，减少前端改动。

长期：图片不要继续大量塞进数据库，改为对象存储 URL，数据库只保存图片地址、宽高、类型、归属关系。
