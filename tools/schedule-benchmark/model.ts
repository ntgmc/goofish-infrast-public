import { z } from 'zod'
import { scheduleProductionMetrics } from '../../src/lib/schedule-comparison'
import { recyclingSanity } from '../../src/lib/recycling'
import type { OptimizeResult } from '../../src/lib/types'

export const SITES = [
  { id: 'maatool', name: 'MaaTool', url: '', method: '完整自动排班' },
  { id: 'yituliu', name: '一图流 V3', url: 'https://ark.yituliu.cn/tools/scheduleV3', method: '深度排班' },
  { id: 'riic', name: '可露希尔', url: 'https://riic.autos/', method: '完整自动排班' },
] as const
export const SCENARIOS = [
  { id: 'S1', name: '243', products: '2 龙门币 · 2 赤金 + 2 经验', levels: '贸易 3/3；制造 3/3/3/3；发电 3/3/3' },
  { id: 'S2', name: '右满 252', products: '2 龙门币 · 2 赤金 + 3 经验', levels: '贸易 3/1；制造 2/2/3/3/2；发电 3/3' },
  { id: 'S3', name: '满血 252', products: '2 龙门币 · 2 赤金 + 3 经验', levels: '贸易 3/2；制造 3/3/3/3/3；发电 3/3' },
] as const
export const STATUS = { pending: '待测试', valid: '已核对有效', unconfirmed: '有效性待确认', invalid: '模拟无效', unsupported: '不支持', failed: '失败' } as const
export type Site = typeof SITES[number]['id']
export type Scenario = typeof SCENARIOS[number]['id']
const text = z.string().max(20_000)
const finite = z.number().finite()
const artifactSchema = z.object({ name: text, sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const metricsSchema = z.object({ lmd: finite, experience: finite, gold: finite, goldConsumed: finite, goldNet: finite, sanity: finite, recycling: finite })
const simulationSchema = artifactSchema.extend({ importedAt: text, valuation: text, metrics: metricsSchema, moodInvalid: z.boolean(), checks: z.array(text).max(100) })
const rowSchema = z.object({
  account: z.string(), scenario: z.enum(['S1', 'S2', 'S3']), site: z.enum(['maatool', 'yituliu', 'riic']),
  status: z.enum(['pending', 'valid', 'unconfirmed', 'invalid', 'unsupported', 'failed']),
  siteVersion: text, generatedAt: text, note: text, original: artifactSchema.nullable(), simulation: simulationSchema.nullable(),
})
const accountSchema = z.object({ id: z.string(), stage: z.enum(['pilot', 'formal']), note: text,
  snapshot: artifactSchema.extend({ owned: z.number().int().nonnegative(), elite2: z.number().int().nonnegative() }).nullable() })
const fixtureSchema = z.object({ confirmed: z.boolean(), note: text })
const stateSchema = z.object({
  format: z.literal('maatool-schedule-benchmark-v1'), createdAt: text, updatedAt: text,
  meta: z.object({ title: text, seed: text, poolSize: text, sampledAt: text, simulatorVersion: text, note: text }),
  fixtures: z.object({ S1: fixtureSchema, S2: fixtureSchema, S3: fixtureSchema }),
  accounts: z.array(accountSchema).length(12), rows: z.array(rowSchema).length(108),
})
export type State = z.infer<typeof stateSchema>
export type Row = z.infer<typeof rowSchema>
export type Simulation = z.infer<typeof simulationSchema>
export type Artifact = z.infer<typeof artifactSchema>
export type Metrics = z.infer<typeof metricsSchema>
export const STORAGE_KEY = 'maatool:schedule-benchmark:v1'

export function createState(): State {
  const now = new Date().toISOString()
  const accounts: State['accounts'] = Array.from({ length: 12 }, (_, i) => ({
    id: i < 2 ? `P0${i + 1}` : `A${String(i - 1).padStart(2, '0')}`,
    stage: i < 2 ? 'pilot' : 'formal', note: '', snapshot: null,
  }))
  return {
    format: 'maatool-schedule-benchmark-v1', createdAt: now, updatedAt: now,
    meta: { title: '三站基建排班对比', seed: '', poolSize: '', sampledAt: '', simulatorVersion: '', note: '' },
    fixtures: { S1: { confirmed: false, note: '' }, S2: { confirmed: false, note: '' }, S3: { confirmed: false, note: '' } },
    accounts, rows: accounts.flatMap(account => SCENARIOS.flatMap(scenario => SITES.map(site => ({
      account: account.id, scenario: scenario.id, site: site.id, status: 'pending' as const,
      siteVersion: '', generatedAt: '', note: '', original: null, simulation: null,
    })))),
  }
}

export function parseBackup(value: unknown): State {
  const parsed = stateSchema.safeParse(value)
  if (!parsed.success) throw new Error('备份格式无效，请选择工作台导出的 JSON 备份。')
  const state = parsed.data
  const template = createState()
  if (state.accounts.some((account, i) => account.id !== template.accounts[i].id || account.stage !== template.accounts[i].stage)) {
    throw new Error('备份的账号编号或试跑分组不符合本次协议。')
  }
  const keys = new Set(state.rows.map(rowKey))
  if (keys.size !== 108 || template.rows.some(row => !keys.has(rowKey(row)))) throw new Error('备份存在重复或缺失的测试组合。')
  if (state.rows.some(row => row.status === 'valid' && !row.simulation)) throw new Error('备份中的有效记录缺少模拟结果。')
  if (state.rows.some(row => row.status === 'valid' && row.simulation?.moodInvalid)) throw new Error('备份将心情无效的模拟结果标记为有效。')
  if (new Set(state.rows.flatMap(row => row.simulation ? [row.simulation.valuation] : [])).size > 1) throw new Error('备份混合了多个估值版本，请按批次分别保存。')
  return state
}

export function rowKey(row: Pick<Row, 'account' | 'scenario' | 'site'>): string {
  return `${row.account}-${row.scenario}-${row.site}`
}

const resources = z.record(z.string(), finite)
const dailySchema = z.object({
  manufacturing: resources, trading: resources, consumption: resources,
  net: resources.optional(), recycling: resources.optional(),
  hours: finite.optional(), source_hours: finite.optional(), normalization_factor: finite.optional(),
})
const roomSchema = z.object({ level: finite.optional(), facility_level: finite.optional(), product: z.string().optional() })
const planSchema = z.object({ mood_valid: z.boolean().optional(), mood_errors: z.array(z.unknown()).optional(),
  rooms: z.object({ trading: z.array(roomSchema), manufacture: z.array(roomSchema), power: z.array(roomSchema) }).optional(),
  shift_hours: finite.optional(), mood_assumptions: z.object({ cyclic_mood_simulation: z.boolean().optional() }).optional() })
const resultSchema = z.object({ daily_production: dailySchema, plans: z.array(planSchema).min(1), shift_hours: z.array(finite).optional() })

export function readSimulation(value: unknown, artifact: Artifact, valuation: string, scenario: Scenario): Simulation {
  const envelope = z.object({ result: z.unknown() }).safeParse(value)
  const parsed = resultSchema.safeParse(envelope.success ? envelope.data.result : value)
  if (!parsed.success) throw new Error('请选择含 daily_production 和 plans 的 MaaTool 完整模拟结果 JSON；MAA 执行文件不能用作评分结果。')
  const result = parsed.data
  const daily = result.daily_production
  if (daily.hours !== 24) throw new Error('结果未明确按 24 小时归一化，请导入 MaaTool 的日产量模拟结果。')
  if (!('LMD' in daily.trading) || !('Pure Gold' in daily.manufacturing) || !('Battle Record' in daily.manufacturing) || !('Pure Gold' in daily.consumption)) {
    throw new Error('结果缺少龙门币、经验或赤金产耗字段，不能将缺失数据当作零分。')
  }
  if ((daily.trading.Orundum ?? 0) !== 0 || (daily.manufacturing['Originium Shard'] ?? 0) !== 0) {
    throw new Error('本轮三个场景不包含搓玉，请核对导入的文件和场景。')
  }
  if ([...Object.values(daily.trading), ...Object.values(daily.manufacturing), ...Object.values(daily.consumption), ...Object.values(daily.recycling ?? {})].some(n => n < 0)) {
    throw new Error('产出或消耗存在负值，请检查模拟结果。')
  }
  const hours = result.plans.map((plan, i) => plan.shift_hours ?? result.shift_hours?.[i])
  if (hours.length !== 3 || hours.some(h => h !== 12)) throw new Error('本轮要求三班 12/12/12，请检查模拟结果的班次。')
  const expectedTrading = scenario === 'S1' ? [3, 3] : scenario === 'S2' ? [3, 1] : [3, 2]
  const expectedManufacturing = scenario === 'S1' ? [3, 3, 3, 3] : scenario === 'S2' ? [2, 2, 3, 3, 2] : [3, 3, 3, 3, 3]
  const checks: string[] = []
  for (const plan of result.plans) {
    if (!plan.rooms) continue
    const rooms = plan.rooms
    if (rooms.trading.length !== 2 || rooms.manufacture.length !== expectedManufacturing.length || rooms.power.length !== (scenario === 'S1' ? 3 : 2)) {
      throw new Error(`结果的设施数量不符合 ${scenario}，请检查所选场景。`)
    }
    for (const [entries, levels, products] of [
      [rooms.trading, expectedTrading, ['LMD', 'LMD']],
      [rooms.manufacture, expectedManufacturing, expectedManufacturing.map((_, i) => i < 2 ? 'Pure Gold' : 'Battle Record')],
    ] as const) {
      if (entries.some((room, i) => (room.level ?? room.facility_level) !== levels[i] || room.product !== products[i])) {
        throw new Error(`结果的设施等级或产物不符合 ${scenario} 的固定配置，请检查所选文件。`)
      }
    }
  }
  if (result.plans.some(plan => !plan.rooms)) checks.push('文件没有完整生产设施信息，请人工核对等级、产物和场景。')
  const metrics = scheduleProductionMetrics(result as unknown as OptimizeResult)!
  const moodInvalid = result.plans.some(plan => plan.mood_valid === false || (plan.mood_errors?.length ?? 0) > 0)
  if (moodInvalid) checks.push('模拟报告包含心情异常，不能作为有效方案进入排名。')
  if (result.plans.some(plan => plan.mood_valid === undefined)) checks.push('部分班次没有明确的心情有效性结果。')
  if (!result.plans.some(plan => plan.mood_assumptions?.cyclic_mood_simulation)) checks.push('文件未明确记录循环心情模拟，请人工核对。')
  return { ...artifact, importedAt: new Date().toISOString(), valuation,
    metrics: metricsSchema.parse({ ...metrics, recycling: recyclingSanity(daily.recycling) }), moodInvalid, checks }
}

export function readOperators(value: unknown) {
  const parsed = z.array(z.object({ id: z.string().min(1), own: z.boolean(), elite: z.number().int().min(0).max(2) })).min(1).safeParse(value)
  if (!parsed.success) throw new Error('请选择后台“下载干员 JSON”得到的干员数组。')
  if (new Set(parsed.data.map(operator => operator.id)).size !== parsed.data.length) throw new Error('干员文件有重复的干员 ID。')
  const owned = parsed.data.filter(operator => operator.own)
  if (!owned.length) throw new Error('文件没有已持有干员。')
  return { owned: owned.length, elite2: owned.filter(operator => operator.elite === 2).length }
}

export function compare(score: number, baseline: number) {
  if (baseline <= 0) return null
  const delta = (score - baseline) / baseline * 100
  return { delta, label: score > baseline * 1.01 ? '领先' : score < baseline * 0.99 ? '落后' : '接近' }
}

export function comparison(state: State, account: string, scenario: Scenario, opponent: Site | 'best' = 'best') {
  if (!state.fixtures[scenario].confirmed || !state.meta.simulatorVersion.trim()) return null
  const rows = state.rows.filter(row => row.account === account && row.scenario === scenario)
  const own = rows.find(row => row.site === 'maatool')
  const rivals = rows.filter(row => row.site !== 'maatool' && (opponent === 'best' || row.site === opponent))
  if (!own?.simulation || own.status !== 'valid' || own.simulation.moodInvalid || rivals.some(row => row.status !== 'valid' || !row.simulation || row.simulation.moodInvalid)) return null
  if (rivals.some(row => row.simulation!.valuation !== own.simulation!.valuation)) return null
  return compare(own.simulation.metrics.sanity, Math.max(...rivals.map(row => row.simulation!.metrics.sanity)))
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summary(state: State, scenario: Scenario, opponent: Site | 'best' = 'best') {
  const results = state.accounts.filter(account => account.stage === 'formal')
    .map(account => comparison(state, account.id, scenario, opponent)).filter(result => result !== null)
  return { count: results.length, median: median(results.map(result => result.delta)),
    wins: results.filter(result => result.label === '领先').length, ties: results.filter(result => result.label === '接近').length,
    losses: results.filter(result => result.label === '落后').length }
}

export function format(value: number | null | undefined, percent = false): string {
  if (value == null) return '—'
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2, signDisplay: percent ? 'exceptZero' : 'auto' })}${percent ? '%' : ''}`
}

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : (/^\s*[=+@-]/.test(value) ? `'${value}` : value)
  return `"${text.replaceAll('"', '""')}"`
}

