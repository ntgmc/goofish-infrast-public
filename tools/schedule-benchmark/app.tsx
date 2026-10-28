import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SITES, SCENARIOS, STATUS, STORAGE_KEY, createState, parseBackup, rowKey, readSimulation, readOperators, comparison, summary, format, exportCsv, exportReport } from './model'
import type { State, Row, Scenario, Artifact } from './model'
import './style.css'

const valuation = document.documentElement.dataset.valuation ?? 'development'
function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return { state: saved ? parseBackup(JSON.parse(saved)) : createState(), error: '', writable: true }
  } catch {
    return { state: createState(), error: '本地记录无法读取，已暂停自动保存。请先下载原始存储，再恢复有效备份。', writable: false }
  }
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function backup(state: State) { download('maatool-benchmark-backup.json', JSON.stringify(state, null, 2), 'application/json') }
async function readFile(file: File): Promise<{ value: unknown; artifact: Artifact }> {
  if (file.size > 20_000_000) throw new Error('文件超过 20 MB，请选择单份 JSON 文件。')
  const bytes = await file.arrayBuffer()
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('JSON 无法解析，请检查文件是否完整。') }
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return { value, artifact: { name: file.name, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') } }
}
function Upload({ children, onFile, disabled = false }: { children: React.ReactNode; onFile: (file: File) => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="upload"><label className={`button secondary ${busy || disabled ? 'disabled' : ''}`}>
    {busy ? '读取中…' : children}<input type="file" accept=".json,application/json" disabled={busy || disabled} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      setBusy(true); setError('')
      try { await onFile(file) } catch (cause) { setError(cause instanceof Error ? cause.message : '文件读取失败。') }
      finally { setBusy(false) }
    }} /></label>{error && <p role="alert" className="error">{error}</p>}</div>
}
function Field({ label, value, onChange, multiline = false, placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  return <label className="field"><span>{label}</span>{multiline ? <textarea value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    : <input value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}</label>
}
function App() {
  const [initial] = useState(load)
  const [state, setState] = useState(initial.state)
  const [writable, setWritable] = useState(initial.writable)
  const [notice, setNotice] = useState(initial.error)
  const [tab, setTab] = useState('record')
  const [accountId, setAccountId] = useState('P01')
  const [scenarioId, setScenarioId] = useState<Scenario>('S1')
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  useEffect(() => {
    if (!writable) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setNotice('已保存到当前浏览器') }
    catch { setNotice('浏览器保存失败，当前内容仍在页面中。请立即导出 JSON 备份。') }
  }, [state, writable])
  function commit(update: (current: State) => State) {
    setState(current => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }
  function updateRow(key: string, update: Partial<Row>) {
    if (update.simulation && state.rows.some(row => row.simulation && row.simulation.valuation !== update.simulation!.valuation)) {
      throw new Error('本批记录使用另一估值版本，请使用原 HTML 工作台继续，避免混合评分口径。')
    }
    commit(current => ({ ...current, rows: current.rows.map(row => rowKey(row) === key ? { ...row, ...update } : row) }))
  }
  const formal = state.rows.filter(row => row.account.startsWith('A'))
  const completed = formal.filter(row => row.status !== 'pending').length
  const valid = formal.filter(row => row.status === 'valid' && row.simulation).length
  const comparable = SCENARIOS.reduce((sum, scenario) => sum + summary(state, scenario.id).count, 0)
  const account = state.accounts.find(item => item.id === accountId)!
  const scenario = SCENARIOS.find(item => item.id === scenarioId)!
  const rows = state.rows.filter(row => row.account === accountId && row.scenario === scenarioId)
  const fixture = state.fixtures[scenarioId]
  function nextCase() {
    const currentIndex = state.accounts.findIndex(item => item.id === accountId) * 3 + SCENARIOS.findIndex(item => item.id === scenarioId)
    for (let offset = 1; offset <= 36; offset++) {
      const index = (currentIndex + offset) % 36
      const candidateAccount = state.accounts[Math.floor(index / 3)].id
      const candidateScenario = SCENARIOS[index % 3].id
      if (state.rows.some(row => row.account === candidateAccount && row.scenario === candidateScenario && row.status === 'pending')) {
        setAccountId(candidateAccount); setScenarioId(candidateScenario); return
      }
    }
    setNotice('全部组合均已记录，可前往结果汇总检查。')
  }
  return <>
    <header className="masthead"><div><span className="eyebrow">MAATOOL / BENCHMARK</span><h1>三站排班测试工作台</h1><p>逐项记录，统一评分，让每个结论都能追溯到原始方案。</p></div>
      <span className="local-badge">本地保存 · 离线可用</span></header>
    <main>
      <div className="toolbar"><div className="actions"><button onClick={() => backup(state)}>导出 JSON 备份</button>
        <Upload onFile={async file => {
          const { value } = await readFile(file)
          const restored = parseBackup(value)
          if (!window.confirm('恢复备份将替换当前记录。确认前请先导出当前 JSON 备份。')) return
          localStorage.setItem(STORAGE_KEY, JSON.stringify(restored))
          setState(restored); setWritable(true); setNotice('备份已恢复')
        }}>恢复备份</Upload>
        <button className="secondary" onClick={() => download('maatool-benchmark-results.csv', exportCsv(state), 'text/csv;charset=utf-8')}>导出 CSV</button>
        <button className="secondary" onClick={() => download('maatool-benchmark-report.md', exportReport(state), 'text/markdown;charset=utf-8')}>导出报告草稿</button></div>
        <p className={writable ? 'save-status' : 'error'} role="status">{notice || '导入文件仅在本机处理；请定期导出备份。'}</p>
        {!writable && <button className="secondary" onClick={() => {
          try { download('benchmark-unreadable-storage.txt', localStorage.getItem(STORAGE_KEY) ?? '', 'text/plain') }
          catch { setNotice('浏览器禁止读取存储，请检查浏览器设置。') }
        }}>下载原始存储</button>}
      </div>
      <div className="stats"><div><span>正式组合已记录</span><strong>{completed}<small> / 90</small></strong></div><div><span>已核对有效</span><strong>{valid}</strong></div><div><span>三站可比较场景</span><strong>{comparable}<small> / 30</small></strong></div><div><span>固定换班周期</span><strong>12 / 12 / 12<small> 小时</small></strong></div></div>
      <nav className="tabs" aria-label="工作台页面">{[['record', '测试记录'], ['results', '结果汇总'], ['protocol', '协议与环境']].map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {tab === 'record' && <div className="workspace">
        <aside className="panel accounts"><div className="section-heading"><h2>测试账号</h2><label className="compact"><input type="checkbox" checked={filter === 'pending'} onChange={event => setFilter(event.target.checked ? 'pending' : 'all')} />仅待测</label></div>
          {(['pilot', 'formal'] as const).map(stage => <div key={stage}><p className="group-label">{stage === 'pilot' ? '试跑 · 不计入正式成绩' : '正式 · 随机抽取'}</p>
            {state.accounts.filter(item => item.stage === stage).map(item => {
              const done = state.rows.filter(row => row.account === item.id && row.status !== 'pending').length
              if (filter === 'pending' && done === 9 && item.id !== accountId) return null
              return <button className={`account ${item.id === accountId ? 'selected' : ''}`} key={item.id} aria-pressed={item.id === accountId} onClick={() => setAccountId(item.id)}>
                <span>{item.id}<small>{item.snapshot ? `${item.snapshot.owned} 已持有 · ${item.snapshot.elite2} 精二` : '未登记干员快照'}</small></span><span>{done}/9</span></button>
            })}</div>)}
        </aside>
        <section className="case-workspace" aria-label="当前测试组合"><div className="panel account-detail"><div className="section-heading"><div><span className="eyebrow">{account.stage === 'pilot' ? 'PILOT / 试跑' : 'FORMAL / 正式'}</span><h2>{accountId} 干员快照</h2></div>
          <Upload key={accountId} onFile={async file => {
            const { value, artifact } = await readFile(file)
            const counts = readOperators(value)
            if (state.accounts.some(item => item.id !== accountId && item.snapshot?.sha256 === artifact.sha256)) throw new Error('此文件已登记到另一账号，请检查重复样本。')
            const changed = account.snapshot && account.snapshot.sha256 !== artifact.sha256
            if (changed && !window.confirm('替换快照会将该账号已有结果改为待确认，指标和证据保留。确认替换？')) return
            commit(current => ({ ...current,
              accounts: current.accounts.map(item => item.id === accountId ? { ...item, snapshot: { ...artifact, ...counts } } : item),
              rows: changed ? current.rows.map(row => row.account === accountId && row.simulation ? { ...row, status: 'unconfirmed' } : row) : current.rows,
            }))
          }}>登记干员 JSON</Upload></div>
          {account.snapshot && <p className="file-info">{account.snapshot.name}<span>SHA-256 {account.snapshot.sha256.slice(0, 16)}…</span></p>}
          <Field label="账号说明" value={account.note} placeholder="记录关键干员、数据来源或排除说明" onChange={note => commit(current => ({ ...current, accounts: current.accounts.map(item => item.id === accountId ? { ...item, note } : item) }))} />
        </div>
        <div className="scenario-tabs" aria-label="基建场景">{SCENARIOS.map(item => <button key={item.id} className={scenarioId === item.id ? 'selected' : ''} aria-pressed={scenarioId === item.id} onClick={() => setScenarioId(item.id)}><small>{item.id}</small>{item.name}</button>)}</div>
        <div className="case-heading"><div><h2>{accountId} · {scenario.name}</h2><p>{scenario.products} · 三班 12 小时</p></div><button className="secondary" onClick={nextCase}>下一个待测场景 →</button></div>
        <p className={`notice ${fixture.confirmed && state.meta.simulatorVersion.trim() ? '' : 'attention'}`}>{fixture.confirmed ? '配置已确认' : '配置待确认'} · {state.meta.simulatorVersion.trim() ? `模拟器 ${state.meta.simulatorVersion}` : '尚未填写模拟器版本'}。{(!fixture.confirmed || !state.meta.simulatorVersion.trim()) && <button className="text-button" onClick={() => setTab('protocol')}>前往核对，完成后计入比较</button>}</p>
        <div className="site-grid">{rows.map(row => <SiteCard key={rowKey(row)} row={row} onUpdate={update => updateRow(rowKey(row), update)} />)}</div>
        <div className="panel"><h3>当前场景比较</h3><p className="muted">需要配置确认、模拟器版本，以及双方已核对有效的模拟结果。两站较优比较要求三个站点均有效。</p>
          <div className="comparison-grid">{(['yituliu', 'riic', 'best'] as const).map(opponent => {
            const result = comparison(state, accountId, scenarioId, opponent)
            return <div key={opponent}><span>相对{opponent === 'best' ? '两站较优方案' : SITES.find(site => site.id === opponent)!.name}</span><strong className={result ? result.label === '领先' ? 'positive' : result.label === '落后' ? 'negative' : '' : ''}>{result ? `${result.label} ${format(result.delta, true)}` : '等待完整结果'}</strong></div>
          })}</div>
        </div>
        </section>
      </div>}
      {tab === 'results' && <section className="results"><div className="section-heading"><div><h2>正式测试结果</h2><p className="muted">试跑不计入汇总。不同配置分别统计；缺失、失败和无效结果保留状态。</p></div></div>
        {SCENARIOS.map(item => <div className="panel" key={item.id}><h3>{item.id} · {item.name}</h3><div className="comparison-grid">{(['yituliu', 'riic', 'best'] as const).map(opponent => {
          const s = summary(state, item.id, opponent)
          return <div key={opponent}><span>相对{opponent === 'best' ? '两站较优方案' : SITES.find(site => site.id === opponent)!.name}</span><strong>{format(s.median, true)}</strong><small>{s.count}/10 可比较 · {s.wins} 领先 / {s.ties} 接近 / {s.losses} 落后</small></div>
        })}</div></div>)}
        <div className="panel table-panel"><h3>全部正式组合</h3><div className="table-scroll" role="region" aria-label="全部正式测试记录" tabIndex={0}><table><thead><tr><th>账号 / 场景</th>{SITES.map(site => <th key={site.id}>{site.name}<small>净等效理智 / 日</small></th>)}<th>相对两站较优</th></tr></thead><tbody>
          {state.accounts.filter(item => item.stage === 'formal').flatMap(item => SCENARIOS.map(scene => <tr key={`${item.id}-${scene.id}`}><th><button className="text-button" onClick={() => { setAccountId(item.id); setScenarioId(scene.id); setTab('record') }}>{item.id} / {scene.id}</button></th>{SITES.map(site => {
            const row = state.rows.find(row => row.account === item.id && row.scenario === scene.id && row.site === site.id)!
            return <td key={site.id}>{format(row.simulation?.metrics.sanity)}<small>{STATUS[row.status]}</small></td>
          })}<td>{format(comparison(state, item.id, scene.id)?.delta, true)}</td></tr>))}
        </tbody></table></div></div>
      </section>}
      {tab === 'protocol' && <section className="protocol"><div className="panel"><h2>测试批次与环境</h2><div className="form-grid">
        {([['title', '报告标题'], ['seed', '随机种子'], ['poolSize', '抽样候选账号数'], ['sampledAt', '抽样日期'], ['simulatorVersion', 'MaaTool 模拟器版本']] as const).map(([key, label]) => <Field key={key} label={label} value={state.meta[key]} onChange={value => commit(current => ({ ...current, meta: { ...current.meta, [key]: value } }))} />)}
        </div><Field label="批次说明、未确认事项" multiline value={state.meta.note} onChange={note => commit(current => ({ ...current, meta: { ...current.meta, note } }))} />
        <p className="muted">当前估值代码指纹：<code>{valuation}</code>。导入结果后会使用这份工作台内置的 MaaTool 估值代码计算净理智；不同估值版本的结果不能进入同一比较。</p></div>
        {SCENARIOS.map(item => <div className="panel" key={item.id}><h3>{item.id} · {item.name}</h3><p>{item.products}</p><p>{item.levels}。产物按制造站顺序排列，前两间为赤金。</p>
          <Field label="配置快照说明" multiline placeholder="填写九宫格位置、宿舍等级与氛围、配置截图文件名，以及三站设置对应关系" value={state.fixtures[item.id].note} onChange={note => commit(current => ({ ...current, fixtures: { ...current.fixtures, [item.id]: { ...current.fixtures[item.id], note } } }))} />
          <label className="check"><input type="checkbox" checked={state.fixtures[item.id].confirmed} onChange={event => commit(current => ({ ...current, fixtures: { ...current.fixtures, [item.id]: { ...current.fixtures[item.id], confirmed: event.target.checked } } }))} />已核对三站设施、等级、产物、宿舍和换班规则一致</label>
        </div>)}
        <div className="panel prose"><h2>执行顺序</h2><ol><li>先完成 P01、P02 试跑，解决导入与配置问题，保存配置截图。</li><li>随机选取 A01—A10，冻结输入；登记干员文件名与 SHA-256。</li><li>每个账号在三种配置下，让三站各生成一次。使用当前练度和完整自动排班，一图流使用深度排班。</li><li>保存原始方案；在 MaaTool 中模拟，再导入含日产量的完整模拟结果。</li><li>检查心情、占用、容量等信息后，明确标记有效、待确认或无效；不要为低分结果重跑。</li><li>导出 CSV、报告草稿和 JSON 备份，结合原始证据补充差距分析。</li></ol>
          <h3>共同条件</h3><p>允许正常恢复的无人机、已持有且技能解锁的菲亚梅塔、无专精时训练室两个工位及三级回收站。宿舍条件依场景快照固定。不额外投入无人机或回收站加速材料，不人工优化自动生成的排班。</p>
          <h3>评分与结论</h3><p>净等效理智包含龙门币、经验、赤金净变化与回收站估值。差距在 ±1% 内记为接近；这不是统计显著性或模拟误差范围。保留负赤金收支，避免只比较龙门币产出。三种配置分开统计，不将 30 个场景当作 30 个独立用户。</p>
          <h3>保存与证据</h3><p>浏览器只保存记录、指标、文件名和哈希，不保存上传文件原文。原始方案、模拟 JSON、干员快照和截图请另行归档；换浏览器、清理浏览器或移动 HTML 前先导出备份。本页不上传数据，不会自动运行三站生成或 MaaTool 模拟。</p>
        </div>
      </section>}
    </main><footer>MaaTool Benchmark · 本批样本 / 单次生成 / MaaTool 模拟口径</footer>
  </>
}
function SiteCard({ row, onUpdate }: { row: Row; onUpdate: (update: Partial<Row>) => void }) {
  const site = SITES.find(item => item.id === row.site)!
  const m = row.simulation?.metrics
  return <article className="panel site-card" aria-label={`${site.name}测试记录`}><div className="section-heading"><h3>{site.name}</h3>{site.url && <a href={site.url} target="_blank" rel="noreferrer">打开站点 ↗</a>}</div>
    <p className="muted">{site.method} · {rowKey(row)}</p>
    <Field label="站点版本" value={row.siteVersion} placeholder="记录测试当日版本" onChange={siteVersion => onUpdate({ siteVersion })} />
    <Field label="生成时间" value={row.generatedAt} placeholder="例如 2026-10-28 15:00 +08:00" onChange={generatedAt => onUpdate({ generatedAt })} />
    <div className="file-step"><span className="step-number">1</span><div><strong>原始生成方案</strong><Upload onFile={async file => {
      const { value, artifact } = await readFile(file)
      if (!value || typeof value !== 'object') throw new Error('请选择原站导出的 JSON 方案。')
      if (row.original && !window.confirm('将替换此组合的原始方案登记。确认替换？')) return
      onUpdate({ original: artifact, ...(row.original && row.original.sha256 !== artifact.sha256 && row.simulation ? { status: 'unconfirmed' as const } : {}) })
    }}>{row.original ? '替换原始方案' : '登记原始方案 JSON'}</Upload>{row.original && <p className="file-info">{row.original.name}<span>{row.original.sha256.slice(0, 16)}…</span></p>}</div></div>
    <div className="file-step"><span className="step-number">2</span><div><strong>MaaTool 模拟结果</strong><Upload onFile={async file => {
      const { value, artifact } = await readFile(file)
      const simulation = readSimulation(value, artifact, valuation, row.scenario)
      if (row.simulation && !window.confirm('将替换此组合的模拟结果，状态会回到待确认。确认替换？')) return
      onUpdate({ simulation, status: simulation.moodInvalid ? 'invalid' : 'unconfirmed' })
    }}>{row.simulation ? '替换模拟结果' : '导入完整模拟 JSON'}</Upload>{row.simulation && <p className="file-info">{row.simulation.name}<span>{row.simulation.sha256.slice(0, 16)}…</span></p>}</div></div>
    <div className="score"><span>净等效理智 / 日</span><strong>{format(m?.sanity)}</strong></div>
    <dl className="metrics">{[['龙门币', m?.lmd], ['经验', m?.experience], ['赤金产出', m?.gold], ['赤金消耗', m?.goldConsumed], ['赤金净变化', m?.goldNet], ['回收站理智', m?.recycling]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{format(value as number | undefined)}</dd></div>)}</dl>
    {row.simulation?.checks.length ? <ul className="checks">{row.simulation.checks.map(check => <li key={check}>{check}</li>)}</ul> : null}
    <label className="field"><span>核对结果</span><select aria-label="核对结果" value={row.status} onChange={event => onUpdate({ status: event.target.value as Row['status'] })}>
      {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value} disabled={value === 'valid' && (!row.simulation || row.simulation.moodInvalid)}>{label}</option>)}
    </select></label>
    <Field label="异常、元数据补全与分析" multiline value={row.note} placeholder="记录心情异常、资源缺口、格式转换或差距原因" onChange={note => onUpdate({ note })} />
  </article>
}
createRoot(document.getElementById('root')!).render(<App />)
