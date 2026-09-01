# goofish-infrast-v1

面向《明日方舟》玩家的 MAA 基建排班 Web 应用。仓库包含 React 前端、Node.js API、PostgreSQL 任务队列、任务生命周期、取消/重试/死信处理以及公开的 `OptimizerPort` 契约。

生产优化器实现不在本仓库中。候选生成、规则执行、求解器、经济目标和场景/重排计算通过外部 `OptimizerPort` 实现完成，详见 [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md)。

## 技术栈

- React 19、TypeScript、Vite 6、Tailwind CSS 4
- Node.js 24 API
- PostgreSQL
- Vitest 和 Testcontainers

## 安装与前端开发

```bash
npm install
npm run dev
```

开发命令会生成前后端共享的静态效率数据。规则数据属于公共数据边界，不包含私有求解算法。

## API-only 后端

```bash
npm run start:server
```

`start:server` 会构建并启动 `server/dist/index.js`，其行为与 `start:api` 相同：

- 处理 HTTP API、鉴权、档案和工作区数据。
- 校验并提交优化任务到 PostgreSQL。
- 提供任务查询、轮询和取消 API。
- 执行队列恢复和过期维护。
- 不注册优化器、不 claim 任务，也不在 API 进程中计算排班。

本地至少需要：

```text
DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/<database>
PUBLIC_APP_URL=https://<public-origin>/
SKLAND_CREDENTIAL_SECRET=<stable local random value of at least 16 characters>
FREE_PREVIEW_UID_HASH_SECRET=<stable local random value of at least 32 characters>
USAGE_VISITOR_SECRET=<stable random value of at least 32 characters>
# USAGE_VISITOR_SECRET_PREVIOUS=<previous value during a controlled rotation>
WEBSITE_EVENTS_TOKEN=<independent random value of at least 32 bytes>
WEBSITE_RELEASE_CONFIRMATION_TOKEN=<different random value of at least 32 bytes>
```

`SKLAND_CREDENTIAL_SECRET`（或其 keyring 配置）用于加密可刷新的森空岛凭证；`FREE_PREVIEW_UID_HASH_SECRET` 用于生成稳定的 UID HMAC、防止重复领取。两者都必须由密码学安全随机源生成、纳入受控密钥备份，并在所有 API 实例间保持一致。不要直接替换 UID HMAC 密钥；轮换前必须迁移现有 claim hash。凭证 keyring 轮换应保留旧解密密钥，完成 `scripts/rekey-skland-credentials.mjs` 重加密后再移除旧密钥。生产环境会在监听端口前校验这两类配置，缺失或长度不足时启动失败。

`USAGE_VISITOR_SECRET` 用于签名匿名 usage visitor cookie，必须在所有 API 实例间保持一致。轮换时先配置新值，并将旧值放入 `USAGE_VISITOR_SECRET_PREVIOUS`；至少保留一个 visitor cookie 有效期（当前为 180 天）后再移除旧值。为兼容旧部署，服务端在未配置专用值时会回退到管理员签名密钥，但生产环境应使用独立 secret，避免不同安全域共用密钥。

### QQ Bot 网站集成与正式版本事件流

QQ Bot 使用 `WEBSITE_EVENTS_TOKEN` 拉取公告和正式版本事件：

```http
GET /api/integrations/qqbot/events?cursor={cursor|latest}&limit=100
Authorization: Bearer <WEBSITE_EVENTS_TOKEN>
```

首次注册消费者时使用 `cursor=latest`，响应只返回当前高水位游标，不回放历史事件；之后把每次响应的 `next_cursor` 原样保存并继续拉取。接口最多返回 100 条，按数据库 `sequence` 严格升序，响应设置 `Cache-Control: private, no-store`。Token 缺失或错误返回 401，使用仅具发布权限的有效 Token 返回 403，超过宽松的持久化限流窗口返回带 `Retry-After` 的 429。

Bot 实时确认用户仍在指定 QQ 群后，可以复用同一个 Token 按 QQ 签发个人一次性注册邀请码：

```http
POST /api/integrations/qqbot/registration-invitations
Authorization: Bearer <WEBSITE_EVENTS_TOKEN>
Content-Type: application/json

{"qq_number":"123456789"}
```

首次签发返回 `created`，有效期内重复请求返回 `active` 和原邀请码，过期后返回 `renewed` 和新邀请码，已经绑定则只返回 `bound`。注册链接形如 `https://maatool.com/tool/profiles#invite=...`；页面自动填入邀请码后立即清除片段，不会把邀请码作为普通查询参数发送给服务端。邀请码有效期为 24 小时，数据库只保存哈希和由 `WEBSITE_EVENTS_TOKEN` 派生密钥加密的密文。轮换 `WEBSITE_EVENTS_TOKEN` 后，同一 QQ 再次请求会换发邀请码，Bot 应始终把最新响应发送给用户。

