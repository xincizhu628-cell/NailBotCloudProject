# NailBot 云服务购买/开通链接

下面是当前项目从“本机演示”迁移到“正式运营”最可能需要的服务。建议先买/开通最小组合，不要一口气把所有高级服务都买满。

## 1. 必买：应用服务器

用途：让 `server.js` 后端和网页 24 小时在线，不依赖你自己的电脑。

推荐优先看：

- Railway: https://railway.com/
- Railway pricing: https://docs.railway.com/pricing/plans
- Railway PostgreSQL docs: https://docs.railway.com/databases/postgresql

备选：

- Render: https://render.com/
- Render pricing: https://render.com/pricing
- Render free deploy docs: https://render.com/docs/free
- Render Postgres docs: https://render.com/docs/postgresql

我的建议：先选 Railway Hobby 或 Render 付费 Web Service。免费服务可以测试，但不要当正式运营。

## 2. 建议买：云数据库 PostgreSQL

用途：替代现在的 `data/nail_studio.db`，让用户、订单、模板、优惠券数据更安全。

可选：

- Supabase: https://supabase.com/
- Supabase pricing: https://supabase.com/pricing
- Railway PostgreSQL: https://docs.railway.com/databases/postgresql
- Render Postgres: https://render.com/docs/postgresql

我的建议：如果应用服务器选 Railway，就先用 Railway PostgreSQL，少折腾。以后数据量变大再换 Supabase/独立 PostgreSQL。

## 3. 建议买/开通：图片对象存储

用途：存商品图、模板图、用户上传图、AI 生成图。不要长期把高清图片都压在服务器和数据库里。

推荐：

- Cloudflare R2: https://www.cloudflare.com/developer-platform/products/r2/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/

官方价格重点：R2 有免费额度，Standard storage 每月 10GB 免费，且公网 egress 免费；超出后按存储和请求收费。

## 4. 已经要用：支付 Square

用途：网站在线收款、订单付款。

链接：

- Square Australia pricing: https://squareup.com/au/en/pricing
- Square processing fees: https://squareup.com/au/en/payments/our-fees
- Square Developer Dashboard: https://developer.squareup.com/apps
- Square Developer Docs: https://developer.squareup.com/docs

官方价格重点：Square Free plan 是 $0/月，但每笔交易收处理费；澳洲在线/远程支付页面显示为 2.2% per transaction。

## 5. 用户验证码：邮箱服务

用途：创建账号、忘记密码、修改邮箱/手机号。

推荐先用邮箱验证码，短信稍后再上。

- Resend: https://resend.com/
- Resend pricing: https://resend.com/pricing

官方价格重点：Resend Free 有 3,000 emails/month，但每天 100 封限制；Pro 从 $20/月起。

## 6. 用户验证码：短信服务

用途：手机号验证码。短信成本比邮箱高，建议等业务稳定再开。

- Twilio: https://www.twilio.com/
- Twilio Australia SMS pricing: https://www.twilio.com/en-us/sms/pricing/au

官方价格重点：澳洲短信是按条收费，价格会随号码类型、运营商等变化。

## 7. 域名和 DNS

你已经买了：

- `nailbotau.com`

需要继续使用：

- Cloudflare dashboard: https://dash.cloudflare.com/
- Cloudflare Pages: https://pages.cloudflare.com/
- Cloudflare pricing: https://www.cloudflare.com/plans/

现在 Cloudflare Tunnel 可以临时把本机暴露出去，但正式运营建议让域名指向云服务器，不再依赖本机。

## 最小购买组合

如果今天就要开始买，我建议：

1. Railway Hobby 或 Render 付费 Web Service
2. Railway PostgreSQL 或 Supabase Pro
3. Cloudflare R2
4. Square 保持 production 配置
5. Resend Free/Pro

短信 Twilio 可以晚一点再买。
