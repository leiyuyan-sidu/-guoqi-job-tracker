# 国央企校招信息看板

每天自动抓取国聘（iguopin.com）和国务院国资委官网的央企/国企校园招聘岗位，用规则+大模型判断哪些岗位符合"国际商务硕士、已过英语四六级"的报名条件，展示在一个静态网页上，可以标记"已投递/不投递"。

## 目录结构

- `scraper/` 抓取 + 匹配逻辑，Python，由 GitHub Actions 每天定时跑一次
- `supabase/schema.sql` 数据表结构，在 Supabase 项目里跑一次即可
- `docs/` 前端静态页面，GitHub Pages 直接从这个目录发布
- `.github/workflows/daily.yml` 每日定时任务配置

## 首次搭建步骤

### 1. 创建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com)，免费注册/登录，New Project
2. 项目建好后，进入 SQL Editor，把 [`supabase/schema.sql`](supabase/schema.sql) 的内容粘贴进去执行一次，会建好 `jobs` 表
3. 左侧 Authentication → Providers，确认 Email 登录是打开的（默认就是打开的）
4. 左侧 Authentication → Users → Add user，手动创建一个你自己的账号（邮箱+密码），这是你后面登录网页、标记"已投递/不投递"用的账号——**不要用别的账号注册**，因为 RLS 只区分"登录/未登录"，谁登录都能改状态
5. 左侧 Settings → API，记下两样东西：
   - Project URL
   - anon public key（不是 service_role key）
   - service_role key（另存起来，下一步要用，**这个不能公开**）

### 2. 配置前端

复制 `docs/config.example.js` 为 `docs/config.js`，把上一步的 Project URL 和 anon public key 填进去。`config.js` 可以直接提交到仓库——anon key 设计上就是给前端公开用的，真正的权限控制在 Supabase 的 RLS 规则里（未登录只能读，登录之后才能改投递状态）。

### 3. 配置 GitHub Secrets（抓取脚本要用）

仓库 Settings → Secrets and variables → Actions → New repository secret，依次添加：

- `SUPABASE_URL`：同上的 Project URL
- `SUPABASE_SERVICE_KEY`：上一步的 service_role key（这个有完整数据库权限，只能放在 Secrets 里，绝对不能出现在代码或网页里）
- `OPENROUTER_API_KEY`：你的 OpenRouter API key，去 [openrouter.ai](https://openrouter.ai) 注册申请，用于给规则判断不出来的岗位做语义匹配（通过 OpenRouter 调用 Claude Haiku 模型）。之所以用 OpenRouter 中转而不直接用 Anthropic/DeepSeek 官方 API，是因为 Anthropic 官网注册需要境外资质，DeepSeek 官方 API 又从 GitHub Actions（海外机房）访问经常连接超时，OpenRouter 作为国际中转平台注册门槛低、连通性也稳定

### 4. 开启 GitHub Pages

仓库 Settings → Pages → Source 选择 "Deploy from a branch"，Branch 选 `main`，文件夹选 `/docs`，保存。几分钟后就能在给出的网址访问。

### 5. 手动跑一次抓取

仓库 Actions 标签页 → 选择 "每日抓取国央企校招岗位" → Run workflow，手动触发一次，跑完之后刷新网页就能看到数据了。之后每天北京时间 6:00 会自动跑。

## 本地开发/调试抓取脚本

```bash
cd scraper
pip install -r requirements.txt
set SUPABASE_URL=...
set SUPABASE_SERVICE_KEY=...
set OPENROUTER_API_KEY=...
python main.py
```

## 匹配规则说明

- `scraper/config.py` 里的 `ELIGIBLE_MAJOR_KEYWORDS` 是"直接判定可报名"的专业关键词白名单（对照岗位的结构化专业要求字段，不是岗位描述正文），命中就直接算符合，不用调用模型
- 规则判不出来的岗位，交给 `scraper/llm_match.py` 用大模型结合完整岗位描述判断
- `LOW_EDUCATION_LEVELS` / `EXCLUDED_TITLE_KEYWORDS` 用来排除大专/中专学历要求或厨师、技工、司机等蓝领/技能岗位，这些不进入专业匹配环节，直接判定不符合
- `DISLIKED_KEYWORDS`（证券、会计）命中后不影响"是否可报名"的判断，只是在网页上会带一个"不感兴趣"的灰色标签，方便你一眼跳过——不会自动帮你点"不投递"，那个按钮还是要你自己点
- 已经判断过的岗位（不管是否符合）都会存进数据库，第二天再抓到同一个岗位时不会重复调用大模型，省钱也省时间

## 数据来源

- **国聘**（`scraper/sources/guopin.py`）：公开 JSON 接口，有结构化的专业/学历字段，规则命中不了才交给大模型
- **国务院国资委官网**（`scraper/sources/sasac.py`）："人事招聘"栏目，混杂校招/社招/中层管理招聘，先按标题关键词（校招/校园招聘/应届/毕业生）粗筛，公告正文是无结构文字，专业、学历、招聘单位都交给大模型从文字里提取；少数公告是招聘海报图片、没有文字，这种会把图片直接传给大模型识别
