import { materialDemandCopy as text } from '../copy/zh-CN/material-demand'

export type MaterialDemandEvent = { id: string; name: string; date: string; rarity: number; amounts: number[] }
export type MaterialDemandSnapshot = {
  version: number; asOf: string; gameSha: string; releaseDatesSha256: string
  materials: { id: string; name: string; icon: string }[]
  operators: MaterialDemandEvent[]; modules: MaterialDemandEvent[]
}
export type MaterialDemandMetric = 'amount' | 'share'
export type MaterialDemandMonth = {
  month: string; partial: boolean; operatorCount: number; moduleCount: number
  operators: number[]; modules: number[]; total: number
}
export type MaterialDemandPoint = {
  month: string; raw: number | null; value: number | null; operators: number | null; modules: number | null
  operatorCount: number; moduleCount: number
}

export function materialDemandMonths(data: MaterialDemandSnapshot): MaterialDemandMonth[] {
  const start = [...data.operators, ...data.modules].reduce((first, row) => row.date < first ? row.date : first, data.asOf).slice(0, 7)
  const months: MaterialDemandMonth[] = []
  const asOfMonth = data.asOf.slice(0, 7)
  const nextDay = new Date(`${data.asOf}T00:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  for (let month = start; month <= asOfMonth;) {
    months.push({ month, partial: month === asOfMonth && nextDay.toISOString().slice(0, 7) === month,
      operatorCount: 0, moduleCount: 0, operators: data.materials.map(() => 0), modules: data.materials.map(() => 0), total: 0 })
    const next = new Date(`${month}-01T00:00:00Z`)
    next.setUTCMonth(next.getUTCMonth() + 1)
    month = next.toISOString().slice(0, 7)
  }
  const byMonth = new Map(months.map((row) => [row.month, row]))
  for (const kind of ['operators', 'modules'] as const) {
    for (const event of data[kind]) {
      if (event.date > data.asOf) continue
      const month = byMonth.get(event.date.slice(0, 7))!
      if (kind === 'operators') month.operatorCount++
      else month.moduleCount++
      event.amounts.forEach((amount, index) => { month[kind][index] += amount; month.total += amount })
    }
  }
  return months
}

export function materialDemandSeries(months: MaterialDemandMonth[], materialIndex: number, metric: MaterialDemandMetric, window: number): MaterialDemandPoint[] {
  return months.map((row, index) => {
    const sample = months.slice(Math.max(0, index - window + 1), index + 1)
    const complete = sample.length === window && sample.every((month) => !month.partial)
    const total = sample.reduce((sum, month) => sum + month.total, 0)
    const operatorAmount = sample.reduce((sum, month) => sum + month.operators[materialIndex], 0)
    const moduleAmount = sample.reduce((sum, month) => sum + month.modules[materialIndex], 0)
    const divisor = metric === 'share' ? total / 100 : window
    const convert = (amount: number) => complete ? divisor > 0 ? amount / divisor : metric === 'share' ? null : 0 : null
    const operators = convert(operatorAmount), modules = convert(moduleAmount)
    return { month: row.month, raw: metric === 'share' ? row.total > 0 ? (row.operators[materialIndex] + row.modules[materialIndex]) / row.total * 100 : null : row.operators[materialIndex] + row.modules[materialIndex],
      value: operators === null || modules === null ? null : operators + modules, operators, modules,
      operatorCount: sample.reduce((sum, month) => sum + month.operatorCount, 0), moduleCount: sample.reduce((sum, month) => sum + month.moduleCount, 0) }
  })
}

export function materialDemandChartMax(points: MaterialDemandPoint[], { share = false, rawPoints = false, fullScale = false } = {}): number {
  const values = points.flatMap((point) => [point.value ?? 0, rawPoints ? point.raw ?? 0 : 0]).filter((value) => value > 0).sort((a, b) => a - b)
  const highest = values[values.length - 1] ?? 0
  const typical = values[Math.ceil(values.length * 0.95) - 1] ?? 0
  const ceiling = fullScale ? highest : Math.max(0, ...values.filter((value) => value <= typical * 1.5))
  return Math.max(share ? 1 : 5, ceiling) * 1.08
}

export function materialDemandCsv(data: MaterialDemandSnapshot, months: MaterialDemandMonth[]): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const rows: Array<Array<string | number>> = [[...text.csvColumns]]
  for (const month of months) data.materials.forEach((item, index) => {
    const total = month.operators[index] + month.modules[index]
    rows.push([month.month, month.partial ? text.partialMonth : text.completeMonth, item.id, item.name, month.operators[index], month.modules[index], total,
      month.total > 0 ? total / month.total * 100 : '', month.operatorCount, month.moduleCount])
  })
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}
