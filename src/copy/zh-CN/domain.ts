export const domainCopy = {
  inventory_warning: {
    title: "中间产物库存不足",
    depleted: (product: string) => `${product}库存已耗尽，当前产量无法满足消耗。`,
    depletes_today: (product: string) => `${product}库存不足一天用量，按当前排班将很快耗尽。`,
    depletes_in_days: (product: string, days: string) => `${product}库存预计约 ${days} 天后耗尽。`,
    action: "请补充库存或调整生产配置，避免生产中断。",
  },
  building_skills: {
    title: "基建技能",
    facility: "技能适用设施",
    all_facilities: "全部设施",
    filter_hint: "按设施查看已解锁的技能；悬停头像可查看完整效果与解锁条件。",
    no_active_skills: "暂无已解锁的适用技能",
    unknown: "暂无技能资料",
    active: "已解锁",
    locked: "未解锁",
    upgraded: "已被强化技能替换",
    training: "训练室",
    unlock: (elite: number, level: number) => elite === 0 ? `初始 Lv.${level}` : `精英 ${elite} · Lv.${level}`,
  },
  manual_schedule: {
    history_warning: "手动排班 · 按手动安排测算，心情可能无法持续循环，请核对心情测算结果后使用。",
    hint: "调整干员和无人机安排后，可模拟效率、产量和心情。",
    simulate: "模拟测算",
    simulating: "正在测算效率和心情，等待期间可以继续调整排班。",
    simulated: "测算已完成，以下效率、产量和心情对应当前手动排班。",
    simulation_image: "手动排班 · 已测算",
    simulation_failed: "模拟测算失败，请重试。",
    simulation_baseline_required: "请先选择一份已保存的历史排班，再模拟手动方案。",
    simulation_details: "查看设施效率和干员心情",
    mood_stable: "心情可以在班次间恢复，当前方案可持续轮换。",
    mood_warning: "部分干员的心情无法充分恢复，请调整上班时长或宿舍安排。",
    mood_title: "干员心情测算",
    mood_operator: "干员 / 设施",
    mood_start: "上班心情",
    mood_consumed: "本班消耗",
    mood_end: "下班心情",
    mood_status: "恢复情况",
    mood_sufficient: "本班心情充足",
    mood_shortfall: (value: string) => `本班缺少 ${value} 点心情`,
    mood_degrading: (names: string) => `连续轮换后心情下降：${names}`,
    mood_affected: (names: string) => `需要调整的干员：${names}`,
    mood_rotation: "以下按满心情开始每轮工作测算。请按各设施的换班时间安排休息。",
    mood_empty: "本班没有需要测算心情的工作干员。",
    dormitory_title: "智能宿舍补位",
    dormitory_hint: "只为需要恢复心情的干员补入空床位，保留已有人员和位置。",
    dormitory_fill: "补齐宿舍并重新测算",
    dormitory_suggestions: (count: number) => `可补入 ${count} 处休息安排`,
    dormitory_destination: (shift: string, room: number, name: string) => `${shift} · 宿舍 ${room}：${name}`,
    dormitory_unassigned: "这些干员在以下上班班次仍有心情缺口，请调整此前的宿舍或上班安排：",
    dormitory_no_need: "当前没有需要补入空床位的干员。",
    dormitory_pending: "先模拟测算，即可查看缺少休息安排的干员并补齐宿舍。",
    tab: "手动排班",
    title: "手动调整排班",
    warning: "修改干员或无人机目标会改变排班收益。当前方案尚未模拟，效率、产量和心情需要重新测算。",
    board_hint: "点击干员头像或空位调整进驻干员，点击产物左侧的无人机图标选择加速目标。",
    drone_marker: (labels: string) => `无人机加速 · ${labels}`,
    drone_details: "无人机安排详情",
    set_drone: (room: string) => `无人机加速 ${room}`,
    edit_room: (room: string) => `编辑 ${room} 干员`,
    locked: "菲亚梅塔目标及其在所有班次中的进驻位置已锁定。",
    lock_operator: "菲亚梅塔目标，进驻位置已锁定",
    picker: "选择进驻干员",
    search: "搜索干员，支持拼音和首字母",
    no_matches: "未找到匹配的已拥有干员",
    empty_slot: (index: number) => `空位 ${index}`,
    clear: "清空此位置",
    close: "关闭",
    done: "完成",
    move_hint: "选择已在本班进驻的干员会与当前位置交换；空位会将该干员移到此处。",
    result_scope: "手动调整在本页单独编辑；总览、详情、数据和排班结果页的导出始终对应当前打开的原排班。",
    rules_title: "保存、覆盖与导出规则",
    save_rule: "点击“保存本地草稿”才会保存当前干员和无人机安排。再次保存会覆盖此入口中该档案的上一份草稿，即使上一份草稿来自另一份排班。切换标签页会保留当前修改；刷新或离开页面前，请保存或下载备份。",
    restore_rule: "恢复或导入草稿会替换当前手动安排；有未保存修改时会先要求确认。草稿必须与当前原排班匹配。导入备份后，仍需点击“保存本地草稿”才能存入浏览器。",
    reset_rule: "确认还原后，清除当前手动修改和此入口已保存的草稿，回到原排班；其他入口的草稿和云端历史不受影响。",
    simulation_rule: "模拟成功会将测算结果新增到云端历史，成为档案的最新排班，不会改写原记录。刷新历史列表后可查看、导出该结果；普通历史达到档案上限时会清理最旧记录，长期保留请封存。模拟不会保存本地草稿；再次调整后需重新测算。",
    export_rule_title: "下载与导出",
    export_rule: "手动页的图片对应当前手动安排，测算前不含效率和产量。草稿备份保存当前安排，可重新导入继续编辑；它不是 MAA 执行文件。需要手动方案的 MAA 文件时，请先模拟成功，再从历史排班中导出新结果。",
    data_scope: "这里的数据对应当前打开的排班结果，手动调整和保存草稿不会改变它。手动方案的效率、产量和心情请在“手动排班”中模拟查看；要查看或导出完整测算结果，请刷新历史列表并打开新增的排班。",
    save: "保存本地草稿",
    backup: "下载草稿备份",
    import: "导入草稿备份",
    importing_failed: "备份内容无效或不属于当前排班，无法导入。",
    download_failed: "下载失败，请重试。",
    restore: "恢复已保存草稿",
    reset: "还原原始排班",
    saved: "当前手动安排已保存到此浏览器；再次保存会替换这份草稿。",
    unsaved: "有修改尚未保存",
    storage_hint: "本地草稿只保存在当前设备、当前浏览器的本站数据中，不会同步到账号或其他设备。排班结果页与独立手动排班页各为每个档案保留一份草稿，需点击恢复才能继续编辑。清理浏览器数据前，请下载备份。",
    storage_failed: "草稿保存失败，请下载备份。",
    invalid_draft: "已保存草稿与当前结果不匹配或内容无效，无法恢复。",
    invalid_edit: "无法应用此修改，请检查房间容量和锁定干员。",
    reset_confirm: "还原会清除当前手动修改及此入口已保存的草稿，回到原排班。云端历史和其他入口的草稿不受影响。",
    restore_confirm: "恢复草稿会替换本次尚未保存的修改。",
    slot: (index: number) => `位置 ${index}`,
    assigned: (room: string) => `当前进驻：${room}`,
    pending: "手动排班 · 待重新测算",
    no_drone: "取消本班无人机加速",
  },
  game_queue: {
    maa_hint: "照着选用的排班设置游戏内预设队列，可快速切换到相同的干员组合。换班时间、宿舍休息、无人机和菲亚梅塔操作需要手动安排。",
    open_overview: "打开游戏内“基建 → 进驻总览 → 工作区”，找到每个贸易站、制造站和发电站的“预设队列”。",
    set_queues: "对照本站“总览图 v2”或“详情”，按同一设施的班次顺序填写干员，并核对制造站产物。班次数超过游戏可保存的队列数时，可合并相同组合，不够的位置需在换班时重新设置。",
    switch_maa: "首次使用时，逐个设施点击目标队列的切换按钮，进驻第一班。之后按排班的班次时长，在换班时间逐个切换到下一班；“队列轮换”只处理符合游戏条件的设施，固定时间换班请逐个核对并切换。",
    switch_rotation: "首次使用时，逐个设施切换到队列 1；之后在游戏提示可轮换时使用“队列轮换”，并检查各设施实际进驻的队列。需要提前换班时，可逐个设施点击目标队列的切换按钮。",
    support: "工作区之外的控制中枢、会客室和办公室按对应班次手动更换；下班干员按宿舍安排休息，使用“干员休整”后检查床位和恢复支援干员。无人机按各班目标及换班前后的使用顺序手动处理；启用菲亚梅塔时，按排班安排手动恢复目标干员心情。",
    autofill: "采用 MAA 自动填满宿舍的方案时，在游戏内为下班干员安排休息，并保留排班中的宿舍技能干员；纯自动填满方案也需自行安排宿舍。",
  },
  result_image: {
    long: "导出总览长图",
    current: "导出当前班次",
    all: "导出全部班次长图",
    busy: "正在生成图片…",
    failed: "图片导出失败，请重试。",
    title: "排班总览",
    all_shifts: "全部班次",
    footer: "MaaTool · 基建排班",
  },
  result_board_v2: {
    cross_station: "跨站联动",
    cross_station_hint: "与其他房间的干员配合生效，换班时请一并保留配套安排",
    recovery_support: "恢复支援",
    recovery_support_hint: "专门进驻宿舍，加速同宿舍干员恢复心情",
    tab: "总览图 v2",
    shifts: "切换班次",
    hint: "切换班次查看干员安排，展开房间详情查看效率和心情。",
    shift: (index: number) => `第 ${index} 班`,
    rooms: (count: number) => `${count} 个房间`,
    operators: (count: number) => `${count} 位干员`,
    production: "生产区",
    support: "辅助区",
    efficiency: "效率",
    details: "房间详情",
    empty_room: "本班暂无干员安排",
    show_profession: "显示干员职业",
    professions: {
      WARRIOR: "近卫", SNIPER: "狙击", TANK: "重装", MEDIC: "医疗",
      SUPPORT: "辅助", CASTER: "术师", SPECIAL: "特种", PIONEER: "先锋",
    },
  },
  // src/components/result-panel/DroneSummary.tsx
  components_result_panel_DroneSummary_001: "自动无人机",
  // src/components/result-panel/DroneSummary.tsx
  components_result_panel_DroneSummary_002: "无人机",
  // src/components/result-panel/DroneSummary.tsx
  components_result_panel_DroneSummary_003: "，从 ",
  // src/components/result-panel/DroneSummary.tsx
  components_result_panel_DroneSummary_004: " 个生产房间中选择",
  // src/components/result-panel/DroneSummary.tsx
  components_result_panel_DroneSummary_005: " · 速度 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_001: "不用 MAA？在游戏内设置预设队列",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_002: "游戏内轮换不生成排班 JSON。按下方预设队列逐个设施设置队列 1 / 队列 2，平时使用游戏内“队列轮换/快速切换”；同一设施由心情消耗最快的干员触发切换，触发时会切换该设施内所有干员。",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_003: "如何在 MAA 中使用排班 JSON",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_004: "展开查看",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_005: "在 MAA 左侧勾选 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_006: "基建换班",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_007: "点击 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_008: "基建换班",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_009: " 右侧 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_010: "小齿轮",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_011: "基建模式",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_012: " 选择 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_013: "自定义基建配置",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_014: "内置配置",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_015: " 选择 ",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_016: "自定义",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_017: "点击选择，选择本站下载的排班 JSON",
  // src/components/result-panel/Guides.tsx
  components_result_panel_Guides_018: "MAA 自定义基建配置中选择排班 JSON 的位置示意图",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_001: "游戏内轮换参考图",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_002: "MAA 排班参考图",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_003: " 个",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_004: "队列",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_005: "班次",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_006: "查看各房间的干员安排，展开详情可查看效率数据。",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_007: " 个房间",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_008: "\n            暂无可展示的排班总览。\r\n          ",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_009: "\n                          未安排\r\n                        ",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_010: "队列",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_011: "班",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_012: "队列",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_013: "队列",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_014: "班",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_015: "多产物",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_016: "班次 ",
  // src/components/result-panel/ResultBoard.tsx
  components_result_panel_ResultBoard_017: "菲亚梅塔 → ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_001: "预设队列",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_002: "排班详情",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_003: " 个",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_004: "队列",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_005: "班次",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_006: " 个房间\r\n        ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_007: "班次 ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_008: "\n                菲亚梅塔 → ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_009: "房间",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_010: "产物",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_011: "干员",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_012: "效率",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_013: "\n        暂无可展示的预设队列。\r\n      ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_014: " 队列\r\n            ",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_015: "快速切换",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_016: "暂无额外效率数据",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_017: "效率数据",
  // src/components/result-panel/ResultDetail.tsx
  components_result_panel_ResultDetail_018: "多产物",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_001: "长期 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_002: "/日 · 固源岩预算 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_003: "/日 · 龙门币硬成本 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_004: "/日",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_005: " · 库存约 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_006: " 天",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_007: "关键指标",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_008: "数据",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_015: "预设队列",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_016: "组",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_017: "预计总效率",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_018: "原始房间和 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_019: "房间预设",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_020: "制造站产量",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_021: "间",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_022: "件/日",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_023: "按每个设施分别录入队列",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_024: "预计日产出",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_025: "龙门币",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_026: "赤金净变动 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_027: "，合成玉 ",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_030: "搓玉经济",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_031: "等效理智",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_032: "合成玉/日",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_033: "理智",
  // src/components/result-panel/ResultMetrics.tsx
  components_result_panel_ResultMetrics_034: "中间产物库存：",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_001: "排班模式",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_002: "游戏内轮换",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_003: "MAA排班表",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_004: "队列数量",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_005: "换班节奏",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_006: " 组",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_007: "统计方式",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_008: "统计周期",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_009: "每队列 ",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_010: "h · 日产量折算 ",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_011: " 小时",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_012: "按班次配置",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_013: "宿舍规则",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_014: "轮换模式不导出宿舍",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_015: "MAA 自动填满（保留技能依赖）",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_016: "排班表固定",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_017: "总览图",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_018: "预设队列",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_019: "详情",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_020: "数据",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_021: "设置",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_022: "导入",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_023: "建议",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_024: "生成结果",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_025: "免费个人排班已就绪",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_027: "排班方案已就绪",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_028: "按下方结果设置完整的游戏内轮换。免费个人排班不包含导出和高级分析。",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_030: "按下方预设队列在游戏内逐个设施设置，平时使用队列轮换的快速切换按钮。",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_031: "下载 MAA JSON 并导入 MAA 执行排班。本次结果和配置会保存在账号工作区。",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_032: "下载 MAA JSON",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_033: "\r\n                  导出本地备份\r\n                ",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_034: " 另有 ",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_035: " 个房间已隐藏。",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_036: "菲亚梅塔",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_037: "未启用",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_038: "排班结果视图",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_039: "下载完整计算数据",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_040: "开发者与排障",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_041: "完整计算 JSON 包含心情、效率、原始结果和调试字段，仅用于分析或问题排查，不应导入 MAA。",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_042: "纯 MAA 自动填满",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_043: "已启用但无目标",
  // src/components/result-panel/ResultPanel.tsx
  components_result_panel_ResultPanel_044: "优化器未找到收益达到阈值的换心情目标",
  components_result_panel_ResultPanel_045: "已记录搜索状态：",
  components_result_panel_ResultPanel_046: "次",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_001: "按每队列 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_002: "h 计算，日产量折算 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_003: "队列 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_004: "班次 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_005: "宿舍由 MAA 自动填满",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_006: "导出的 MAA JSON 由 MAA 自动安排宿舍干员",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_007: "导出的 MAA JSON 由 MAA 自动安排宿舍干员",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_008: "房间效率",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_009: "显示效率",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_010: "速度效率 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_011: "相对 MAA 默认 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_012: " 理智/日（",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_013: "当前排班不会耗尽赤金/源石碎片",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_014: "不足 1 天后耗完",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_015: "不足 1 天后耗完",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_016: "约 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_017: " 天后耗完",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_018: "暂无制造站产出",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_023: "满单 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_024: "单均 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_025: "满仓 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_026: "预计 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_027: "h 后整设施切换",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_028: "心情≥",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_029: "最高消耗/时 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_030: "最快耗心 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_031: "h 触发整设施切换",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_032: "红脸风险 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_033: "收益",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_034: "未产生无人机加速收益",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_035: "额外产出 ",
  // src/components/result-panel/formatters.ts
  components_result_panel_formatters_036: "消耗 ",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_001: "贸易站",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_002: "制造站",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_003: "控制中枢",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_004: "会客室",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_005: "发电站",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_006: "宿舍",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_007: "加工站",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_008: "办公室",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_009: "龙门币",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_010: "合成玉",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_011: "赤金",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_012: "作战记录",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_013: "源石碎片",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_014: "按配置目标匹配",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_015: "优先加速龙舌兰订单",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_016: "优先加速但书体系",
  // src/components/result-panel/labels.ts
  components_result_panel_labels_017: "选择当前最高有效效率",
  // src/lib/config.ts
  lib_config_001: "龙门币",
  // src/lib/config.ts
  lib_config_002: "合成玉",
  // src/lib/config.ts
  lib_config_003: "赤金",
  // src/lib/config.ts
  lib_config_004: "作战记录",
  // src/lib/config.ts
  lib_config_005: "源石碎片",
  // src/lib/config.ts
  lib_config_006: "MAA 排班表",
  // src/lib/config.ts
  lib_config_007: "游戏内轮换",
  // src/lib/config.ts
  lib_config_008: "MAA 自动非固定",
  // src/lib/config.ts
  lib_config_009: "排班表固定",
  // src/lib/config.ts
  lib_config_010: "MAA 自动填满",
  // src/lib/config.ts
  lib_config_011: "单次重置卡",
  // src/lib/config.ts
  lib_config_012: "练度提升卡",
  // src/lib/config.ts
  lib_config_013: "单账号高级版",
  // src/lib/config.ts
  lib_config_014: "Admin卡",
  // src/lib/config.ts
  lib_config_015: "Admin卡",
  // src/lib/config.ts
  lib_config_016: "243 均衡流 (2赤金/2经验)",
  // src/lib/config.ts
  lib_config_017: "243 搓玉 (2赤金/2源石)",
  // src/lib/config.ts
  lib_config_018: "333 搓玉流",
  // src/lib/config.ts
  lib_config_019: "轮换",
  // src/lib/config.ts
  lib_config_020: "轮换模式",
  // src/lib/config.ts
  lib_config_021: "游戏内轮换",
  // src/lib/config.ts
  lib_config_022: "一天n换",
  // src/lib/config.ts
  lib_config_023: "一天 n 换",
  // src/lib/config.ts
  lib_config_024: "非固定间隔",
  // src/lib/config.ts
  lib_config_025: "maa自动填满",
  // src/lib/config.ts
  lib_config_026: "自动填满",
  // src/lib/config.ts
  lib_config_027: " 基建配置",
  // src/lib/config.ts
  lib_config_028: " 自定义配置",
  // src/lib/config.ts
  lib_config_029: "贸易站和制造站数量必须是整数。",
  // src/lib/config.ts
  lib_config_030: "当前支持 3 发电站布局、右满252和满血252；其他 2 发电站布局尚未开放。",
  // src/lib/config.ts
  lib_config_031: "贸易产物数量合计为 ",
  // src/lib/config.ts
  lib_config_032: "，需要等于 ",
  // src/lib/config.ts
  lib_config_033: "制造产物数量合计为 ",
  // src/lib/config.ts
  lib_config_034: "，需要等于 ",
  // src/lib/config.ts
  lib_config_035: "MAA 排班表需要 3 到 6 班。间隔不同时须覆盖 24 小时，等长间隔支持每 8、12 或 24 小时换班。",
  // src/lib/config.ts
  lib_config_036: "启用无人机时至少需要一个加速目标。",
  // src/lib/config.ts
  lib_config_037: "纯maa自动填满",
  // src/lib/config.ts
  lib_config_038: "纯自动填满",
  // src/lib/config.ts
  lib_config_039: "右满252（经验多）",
  // src/lib/config.ts
  lib_config_040: "右满252（赤金多）",
  // src/lib/config.ts
  lib_config_041: "333 纯钱流",
  // src/lib/config.ts
  lib_config_042: "满血252",
  // src/lib/production-sanity.ts
  lib_production_sanity_001: "制造 ",
  // src/lib/production-sanity.ts
  lib_production_sanity_002: " + 贸易 ",
  // src/lib/production-sanity.ts
  lib_production_sanity_003: " - 消耗 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_001: "无人机关闭",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_002: "无人机自动",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_003: "无人机加速龙门币",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_004: "无人机加速合成玉",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_005: "无人机加速赤金",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_006: "无人机加速经验",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_007: "无人机加速源石碎片",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_008: "请至少选择一个能够运行的场景组合。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_009: "有效场景共 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_010: " 组，最多允许 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_011: " 组。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_012: "的目标产线在对应生产方案中不存在，已跳过。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_013: "重复场景已合并。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_014: " · 自动非固定选定 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_015: "场景因子",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_016: "场景因子格式不正确。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_017: "游戏内轮换因子必须是布尔值。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_018: "请至少选择一个基建布局和生产方案。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_019: "请至少选择一种排班模式。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_020: "MAA 场景至少需要一种无人机策略。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_021: "布局因子",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_022: "布局或生产方案格式不正确。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_023: "MAA 排班仅支持自动非固定、8×3 和 12×2。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_024: "包含未知的无人机策略。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_025: " 生产方案",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_026: " 贸易方案",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_027: " 制造方案",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_028: " 的贸易与制造线数必须是非负整数。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_029: " 的贸易线数合计必须为 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_030: " 的制造线数合计必须为 ",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_031: "格式不正确。",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_032: "包含未知字段：",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_033: " 贸币",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_034: "/玉",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_035: " · 制赤",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_036: "/经",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_037: "/碎",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_038: "MAA 自动非固定",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_039: "轮换 12h×2",
  // src/lib/scenario-comparison.ts
  lib_scenario_comparison_040: (maximum: number) => `一次场景对比最多可提交 ${maximum} 个额外基建配置。`,
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_001: "布局不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_002: "MAA 班次不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_003: "无人机策略不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_004: "同一布局的产品方案不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_005: (maximum: number) => `情景原始组合不能超过 ${maximum} 个。`,
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_006: "情景 ID 不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_007: "Pareto 情景 ID 不能重复。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_008: (field: string) => `${field} 与 points 不一致。`,
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_009: "Pareto 汇总与 points 标记不一致。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_010: "成功情景必须包含计算指标。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_011: "Pareto 点必须是已复算的成功情景。",
  // src/lib/scenario-comparison-validation.ts
  lib_scenario_comparison_validation_012: (maximum: number) => `一次场景对比最多可提交 ${maximum} 个额外基建配置。`,
  // src/lib/workspace-validation.ts
  lib_workspace_validation_001: "产物类型不能超过 16 种。",
  // src/lib/workspace-validation.ts
  lib_workspace_validation_002: "干员 ID 不能重复。",
  // src/lib/workspace-validation.ts
  lib_workspace_validation_003: (maximum: number) => `精英覆盖不能超过 ${maximum} 项。`,
} as const
