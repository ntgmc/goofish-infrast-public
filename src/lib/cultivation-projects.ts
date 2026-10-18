import type { CultivationCurrent, CultivationData } from './cultivation-contract'
import { allocateCultivationMaterials } from './cultivation-planner'
import type { DailyProduction, LicenseConfig } from './types'
import { normalizeConfig, validateScheduleConfig } from './config'

export type CultivationProject = {
  operatorId: string
  elite: number
  level: number
  skill: number
  skillLevel: number
  paused: boolean
  deadline: string
}
export type ProjectOperator = { id: string; name: string; rarity: number; skills: string[]; maxLevels: number[]; current: CultivationCurrent }
export type ProjectIncome = { lmd: number; exp: number; goldNet: number | null }
export type ProjectSettings = { startDate: string; dailySanity: number; days: number; allOpen: boolean }
const dayMs = 86400000
const epsilon = 1e-8

export function readProjectIncome(daily: DailyProduction | undefined): ProjectIncome | null {
  if (!daily || !daily.trading || !daily.manufacturing) return null
  const lmd = daily.net?.LMD ?? (daily.trading.LMD ?? 0) - (daily.consumption?.LMD ?? 0)
  const exp = (daily.manufacturing['Battle Record'] ?? 0) * 1000
  const goldNet = daily.net?.['Pure Gold'] ?? null
  if (![lmd, exp].every((value) => Number.isFinite(value) && value >= 0) || goldNet !== null && !Number.isFinite(goldNet)) return null
  return { lmd, exp, goldNet }
}

export function prepareProjectProduction(config: LicenseConfig, focus: 'exp' | '4001'): LicenseConfig | null {
  const next = normalizeConfig(config)
  const factories = next.product_requirements.manufacturing_stations
  const from = focus === 'exp' ? 'Pure Gold' : 'Battle Record'
  const to = focus === 'exp' ? 'Battle Record' : 'Pure Gold'
  if (!(factories[from] > 0) || !(next.product_requirements.trading_stations.LMD > 0)) return null
  factories[from] -= 1
  factories[to] = (factories[to] ?? 0) + 1
  next.allow_product_rebalance = false
  return validateScheduleConfig(next).ok ? next : null
}

export function isCultivationProject(value: unknown): value is CultivationProject {
  if (!value || typeof value !== 'object') return false
  const row = value as CultivationProject
  return typeof row.operatorId === 'string' && row.operatorId.length > 0 && row.operatorId.length <= 128
    && Number.isInteger(row.elite) && row.elite >= 0 && row.elite <= 2
    && Number.isInteger(row.level) && row.level >= 1 && row.level <= 90
    && Number.isInteger(row.skill) && row.skill >= 1 && row.skill <= 3
    && Number.isInteger(row.skillLevel) && row.skillLevel >= 1 && row.skillLevel <= 10
    && typeof row.paused === 'boolean' && typeof row.deadline === 'string'
    && (row.deadline === '' || validProjectDate(row.deadline))
}

