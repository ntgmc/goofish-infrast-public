# 养成规划

工具入口为 `/tool/tools` → 养成规划，页面地址为 `/tools/cultivation-plan`。
所有已绑定森空岛的可用档案均可读取练度与仓库，包括免费档案。
需要开启现有的 `tools` 和 `skland` 功能。

页面读取当前精英阶段、等级、技能等级、所选技能专精、指定模组、潜能和库存，
对照 PRTS 作业写明的练度，计算升级、精英化、技能及模组材料缺口。
作业未注明的要求和森空岛未返回的练度会标为待核对，不默认补成满练。
潜能不足也需另行获取信物或重复干员。

补齐优先按未满足要求的相关作业需求排序，同等需求下优先低成本；材料优先先
选择库存能够支持的目标，再按缺口成本安排；最低成本优先比较材料缺口的等效理智。
每名干员选择一个作业目标，连续扣减共享库存；加工材料计入原料和加工龙门币，
芯片转换只能使用已有芯片。固定位置按一份需求统计，替代组按组内人数折算；
已满足其中一个替代选项的组不产生新的培养建议。
需求统计描述单名干员的练度，不能据此声称整份作业已可通关。

每日计划按常驻关卡的平均掉落、整次刷取理智和国服开放日安排。游戏日从北京时间
04:00 开始，可以在活动全开放期间手动开启全开放选项。默认不使用理智药，用户
勾选数量后才计入。过期药不计入；有效期缺失时页面提示用户核对；过期当天不能
保证整天可用，因此保守地不安排当天使用。未识别恢复量的理智药不计入。

等效理智复用仓库估价的一图流价格和龙门币/经验口径，用于比较目标；
每日实际刷取预算用关卡理智消耗计算，两者不是同一个值。
模组数据块等无稳定常驻刷取来源的材料单列，不推算材料备齐日期。
日期是平均掉落下的材料备齐估计，专精训练、模组任务、基建生产、关卡解锁和
随机掉落需要另外考虑。偏好、每日预算、药品数量和排除干员变化时在浏览器即时重算；
练度和库存要点击导入按钮才能刷新，页面不保存森空岛凭据或个人库存。

## 首次部署导入

网站不进行首次全量作业爬取。先在 qqbot_manager 生产环境完成一次全量刷新，
再把以下两个文件复制到部署环境：

- 完整 SQLite 备份：默认原文件 `data/prts_difficulty.sqlite3`。
- 同目录养成成本缓存：`data/prts_costs_evidence-v3.json`，包含固定版本的消耗表。

SQLite 启用了 WAL，不要直接复制正在运行的主数据库文件。可以在 qqbot_manager
服务器使用 SQLite 的在线备份接口，生成一致的独立文件：

```sh
python3 -c 'import sqlite3; source=sqlite3.connect("file:data/prts_difficulty.sqlite3?mode=ro", uri=True); target=sqlite3.connect("/tmp/prts-planning-export.sqlite3"); source.backup(target); target.close(); source.close()'
```

下载 `/tmp/prts-planning-export.sqlite3` 与成本缓存后，在网站源码目录执行：

```sh
node scripts/import-prts-planning.mjs \
  --database /path/to/prts-planning-export.sqlite3 \
  --costs /path/to/prts_costs_evidence-v3.json \
  --output /var/lib/maatool/cultivation/prts-planning.json
```

发布产物自带编译后的导入和同步脚本。只有部署产物时，将上述命令中的
`scripts/import-prts-planning.mjs` 替换为 `server/dist/import-prts-planning.js`；
下文同步命令同样可替换为 `server/dist/sync-prts-planning.js`。
需要 Node.js 24 和发布产物的已安装依赖，不需要 Python 或 qqbot_manager 插件。

脚本只读源数据库，导入当前完成快照的有效详情；详情缺失或内容版本与快照不匹配
时整次导入失败，保留原网站数据。导入不会发起作业全量请求。
脚本会下载该成本缓存固定 `game_sha` 对应的干员、加工配方、物品与开放日数据，
以及企鹅物流国服常驻掉落统计。掉落样本至少 300 次，活动限时关卡不参与。
更新后的数据先完整校验，再原子替换，不会在网站读取时留下半份文件。

后端环境设置：

```sh
MAA_PRTS_PLANNING_PATH=/var/lib/maatool/cultivation/prts-planning.json
```

不配置时使用工作目录下 `.cache/cultivation/prts-planning.json`。
部署需把该数据目录作为持久化目录保留，不随应用发布覆盖；API 进程需有读取权限，
导入/同步账号需有写权限。数据目录仅包含公开作业和游戏元数据，不包含用户库存或凭据。
未导入时页面提示等待作业数据可用，不会自动回退到全量下载。

## 后续增量维护

API 启动后每小时检查一次作业数据，超过 24 小时自动进行增量同步。
未导入数据时跳过同步；关闭 API 时取消当前更新并保留原快照。
API 账号需对数据目录有写权限，多个 API 进程通过同一文件锁避免同时写入。
也可以手动或在部署平台定时任务中运行下面的命令；不需要运行 qqbot_manager：

```sh
node scripts/sync-prts-planning.mjs \
  --output /var/lib/maatool/cultivation/prts-planning.json \
  --reconcile 200
```

同步从导入时保存的最大作业 ID 继续，按 ID 降序读取新摘要，遇到旧 ID 停止翻页。
新作业详情限制为每秒最多两次请求。默认还逐次复查 200 份历史详情，识别编辑、
隐藏和删除；进度随快照持久化，下次继续。历史变化的发现有延迟，不保证当天全量复查。
`--reconcile 0` 可暂时只取新增作业，最大为 2000。
数据未导入、上游失败、格式异常或同步锁已占用时命令以非零状态退出，并保留原快照和游标。

干员实装或成本数据版本变化时，下载刷新后的 qqbot 成本缓存，再更新游戏元数据：

```sh
node scripts/sync-prts-planning.mjs \
  --output /var/lib/maatool/cultivation/prts-planning.json \
  --costs /path/to/prts_costs_evidence-v3.json \
  --refresh-assets true
```

离线部署可给导入脚本加 `--assets /path/to/assets.json`，提供同版本的
`operators`、`recipes`、`farms`、`itemNames` 和 `potionValues`；格式由
`scripts/prts-planning-lib.mjs` 的 `loadPlanningAssets` 生成，校验不通过不会替换数据。
导入与同步共用独占 `.lock` 文件。进程异常终止留下锁时，先确认没有同步进程，
再移除对应快照旁的 `.lock` 文件后重试。

## 验证

```sh
node --test scripts/prts-planning.test.mjs
npm test -- src/lib/cultivation-planner.test.ts server/cultivation/data.test.ts server/handlers/cultivation-plan.test.ts src/pages/CultivationPlanPage.test.tsx
```
