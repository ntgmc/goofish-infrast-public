import type {
  ScenarioComparisonFactors,
  ScenarioDroneStrategy,
  ScenarioLayout,
  ScenarioMaaShiftHours,
  ScenarioProductSplit,
} from '../../../../lib/scenario-comparison'

const LAYOUTS: Array<{ id: ScenarioLayout; manufacturing: number }> = [
  { id: '153', manufacturing: 5 },
  { id: '243', manufacturing: 4 },
  { id: '333', manufacturing: 3 },
]

const DRONES: Array<{ id: ScenarioDroneStrategy; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动选择' },
  { id: 'lmd', label: '龙门币' },
  { id: 'pure_gold', label: '赤金' },
  { id: 'battle_record', label: '作战记录' },
]

export default function ScenarioFactors({
  factors,
  disabled,
  onChange,
}: {
  factors: ScenarioComparisonFactors;
  disabled: boolean;
  onChange: (next: ScenarioComparisonFactors) => void;
}) {
  const toggleSplit = (layout: ScenarioLayout, split: ScenarioProductSplit) => {
    const current = factors.layouts.find((item) => item.layout === layout)
    const selected = current?.splits.some((item) => sameSplit(item, split)) ?? false
    const nextSplits = selected
      ? (current?.splits ?? []).filter((item) => !sameSplit(item, split))
      : [...(current?.splits ?? []), split]
    const nextLayouts = factors.layouts.filter((item) => item.layout !== layout)
    if (nextSplits.length > 0) nextLayouts.push({ layout, splits: nextSplits })
    onChange({ ...factors, layouts: nextLayouts.sort((a, b) => a.layout.localeCompare(b.layout)) })
  }

  const toggleShift = (value: ScenarioMaaShiftHours) => {
    const selected = factors.maaShiftHours.includes(value)
    onChange({
      ...factors,
      maaShiftHours: selected
        ? factors.maaShiftHours.filter((item) => item !== value)
        : [...factors.maaShiftHours, value].sort((a, b) => a - b),
    })
  }

  const toggleDrone = (value: ScenarioDroneStrategy) => {
    const selected = factors.droneStrategies.includes(value)
    onChange({
      ...factors,
      droneStrategies: selected
        ? factors.droneStrategies.filter((item) => item !== value)
        : [...factors.droneStrategies, value],
    })
  }

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <legend className="sr-only">场景组合因子</legend>
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">布局与赤金/经验线</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">每个布局可选择多个精确整数拆分。</p>
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          {LAYOUTS.map((layout) => (
            <div key={layout.id} className="rounded-lg border border-surface-3 bg-surface-2/45 p-3">
              <p className="text-sm font-semibold text-ink-primary">{layout.id}</p>
              <div className="mt-2 grid gap-2">
                {splitOptions(layout.manufacturing).map((split) => {
                  const id = `scenario-${layout.id}-${split.pureGold}-${split.battleRecord}`
                  const checked = factors.layouts.find((item) => item.layout === layout.id)?.splits.some((item) => sameSplit(item, split)) ?? false
                  return (
                    <label key={id} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-ink-secondary hover:bg-surface-2">
                      <input id={id} type="checkbox" checked={checked} onChange={() => toggleSplit(layout.id, split)} className="h-4 w-4 accent-brand-500" />
                      赤金 {split.pureGold} 线 + 经验 {split.battleRecord} 线
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">排班模式</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([6, 8, 12] as ScenarioMaaShiftHours[]).map((hours) => (
              <CheckOption key={hours} id={`shift-${hours}`} checked={factors.maaShiftHours.includes(hours)} onChange={() => toggleShift(hours)}>
                MAA {hours} 小时 × {24 / hours}
              </CheckOption>
            ))}
            <CheckOption id="shift-rotation" checked={factors.includeRotation} onChange={() => onChange({ ...factors, includeRotation: !factors.includeRotation })}>
              游戏内轮换 12 小时 × 2
            </CheckOption>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">游戏内轮换固定关闭无人机和菲亚梅塔，不随下方策略重复展开。</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-primary">MAA 无人机策略</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {DRONES.map((drone) => (
              <CheckOption key={drone.id} id={`drone-${drone.id}`} checked={factors.droneStrategies.includes(drone.id)} onChange={() => toggleDrone(drone.id)}>
                {drone.label}
              </CheckOption>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">指定目标不存在时自动跳过；启用策略统一在换班前执行。</p>
        </div>
      </div>
    </fieldset>
  )
}

function CheckOption({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-surface-3 bg-surface-2/45 px-3 text-sm text-ink-secondary hover:bg-surface-2">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-brand-500" />
      {children}
    </label>
  )
}

function splitOptions(manufacturing: number): ScenarioProductSplit[] {
  return Array.from({ length: manufacturing + 1 }, (_, pureGold) => ({
    pureGold,
    battleRecord: manufacturing - pureGold,
  }))
}

function sameSplit(left: ScenarioProductSplit, right: ScenarioProductSplit): boolean {
  return left.pureGold === right.pureGold && left.battleRecord === right.battleRecord
}