export function validProjectDate(date: string): boolean {
  const stamp = Date.parse(`${date}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date
}

export function allocateProjectMaterials(data: CultivationData, projects: CultivationProject[]) {
  const active = projects.filter((project) => !project.paused)
  let stock = { ...data.inventory }
  return active.map((project) => {
    const candidate = data.candidates.find((row) => row.operatorId === project.operatorId)
    // A changed target must be refreshed before its old costs can produce a date.
    const matches = candidate && candidate.target.elite === project.elite && candidate.target.level === project.level
      && candidate.target.skill === project.skill && candidate.target.skillLevel === project.skillLevel
    const allocation = matches ? allocateCultivationMaterials(candidate.items, stock, data) : null
    if (allocation) stock = allocation.stock
    return { project, candidate: matches ? candidate : undefined, allocation }
  })
}

export function buildProjectRoute(data: CultivationData, projects: CultivationProject[], settings: ProjectSettings, normal: ProjectIncome | null, temporary: ProjectIncome | null = null) {
  if (!validProjectDate(settings.startDate) || !Number.isInteger(settings.days) || settings.days < 1 || settings.days > 180
    || !Number.isInteger(settings.dailySanity) || settings.dailySanity < 0 || settings.dailySanity > 2000) throw new Error('invalid_project_settings')
  const rows = allocateProjectMaterials(data, projects).map((row) => ({ ...row, estimatedDate: null as string | null }))
  const tasks = rows.flatMap((row) => Object.entries(row.allocation?.missing ?? {}).map(([item, quantity]) => ({ operatorId: row.project.operatorId, item, quantity, remaining: quantity })))
  const missing: Record<string, number> = {}
  for (const task of tasks) missing[task.item] = (missing[task.item] ?? 0) + task.quantity
  const waitingDays = (item: string, rate: number) => (missing[item] ?? 0) <= epsilon ? 0 : rate > 0 ? (missing[item] ?? 0) / rate : Infinity
  const focus: 'exp' | '4001' = waitingDays('exp', normal?.exp ?? 0) >= waitingDays('4001', normal?.lmd ?? 0) ? 'exp' : '4001'
  const phases: Array<{ date: string; temporary: boolean; income: Record<string, number>; farms: Array<{ item: string; stage: string; runs: number; quantity: number }>; spent: number }> = []
  const supplied: Record<string, number> = {}
  const farmed: Record<string, number> = {}
  let gold = Math.max(0, data.inventory['3003'] ?? 0)
  let goldLimited = false
  let switchDate: string | null = null
  const consume = (item: string, quantity: number) => {
    let available = quantity
    for (const task of tasks) {
      if (task.item !== item) continue
      const amount = Math.min(task.remaining, available)
      task.remaining -= amount
      available -= amount
      if (available <= epsilon) break
    }
    return quantity - available
  }
  const remainingFor = (item: string) => tasks.filter((task) => task.item === item).reduce((sum, task) => sum + task.remaining, 0)
  const markReady = (date: string) => {
    for (const row of rows) if (!row.estimatedDate && row.candidate && !row.candidate.warnings.length
      && tasks.every((task) => task.operatorId !== row.project.operatorId || task.remaining <= epsilon)) row.estimatedDate = date
  }
  markReady(settings.startDate)
  const start = Date.parse(`${settings.startDate}T00:00:00Z`)
  for (let index = 0; index < settings.days && tasks.some((task) => task.remaining > epsilon); index++) {
    const date = new Date(start + index * dayMs).toISOString().slice(0, 10)
    const weekday = new Date(start + index * dayMs).getUTCDay() || 7
    const useTemporary = Boolean(temporary && remainingFor(focus) > epsilon)
    if (temporary && !useTemporary && !switchDate) switchDate = date
    const income = (useTemporary ? temporary : normal) ?? { lmd: 0, exp: 0, goldNet: null }
    // Negative gold balance is a stock-limited burst, not a perpetual LMD income.
    const fraction = income.goldNet !== null && income.goldNet < 0 ? Math.min(1, gold / -income.goldNet) : 1
    if (fraction < 1) goldLimited = true
    if (income.goldNet !== null) gold = Math.max(0, gold + income.goldNet)
    const produced = { exp: consume('exp', income.exp), '4001': consume('4001', income.lmd * fraction) }
    for (const [item, quantity] of Object.entries(produced)) supplied[item] = (supplied[item] ?? 0) + quantity
    let budget = settings.dailySanity
    const farms: (typeof phases)[number]['farms'] = []
    // Prepare unavailable-to-base materials first; spare sanity may accelerate currencies.
    const ordered = [...tasks].sort((a, b) => Number(a.item === 'exp' || a.item === '4001') - Number(b.item === 'exp' || b.item === '4001'))
    for (const task of ordered) {
      if (task.remaining <= epsilon) continue
      const farm = (data.farms[task.item] ?? []).filter((farm) => settings.allOpen || farm.days.includes(weekday))
        .sort((a, b) => a.sanity / a.quantity - b.sanity / b.quantity)[0]
      if (!farm) continue
      const runs = Math.min(Math.ceil((task.remaining - epsilon) / farm.quantity), Math.floor(budget / farm.sanity))
      if (runs <= 0) continue
      budget -= runs * farm.sanity
      farmed[task.item] = (farmed[task.item] ?? 0) + consume(task.item, runs * farm.quantity)
      const existing = farms.find((row) => row.item === task.item && row.stage === farm.stage)
      if (existing) { existing.runs += runs; existing.quantity += runs * farm.quantity }
      else farms.push({ item: task.item, stage: farm.stage, runs, quantity: runs * farm.quantity })
    }
    markReady(date)
    phases.push({ date, temporary: useTemporary, income: produced, farms, spent: settings.dailySanity - budget })
    if (temporary && !switchDate && remainingFor(focus) <= epsilon) switchDate = new Date(start + (index + 1) * dayMs).toISOString().slice(0, 10)
  }
  const remaining = tasks.filter((task) => task.remaining > epsilon)
  const blocked = remaining.filter((task) => !data.farms[task.item]?.length && !(task.item === 'exp' && (normal?.exp || temporary?.exp) || task.item === '4001' && (normal?.lmd || temporary?.lmd)))
  return { rows, missing, focus, phases, supplied, farmed, remaining, blocked, goldLimited, switchDate,
    readyDate: rows.length && rows.every((row) => row.estimatedDate) ? rows.reduce((last, row) => row.estimatedDate! > last ? row.estimatedDate! : last, settings.startDate) : null }
}

export function projectDaysEarlier(before: string | null, after: string | null): number | null {
  return before && after ? Math.round((Date.parse(before) - Date.parse(after)) / dayMs) : null
}

export type ProjectRoute = ReturnType<typeof buildProjectRoute>
