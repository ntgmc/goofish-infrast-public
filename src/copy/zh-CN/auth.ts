export const authCopy = {
  // server/handlers/auth.ts and server/handlers/user-auth.ts
  api_method_not_allowed: "请求方法不受支持。",
  api_route_not_found: "接口不存在。",
  api_internal_error: "服务器内部错误，请稍后重试。",
  api_registration_accepted: "已发送注册验证邮件，请检查您的收件箱，并在邮件中确认。",
  api_registration_completed: "注册成功，请使用邮箱和密码登录。",
  api_registration_brevo_limit_reached: "今日邮件发送额度已用尽，注册已暂停，请明日再试。",
  api_registration_brevo_reserve_reached: "当前注册验证邮件已达到预留边界，注册已暂停，请明日再试。",
  api_invite_code_required: "当前仅限管理员邀请注册，请输入管理员邀请码。",
  api_brevo_limit_reached: "今日邮件发送额度已用尽，请明日再试。",
  api_recovery_accepted: "如果账号符合条件，请按照发送至注册邮箱的说明操作。",
  api_service_unavailable: "认证服务暂时不可用，请稍后重试。",
  api_too_many_attempts: "尝试次数过多，请稍后重试。",
  api_password_service_busy: "认证服务繁忙，请稍后重试。",
  api_verification_email_send_failed: "验证邮件发送失败，请稍后重试。",
  api_login_required: "请先登录。",
  api_password_reset_requested: "如果该邮箱已注册，重置密码邮件已发送，请检查收件箱。",
  api_password_reset_invalid: "重置链接无效或已过期。",
  api_password_type_invalid: "密码格式不正确。",
  api_password_too_short: "密码至少需要 8 位。",
  api_password_too_long: "密码不能超过 128 位。",
  api_email_invalid: "请输入正确的邮箱地址。",
  api_email_provider_not_allowed: "注册仅支持常用公共邮箱，不支持企业、自建或临时邮箱。",
  api_email_alias_not_allowed: "注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”并使用 gmail.com。",
  api_email_domain_typo: "邮箱域名可能有误，请使用建议地址。",
  api_credentials_invalid: "邮箱或密码不正确。",
  api_account_inactive: "账号当前不可用。",
  api_email_not_verified: "请先验证邮箱后再登录。",
  api_current_password_invalid: "当前密码不正确。",
  api_cdk_required: "请输入 CDK。",
  api_cdk_not_found: "CDK 不存在。",
  api_cdk_frozen: "CDK 已被冻结。",
  api_cdk_revoked: "CDK 已被撤销。",
  api_cdk_already_redeemed: "CDK 已被使用或正在兑换中。",
  api_cdk_type_mismatch: "该 CDK 请登录后前往积分页兑换。",
  api_cdk_type_unavailable: "道具 CDK 暂未开放。",
  api_idempotency_conflict: "当前请求标识已用于其他兑换请求。",
  api_free_profile_skland_required: "免费个人排班档案必须通过森空岛登录领取。",
  api_free_profile_required: "缺少免费个人排班档案。",
  api_profile_not_found: "档案不存在。",
  api_free_profile_upgrade_only: "只有免费个人排班档案可以原地升级。",
  api_profile_unavailable: "档案当前不可用。",
  api_email_verification_sent: "请检查邮箱并点击验证链接完成注册。",
  api_email_verification_resend: "如果该账号仍需验证，验证邮件已发送，请检查收件箱。",
  api_email_verification_invalid: "验证链接无效或已过期。",
  // src/components/AuthForm.tsx
  components_AuthForm_001: "发送重置邮件失败，请稍后重试",
  // src/components/AuthForm.tsx
  components_AuthForm_002: "如果该邮箱已注册，重置密码邮件已发送，请检查收件箱。",
  // src/components/AuthForm.tsx
  components_AuthForm_003: "登录失败",
  // src/components/AuthForm.tsx
  components_AuthForm_004: "注册失败",
  // src/components/AuthForm.tsx
  components_AuthForm_005: "登录失败",
  // src/components/AuthForm.tsx
  components_AuthForm_006: "注册失败",
  // src/components/AuthForm.tsx
  components_AuthForm_007: "登录方式",
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
  components_AuthForm_014: "稍后在账号页兑换",
  // src/components/AuthForm.tsx
  components_AuthForm_015: "邀请码（可选）",
  // src/components/AuthForm.tsx
  components_AuthForm_016: "10 位推荐码或 16 位管理员邀请码",
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
  components_AuthForm_027: "请输入有效的 10 位推荐码或 16 位管理员邀请码",
  // src/components/AuthForm.tsx
  components_AuthForm_028: "验证邮件已发送，请检查收件箱并点击链接完成注册。",
  // src/components/AuthForm.tsx
  components_AuthForm_029: "重新发送验证邮件失败，请稍后重试",
  // src/components/AuthForm.tsx
  components_AuthForm_030: "如果该账号仍需验证，验证邮件已发送，请检查收件箱。",
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
  components_AuthForm_036: "仅支持常用公共邮箱；不支持企业、自建、临时或别名邮箱。",
  // src/components/AuthForm.tsx
  components_AuthForm_038: "注册不支持邮箱别名。请移除“+”；Gmail 请同时移除用户名中的“.”。",
  // src/components/AuthForm.tsx
  components_AuthForm_039: "邮箱域名可能有误，请使用建议地址。",
  // src/components/AuthForm.tsx
  components_AuthForm_040: "建议地址：",
  // src/components/AuthForm.tsx
  components_AuthForm_041: "使用",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_001: "验证链接无效或已过期。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_002: "正在验证邮箱...",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_003: "邮箱验证成功，正在进入工作台。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_004: "账号安全",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_005: "验证邮箱",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_006: "完成验证后将自动登录，并进入你的账号工作台。",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_007: "重试验证",
  // src/pages/VerifyEmailPage.tsx
  pages_VerifyEmailPage_008: "返回登录并重新发送邮件",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_001: "撤销链接无效或已过期。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_002: "注销请求已撤销。你现在可以正常登录。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_003: "账号安全",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_004: "撤销账号注销",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_005: "确认后将恢复账号及现有工作台数据；此操作不会重新生成或修改任何排班方案。",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_006: "正在处理...",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_007: "撤销注销",
  // src/pages/CancelAccountDeletionPage.tsx
  pages_CancelAccountDeletionPage_008: "返回登录",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_001: "重置链接无效或已过期。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_002: "请确认新密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_003: "两次输入的密码不一致",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_004: "重置密码失败",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_005: "密码已重置，请使用新密码登录。",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_006: "账号安全",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_007: "重置密码",
  // src/pages/ResetPasswordPage.tsx
  pages_ResetPasswordPage_008: "设置新密码后可返回工作台继续管理账号和排班数据。",
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
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_001: "账号入口",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_002: "MAA 基建排班工作台",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_003: "准备数据，生成下一份排班。",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_004: "登录后添加游戏账号，确认森空岛或 MAA 数据来源，再按当前干员池生成可导入的基建排班 JSON。",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_005: "数据确认",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_006: "昵称与 UID",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_007: "安全边界",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_008: "无需密码",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_009: "最终结果",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_010: "账号登录与注册",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_011: "继续到工作台",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_012: "登录或创建账号",
  // src/pages/tool/AuthPage.tsx
  pages_tool_AuthPage_013: "CDK 用于开通游戏档案，可稍后在账号页兑换，不影响注册。",
} as const
