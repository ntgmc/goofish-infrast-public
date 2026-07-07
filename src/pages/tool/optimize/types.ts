export type OptimizeSection = 'overview' | 'plans' | 'config' | 'result'

export type OptimizePhase = 'idle' | 'history' | 'suggestions' | 'final'

export const OPTIMIZE_SECTIONS: Array<{
  id: OptimizeSection;
  label: string;
  description: string;
}> = [
  { id: 'overview', label: '总览', description: '生成状态与快捷操作' },
  { id: 'plans', label: '方案', description: '保存配置与历史结果' },
  { id: 'config', label: '基建配置', description: '调整当前排班参数' },
  { id: 'result', label: '排班结果', description: '查看、导入与下载' },
]

export type ValidationState = { ok: true } | { ok: false; message: string }
