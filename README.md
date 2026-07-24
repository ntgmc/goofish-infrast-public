# goofish-infrast-v1

[![Quality Checks](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml)

MAA 基建排班优化器是一个面向《明日方舟》玩家的 Web 工具。用户登录后可创建免费档案或使用 CDK 添加账号档案，并通过 MAA 干员识别文件或森空岛导入账号数据。应用会自动保存账号工作区，根据干员、基建房间、产物需求和无人机策略计算可导入 MAA 的排班 JSON，并给出精英化升级建议。单账号终身版还提供场景对比实验室，可比较 153/243/333、龙门币/合成玉贸易、赤金/经验/源石碎片制造、自动非固定或固定换班以及无人机策略，并输出等效理智与实际每日换班次数的两阶段 Pareto 前沿。

## 在线地址

- Production: <https://maatool.com/>

## 当前架构

生产环境完全基于自托管服务器运行，前端由 Nginx 提供静态文件，后端由 Node.js 服务处理 API，数据存储使用 PostgreSQL。

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

`server/handlers/` 存放标准 Web API 处理器，`server/routes.ts` 负责注册和分发 `/api/*` 请求。

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

`start:server` 会从仓库根目录的 `.env` 加载本地后端配置，并通过非生产的 `APP_ROLE=all` 组合入口同时启动 API 和优化 worker。本地 API 至少需要 PostgreSQL 连接；森空岛扫码和凭据导入还需要一把稳定的本地加密密钥：

```text
DATABASE_URL=postgresql://<本地用户>:<本地密码>@127.0.0.1:5432/<本地数据库>
SKLAND_CREDENTIAL_SECRET=<至少 16 个字符的本地随机值>
```

推荐使用 `openssl rand -hex 32` 生成，并在本地数据库仍需读取既有森空岛绑定期间保持该值不变。修改 `.env` 后必须重新构建并重启 API 服务器；仅重启 Vite 不会刷新后端环境变量。不要提交 `.env` 或把本地密钥复用到 dev/production。

默认监听地址是 `http://127.0.0.1:3000`，Vite 的 `/api` 请求会代理到该地址。可以通过 `PORT` 和 `HOST` 覆盖监听配置。

如需像生产环境一样拆分进程，可分别运行：

```bash
npm run start:api
npm run start:worker
```

`start:api` 使用 API-only 的 `server/dist/index.js`，`start:worker` 使用独立的 `server/dist/worker.js`。combined 的 `server/dist/all.js` 默认只用于本地开发；production mode 只有在 `APP_ROLE=all` 且显式设置 `ALLOW_PRODUCTION_COMBINED_PROCESS=true` 时才允许启动。该例外仅供 `dev.maatool.com` 在本机消费自己的优化队列，正式生产仍保持 API 与杭州 worker 分离。

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
| `Build Relevance` | `npm run check:build-relevance` | 判断本次变更是否需要继续运行构建检查。 |
| `Web Build` | `npm run build` | 生成效率数据、执行 TypeScript 检查、构建 Vite 前端并打包 Node 后端。 |
| `API Smoke Test` | `npm run generate:data` + `npm run check:api` | 验证服务器 API 处理器可以被打包和调用。 |

`Web Build` 和 `API Smoke Test` 只在 `Build Relevance` 判断为需要构建相关检查时运行。只修改文档或仓库元数据时，Quality Checks 会保留构建相关性检查，但跳过构建和 smoke test。

另外，仓库使用 GitHub Actions 在 PR 创建、重新打开、更新 commit 或标记 ready 时，根据 PR 内 commit message 自动更新 PR description。配置文件位于 `.github/workflows/pr-details.yml`。该流程只维护 PR description 中 `<!-- pr-details:start -->` `<!-- pr-details:end -->` 之间的自动生成区块，区块外的人工内容会保留。

## 自动部署

生产部署由 `.github/workflows/deploy-production.yml` 触发，并在自托管服务器上执行 `scripts/deploy-production.sh`。`main` 的 Quality Checks 通过后会自动 SSH 到服务器，完成拉取代码、安装依赖、生产构建、重启 systemd 服务和 `/api/health` 健康检查。

服务器准备步骤、GitHub Secrets/Variables 和故障处理见 [Production Deploy Workflow](docs/production-deploy.md)。

## 服务器 API

`server/routes.ts` 显式注册所有 `/api` 路由，并把请求分发到对应处理器。当前核心路由包括：

- `GET /api/health`
- `GET /api/data`
- `GET /api/announcement`
- `GET`/`PUT /api/admin/announcement`
- `POST /api/usage-stats`
- `GET /api/admin/usage-stats`
- `GET`/`POST`/`PATCH`/`DELETE /api/admin/cdk`
- `GET`/`PUT /api/admin/risk-settings`
- `GET`/`POST`/`DELETE /api/admin/users`
- `POST /api/user/profiles/preview`
- `POST /api/optimize`
- `/api/auth/*`
- `/api/user/*`

`GET /api/health` 会检查 PostgreSQL 连接，并返回后端版本和存储状态。

## 发布流程

当前生产发布以服务器为准。

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

生产环境建议由 Nginx 提供静态文件和 TLS，并使用仓库内受管的
`deploy/nginx/goofish-api-production.conf` 片段把 `/api/` 反向代理到 Node 后端。
该片段将普通请求体限制为 256 KiB，为 `/api/depot-value` 保留 1 MiB 限额，
并配合 `deploy/nginx/goofish-rate-limit-zones.conf` 限制登录与管理认证洪泛。
`deploy/nginx/goofish-security-headers.conf` 为静态页面、API 和 Nginx 自身错误响应
提供统一的 CSP、HSTS、frame、MIME、referrer 和 Permissions Policy 基线。
`deploy/nginx/goofish-static-files.conf` 将 `/assets/` 与 SPA 路由分开：哈希资源
只允许命中真实文件并长期缓存，HTML 文档保持可重新验证。
`deploy/nginx/goofish-canonical-redirect.conf` 用于独立的 HTTP 和 `www` HTTPS
重定向 server，将别名域名永久跳转到 `https://maatool.com` 并保留完整路径与查询参数。

先把 zone 配置安装到 Nginx 的 `http {}` 上下文，再安装 server 片段：

```bash
sudo install -m 0644 deploy/nginx/goofish-rate-limit-zones.conf /etc/nginx/conf.d/goofish-rate-limit-zones.conf
sudo install -m 0644 deploy/nginx/goofish-api-production.conf /etc/nginx/snippets/goofish-api-production.conf
sudo install -m 0644 deploy/nginx/goofish-canonical-redirect.conf /etc/nginx/snippets/goofish-canonical-redirect.conf
sudo install -m 0644 deploy/nginx/goofish-proxy-common.conf /etc/nginx/snippets/goofish-proxy-common.conf
sudo install -m 0644 deploy/nginx/goofish-server-hardening.conf /etc/nginx/snippets/goofish-server-hardening.conf
sudo install -m 0644 deploy/nginx/goofish-security-headers.conf /etc/nginx/snippets/goofish-security-headers.conf
sudo install -m 0644 deploy/nginx/goofish-static-files.conf /etc/nginx/snippets/goofish-static-files.conf
```

如果当前 Nginx 不在 `http {}` 中加载 `/etc/nginx/conf.d/*.conf`，需要在
`nginx.conf` 的 `http {}` 中显式包含该 zone 文件。

然后在现有 HTTPS `server {}` 中删除旧的 `/api/` location，并包含 API 与安全头
片段。安全头片段包含一年 `includeSubDomains` HSTS，不得放入纯 HTTP 重定向 server：

```nginx
include /etc/nginx/snippets/goofish-server-hardening.conf;
include /etc/nginx/snippets/goofish-security-headers.conf;
include /etc/nginx/snippets/goofish-api-production.conf;
include /etc/nginx/snippets/goofish-static-files.conf;
```

生产站点应为 `www.maatool.com` 配置独立的 HTTPS redirect server（证书必须覆盖该
域名），并在该 server 与 HTTP redirect server 中包含
`goofish-canonical-redirect.conf`。完整配置示例见
`docs/production-deploy.md`。

应用前必须检查配置，检查成功后再平滑重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

首次切换后，对生产和 dev HTTPS vhost 分别运行公网验收。它会检查 `/`、`/tool`、
`/api/health` 的安全头、首页引用的真实 JS/CSS 缓存，以及不存在 asset 是否为 404：

```bash
node scripts/check-public-http-smoke.mjs https://maatool.com
node scripts/check-public-http-smoke.mjs https://dev.maatool.com
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.maatool.com/tool?source=www-check'
```

最后一条命令应输出 `308 https://maatool.com/tool?source=www-check`。

超过请求体限额时由 Nginx 直接返回 413；登录或管理认证请求超过 IP 速率时
返回 429。代理层响应正文可能使用 Nginx 默认格式，但仍会携带统一安全头。
浏览器 API 已固定为完全同源，不再返回任何 `Access-Control-Allow-*`；外部浏览器
应用必须经同源反向代理访问，服务器端客户端不受浏览器 CORS 限制。

## 密码存储

新注册、密码重置、密码修改及管理员账号创建统一使用 Argon2id，密码哈希以标准
PHC 字符串保存。参数固定为 Argon2 版本 19、`memoryCost=19456 KiB`、
`timeCost=2`、`parallelism=1`、32 字节输出和 16 字节随机 salt；运行时不提供
降级为 PBKDF2 或放宽参数的环境变量。

历史 PBKDF2-SHA256（120,000 次）记录无需数据库 schema 迁移，仍可正常验证。
用户登录或管理员认证成功后，服务会以旧哈希为条件，最佳努力地原子写回 Argon2id；
并发密码修改或写回失败不会覆盖新密码，也不会阻断已经验证成功的认证，下次成功认证
会再次尝试。无法在没有明文密码的情况下离线批量迁移。

服务端构建将 `@node-rs/argon2` 保留为运行时依赖，由 `npm ci` 安装 Windows、
Linux glibc/musl 及 ARM 对应的预编译原生包，不需要 node-gyp/postinstall 编译链。
发布时必须连同 `node_modules` 中匹配目标平台的原生包部署；如果目标平台无法加载该包，
构建或服务启动会明确失败，不会静默回退到 PBKDF2。密码派生和验证仍受全局有界队列
约束：最多 2 个活动任务和 32 个等待任务，两个并发 Argon2id 任务的主要内存开销约
38 MiB。

## 管理员会话

管理后台登录通过 `POST /api/admin/session` 创建独立的 PostgreSQL 会话。浏览器只保存
`maa_admin_session` 不透明 Cookie；Cookie 使用 `HttpOnly`、`SameSite=Strict` 和
`Path=/api/admin`，生产环境额外使用 `Secure`。数据库只保存 32 字节随机 token 的
SHA-256 摘要，不保存原始 token。会话在闲置 30 分钟或登录满 8 小时后失效，且不设置
持久化 Cookie，关闭浏览器即退出。

旧的 `X-Admin-User`、`X-Admin-Password`、`admin_user` 和 `admin_password` 认证方式
已移除。自动化脚本必须先登录并使用 Cookie jar，例如：

```bash
curl -fsS -c admin.cookies \
  -H 'Content-Type: application/json' \
  -d '{"username":"ADMIN_USERNAME","password":"ADMIN_PASSWORD"}' \
  https://maatool.com/api/admin/session
curl -fsS -b admin.cookies https://maatool.com/api/admin/users
curl -fsS -X DELETE -b admin.cookies https://maatool.com/api/admin/session
rm -f admin.cookies
```

`MAA_ADMIN_PASSWORD` 仍只用于创建、替换和删除管理员账号，不会创建后台会话。生产服务
必须设置 `NODE_ENV=production` 并通过 TLS 访问，以启用 `Secure` Cookie。现有 Nginx
`^~ /api/admin/` 代理片段会自动转发 Cookie 和 `Set-Cookie`，无需增加新的 location。

## 环境变量

不要把真实密钥提交到仓库、文档或日志。生产环境请通过 systemd `EnvironmentFile`、服务器环境变量或等价的 secret 管理方式注入。

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL 连接字符串 |
| `NODE_ENV` | Production | 生产环境必须设为 `production`，启用安全 Cookie 和生产保护 |
| `APP_ROLE` | Production | 进程角色：正式生产首尔后端为 `api`、杭州计算节点为 `worker`；本地开发和受控 dev combined 进程使用 `all` |
| `ALLOW_PRODUCTION_COMBINED_PROCESS` | Dev only | 仅 `dev.maatool.com` 的 combined systemd 服务设为 `true`；正式生产不得设置 |
| `MAA_ADMIN_PASSWORD` | Yes | 管理后台主口令 |
| `CDK_HASH_SECRET` | Yes | CDK 哈希计算密钥 |
| `MAA_ADMIN_SECRET` | Yes | 优化任务轮询令牌签名密钥 |
| `DEPOT_SAMPLE_HASH_SECRET` | Yes | 仓库匿名样本哈希密钥，不得复用 CDK 密钥 |
| `FREE_PREVIEW_UID_HASH_SECRET` | Yes | 免费领取 UID 哈希密钥，不得复用 CDK 密钥 |
| `SKLAND_CREDENTIAL_SECRET` | Yes | 森空岛凭据加密密钥，长度至少 16 字符 |
| `CDK_HASH_SECRET_PREVIOUS` | No | CDK 轮换期间的前代密钥 |
| `MAA_ADMIN_SECRET_PREVIOUS` | No | 授权签名轮换期间的前代密钥 |
| `SKLAND_CREDENTIAL_SECRET_PREVIOUS` | No | 森空岛凭据轮换期间的前代密钥 |
| `PUBLIC_APP_URL` | Yes | 公开站点根地址，用于生成密码重置和邮箱验证链接 |
| `BREVO_API_KEY` | Yes | Brevo 事务邮件 API 密钥 |
| `BREVO_SENDER_EMAIL` | Yes | 事务邮件发件地址 |
| `BREVO_SENDER_NAME` | No | 事务邮件发件名称，默认 `MAA Admin` |
| `BREVO_RESET_TEMPLATE_ID` | Yes | 密码重置模板 ID；接收 `reset_url`、`expires_minutes` 参数 |
| `BREVO_VERIFY_EMAIL_TEMPLATE_ID` | Yes | 注册邮箱验证模板 ID；接收 `verification_url`、`expires_hours` 参数 |
| `EMAIL_VERIFICATION_TTL_HOURS` | No | 注册邮箱验证链接有效小时数，默认 `24` |
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
| `GENERATE_CHANGELOG_CANDIDATE` | No | 仅在生产候选构建中生成可发布的 Changelog 记录 |
| `CHANGELOG_BASE_SHA` | No | 首次启用自动 Changelog 时可选的历史基线 SHA；生产候选构建从同名 GitHub Actions repository variable 读取 |
| `DEEPSEEK_API_KEY` | Yes (GitHub Actions) | `Record PR Changelog` 工作流调用 DeepSeek 时使用的 repository secret |
| `DEEPSEEK_API_URL` | No | DeepSeek 兼容 API 根地址，默认 `https://api.deepseek.com`，配置为 GitHub Actions repository variable |
| `DEEPSEEK_MODEL` | No | PR 变更总结模型，默认 `deepseek-v4-pro`，配置为 GitHub Actions repository variable |
| `CHANGELOG_BOT_LOGIN` | No | 写入可信 changelog 评论的 Actions bot 登录名，默认 `github-actions[bot]`，配置为 GitHub Actions repository variable |

`npm run generate:data` 会根据版本变量生成 `src/lib/build-meta.ts`，并在 `server/handlers/data.ts` 中写入 `data_version`、`generated_at` 和来源摘要。数据会被 Node 服务器通过 `/api/data` 提供。

`npm run generate:changelog` 会生成 `src/lib/.generated/changelog.ts`、`changelog-release.json` 和 `changelog-release.md`。Changelog 分为两层：网站 `/changelog` 和前端生成模块只包含普通用户能在公开网站、公开 API 或核心业务功能中直接感受到的变化，只有内部变化而没有用户可见条目的版本会从网站列表完全隐藏；PR 的 Actions bot 规范评论、`changelog-release.json` 与 GitHub Release 则保留全量记录，包括管理后台、运维、CI、构建、重构、测试、文档、依赖和内部维护。内部记录不会写入前端生成模块，因此不会进入网站 bundle。

本地、PR 与开发构建只产生非候选元数据；`main` 的生产候选构建会以最近正式、非预发布 GitHub Release 的 SHA 为边界生成更新草稿，优先读取已合并 PR 中审核过的中文 changelog 数据，未录入的历史 PR 或直接提交才回退到 Conventional Commit / `Release-Note` Trailer。生产部署成功后才发布对应 tag、GitHub Release 和历史记录。首次启用时如需从既有正式版本开始计算，维护者可显式设置 `CHANGELOG_BASE_SHA`；否则该构建只建立基线。

合并目标为 `main` 的 PR 前，维护者需要在 Actions 中手动运行一次 `Record PR Changelog`：选择 `main` 分支并填写 PR 编号。本次 PR 的中文变更说明为可选项；留空时，DeepSeek 会直接根据 PR 标题、正文和文件差异生成总结，填写时则把它作为维护者意图的补充上下文。工作流会分别生成“网站公开变更”和“仓库内部变更”，并由 `github-actions[bot]` 把可选的人工说明、AI 总结及两层机器可读记录写入该 PR 的规范评论。生产构建只信任这个 bot 评论，不读取 PR 作者可编辑的同名内容。PR 后续若有新提交，head SHA 会变化，必须重新运行工作流。

仓库需配置 `DEEPSEEK_API_KEY` repository secret。为强制执行“完成 DeepSeek 分析后才能合并”，还应在 `main` 的 branch ruleset / branch protection 中把 `changelog/deepseek-summary` 设为 required status check；该检查要求运行工作流，但不要求填写中文变更说明。成功状态只写到本次分析对应的 PR head SHA，不会被后续提交沿用。首次部署该工作流的 PR 无法在合并前调用尚未存在于默认分支的手动工作流，因此生产生成器保留了历史兼容回退；工作流进入 `main` 后再启用 required status check。

生产灾备、恢复演练、S3 权限、备份加密和密钥轮换步骤见 [灾备 Runbook](docs/disaster-recovery.md)。

## 数据迁移与运维脚本

PostgreSQL 迁移和验证脚本保留用于审计、重放或灾备：

| Script | Purpose |
| --- | --- |
| `scripts/import-postgres.mjs` | 将导出 JSON 导入 PostgreSQL。 |
| `scripts/verify-migrated-data.mjs` | 校验 PostgreSQL 中的迁移数据。 |
| `scripts/check-server-routes.mjs` | 校验 Node 服务器 API 路由注册完整性。 |
| `scripts/build-server.mjs` | 打包服务器入口和路由模块。 |

## 项目结构

- `src/`: React 前端页面、组件和客户端逻辑
- `server/`: Node HTTP 入口、API 路由和 PostgreSQL 存储层
- `server/handlers/`: API 处理器、优化器和规则数据
- `scripts/`: 数据生成、服务器构建、迁移导入导出和检查脚本
- `public/`: 静态资源
- `.github/workflows/`: GitHub Actions 工作流
- `dist/`: Vite 构建产物
- `server/dist/`: 服务器构建产物
