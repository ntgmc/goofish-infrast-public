# 深度复审问题修复进度

修复基线：`397df2b1`。依据 `docs/code-review/` 第二轮深度复审的 44 项确认问题，按模块逐轮修复、验证、总结并提交；M02、M05 尚未形成第二轮问题，不计入这份清单。原始报告及证据保留，首轮 R01～R09 的既有修复不重复统计。

## 模块进度

| 轮次 | 模块 | 问题 | 状态 |
| --- | --- | --- | --- |
| 1 | M01 HTTP 与安全边界 | D01 断连写出挂起；D02 IPv6 等价地址；D03 Expect 前置处理 | 已修复、验证通过 |
| 2 | M03 数据库与迁移 | D01 回滚失败连接回池；D02 service file 引号；D03 CDK 内容验证 | 已修复、验证通过 |
| 3 | M04 档案、工作区与账号数据 | D01 清除凭据覆盖冻结；D02 改名覆盖工作区；D03 导出截断与遗漏 | 已修复、验证通过 |
| 4 | M06 排班任务 API 与契约 | D01 诊断券结果过滤；D02 取消投影；D03 轮班对比 schema；D04 输出错误分类 | 已修复、验证通过 |
| 5 | M07 队列、worker 与伸缩 | D01 领取阻塞；D02 取消恢复预约；D03 云响应超时；D04 关停迟到领取 | 已修复、验证通过 |
| 6 | M08 森空岛绑定与导入 | D01 旧确认写回；D02 临时 token 失效分类；D03 升级激活冻结档案 | 待修复 |
| 7 | M09 养成与辅助计算 | D01 刷取余量；D02 加工龙门币；D03 仓库错误分类 | 待修复 |
| 8 | M10 公告与通知 | D01 Unicode 摘要；D02 旧内容标记已读；D03 分页竞争 | 待修复 |
| 9 | M11 风控、邀请与统计 | D01 邀请资格；D02 UID 轮换 alias；D03 审计链顺序 | 待修复 |
| 10 | M12 管理控制台 | D01 保存覆盖新编辑；D02 旧会话详情；D03 撤回遗漏预约 | 待修复 |
| 11 | M13 前端外壳 | D01 迁移草稿；D02 旧工作区响应；D03 清除凭据切换档案 | 待修复 |
| 12 | M14 前端排班与结果 | D01 历史配置竞争；D02 历史分页竞争；D03 对比遗漏券；D04 恢复动画清理 | 待修复 |
| 13 | M15 状态与监控 | D01 稀疏成本窗口；D02 首次成本保存竞争 | 待修复 |
| 14 | M16 构建与部署 | D01 删除跳过构建；D02 遗漏输入；D03 旧产物接受新清单 | 待修复 |

## 第 1 轮：M01 HTTP 与安全边界

- D01：响应写出先检查连接是否已关闭或结束，取消未发送的 Web body；背压等待也检查连接状态，读取期间断连后停止写出。
- D02：使用原生 URL 规范化 IPv6，共用入口将 IPv4 映射地址统一为点分 IPv4，保留 IPv6 scope，代理信任和 loopback 判断共用相同规范化。
- D03：普通请求、`checkContinue`、`checkExpectation` 共用应用边界与响应处理；Expect 拒绝关闭连接，不先发送 100，不等待请求正文。
- 回归：真实连接先断开后返回、正常大响应背压、展开/压缩/映射/带 scope 地址，以及未发送正文的原始 Expect 请求。
- 验证：最近测试 6 个文件、80 项通过；`npm run check:local` 通过，含全量普通测试 244 个文件、1,944 项、完整构建、API、109 条路由、架构、死代码及脚本契约。文档最后编辑后复跑架构、死代码及 whitespace 检查。
- 范围限制：IPv6 用实际 helper 验证；未执行线上代理/TLS 或公网慢连接测试。
- Commit：`90f7f15f`，`fix(http): handle disconnected responses and normalize proxy boundaries`。

## 第 2 轮：M03 数据库与迁移

- D01：回滚失败销毁连接，保留原异常；事务 callback 不重放。真实超时回归证明失败写入不会被后续事务提交，后续事务使用新的 PostgreSQL PID。
- D02：service file 写字面值，拒绝换行/NUL并保持 0600；去除 IPv6 host 的 URL 括号。真实 libpq 验证包含引号、反斜杠、空格等字符的 fixture 密码可连接。
- D03：所有 CDK JSON 参与内容 checksum；导出仅对 schema 已明确迁移的旧 permission/status 做预期归一化，保留到期和未知业务字段。另核对 CDK 关键 typed columns 与 JSON 是否一致。
- 最近验证：3 个普通文件、37 项；迁移验证器 3 项；备份/恢复契约；真实 PostgreSQL/libpq 3 项均通过。首次特殊密码测试因 Testcontainers 的 shell 健康检查超时，改用参数数组后通过。
- 完整验证：`check:local` 重跑通过（244 个普通文件、1,945 项；构建、API、109 条路由和两项强制检查）；全量 PostgreSQL 19 个文件、212 项通过，包括受控迁移和真实验证器 CLI。初次完整普通测试的一项未改动公告页导航断言失败，单文件 7 项及完整重跑均通过。文档最后编辑后复跑架构、死代码及 whitespace 检查。
- 未改变 schema SQL、版本或历史账本；没有连接生产库或执行真实灾备切流。
- Commit：`64d6ed74`，`fix(storage): discard failed transactions and verify migration contents`。

