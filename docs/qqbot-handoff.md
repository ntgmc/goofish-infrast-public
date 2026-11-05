# QQ Bot 账号、排班与群奖励接入

网站侧提供账号绑定、通知设置、排班完成通知、结果查询、MAA JSON 导出及群奖励发放接口。
Bot 侧提供私聊与群命令、轮询、文件发送和奖励投递状态管理。部署前执行
[仓库验证规范](agent-validation.md)，并先完成数据库迁移 `2026-11-05.1`。

## 与现有插件的关系

参考 `qqbot_manager` 中以下实现，但个人排班使用独立接口和凭据：

- `plugins/codex_notify/service.py`：持久化投递状态、指数退避、成功后标记已发送。
- `plugins/manager_suite/website_notifications.py`：HTTP 客户端、Bearer 鉴权、
  超时和 `Retry-After` 处理、生命周期管理。
- `plugins/manager_suite/website_registration.py`：网站地址配置和 QQ 身份来源。

现有 `/api/integrations/qqbot/events` 仍是公告和版本信息的群通知流。
个人排班使用新的待发送列表，不共用事件游标。内测注册中的资格关联不自动
开启本功能，已有网站账号和通过 bot 注册的账号都要主动完成绑定并开启通知。

## 公告群通知的 Markdown 正文

`GET /api/integrations/qqbot/events` 的 `schema_version: 1` 保持兼容，事件新增
可空的 `markdown` 字段。新发布的公告同时提供完整 Markdown 正文（最多 5000 字）
和原有纯文本 `summary`（最多 500 字）。正文与公告在同一事务内保存为发布时快照，
后续修改公告不会改变已生成的通知。

Bot 应在解析和持久化事件时保留 `markdown`，渲染时优先使用原文，保留换行、缩进、
列表、链接及代码块，不再按摘要长度截断。`markdown` 缺失、为 `null` 或为空白时，
沿用 `summary`；历史事件和版本发布事件仍可只提供摘要。图片渲染失败时沿用文字提醒
和网站详情链接，发送重试继续使用已持久化的正文。

部署网站前先完成数据库迁移 `2026-10-20.1`。Bot 的接收、存储和渲染适配需要一起上线；
旧 bot 可以继续读取摘要，但不会使用新增正文。历史事件不回填正文，也不会因此重发。

## 配置与身份边界

网站配置 `WEBSITE_QQBOT_TOKEN`，至少 32 个 UTF-8 字节；bot 配置相同凭据，
每次请求携带 `Authorization: Bearer <凭据>`。凭据必须独立于
`WEBSITE_EVENTS_TOKEN` 和 `WEBSITE_RELEASE_CONFIRMATION_TOKEN`，不能复用值。
个人接口缺少配置返回 `503 integration_not_configured`，错误凭据返回 `401`，
使用公告或发布确认凭据返回 `403`。所有响应禁止缓存。

所有 URL 均相对于网站配置的 HTTPS 地址。以下示例中的 QQ、ID、绑定码均为占位值。
网站账号安全页 `/account-safety` 提供绑定和通知设置。Bot 适配上线前先不配置
网站的 `WEBSITE_QQBOT_TOKEN`，页面会提示服务尚未开放。

首次绑定使用网站生成的专用群内验证消息：Bot 从 QQ 平台事件读取真实发送者和群号，网站核对申请预先限定的 QQ、群号和网站账号。普通输入的 QQ 号不能直接绑定。
只有 Bot 持有个人接口凭据，不能将凭据、验证口令或用户文件写入日志。群内验证静默处理，结果只在登录的网站页面显示；通知设置、查询和下载命令仍在私聊处理，个人通知和文件只发给对应 QQ。

全部个人接口共享每个客户端 IP 每分钟 120 次请求的额度，超限返回
`429` 和 `Retry-After` 秒数。Bot 应将轮询与用户操作纳入同一个请求预算。

## 建议的私聊命令

绑定和活动领取在网站完成；Bot 不再处理 `绑定网站` 或 `领取网站活动` 命令。需要排班私聊能力时提供：

| 命令 | 行为 |
| --- | --- |
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
| `GET /api/user/qqbot/activities` | 可选 `group_id`、`campaign_id`，返回群活动及当前账号的领取状态 |
| `GET /api/user/qqbot/verification` | 返回当前账号最近验证申请的状态，不返回验证口令 |
| `POST /api/user/qqbot/verification` | `start` 生成群内验证消息；`confirm` 确认绑定并领取；`claim` 为已绑定 QQ 创建后台资格核验 |
| `PATCH /api/user/qqbot` | `{notifications_enabled: boolean}`，返回最终通知状态 |
| `DELETE /api/user/qqbot` | 无请求体；解除绑定并作废绑定码，返回 `{status: "unbound"}` |

