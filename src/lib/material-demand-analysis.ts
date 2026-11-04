import { materialDemandCopy as text } from '../copy/zh-CN/material-demand'
import type { MaterialDemandMonth, MaterialDemandOrigin, MaterialDemandSnapshot } from './material-demand'

export type MaterialDemandPeriod = {
  start: string | null; end: string | null; months: number; operators: number; modules: number; total: number
  share: number | null; origins: Record<MaterialDemandOrigin, number>
}
export type MaterialDemandAnalysis = {
  id: string; firstDemand: string | null; comparable: boolean
  recent: MaterialDemandPeriod; previous: MaterialDemandPeriod
  change: number | null; shareChange: number | null; halfYearChange: number | null
  contributors: { id: string; name: string; month: string; source: 'operators' | 'modules'; amount: number }[]
  peak: { month: string; amount: number } | null
}

export function materialDemandAnalysis(data: MaterialDemandSnapshot, months: MaterialDemandMonth[]): MaterialDemandAnalysis[] {
  const complete = months.filter((month) => !month.partial)
  const recentMonths = complete.slice(-12), previousMonths = complete.slice(-24, -12)
  const events = [ ...data.operators.map((row) => ({ ...row, source: 'operators' as const })), ...data.modules.map((row) => ({ ...row, source: 'modules' as const })) ]
  return data.materials.map((material, index) => {
    const firstDemand = months.find((month) => month.operators[index] + month.modules[index] > 0)?.month ?? null
    const recent = period(data, recentMonths, index), previous = period(data, previousMonths, index)
    const comparable = recent.months === 12 && previous.months === 12 && firstDemand !== null && firstDemand <= previous.start!
    const currentHalf = period(data, complete.slice(-6), index), previousHalf = period(data, complete.slice(-12, -6), index)
    const halfYearChange = currentHalf.months === 6 && previousHalf.months === 6 && firstDemand !== null && firstDemand <= previousHalf.start! ? relativeChange(currentHalf.total, previousHalf.total) : null
    const contributors = events.filter((row) => row.date <= data.asOf && recent.start !== null && row.date.slice(0, 7) >= recent.start && row.date.slice(0, 7) <= recent.end! && row.amounts[index] > 0)
      .map((row) => ({ id: row.id, name: row.name, month: row.date.slice(0, 7), source: row.source, amount: row.amounts[index] }))
      .sort((a, b) => b.amount - a.amount).slice(0, 3)
    const peak = recentMonths.map((row) => ({ month: row.month, amount: row.operators[index] + row.modules[index] })).sort((a, b) => b.amount - a.amount)[0]
    return { id: material.id, firstDemand, comparable, recent, previous,
      change: comparable ? relativeChange(recent.total, previous.total) : null,
      shareChange: comparable && recent.share !== null && previous.share !== null ? recent.share - previous.share : null,
      halfYearChange, contributors, peak: peak?.amount > 0 ? peak : null }
  })
}

function relativeChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous * 100 : null
}

function period(data: MaterialDemandSnapshot, months: MaterialDemandMonth[], index: number): MaterialDemandPeriod {
  const start = months[0]?.month ?? null, end = months[months.length - 1]?.month ?? null
  const operators = months.reduce((sum, row) => sum + row.operators[index], 0)
  const modules = months.reduce((sum, row) => sum + row.modules[index], 0)
  const all = months.reduce((sum, row) => sum + row.total, 0)
  const origins = { direct: 0, purple: 0, gold: 0 }
  for (const row of [...data.operators, ...data.modules]) {
    if (start === null || row.date > data.asOf || row.date.slice(0, 7) < start || row.date.slice(0, 7) > end!) continue
    for (const origin of ['direct', 'purple', 'gold'] as const) origins[origin] += row.origins[origin][index]
  }
  return { start, end, months: months.length, operators, modules, total: operators + modules, share: all > 0 ? (operators + modules) / all * 100 : null, origins }
}

export function materialDemandAnalysisCsv(data: MaterialDemandSnapshot, analyses: MaterialDemandAnalysis[]): string {
  const cell = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows: (string | number | null)[][] = [[...text.analysis.csvColumns]]
  analyses.forEach((row, index) => rows.push([row.id, data.materials[index].name, row.firstDemand, row.recent.start, row.recent.end, row.previous.start, row.previous.end,
    row.comparable ? text.analysis.comparable : row.firstDemand ? text.analysis.shortHistory : text.analysis.noDemand, row.recent.total, row.previous.total, row.change,
    row.recent.share, row.previous.share, row.shareChange, row.halfYearChange,
    row.recent.operators, row.previous.operators, row.recent.modules, row.previous.modules,
    row.recent.origins.direct, row.previous.origins.direct, row.recent.origins.purple, row.previous.origins.purple, row.recent.origins.gold, row.previous.origins.gold]))
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}
