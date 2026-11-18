# 森空岛登录与导入连接服务

API 服务器负责网站鉴权、绑定凭据加密、账号选择、快照、导入和业务写入。独立的
`skland-connector` 负责访问鹰角和森空岛：生成二维码、扫码状态、登录凭据换取、凭据刷新、
角色列表、游戏资料和养成数据全部从该组件所在机器发出。首个部署目标为现有 worker 机；
之后可以将相同组件迁移到独立机器，排班 worker 无须跟随迁移。

森空岛显示的登录地由其根据请求出口判定。切换组件会改变后续请求的出口；历史登录记录不会改变，
具体显示的城市需要真实扫码登录后核对。

## 边界与连接

连接服务没有数据库权限，不配置 `SKLAND_CREDENTIAL_SECRET` 或网站会话密钥，不保存登录凭据和
个人资料。请求中的扫码代码、凭据、签名和返回数据仅在内存中转发；服务不输出请求头和正文。
只允许代码中列出的鹰角与森空岛接口、既有请求方法及签名相关请求头，拒绝跳转和其他地址。

每次调用都用 `SKLAND_CONNECTOR_TOKEN` 鉴权。生成至少 32 字符的随机值，分别通过受保护的配置
文件注入 API 和连接服务；不要将实际值提交到仓库、命令参数或日志。

组件默认只监听 `127.0.0.1:3300`。worker 主动建立独立 SSH 反向隧道，将 API 机的
`127.0.0.1:13300` 转发到 worker 的 `127.0.0.1:3300`。它与排班 PostgreSQL 隧道分别运行，
不依赖 WireGuard 或其他 UDP 连接。也可在目标机部署 HTTPS 入口，保留同样的服务鉴权。

## 部署到 worker

1. 使用项目锁文件安装依赖并执行 `pnpm run build:server:public`。发布包包含
   `server/dist/skland-connector.js`；该文件已打包全部连接服务依赖，运行时只需要 Node.js 24。
   将发布文件放入 worker 的 `/opt/goofish-skland/releases/<version>/server/dist/`，
   用 `/opt/goofish-skland/current` 指向该版本。连接服务单独发布和重启。
2. 创建由 root 管理、`ntgmc` 可读的 `/etc/goofish-skland/connector.env`，权限 `0640`：

   ```dotenv
   SKLAND_CONNECTOR_TOKEN=<random-token>
   SKLAND_CONNECTOR_PORT=3300
   ```

3. 安装 [goofish-skland-connector.service](../deploy/systemd/goofish-skland-connector.service)。
   核对服务账号、路径和 `/usr/bin/node` 版本后执行：

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now goofish-skland-connector.service
   ```

4. 为反向隧道使用独立的 SSH 密钥和固定主机指纹文件。API 机须允许该密钥进行 remote forwarding，
   将 `permitlisten` 限制为 `127.0.0.1:13300`，禁止 shell、代理转发和 X11 转发。
   `GatewayPorts` 保持关闭。不要直接修改排班数据库隧道的密钥权限或服务。
   创建权限 `0640` 的 `/etc/goofish-skland/tunnel.env`：

   ```dotenv
   SKLAND_TUNNEL_SSH_KEY=/etc/goofish-skland/api-tunnel_ed25519
   SKLAND_TUNNEL_KNOWN_HOSTS=/etc/goofish-skland/known_hosts
   SKLAND_TUNNEL_API_PORT=13300
   SKLAND_TUNNEL_REMOTE_USER=<ssh-user>
   SKLAND_TUNNEL_REMOTE_HOST=<api-host>
   ```

   私钥只允许服务账号读取。安装
   [goofish-skland-tunnel.service](../deploy/systemd/goofish-skland-tunnel.service)，执行
   `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now goofish-skland-tunnel.service`。
5. API 机配置相同的 token 和隧道本机地址，随后发布并重启 API：

   ```dotenv
   SKLAND_CONNECTOR_URL=http://127.0.0.1:13300
   SKLAND_CONNECTOR_TOKEN=<same-random-token>
   ```

   生产环境要求配置连接服务；开发和测试在未配置这两个变量时仍可直接访问上游。
   只配置其中一项、密钥无效、隧道断开或组件故障时均停止请求，不自动从 API 机访问上游。
   普通 HTTP 地址只接受 `127.0.0.1` 或 `::1`；跨机器连接必须使用 HTTPS。

## 验证与状态含义

`GET /health/live` 和 `GET /health/ready` 均要求服务 token。前者检查进程，后者由连接服务
对两个上游分别发送不含凭据的 HEAD 请求：DNS、TCP、TLS 或请求超时失败、HTTP 429、HTTP 5xx
均视为不可用。3xx/其他 4xx 表示收到上游响应，不代表账号授权或每个业务接口必然成功。
检查不创建二维码，不触碰用户账号。探测超时 3 秒，同一进程合并并缓存结果 10 秒；API 再缓存
组件检查 10 秒，因此状态变化可能延迟约 20 秒。真实业务请求仍按实际结果处理。

`/api/status` 的 `skland_import` 只有在 API 就绪、绑定加密及 UID 校验配置有效、连接服务鉴权成功、
连接服务报告两个上游可连通时才为 `available`。它独立于排班任务容量：排班拥堵不影响此组件。
“可用”表示公共登录与导入链路就绪；个人凭据过期、账号未绑定或上游特定业务错误，仍在操作时提示。
现有历史图表继续记录排班服务历史，森空岛组件反映当前探测结果。

切换前在 worker 和 API 机分别通过本机 HTTP 请求验证 ready；从受保护文件加载 token，勿打印
鉴权请求头。确认监听地址均为 loopback，再验证网站状态。发布后人工扫码一次，核对森空岛显示的
登录地点、账号选择、绑定确认以及已有账号的干员和库存刷新。关闭连接服务验证组件状态变为不可用，
并检查已有绑定不会被误标为凭据失效；恢复后无需重新扫码即可继续刷新仍有效的授权。

## 后续迁移与回退

新机器部署相同发布文件和独立连接隧道，先通过新本机端口验证 ready，再修改
`SKLAND_CONNECTOR_URL` 并重启 API。密钥可同时更换；不迁移数据库或重新绑定账号。
核对新出口的实际登录地点后，停用旧隧道和旧组件。

回退时恢复上一版本组件或上一条已验证的连接地址及对应 token，再重启 API。不要删除连接配置
来回退到首尔出口；若目标组件不可用，保持明确的不可用状态并修复连接。
