import { useState } from 'react'
import type {
  ScenarioComparisonFactors,
  ScenarioDroneStrategy,
  ScenarioLayout,
  ScenarioMaaSchedule,
  ScenarioProductionPlan,
} from '../../../../lib/scenario-comparison'

const LAYOUTS: Array<{ id: ScenarioLayout; trading: number; manufacturing: number }> = [
  { id: '153', trading: 1, manufacturing: 5 },
  { id: '243', trading: 2, manufacturing: 4 },
  { id: '333', trading: 3, manufacturing: 3 },
]

const SCHEDULES: Array<{ id: ScenarioMaaSchedule; label: string }> = [
  { id: 'variable', label: 'MAA 自动非固定间隔（2–4 班）' },
  { id: '8x3', label: 'MAA 8 小时 × 3' },
  { id: '12x2', label: 'MAA 12 小时 × 2' },
]

const DRONES: Array<{ id: ScenarioDroneStrategy; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动选择' },
  { id: 'lmd', label: '龙门币' },
  { id: 'orundum', label: '合成玉' },
  { id: 'pure_gold', label: '赤金' },
  { id: 'battle_record', label: '作战记录' },
  { id: 'originium_shard', label: '源石碎片' },
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
  const toggleSchedule = (value: ScenarioMaaSchedule) => {
    const selected = factors.maaSchedules.includes(value)
    onChange({
      ...factors,
      maaSchedules: selected
        ? factors.maaSchedules.filter((item) => item !== value)
        : [...factors.maaSchedules, value].sort(scheduleOrder),
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

  const updatePlans = (layout: ScenarioLayout, plans: ScenarioProductionPlan[]) => {
    const layouts = factors.layouts.filter((item) => item.layout !== layout)
    if (plans.length > 0) layouts.push({ layout, plans: [...plans].sort((left, right) => planKey(left).localeCompare(planKey(right))) })
    onChange({ ...factors, layouts: layouts.sort((left, right) => left.layout.localeCompare(right.layout)) })
  }

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <legend className="sr-only">场景组合因子</legend>
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">布局与精确生产方案</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">选择合成玉、源石碎片和赤金线数，其余龙门币与经验线自动补足。</p>
        <div
          data-testid="scenario-layout-grid"
          className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
        >
          {LAYOUTS.map((layout) => (
            <LayoutPlanEditor
              key={layout.id}
              layout={layout}
              plans={factors.layouts.find((item) => item.layout === layout.id)?.plans ?? []}
              onChange={(plans) => updatePlans(layout.id, plans)}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">排班模式</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SCHEDULES.map((schedule) => (
              <CheckOption
                key={schedule.id}
                id={`shift-${schedule.id}`}
                checked={factors.maaSchedules.includes(schedule.id)}
                onChange={() => toggleSchedule(schedule.id)}
              >
                {schedule.label}
              </CheckOption>
            ))}
            <CheckOption
              id="shift-rotation"
              checked={factors.includeRotation}
              onChange={() => onChange({ ...factors, includeRotation: !factors.includeRotation })}
            >
              游戏内轮换 12 小时 × 2
            </CheckOption>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">自动模式先快速选择实际间隔，再冻结该数组精确复核；轮换不随无人机策略重复展开。</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-primary">MAA 无人机策略</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {DRONES.map((drone) => (
              <CheckOption
                key={drone.id}
                id={`drone-${drone.id}`}
                checked={factors.droneStrategies.includes(drone.id)}
                onChange={() => toggleDrone(drone.id)}
              >
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

function LayoutPlanEditor({
  layout,
  plans,
  onChange,
}: {
  layout: { id: ScenarioLayout; trading: number; manufacturing: number };
  plans: ScenarioProductionPlan[];
  onChange: (plans: ScenarioProductionPlan[]) => void;
}) {
  const [orundum, setOrundum] = useState(0)
  const [originiumShard, setOriginiumShard] = useState(0)
  const [pureGold, setPureGold] = useState(Math.min(2, layout.manufacturing))
  const maxPureGold = layout.manufacturing - originiumShard
  const boundedPureGold = Math.min(pureGold, maxPureGold)
  const draft = buildPlan(layout, orundum, originiumShard, boundedPureGold)
  const duplicate = plans.some((plan) => samePlan(plan, draft))

  return (
    <section className="tool-inset min-w-0 p-3" aria-labelledby={`layout-${layout.id}-title`}>
      <div className="flex items-center justify-between gap-2">
        <h4 id={`layout-${layout.id}-title`} className="text-sm font-semibold text-ink-primary">{layout.id}</h4>
        <span className="tool-status tabular-nums">已选 {plans.length}</span>
      </div>
      <div className="mt-3 grid gap-3">
        <SelectField
          id={`layout-${layout.id}-orundum`}
          label="合成玉贸易线"
          value={orundum}
          max={layout.trading}
          onChange={setOrundum}
        />
        <SelectField
          id={`layout-${layout.id}-shard`}
          label="源石碎片制造线"
          value={originiumShard}
          max={layout.manufacturing}
          onChange={(value) => {
            setOriginiumShard(value)
            setPureGold((current) => Math.min(current, layout.manufacturing - value))
          }}
        />
        <SelectField
          id={`layout-${layout.id}-gold`}
          label="赤金制造线"
          value={boundedPureGold}
          max={maxPureGold}
          onChange={setPureGold}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-ink-secondary">{planLabel(draft)}</p>
      <button
        type="button"
        disabled={duplicate}
        onClick={() => onChange([...plans, draft])}
        className="tool-secondary-action mt-3 w-full"
      >
        {duplicate ? '方案已添加' : '添加生产方案'}
      </button>
      {plans.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label={`${layout.id} 已选生产方案`}>
          {plans.map((plan) => (
            <li key={planKey(plan)} className="tool-inset flex min-h-11 items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-xs leading-5 text-ink-secondary">{planLabel(plan)}</span>
              <button
                type="button"
                onClick={() => onChange(plans.filter((item) => !samePlan(item, plan)))}
                aria-label={`删除 ${layout.id} ${planLabel(plan)}`}
                className="tool-secondary-action min-h-11 shrink-0 border-error/40 bg-error/10 px-3 text-xs text-error hover:border-error/60 hover:bg-error/15 hover:text-error"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SelectField({
  id,
  label,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={id} className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2 text-xs text-ink-secondary">
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="tool-field tabular-nums"
      >
        {Array.from({ length: max + 1 }, (_, item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}

function CheckOption({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className={`tool-inset flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm transition-colors duration-150 ${checked ? 'border-brand-500/55 bg-brand-500/10 text-ink-primary' : 'text-ink-secondary hover:bg-surface-2'}`}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-brand-500" />
      {children}
    </label>
  )
}

function buildPlan(
  layout: { trading: number; manufacturing: number },
  orundum: number,
  originiumShard: number,
  pureGold: number,
): ScenarioProductionPlan {
  return {
    trading: { lmd: layout.trading - orundum, orundum },
    manufacturing: {
      pureGold,
      battleRecord: layout.manufacturing - originiumShard - pureGold,
      originiumShard,
    },
  }
}

function planLabel(plan: ScenarioProductionPlan): string {
  return `贸：币${plan.trading.lmd}/玉${plan.trading.orundum} · 制：赤${plan.manufacturing.pureGold}/经${plan.manufacturing.battleRecord}/碎${plan.manufacturing.originiumShard}`
}

function planKey(plan: ScenarioProductionPlan): string {
  return `${plan.trading.lmd}-${plan.trading.orundum}-${plan.manufacturing.pureGold}-${plan.manufacturing.battleRecord}-${plan.manufacturing.originiumShard}`
}

function samePlan(left: ScenarioProductionPlan, right: ScenarioProductionPlan): boolean {
  return planKey(left) === planKey(right)
}

function scheduleOrder(left: ScenarioMaaSchedule, right: ScenarioMaaSchedule): number {
  return ['variable', '8x3', '12x2'].indexOf(left) - ['variable', '8x3', '12x2'].indexOf(right)
}
