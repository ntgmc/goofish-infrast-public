# 服务器化迁移完成记录（原 Netlify 迁出计划）

状态：已完成。生产站点现在完全基于自托管服务器运行，不再使用 Netlify 承载站点、Functions 或 Blobs。

本文保留原迁移目标、最终落地架构和回溯检查项，用于后续运维、审计和故障恢复。当前生产说明以 [README.md](../README.md) 为准。

## 最终落地结论

| 项目 | 当前状态 |
| --- | --- |
| 部署形态 | 单机 Node 20 + PostgreSQL + systemd + Nginx |
| 前端 | Vite 构建到 `dist/`，由 Nginx 提供静态文件 |
| 后端 | `server/index.ts` 启动 Node HTTP 服务，默认监听 `127.0.0.1:3000` |
| API 路由 | `server/routes.ts` 显式注册 `/api/*` 路由 |
| 主存储 | PostgreSQL |
| 旧数据来源 | 历史 Netlify Blobs 导出 JSON |
| 旧 Netlify 配置 | 当前仅用于把历史 Netlify 域名永久跳转到 `https://maatool.com/`，不参与生产链路 |

## 当前请求链路

```text
Internet
  |
  v
Nginx
  |-- /api/* -> 127.0.0.1:3000
  |-- /*     -> /var/www/goofish-infrast-v1/dist

Node 20 backend
  |-- server/index.ts
  |-- server/routes.ts
  |-- reuses historical handlers from server/handlers/
  |-- reads and writes PostgreSQL through server/storage/

PostgreSQL
  |-- cdk_records
  |-- announcements
  |-- usage_events
  |-- admin_users
  |-- user-related tables
```

`server/handlers/` 仍是部分业务处理器的源码位置，这是历史目录名，不表示当前请求会进入 Netlify Functions。当前生产请求由 Node 服务器直接调用这些处理器。

## 已完成事项

- `/api` URL 兼容性已保留。
- Node 后端入口已落地到 `server/index.ts`。
- API 路由注册已落地到 `server/routes.ts`。
- PostgreSQL 存储层已落地到 `server/storage/`。
- 构建脚本已包含后端打包：`npm run build:server`。
- 完整构建已包含数据生成、前端构建和服务器构建：`npm run build`。
- 本地检查已包含服务器路由检查：`npm run check:local`。
- 迁移校验脚本已保留：`npm run check:migration`。
- Netlify Blobs 导出、PostgreSQL 导入和迁移验证脚本已保留用于审计或灾备。

## 生产环境变量

必须通过服务器环境变量、systemd `EnvironmentFile`、Docker secret 或等价 secret 管理方式注入。不要把真实值写入仓库、文档或日志。

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
HOST=127.0.0.1
```

不再作为生产依赖：

```text
NETLIFY_DEV
NETLIFY_BLOBS_CONTEXT
```

兼容底线：

- `MAA_ADMIN_SECRET` 必须与迁移前生产环境一致，否则旧授权文件签名校验会失败。
- `CDK_HASH_SECRET` 必须与迁移前生产环境一致，否则已生成 CDK 的 hash 查找会失败。
- `DATABASE_URL` 必须指向当前生产 PostgreSQL。

## PostgreSQL 基线

正式生产以 PostgreSQL 为唯一主存储。迁移脚本保留完整 JSON 字段以降低业务改动风险，并对常用查询字段建立索引。

核心数据域：

- CDK 记录
- 公告
- 使用事件
- 管理员账号
- 用户资料、授权状态和工作区数据

运维建议：

- PostgreSQL 独立运行，Node 后端只通过 `DATABASE_URL` 访问。
- 使用最小权限应用用户，例如 `goofish_app`。
- 定期执行 `pg_dump` 备份。
- 保留一次可信的历史导出 JSON，作为灾备和审计来源。

## Nginx 概念配置

生产环境 API 代理使用仓库内受管的
`deploy/nginx/goofish-api-production.conf` 片段。安装片段后，在现有站点的
`server {}` 中删除旧的 `/api/` location 并包含它：

```bash
sudo install -m 0644 deploy/nginx/goofish-api-production.conf /etc/nginx/snippets/goofish-api-production.conf
```

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /var/www/goofish-infrast-v1/dist;
  index index.html;

  include /etc/nginx/snippets/goofish-api-production.conf;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

`try_files $uri $uri/ /index.html;` 必须保留，否则 Vite SPA 路由刷新会 404。
受管片段将普通请求体限制为 256 KiB，并为 `/api/depot-value` 保留 1 MiB
限额。同步后运行 `sudo nginx -t`，检查成功再执行
`sudo systemctl reload nginx`。超过代理层限额的请求由 Nginx 直接返回 413，
响应正文可能使用 Nginx 默认格式。

## systemd 概念配置

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
Environment=HOST=127.0.0.1
EnvironmentFile=/etc/goofish-infrast-v1/backend.env

[Install]
WantedBy=multi-user.target
```

