export const toolsCopy = {
  cultivation: {
    title: '养成规划',
    description: '对照 PRTS 作业要求与当前练度，结合仓库材料和每日理智，安排下一批值得培养的干员。',
    back: '返回工具页',
    loading: '正在加载养成规划',
    load: '导入森空岛练度与仓库',
    loadingData: '正在读取练度、技能与仓库…',
    failed: '读取养成数据失败，请重试。',
    login: '登录后，选择已绑定森空岛的档案，即可导入练度与仓库。',
    loginAction: '前往登录与档案管理',
    noProfile: '请先创建档案并绑定森空岛，再读取练度与仓库。',
    profile: '游戏档案',
    preferences: { coverage: '补齐优先', materials: '满足材料优先', cost: '最低成本优先', community: '一图流养成统计' },
    preference: '养成偏好',
    preferenceHints: { coverage: '优先补齐近期作业中更常用、评价更可靠的练度缺口，同等需求下优先选择成本更低的目标。', materials: '先培养库存能支持的干员，再按材料缺口从小到大安排。', cost: '优先选择材料缺口对应等效理智更少的目标。', community: '参考一图流持有人养成比例，推荐精二、技能专精与模组目标，也适用于没有作业的玩法。' },
    recommendationFilters: '推荐范围', moreFilters: '选择活动、关卡与干员', scope: '推荐用途', scopes: { recent: '近期通用', permanent: '常驻需求', history: '历史参考' },
    timeWindow: '作业时间', allTime: '全部时间', coverage: '养成档位', coverages: { basic: '基础参考 · 60%', practical: '实用推荐 · 80%', high: '高覆盖 · 90%' },
    activity: '活动或章节', stage: '关卡', category: '内容类型', profession: '职业', rarity: '星级', all: '全部',
    rarityGroups: { high: '4–6星', low: '1–3星', all: '全部星级' },
    professions: { PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击', CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种' },
    recentDays: (days: number) => `近${days}天`, rarityName: (rarity: number) => `${rarity}星`,
    includeClosed: '包含已关闭内容', includeAlternatives: '包含群组备选', includeUncertain: '包含待观察干员',
    clearFilter: (label: string) => `清除${label}`,
    narrowSearch: '匹配项较多，请继续输入名称、编号或 ID。', noMatches: '没有匹配项，请换一个关键词。',
    recommendationHint: '默认推荐4–6星中近期有多个关卡使用依据的干员。可切换1–3星、指定关卡、查看历史用途，或纳入反馈较少的干员。',
    evidenceDetails: '查看推荐依据', upgrades: '需要升级', potentialTarget: (rank: number) => `潜能${rank}`, module: '模组',
    levelTarget: (elite: number, level: number) => `精${elite} Lv.${level}`,
    skillTarget: (skill: number, level: number) => `${skill}技能 · ${level > 7 ? `专精${level - 7}` : `等级${level}`}`,
    evidenceStates: { current: '近期适用', limited: '范围有限', historical: '历史适用', insufficient: '反馈不足' },
    evidenceSummary: (families: number, coverage: number) => `${families} 个独立打法 · 目标覆盖 ${(coverage * 100).toFixed(0)}%`,
    completeness: (training: number, skill: number, module: number) => `来源完整度：等级 ${(training * 100).toFixed(0)}% · 技能 ${(skill * 100).toFixed(0)}% · 模组 ${(module * 100).toFixed(0)}%`,
    moduleOpening: '材料按开启模组计算',
    daily: '每日可用理智', start: '开始日期', days: '规划天数', limit: '本次培养人数',
    dailyHint: '填入每天愿意用于养成的总理智；含月卡时请直接计入，理智药会另外增加。',
    allOpen: '规划期间材料关卡全开放',
    allOpenHint: '活动期间全开放时勾选；平时按国服常规开放日安排。游戏日从北京时间 04:00 开始。',
    potions: '使用仓库理智药',
    potionHint: '默认不使用。可选择每种药的使用数量；规划按有效期先后使用，并剔除过期药。',
    noPotions: '森空岛本次未返回可识别的理智药。每日理智预算仍可用于规划。',
    potionUnknown: '恢复量未知，暂不计入',
    expiryUnknown: '有效期未返回，请核对后选择',
    expiry: '有效期至',
    stats: { homeworks: '参考作业', owned: '已拥有干员', satisfied: '已满足练度目标', incomplete: '待核对要求' },
    suggestions: '建议培养顺序',
    adviceHint: '每名干员选一个目标。连续扣减共享材料和可合成材料，每项缺口以此前建议已占用的库存为准。',
    empty: '当前没有可自动安排的养成目标。可在练度对照中查看已满足的要求和待核对条目。',
    current: '当前练度', target: '作业养成参考', demand: '独立需求', weightedDemand: '作业参考分', stageCount: '涉及关卡',
    communityTarget: '统计建议', communityTitle: '一图流养成统计', communityUnavailable: '一图流统计暂不可用，请稍后重新导入。', communityStale: '统计更新暂不可用，当前使用上次数据。',
    communityRate: (rate: number | null) => rate === null ? '养成比例暂无数据' : `持有人中 ${(rate * 100).toFixed(1)}% 达到此目标`,
    eliteRate: '精二率', masteryRate: '技能专精率', moduleRate: '模组开启率', communitySample: (owned: number) => `持有样本 ${owned.toLocaleString('zh-CN')} 人`,
    moduleType: (type: string) => `${type} 模组`, moduleRank: (rank: number | null) => rank === null ? '等级未注明' : `${rank}级`,
    skillName: (skill: number) => skill === 0 ? '无主动技能' : `${skill}技能`, masteryName: (rank: number) => `专精${rank}`,
    exchangeAmount: (count: number, cost: number) => `芯片助剂 × ${count} · 消耗采购凭证（红票）${cost}`,
    specialItems: '仓库养成道具', specialHint: '选择道具，查看适用范围和推荐使用顺序；材料自选包会优先推荐能补齐本次规划缺口的选项。', noSpecialItems: '森空岛本次未返回可识别的养成道具。',
    specialConditions: { elite: '适用于尚未精二的对应星级干员，提升至精2 Lv.1，技能等级保留。', level: '适用于已精二且未满级的对应星级干员。', mastery: '适用于已精二、技能等级7且该技能尚未专三的对应星级干员；使用前请确认该技能未在训练室专精。', selector: '优先推荐尚未拥有的干员。', materials: '每份道具选择一个领取选项。' },
    itemStock: (count: number) => `库存 ${count} 份`, itemExpired: '已过期', itemDetails: '查看 PRTS 道具说明', specialRecommendations: '推荐使用与领取', noItemUses: '当前没有适用对象，或道具的可选范围尚未更新。', specialDate: '道具资料更新',
    ownedOperator: '已拥有', newOperator: '可补齐干员', noBatchDemand: '本次规划暂无此材料缺口',
    voucherSavings: (sanity: string) => `可节省升级等效理智 · ${sanity}`, materialRelief: (sanity: string) => `每份可减少本次缺口等效理智 · ${sanity}`,
    missing: '需补材料', cost: '缺口等效理智', ready: '材料已备齐', unpriced: '部分材料未估价',
    materialDate: '预计材料备齐', pending: '仍需补齐', exclude: '暂不培养',
    calendar: '每日刷取安排', calendarHint: '按关卡平均掉落估算刷取次数；实际掉落会浮动。日期只估算材料备齐，专精训练、模组任务和基建生产需要另行安排。请确认建议关卡已解锁。',
    noFarms: '当天没有可安排的刷取，可保留理智用于其他内容。',
    blocked: '需要其他来源补齐的材料', blockedHint: '这些材料没有可用的常驻刷取数据，可能需要商店、奖励或活动兑换。补齐后重新导入库存再规划。',
    remaining: '规划期结束后仍缺材料',
    comparison: '练度与作业要求对照', search: '搜索干员', showMore: '显示更多',
    comparisonHint: '养成目标参考作者填写的要求与所选覆盖档位。同一替代组培养其中一名干员即可；缺少练度时参考技能解锁条件，并查看来源完整度。模组建议对应类型，材料按开启模组计算。',
    matched: '已满足', needsTraining: '待培养', check: '待核对', example: '查看作业',
    total: '本次缺口等效理智', dataDate: '作业数据更新', importDate: '练度与仓库读取',
    excluded: '重新纳入培养',
    apply: '更新规划', settingsChanged: '设置已调整，点击更新规划后生效。', invalidSettings: '请填写有效的开始日期、每日理智、规划天数和培养人数。',
    summary: '本次培养材料统计', totalMaterials: '全部升级材料', missingMaterials: '库存分配后需补齐', totalTraining: '全部升级等效理智', exchange: '红票商店兑换',
    budget: (spent: number, total: number) => `${spent} / ${total} 理智`,
    runs: (runs: number, count: string) => `${runs} 次 · 预计 ${count} 份`,
    potionAmount: (count: number, sanity: number | null) => `库存 ${count} 份${sanity === null ? '' : ` · 每份 ${sanity} 理智`}`,
    progress: (elite: number, level: number, skill: number, skillLevel: number | null, mastery: number | undefined, module: number | undefined) => `精${elite} Lv.${level}${skill ? ` · ${skill}技能${mastery && mastery > 0 ? `专${mastery}` : `等级${skillLevel ?? '?'}`}` : ''}${module === undefined ? '' : ` · 模组${module}级`}`,
    targetProgress: (elite: number, level: number, skill: number, skillLevel: number, module: number | null) => `精${elite} Lv.${level}${skill ? ` · ${skill}技能${skillLevel > 7 ? `专${skillLevel - 7}` : `等级${skillLevel}`}` : ''}${module ? ` · 模组${module}级` : ''}`,
  },
  manualSchedule: {
    title: "手动排班模拟",
    description: "导入排班 JSON 或从空白方案开始，手动安排干员与无人机，模拟心情变化和生产效率。",
    access: "账号至少有一个当前可用的高级版权限，即可使用手动排班模拟。",
    unavailable: "当前账号没有可用的高级版权限。获得可用的高级版权限后，可导入排班或创建空白方案。",
    loading: "正在加载手动排班工具",
    profile: "使用档案",
    operatorsRequired: "请先在此档案中导入干员，再开始手动排班。",
    setup: "前往导入干员",
    editOperators: "查看或调整档案练度",
    start: "从零开始排班",
    import: "导入排班 JSON",
    importHint: "支持完整计算结果 JSON 和 MAA 排班 JSON，最大 5 MB。MAA 文件缺少换班时长时，使用上方设置。",
    importFailed: "排班 JSON 无效，请检查文件结构、干员归属和设施安排。",
    tooLarge: "排班 JSON 最大为 5 MB，请缩小文件后重试。",
    back: "返回工具页",
    layout: "设施配置",
    currentLayout: "当前档案配置",
    shiftHours: "每班时长（小时）",
    shiftHint: "使用短横线或逗号分隔，例如 8-8-8、12-6-6 或 12-12-12。",
    replace: "重新导入或从零开始会替换当前方案，请先保存草稿或下载备份。",
    preview: "手动排班与效率测算预览",
    retryWorkspace: "重新加载档案",
    operators: "干员与练度依据",
    operatorsHint: "使用所选档案已拥有的干员及当前练度，包括档案中的精英化调整。基建技能按精英阶段和等级解锁；修改练度请前往档案设置，重新进入工具后生效。",
    configHint: "空白方案使用下方配置。导入文件中的等级、产物和班次优先；生产设施缺失的等级与产物使用匹配的配置，宿舍与控制中枢默认 5 级，其他设施默认 3 级。开始后可核对并调整。",
    importLayoutMismatch: "导入文件缺少设施等级或产物，且设施数量与所选配置不一致。请先选择匹配的基建配置再导入。",
    settings: "手动排班设置",
    facilities: "设施等级与产物",
    facilitiesHint: "等级和产物同步到所有班次。降低等级前，请先移出超出容量的干员。导入的 MAA 自动宿舍沿用自动填充规则。",
    level: "设施等级",
    product: "产物",
    fiammettaName: "菲亚梅塔",
    fiammetta: "本班菲亚梅塔安排",
    fiammettaTarget: "恢复心情对象",
    fiammettaDisabled: "不使用菲亚梅塔",
    fiammettaUnavailable: "需要拥有菲亚梅塔，并使用支持的三班时长：8-8-8、12-12-12，或最长班为 12 小时且合计 24 小时。",
    fiammettaHint: "从本班已安排工作的干员中选择对象；每班单独设置，调整对象的工作安排后需重新测算。",
    fiammettaOrder: "使用时机",
    pre: "换班前",
    post: "换班后",
    fiammettaInvalid: "菲亚梅塔安排无效：请确认已拥有菲亚梅塔、班次时长受支持，且对象正在本班工作并非菲亚梅塔本人。",
    droneOrder: "本班无人机使用时机",
    invalidSettings: "排班设置无效，请检查设施、产物和干员安排。",
    occupiedSlots: "降低设施等级会移除已安排的干员，请先腾出超出容量的位置。",
  },
  depotPreview: "仓库价值分析预览",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_001: "仓库分析失败，请稍后重试",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_002: "创建仓库分析档案失败",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_003: "创建仓库分析档案失败",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_004: "当前浏览器不允许直接读取剪贴板，请手动粘贴到输入框。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_005: "剪贴板为空，请先复制 MAA 导出的仓库 JSON。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_006: "无法读取剪贴板，请手动粘贴 MAA 导出的仓库 JSON。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_007: "请先登录或注册，再使用森空岛库存。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_008: "森空岛绑定已完成，但未找到可分析的绑定档案，请刷新后重试。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_009: "MAA 小工具",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_010: "仓库价值分析器",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_011: "上传 MAA 仓库 JSON，用等效理智估算库存价值，再下载结果图分享到贴吧或 QQ 群。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_012: "返回首页",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_013: "进入工作区",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_014: "导入仓库",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_015: "在 MAA 的仓库识别里导出数据时，请选择“企鹅物流刷图规划”或“明日方舟工具箱”。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_016: "粘贴仓库 JSON",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_017: "从 MAA 选择“企鹅物流刷图规划”或“明日方舟工具箱”导出，复制内容后粘贴到输入框。\n                      粘贴 JSON 只用于本次分析，不会进入样本池。\n                    ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_018: "读取剪贴板",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_019: "粘贴 JSON，例如 {\"2001\":16000,\"30011\":982}",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_020: "\n                    已粘贴 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_021: " 个字符\r\n                  ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_022: "正在估算...",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_023: "分析剪贴板仓库",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_024: "森空岛快捷导入",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_025: "导入森空岛养成库存，估算仓库价值。你同意贡献样本且物品价格覆盖达标时，才会保存统计样本。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_026: "已登录",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_027: "正在确认登录状态...",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_028: "登录或注册后会自动创建一个仅用于仓库分析的免费档案，然后继续绑定森空岛。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_029: "正在读取...",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_030: "重新绑定并分析",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_031: "使用森空岛库存",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_032: "当前选择的森空岛凭据已失效。请重新绑定后再读取仓库库存。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_033: "正在准备账号...",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_034: "绑定森空岛并分析仓库",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_035: "排名样本不包含仓库或干员明细、昵称、完整 UID 和森空岛凭据。样本仍关联本站档案，属于可关联数据，导出个人数据时会包含这些样本，注销账号时会一并删除。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_036: "估值说明",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_037: "怎么算的",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_038: "作战记录先换算为经验，再估算对应理智。龙门币和材料也按等效理智估值，方便比较。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_039: "材料价格优先参考一图流/企鹅物流的物品价值。模组数据块、数据增补仪、数据增补条、家具零件不会参与计算。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_040: "默认勾选贡献统计样本，你可以在分析前取消。只有价格数据有效且覆盖足够物品时，样本才会进入排名；保存后不能单独撤回，但注销账号时会一并删除。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_041: "分析完成",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_042: "\r\n        你的仓库资产击败了 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_043: "% 博士\r\n      ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_044: "等效理智",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_045: "已估价物品",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_046: " 类",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_047: "未估价物品",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_048: " 类",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_049: "最值钱的库存",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_050: "数量 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_051: "未计入估值",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_052: "分析截图",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_053: "\r\n            下载 PNG 后可以直接发给朋友分析。\r\n          ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_054: "下载 PNG",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_055: "你的仓库资产击败了 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_056: "% 博士",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_057: "MAA 仓库价值分析器",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_058: "参考 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_059: " 位森空岛样本修正",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_060: "样本积累中，当前结果以估算曲线为主",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_061: "你的仓库资产",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_062: "击败了 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_063: "% 博士",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_064: "等效理智",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_065: "仓库资产榜",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_066: "数量 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_067: "免费生成你的仓库资产分享图",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_068: "MAA 基建排班优化器 · ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_069: " · 凭据失效",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_070: "请先粘贴 MAA 仓库 JSON。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_071: "JSON 格式不正确。请在 MAA 导出方式中选择“企鹅物流刷图规划”或“明日方舟工具箱”。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_072: "已参考 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_073: " 位森空岛样本修正百分比，当前样本权重约 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_074: "样本积累中，当前结果仍以估算曲线为主。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_075: "样本积累中，当前结果仍以估算曲线为主。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_076: "万件 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_077: " 理智",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_078: "单件 ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_079: " 理智",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_080: "登录状态加载失败，请重试。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_083: " · ",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_084: " 字节",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_085: "上传内容最大为 1 MiB，最多包含 20,000 类物品；每类物品数量必须是 0 到 10 亿之间的整数。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_086: "重试登录状态",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_087: "默认勾选贡献处理后的统计样本，用于改进仓库排名；如不同意，请在分析前取消。样本仅保存仓库总值、价格数据质量、账号等级和干员数量汇总，不保存仓库或干员明细、昵称、完整 UID 和森空岛凭据。样本会关联本站档案，保存后不能单独撤回，注销账号时会一并删除。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_090: "估值方式",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_091: "材料价格",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_092: "价格数据版本",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_093: "无",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_094: "价格覆盖率",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_095: "估值版本",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_096: "样本贡献",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_097: "生成时间 / 数据版本",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_098: "（按价值排序的前 12 类）",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_099: "仓库 JSON 超过 1 MiB，请缩减后重试。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_100: "物品数量必须是 0 到 10 亿之间的整数。",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_101: "当前价格数据",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_102: "有效期内的历史价格",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_103: "不可用",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_104: "返回数据无法识别",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_105: "已保存",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_106: "未同意",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_107: "价格数据不足，未保存",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_108: "本次上传不参与样本",
  // src/pages/DepotValuePage.tsx
  pages_DepotValuePage_109: "暂时无法保存样本",
  // src/pages/tool/profile-redemption.ts
  pages_tool_profile_redemption_001: "当前 CDK 不能用于升级档案。",
} as const
