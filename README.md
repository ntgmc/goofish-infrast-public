# goofish-infrast-v1

[![Quality Checks](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml)

MAA 基建排班优化器是一个面向《明日方舟》玩家的 Web 工具。用户拿到 CDK 后在网站上传干员数据并生成授权文件；已有授权文件或工作文件时可直接上传继续使用。应用会根据干员、基建房间、产物需求和无人机策略计算可导入 MAA 的排班 JSON，并给出精英化升级建议。

## 在线地址

- Production: <https://maatool.com/>

## 当前架构

生产环境已经完全切换为自托管服务器，不再使用 Netlify 承载站点、函数或数据存储。

```text
Internet
  |
  v
Nginx
  |-- /api/*  -> Node 20 backend on 127.0.0.1:3000
  |-- /*      -> Vite static files in dist/

Node backend
  |-- server/index.ts
  |-- server/routes.ts
  |-- PostgreSQL storage layer

PostgreSQL
  |-- CDK records
  |-- announcements
  |-- usage events
  |-- admin users
  |-- user profiles and workspace data
```

`netlify/` 目录目前只是历史兼容目录：部分业务处理器仍放在 `netlify/functions/` 下并由 `server/routes.ts` 复用，但生产请求由 Node 服务器直接处理，不经过 Netlify Functions。`netlify.toml` 仅作为遗留回滚配置保留。

## 技术栈

- React 18
- TypeScript
- Vite 6
- Tailwind CSS 4
- Node.js 20 backend
- PostgreSQL
- Nginx + systemd

## 本地开发

安装依赖：

```bash
npm install
```

启动前端开发服务器：

```bash
npm run dev
```

开发命令会先执行 `npm run generate:data`，生成前端和后端优化接口共享的效率数据。

本地 API 服务器需要先构建后端：

```bash
npm run build:server
npm run start:server
```

默认监听地址是 `http://127.0.0.1:3000`。可以通过 `PORT` 和 `HOST` 覆盖监听配置。

## 构建与检查

生产构建：

```bash
npm run build
```

该命令会依次生成规则数据、构建 Vite 前端，并打包 `server/` 后端。

本地完整检查：

```bash
npm run check:local
```

`check:local` 会执行生产构建、兼容处理器 smoke check，并检查服务器注册的 API 路由是否完整。

迁移数据校验：

```bash
npm run check:migration
```

该命令会构建项目、检查服务器路由，并运行 PostgreSQL 迁移数据验证脚本。

## Quality Checks

仓库使用 GitHub Actions 执行质量检查，配置文件位于 `.github/workflows/quality-checks.yml`。Quality Checks 会在以下场景触发：

- 向 `main` 发起 pull request
- 推送到 `main`
- 推送到 `dev`
- 手动触发 Quality Checks

检查项：

| Job | Command | Purpose |
| --- | --- | --- |
| `Deploy Relevance` | `npm run check:deploy-relevance` | 判断本次变更是否需要继续运行构建检查。脚本名沿用历史命名，不代表当前使用 Netlify 部署。 |
| `Web Build` | `npm run build` | 生成效率数据、执行 TypeScript 检查、构建 Vite 前端并打包 Node 后端。 |
| `Functions Smoke Test` | `npm run generate:data` + `npm run check:functions` | 验证仍被服务器复用的历史处理器可以被打包和调用。 |

`Web Build` 和 `Functions Smoke Test` 只在 `Deploy Relevance` 判断为需要部署相关检查时运行。只修改文档或仓库元数据时，Quality Checks 会保留发布相关性检查，但跳过构建和 smoke test。

另外，仓库使用 GitHub Actions 在 PR 创建、重新打开、更新 commit 或标记 ready 时，根据 PR 内 commit message 自动更新 PR description。配置文件位于 `.github/workflows/pr-details.yml`。该流程只维护 PR description 中 `<!-- pr-details:start -->` `<!-- pr-details:end -->` 之间的自动生成区块，区块外的人工内容会保留。

## 服务器 API

`server/routes.ts` 显式注册所有 `/api` 路由，并把请求分发到对应处理器。当前核心路由包括：

- `GET /api/health`
- `GET /api/data`
- `GET /api/announcement`
- `GET`/`PUT /api/admin/announcement`
- `POST /api/usage-stats`
- `GET /api/admin/usage-stats`
- `GET`/`POST`/`PATCH`/`DELETE /api/admin/cdk`
- `GET`/`POST`/`DELETE /api/admin/users`
- `POST /api/analyze-schedule`
- `POST /api/free-preview`
- `POST /api/redeem-cdk`
- `POST /api/license-status`
- `POST /api/optimize`
- `/api/auth/*`
- `/api/user/*`

`GET /api/health` 会检查 PostgreSQL 连接，并返回后端版本和存储状态。

## 发布流程

当前生产发布以服务器为准，不再使用 Netlify Git-based deploy。

推荐流程：

1. 在 `dev` 或功能分支完成开发。
2. 本地运行 `npm run check:local`。
3. 向 `main` 发起 pull request。
4. 等待 GitHub Actions Quality Checks 通过。
5. 合并到 `main`。
6. 在服务器拉取最新代码或发布构建产物。
7. 在服务器执行 `npm ci`、`npm run build`。
8. 确认环境变量和 PostgreSQL 可用。
9. 重启 Node 后端服务。
10. 访问 <https://maatool.com/>，并检查 `/api/health` 与核心接口。

生产环境建议由 Nginx 提供静态文件和 TLS，并把 `/api/` 反向代理到 Node 后端：

```nginx
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
```

## 环境变量

不要把真实密钥提交到仓库、文档或日志。生产环境请通过 systemd `EnvironmentFile`、服务器环境变量或等价的 secret 管理方式注入。

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL 连接字符串 |
| `MAA_ADMIN_PASSWORD` | Yes | 管理后台主口令 |
| `CDK_HASH_SECRET` | Yes | CDK 哈希计算密钥 |
| `MAA_ADMIN_SECRET` | Yes | 授权文件签名密钥 |
| `PORT` | No | Node 后端监听端口，默认 `3000` |
| `HOST` | No | Node 后端监听地址，默认 `127.0.0.1` |
| `APP_VERSION` | No | 同时覆盖前端和后端版本号 |
| `FRONTEND_VERSION` | No | 前端版本号 |
| `BACKEND_VERSION` | No | 后端版本号 |
| `DATA_VERSION` | No | 规则数据版本号 |
| `GENERATED_AT` | No | 规则数据生成时间 |
| `VERSION_SOURCE_SHA` | No | 用于生成版本元数据的源提交 |
| `GIT_SHA` | No | 版本对应的 Git 提交 |
| `BUILD_NUMBER` | No | 生成版本号时使用的构建序号 |
| `BUILD_CONTEXT` | No | 构建上下文 |
| `REFRESH_BUILD_METADATA` | No | 启用版本元数据刷新模式，等同于传入 `--refresh-metadata` |

`npm run generate:data` 会根据版本变量生成 `src/lib/build-meta.ts`，并在 `netlify/functions/data.ts` 中写入 `data_version`、`generated_at` 和来源摘要。该输出文件路径仍沿用历史目录名，但数据会被 Node 服务器通过 `/api/data` 提供。

## 数据迁移与运维脚本

从 Netlify Blobs 到 PostgreSQL 的迁移已经完成。相关脚本保留用于审计、重放或灾备：

| Script | Purpose |
| --- | --- |
| `scripts/export-netlify-blobs.mjs` | 从旧 Netlify Blobs 导出历史数据。 |
| `scripts/import-postgres.mjs` | 将导出 JSON 导入 PostgreSQL。 |
| `scripts/verify-migrated-data.mjs` | 校验 PostgreSQL 中的迁移数据。 |
| `scripts/check-server-routes.mjs` | 校验 Node 服务器 API 路由注册完整性。 |
| `scripts/build-server.mjs` | 打包服务器入口和路由模块。 |

## 项目结构

- `src/`: React 前端页面、组件和客户端逻辑
- `server/`: Node HTTP 入口、API 路由和 PostgreSQL 存储层
- `netlify/functions/`: 历史处理器兼容目录，当前由 Node 服务器直接复用
- `scripts/`: 数据生成、服务器构建、迁移导入导出和检查脚本
- `public/`: 静态资源
- `.github/workflows/`: GitHub Actions 工作流
- `dist/`: Vite 构建产物
- `server/dist/`: 服务器构建产物
