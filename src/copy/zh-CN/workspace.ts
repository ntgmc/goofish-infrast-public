export const workspaceCopy = {
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_001: "(()=>{const raw=localStorage.getItem('SK_OAUTH_CRED_KEY');let cred=raw;try{const data=JSON.parse(raw||'null');cred=data?.cred||data?.value||raw;}catch{}copy(encodeURIComponent(cred||''));console.log(cred?'已复制到粘贴板':'未找到森空岛凭据');})()",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_002: "javascript:(()=>{const raw=localStorage.getItem(\"SK_OAUTH_CRED_KEY\");if(!raw){alert(\"未找到森空岛凭据，请先登录森空岛网页。\");return;}let cred=raw;try{const data=JSON.parse(raw);cred=data.cred||data.value||raw;}catch{}const text=encodeURIComponent(cred);const done=()=>alert(\"森空岛凭据已复制，请回到工具页粘贴。\");navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text).then(done).catch(()=>prompt(\"复制下面的森空岛凭据\",text)):prompt(\"复制下面的森空岛凭据\",text);})()",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_003: "扫码授权",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_004: "粘贴凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_005: "书签脚本",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_006: "领取免费个人排班",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_007: "森空岛导入",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_008: "先预览游戏昵称和 UID，确认后才会保存绑定并分析仓库。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_009: "先确认游戏 UID，确认后才会创建免费档案并导入干员。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_010: "先预览游戏昵称和 UID，确认后才会保存绑定并导入干员。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_011: "关闭森空岛导入",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_012: "关闭",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_013: "获取凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_014: "预览账号",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_015: "确认保存",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_016: "森空岛导入方式",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_017: "推荐使用扫码授权；无法扫码时，可粘贴凭据或使用书签脚本辅助复制。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_018: "重新生成二维码",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_019: "改用粘贴凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_020: "立即检查授权",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_021: "正在读取所选账号",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_022: "读取所选账号",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_023: "确认保存并分析仓库",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_024: "确认保存并导入",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_025: "扫码授权",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_026: "使用森空岛 App 扫码授权。授权后只会进入账号预览，需要再次确认才保存。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_027: "重新生成二维码",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_028: "生成扫码二维码",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_029: "森空岛扫码授权二维码",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_030: "立即检查授权",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_031: "粘贴凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_032: "在森空岛网页登录后，复制本地凭据并粘贴到这里。读取后会先展示昵称和 UID。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_033: "打开森空岛官网",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_034: "复制控制台命令",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_035: "控制台命令",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_036: "森空岛凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_037: "粘贴森空岛凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_038: "读取账号预览",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_039: "书签脚本",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_040: "把助手拖到浏览器书签栏，在森空岛网页登录后点击书签复制凭据，再回到这里粘贴预览。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_041: "显示浏览器书签栏",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_042: "拖动助手到书签栏",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_043: "登录森空岛后点击书签",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_044: "森空岛凭据助手",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_045: "请按住这个按钮拖到浏览器书签栏，不要直接点击。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_046: "拖到浏览器书签栏后松开即可安装。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_047: "森空岛凭据助手",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_048: "如果浏览器禁止拖拽书签，可复制脚本手动新建书签。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_049: "复制书签脚本",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_050: "打开森空岛",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_051: "书签脚本内容",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_052: "书签复制出的凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_053: "粘贴书签脚本复制出的凭据",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_054: "读取账号预览",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_055: "仅预览，尚未保存",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_056: "昵称",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_057: "服务器",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_058: "可读取库存角色",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_059: "可读取干员",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_060: " 名",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_061: "该账号与当前绑定 UID 不一致，没有保存任何变更。请重新登录正确账号。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_062: "确认后才会保存森空岛绑定；请核对昵称和 UID 后继续。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_063: "选择要导入的明日方舟账号",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_064: "每个档案只能绑定一个 UID，请主动选择并核对后继续。",
  // src/components/SklandBindingDialog.tsx
  components_SklandBindingDialog_065: "默认账号",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_001: "检测到多个明日方舟账号，请选择要导入的账号。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_002: "该账号与当前绑定账号不一致。请重新登录正确的森空岛账号。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_003: "当前游戏账号档案已冻结，请联系管理员处理。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_004: "正在检查扫码状态，请在森空岛 App 中确认授权。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_005: "森空岛导入失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_006: "等待森空岛 App 确认授权。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_007: "森空岛导入失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_008: "扫码失败，请重新生成二维码，或改用粘贴凭据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_009: "请先创建或选择账号档案，然后再绑定森空岛。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_010: "正在生成森空岛扫码授权二维码。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_011: "生成森空岛二维码失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_012: "生成森空岛二维码失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_013: "请使用森空岛 App 扫码确认。确认后会先展示昵称和 UID，不会立即保存。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_014: "二维码生成失败，请稍后重试，或改用粘贴凭据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_015: "请先创建或选择账号档案，然后再绑定森空岛。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_016: "请先粘贴森空岛凭据，再读取账号预览。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_017: "正在读取森空岛账号信息。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_018: "森空岛凭据读取失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_019: "森空岛凭据已读取，但未返回可确认账号。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_020: "请重新获取凭据，或改用扫码授权。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_021: "正在读取所选森空岛账号的干员数据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_022: "读取所选森空岛账号失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_023: "所选森空岛账号未返回可确认预览。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_024: "请重新授权后再选择账号。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_025: "正在保存森空岛绑定并准备分析仓库。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_026: "正在保存森空岛绑定并导入干员数据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_027: "森空岛导入失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_028: "森空岛导入失败",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_029: "请重新预览后再保存仓库绑定。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_030: "请重新预览后再导入。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_031: "二维码已过期。请重新生成二维码，或改用粘贴凭据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_032: "扫码等待超时。请重新生成二维码，或改用粘贴凭据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_033: "生成二维码后，使用森空岛 App 授权。授权后会先预览昵称和 UID。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_034: "粘贴森空岛凭据后读取账号预览，确认前不会保存。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_035: "安装书签脚本后复制凭据，粘贴后读取账号预览。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_036: "请核对森空岛账号信息，确认后将保存绑定并分析仓库。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_037: "请核对森空岛账号信息，确认后将保存绑定并导入干员数据。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_038: "森空岛已保存，正在读取仓库库存。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_039: "森空岛干员数据已导入。",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_040: "已导入 ",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_041: " 名干员：",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_042: "已同步 ",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_043: " 到基建配置",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_044: "干员已导入，库存同步失败，可稍后刷新",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_045: "赤金",
  // src/hooks/useSklandBinding.ts
  hooks_useSklandBinding_046: "源石碎片",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_001: "干员数据",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_002: "基建配置",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_003: "档案与 CDK",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_004: "免费个人排班档案的干员数据只能通过森空岛导入。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_005: "森空岛刷新失败",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_006: "森空岛刷新失败",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_007: "已刷新",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_008: "森空岛干员数据已刷新。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_009: "请先上传干员识别文件。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_010: "免费个人排班档案必须先绑定森空岛后才能保存工作区数据。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_011: "保存失败，请稍后重试",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_012: "保存失败，请稍后重试",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_013: "MAA 工作台",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_014: "工作区设置",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_015: "已就绪",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_016: "待完成",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_017: "返回账号列表",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_018: "退出登录",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_019: "准备账号工作区",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_020: "上传干员识别文件并确认基建配置，保存后进入排班优化。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_021: "返回账号列表",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_022: "退出登录",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_023: "移动端工作区设置",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_024: "干员数据",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_025: "上传 MAA 导出的干员识别文件，或使用森空岛扫码导入后预览干员头像、精英化和等级。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_026: "已就绪",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_027: "已选择：",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_028: "已载入 ",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_029: " 名拥有干员",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_030: "选择干员识别文件",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_031: "拥有干员 ",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_032: " 名",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_033: "搜索干员名称",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_034: "搜索干员名称",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_035: "准备情况",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_036: "套餐",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_037: "干员",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_038: " 名",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_039: "还未上传",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_040: "已拥有",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_041: " 名",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_042: "基建配置",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_043: "已修改",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_044: "已保存",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_045: "请检查",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_046: "正在保存...",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_047: "保存工作区并开始排班",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_048: "免费档案升级失败，请稍后重试",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_049: "档案与 CDK",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_050: "可以用 CDK 原地升级当前免费档案并保留工作区，也可以兑换为新的独立档案。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_051: "当前档案已经使用正式授权；如需管理其他游戏账号，可以继续兑换新的独立档案。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_052: "升级当前免费档案",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_053: "保留干员、森空岛绑定、基建配置与历史记录，直接解锁 CDK 权益。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_054: "升级 CDK",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_055: "正在升级...",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_056: "升级当前免费档案",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_057: "兑换新的 CDK 档案",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_058: "前往“添加账号”输入未使用的 CDK，创建独立档案；当前工作区不会改变。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_059: "前往兑换新档案",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_060: "还没有 CDK",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_061: "通过当前可用的购买渠道获取 CDK，购买后返回此处升级或兑换。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_062: "森空岛导入",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_063: "凭据已失效",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_064: "已绑定",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_065: "未绑定",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_066: "昵称",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_067: "服务器",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_068: "绑定时间",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_069: "最近刷新",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_070: "凭据状态",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_071: "可用",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_072: "扫码、粘贴凭据或书签脚本都会先预览昵称和 UID，确认后才保存绑定并导入。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_073: "重新绑定森空岛",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_074: "绑定森空岛",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_075: "正在刷新...",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_076: "刷新森空岛数据",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_077: "重新绑定森空岛",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_078: "再次刷新",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_079: "精 ",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_080: "未拥有",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_081: "正在载入配置...",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_082: " 名干员：",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_083: "。已同步",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_084: "到基建配置。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_085: "。干员已导入，库存同步失败，可稍后刷新。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_086: "赤金",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_087: "源石碎片",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_088: "森空岛凭据已失效。请重新绑定森空岛后再刷新。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_089: "当前账号尚未绑定森空岛。请先完成绑定。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_090: "仓库分析档案不能刷新工作区，请到仓库价值分析页重新分析。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_091: "森空岛刷新失败: ",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_092: "。请稍后重试。",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_093: "凭据格式无效，请重新绑定",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_094: "凭据已失效，请重新绑定",
  // src/pages/tool/WorkspaceSetupPage.tsx
  pages_tool_WorkspaceSetupPage_095: "凭据不可用，请重新绑定",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_001: "请填写方案名称。",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_002: "已保存方案“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_003: "新的方案名称",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_004: "已重命名为“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_005: "删除方案“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_006: "已删除方案“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_007: "已载入方案“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_008: "”，可以继续调整或重新生成。",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_009: "已载入方案“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_010: "这条旧结果没有保存配置快照，只能查看或下载。",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_011: "已载入历史配置“",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_012: "”，可继续调整后重新生成。",
  // src/pages/tool/optimize/useOptimizeWorkspace.ts
  pages_tool_optimize_useOptimizeWorkspace_013: "游戏内轮换模式不生成 MAA JSON。",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_001: "高级版限时体验",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_002: "免费预览",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_003: "单次重置卡",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_004: "练度提升卡",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_005: "单账号终身卡",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_006: "Admin卡",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_007: "练度提升卡",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_008: "干员数据不能为空。",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_009: "第 ",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_010: " 个干员不是对象。",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_011: "第 ",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_012: " 个干员缺少 ",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_013: " 字段。",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_014: "请输入邮箱",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_015: "请输入正确的邮箱地址",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_016: "请输入密码",
  // src/pages/tool/tool-utils.ts
  pages_tool_tool_utils_017: "密码至少需要 8 位",
  // src/pages/tool/workspace/WorkspaceConfigSection.tsx
  pages_tool_workspace_WorkspaceConfigSection_001: "保存后，下次打开这个账号会自动带上这套配置。",
} as const