验证口令有效期 10 分钟、只能用于指定 QQ 和群，网站只存摘要。重新生成会作废旧申请；发送群消息只产生核验结果，必须回网站点击确认才绑定。绑定及活动发放在同一事务提交，通知默认关闭。
已绑定成员在活动页点击领取，Bot 后台读取当前成员资料，网站检查活动条件后发奖，全程不发 QQ 消息。重复点击复用待处理申请和永久领取回执；换绑后旧核验不能给新绑定发奖。
网站未开放服务时仍允许用户关闭通知和解绑。旧绑定码接口仅保留给已有集成，网站不再展示其生成或私聊入口。

## Bot 账号操作接口

### 历史绑定码接口

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
一条。自动排班和增量重算成功时产生通知；手动排班模拟、失败、取消、
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

## 网站专属群活动与奖励

`qqbot_manager` 的 `manager_suite` 使用与个人排班相同的独立 `WEBSITE_QQBOT_TOKEN`、网站地址、
通知开关和 `WEBSITE_NOTIFICATION_GROUP_IDS`。群内命令只在这些群处理；Bot 实时读取成员身份、
群主角色和入群时间，网站信任经过该私有凭据认证的 Bot，不接受浏览器会话代替该凭据。

活动由具有 `admin_manage` 权限的网站管理员在“道具与礼包 → QQ群活动”中创建、开启或停用。
后台配置群号、活动编号、奖励道具、数量、有效期、入群天数、入群早于日期和结束日期，创建后奖励及条件不可覆盖。
Bot 使用只读活动接口，不提供创建、状态修改或领取命令。后台提供可分享的 V2 活动链接，登录后保留群号和活动编号；成员在网站完成首次验证、确认绑定及领取。
本群群主和 `WEBSITE_REWARD_MAINTAINER_IDS` 中配置的网站维护者可以向本群成员直接发放道具、查询成员的网站账号 ID。普通群管理员和 Bot 超管不会自动取得这些权限。
账号查询接口只返回网站账号 ID，不返回邮箱、密码、森空岛凭据或档案。

群内命令：

```text
网站道具
网站活动 [活动编号]
网站绑定确认 A1B2C3-D4E5F6
发放网站道具 <QQ号|@成员> maa_export_trial_coupon 2 30 thankyou-20261104
查询网站账号 <QQ号|@成员>
网站奖励
补发网站奖励
帮助 网站奖励
```

数量为 1–10000，有效期为 1–3650 天或 `永久`。活动编号和发放编号为 1–64 位英文字母、数字、
下划线或短横线，以字母或数字开头。同一群内活动编号不可覆盖；需要修改时停用旧活动并创建新编号。
未配置入群条件的活动向本群所有当前成员开放；配置多项时须同时满足。
入群天数按完整的 24 小时计算；入群早于日期和结束日期使用北京时间该日 00:00，截止时刻不包含在内。
群成员资料无法确认或必要的入群时间缺失时，不建立新的领取记录。
同一群同一活动每个 QQ 限领一次，停用再开启不重置领取记录。已绑定成员领取时由 Bot 后台核验当前成员资料；网站重新检查活动状态和入群条件，再在一个事务内写入库存与永久回执。

多种奖励使用网站已有礼包；活动保存创建时的道具、数量、有效期和已发布礼包版本，直接发放保存首次发放的配置。
直接发放必须提供群内唯一的发放编号，相同编号和内容重试只返回原结果；确实需要再次发放时使用新编号。
命令词与首个参数支持省略空格，单成员目标支持 QQ 号或 @成员，不支持批量、混用或重复目标。

### 新增私有接口

