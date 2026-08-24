export const authCopy = {
  // server/handlers/auth.ts and server/handlers/user-auth.ts
  api_method_not_allowed: "当前操作不受支持，请刷新页面后重试。",
  api_route_not_found: "未找到对应服务，请刷新页面后重试。",
  api_internal_error: "服务暂时不可用，请稍后重试。",
  api_registration_accepted: "如果可以注册，我们会向这个邮箱发送验证邮件，请按邮件提示完成注册。",
  api_registration_completed: "注册成功，请使用邮箱和密码登录。",
  api_registration_brevo_limit_reached: "今天的验证邮件额度已用完，暂时无法注册，请明天再试。",
  api_registration_brevo_reserve_reached: "今天可用于注册的验证邮件额度已用完，暂时无法注册，请明天再试。",
  api_invite_code_required: "当前需要管理员邀请码才能注册，请输入收到的邀请码。",
  api_brevo_limit_reached: "今天的邮件发送额度已用完，请明天再试。",
  api_recovery_accepted: "如果该邮箱已注册，我们会发送操作邮件，请检查收件箱和垃圾邮件。",
  api_service_unavailable: "登录注册服务暂时不可用，请稍后重试。",
  api_too_many_attempts: "操作过于频繁，请稍后再试。",
  api_password_service_busy: "登录注册服务繁忙，请稍后重试。",
  api_verification_email_send_failed: "暂时无法发送验证邮件，请稍后重试。",
  api_login_required: "请先登录后继续。",
  api_password_reset_requested: "如果该邮箱已注册，我们会发送重置密码邮件，请检查收件箱和垃圾邮件。",
  api_password_reset_invalid: "重置链接无效或已过期，请重新申请重置邮件。",
  api_password_type_invalid: "请输入密码。",
  api_password_too_short: "密码至少需要 8 位。",
  api_password_too_long: "密码不能超过 128 位。",
  api_email_invalid: "请输入正确的邮箱地址。",
  api_email_provider_not_allowed: "请使用常用公共邮箱注册，暂不支持企业、自建或临时邮箱。",
  api_email_alias_not_allowed: "请使用不含别名的邮箱地址：移除“+”及其后内容；Gmail 地址还需去掉用户名中的“.”。",
  api_email_domain_typo: "邮箱域名可能拼错了，请确认或使用建议地址。",
  api_credentials_invalid: "邮箱或密码不正确。",
  api_account_inactive: "这个账号暂时无法登录，请联系客服。",
  api_email_not_verified: "请先完成邮箱验证；没有收到邮件时，可以重新发送。",
  api_current_password_invalid: "当前密码不正确，请重新输入。",
  api_password_update_conflict: "账号信息已更新，请刷新页面后重新提交。",
  api_cdk_required: "请输入 CDK。",
  api_cdk_not_found: "未找到这个 CDK，请检查输入是否正确。",
  api_cdk_frozen: "这个 CDK 已被冻结，请联系客服。",
  api_cdk_revoked: "这个 CDK 已失效，请联系客服。",
  api_cdk_already_redeemed: "这个 CDK 已被使用，或正在处理中。",
  api_cdk_type_mismatch: "这个 CDK 需要登录后到积分页兑换。",
  api_cdk_type_unavailable: "这个道具 CDK 需要登录后到兑换页使用。",
  api_idempotency_conflict: "这次兑换与之前的提交不一致，请刷新页面后重试。",
  api_free_profile_skland_required: "请通过森空岛登录领取免费个人排班档案。",
  api_free_profile_required: "请先通过森空岛领取免费个人排班档案。",
  api_profile_not_found: "未找到这个档案，请刷新页面后重试。",
  api_free_profile_upgrade_only: "只有免费个人排班档案可以直接升级。",
  api_profile_unavailable: "这个档案当前无法使用，请刷新页面或联系客服。",
  api_email_verification_sent: "如果可以注册，我们会向这个邮箱发送验证邮件，请按邮件提示完成注册。",
  api_email_verification_resend: "如果可以注册，我们会向这个邮箱发送验证邮件，请按邮件提示完成注册。",
  api_email_verification_invalid: "验证链接无效或已过期，请返回登录页重新发送验证邮件。",
  // src/components/AuthForm.tsx
  components_AuthForm_001: "暂时无法发送重置密码邮件，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_002: "如果该邮箱已注册，我们会发送重置密码邮件，请检查收件箱和垃圾邮件。",
  // src/components/AuthForm.tsx
  components_AuthForm_003: "暂时无法登录，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_004: "暂时无法注册，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_005: "暂时无法登录，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_006: "暂时无法注册，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_007: "登录或注册",
  // src/components/AuthForm.tsx
  components_AuthForm_008: "登录",
  // src/components/AuthForm.tsx
  components_AuthForm_009: "注册",
  // src/components/AuthForm.tsx
  components_AuthForm_010: "重置密码",
  // src/components/AuthForm.tsx
  components_AuthForm_011: "邮箱",
  // src/components/AuthForm.tsx
  components_AuthForm_012: "密码",
  // src/components/AuthForm.tsx
  components_AuthForm_013: "CDK（可选）",
  // src/components/AuthForm.tsx
  components_AuthForm_014: "可注册后在账号页兑换",
  // src/components/AuthForm.tsx
  components_AuthForm_015: "邀请码（可选）",
  // src/components/AuthForm.tsx
  components_AuthForm_016: "输入 10 位好友邀请码或 16 位管理员邀请码",
  // src/components/AuthForm.tsx
  components_AuthForm_017: "忘记密码？",
  // src/components/AuthForm.tsx
  components_AuthForm_018: "返回登录",
  // src/components/AuthForm.tsx
  components_AuthForm_019: "处理中...",
  // src/components/AuthForm.tsx
  components_AuthForm_020: "登录",
  // src/components/AuthForm.tsx
  components_AuthForm_021: "创建账号",
  // src/components/AuthForm.tsx
  components_AuthForm_022: "发送重置邮件",
  // src/components/AuthForm.tsx
  components_AuthForm_023: "请输入邮箱",
  // src/components/AuthForm.tsx
  components_AuthForm_024: "请输入正确的邮箱地址",
  // src/components/AuthForm.tsx
  components_AuthForm_025: "请输入密码",
  // src/components/AuthForm.tsx
  components_AuthForm_026: "密码至少需要 8 位",
  // src/components/AuthForm.tsx
  components_AuthForm_027: "请检查邀请码：好友邀请码为 10 位，管理员邀请码为 16 位",
  // src/components/AuthForm.tsx
  components_AuthForm_028: "如果可以注册，我们会向这个邮箱发送验证邮件，请按邮件提示完成注册。",
  // src/components/AuthForm.tsx
  components_AuthForm_029: "暂时无法重新发送验证邮件，请稍后重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_030: "如果可以注册，我们会向这个邮箱发送验证邮件，请按邮件提示完成注册。",
  // src/components/AuthForm.tsx
  components_AuthForm_031: "重新发送验证邮件",
  // src/components/AuthForm.tsx
  components_AuthForm_032: "管理员邀请码（必填）",
  // src/components/AuthForm.tsx
  components_AuthForm_033: "请输入管理员邀请码",
  // src/components/AuthForm.tsx
  components_AuthForm_034: "16 位管理员邀请码",
  // src/components/AuthForm.tsx
  components_AuthForm_035: "请输入有效的 16 位管理员邀请码",
  // src/components/AuthForm.tsx
  components_AuthForm_036: "请使用常用公共邮箱注册，暂不支持企业、自建、临时或别名邮箱。",
  // src/components/AuthForm.tsx
  components_AuthForm_038: "请使用不含别名的邮箱地址：移除“+”及其后内容；Gmail 地址还需去掉用户名中的“.”。",
  // src/components/AuthForm.tsx
  components_AuthForm_039: "邮箱域名可能拼错了，请确认或使用建议地址。",
  // src/components/AuthForm.tsx
  components_AuthForm_040: "建议使用：",
  // src/components/AuthForm.tsx
  components_AuthForm_041: "改用",
  // src/components/AuthForm.tsx
  components_AuthForm_042: "邮箱不能超过 254 个字符",
  // src/components/AuthForm.tsx
  components_AuthForm_043: "密码不能超过 128 位",
  // src/components/AuthForm.tsx
  components_AuthForm_044: "秒后可重新发送",
  // src/components/AuthForm.tsx
  components_AuthForm_045: "暂时无法读取注册要求，请重试。",
  // src/components/AuthForm.tsx
  components_AuthForm_046: "注册要求仍在加载，请稍等片刻。",
  // src/components/AuthForm.tsx
  components_AuthForm_047: "正在加载注册要求...",
  // src/components/AuthForm.tsx
  components_AuthForm_048: "重试",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_001: "验证链接无效或已过期，请返回登录页重新发送验证邮件。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_002: "正在验证邮箱，请稍候...",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_003: "邮箱验证成功，正在进入工作台。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_004: "账号安全",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_005: "验证邮箱",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_006: "验证成功后会自动登录，并进入你的账号工作台。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_007: "重试验证",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_008: "返回登录并重新发送邮件",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_001: "撤销链接无效或已过期，请重新登录查看账号状态。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_002: "注销请求已撤销。你现在可以正常登录。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_003: "账号安全",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_004: "撤销账号注销",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_005: "确认后会恢复账号和现有数据，不会修改已保存的排班方案。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_006: "正在处理...",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_007: "撤销注销",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_008: "返回登录",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_001: "重置链接无效或已过期，请重新申请重置邮件。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_002: "请确认新密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_003: "两次输入的密码不一致",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_004: "暂时无法重置密码，请稍后重试。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_005: "密码已重置，请使用新密码登录。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_006: "账号安全",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_007: "重置密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_008: "设置新密码后，即可登录并继续使用工作台。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_009: "新密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_010: "确认新密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_011: "重置中...",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_012: "重置密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_013: "返回登录",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_014: "请输入密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_015: "密码至少需要 8 位",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_016: "密码不能超过 128 位",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_001: "账号登录",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_002: "MAA 基建排班工作台",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_003: "登录后，开始生成下一份排班。",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_004: "登录后添加游戏账号，选择森空岛或 MAA 数据，即可按你的干员情况生成可导入的基建排班 JSON。",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_005: "账号确认",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_006: "游戏昵称与 UID",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_007: "森空岛授权",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_008: "无需提供游戏密码",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_009: "排班导出",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_010: "账号登录与注册",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_011: "进入工作台",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_012: "登录或创建账号",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_013: "CDK 可用于开通正式档案，也可以注册后再兑换。",
} as const
