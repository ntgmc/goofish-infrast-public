# 服务端性能观测

API、任务进程和计算线程启动后自动输出 JSON 观测日志，每 5 分钟输出一次当前窗口的耗时分布和运行状态，正常退出时补发最后一个窗口。慢调用和失败调用仍立即记录。数据沿用标准输出和现有日志留存方式，不写业务数据库，不增加采集依赖。

## 从时间边界定位慢点

用户等待时间由提交请求、任务排队、计算和结果处理组成。先比较这些独立边界，再决定优化哪个资源：

| 日志事件 | 计时边界和用途 |
| --- | --- |
| `http.request` | 从 Node 收到请求到响应完成，包含读请求体、校验、业务处理及写响应；`aborted` 表示响应未完成。代理排队和浏览器网络时间应结合已有浏览器记录排查。 |
| `postgres.acquire` | 借连接调用到获得连接或失败，包含新连接建立；达到 100 ms 或失败时单独记录，同时附带池中的连接数和等待数。它与 SQL 执行分开统计。 |
| `postgres.query` | 连接上发起 SQL 到返回或失败，包含数据库执行、锁等待、网络和结果解码，不包含借连接。达到 250 ms 或失败时单独记录。覆盖共享查询、池查询和直接借连接的事务查询。 |
| `optimization.accepted` | 提交请求已获得可读取的任务，包含 `request_id` 与 `job_id`，也会记录幂等重放。 |
| `optimization.claimed` | 首次领取时的 `started_at - created_at`，作为 `queue_ms`；后续重试不计入这项分布，以免把之前的执行和退避时间算成排队。 |
| `optimization.attempt_started` / `optimization.attempt` | 调度进程启动计算线程到完成收尾，包含线程启动、计算、关闭数据库连接、结果传输和持久化；后者记录成功、失败、超时、取消或中断原因。 |
| `optimization.stage_started` / `optimization.stage` | 计算线程内部阶段的开始与结束，可区分排班、潜力计算、升级模拟和材料补全；阶段可重复出现。结束事件包含阶段墙钟时间和 `thread_cpu_ms`。 |
| `optimization.execution` | 计算入口到校验完成或抛错，包含阶段中的数据读取、结果校验和材料补全，不含线程启动及调度进程的结果持久化。包含当前线程 CPU 时间。 |
| `performance.duration` | 本进程、本线程、当前窗口内按固定标签聚合的 `count`、`mean_ms`、`p50_ms`、`p95_ms` 和 `max_ms`。 |
| `performance.runtime` | 实际采样间隔、事件循环 P50/P95/最大延迟及利用率、进程 CPU 增量、RSS 和本线程所属数据库池的 `total`、`idle`、`waiting`。未创建池时为 `null`。 |

使用 `request_id` 找到提交请求，通过 `optimization.accepted` 中的 `job_id` 串联任务，再用 `attempt_no` 区分重试。每条记录都有主机、PID、线程编号与进程角色。SQL 执行使用异步上下文关联到当前请求或任务，不在任务表中增加追踪字段。

- `queue_ms` 高、计算时间稳定：检查排队量、可用计算能力和并发。增加并发可能改善吞吐，也可能放大 CPU 和数据库争用。
- `postgres.acquire` 高且等待数增加：检查连接池容量、长事务及连接占用；新连接建立慢也会增加此值。
- 借连接正常、`postgres.query` 高：结合下面的 PostgreSQL 统计检查 SQL、锁和 I/O。
- 计算阶段墙钟和线程 CPU 时间同时高：该阶段主要消耗 CPU，应分析算法和输入规模。墙钟高而 CPU 时间明显较低时，继续检查数据库、外部调用或主机 CPU 争用。
- API 事件循环延迟高：检查 API 进程中的同步工作或主机压力。计算线程的高事件循环利用率通常符合 CPU 计算特征，需结合 API 进程和 CPU 时间判断。

## 采集口径与开销

HTTP 每次请求记录一条事件，包括校验失败与响应断连。SQL 正常调用只更新内存分布，慢调用和失败调用另写事件；不记录 SQL 文本、参数、请求体、查询字符串、Cookie、令牌或用户身份。SQL 的 `query_fingerprint` 是原始语句模板的 SHA-256，可在源码排查时比较相同模板的指纹；它与 PostgreSQL 的 `queryid` 使用不同算法，不能直接连接。

指标标签使用声明的路由模板、有限的方法和阶段等字段。动态任务和结果编号只进入关联日志，未知路由统一记为 `unmatched`；未发送响应头的断连，其聚合状态为 `0`。单窗口保留最多 512 个常规标签组合，多余样本按指标归入 `overflow`。耗时直方图按微秒记录，最小值为 1 微秒，使用两位有效数字；初始容量至少覆盖 1 秒，遇到更长耗时再扩容并保留已有样本，避免为每个组合预分配极大范围。汇总耗时仍以毫秒输出，最多保留三位小数。事件循环每 20 ms 采样，无样本时延迟值为 `null`。

