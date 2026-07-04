# Netlify 迁出最终迁移计划

> 状态：基于当前本地代码校准后的最终推荐方案。本文已按最终决策更新：存储使用 PostgreSQL，部署形态和上线切换使用默认推荐方案。

## 已确定的 3 个决策

| 决策 | 默认推荐 | 备选 | 影响 |
| --- | --- | --- | --- |
| 部署形态 | 单机 Node 20 + PostgreSQL + systemd + Nginx | Docker Compose + Caddy/Nginx；云托管 Node 平台 | 单机方案改动最小，适合当前 Vite 静态站 + 小型 API；PostgreSQL 作为独立服务运行，后续迁移到托管数据库或多实例也更顺。 |
| 主存储 | PostgreSQL | SQLite；本地 JSON 文件 | PostgreSQL 是正式生产存储，支持更稳妥的并发、备份、索引和后续扩容；SQLite 只保留为低并发单机备选；本地 JSON 只适合作临时过渡。 |
| 上线切换 | 维护窗口切换 | 并行灰度；直接切换 | 维护窗口期间暂停写入，导出 Netlify Blobs 后导入 PostgreSQL，再切 DNS，数据一致性风险最低。 |

默认落地结论：使用 **Node 20 + Hono/Node HTTP 适配层 + PostgreSQL + Nginx + systemd + certbot**。前端继续 `npm run build` 输出 `dist`，Nginx 托管静态文件并把 `/api/*` 反代到本机 Node 后端，Node 后端通过 `DATABASE_URL` 访问 PostgreSQL。

## 本地代码校准结论

不能完全照搬初稿。根据当前仓库，迁移面如下：

- `netlify.toml` 中构建命令是 `npm run build`，发布目录是 `dist`，Node 版本是 20。
- `netlify.toml` 中函数目录是 `netlify/functions`，并把 `/api/*` rewrite 到 Netlify Functions。
- 前端在 `src/pages` 中使用同域相对路径 `/api/...`，因此迁移后必须继续保持同域 `/api` 路由，避免大改前端。
- 当前 Netlify Functions 大多已经是标准 Web API 形态：`Request -> Response`，适合用 Node 后端做一层适配，而不是第一阶段重写业务逻辑。
- 初稿漏掉了 `admin-users`：当前存在 `/api/admin/users` 和 `maa-admin-users`，迁移计划必须包含后台子账号数据。
- 当前存储不止 3 个 Netlify Blobs store，至少包括 `maa-cdks`、`maa-announcements`、`maa-usage-events`、`maa-admin-users`。

## 目标架构

```text
Internet
  |
  v
Nginx / Caddy
  |-- /api/*  -> 127.0.0.1:3000
  |-- /*      -> /var/www/goofish-infrast-v1/dist

Node 20 后端
  |-- 路由兼容现有 /api/*
  |-- 调用或迁移 netlify/functions 中的业务逻辑
|-- 通过 Repository/Store 访问 PostgreSQL

PostgreSQL
  |-- cdk_records
  |-- announcements
  |-- usage_events
  |-- admin_users
```

第一阶段目标不是重构业务，而是安全迁出 Netlify：

- 保留 `/api` URL 兼容性。
- 尽量复用现有 `netlify/functions/*.ts` 的业务逻辑。
- 把 `@netlify/blobs` 存储替换为可自主管理的 PostgreSQL。
- 保持旧授权文件可校验，避免已有用户授权失效。

## 必须保留的 API 路由

