# NailBot 正式迁移清单

这份文档的目的：把现在这台电脑里的开发版项目，整理成以后可以搬到正式服务器的清单。它不是一次性必须全做完的任务，而是上线前逐步检查用的表。

## 1. 当前项目由哪些部分组成

| 类别 | 当前位置 | 迁移时怎么处理 |
| --- | --- | --- |
| C 端网页 | `index.html`、`styles.css`、`app.js`、`checkout.html`、`coupon-wallet.html` 等 | 放到正式服务器，继续由 Node 服务托管，或以后拆成静态前端 |
| B 端后台 | `admin.html`、`admin-login.html`、`admin-create-account.html` | 放到正式服务器，但上线前要加更严格的管理员权限 |
| 后端入口 | `server.js` | 正式服务器用 `npm start` 启动，后期建议用 PM2 / systemd 托管 |
| 支付服务 | `services/squarePaymentService.js` | 已经是可配置结构，生产密钥放环境变量 |
| 数据库 | `data/nail_studio.db`、`database/schema.sql`、`database/*.py` | 短期可继续 SQLite；正式运营建议迁到 PostgreSQL |
| 图片素材 | `assets/`、`generated_nail_cutouts*`、上传图片 | 短期可跟项目一起部署；正式运营建议迁到 Cloudflare R2/S3 |
| AI 生成 | Hugging Face / Ark / SeedEdit 配置 | 密钥只放服务器环境变量，不放代码 |
| 邮箱/短信验证码 | `verification_sender.js` + SMTP/Twilio env | 生产前必须换成正式发送账号 |
| Cloudflare Tunnel | `docs/cloudflare-tunnel-nailbotau.md` | 临时公网访问可用；正式运营建议迁到云服务器后再接域名 |

## 2. 不要搬到生产环境的东西

这些是开发辅助或临时文件，不应该进正式部署包：

- `.git/`
- `.agents/`
- `.codex/`
- `.tmp_*`
- `database/__pycache__/`
- 本地测试截图、剪贴板图片
- `.env` 真实密钥文件

## 3. 推荐上线顺序

1. 先备份当前项目文件夹和 `data/nail_studio.db`。
2. 把代码上传到 Git 仓库，排除 `.env` 和临时图片。
3. 准备云服务器，安装 Node.js 和 Python。
4. 在服务器上创建 `.env`，内容参考 `.env.production.example`。
5. 先用当前 SQLite 数据库跑通网站。
6. 再把图片素材迁移到对象存储。
7. 最后把 SQLite 迁移到 PostgreSQL。
8. 接入 Square webhook、订单状态、退款、打印设备接口。

## 4. 正式环境最低配置建议

| 用途 | 建议 |
| --- | --- |
| 临时试运营 | 1 台云服务器，2 vCPU / 4GB RAM / 80GB SSD |
| 正式运营初期 | 1 台应用服务器 + 托管 PostgreSQL + 对象存储 |
| 图片多/AI 多 | 图片不要放数据库，放 R2/S3；数据库只存 URL 和元数据 |
| 支付 | Square Production + Webhook + 订单表落库 |
| 监控 | 至少加错误日志、访问日志、自动重启 |

## 5. 上线前必须确认

- `PUBLIC_BASE_URL` 已设置为 `https://nailbotau.com`
- Square 是 production 环境，并且 webhook 配好
- `.env` 没有被上传到公开仓库
- 管理员账号不是默认密码
- 用户密码已经使用 hash 存储
- 图片上传大小有限制
- 支付成功后能创建订单
- 订单退款、取消、失败状态都有记录
- 打印/取货设备接口即使失败，也会给用户明确状态

## 6. 现在代码是否需要大改

不用马上大改。现在最现实的路线是：

1. 先保持现有结构，把它稳定跑在云服务器上。
2. 再把图片从本地文件/数据库拆到对象存储。
3. 最后把数据库从 SQLite 升级到 PostgreSQL。

这样不会把现在已经做好的页面推倒重来。