`backend.env` 中保存 `DATABASE_URL`、`MAA_ADMIN_PASSWORD`、`MAA_ADMIN_SECRET`、`CDK_HASH_SECRET` 等真实 secret，并设置为仅 root 或部署用户可读。

## 发布检查

1. 服务器拉取最新代码或接收构建产物。
2. 执行 `npm ci`。
3. 执行 `npm run build`。
4. 确认 `server/dist/index.js` 和 `dist/` 已生成。
5. 确认 `DATABASE_URL` 指向当前生产 PostgreSQL。
6. 重启 systemd 服务。
7. 检查服务日志无启动错误。
8. 访问 `GET /api/health`，确认 `ok=true` 且 `storage.type=postgres`。
9. 访问前端页面，确认刷新任意 SPA 路由不 404。
10. 验证核心 API 和后台页面。

## 验证清单

前端：

- 首页和工具页能打开。
- 刷新任意前端路由不 404。
- 公告列表和公告弹窗/banner 正常。
- 上传页、优化页、后台页能打开。

公开 API：

- `GET /api/health`
- `GET /api/data`
- `GET /api/announcement`
- `POST /api/usage-stats`
- `POST /api/analyze-schedule`
- `POST /api/free-preview`
- `POST /api/redeem-cdk`
- `POST /api/license-status`
- `POST /api/optimize`

后台 API：

- `GET`/`POST`/`PATCH`/`DELETE /api/admin/cdk`
- `GET`/`PUT /api/admin/risk-settings`
- `GET`/`POST`/`DELETE /api/admin/users`
- `GET`/`PUT /api/admin/announcement`
- `GET /api/admin/usage-stats`

用户 API：

- `/api/auth/*`
- `/api/user/*`

数据：

- 历史 CDK 可查询。
- 历史授权文件可校验。
- 公告数据存在。
- 使用统计可写入。
- 管理员账号可登录。

## 保留的历史脚本

| Script | 当前用途 |
| --- | --- |
| `scripts/export-netlify-blobs.mjs` | 从旧 Netlify Blobs 导出历史数据，主要用于审计或灾备重放。 |
| `scripts/import-postgres.mjs` | 将导出 JSON 导入 PostgreSQL。 |
| `scripts/verify-migrated-data.mjs` | 校验 PostgreSQL 迁移数据。 |
| `scripts/check-build-relevance.mjs` | 历史命名的发布相关性判断脚本，当前仅用于 GitHub Actions 跳过无关构建。 |

## 回滚说明

当前生产链路不依赖 Netlify。只有在明确需要恢复历史部署形态时，才参考 `netlify.toml` 和旧导出数据做人工回滚。回滚前必须先确认：

- 当前 PostgreSQL 已备份。
- 回滚窗口内禁止产生新的写入。
- `MAA_ADMIN_SECRET` 和 `CDK_HASH_SECRET` 与历史环境一致。
- DNS 或反向代理切换路径明确。

除非发生严重生产故障，不建议把 Netlify 重新作为主生产链路。当前 Netlify 站点只应保留 redirect-only 配置，避免旧前端继续暴露给用户。
