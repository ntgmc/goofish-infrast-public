# 基建技能数据与图标

基建技能浮层与手动排班筛选使用仓库内的同一份快照，页面不请求上游服务。

- 技能效果、适用设施、解锁条件及技能强化分组来自 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 `zh_CN/gamedata/excel/building_data.json`。
- 干员中文名称及基建技能 PNG 图标来自 [arkntools/arknights-toolbox-data](https://github.com/arkntools/arknights-toolbox-data) 的 `assets/locales/cn/character.json` 与 `assets/img/building_skill`。
- 上游提交 SHA 保存在 `src/data/building-skills.json` 的 `source` 字段。
- 图标保存在 `public/building-skills`。游戏数据、名称与美术资源归各自权利人所有；arkntools 的 MIT 许可保存在 `public/building-skills/LICENSE.txt`。

更新及校验：

```sh
node scripts/sync-building-skills.mjs
node scripts/sync-building-skills.mjs --check
node scripts/sync-building-skills.mjs --self-test
```

同步先下载并验证完整数据及全部引用图标，再写入本地文件。`--check` 对照已记录的上游提交验证快照，不追踪上游分支新提交。更新后检查差异、运行相关测试及仓库校验，再提交资源。

筛选使用当前精英阶段和等级已解锁、未被强化版本替换的技能；未提供等级时，仅确认该精英阶段 Lv.1 已解锁的技能。未提供精英阶段时，浮层展示解锁要求，不标记技能为已解锁。没有技能数据的干员保留在“全部技能”选项中。
