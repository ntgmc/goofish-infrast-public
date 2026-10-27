# 前端查询缓存

TanStack Query v5 管理普通页面读取：库存、新手任务、优化任务、积分流水、邀请与商用档案、公告、反馈与通知、QQ Bot 设置、排班历史分页和详情、公共内容与站点开关、注册配置、服务状态、版本信息，以及后台列表、详情、设置和监控快照。`App` 的 `QueryProvider` 为各路由共享一个内存中的 `QueryClient`，不持久化缓存。请求继续使用 `apiJson`、`adminApiJson` 和现有优化 API 函数，沿用超时、错误消息、诊断及管理员会话过期处理。

## 状态归属

查询保存服务端数据、加载状态、错误和分页游标。组件保留筛选输入、选择、弹窗、通知和提交状态。不要把查询返回的数据再复制到 `useState`，也不要为同一个查询另设请求序号或取消控制器；查询函数应把 TanStack Query 提供的 `signal` 传给请求函数。

默认新鲜期为 30 秒，关闭自动重试和窗口聚焦刷新。库存通过下述失效桥接刷新；任务中心与后台队列快照分别启用回到前台时刷新和定时查询。积分余额的新鲜期为 0，进入页面和回到前台时都重新读取，避免直接沿用短期缓存中的余额。失败后保留同一身份下最后成功的数据，并显示错误。切换身份或分页时不使用上一查询的数据作为占位。

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
| 用户反馈列表与时间线 | `['user', userId, null, 'feedback', 'list'或'thread', ...分页或反馈ID]` |
| 用户通知分页 | `['user', userId, null, 'notifications']` |
| QQ Bot 设置 | `['user', userId, null, 'qqbot']` |
| 钱书平衡的账号培养资料 | `['user', userId, profileId, 'training-ratio', 森空岛快照版本]` |
| 排班历史详情 | `['user', userId, profileId, 'result-history', 'detail', resultId]` |
| 排班历史分页 | `['user', userId, profileId, 'result-history', 'pages', scope, 首屏快照]` |
| 公共内容、站点开关、注册配置、服务状态和构建版本 | `['public', 'content'或'features'或'registration-settings'或'service-status'或'service-build', ...条件]` |
| 公开公告全量列表（横幅、提醒来源与原公开页共用） | `['public', 'announcements', 'all']` |
| 更新记录分页与定位 | `['public', 'changelog', page, ...未缓存的版本ID]` |
| 后台栏目读取（反馈、设置、道具、行为风控、服务历史、死信） | `['admin', adminUsername, 'panels', capabilities, name, ...条件]` |
| 后台用户、CDK、干员和积分详情 | `['admin', adminUsername, 'details', capabilities, name, ...目标与分页]` |
| 后台死信载荷详情 | `['admin', adminUsername, 'panels', capabilities, 'dead-letter-detail', id]` |
| 管理账号列表 | `['admin', adminUsername, 'setup-users', capabilities]` |
| 后台用户分页 | `['admin', adminUsername, 'users', capabilities, operationsSearch, page, pageSize, search, filters]` |
| 后台 CDK 分页 | `['admin', adminUsername, 'cdks', capabilities, 'list', page, pageSize, search, filters]` |
| 后台风险记录分页 | `['admin', adminUsername, 'cdks', capabilities, 'risk', page, pageSize]` |
| 后台运营报表 | `['admin', adminUsername, 'overview', capabilities, rangeQuery]` |
| 后台今日待办 | `['admin', adminUsername, 'operations-todos', capabilities, refreshKey]` |
| 后台任务监控队列快照 | `['admin', adminUsername, 'optimization-queue', capabilities, relatedQuery]` |
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

## 后台待办与队列快照

今日待办只在总览栏目活跃、管理员身份已确认且具有 `usage_view` 时订阅。运营报表的 `generated_at` 作为 `refreshKey` 进入查询键，报表更新后读取对应的待办快照；手动刷新只重读当前待办。同一管理员、权限和刷新标识下共享在途请求与 30 秒内的新鲜结果，保留按权限显示待办入口和读取失败时隐藏数字的行为。

队列快照只在任务监控栏目和任务视图活跃、管理员具有 `optimization_view` 时订阅。关联账号、档案或任务的 `relatedQuery` 进入查询键；面板内搜索、状态、来源和优先级筛选继续在本地执行，不额外请求。队列新鲜期为 0，进入视图和回到前台时刷新；每 5 秒查询，网页隐藏时暂停轮询。多个消费者、轮询和前台恢复共用尚未完成的读取，不反复取消慢请求。刷新失败保留同一查询的最后成功快照，允许手动重读。

离开栏目或队列任务视图时脱离原查询，取消无人订阅的读取；切换管理员、权限或关联查询时不显示旧查询的数据。没有身份或所需权限时，自动读取和手动刷新均禁用。查询数据脱离时保留队列筛选、展开状态及已访问的服务历史、死信子面板，避免卸载清空本地编辑；管理员变化时重新挂载监控面板。服务历史与死信读取也由 Query 管理，提交仍沿用原有流程。

## 反馈、通知与设置草稿

