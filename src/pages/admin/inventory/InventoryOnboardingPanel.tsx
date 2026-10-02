import { useState } from 'react'
import type { GiftPackContentInput, OnboardingTaskCode } from '../../../lib/inventory-contracts'
import { Field, RewardListEditor, validRewards, type InventoryPanelProps } from './InventoryEditors'

type TaskDraft = { enabled: boolean; rewards: GiftPackContentInput[] }
const TASK_LABELS: Record<OnboardingTaskCode, string> = {
  welcome_inventory: '认识网站',
  bind_skland: '绑定森空岛',
  first_main_schedule: '首次主排班',
}

export function InventoryOnboardingPanel({ data, busy, run }: InventoryPanelProps) {
  const [taskCode, setTaskCode] = useState<OnboardingTaskCode>('welcome_inventory')
  const [drafts, setDrafts] = useState<Partial<Record<OnboardingTaskCode, TaskDraft>>>({})
  const task = data.tasks.find((entry) => entry.task_code === taskCode)
  const draft = drafts[taskCode] ?? { enabled: task?.enabled ?? false, rewards: task?.rewards_json ?? [] }
  const valid = (!draft.enabled || draft.rewards.length > 0) && validRewards(draft.rewards, data, true)
  const update = (changes: Partial<TaskDraft>) =>
    setDrafts((current) => ({ ...current, [taskCode]: { ...draft, ...changes } }))

  return <form className="tool-panel min-w-0 p-5 sm:p-6" onSubmit={(event) => {
    event.preventDefault()
    if (!valid) return
    const submittedTask = taskCode
    const submittedDraft = draft
    void run('/api/admin/items', {
      action: 'configure_onboarding_task', task_code: submittedTask, enabled: draft.enabled, rewards: draft.rewards,
    }, '新人任务配置版本已发布。').then((response) => {
      if (response === null) return
      setDrafts((current) => {
        if (current[submittedTask] && current[submittedTask] !== submittedDraft) return current
        const next = { ...current }
        delete next[submittedTask]
        return next
      })
    })
  }}>
    <h3 className="text-base font-semibold text-ink-primary">固定新人任务</h3>
    <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <Field label="任务">
          <select className="tool-field mt-2 min-w-0" value={taskCode} onChange={(event) => setTaskCode(event.currentTarget.value as OnboardingTaskCode)}>
            {Object.entries(TASK_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.currentTarget.checked })} />新版本启用
        </label>
        <p className="mt-3 text-xs leading-5 text-ink-muted">当前 v{task?.version ?? '—'} {task?.enabled ? '已启用' : '已停用'}。启用新版本前必须配置奖励。</p>
      </div>
      <RewardListEditor id={`task-rewards-${taskCode}`} label={`${TASK_LABELS[taskCode]}奖励`}
        value={draft.rewards} definitions={data.definitions} versions={data.gift_pack_versions} allowGiftPacks
        onChange={(rewards) => update({ rewards })} />
    </div>
    <button className="tool-primary-action mt-4" disabled={busy || !valid}>{draft.enabled ? '发布并启用' : '发布停用版本'}</button>
  </form>
}
