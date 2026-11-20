# 文档导航

本地安装与启动见[项目 README](../README.md)，提交要求见[贡献指南](../CONTRIBUTING.md)。
按当前任务选择下表中的说明。

## 产品与界面

| 任务 | 文档 |
| --- | --- |
| 了解产品、用户流程和术语 | [产品说明](../PRODUCT.md) |
| 修改布局、主题和交互 | [设计规范](../design.md) |
| 查找 V2 页面、购买配置和后台入口 | [V2 工作台与管理后台](v2-workspace.md) |
| 修改界面文案和付费能力预览 | [文案目录](../src/copy/README.md)、[产品文案](product-copy.md) |
| 维护前端请求与缓存 | [查询缓存](frontend-queries.md)、[列表交互性能](frontend-performance.md) |

## 功能与数据

| 任务 | 文档 |
| --- | --- |
| 森空岛登录、导入与刷新 | [连接服务部署](skland-connector.md)、[共享数据与授权](skland-data-cache.md) |
| 维护基建技能数据和图标 | [基建技能资源](building-skill-assets.md) |
| 维护练度推荐、养成项目和钱书建议 | [养成规划](cultivation-planning.md) |
| 核对排班产出和回收站估值 | [产出与等效理智](production-income.md)、[回收站](recycling.md) |
| 配置 AI 解读与积分计费 | [AI 排班解读](ai-schedule-explanation.md) |
| 处理档案命名和用户反馈 | [档案信息](profile-metadata.md)、[反馈跟进](feedback-follow-up.md) |
| 接入 QQ Bot | [账号、通知与群奖励接口](qqbot-handoff.md) |
| 核对公开横评数据与发布规则 | [排班效果对比](site-benchmark.md) |

## 开发与运维

| 任务 | 文档 |
| --- | --- |
| 选择测试和完成检查 | [验证规范](agent-validation.md) |
| 放置和维护文档 | [README 与文档规范](readme-guidelines.md) |
| 修改后台操作、权限与并发校验 | [管理操作约定](admin-operations.md) |
| 核对运营指标和工具事件 | [运营统计](operations-overview.md)、[工具操作观测](tool-behavior-observation.md) |
| 定位慢请求、SQL 与运行时开销 | [性能观测](performance-observation.md) |
| 部署反向代理 | [Nginx 配置](nginx-deployment.md) |
| 发布和验证产物 | [发布工件](release-artifacts.md) |
| 数据库升级与故障处理 | [迁移安全](database-migration.md) |
| 备份、恢复和密钥轮换 | [灾难恢复](disaster-recovery.md) |
| 查看仍待复核的历史风险 | [评审待核查事项](review-fixes.md) |

商品权益由 `product/catalog.json` 维护，[PRICE.md](../PRICE.md) 随目录生成。
公开范围和安全报告分别见[开源边界](../OPEN_SOURCE_BOUNDARY.md)和[安全策略](../SECURITY.md)。