用户身份由 `UserQueryScope` 提供；后台保留已访问栏目，通过 `AdminQueryScope` 提供管理员、权限和活跃状态。后台只有当前有权限的栏目订阅读取，切换管理员会重新挂载栏目；用户反馈和 QQ Bot 表单也按用户重新挂载。

反馈列表按筛选和页码查询，时间线使用 `before_revision` 分页，合并时按 revision 去重。回复保留 `expected_revision`、内容签名对应的请求幂等键、冲突提示和明确重试。成功后使同一身份下的反馈列表与时间线失效；后续读取失败不会重发回复。身份、权限或目标变化会取消未完成回复，输入保留到原有明确清除操作。

通知每 60 秒查询，隐藏时暂停，回到前台或窗口重新聚焦时刷新。分页刷新跟随新的服务端游标并按 ID 去重；通知中的库存变化仍调用 `markInventoryStale()`。标记已读前后取消旧读取，单条标记只修改匹配 `updated_at` 的通知；迟到结果不会重建退出时删除的缓存。账号安全入口没有工作台身份时，QQ Bot 面板先确认会话再读取设置，避免在服务暂停时丢失解绑入口。QQ Bot 的绑定码生成、更换、解绑和通知开关仍手动提交，读取重试不重复提交。

后台设置通过 `useAdminPanelQuery` 保存线上快照；需要编辑的页面通过 `useAdminDraftQuery` 初始化草稿。同一管理员、权限和目标下，自动读取只初始化一次，保留输入；明确重载才重新应用快照，原有丢弃确认继续生效。保存后先取消旧 GET，再写入已有缓存，保留原 revision、操作原因和 Root 二次认证。服务历史的事件正文与成本配置同样保留独立草稿。

行为风控保留分页修正、证据校验和复核状态；死信每 15 秒查询，离开时暂停，载荷按需读取并在记录移除后释放。后台详情用查询键隔离目标和权限，干员数据仍按需展开或下载。后台积分流水在计费功能可用时才读取，沿用游标并按交易 ID 去重；调整成功与刷新失败分别处理，不因读取失败再次调整积分。

## 工作区与历史的衔接

工作区快照仍提供历史首屏。活动与归档历史分别使用 `useInfiniteQuery`，工作区版本、首屏内容和游标进入查询键；首屏替换后脱离旧分页，取消无人订阅的读取，避免旧页回填。首屏不额外重读，后续分页按 ID 去重。相同工作区版本与首屏可复用已加载页面；历史详情按用户、档案和结果 ID 共用缓存，供生成、对比、养成和收益摘要使用。

历史重命名更新已有详情缓存，删除时取消并移除详情；成功返回的工作区快照更新分页来源。选择历史结果、导入配置或文件仍保留本地操作的取消标记，防止迟到的读取覆盖较新的编辑选择。这些标记不保存另一份分页数据。

## 保留的专用流程

会话检查、登录退出和工作区读取与应用仍由会话流程协调：它们还负责身份清理、档案切换、森空岛会话同步和编辑草稿。工作区修改与自动保存保留串行队列、草稿恢复和版本检查。计费报价、声明确认、计费提交、任务提交和执行进度保留各自的实时校验、幂等与恢复机制。森空岛快照客户端继续负责请求合并、版本失效、过期与跨标签页通知；设施导入和其他计算请求仍由原操作发起。这些流程不使用普通页面缓存替代校验或提交。

公共内容校验失败时保留最后成功的内容；站点开关失败时关闭功能。服务状态每 30 秒刷新，保留对 HTTP 503 有效状态正文的解析。页面构建信息与更新提示共用健康读取，更新提示只接受成功健康响应并在发现新版本后停止轮询。更新记录保留翻页失败时继续显示上一次成功正文的行为，通过缓存中的页码读取正文，不另存一份响应；重试仍请求当前页。注册设置只在注册表单打开时读取。管理账号设置页先确认管理员会话，再按身份读取账号列表；列表重试与 Root 授权的创建、替换、删除分开处理。

涉及缓存共享、身份切换、迟到响应、退出清理或修改后的失效时，运行 `admin-panel-query.test.tsx`、`useAdminDetailQuery.test.tsx`、`use-feedback-thread.test.ts`、`NotificationCenter.test.tsx`、`balance-actions.test.tsx`、`useResultHistoryPagination.test.tsx`、`inventory-query.test.tsx`、`inventory-hooks.test.tsx`、`useOptimizationTaskCenter.test.tsx`、`useOptimizeWorkflow.races.test.tsx`、`BalanceSection.test.tsx`、`InvitationsSection.test.tsx`、`CommercialProfilesSection.test.tsx`、`ProfileUpgradePrompt.test.tsx`、`announcement-query.test.tsx`、`AnnouncementsSection.test.tsx`、V2 `Announcements.test.tsx`、`Accessibility.test.tsx`、`useAdminUserList.test.tsx`、`useAdminCdkData.test.tsx`、`useAdminOverview.test.ts`、`useAdminController.test.tsx`、`OperationsTodosPanel.test.tsx`、`QueueMonitorPanel.test.tsx`、`AdminDashboardView.navigation.test.tsx` 及相关页面集成测试，再按 [验证规则](agent-validation.md) 运行仓库检查。