该接口只接受 QQ 号，不接受邮箱、密码、道具代码或数量。内测道具继续通过网站新人任务配置和领取，Bot 不参与奖励参数或发放状态管理。由于 `WEBSITE_EVENTS_TOKEN` 同时具备事件读取和邀请码签发权限，必须仅注入受控 Bot 运行环境，不得写入日志或仓库。

公告从未启用状态首次保存为启用状态时，公告文档和 `announcement.published` 事件在同一 PostgreSQL 事务中提交；再次编辑已发布公告不会产生新事件。部署此功能前必须先运行 `npm run migrate:database`，创建 append-only 的 `website_notification_events` 表。

正式生产版本不能在构建或服务启动时自动确认。部署、公开 changelog 和 `/api/health/ready` 健康检查全部成功后，CI/CD 使用独立写权限 Token 运行：

```bash
PUBLIC_APP_URL=https://maatool.com npm run release:confirm-production
```

运行命令前，部署系统必须已经把 `WEBSITE_RELEASE_CONFIRMATION_TOKEN` 作为脱敏环境变量注入。确认脚本从线上 readiness 响应自动读取版本，不依赖人工设置 `DEPLOYED_VERSION`；前后端版本不一致、服务未 ready、响应不符合契约或确认失败时以非零状态退出。临时网络错误、429 和 5xx 最多重试 5 次，且禁止跨地址重定向。首次确认成功输出 `created`，重复执行输出 `already confirmed`，不会创建重复事件。

服务端只接受与当前前后端构建版本完全一致、且已经出现在公开 changelog 中的版本，并从公开 changelog 自行生成 `release.published` 内容。相同版本重复确认返回幂等成功；同一事件 ID 的不同内容返回 409。`WEBSITE_EVENTS_TOKEN` 与 `WEBSITE_RELEASE_CONFIRMATION_TOKEN` 必须分别生成并放入密钥管理系统，不能复用或提交到仓库。部署任务不得启用 shell xtrace，也不得输出确认 Token；现有质量检查 workflow 只负责构建和验证工件，不得用于触发生产通知。

PostgreSQL 新连接默认最多等待 10 秒；可通过 `POSTGRES_CONNECTION_TIMEOUT_MS` 覆盖，允许范围为 1000–60000 毫秒。有限连接超时可以避免 API 或外部 worker 在数据库不可达时无限停留在启动阶段。

### 事务邮件服务

注册验证、管理员邀请验证、密码重置和账号注销邮件支持 Brevo 与 Amazon SES。管理员可在“注册与验证”后台调整邮件服务优先级；默认顺序为 `Brevo → Amazon SES`，Brevo 达到每日额度或预留边界后自动使用已配置的 SES。若首选服务未配置，系统会继续尝试下一服务；发送请求已经发出但结果未知时不会切换服务，以避免重复投递。

Brevo 使用以下配置：

```text
BREVO_API_KEY=<Brevo API key>
BREVO_SENDER_EMAIL=<verified sender email>
BREVO_SENDER_NAME=<optional sender name>
BREVO_VERIFY_EMAIL_TEMPLATE_ID=<template id>
BREVO_RESET_TEMPLATE_ID=<template id>
BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID=<template id>
BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID=<template id>
```

Amazon SES 使用 AWS SDK 默认凭证链（例如实例角色、任务角色或 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` 环境变量），不要把访问密钥写入仓库。SES 还需要：

```text
AWS_SES_REGION=<SES region; falls back to AWS_REGION>
AWS_SES_SENDER_EMAIL=<verified SES identity>
AWS_SES_SENDER_NAME=<optional sender name>
AWS_SES_VERIFY_EMAIL_TEMPLATE_NAME=<SES template name>
AWS_SES_RESET_TEMPLATE_NAME=<SES template name>
AWS_SES_ACCOUNT_DELETION_CANCEL_TEMPLATE_NAME=<SES template name>
AWS_SES_ACCOUNT_DELETION_RECEIPT_TEMPLATE_NAME=<SES template name>
AWS_SES_CONFIGURATION_SET_NAME=<optional configuration set>
```

SES 模板数据沿用现有事务邮件参数：验证模板接收 `verification_url`、`expires_hours`；重置模板接收 `reset_url`、`expires_minutes`；注销取消模板接收 `cancel_url`、`expires_days`；注销回执模板接收 `receipt_id`。

API-only 构建没有外部 worker 时，已提交任务会可靠保留在 PostgreSQL 队列中，直到兼容的 `OptimizerPort` worker 消费。仓库不提供 fake optimizer，避免生成看似成功但并非真实优化结果的数据。

私有组合构建可在服务机使用 `APP_ROLE=all` 开启阿里云 ECS worker 自动伸缩。启用后，combined 进程始终把本机计算并发限制为 1：远端实例停止时由本机继续消费；排队数严格超过扩容阈值时启动指定 ECS；排队数连续 10 分钟不超过 1 且没有运行中的任务时，以 `StopCharging` 模式停止远端实例。自动伸缩默认关闭，所需配置如下：

```text
OPTIMIZE_WORKER_AUTOSCALING_ENABLED=true
OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD=4
OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD=1
OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS=600000
OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS=30000
ALIYUN_ACCESS_KEY_ID=<restricted RAM access key id>
ALIYUN_ACCESS_KEY_SECRET=<restricted RAM access key secret>
ALIYUN_ECS_REGION_ID=cn-hangzhou
ALIYUN_ECS_WORKER_INSTANCE_ID=i-xxxxxxxx
# ALIYUN_SECURITY_TOKEN=<required when using temporary STS credentials>
# ALIYUN_ECS_ENDPOINT=https://ecs.aliyuncs.com
```

RAM 身份只应获得目标实例的 `ecs:DescribeInstanceStatus`、`ecs:StartInstance` 和 `ecs:StopInstance` 权限；凭证必须由部署系统以 secret 注入，不得写入仓库或日志。`StopCharging` 会停止符合条件的按量实例的计算资源计费，但云盘、保留公网 IP 等资源仍可能计费。生产 combined 进程还需按既有边界显式配置 `ALLOW_PRODUCTION_COMBINED_PROCESS=true`，并由私有组合构建提供真实 `OptimizerPort`。

默认 API 地址为 `http://127.0.0.1:3000`；可通过 `HOST` 和 `PORT` 覆盖。

