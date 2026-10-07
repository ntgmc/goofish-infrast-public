# V2 功能对照

V2 是网站默认的工作台，首页 `/` 直接使用 V2 页面和加载首屏。原 `/v2`
地址继续可用，工作台导航通过 `section` 和 `profile_id` 保留当前位置与游戏账号。
点击页面顶部的 V2 徽标可打开旧版首页 `/v1`，旧版工作台保留 `/tool/*` 地址。
邀请有礼不进入 V2 导航；已有 CDK、档案权益、道具和导出能力继续按原规则使用。
添加账号默认选择免费绑定。
默认进入方式的设置、提醒、自动打开档案与重复进入记录仅用于 V1；V2 按当前页面地址进入。

| 功能 | V2 入口 | 复用的业务实现 |
| --- | --- | --- |
| 生成选项、进度和恢复 | 排班总览、生成与计算 | 独立 `Generation` 页面、`useOptimizeWorkflow` |
| 任务查询、取消、重试、结果恢复和完成通知 | 顶栏任务中心 | `useOptimizationTaskCenter`、`OptimizationTaskCenterDialog` |
| 排班安排、技能与心情 | 排班总览的排班安排；展开设施或点击设施查看详情 | `ScheduleBoard`、`OptionsDrawer`、既有结果格式化与技能计算 |
| 收益明细、产出汇总与库存 | 排班总览的收益分析；汇总与库存按需展开 | `IncomeAnalysis`、`ResultMetrics` |
| MAA 文件、排班图片、完整计算数据与执行说明 | 排班总览顶部的导出面板 | `ResultExportDrawer`、`useResultDownloads`、`downloadScheduleImage` |
| 结果后的手动调整、草稿、导入导出与模拟 | 排班总览的手动调整 | `ManualScheduleEditor` |
| 干员培养收益与成本建议 | 结果中的培养建议 | `UpgradeSuggestions` |
| 常用配置、历史分页、归档、恢复与删除 | 历史方案 | 独立 `History` 页面、`useOptimizeWorkspace` |
| 多配置计算和应用配置 | 方案对比 | 独立 `Comparison` 页面、`useScenarioComparison` |
| 独立手动排班、培养规划、仓库价值 | 实用工具 | 独立 `ManualTool`、`Cultivation`、`Depot` 页面及共享业务 hook |
| 切换账号、档案名称与备注 | 账号与档案、顶栏账号菜单 | 独立 `Accounts` 页面、`useProfiles`、`useProfileDetails`、`useToolSession` |
| 免费账号绑定、CDK 和道具兑换 | 添加账号 | 独立 `AddAccount` 页面、`useAccountRedemption`、`SklandBindingDialog` |
| 使用已有 CDK 升级当前免费档案 | 添加账号中的现有档案升级 | `PreviewUpgradePanel`、`handleUpgradePreviewProfile` |
| 库存自动配置、固定换班时长、配置差异与保存重试 | 基建配置 | `ConfigEditor`、`ConfigSaveStatus` |
| 密码、通知、授权、动画偏好与注销 | 账号设置 | 独立 `Settings` 页面、`useAccountSettings`、共享通知与偏好控件 |
| 道具与档案容量 | 背包 | 独立 `Inventory` 页面、`useInventory` |
| 已开放的按次账号和余额 | 对应导航入口 | 独立 `Billing` 页面、原业务 hook 与服务开关 |
| 公告、未读数量、标记已读和弹窗 | 查看公告 | 独立 `Announcements` 页面、共享公告 hook 与弹窗 |
| 使用指南、更新日志、状态、条款与权益说明 | 对应 V2 页面 | 独立 `Documents`、`Releases`、`ServiceStatus`、`Pricing` 页面 |

## 状态与权限

- 切换档案前完成待保存配置；保存失败时保留当前档案和修改。
- 添加账号后使用返回的档案 ID。配置保存失败或选择保留手动草稿时继续使用
  当前档案，已添加的账号仍可从账号列表打开。
- 导航写入已经加载的档案 ID 时复用当前登录快照；显式重试仍重新验证登录。
- 三个工具共享当前 V2 会话。仓库专用档案的创建和绑定不替换排班账号。
- 手动修改在切换结果视图和其他工作台页面时保留。重新生成或切换账号前
  确认未保存修改；浏览器关闭提醒与草稿格式继续使用原实现。
- 历史结果的手动模拟使用历史 ID 和对应配置；结果更新后重新建立编辑状态。
- 免费预览、体验权限、导出体验券、排班模式和服务开关继续按原有规则判断。
  免费档案不允许上传替换干员；独立手动工具与结果后手动调整分别沿用原权限。
- V2 中公告、帮助和权益内容的内部链接保留账号、查询参数与锚点，转换到
  V2 对应页面。外部网站和下载地址保留原地址。

## 回归验证

关键流程覆盖在 `V2Page.test.tsx`、`V2Page.generation.test.tsx`、
`useToolSession.test.tsx` 和 `AnnouncementMarkdown.test.tsx`。工具计算、
账号设置、历史管理、任务中心与手动编辑继续运行各自原有测试。
`pages/Inventory.test.tsx` 覆盖新道具对话框的失败重试与幂等键复用。
逐页结构与浏览器验证见 [V2 深度重构交付报告](v2-workspace-redesign.md)。
