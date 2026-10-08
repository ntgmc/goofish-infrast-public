export const dashboardCopy = {
  settings: {
    description: "管理登录密码、使用偏好、消息通知和个人数据。",
    navigation: "设置分区",
    security: "账号安全",
    password_help: "修改用于登录 MaaTool 的密码。",
    preferences: "使用偏好",
    preferences_help: "调整动画效果和进入工作区的方式。",
    data: "数据与隐私",
    credentials: "森空岛授权",
    no_credentials: "暂无森空岛绑定账号。导入游戏数据后，可在这里管理授权信息。",
    privacy_details: "个人数据的保存与删除",
    deletion_help: "提交后立即退出登录，7 天内可通过邮件撤销。",
  },
  animation: {
    title: "动画效果",
    settings: "界面设置",
    description: "设置保存在当前浏览器，V1 与 V2 同步生效。",
    reduce: "减少动画",
    help: "开启后，页面和面板立即切换。页面持续卡顿时会自动开启，你也可以手动关闭，当前访问期间将停止自动调整。此设置仅保存在当前浏览器。",
    system: "已跟随系统的减少动态效果设置。关闭系统设置后，可在这里调整。",
    storageError: "本次使用已生效，浏览器未能保存此设置。刷新后可能需要重新调整。",
  },
  profile_expiry: {
    title: "限时 CDK 档案即将到期",
    description: (name: string, expiresAt: string) => `请尽快保存「${name}」需要保留的数据，并在排班方案中将排班 JSON 导出到本地。档案将于 ${expiresAt}（北京时间）到期，到期后需续期才能继续使用。`,
    trial_description: (name: string, expiresAt: string) => `请尽快保存「${name}」需要保留的数据，并在排班方案中将排班 JSON 导出到本地。高级版限时体验将于 ${expiresAt}（北京时间）结束，之后恢复免费预览权限。`,
    unnamed: "限时 CDK 档案",
    dismiss: "今天不再提醒",
    close: "关闭到期提醒",
    export: "前往保存与导出",
  },
  behavior_observation: {
    title: "操作习惯记录",
    description: "当前浏览器会保留最近 30 天、最多 500 条页面访问、操作结果和耗时记录，供后续分析重复操作。记录仅保存在本机，不会自动上传；不包含 UID、昵称、输入内容、配置内容或账号凭据。导出时会替换档案标识。",
    export: "导出操作记录",
    clear: "清空操作记录",
    cleared: "已清空当前账号的操作记录，后续操作会重新记录。",
    clear_failed: "无法清空记录，请允许网站存储后重试。",
    export_failed: "无法导出记录，请稍后重试。",
  },
  workspace_entry: {
    prompt_title: "下次直接进入这个游戏账号？",
    prompt_body: "你最近多次从账号列表打开同一个游戏账号。启用后，可以省去每次选择账号，直接进入工作区设置；仍可返回账号列表管理账号，也可在账户设置中关闭。",
    enable: "启用并进入工作区",
    snooze: "7 天内不再提醒",
    never: "不再提示",
    settings_title: "默认进入方式",
    setting_label: "只有一个游戏账号时，直接进入工作区设置",
    setting_help: "仅在能确定唯一游戏账号时生效，同一 UID 优先使用可用的付费档案。返回账号列表仍可管理账号。此设置仅保存在当前浏览器。",
    unavailable: "有唯一且可用的游戏账号时，可以启用此设置；多个档案需全部绑定同一 UID。",
    storage_error: "无法在当前浏览器保存设置，请允许网站存储后重试。",
  },
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_001: "暂时无法加载公告，请稍后重试。",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_002: "暂时无法更新阅读状态，请稍后重试。",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_003: "可以在公告列表中回看近期通知。",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_004: "正在标记...",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_005: "全部设为已读",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_006: "正在加载公告...",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_007: "暂时没有新的公告。",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_008: "未读",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_009: "更新 ",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_010: "标记中...",
  // src/pages/tool/dashboard/AnnouncementsSection.tsx
  pages_tool_dashboard_AnnouncementsSection_011: "标为已读",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_001: "暂时无法生成邀请链接，请稍后重试。",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_002: "邀请链接已生成，可以分享给好友了。",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_003: "已复制。",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_004: "复制失败，请手动选中内容后复制。",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_005: "正在加载邀请信息...",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_006: "邀请有礼",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_007: "邀请好友绑定森空岛，领取活动奖励",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_013: "先兑换 CDK，或绑定森空岛并激活免费档案，即可生成邀请链接。",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_014: "邀请码",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_015: "邀请码",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_016: "邀请链接",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_017: "邀请链接",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_018: "正在生成...",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_019: "生成邀请链接",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_020: "邀请概况",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_021: "已注册好友",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_022: "已完成邀请",
  // src/pages/tool/dashboard/InvitationsSection.tsx
  pages_tool_dashboard_InvitationsSection_035: "复制",
  pages_tool_dashboard_InvitationsSection_039: "双方可获得的奖励",
  pages_tool_dashboard_InvitationsSection_040: "好友注册时填写你的邀请码，并绑定森空岛成功激活有效档案后，邀请即完成，双方奖励会自动发放。你的奖励受每日名额限制。",
  pages_tool_dashboard_InvitationsSection_041: "邀请活动暂时暂停。已经完成的邀请会在活动恢复后自动发放奖励。",
  pages_tool_dashboard_InvitationsSection_042: "邀请成功后，你可获得",
  pages_tool_dashboard_InvitationsSection_043: "邀请成功后，好友可获得",
  pages_tool_dashboard_InvitationsSection_044: "本次活动暂无奖励。",
  pages_tool_dashboard_InvitationsSection_045: "永久有效",
  pages_tool_dashboard_InvitationsSection_046: "领取后 ",
  pages_tool_dashboard_InvitationsSection_047: " 天内有效",
  pages_tool_dashboard_InvitationsSection_048: "该奖励暂时无法发放",
  pages_tool_dashboard_InvitationsSection_049: "已发奖邀请",
  pages_tool_dashboard_InvitationsSection_050: "今日奖励名额",
  pages_tool_dashboard_InvitationsSection_051: "今天还可获得 ",
  pages_tool_dashboard_InvitationsSection_052: " 次邀请奖励，名额重置时间：",
  pages_tool_dashboard_InvitationsSection_053: "今天你的奖励名额已用完。好友仍可正常获得奖励，但今天后续完成的邀请不会再为你发放奖励。",
  pages_tool_dashboard_InvitationsSection_054: "好友邀请记录",
  pages_tool_dashboard_InvitationsSection_055: "还没有邀请记录。把邀请链接分享给好友后，这里会显示注册、森空岛绑定和奖励发放进度。",
  pages_tool_dashboard_InvitationsSection_056: "受邀好友",
  pages_tool_dashboard_InvitationsSection_057: "注册时间",
  pages_tool_dashboard_InvitationsSection_058: "邀请完成时间",
  pages_tool_dashboard_InvitationsSection_059: "邀请状态",
  pages_tool_dashboard_InvitationsSection_060: "我的奖励",
  pages_tool_dashboard_InvitationsSection_061: "等待好友绑定森空岛",
  pages_tool_dashboard_InvitationsSection_062: "等待发放奖励",
  pages_tool_dashboard_InvitationsSection_063: "邀请已完成",
  pages_tool_dashboard_InvitationsSection_064: "等待好友绑定森空岛",
  pages_tool_dashboard_InvitationsSection_065: "活动恢复后自动发放",
  pages_tool_dashboard_InvitationsSection_066: "正在发放",
  pages_tool_dashboard_InvitationsSection_067: "奖励已发放",
  pages_tool_dashboard_InvitationsSection_068: "今日奖励名额已满",
  pages_tool_dashboard_InvitationsSection_069: "你当前无法获得奖励",
  pages_tool_dashboard_InvitationsSection_070: "本次活动未设置你的奖励",
  pages_tool_dashboard_InvitationsSection_072: "查看更多邀请",
  pages_tool_dashboard_InvitationsSection_073: "正在加载...",
  pages_tool_dashboard_InvitationsSection_074: "暂时无法加载邀请记录，请稍后重试。",
  pages_tool_dashboard_InvitationsSection_075: "尚未完成",
  pages_tool_dashboard_InvitationsSection_076: "礼包版本 ",
  pages_tool_dashboard_InvitationsSection_077: "奖励发放后，可前往背包查看数量、有效期和使用方式。",
  pages_tool_dashboard_InvitationsSection_078: "更换邀请码后，当前邀请码和邀请链接会立即失效，历史邀请记录不受影响。确定更换吗？",
  pages_tool_dashboard_InvitationsSection_079: "暂时无法更新邀请码，请稍后重试。",
  pages_tool_dashboard_InvitationsSection_080: "邀请码已暂停，当前邀请链接暂时无法使用。",
  pages_tool_dashboard_InvitationsSection_081: "邀请码已恢复，可以继续分享。",
  pages_tool_dashboard_InvitationsSection_082: "邀请码已更换，请分享新的邀请链接。",
  pages_tool_dashboard_InvitationsSection_083: "正在刷新...",
  pages_tool_dashboard_InvitationsSection_084: "刷新邀请信息",
  pages_tool_dashboard_InvitationsSection_085: "邀请码已暂停，当前邀请链接暂时无法注册。",
  pages_tool_dashboard_InvitationsSection_086: "恢复邀请码",
  pages_tool_dashboard_InvitationsSection_087: "暂停邀请码",
  pages_tool_dashboard_InvitationsSection_088: "更换邀请码",
  pages_tool_dashboard_InvitationsSection_089: "奖励发放遇到问题",
  pages_tool_dashboard_InvitationsSection_090: "发放失败，系统将自动重试",
  pages_tool_dashboard_InvitationsSection_091: "多次发放失败，请联系客服",
  pages_tool_dashboard_InvitationsSection_092: "（上海时间）",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_001: "还没有添加游戏账号",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_002: "前往“添加账号”，可以通过森空岛领取免费档案，或使用 CDK 创建正式档案。",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_003: "账号 ",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_004: "暂时无法保存档案信息，请稍后重试。",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_005: "暂时无法保存档案信息，请稍后重试。",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_006: "免费个人排班可查看完整游戏内轮换；MAA 导出和高级分析需要高级权限。",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_007: "暂无备注",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_008: " 名干员 · 数据更新于 ",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_009: "正在准备...",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_010: "打开账号并准备数据",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_011: "修改名称和备注",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_012: "档案名称",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_013: "档案备注",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_014: "给这个账号写点备注",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_015: "保存",
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_016: (endsAt: string) => `高级版功能已临时解锁，有效至 ${endsAt}；到期后恢复免费预览权限。`,
  // src/pages/tool/dashboard/ProfilesSection.tsx
  pages_tool_dashboard_ProfilesSection_017: (expiresAt: string) => `档案有效期至 ${expiresAt}`,
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_001: "暂时无法兑换 CDK，请检查输入或稍后重试。",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_002: "添加游戏账号",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_003: "使用 CDK 可创建正式档案；没有 CDK 时，也可以通过森空岛确认游戏 UID 后领取免费档案。",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_004: "添加账号方式",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_005: "使用 CDK",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_006: "免费个人排班",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_007: "免费个人排班可查看完整游戏内轮换队列；MAA JSON 下载可通过高级体验期或导出体验券使用，完整原始数据与高级分析需要高级权限。",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_008: "档案名称",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_009: "例如：免费排班",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_010: "例如：主账号",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_011: "备注",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_012: "可填写账号用途、区服或其他备注",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_013: "正在添加账号...",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_014: "通过森空岛领取免费个人排班",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_015: "兑换 CDK",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_001: "请确认新密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_002: "两次输入的新密码不一致",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_003: "两次输入的新密码不一致。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_004: "暂时无法修改密码，请稍后重试。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_005: "密码已更新。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_008: "清除森空岛授权信息",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_011: "确定要",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_012: "吗？清除后需要重新授权才能继续导入数据。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_013: "失败，请稍后重试。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_014: "提交注销申请后会立即退出登录。你可以在 7 天内通过邮件撤销；到期后账号和个人数据将永久删除。确定继续吗？",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_015: "暂时无法提交注销申请，请确认邮箱和当前密码后重试。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_017: "当前密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_018: "新密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_019: "确认新密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_020: "保存中...",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_021: "修改密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_023: "网站会保存登录资料、游戏档案、工作区和使用记录。仓库分析中的汇总样本会与网站档案关联，以便随账号一起删除。注销后有 7 天撤销期；到期后删除账号、工作区和关联样本。用于安全风控的去标识记录最长保留 90 天，个人使用声明记录在注销后最长保留一年。详情见隐私政策。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_026: "清除授权信息",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_029: "注销账号",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_030: "提交后会立即退出登录，并向你的邮箱发送撤销链接。7 天内可以撤销；到期后将永久删除账号、档案、授权信息、仓库样本、任务和常规使用记录。用于安全风控和法律留存的少量记录会按隐私政策所列期限自动删除。",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_031: "确认邮箱",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_032: "当前密码",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_033: "正在提交注销申请...",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_034: "申请注销账号",
  // src/pages/tool/dashboard/SettingsSection.tsx
  pages_tool_dashboard_SettingsSection_035: "清除授权信息不会删除游戏账号。再次导入数据时，需要使用相同的森空岛 UID 重新授权。",
  pages_tool_dashboard_SettingsSection_036: "森空岛授权信息已清除，游戏账号仍然保留。",
  pages_tool_dashboard_SettingsSection_037: "授权信息已清除，但页面状态未能刷新；重新加载页面即可查看最新状态。",
  pages_tool_dashboard_SettingsSection_038: "森空岛授权信息已清除。再次导入数据时，请使用相同 UID 重新授权。",
  // src/pages/tool/dashboard/ToolsSection.tsx
  pages_tool_dashboard_ToolsSection_001: "仓库价值分析",
  // src/pages/tool/dashboard/ToolsSection.tsx
  pages_tool_dashboard_ToolsSection_002: "导入 MAA 仓库 JSON 或森空岛库存，估算材料的等效理智价值并下载结果图片。",
  // src/pages/tool/AccountDashboard.tsx
  pages_tool_AccountDashboard_tour_001: "查看使用引导",
  pages_tool_AccountDashboard_tour_002: "管理游戏账号",
  pages_tool_AccountDashboard_tour_003: "查看正式档案和免费档案，选择账号后即可准备干员与基建数据。",
  pages_tool_AccountDashboard_tour_004: "使用工具",
  pages_tool_AccountDashboard_tour_005: "分析仓库价值并下载结果图片。手动排班模拟暂未开放，待功能完善后开放。",
  pages_tool_AccountDashboard_tour_006: "添加游戏账号",
  pages_tool_AccountDashboard_tour_007: "使用 CDK 创建正式档案；没有 CDK 时，也可以通过森空岛领取免费个人排班。",
  pages_tool_AccountDashboard_tour_008: "邀请奖励",
  pages_tool_AccountDashboard_tour_009: "查看邀请链接、好友绑定森空岛后的邀请进度，以及双方可获得的道具奖励。",
  pages_tool_AccountDashboard_tour_010: "公告与设置",
  pages_tool_AccountDashboard_tour_011: "在公告中查看服务变化，在设置中管理密码、森空岛授权和个人数据。",
  // src/pages/tool/dashboard/RedeemSection.tsx
  pages_tool_dashboard_RedeemSection_tour_001: "选择添加账号的方式",
  pages_tool_dashboard_RedeemSection_tour_002: "用 CDK 创建正式档案，或通过森空岛确认游戏 UID 后领取免费个人排班。各类档案的导出和高级功能请查看价格与权益。",
  pages_tool_dashboard_RedeemSection_tour_003: "兑换 CDK",
  pages_tool_dashboard_RedeemSection_tour_004: "输入未使用的 CDK，可以同时填写档案名称和备注。兑换成功后会创建正式游戏档案。",
  pages_tool_dashboard_RedeemSection_tour_005: "领取免费个人排班",
  pages_tool_dashboard_RedeemSection_tour_006: "点击领取，完成森空岛授权并确认游戏 UID 后，即可创建免费档案。",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_001: "背包中有档案升级道具",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_002: "背包中有一张限时 CDK，请前往背包查看有效期和当前可用状态。",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_003: "背包中有多种档案升级道具，请前往背包查看用途和有效期。",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_004: "当前免费档案可以使用终身版兑换 CDK，升级为长期高级档案。",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_005: "到背包查看可用道具。档案升级成功后才会消耗道具。",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_006: "不再提示",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_007: "本次关闭提示",
  // src/pages/tool/ProfileUpgradePrompt.tsx
  pages_tool_ProfileUpgradePrompt_008: "前往背包查看",
} as const
