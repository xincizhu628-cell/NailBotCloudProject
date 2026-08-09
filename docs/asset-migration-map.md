# NailBot 图片和素材迁移地图

现在项目里图片素材比较多，这份文档用于区分哪些是正式素材，哪些只是开发缓存。

## 1. 需要保留并迁移的素材

| 位置 | 内容 | 建议迁移位置 |
| --- | --- | --- |
| `assets/materials/` | 甲片材质图、材质缩略图 | 对象存储，如 Cloudflare R2 |
| `assets/materials/fitted/` | 已适配画布的材质底图 | 对象存储，并保留文件名编号规则 |
| `assets/official_template_assets/` | 官方模板素材 | 对象存储 |
| `assets/uploads/` | 用户/B 端上传的图片 | 对象存储 |
| `assets/hand-preview-base.jpg` | AI 实景预览手部底图 | 静态资源或对象存储 |
| `assets/nailbot-logo-white.png` | 首页白色 logo | 静态资源 |
| `generated_nail_cutouts/` | 旧版甲片切图 | 可以归档 |
| `generated_nail_cutouts_ai/` | AI 处理过的甲片切图 | 可以归档或迁移 |

## 2. 不建议迁移的临时目录

这些目录主要是中间产物，正式部署前可以不搬：

- `.tmp_nail_cutouts_loose/`
- `.tmp_nail_cutouts_loose_fast/`
- `.tmp_nail_sources/`
- `.tmp_nail_split_loose/`
- `.tmp_nail_split_loose_2/`
- `.tmp_nail_split_scaled/`
- `.tmp_nail_split_scaled_2/`
- `.tmp_nail_split_scaled_3/`
- `.tmp_nail_split_scaled_4/`

## 3. 文件名规则需要保留

画布底图现在依赖材质编号和手指编号：

```text
123--1.png
123--2.png
123--3.png
123--4.png
123--5.png
```

其中：

- `123` 是材质编号
- `1` 到 `5` 是大拇指到小指

迁移到对象存储后，也建议继续保留这个命名规则，或者在数据库里增加清晰字段：

| 字段 | 示例 |
| --- | --- |
| `material_code` | `123` |
| `finger_index` | `1` |
| `asset_url` | `https://assets.nailbotau.com/materials/123--1.png` |
| `asset_width` | `512` |
| `asset_height` | `768` |

## 4. 图片迁移优先级

1. 商品图：影响商城展示和购买。
2. 模板图：影响图库、画布引用、打印。
3. 画布材质底图：影响 D2 画布体验。
4. 活动 banner：影响首页、商城、社区活动展示。
5. 用户上传图：影响个人图库和社区内容。

## 5. 生产建议

当前数据库大小已经超过 100MB，说明图片/素材可能有不少内容保存在数据库或本地。正式运营后建议：

- 原图放对象存储。
- 页面列表优先加载缩略图。
- 点开详情时再加载高清图。
- 数据库只保存 URL、宽高、类型、归属用户/模板。
- 所有上传图片生成缩略图，避免商品列表一次加载 100 多张高清图。