这些接口与现有账号接口共用每客户端 IP 每分钟 120 次请求限制，成功和错误响应均禁止缓存。

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/integrations/qqbot/reward-items` | 无 | `{schema_version: 1, items: [{code, name, gift_pack_version_id}]}`，可发放道具及最新已发布礼包版本 |
| `GET /api/integrations/qqbot/reward-campaigns` | `group_id` 和可选 `campaign_id` | `{schema_version: 1, campaigns: [...]}`，本群最近 50 个活动；只读，POST 不可用 |
| `GET /api/integrations/qqbot/member-account` | 查询参数 `qq_number` | `{schema_version: 1, user_id}`；未绑定返回 `404 account_not_bound` |
| `POST /api/integrations/qqbot/rewards` | 下列 JSON | `201 {schema_version: 1, delivery_id, user_id, grant_id}`；重复成功请求返回相同回执 |

```json
{
  "delivery_id": "grant:123456789:thankyou-20261104",
  "qq_number": "234567890",
  "group_id": "123456789",
  "actor_qq": "345678901",
  "item_code": "maa_export_trial_coupon",
  "quantity": 2,
  "validity_days": 30,
  "gift_pack_version_id": null,
  "reason": "群内发放 thankyou-20261104"
}
```

`validity_days: 0` 表示永久，礼包须携带具体 `gift_pack_version_id`。网站按 QQ 查找当前可用绑定，
不接受调用方直接指定网站用户 ID。道具停用、礼包未发布或退役时不发放；奖励目录不列出未开放道具。
群奖励依赖网站库存功能开关，账号 ID 查询独立于档案和库存开关。
网站发放沿用道具账本和站内到账通知，记录来源 `qqbot_reward`、群号、操作者 QQ 和原因。

### 待发奖励和幂等性

网站新活动与旧 Bot 活动继续共用稳定领取编号 `claim:<群号>:<活动编号>:<QQ号>`。
直接发放先写入 Bot SQLite，再投递网站，使用 `grant:<群号>:<发放编号>`；旧版本已保留的活动奖励也继续按原编号投递。
直接发放和旧版本已保留的未绑定奖励继续保存在 Bot，网站确认绑定后由后台自动发现并补发。新活动的领取申请、资格和到账状态保存在网站。
此补发不依赖排班通知是否开启，实际延迟受待发数量、重试间隔和共享接口额度影响。
网站暂时不可用、限流、账号暂不可用时自动重试；停用道具等需维护者处理的错误保留记录并允许手动重试。
`网站奖励` 显示最近 20 条，`补发网站奖励` 重试这些记录中未到账的奖励；后台继续处理其他待发奖励。
从通知配置移除群或关闭通知会暂停补发，恢复后继续；已保留奖励不会因退出群、活动结束或活动停用而取消。

网站按 `delivery_id` 串行处理，在同一 PostgreSQL 事务内写入库存、道具账本、站内通知和不可变的发放回执。
同一编号内容变化返回 `409 idempotency_conflict`。回执独立于账号生命周期保留，即使原账号已解绑、删除，
再次请求也只返回原回执，防止奖励转发到新绑定账号。网站查询不到绑定时不创建回执，由 Bot 保留并稍后补发。
道具有效期从实际到账开始，Bot 不会在补发时改用新礼包版本。

本次网站 schema 版本为 `2026-11-05.1`。后台创建与状态修改使用 `/api/admin/inventory`，必须通过近期登录的 `admin_manage` 会话，Bot token 不授予后台权限。
创建沿用管理员操作幂等键和道具审计；状态修改使用 `expected_revision` 检测并发更改。
旧版本 Bot 本地活动不再作为领取依据，上线前在后台按原群号和活动编号重新创建；已保留的奖励和领取编号继续有效。
上线前运行正式迁移流程，Bot 启动时自动添加 SQLite 迁移 `0025_website_rewards`、`0026_website_verifications`。两端需保留完整数据库备份；不要手动清除领取／投递记录来重试。

## 静默身份验证协议

`POST /api/user/qqbot/verification` 由登录用户提交：

- `{action: "start", qq_number, group_id, campaign_id: null 或活动编号}` 返回 `{verification, code}`，只在生成时返回口令。
- `{action: "confirm", verification_id}` 只确认本人申请；验证完成前不能绑定，确认时重新检查活动状态及条件。
- `{action: "claim", group_id, campaign_id}` 为当前绑定生成后台成员核验，重复提交复用待处理申请。

`GET /api/integrations/qqbot/verifications` 返回 `{schema_version: 1, checks: [{id, qq_number, group_id}]}`，每批最多 25 条。
`POST` 使用同一独立 Bot token：群消息为 `{action: "message", code, qq_number, group_id, joined_at}`；后台核验为
`{action: "membership", verification_id, qq_number, group_id, member, joined_at}`。`joined_at` 为平台返回的入群 Unix 秒。
群消息中的 QQ 和群号必须来自原始平台事件，后台仅处理配置的网站通知群。正反结果均不发送 QQ 回复。

Bot 先把群验证消息存入短期待处理表；限流、网络和平台暂不可用时自动重试，重启后继续，10 分钟后清理。网站独立检查口令的原始截止时间，迟到重试不能延长验证有效期。
解除绑定会作废未完成申请；旧核验不能为新的绑定关系发奖。网站个人数据导出排除含口令摘要的短期验证表，已到账奖励仍随道具账本导出。

## Bot 验收清单

- 群内验证消息的紧凑形式、QQ 与群匹配、过期、重生成、网页确认；成功和失败均不发 QQ 回复。
- 活动分享链接经过登录后保留目标；已绑定用户直接领取；后台核验、重复领取、换绑及停用活动不导致错发或重发。
- 私聊帮助、查询、下载与权限；不能在群内下载文件。
- 绑定码过期、重生成、并发使用、重复使用，以及网络超时后的状态查询。
- 默认关闭通知，用户开启后生成排班，收到私聊文字和可导入 MAA 的 JSON 文件。
- 多个网站档案正确区分，无法查询/导出其他账号档案。
- 高级能力、有效体验期、需要体验券、用户确认用券、重复请求不重复扣券。
- 轮班结果只提醒，档案过期/冻结、账号待注销、结果删除均正确处理。
- 关闭通知、解绑、重新绑定后旧任务取消，旧绑定 ID 无法自动下载新绑定的结果。
- Bot 重启、QQ 发送失败、文件上传失败、ACK 超时与重复通知不会导致持续刷屏。
- 网站迁移、bot 独立凭据和功能开关配置正确；bot 上线后才开放网站绑定入口。