## 第 3 轮：M04 档案、工作区与账号数据

- D01：清除凭据通过带归属条件的原子 SQL 仅修改当前 binding 的凭据字段及更新时间，保留并发冻结、权限、备注和绑定身份。
- D02：改名发现工作区缺失时，复用既有工作区事务锁，锁内重新读取；只初始化仍不存在的工作区。
- D03：存储列表与界面合并列表分离；导出读取全部用户档案，包括保留的合并源，并输出完整 workspace，取消界面容量截断；仍剔除凭据并保留独立历史导出和 16 MiB 上限。
- 最近验证：5 个普通文件、22 项及真实 PostgreSQL 4 项通过。真实 SELECT 后设置屏障，覆盖冻结先提交、工作区首次保存先提交；真实合并与扩容验证所有方案、源档案及源干员均被导出。
- 完整验证：`check:local` 通过（244 个普通文件、1,945 项、完整构建/API/109 条路由）；全量 PostgreSQL 19 个文件、215 项通过。文档最后编辑后复跑架构、死代码及 whitespace 检查；未改变 schema SQL 或历史账本。
- 必要的验证修正：公告页测试再次在内容渲染后、路由更新前断言 URL；改为等待 URL 的异步更新，单文件 7 项及完整门禁通过，公告应用逻辑未改。
- Commit：`3daee2a4`，`fix(accounts): preserve concurrent profile updates and export complete workspaces`。

## 第 4 轮：M06 排班任务 API 与契约

- D01：共用查询核对诊断券的服务端预约/消费记录；任务 GET、提交重放、历史详情及免费预览持久化都保留券对应的诊断字段，继续按当前权限限制完整指标和原始结果。
- D02：取消返回的最新 snapshot 复用当前权限投影，完成竞争不再返回未经投影的结果。
- D03：共享 factors schema 允许 rotation-only，要求至少一种排班模式；持久化 payload 同步采用该规则。
- D04：优化器结果在本地加工前验证；诊断建议 type/ops 最小结构纳入 schema，缺 plans/ops 明确归为不可重试 validation 故障。
- 最近验证：15 个普通文件、179 项通过；真实推荐 CDK/免费预览两种券消费、完成、GET/重放/历史回归通过（filter 执行 2 项，其余 40 项未混计）。
- 完整验证：`check:local` 通过（244 个普通文件、1,951 项；完整构建/API/109 条路由）；完整队列 PostgreSQL 文件 42 项通过。架构检查首次将默认参数的 shorthand query 误报为未使用，显式别名引用后相关 39 项、架构和完整门禁均通过。文档最后编辑后复跑架构、死代码及 whitespace 检查；没有调用私有优化器。
- Commit：`66b7f0c1`，`fix(optimization): preserve diagnosis entitlements and validate result boundaries`。

## 第 5 轮：M07 队列、worker 与伸缩

- D01：单次 eligible 候选查询以排序实现公平让行；没有可运行分析任务时直接领取其他任务，不再用宽松计数限制候选。
- D02：中断事务按最新取消意图直接终结并释放预约；租约/硬期限恢复优先取消；每批最多 100 条修复遗留 queued + cancel_requested 记录。内存 store 同步状态语义。
- D03：ECS 请求 deadline 保持到 JSON 正文读取结束，正文中止/损坏明确失败，保留实际云 API 错误。
- D04：线程、inline 以及抢占领取返回后复查关停状态；迟到 attempt 归还存储，不启动执行。
- 最近验证：7 个普通文件、50 项及完整队列 PostgreSQL 47 项通过，覆盖公平 backoff/owner busy、三种取消恢复/真实道具退款、线程/inline 迟到 claim、挂起正文及后续请求。新增 fixture 的道具名和维护 cleanup 已纠正后复跑。
- 完整验证：`check:local` 通过（244 个普通文件、1,954 项；完整构建/API/109 条路由）；完整队列 PostgreSQL 文件 47 项通过。最终编辑后复跑架构、死代码及 whitespace 检查；未调用真实 ECS 或私有求解器。
- Commit message：`fix(workers): settle cancellation and prevent late claims after shutdown`。