| 路由 | 方法 | 当前来源 | 迁移要求 |
| --- | --- | --- | --- |
| `/api/admin/cdk` | `GET`/`POST`/`PATCH`/`DELETE` | `netlify/functions/admin-cdk.ts` | 保留后台 CDK 查询、生成、更新、删除能力。 |
| `/api/admin/users` | `GET`/`POST`/`DELETE` | `netlify/functions/admin-users.ts` | 初稿漏项，必须迁移后台子账号管理。 |
| `/api/announcement` | `GET` | `netlify/functions/announcement.ts` | 保留前台公告读取。 |
| `/api/admin/announcement` | `GET`/`PUT` | `announcement.ts?admin=1` rewrite | 新 Node 路由要显式补齐 admin 语义。 |
| `/api/usage-stats` | `POST` | `netlify/functions/usage-stats.ts` | 保留访问和生成事件记录。 |
| `/api/admin/usage-stats` | `GET` | `usage-stats.ts?admin=1` rewrite | 新 Node 路由要显式补齐 admin 语义。 |
| `/api/analyze-schedule` | `POST` | `netlify/functions/analyze-schedule.ts` | 保留上传分析。 |
| `/api/free-preview` | `POST` | `netlify/functions/free-preview.ts` | 保留免费预览。 |
| `/api/license-status` | `POST` | `netlify/functions/license-status.ts` | 保留授权校验、重签、风控状态。 |
| `/api/optimize` | `POST` | `netlify/functions/optimize.ts` | 保留核心优化接口。 |
| `/api/redeem-cdk` | `POST` | `netlify/functions/redeem-cdk.ts` | 保留 CDK 兑换和授权文件生成。 |
| `/api/data` | `POST` | `netlify/functions/data.ts` | 由 Netlify wildcard 暴露，迁移时保留以免兼容问题。 |

特别注意：

- `/api/admin/announcement` 不是独立函数，当前通过 rewrite 到 `announcement?admin=1` 实现。
- `/api/admin/usage-stats` 不是独立函数，当前通过 rewrite 到 `usage-stats?admin=1` 实现。
- 新 Node 后端必须用真实路由复制这两个行为，不能只做 `:splat` 映射。

## 存储迁移方案

### 推荐新表

| Netlify Blobs store | 当前用途 | PostgreSQL 表 |
| --- | --- | --- |
| `maa-cdks` | CDK、授权状态、风控、升级/撤销、使用次数、订单 hash | `cdk_records` |
| `maa-announcements` | 当前公告配置，包含 banner/popup 数据 | `announcements` |
| `maa-usage-events` | 访问、生成、兑换等统计事件 | `usage_events` |
| `maa-admin-users` | 后台子账号、密码 hash、salt、迭代次数 | `admin_users` |

推荐表设计方向：

