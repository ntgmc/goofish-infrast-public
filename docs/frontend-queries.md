# 前端查询缓存

TanStack Query v5 当前管理库存、库存余额提示、新手任务、优化任务列表、积分余额明细、好友邀请记录、商用档案分页和用户公告（含 V2 公开分页），以及后台用户、CDK、风险记录分页列表和概览读取（运营报表、CDK 汇总、公告线上快照、风控设置）。`App` 的 `QueryProvider` 为各路由共享一个内存中的 `QueryClient`，不持久化缓存。请求继续使用 `apiJson`、`adminApiJson` 和现有优化 API 函数，沿用超时、错误消息、诊断及管理员会话过期处理。

## 状态归属

查询保存服务端数据、加载状态、错误和分页游标。组件保留筛选输入、选择、弹窗、通知和提交状态。不要把查询返回的数据再复制到 `useState`，也不要为同一个查询另设请求序号或取消控制器；查询函数应把 TanStack Query 提供的 `signal` 传给请求函数。

默认新鲜期为 30 秒，关闭自动重试和窗口聚焦刷新。库存通过下述失效桥接刷新；任务中心单独启用回到前台时刷新和定时查询。积分余额的新鲜期为 0，进入页面和回到前台时都重新读取，避免直接沿用短期缓存中的余额。失败后保留同一身份下最后成功的数据，并显示错误。切换身份或分页时不使用上一查询的数据作为占位。

## 查询键与清理

| 数据 | 查询键 |
| --- | --- |
| 库存（页面、余额提示与档案升级提示共用） | `['user', userId, profileId, 'inventory']` |
| 新手任务 | `['user', userId, profileId, 'onboarding-tasks']` |
| 优化任务分页 | `['user', userId, profileId, 'optimization-jobs']` |
| 积分余额与明细分页 | `['user', userId, profileId, 'balance']` |
| 好友邀请概况与记录分页 | `['user', userId, profileId, 'invitations']` |
| 商用档案分页 | `['user', userId, profileId, 'commercial-profiles', state, appliedQuery]` |
| 用户公告全量列表（V1 列表与弹窗共用） | `['user', userId, null, 'announcements', 'all']` |
| V2 用户公告分页 | `['user', userId, null, 'announcements', 'page', page, unreadOnly]` |
| V2 公开公告分页 | `['public', 'announcements', 'page', page, false]` |
| 后台用户分页 | `['admin', adminUsername, 'users', capabilities, operationsSearch, page, pageSize, search, filters]` |
| 后台 CDK 分页 | `['admin', adminUsername, 'cdks', capabilities, 'list', page, pageSize, search, filters]` |
| 后台风险记录分页 | `['admin', adminUsername, 'cdks', capabilities, 'risk', page, pageSize]` |
| 后台运营报表 | `['admin', adminUsername, 'overview', capabilities, rangeQuery]` |
| 后台 CDK 汇总 | `['admin', adminUsername, 'cdks', capabilities, 'summary']` |
| 后台公告线上快照 | `['admin', adminUsername, 'announcement', capabilities]` |
| 后台风控设置 | `['admin', adminUsername, 'risk-settings', capabilities]` |

没有活动档案时使用 `null`；公告阅读状态属于用户账号，档案位置固定为 `null`，供同一用户的所有档案共用。没有已确认的用户身份时禁用用户查询；V2 访客只读取公开公告查询。后台查询按管理员会话、权限和完整筛选条件隔离，不属于某个游戏档案；无访问权限或离开对应页面时使用禁用查询并脱离原查询，取消无人订阅的请求。

`useToolSession` 应用会话响应时删除其他用户的查询；退出账号删除全部用户查询并取消在途请求。账号安全页的退出和注销申请成功后同样清理。后台退出或会话失效由 `resetAdminState` 删除后台查询。用户会话与管理员会话分别清理。

## 刷新与修改

- `markInventoryStale()` 仍是道具使用、领取和其他库存变化的通知入口。`QueryProvider` 通过现有 `useInventoryRefresh` 将通知转换为库存和新手任务查询失效，回到前台时也刷新。请求中收到的失效通知在请求结束后补刷，多个消费者共享同一请求。优先计算券的数量、永久数量和最近到期日从同一份库存派生，生成页面共用库存错误与重试；请求失败保留上次成功数量，同时取消优先券选择。切换档案或券数归零也取消选择。任务结束后只刷新一次库存。档案升级提示同样复用该查询，只在档案符合条件且未被关闭时订阅；从库存派生可用升级道具，保留弹窗避让和按用户关闭提示，读取失败时安静隐藏。
- 好友邀请使用 `useInfiniteQuery`，沿用服务端游标，刷新已加载页面时使用新游标并按记录 ID 去重。有待结算记录时每 15 秒查询，页面隐藏时暂停轮询，回到前台时刷新；慢请求不会被轮询中断。读取或观察到已发奖邀请数量变化时，通过库存通知刷新道具余额。邀请码生成、更换、暂停和恢复保留原提交与更换确认；操作成功后使该用户各档案的邀请查询失效，读取失败不重提修改。
- 优化任务使用 `useInfiniteQuery`，打开任务中心或有进行中任务时每 10 秒刷新，否则每 30 秒刷新。页面隐藏时暂停轮询，回到前台时刷新。现有跨标签页任务通知仍合并为延迟 250 毫秒的刷新；慢请求不会被定时查询反复取消。刷新已加载的多页时依次读取新的游标，合并结果时按任务 ID 去重。
- 取消任务仍执行原有确认与提交，成功后使对应用户、档案的任务列表失效。
- 积分余额与明细使用 `useInfiniteQuery`，沿用服务端游标，逐页刷新并按流水 ID 去重。界面从最后一次成功读取的分页响应中获取余额和 `as_of`。兑换仍使用原提交与幂等键；成功后使该用户各档案的余额查询失效。兑换成功提示和账单刷新错误分别展示，查询失败不会触发兑换重试。查询中的余额不替代计费报价或服务端结算。
- 商用档案列表使用 `useInfiniteQuery`，搜索词只在提交表单后进入查询键；归档状态与身份变化时不沿用其他查询的数据，同时清空选择和编辑草稿。刷新已加载页面时跟随新的服务端游标，按档案 ID 去重，限额取最后一次成功读取的分页响应。创建、编辑、归档、恢复、删除和批量归档保留原提交方式与删除确认；批量结果未知时沿用原操作幂等键，明确成功后才清除。修改成功后使该用户各档案、筛选下的商用列表失效，刷新失败保留已有快照及成功提示，重试读取不会重复提交修改。
- 后台用户修改成功后调用 `loadUsersPage`，使当前管理员的所有用户列表查询失效：当前页刷新，其他缓存页再次打开时读取新数据。CDK 修改后的 `loadCdkPage`、`loadRiskPage` 共用 `cdks` 前缀，使普通列表、风险列表的所有缓存页与汇总同时失效。保留操作原因、乐观并发检查，以及“操作成功但刷新失败”的错误处理。