单独的维护领导锁连接不经过业务池，业务数据库时序不覆盖该连接；排查维护连接可用 PostgreSQL 统计。应用侧 SQL 时间是客户端耗时，不等于 PostgreSQL 服务器执行时间；事务中排在先前查询后面的客户端等待也包含在内。

所有计算阶段使用单调时钟，排队时间使用已有持久化时间。多机部署应保持时钟同步。`optimization.execution` 和阶段结束日志只覆盖正常返回或抛错，强制终止的线程可能没有结束记录；用开始事件、父进程的 `optimization.attempt` 和任务状态识别这些样本，不能只按成功任务计算尾延迟。独立计算线程结束时会立即输出自己的窗口。测试中的内联执行没有父线程 attempt 时序。

CPU 运行状态是整个进程的 CPU 增量，包含其计算线程，不能把同一进程各线程日志中的 CPU 值再次相加。阶段的 `thread_cpu_ms` 只计当前线程。RSS 同样属于整个进程。

窗口 P95 不能直接平均成跨窗口或跨进程的 P95。计算线程间的样本没有集中合并；当前日志用于定位慢层，原有运营看板继续承担用户完整等待时间的统计。常驻进程的汇总周期由 1 分钟延长为 5 分钟，在标签组合稳定时，定时汇总行数约减少 80%；短时计算线程退出时仍补发，实际总日志量还取决于请求、慢调用和任务事件数量。日志由现有运维系统限制容量和保留期；部署后应检查日志量及采集开销。

## PostgreSQL：启用和读取 pg_stat_statements

以下为 PostgreSQL 16 的运维操作，由数据库管理员在部署环境执行。应用不自动创建扩展，也不改变迁移版本。先查看当前设置：

```sql
SHOW shared_preload_libraries;
```

在现有 PostgreSQL 配置的 `shared_preload_libraries` 列表中追加 `pg_stat_statements`，保留其他已有条目；重启 PostgreSQL 后，在应用数据库执行一次：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT extversion FROM pg_extension WHERE extname = 'pg_stat_statements';
```

已有扩展的数据库可直接运行只读诊断文件：

```sh
psql 'service=goofish' -X -v ON_ERROR_STOP=1 -f deploy/postgres/performance.sql
```

将 `goofish` 替换为现有 libpq 服务名，使用应用数据库及应用角色对应的连接配置。查询只查看当前数据库、当前角色的统计，不输出 SQL 文本；用其他角色连接时需要调整过滤条件及对应授权。文件设置只读事务和 5 秒语句超时，不重置计数器。不要把数据库密码放进命令行。

诊断结果包括统计重置时间、按总执行时间排列的前 20 个 `queryid`、调用次数、平均及最大执行时间、缓存命中与块读取、临时块写入，以及当前连接状态、等待事件和被阻塞连接数。累计总耗时高的语句未必单次最慢；对比 `calls`、`mean_exec_ms` 和 `max_exec_ms`，并在有权限的数据库会话中按 `queryid` 检查语句和执行计划。`pg_stat_statements` 没有逐次调用的 P95。区间分析应对 `calls`、`total_exec_time` 等累计计数取差值，再用区间总耗时除以区间调用数计算均值；`mean_exec_time` 和 `max_exec_time` 不能直接做差。先核对两次快照的重置时间与淘汰计数。

块读写时间需要 PostgreSQL 的 `track_io_timing`；未开启时对应字段可能为零，不能据此判定没有 I/O。是否开启由管理员根据环境评估。应用的请求、池等待和 SQL 采集不依赖此扩展，扩展未开启不影响业务启动。

## 部署后的验证顺序

1. 请求一个 API，确认响应的 `X-Request-ID` 能找到对应的 `http.request`；提交一个任务，确认可通过 `optimization.accepted` 串到计算日志。
2. 经过一个采样窗口后检查 API 和任务进程的 `performance.runtime`、`performance.duration`，确认日志采集保留完整 JSON。
3. 对一次慢任务分别检查首次排队、各计算阶段、线程 CPU 时间和父进程收尾，再检查同一任务下的数据库慢调用。
4. 运行 PostgreSQL 只读诊断，对照客户端 SQL 耗时和数据库内部统计，确定优化层。

当多实例需要集中告警和长期分布统计时，再接入 Prometheus/Grafana 并合并直方图桶。需要自动传播 API、消息和多个计算服务之间的 trace 时，再接入 OpenTelemetry；目前的请求和任务关联号提供日志级关联。
