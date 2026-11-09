import { operationsPageLabels, operationsToolLabels, type OperationsToolsOverview } from '../../../lib/operations-tools'

const number = new Intl.NumberFormat('zh-CN')
const duration = (value: number | null | undefined) => value == null ? '—' : `${number.format(Math.round(value / 100) / 10)} 秒`
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

export default function ToolUsageStatistics({ data, from, to, previousFrom }: {
  data: OperationsToolsOverview | undefined; from: string; to: string; previousFrom: string
}) {
  const start = data?.tracking_started_at
  const available = Boolean(start && Date.parse(`${to}T23:59:59+08:00`) >= Date.parse(start))
  const previousComplete = Boolean(start && Date.parse(`${previousFrom}T00:00:00+08:00`) >= Date.parse(start))
  const partial = Boolean(start && Date.parse(`${from}T00:00:00+08:00`) < Date.parse(start))
  const tools = Object.entries(operationsToolLabels).sort(([a], [b]) =>
    (data?.current.find((row) => row.tool === b)?.users ?? 0) - (data?.current.find((row) => row.tool === a)?.users ?? 0))
  const pages = Object.entries(operationsPageLabels).map(([page, label]) => ({ page, label,
    visitors: data?.pages.find((row) => row.page === page)?.visitors ?? 0,
    views: data?.pages.find((row) => row.page === page)?.views ?? 0,
  })).sort((a, b) => b.visitors - a.visitors || b.views - a.views)
  return <>
    <section className="tool-panel ops-question" aria-labelledby="ops-tools-title">
      <h2 id="ops-tools-title">工具使用与质量</h2>
      <p>对照使用人数、失败次数与等待时间，判断哪些工具需要优先维护。人数按登录账号去重，匿名访客另列。</p>
      {!available ? <p className="ops-no-samples">{start ? '所选时段尚未开始记录工具使用。' : '工具使用记录尚未开始。'}</p> : <>
        <p className="ops-tool-scroll-hint">左右滑动表格查看成功率、失败次数与耗时。</p>
        <div className="ops-table-scroll ops-tool-table" role="region" aria-label="工具使用与质量明细" tabIndex={0}><table>
          <thead><tr><th scope="col">工具</th><th scope="col">使用人数</th><th scope="col">使用次数</th><th scope="col">成功率</th><th scope="col">失败</th><th scope="col">取消</th><th scope="col">耗时 P50 / P95</th></tr></thead>
          <tbody>{tools.map(([tool, label]) => {
            const current = data?.current.find((row) => row.tool === tool)
            const previous = data?.previous.find((row) => row.tool === tool)
            return <tr key={tool}><th scope="row">{label}{tool === 'schedule_comparison' && <small>每份方案重算计一次</small>}</th>
              <td>{number.format(current?.users ?? 0)}{current && current.anonymous_visitors > 0 && <small>另有 {number.format(current.anonymous_visitors)} 位匿名访客</small>}{previousComplete && <small>上期 {number.format(previous?.users ?? 0)} 人</small>}</td>
              <td>{number.format(current?.attempts ?? 0)}</td><td>{current?.success_rate == null ? '—' : `${number.format(current.success_rate)}%`}<small>成功 {number.format(current?.successful ?? 0)} 次</small></td>
              <td>{number.format(current?.failed ?? 0)}</td><td>{number.format(current?.cancelled ?? 0)}</td>
              <td>{duration(current?.p50_ms)} / {duration(current?.p95_ms)}<small>{number.format(current?.latency_samples ?? 0)} 次成功样本</small></td></tr>
          })}</tbody>
        </table></div>
        <p className="ops-observation-note">成功率按成功与失败计算，取消单列；耗时取服务端成功处理时间，计算任务包含排队和重试。正在处理的请求完成后计入。</p>
      </>}
      {start && <p className="ops-observation-note">记录始于 {timestamp(start)}。{partial && '所选范围跨越记录起点，显示已记录部分。'}</p>}
    </section>
    <section className="tool-panel ops-question" aria-labelledby="ops-pages-title"><h2 id="ops-pages-title">页面访问</h2>
      <p>查看 V2 各栏目打开人数，同一浏览器在所选范围内只计一人。</p>
      {!available ? <p className="ops-no-samples">所选时段暂无页面访问记录。</p> : <>
        <div className="ops-page-visits">{pages.slice(0, 6).map((page) => <div key={page.page}><span>{page.label}</span><strong>{number.format(page.visitors)}<small> 人</small></strong></div>)}</div>
        <details className="ops-page-details"><summary>查看全部 {pages.length} 个栏目</summary>
          <div className="ops-table-scroll" role="region" aria-label="页面访问明细" tabIndex={0}><table><thead><tr><th scope="col">页面</th><th scope="col">访问人数</th><th scope="col">访问记录</th></tr></thead>
            <tbody>{pages.map((page) => <tr key={page.page}><th scope="row">{page.label}</th><td>{number.format(page.visitors)}</td><td>{number.format(page.views)}</td></tr>)}</tbody></table></div>
        </details><p className="ops-observation-note">人数包含未登录访客；更换浏览器或清除 Cookie 会重新计数。同一浏览器打开同一栏目，10 分钟内合并为一条访问记录。</p>
      </>}
    </section>
  </>
}
