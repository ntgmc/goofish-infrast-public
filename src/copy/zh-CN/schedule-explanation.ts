export const scheduleExplanationCopy = {
  title: 'AI 排班解读',
  description: '找出需要关注的库存问题，结合收益和投入比较培养建议，明确下一步。',
  generate: '解读这份排班',
  generating: '正在生成解读…',
  loading: '正在读取解读…',
  retry: '重新读取',
  failed: '读取解读失败，请重试。',
  quota: (remaining: number, limit: number, monthly: boolean) => monthly
    ? `本月剩余 ${remaining} / ${limit} 次，账号下所有档案共用。`
    : `试用剩余 ${remaining} / ${limit} 次，账号下所有档案共用。`,
  reset: (date: string) => `${date} 刷新月度次数，赠送次数不累计。`,
  disclosure: (provider: string) => `点击生成将向 ${provider} 发送本次排班的产出、班次、相关库存和培养建议摘要，消耗 1 次。`,
  saved: '解读已保存，再次查看不消耗次数。',
  pending: '这份排班正在解读中，完成后会自动显示。',
  reason: {
    disabled: 'AI 解读暂未开放。',
    quota: '解读次数已用完，已保存的解读仍可查看。',
    budget: '今日或本月的 AI 解读名额已用完，请稍后再来。',
    daily_limit: '今天的解读请求较多，请明天再试。',
    busy: '账号还有一份解读正在生成，请完成后再试。',
  },
  estimate: 'AI 根据本次计算结果生成解读，具体数值以排班报告为准。',
  sampleTitle: '示例解读',
  sample: (lmd: string, experience: string) => `每日 ${lmd} 龙门币、${experience} 经验是比较培养收益的基准。决定先培养谁时，还要看单项提升幅度和总投入；即使材料已齐备，培养也会消耗现有库存。不同建议分别测算，完成一项培养后重新排班，再判断下一项。`,
  sampleAction: '生成自己的排班后，可按账号可用次数获取解读。',
} as const
