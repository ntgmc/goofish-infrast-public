# 基建技能数据与图标

基建技能浮层与手动排班的设施筛选、候选卡片使用仓库内的同一份快照，页面不请求上游服务。

- 技能效果、适用设施、解锁条件及技能强化分组来自 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 `zh_CN/gamedata/excel/building_data.json`。
- 干员中文名称及基建技能 PNG 图标来自 [arkntools/arknights-toolbox-data](https://github.com/arkntools/arknights-toolbox-data) 的 `assets/locales/cn/character.json` 与 `assets/img/building_skill`。
- 上游提交 SHA 保存在 `src/data/building-skills.json` 的 `source` 字段。
- 干员职业来自同一 arkntools 快照的 `assets/data/character.json`，保存在干员的 `profession` 字段。
- 职业图标保存在 `public/operator-professions`，来自 ZOOT-Plus/zoot-plus-frontend 提交 `130a0ce499da611fd49f4c2a03a2fe0b61684a8f` 的 `public/assets/prof-icons`，同步脚本固定该版本。
- 图标保存在 `public/building-skills`。游戏数据、名称与美术资源归各自权利人所有；arkntools 的 MIT 许可保存在 `public/building-skills/LICENSE.txt`。

更新及校验：

```sh
node scripts/sync-building-skills.mjs
node scripts/sync-building-skills.mjs --check
node scripts/sync-building-skills.mjs --self-test
```

同步先下载并验证完整数据及全部引用图标，再写入本地文件。`--check` 对照已记录的上游提交验证快照，不追踪上游分支新提交。更新后检查差异、运行相关测试及仓库校验，再提交资源。

总览图 v2 的“显示干员职业”默认关闭。开启后，干员头像右上角显示职业图标，当前班次和全部班次的图片导出沿用该设置。

设施筛选与候选卡片使用当前精英阶段和等级已解锁、未被强化版本替换的技能。候选卡片在头像右侧显示技能图标和两行效果，完整内容可悬停头像查看；选择“全部设施”时显示各设施的已解锁技能。未提供等级时，仅确认该精英阶段 Lv.1 已解锁的技能。未提供精英阶段时，浮层展示解锁要求，不标记技能为已解锁。没有技能数据的干员保留在候选中，并标记“暂无技能资料”。
