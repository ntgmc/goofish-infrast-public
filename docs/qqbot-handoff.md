# QQ Bot 个人排班通知接入交接

网站侧已提供账号绑定、通知设置、排班完成通知、结果查询及 MAA JSON 导出接口。
Bot 侧需要实现私聊命令、轮询、文件发送和投递状态管理。部署前执行
[仓库验证规范](agent-validation.md)，并先完成数据库迁移 `2026-10-04.1`。

## 与现有插件的关系

参考 `qqbot_manager` 中以下实现，但个人排班使用独立接口和凭据：

- `plugins/codex_notify/service.py`：持久化投递状态、指数退避、成功后标记已发送。
- `plugins/manager_suite/website_notifications.py`：HTTP 客户端、Bearer 鉴权、
  超时和 `Retry-After` 处理、生命周期管理。
- `plugins/manager_suite/website_registration.py`：网站地址配置和 QQ 身份来源。

现有 `/api/integrations/qqbot/events` 仍是公告和版本信息的群通知流。
个人排班使用新的待发送列表，不共用事件游标。内测注册中的资格关联不自动
开启本功能，已有网站账号和通过 bot 注册的账号都要主动完成绑定并开启通知。

## 配置与身份边界

网站配置 `WEBSITE_QQBOT_TOKEN`，至少 32 个 UTF-8 字节；bot 配置相同凭据，
每次请求携带 `Authorization: Bearer <凭据>`。凭据必须独立于
`WEBSITE_EVENTS_TOKEN` 和 `WEBSITE_RELEASE_CONFIRMATION_TOKEN`，不能复用值。
个人接口缺少配置返回 `503 integration_not_configured`，错误凭据返回 `401`，
使用公告或发布确认凭据返回 `403`。所有响应禁止缓存。

所有 URL 均相对于网站配置的 HTTPS 地址。以下示例中的 QQ、ID、绑定码均为占位值。
网站账号安全页 `/account-safety` 提供绑定和通知设置。Bot 适配上线前先不配置
网站的 `WEBSITE_QQBOT_TOKEN`，页面会提示服务尚未开放。

`qq_number` 必须来自 QQ 平台私聊事件的真实发送者 ID，转为十进制字符串，
不要允许命令参数、转发消息或群成员指定另一个 QQ。只有 bot 持有个人接口凭据；
不能将它、绑定码、用户文件内容写入日志。涉及绑定、通知设置、查询和下载的
命令只在私聊处理，个人通知和文件只发给对应 QQ。不要在群消息中回显绑定码。

全部个人接口共享每个客户端 IP 每分钟 120 次请求的额度，超限返回
`429` 和 `Retry-After` 秒数。Bot 应将轮询与用户操作纳入同一个请求预算。

## 建议的私聊命令

网站显示的命令是 `绑定网站 <绑定码>`，bot 必须支持这一名称。推荐同时提供：

| 命令 | 行为 |
| --- | --- |
| `绑定网站 <绑定码>` | 使用发送者 QQ 兑换网站生成的绑定码 |
| `网站账号` | 查询绑定状态和档案，显示通知是否开启 |
| `开启排班通知` / `关闭排班通知` | 主动开启或关闭个人通知 |
| `解绑网站` | 用户确认后解除绑定 |
| `排班结果 <档案ID>` | 查询该档案的排班结果，显示可选择的结果 ID |
| `下载排班 <档案ID> <结果ID>` | 导出并私聊发送 MAA JSON |

遵循 bot 仓库的紧凑命令、无参数命令精确匹配、帮助清单和版本更新规则。
MAA 导出要求体验券时，必须先说明消耗 1 张券，再取得用户确认后提交
`use_coupon: true`；不能通过自动重试默认同意扣券。

## 网站用户接口

