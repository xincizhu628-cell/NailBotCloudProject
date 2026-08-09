# Supabase/Postgres + Cloudflare R2 迁移指南

这份文档对应当前项目的正式迁移路线：

```text
GitHub：代码
Railway：运行 server.js
Supabase/Postgres：业务数据
Cloudflare R2：图片/素材文件
Railway Variables：各种访问密钥
```

## 1. 现在已经准备好的迁移文件

| 文件/目录 | 用途 |
| --- | --- |
| `database/schema.postgres.sql` | Supabase/Postgres 第一阶段建表脚本 |
| `migration_export/postgres_csv/` | 从本地 SQLite 导出的 54 张表 CSV |
| `migration_export/postgres_csv/manifest.json` | CSV 导出清单 |
| `migration_export/asset_manifest.csv` | 图片/素材上传清单 |
| `migration_export/asset_manifest.json` | 图片/素材数量和大小摘要 |
| `tools/generate_postgres_schema.py` | 重新生成 Postgres schema |
| `tools/export_sqlite_for_postgres.py` | 重新导出 SQLite 数据 |
| `tools/build_asset_manifest.py` | 重新生成素材清单 |
| `tools/extract_db_base64_assets.py` | 把数据库里的 base64 图片抽成文件 |
| `tools/import_csv_to_postgres.js` | 把 CSV 表数据导入 Supabase/Postgres |
| `tools/upload_assets_to_r2.js` | 把本地图片和抽出的数据库图片上传到 R2 |

## 2. 先买/开通 Supabase

1. 打开 https://supabase.com/
2. 创建一个新 project。
3. Project name 可以写：`nailbot-production`
4. Region 选离澳洲近的区域。如果有 Sydney/Australia 就选它；没有就选 Singapore。
5. 进入 Project 后，打开 SQL Editor。
6. 复制 `database/schema.postgres.sql` 内容并执行。

注意：这个 schema 是“第一阶段导入版”，为了先让数据进库，暂时没有加严格外键。等数据稳定后再加外键。

## 3. 把 CSV 导入 Supabase

导入目录：

```text
migration_export/postgres_csv/
```

建议先按这个顺序导入：

1. `users.csv`
2. `assets.csv`
3. 分类表：`styles.csv`、`shapes.csv`、`materials.csv`、`tags.csv`、`topics.csv`
4. 模板表：`templates.csv`、`official_galleries.csv`、`community_galleries.csv`、`personal_galleries.csv`、`gallery_templates.csv`
5. 活动任务：`events.csv`、`tasks.csv`、`task_*.csv`
6. 商品订单：`products.csv`、`orders.csv`、`order_items.csv`、`cart_items.csv`
7. 优惠奖励：`promotion.csv`、`user_promo.csv`、`coupons.csv`、`rewards.csv`
8. 其它表再导入。

如果 Supabase 界面导入某张表报错，先跳过那张，记录表名和错误。不要反复删库。

## 4. 开通 Cloudflare R2

1. 打开 https://dash.cloudflare.com/
2. 进入 R2。
3. 创建 bucket，建议名字：

```text
nailbot-assets
```

4. 打开 R2 API Tokens，创建访问密钥。
5. 记录这些信息：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

`R2_PUBLIC_BASE_URL` 最好绑定成类似：

```text
https://assets.nailbotau.com
```

## 5. 图片/素材上传逻辑

当前素材清单在：

```text
migration_export/asset_manifest.csv
```

里面每一行都有：

| 字段 | 含义 |
| --- | --- |
| `source` | 是本地文件，还是数据库里的 base64 图片 |
| `table` | 如果来自数据库，这里写来源表 |
| `record_id` | 对应数据 id |
| `local_path` | 本地文件路径 |
| `target_key` | 建议上传到 R2 的路径 |
| `current_url` | 现在数据库里的旧 URL |
| `needs_upload` | 是否要上传 |

上传完成后，要把数据库里这些字段改成 R2 URL：

- `assets.url`
- `products.image_url`
- `rewards.image_url`
- `promotional_assets.image_url`

并逐步清空这些 base64 字段：

- `assets.base64_data`
- `products.image_base64`
- `rewards.image_base64`
- `promotional_assets.image_base64`

这样页面会从云图片地址加载，不再让数据库背图片。

## 6. Railway 需要填的变量

在 Railway 当前项目中，打开：

```text
Service -> Variables
```

至少要填：

```text
NODE_ENV=production
PORT=4174
PUBLIC_BASE_URL=https://你的railway域名或nailbotau.com
DATABASE_URL=Supabase给你的Postgres连接串
SQUARE_ENV=production
SQUARE_APP_ID=...
SQUARE_LOCATION_ID=...
SQUARE_ACCESS_TOKEN=...
SQUARE_CURRENCY=AUD
SQUARE_COUNTRY=AU
```

图片迁移完成后再填：

```text
ASSET_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=nailbot-assets
R2_PUBLIC_BASE_URL=https://assets.nailbotau.com
```

## 6.1 本地执行上传前要填的变量

在本机 `.env` 里至少填：

```text
DATABASE_URL=你的 Supabase Postgres connection string
R2_ENDPOINT=https://你的 Cloudflare account id.r2.cloudflarestorage.com
R2_ACCOUNT_ID=你的 Cloudflare account id
R2_ACCESS_KEY_ID=你的 R2 access key
R2_SECRET_ACCESS_KEY=你的 R2 secret key
R2_BUCKET=nailbot-assets
R2_PUBLIC_BASE_URL=你的 R2 公开访问域名
```

然后执行：

```powershell
npm install
python tools\generate_postgres_schema.py
python tools\export_sqlite_for_postgres.py
python tools\extract_db_base64_assets.py
python tools\build_asset_manifest.py
npm run migrate:postgres
npm run migrate:assets
```

注意：`npm run migrate:assets` 上传完以后，会生成：

```text
migration_export/asset_upload_results.json
```

这个文件会记录每个素材对应的 R2 URL。下一步要用它批量更新数据库里的图片 URL。

## 7. 老版 SQLite 怎么保留

不要删掉本地 SQLite。

后面代码会改成：

```text
如果有 DATABASE_URL：连 Supabase/Postgres
如果没有 DATABASE_URL：继续连 data/nail_studio.db
```

这样：

- 本机开发照旧能跑
- Railway 正式版连云数据库
- 迁移期间可以两边对照，不会一刀切

## 8. 当前还没做的代码改造

现在迁移文件已经准备好，但后端代码还需要改造：

1. 新增统一数据库连接层。
2. 把 `sqlite3.connect(DB_PATH)` 逐步替换成连接层。
3. 把 SQL 参数占位符适配 SQLite/Postgres。
4. 把 `last_insert_rowid()` 替换为 Postgres 的 `RETURNING id`。
5. 把图片写入逻辑改成“上传到 R2，再保存 URL”。

这是下一阶段工作，不建议和创建 Supabase/R2 同时一口气做完。