## 公共构建

```bash
npm run build
```

默认构建只生成 Web 产物和以下公共服务端入口：

```text
server/dist/index.js(.map)
server/dist/migrate.js(.map)
server/dist/routes.js(.map)
```

也可以单独运行：

```bash
npm run build:public
npm run build:server
npm run build:server:public
```

本仓库不包含 `build:private`、`start:worker` 或 `start:all`。真实 worker 由闭源优化器仓库在固定公共 commit 上组合构建。机器可读的组合边界位于 [optimizer-port-contract.json](optimizer-port-contract.json)：私有 CI 必须记录真实 public Git SHA，生成 `worker.js`、`all.js` 与 runner 所需的 `optimize-worker.js`，并对 Worker 启动、thread entry、readiness 和优雅关停进行验收。公共仓库只声明约束，不虚构或提交私有仓库的实际 SHA。

## 检查与测试

```bash
npm run check:catalog
npm run test:release-artifact
npm run check:public-export
npm run check:architecture
npm run check:dead-code
npm run check:api
npm run build
npm test
npm run test:postgres
```

`check:architecture` 默认使用 public scope，禁止公共 API、runner 和 worker runtime 导入私有优化器实现，并校验机器可读的私有组合产物契约。`check:public-export` 会在临时副本中验证公共源码能够独立构建和测试。

PostgreSQL 集成测试使用 Testcontainers，需要可用的 Docker daemon。

## OptimizerPort

当前公开协议版本为 v1，机器可读版本位于 [optimizer-port-contract.json](optimizer-port-contract.json)。端口包含三类执行方法：

- schedule
- scenario comparison
- reorder check

任务可靠性来自 PostgreSQL 队列。进程内 signals 只用于即时唤醒，不承担持久化投递。

新增任务类型时必须同步更新：

- 公共 payload union。
- `OptimizerPort` 接口。
- exhaustive dispatcher。
- job snapshot、任务中心和通知文案。
- 公共/私有兼容性测试。

## 公共制品

公共 CI 只生成：

```text
goofish-public-<sha>
  public.tgz
  public.tgz.sha256
```

公共制品包含 Web、API、迁移和路由入口，以及由部署流程调用的公共 HTTPS smoke runner。验证器拒绝 worker/combined 入口、私有源码路径以及包含私有 `sourcesContent` 的 sourcemap。

## 通用部署安全基线

面向公网部署时必须在 HTTPS/TLS 虚拟主机中安装并引用仓库提供的通用 Nginx snippets：

- `goofish-security-headers.conf`：统一响应安全头。
- `goofish-static-files.conf`：静态资源缓存、SPA fallback 与 dotfile 拒绝规则。
- `goofish-server-hardening.conf`：server 级协议与请求约束。

这些文件只是公开的安全基线示例，不包含域名、主机、凭据、槽位或真实生产拓扑。部署方仍需根据自身基础设施完成 TLS 证书、反向代理、网络访问控制和日志策略。

## 贡献与安全报告

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请遵循 [SECURITY.md](SECURITY.md)，不要在公开 issue 中披露尚未修复的漏洞或敏感数据。

## 许可证

本仓库使用 [Apache License 2.0](LICENSE)。`OptimizerPort` 的闭源实现和生产优化器不包含在本仓库或本许可证授权的软件中。

《明日方舟》及相关商标、角色、素材和游戏数据归其各自权利人所有。本项目与相关权利人无隶属或背书关系。