export function exportCsv(state: State): string {
  const header = ['账号', '分组', '配置', '站点', '状态', '站点版本', '生成时间', '模拟器版本', '估值版本', '净等效理智/日', '龙门币/日', '经验/日', '赤金产出/日', '赤金消耗/日', '赤金净变化/日', '回收站理智/日', '配置已确认', '原始文件', '原始SHA256', '模拟文件', '模拟SHA256', '备注']
  const lines = state.rows.map(row => {
    const m = row.simulation?.metrics
    return [row.account, state.accounts.find(account => account.id === row.account)!.stage === 'pilot' ? '试跑' : '正式',
      SCENARIOS.find(scenario => scenario.id === row.scenario)!.name, SITES.find(site => site.id === row.site)!.name,
      STATUS[row.status], row.siteVersion, row.generatedAt, state.meta.simulatorVersion, row.simulation?.valuation ?? '',
      m?.sanity ?? '', m?.lmd ?? '', m?.experience ?? '', m?.gold ?? '', m?.goldConsumed ?? '', m?.goldNet ?? '', m?.recycling ?? '',
      state.fixtures[row.scenario].confirmed ? '是' : '否', row.original?.name ?? '', row.original?.sha256 ?? '',
      row.simulation?.name ?? '', row.simulation?.sha256 ?? '', row.note]
  })
  return '\uFEFF' + [header, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n')
}

function md(value: string): string { return value.replace(/[\\`*_{}\[\]<>|]/g, '\\$&').replace(/\r?\n/g, ' / ') }

export function exportReport(state: State): string {
  const formal = state.rows.filter(row => row.account.startsWith('A'))
  const lines = [`# ${md(state.meta.title)}`, '', `生成时间：${new Date().toISOString()}`, '',
    '## 方法', '', '样本来自 MaaTool 后台随机抽取的 10 个游戏账号；另有 2 个试跑账号不计入正式成绩。每组合生成一次，由 MaaTool 模拟并按 24 小时归一化。换班采用 12/12/12，周期 36 小时。', '',
    '主指标为净等效理智/日，使用 MaaTool 现有估值代码。±1% 内标为接近；此阈值不是统计显著性或模型误差范围。结果只代表本批样本及模型口径。', '',
    `抽样种子：${md(state.meta.seed) || '未填写'}；候选数量：${md(state.meta.poolSize) || '未填写'}；抽样时间：${md(state.meta.sampledAt) || '未填写'}。`,
    `模拟器版本：${md(state.meta.simulatorVersion) || '未填写（汇总暂不计入）'}。`, '',
    `正式组合：90；已记录：${formal.filter(row => row.status !== 'pending').length}；标记有效：${formal.filter(row => row.status === 'valid' && row.simulation).length}。`, '',
    '## 各配置汇总', '', '| 配置 | 对照 | 可比较账号 / 10 | 领先 | 接近 | 落后 | 提升中位数 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |']
  for (const scenario of SCENARIOS) for (const opponent of ['yituliu', 'riic', 'best'] as const) {
    const s = summary(state, scenario.id, opponent)
    lines.push(`| ${scenario.name} | ${opponent === 'best' ? '两站较优（两站均有效）' : SITES.find(site => site.id === opponent)!.name} | ${s.count} | ${s.wins} | ${s.ties} | ${s.losses} | ${format(s.median, true)} |`)
  }
  lines.push('', '## 样本登记', '', '| 账号 | 已持有 | 精二 | 干员快照 | SHA-256 | 说明 |', '| --- | ---: | ---: | --- | --- | --- |')
  for (const account of state.accounts.filter(account => account.stage === 'formal')) {
    lines.push(`| ${account.id} | ${account.snapshot?.owned ?? '—'} | ${account.snapshot?.elite2 ?? '—'} | ${md(account.snapshot?.name ?? '未登记')} | ${account.snapshot?.sha256 ?? '—'} | ${md(account.note)} |`)
  }
  lines.push('', '## 版本记录', '')
  for (const site of SITES) {
    const versions = [...new Set(formal.filter(row => row.site === site.id).map(row => row.siteVersion.trim()).filter(Boolean))]
    lines.push(`- ${site.name}：${versions.map(md).join('、') || '未填写'}。`)
  }
  lines.push(`- 估值代码指纹：${[...new Set(formal.flatMap(row => row.simulation ? [row.simulation.valuation] : []))].map(md).join('、') || '尚未导入结果'}。`)
  lines.push('', '## 配置与运行条件', '')
  for (const scenario of SCENARIOS) lines.push(`- ${scenario.id} ${scenario.name}：${scenario.products}；${scenario.levels}。配置核对：${state.fixtures[scenario.id].confirmed ? '已确认' : '待确认'}。${md(state.fixtures[scenario.id].note)}`)
  lines.push('', '允许正常恢复的无人机、已解锁的菲亚梅塔、无专精时训练室两个工位及三级回收站；宿舍等级、氛围与设施位置以配置快照为准。不得人工优化自动生成方案。', '', '## 全部正式结果', '',
    '| 账号 | 配置 | 站点 | 状态 | 净理智/日 | 龙门币/日 | 经验/日 | 赤金净变化/日 | 回收站理智/日 | 备注 |', '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |')
  for (const row of formal) {
    const m = row.simulation?.metrics
    lines.push(`| ${row.account} | ${row.scenario} | ${SITES.find(site => site.id === row.site)!.name} | ${STATUS[row.status]} | ${format(m?.sanity)} | ${format(m?.lmd)} | ${format(m?.experience)} | ${format(m?.goldNet)} | ${format(m?.recycling)} | ${md(row.note)} |`)
  }
  lines.push('', '## 状态统计', '', '| 站点 | 待测试 | 有效 | 待确认 | 无效 | 不支持 | 失败 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const site of SITES) lines.push(`| ${site.name} | ${Object.keys(STATUS).map(status => formal.filter(row => row.site === site.id && row.status === status).length).join(' | ')} |`)
  lines.push('', '## 差距分析', '', '填写代表性的领先、接近、落后案例，说明具体房间、干员组合、无人机及恢复安排。', '',
    '## 未确认事项与结论范围', '', '尚未完成或不具备可比条件的记录不进入收益汇总，完整状态保留在附表。仅进行单次生成，不据此评价生成波动；未进行游戏内实机验证。', '', md(state.meta.note), '', '## 证据文件', '',
    '原始方案、模拟 JSON、干员快照及配置截图须另行归档；工作台备份保存文件名、SHA-256、评分和备注，不包含原始文件内容。', '')
  return lines.join('\n')
}