## 公告列表与阅读状态

`useUserAnnouncementsQuery` 供 V1 公告列表与登录公告弹窗共用请求和快照；弹窗只在有有效提醒且本次访问尚未展示时订阅。保留按公告版本判断已读、一次访问只提醒一次、到期自动关闭和焦点恢复；读取失败不弹出无法确认阅读状态的旧公告。未登录时仍使用原有本地阅读标记。

V2 分页按用户或公开身份、页码与未读筛选隔离。直达尚未缓存的公告时，查询键追加公告 ID，让服务端定位所在页；响应也保存到实际页码对应的缓存。页码校正、页内切换和短时间内返回访问过的页面可复用结果；页码校正沿用原响应时间，不延长旧快照的新鲜期。切页失败只显示所请求页的错误，不用上一页正文占位；同一页刷新失败保留已有快照。

标记单条或全部已读仍由用户明确提交，单条提交携带原公告版本。成功后先取消旧读取，使该用户所有公告列表和分页失效，再将响应写入已有的对应快照；其他正在使用的视图重新读取，缓存页下次打开时更新。只返回未读数量的响应也会触发重读。退出后清除的缓存不会被迟到响应重建；查询失败不会自动重复标记。V1/V2 列表在身份变化或卸载时取消未完成的标记提交，V2 翻页也会取消并忽略该页的迟到提交结果。

## 后台概览与配置快照

`useAdminOverview` 只在对应栏目和权限下订阅查询：运营报表需要 `usage_view`，公告需要 `admin_manage`，风控设置需要 `risk_view`，CDK 汇总需要 `admin_manage` 并供 CDK、风控两页共享。各读取独立保存结果；其中一项失败时保留其他成功结果和最近成功同步时间，继续显示部分失败提示。请求取消、迟到响应隔离和加载状态由查询负责。

运营报表的固定范围和已应用的自定义日期进入查询键，输入日期草稿不发请求；保留日期及响应版本校验。更换范围不显示上一范围的数据。导出使用当前范围成功读取的快照，刷新中暂停导出。

公告线上快照与本机编辑草稿分开管理，查询结果继续经过现有草稿协调逻辑，保留自动保存、恢复、版本冲突和明确丢弃操作。公告发布、丢弃草稿后的读取和 409 冲突响应会更新当前管理员、权限下已有的快照；风控保存及冲突响应同样更新设置缓存。写回前取消旧读取，退出后已删除的缓存不会被写回操作重新创建。修改仍由原操作函数提交，不自动重试。

手动刷新和修改后的刷新使当前栏目对应的查询前缀失效；CDK 汇总与列表只失效一次。当前栏目读取新数据，其他已缓存范围或页面下次使用时重读；修改成功与后续读取失败分别提示。

## 本阶段保留的流程

会话与工作区读取、原公开公告页及会话附带的横幅/提醒来源、排班历史分页、自动保存、计费报价与提交、任务提交、后台详情读取及其他独立面板、森空岛快照客户端仍使用原有流程。排班历史首屏由工作区快照提供，后续迁移需一起处理快照替换和历史修改后的失效。自动保存的串行队列与草稿恢复、提交的幂等键，以及森空岛的请求合并、版本失效和跨标签页通知不由查询缓存替代。后续迁移应逐个明确数据身份和失效来源，保留这些流程已有的边界语义。

涉及缓存共享、身份切换、迟到响应、退出清理或修改后的失效时，运行 `inventory-query.test.tsx`、`inventory-hooks.test.tsx`、`useOptimizationTaskCenter.test.tsx`、`useOptimizeWorkflow.races.test.tsx`、`BalanceSection.test.tsx`、`InvitationsSection.test.tsx`、`CommercialProfilesSection.test.tsx`、`ProfileUpgradePrompt.test.tsx`、`announcement-query.test.tsx`、`AnnouncementsSection.test.tsx`、V2 `Announcements.test.tsx`、`Accessibility.test.tsx`、`useAdminUserList.test.tsx`、`useAdminCdkData.test.tsx`、`useAdminOverview.test.ts`、`useAdminController.test.tsx` 及相关页面集成测试，再按 [验证规则](agent-validation.md) 运行仓库检查。