以下接口使用网站用户会话，供页面调用，不使用 bot 凭据：

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /api/user/qqbot` | `{available, binding}`，未绑定时 `binding: null`；已绑定包含 `binding_id, qq_number, notifications_enabled, bound_at` |
| `POST /api/user/qqbot` | 无请求体；`201 {binding_code, expires_at}`，有效期 10 分钟 |
| `PATCH /api/user/qqbot` | `{notifications_enabled: boolean}`，返回最终通知状态 |
| `DELETE /api/user/qqbot` | 无请求体；解除绑定并作废绑定码，返回 `{status: "unbound"}` |

绑定码只能使用一次，网站只存储摘要。重新生成会立即作废旧码；已绑定时
生成接口返回 `409 already_bound`。解绑后重新绑定会产生新的 `binding_id`，
通知默认关闭。网站未开放服务时仍允许用户关闭通知和解绑。

## Bot 账号操作接口

### 兑换绑定码

`POST /api/integrations/qqbot/binding`

```json
{"qq_number":"123456789","binding_code":"<网站显示的24位绑定码>"}
```

成功返回 `201`：

```json
{"schema_version":1,"binding_id":"<绑定ID>","notifications_enabled":false}
```

过期、作废或已消费返回 `400 binding_code_invalid`；QQ 或网站账号已绑定时
返回 `409 binding_conflict`。网络超时后先查账号状态，核对是否成功；不要
要求用户重复提供密码、Cookie 或网站会话。

### 查询账号与档案

`GET /api/integrations/qqbot/account?qq_number=123456789`

```json
{
  "schema_version":1,
  "binding_id":"<绑定ID>",
  "notifications_enabled":true,
  "profiles":[{"id":"<档案ID>","display_name":"主号","status":"active"}]
}
```

只返回档案识别信息，不返回邮箱、网站账号 ID、森空岛凭据或账号密码。
查询不到绑定返回 `404 account_not_bound`；网站账号冻结、撤销或待注销返回
`403 account_unavailable`。归档档案与仓库分析档案不出现在列表中。

### 设置通知与解绑

`PATCH /api/integrations/qqbot/account`

```json
{"qq_number":"123456789","notifications_enabled":true}
```

返回 `{schema_version: 1, binding_id, notifications_enabled}`。关闭会取消
尚未发送的通知；重新开启只接收后续完成的排班，不补发此前取消的提醒。

`DELETE /api/integrations/qqbot/binding`，JSON 请求体 `{qq_number}`，返回
`{schema_version: 1, status: "unbound"}`。解绑清除当前绑定的所有通知。

## 排班完成通知与投递流程

`GET /api/integrations/qqbot/notifications?limit=50`，`limit` 为 1–100，默认 50：

```json
{
  "schema_version":1,
  "notifications":[{
    "id":"<通知ID>",
    "binding_id":"<绑定ID>",
    "qq_number":"123456789",
    "profile_id":"<档案ID>",
    "profile_name":"主号",
    "result_id":"<结果ID>",
    "title":"排班标题",
    "created_at":"2026-10-04T08:00:00.000Z"
  }],
  "next_cursor":null,
  "has_more":false
}
```

通知与网站排班结果在同一个数据库事务中保存，每个绑定、每个结果最多
一条。正式排班成功时产生通知，包括手动排班和增量重算；失败、取消、
方案实验及非网站账号任务不产生个人排班通知。只有完成时已经绑定并开启
通知的用户会收到。账号或档案不可用、档案已归档时不会出现在待发送列表。

列表按创建时间和通知 ID 排序，未 ACK 的通知重复返回。可选 `cursor` 用于分页；
响应包含 `next_cursor` 和 `has_more`。每轮从不带游标的请求开始，先将各页
记录持久化，并在 `has_more` 为 true 时继续拉取；本轮扫完后重新从第一页开始。
不要把分页游标当成永久事件水位，失败记录必须继续重试。分页允许跳过尚未
ACK 的记录，避免一批发送失败的提醒挡住后续用户的通知。
通知保留 7 天，轮询时清理超期记录。已发送和未发送都遵守此保留期。
这是至少一次投递协议，bot 应使用单个轮询实例和持久化本地去重记录，
主键为通知 `id`，文件发送状态和文字发送状态分别记录。

建议流程：

1. 每 10–15 秒轮询，按 `next_cursor` 扫描待发列表，将新通知先落入 bot
   本地数据库；已有记录不要重建。大量积压时分批继续扫描，遵守共享限流。
2. 发送前重新查询该 QQ 的 `/account`，要求 `binding_id` 一致、通知仍开启，
   且目标档案仍在可用档案中。解绑、关闭、账号不可用时取消本地待发任务。
3. 使用通知的档案、结果与绑定 ID 请求 MAA 导出，携带 `automatic: true`；
   幂等键固定为通知 ID，例如 `notify:<通知ID>`。自动发送不得使用券。
4. 文件生成成功后，私聊发送“主号排班已生成”等提醒并发送 JSON 文件；
   按 QQ 适配器现有上传/发送文件方式处理，设置文件名为响应的 `filename`。
   每一步成功后更新本地状态，重试时跳过已经完成的步骤。
5. 如果返回 `maa_export_coupon_required`、轮班模式、文件校验失败或结果已删除，
   只发送排班完成提醒，说明可用操作；需要券时提示用户确认后主动下载，
   轮班模式提示在网站查看。文本成功后即可 ACK，避免错误记录持续堵塞列表。
6. 只有应发送的文字和文件都成功后才 ACK；HTTP/QQ 超时、5xx、429 不 ACK，
   使用指数退避，429 优先采用 `Retry-After`，不能因一条失败停止处理其余记录。
7. ACK 失败时只重试 ACK；bot 已保存成功状态时不再次发送文字或文件。

ACK：`POST /api/integrations/qqbot/notifications/ack`

```json
{"qq_number":"123456789","notification_id":"<通知ID>"}
```

成功返回 `{schema_version: 1, status: "acknowledged"}`。重复 ACK 成功，
另一个 QQ 的通知返回 `404 notification_not_found`。解绑、关闭取消或
超期后 ACK 也可能返回 404，应终止该本地任务。账号不可用返回 403。

网站关闭或解绑会取消网站中的待发记录，但 QQ 平台已经接受的消息无法撤回。
Bot 必须在每次实际发送前检查当前账号状态；正在进行的发送仍存在短暂竞态。
“发送成功但本地状态保存前 bot 崩溃”也可能造成重发，不能声称严格恰好一次。

## 查询结果与下载 MAA JSON

`GET /api/integrations/qqbot/results?qq_number=123456789&profile_id=<档案ID>`

可选 `scope=active|archived`（默认 `active`）、`limit=1..50`、`cursor`。
响应沿用网站结果列表 `{items, next_cursor, has_more}`。Bot 用结果 ID 提供选择，
不要假设页面第一条永远对应某条通知。档案归属和授权由网站检查。

`POST /api/integrations/qqbot/maa-export`

```json
{
  "qq_number":"123456789",
  "binding_id":"<当前绑定ID>",
  "profile_id":"<档案ID>",
  "result_id":"<结果ID>",
  "idempotency_key":"<一次用户操作或通知的稳定标识>",
  "automatic":true
}
```

`idempotency_key` 最长 120 个字符；同一次操作重试必须沿用同一个值。
网站会加入当前绑定 ID 作为前缀，避免与网页下载的幂等键冲突。
绑定变化返回 `409 binding_changed`；自动下载在通知关闭后返回
`403 notifications_disabled`。自动模式与 `use_coupon: true` 同时提供会被拒绝。

手动下载可以省略 `automatic` 或提供 `false`，用户明确同意用券后增加
`use_coupon: true`。只提供 QQ 身份不足以下载其他网站账号的档案和结果。
该接口复用网页导出逻辑，检查档案/授权有效期、导出能力、体验期、自用声明、
模式与结果有效性，并沿用券消耗幂等和导出行为记录。通知关闭不影响手动下载。

成功响应：

```json
{
  "result":{"title":"排班标题","description":"...","plans":["此处为实际MAA班次对象"]},
  "result_id":"<结果ID>",
  "filename":"maa_schedule_<结果ID>.json",
  "consumed_coupon":false
}
```

将 **`result` 对象** 按 UTF-8 序列化为 JSON 文件发送，不能发送整个响应对象。
示例省略了实际 MAA 班次结构，网站实际响应已按 MAA 执行文件白名单生成。
这是鉴权后的 JSON 响应，不提供公开下载 URL。临时文件发送完成或失败后清理；
不要将完整计算数据、下载内容或文件链接发到群里。

需要券返回 `403 maa_export_coupon_required`；轮班结果返回 `409`；MAA 校验失败
返回 `422 maa_export_result_invalid`；档案或结果不存在返回 `404`。
网站功能暂停时查询/导出可返回 `503 feature_disabled`，按服务状态重试。
部分沿用接口错误只有 `error` 字符串，bot 不应假设所有错误都有 `code`。

## Bot 验收清单

- 私聊绑定、紧凑命令、非命令歧义、帮助清单与权限；不能在群内绑定或下载。
- 绑定码过期、重生成、并发使用、重复使用，以及网络超时后的状态查询。
- 默认关闭通知，用户开启后生成排班，收到私聊文字和可导入 MAA 的 JSON 文件。
- 多个网站档案正确区分，无法查询/导出其他账号档案。
- 高级能力、有效体验期、需要体验券、用户确认用券、重复请求不重复扣券。
- 轮班结果只提醒，档案过期/冻结、账号待注销、结果删除均正确处理。
- 关闭通知、解绑、重新绑定后旧任务取消，旧绑定 ID 无法自动下载新绑定的结果。
- Bot 重启、QQ 发送失败、文件上传失败、ACK 超时与重复通知不会导致持续刷屏。
- 网站迁移、bot 独立凭据和功能开关配置正确；bot 上线后才开放网站绑定入口。
