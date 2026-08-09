# NailBot 仓库整理清单

这份清单用于把当前项目整理成“可以上传、可以部署、不会把垃圾文件一起搬走”的状态。

## 1. 必须保留在代码仓库里的内容

| 内容 | 路径 |
| --- | --- |
| 主站页面 | `index.html`、`styles.css`、`app.js` |
| 独立页面 | `checkout.html`、`coupon-wallet.html`、`create-account.html`、`member-center.html`、`orders.html`、`profile.html`、`reward-mall.html`、`task-center.html`、`activity.html`、`campaign-detail.html` |
| B 端后台 | `admin.html`、`admin-login.html`、`admin-create-account.html` |
| 后端服务 | `server.js`、`services/` |
| 数据库脚本 | `database/*.py`、`database/schema.sql`、`database/README.md` |
| 邮箱/短信验证码 | `verification_sender.js` |
| 环境变量样板 | `.env.example`、`.env.production.example` |
| 正式文档 | `docs/` |
| 正式静态素材 | `assets/` |
| 材质底图归档 | `generated_nail_cutouts/`、`generated_nail_cutouts_ai/`，以后可搬到对象存储 |

## 2. 不应该上传到代码仓库的内容

| 内容 | 原因 |
| --- | --- |
| `.env`、`.env.production` | 里面有真实密钥 |
| `data/nail_studio.db` | 这是运行数据，不是代码；需要单独备份/迁移 |
| `.tmp_*/` | 临时切图缓存 |
| `__pycache__/` | Python 缓存 |
| `node_modules/` | 可通过 `npm install` 重新安装 |
| `outputs/`、`work/` | 过程输出，不属于正式代码 |
| `.agents/`、`.codex/` | Codex 工作区信息，不是网站代码 |
| `.zip`、`.tar.gz` | 打包产物，不应该反复进仓库 |

## 3. 当前仓库比较大的东西

| 路径 | 处理建议 |
| --- | --- |
| `data/nail_studio.db` | 单独备份。正式运营后迁移到 PostgreSQL |
| `assets/uploads/` | 用户/后台上传图，后期迁到 Cloudflare R2 或 S3 |
| `assets/materials/` | 正式素材，保留；后期迁到对象存储 |
| `.tmp_nail_*` | 确认不用后可以删除，不进仓库 |

## 4. 现在已经调整的规则

`.gitignore` 已经增加：

- 环境变量密钥
- Node 依赖
- 数据库文件
- Python 缓存
- 临时切图目录
- 打包文件
- Codex 工作区文件

这样以后上传代码时，不会把大部分垃圾文件和真实密钥一起上传。

## 5. 正式迁移前建议再做一次

1. 备份 `data/nail_studio.db`。
2. 备份 `assets/`。
3. 删除确认无用的 `.tmp_nail_*` 临时目录。
4. 把真实密钥只填进云服务的 Environment Variables，不要放进 Git。
5. 云服务器部署后，再决定是否把 `assets/uploads/` 迁移到对象存储。
