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
SKLAND_CREDENTIAL_SECRET=<stable local random value of at least 16 characters>
FREE_PREVIEW_UID_HASH_SECRET=<stable local random value of at least 32 characters>
```

`SKLAND_CREDENTIAL_SECRET`（或其 keyring 配置）用于加密可刷新的森空岛凭证；`FREE_PREVIEW_UID_HASH_SECRET` 用于生成稳定的 UID HMAC、防止重复领取。两者都必须由密码学安全随机源生成、纳入受控密钥备份，并在所有 API 实例间保持一致。不要直接替换 UID HMAC 密钥；轮换前必须迁移现有 claim hash。凭证 keyring 轮换应保留旧解密密钥，完成 `scripts/rekey-skland-credentials.mjs` 重加密后再移除旧密钥。生产环境会在监听端口前校验这两类配置，缺失或长度不足时启动失败。

PostgreSQL 新连接默认最多等待 10 秒；可通过 `POSTGRES_CONNECTION_TIMEOUT_MS` 覆盖，允许范围为 1000–60000 毫秒。有限连接超时可以避免 API 或外部 worker 在数据库不可达时无限停留在启动阶段。

没有外部 worker 时，已提交任务会可靠保留在 PostgreSQL 队列中，直到兼容的 `OptimizerPort` worker 消费。仓库不提供 fake optimizer，避免生成看似成功但并非真实优化结果的数据。

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

本仓库不包含 `build:private`、`start:worker` 或 `start:all`。真实 worker 由闭源优化器仓库在固定公共 commit 上组合构建。

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

`check:architecture` 默认使用 public scope，禁止公共 API、runner 和 worker runtime 导入私有优化器实现。`check:public-export` 会在临时副本中验证公共源码能够独立构建和测试。

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
