# V2 工作台与管理后台

首页 `/` 默认使用 V2，`/v2` 继续可用。工作台以 `section` 选择页面，
`profile_id` 保留当前游戏账号。页面组件位于 `src/pages/v2/pages/`，
`WorkspaceSections.tsx` 负责装配，共用账号、任务和工具的业务 hook。
视觉和交互规范见[设计规范](../design.md)。

## 页面入口

| section | 用途与实现入口 |
| --- | --- |
| `overview` | 排班、班次、收益分析、导出和手动调整；`V2Dashboard`、`ScheduleBoard` |
| `generation` | 数据准备、首次教程、生成进度与恢复；`pages/Generation.tsx`、`FirstScheduleGuide.tsx` |
| `plans` | 历史分页、归档、恢复、删除与常用配置；`pages/History.tsx` |
| `lab` | 组合生产、排班与无人机条件，比较并应用配置；`pages/Comparison.tsx` |
| `tools`、`manual-tool` | 工具目录和独立手动排班；`pages/Tools.tsx` |
| `cultivation`、`cultivation-projects`、`training-ratio`、`material-demand` | 练度推荐、自选目标、钱书建议和公开趋势；见[养成规划](cultivation-planning.md) |
| `depot` | 森空岛或 JSON 仓库分析；`pages/Depot.tsx` |
| `profiles`、`add-account` | 选择档案、编辑名称备注、免费绑定、CDK 兑换与原档案升级；`pages/Accounts.tsx`、`pages/AddAccount.tsx` |
| `inventory` | 道具、使用确认、任务与记录；`pages/Inventory.tsx` |
| `commercial`、`balance` | 按次档案管理、积分兑换与流水；`pages/Billing.tsx`，受各自服务开关控制 |
| `announcements` | 公告索引、阅读、未读筛选与标记；`pages/Announcements.tsx` |
| `settings` | 安全、偏好、通知和隐私；`pages/Settings.tsx` |
| `pricing`、`purchase` | 权益比较和商品购买；`pages/Pricing.tsx`、`pages/Purchase.tsx` |
| `help`、`terms`、`privacy`、`disclaimer`、`support` | 帮助、法律正文与联系入口；`pages/Documents.tsx` |
| `updates`、`status` | 更新记录和服务状态；`pages/Releases.tsx`、`pages/ServiceStatus.tsx` |

顶栏任务中心提供任务查询、取消、重试、结果恢复及通知，复用
`useOptimizationTaskCenter`。干员与基建通过抽屉编辑，分别使用
`OperatorManagementPanel` 和 `ConfigEditor`；保存状态由 `ConfigSaveStatus` 展示。
森空岛概览、库存和设施导入见[共享数据](skland-data-cache.md)。

## 首次使用、状态与权限

“生成我的排班”打开四步教程：登录或注册、绑定并导入干员、确认基建配置、
主动生成。访客可先浏览流程并返回示例排班；认证完成或取消后返回教程。
进度来自当前账号、已导入干员和已确认配置，保存失败时保留当前步骤。
添加账号默认选择免费绑定。工具的手动输入或文件导入按其自身规则开放，
需要账号数据时再提供登录入口。

- 切换档案前保存配置；失败时保留当前档案与修改。添加成功后使用服务返回的
  新档案 ID；后续保存失败时，新账号仍可从列表打开。
- 导航写入已加载的档案 ID 时复用当前登录快照，显式重试重新验证登录。
  仓库专用档案的创建与绑定不替换排班账号。
- 手动草稿在切换视图或工作台页面时保留；重新生成或切换账号前确认未保存
  内容，关闭浏览器沿用原提醒。历史模拟使用对应历史 ID 和配置。
- 培养条件先保留输入，点击更新后应用；切换来源取消旧请求。道具使用失败
  保留数量，重试复用原幂等键。
- 免费预览、体验、用券、导出和排班模式按当前权益及服务开关判断。
  免费档案不能上传替换干员；独立手动工具与结果后的调整各自校验权限。
- 站内链接转换到对应 V2 页面时保留档案、查询参数和锚点；外链与下载保留原地址。

默认进入方式、自动打开档案及重复进入观察只用于 V1；V2 始终按当前 URL 进入。

## 购买与公开图片

价格页在当前页打开所选商品弹窗，保留 `profile_id`。独立购买页使用
`/v2?section=purchase&offer=<商品ID>`；补差价的 `offer` 为 `lifetime_upgrade`，
省略时展示通用商品。购买页与价格页共用开关，购买无需登录，兑换沿用登录及权益校验。
只有点击“前往闲鱼购买”才新开外链；补差价先联系客服核对，再查看原档案权益。

