import type { WorkspaceResultHistoryItem } from '../../../src/lib/types'

export function resolveBaselineHistoryItem(
  history: WorkspaceResultHistoryItem[],
  baselineHistoryId: unknown,
): { ok: true; item: WorkspaceResultHistoryItem } | { ok: false; status: number; message: string } {
  if (!Array.isArray(history) || history.length === 0) {
    return { ok: false, status: 409, message: '暂无可用于重排检测的历史排班。' }
  }
  if (typeof baselineHistoryId === 'string' && baselineHistoryId.trim()) {
    const item = history.find((entry) => entry.id === baselineHistoryId.trim())
    if (!item) return { ok: false, status: 404, message: '未找到指定的历史排班基线。' }
    return { ok: true, item }
  }
  return { ok: true, item: history[0] }
}