```sql
CREATE TABLE cdk_records (
  key TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  permission TEXT NOT NULL,
  license_order_hash TEXT,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE INDEX idx_cdk_records_status ON cdk_records(status);
CREATE INDEX idx_cdk_records_license_order_hash ON cdk_records(license_order_hash);

CREATE TABLE announcements (
  key TEXT PRIMARY KEY,
  data_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE usage_events (
  key TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  visitor_id TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  record_json JSONB NOT NULL
);

CREATE INDEX idx_usage_events_date ON usage_events(date);
CREATE INDEX idx_usage_events_event ON usage_events(event);

CREATE TABLE admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

说明：

- 第一阶段建议保留完整 JSONB 字段，降低业务改动。
- 对查询频繁的字段建立索引，特别是 `status`、`license_order_hash`、`date`。
- 不建议正式生产长期使用 `.netlify/local-*` 文件 fallback。它们只适合本地开发或紧急临时过渡。

## 环境变量与兼容要求

必须迁移到新服务器环境变量、systemd Environment、Docker secret 或不提交的 `.env` 中：

```text
NODE_ENV=production
DATABASE_URL=postgresql://goofish_app:...@127.0.0.1:5432/goofish_infrast_v1
MAA_ADMIN_PASSWORD=...
MAA_ADMIN_SECRET=...
CDK_HASH_SECRET=...
```

可选：

```text
BACKEND_VERSION=...
APP_VERSION=...
PORT=3000
```

迁移后不应再依赖：

```text
NETLIFY_DEV
NETLIFY_BLOBS_CONTEXT
```

兼容底线：

- `MAA_ADMIN_SECRET` 必须和旧 Netlify 生产环境一致，否则旧授权文件签名校验会失败。
- `CDK_HASH_SECRET` 必须和旧 Netlify 生产环境一致，否则已生成 CDK 的 hash 查找会失败。
- `MAA_ADMIN_PASSWORD` 建议保持一致，至少迁移验证期间保持一致。
- 不要把任何真实 secret 写入仓库、文档或日志。

## 代码改造步骤

### 第 1 步：新增 Node 后端入口

新增建议文件：

```text
server/index.ts
server/netlify-adapter.ts
server/routes.ts
```

实现要点：

- Node 后端监听 `127.0.0.1:3000` 或环境变量 `PORT`。
- `server/routes.ts` 显式注册所有 `/api` 路由。
- `server/netlify-adapter.ts` 把 Node/Hono 请求转换为标准 `Request`，调用现有函数的 default export，再把 `Response` 写回客户端。
- `OPTIONS`、JSON body、query string、headers、真实客户端 IP 都要保留。
- `x-forwarded-for`、`x-real-ip`、`cf-connecting-ip` 等头要从反代传入，避免风控逻辑丢失客户端信号。

第一阶段可以继续 import：

```text
netlify/functions/admin-cdk.ts
netlify/functions/admin-users.ts
netlify/functions/announcement.ts
netlify/functions/usage-stats.ts
netlify/functions/analyze-schedule.ts
netlify/functions/free-preview.ts
netlify/functions/license-status.ts
netlify/functions/optimize.ts
netlify/functions/redeem-cdk.ts
netlify/functions/data.ts
```

### 第 2 步：抽象存储层

优先改造这些现有存储入口：

```text
netlify/functions/license-utils.ts
netlify/functions/announcement.ts
netlify/functions/usage-stats.ts
netlify/functions/admin-auth.ts
```

建议新增：

```text
server/storage/postgres.ts
server/storage/cdk-store.ts
server/storage/announcement-store.ts
server/storage/usage-store.ts
server/storage/admin-user-store.ts
```

改造原则：

- 不在业务函数里继续直接判断 Netlify Blobs context。
- 保留现有 store 接口能力：`get`、`set`、`delete`、`list`。
- 让业务层不用知道数据来自 Netlify Blobs、PostgreSQL 还是本地文件。
- 迁移完成后，`@netlify/blobs` 仅作为导出脚本依赖保留，或完全移除。

### 第 3 步：新增数据导出导入脚本

建议新增：

```text
scripts/export-netlify-blobs.mjs
scripts/import-postgres.mjs
scripts/verify-migrated-data.mjs
```

导出内容：

```text
maa-cdks/cdk/*.json
maa-announcements/current.json
maa-usage-events/events/**/*.json
maa-admin-users/users/*.json
```

导入要求：

- 导入前备份旧导出 JSON。
- 导入后校验数量、关键字段、随机抽样记录。
- 对 `cdk_records.license_order_hash` 建索引后，验证旧授权文件可以通过 `/api/license-status` 查到对应记录。

### 第 4 步：调整 package scripts

建议新增脚本，不要直接破坏现有 `build`：

```json
{
  "scripts": {
    "build:web": "tsc && vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "build": "npm run generate:data && npm run build:web && npm run build:server",
    "start:server": "node server/dist/index.js",
    "check:migration": "npm run build && node scripts/verify-migrated-data.mjs"
  }
}
```

实际脚本以最终实现为准。当前仓库已有：

```text
npm run build
npm run check:functions
npm run check:local
```

迁移期间应保留这些检查，直到新后端检查覆盖所有核心接口。

## 部署计划

### 服务器目录建议

```text
/opt/goofish-infrast-v1              # 代码或构建产物
/var/www/goofish-infrast-v1/dist     # Vite 静态文件
/var/lib/goofish-infrast-v1          # 导出数据、迁移中间文件、PostgreSQL 备份
/var/log/goofish-infrast-v1          # 后端日志
```

### PostgreSQL 基线

- PostgreSQL 作为同机独立服务运行，Node 后端只通过 `DATABASE_URL` 连接，不直接读写数据库数据目录。
- 创建独立数据库和最小权限应用用户，例如数据库 `goofish_infrast_v1`、用户 `goofish_app`；真实密码只放在服务器环境变量或 `EnvironmentFile` 中。
- 迁移前先跑建表 SQL，再导入 Netlify Blobs 导出的 JSON；导入完成后执行数量、索引、旧授权文件校验。
- 切换前使用 `pg_dump` 保存 PostgreSQL 备份，并保留原始 Blobs 导出 JSON 作为二次恢复来源。

### Nginx 概念配置

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /var/www/goofish-infrast-v1/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

`try_files $uri $uri/ /index.html;` 必须保留，否则 Vite SPA 路由刷新会 404。

### systemd 概念配置

```ini
[Unit]
Description=goofish-infrast-v1 backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
WorkingDirectory=/opt/goofish-infrast-v1
ExecStart=/usr/bin/node /opt/goofish-infrast-v1/server/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_URL=postgresql://goofish_app:...@127.0.0.1:5432/goofish_infrast_v1
Environment=MAA_ADMIN_PASSWORD=...
Environment=MAA_ADMIN_SECRET=...
Environment=CDK_HASH_SECRET=...

[Install]
WantedBy=multi-user.target
```

真实 secret 不写入仓库。生产中可以改用 `EnvironmentFile=/etc/goofish-infrast-v1/backend.env`，并设置文件权限为 root 可读。

## 上线切换流程

1. 在新服务器部署代码、Node 20、PostgreSQL、Nginx、systemd 和必要目录。
2. 配置生产环境变量，确保 `MAA_ADMIN_SECRET` 和 `CDK_HASH_SECRET` 与 Netlify 生产一致。
3. 构建前端和后端。
4. 在 Netlify 侧进入维护窗口：暂停会产生写入的后台操作和兑换操作。
5. 从 Netlify Blobs 导出 `maa-cdks`、`maa-announcements`、`maa-usage-events`、`maa-admin-users`。
6. 导入 PostgreSQL。
7. 启动新 Node 后端，只用临时域名或 hosts 访问验证。
8. 跑完整验证清单。
9. 切 DNS 或反代入口。
10. 观察日志和核心接口，保留旧 Netlify 站点一段时间作为回滚入口。

## 验证清单

前端：

- 首页和工具页能打开。
- 刷新任意前端路由不 404。
- 公告列表和公告弹窗/banner 正常。
- 上传页、优化页、后台页能打开。

公开 API：

- `GET /api/announcement`
- `POST /api/usage-stats`
- `POST /api/analyze-schedule`
- `POST /api/free-preview`
- `POST /api/redeem-cdk`
- `POST /api/license-status`
- `POST /api/optimize`
- `POST /api/data`

后台 API：

- `GET /api/admin/cdk?status=all`
- `POST /api/admin/cdk`
- `PATCH /api/admin/cdk`
- `DELETE /api/admin/cdk`
- `GET /api/admin/announcement`
- `PUT /api/admin/announcement`
- `GET /api/admin/usage-stats`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `DELETE /api/admin/users`

数据兼容：

- 已生成但未使用的 CDK 仍可兑换。
- 已使用、冻结、撤销的 CDK 状态保持不变。
- 旧授权文件仍可通过 `/api/license-status` 校验。
- `advanced` 授权的设备/浏览器/IP 风控逻辑仍可读写记录。
- 公告配置迁移后内容一致。
- 使用统计迁移后总量和最近 7 天统计一致。
- 后台子账号仍可登录，root 口令仍可创建/删除子账号。

## 回滚方案

- 切换前保留 Netlify 旧站点和 Blobs 数据不删除。
- 切 DNS 前保存 PostgreSQL 备份和导出 JSON。
- 如果新站核心接口异常，立即把 DNS 或入口反代切回 Netlify。
- 若切换期间新站已经产生写入，回滚前必须导出 PostgreSQL 中新增写入并决定是否补回旧系统，避免数据分叉。

## 风险点

- `MAA_ADMIN_SECRET` 不一致会导致旧授权文件签名校验失败。
- `CDK_HASH_SECRET` 不一致会导致旧 CDK hash 查找失败。
- 遗漏 `maa-admin-users` 会导致后台子账号丢失。
- 遗漏 `/api/admin/announcement` 和 `/api/admin/usage-stats` 的 admin 语义会导致后台读写异常。
- 没有传递真实客户端 IP 头会影响 advanced 授权的风控判断。
- 直接使用本地 JSON 文件长期生产会有并发写入和备份风险。
- 没有维护窗口直接切换，可能出现 Netlify Blobs 与 PostgreSQL 双边写入的数据分叉。

## 最终推荐执行顺序

1. 按已确定决策执行：单机 Node 20 + PostgreSQL + systemd + Nginx，维护窗口切换。
2. 新增 Node 后端入口和 `/api` 路由适配。
3. 新增 PostgreSQL store，替换 Netlify Blobs 访问。
4. 新增 Blobs 导出、PostgreSQL 导入和迁移校验脚本。
5. 保留并扩展本地检查：`npm run build`、`npm run check:functions`、核心 API smoke test。
6. 在新服务器部署并通过临时域名验证。
7. 开维护窗口，导出、导入、验证、切 DNS。
8. 观察一段时间后，再删除 Netlify 专用配置和依赖。