购买内容集中展示商品、价格、生效条件、人工发货说明和售后入口。二维码由浏览器
根据当前商品链接生成，可保存为 PNG；失败时可重试或直接打开链接。
桌面二维码与商品并排，手机优先链接、按需展开图片；图片是唯一购买途径时默认展示。
兑换入口在分享长图之前，未配置商品或加载失败时仍保留。各商品不借用其他商品的链接或图片。

后台“公开内容管理 → CDK 购买”设置通用链接、分享图和共用说明；
“价格与权益”分别设置各套餐及补差价商品。配置留空时隐藏对应内容，允许只设置分享图。
上传支持 JPG、PNG、WebP，每张不超过 1 MB，保留原始图片；上传期间暂停发布，失败保留原图。
也可填写 HTTPS 或站内 `/assets/` 地址。保存发布后生效，沿用版本冲突检查。
旧 `qr_code_url` 字段读取时丢弃，二维码始终根据当前商品链接生成。

| 接口或存储 | 约定 |
| --- | --- |
| `POST /api/admin/public-content-image` | 要求 `admin_manage` 权限，接收图片上传 |
| `GET /api/site/public-content-image?id=<SHA-256>` | 返回公开原图 |
| `public_content_images` | 按内容地址去重保存字节；公开内容 JSON 只保存图片 URL，随 PostgreSQL 备份保留 |

部署前按[迁移流程](database-migration.md)应用 schema `2026-11-09.1`。
开发及生产 Nginx 对图片上传单独设置 2 MB 请求上限，以容纳 base64；
其余后台请求上限与限流沿用原配置，无需额外磁盘或对象存储。

## 管理后台

后台保留 `/admin` 路由与既有权限。`AdminShell.tsx` 管理导航、标题、主题和刷新；
`AdminDashboardView.tsx` 装配各业务区。桌面使用侧栏，小屏使用栏目菜单。

| 入口 | 主要任务 |
| --- | --- |
| `/admin/overview` | 指标、趋势、失败分析与报表；[统计口径](operations-overview.md) |
| `/admin/users` | 检索用户、选择档案并维护；[操作与并发约定](admin-operations.md) |
| `/admin/cdk` | 检索、生成、批量操作与分布分析 |
| `/admin/queue` | 排队、运行、近期结束、服务历史与死信处理 |
| `/admin/risk` | 案件证据、CDK 风险与规则 |
| `/admin/items` | 道具、礼包、新人任务、发放和审计 |
| `/admin/invitations`、`/admin/registration` | 邀请奖励、注册策略、邮件容量与注册邀请 |
| `/admin/announcements`、`/admin/content` | 公告、横幅与公开内容的草稿和发布 |
| `/admin/features` | 功能开关、暂停说明与保存状态 |
| `/admin/audit` | 跨业务只读操作审计；[权限与字段](admin-operations.md#global-operation-audit) |
| `/admin/setup` | 管理员账号设置，与普通用户维护区分 |

用户、CDK、总览分别管理请求与刷新；进入用户页不加载其他业务数据。
队列离开相应视图后停止轮询，浏览器隐藏时暂停周期请求。已访问栏目保留草稿；
首次访问的任务区按需挂载，离开栏目时关闭 Portal 选择器和未提交操作表单。

修改保留确认、原因、权限、审计与版本检查；失败保留输入，冲突后刷新目标版本再重试。
档案版本和工作区版本分别校验。批量操作保留失败项，发放重试复用幂等键。
操作成功后刷新失败应分别提示，不将已完成的写入显示为失败。

## V1 迁移

V2 不提供旧版入口或邀请有礼导航。原 `/v1`、`/tool/*` 的计划关闭时间为
北京时间 2026-11-15 00:00，实际是否关闭由后台“V1 旧版入口”开关控制；
倒计时不自动修改开关。关闭后原地址显示迁移说明，用户点击进入 V2 才跳转，
并保留 `profile_id`。该开关只控制 V1 页面，不删除账号、权益、道具或历史数据，
也不关闭 V2 和共用 API。

## 验证入口

工作台流程以 `V2Page.test.tsx`、`V2Page.generation.test.tsx`、
`useToolSession.test.tsx` 和各 `pages/*.test.tsx` 为主；公告链接使用
`AnnouncementMarkdown.test.tsx`。后台导航、栏目请求、轮询及操作使用对应
`src/pages/admin/**` 测试。按[验证规范](agent-validation.md)选择测试与构建，
界面检查覆盖明暗主题、窄屏、键盘、减少动画、空状态和失败恢复。
