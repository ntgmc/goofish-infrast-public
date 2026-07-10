import type { OptimizeSection } from '../../../lib/app-routes'

export type { OptimizeSection } from '../../../lib/app-routes'

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
  { id: 'lab', label: '实验室', description: '比较场景与 Pareto 前沿' },
]

export type ValidationState = { ok: true } | { ok: false; message: string }
