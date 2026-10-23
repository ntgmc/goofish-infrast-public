import { Link } from 'react-router'
import { adminPath } from '../../../lib/app-routes'
import { operationsDate, type OperationsPeriod } from '../../../lib/operations-overview'
import type { AdminController } from '../useAdminController'
import ActivityTrend from './ActivityTrend'
import OperationsTodosPanel from './OperationsTodosPanel'
import { operationsUsersPath, operationsFailureLabels } from '../../../lib/operations-drilldown'
import './overview.css'

type Props = { model: AdminController; active?: boolean }
const number = new Intl.NumberFormat('zh-CN')
const percent = (value: number | null) => value === null ? '—' : `${number.format(value)}%`
const money = (value: number | null) => value === null ? '—' : `¥${value.toFixed(value < 1 ? 4 : 2)}`
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const wait = (value: number | null) => value === null ? '—' : value < 60_000 ? `${number.format(Math.round(value / 100) / 10)} 秒` : `${number.format(Math.round(value / 6_000) / 10)} 分钟`

export default function OverviewSection({ model: c, active = true }: Props) {
  const data = c.businessOverview
  const current = data?.current
  const previous = data?.previous
  const canViewUsers = c.adminCapabilities.includes('user_view')
  const canViewService = c.adminCapabilities.includes('optimization_view')
  return <section className="ops-overview" aria-label="运营看板" aria-busy={c.loading}>
    <OperationsTodosPanel active={active} capabilities={c.adminCapabilities} refreshKey={data?.generated_at ?? ''} />
    <div className="ops-controls"><div role="group" aria-label="统计范围" className="ops-range-options">
      {(['7d', '14d', '30d', 'custom'] as const).map((range) => <button key={range} type="button" onClick={() => c.setUsageRange(range)}
        aria-pressed={c.usageRange === range} className={`tool-secondary-action ${c.usageRange === range ? 'tool-option-selected' : ''}`}>
        {range === 'custom' ? '自定义' : `${range.slice(0, -1)} 天`}</button>)}
    </div><div className="ops-report-actions">{(['csv', 'json'] as const).map((format) => <button key={format} type="button"
      disabled={!data || c.loading || c.busyAction === `report:${format}`} onClick={() => void c.handleExportUsageReport(format)} className="tool-secondary-action">导出 {format.toUpperCase()}</button>)}</div></div>
    {c.usageRange === 'custom' && <form className="ops-custom-range" onSubmit={(event) => { event.preventDefault(); c.applyCustomRange() }}>
      <label><span>开始日期</span><input type="date" value={c.usageRangeFrom} max={c.usageRangeTo || operationsDate()} onChange={(event) => c.setUsageRangeFrom(event.currentTarget.value)} className="tool-field" required aria-invalid={Boolean(c.customRangeError)} aria-describedby={c.customRangeError ? 'ops-range-error' : undefined} /></label>
      <label><span>结束日期</span><input type="date" value={c.usageRangeTo} min={c.usageRangeFrom} max={operationsDate()} onChange={(event) => c.setUsageRangeTo(event.currentTarget.value)} className="tool-field" required aria-invalid={Boolean(c.customRangeError)} aria-describedby={c.customRangeError ? 'ops-range-error' : undefined} /></label>
      <button type="submit" className="tool-secondary-action">应用范围</button>
      <p id="ops-range-error" className="ops-range-feedback" role={c.customRangeError ? 'alert' : undefined}>{c.customRangeError ?? ''}</p>
    </form>}
    {!data || !current || !previous ? <div className="tool-panel ops-empty" role="status">{c.loading ? '正在加载运营数据…' : c.error ? '运营数据加载失败，请重新刷新。' : '运营数据尚未加载。'}
      {!c.loading && <button type="button" className="tool-secondary-action" onClick={() => void c.loadDashboard()}>重新加载</button>}
    </div> : <>
      <div className="ops-snapshot" role="status"><span>{current.from} 至 {current.to} · 北京时间</span><span>{c.loading ? '正在更新，当前显示上次成功报表' : `更新于 ${timestamp(data.generated_at)}`}</span></div>
      {!data.coverage.complete && <p className="tool-alert tool-alert--warning" role="status">该范围的记录不完整，人数和成功率请结合生成记录核对。
        {data.coverage.unattributed_successes > 0 && ` 有 ${data.coverage.unattributed_successes} 次成功排班尚无法关联用户。`}
        {data.coverage.unknown_outcomes > 0 && ` 有 ${data.coverage.unknown_outcomes} 条记录尚无结果状态。`}</p>}
      <section className="tool-panel ops-usage" aria-labelledby="ops-usage-title">
        <div className="ops-usage-heading"><div><h2 id="ops-usage-title">有多少人真正用起来了？</h2><p>成功生成个人排班的用户，同一人使用多个账号也只计一次。</p></div>
          {canViewUsers && <Link className="tool-secondary-action" to={operationsUsersPath(data, 'successful')}>查看成功排班用户</Link>}</div>
        <div className="ops-usage-summary"><div className="ops-primary-stat"><span>{current.complete ? '成功排班用户' : '已记录成功排班用户'}</span><strong>{number.format(current.successful_users)}<small>人</small></strong>
          {current.complete && previous.complete ? <p>上期 {number.format(previous.successful_users)} 人<span> · {current.successful_users === previous.successful_users ? '与上期持平' : `比上期${current.successful_users > previous.successful_users ? '增加' : '减少'} ${number.format(Math.abs(current.successful_users - previous.successful_users))} 人`}</span></p> : <p>完整记录覆盖前，暂不比较用户增减。</p>}</div>
          <dl className="ops-usage-facts"><div><dt>成功生成</dt><dd>{number.format(current.successful_generations)} 次</dd></div><div><dt>新注册用户</dt><dd>{number.format(current.registered_users)} 人</dd></div><div><dt>每位使用用户生成</dt><dd>{current.complete && current.successful_users ? number.format(Math.round(current.successful_generations / current.successful_users * 10) / 10) : '—'} 次</dd></div></dl>
        </div>
      <div className="ops-key-metrics">
        <BusinessMetric label="新人首次排班率" value={percent(current.activation.rate)} previous={previous.activation.rate === null ? null : percent(previous.activation.rate)}
          detail={current.activation.eligible ? `${current.activation.activated} / ${current.activation.eligible} 人完成首次排班` : current.activation.pending ? '等待新人的 7 天观察期完成' : '该时段暂无新注册用户'}
          href={canViewUsers ? operationsUsersPath(data, 'activation_no_generation') : undefined} action="查看添加账号后未排班用户" />
        <BusinessMetric label="7 日再次排班率" value={percent(current.reuse.rate)} previous={previous.reuse.rate === null ? null : percent(previous.reuse.rate)}
          detail={current.reuse.eligible ? `${current.reuse.reused} / ${current.reuse.eligible} 人再次使用` : current.reuse.pending ? '等待使用后的 7 天观察期完成' : '暂无可观察的使用用户'}
          href={canViewUsers ? operationsUsersPath(data, 'reuse_missing') : undefined} action="查看未再次排班用户" />
        <BusinessMetric label="MAA 文件获取率" value={percent(current.maa.rate)} previous={previous.maa.rate === null ? null : percent(previous.maa.rate)}
          detail={current.maa.eligible ? `${current.maa.exported} / ${current.maa.eligible} 份方案已获取${current.maa.complete ? '' : '（自文件获取记录开始）'}` : '暂无可导出为 MAA 的新方案'}
          href={canViewUsers ? operationsUsersPath(data, 'maa_missing') : undefined} action="查看未获取文件用户" />
        <BusinessMetric label="完整等待 P95" value={wait(current.p95_wait_ms)} previous={previous.p95_wait_ms === null ? null : wait(previous.p95_wait_ms)} detail={current.latency_samples ? `从提交到完成，${current.latency_samples} 次成功生成` : '暂无完整等待记录'} />
        <BusinessMetric label="每次成功生成成本" value={money(current.cost.per_success_cny)} previous={previous.cost.per_success_cny === null ? null : money(previous.cost.per_success_cny)}
          detail={costStatus(current.cost)} />
      </div>
        <ActivityTrend days={data.days} />
      </section>
      <div className="ops-question-grid">
        <section className="tool-panel ops-question" aria-labelledby="ops-activation-title"><h2 id="ops-activation-title">新人在哪一步停下来了？</h2>
          <p>观察同一批新注册用户在 7 天内的使用进展。</p>
          {current.activation.eligible > 0 ? <ol className="ops-funnel">{[
            ['完成注册', current.activation.eligible],
            ['添加游戏账号', current.activation.with_profile], ['完成首次排班', current.activation.activated],
          ].map(([label, count]) => <li key={label}><div><span>{label}</span><strong>{count} 人</strong></div><progress max={current.activation.eligible} value={Number(count)} aria-label={`${label}人数`} /></li>)}</ol>
            : <p className="ops-no-samples">{current.activation.pending ? '这批新人还在观察期内，完成观察后显示转化进展。' : '该时段暂无可观察的注册用户。'}</p>}
          {current.activation.pending > 0 && <p className="ops-observation-note">另有 {current.activation.pending} 位新人仍在观察期内。</p>}
          {current.activation.eligible > current.activation.with_profile && <p className="ops-finding">{current.activation.eligible - current.activation.with_profile} 人在 7 天内没有添加游戏账号的记录。{canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'activation_missing_profile')}>查看未添加账号用户 →</Link>}</p>}
          {current.activation.with_profile > current.activation.activated && <p className="ops-finding">{current.activation.with_profile - current.activation.activated} 人添加了账号，但未在 7 天内完成首次排班。{canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'activation_no_generation')}>查看添加了账号但未完成首次排班的用户 →</Link>}</p>}
          {canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'registered')}>查看这批新注册用户 →</Link>}
        </section>
        <section className="tool-panel ops-question" aria-labelledby="ops-reuse-title"><h2 id="ops-reuse-title">用户会继续使用排班吗？</h2><p>关注这批使用用户是否在其他日期再次排班。</p>
          <dl className="ops-facts"><div><dt>已完成观察</dt><dd>{current.reuse.eligible} 人</dd></div><div><dt>7 天内再次排班</dt><dd>{current.reuse.reused} 人</dd></div><div><dt>仍在观察期</dt><dd>{current.reuse.pending} 人</dd></div></dl>
          {canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'reused')}>查看再次排班用户 →</Link>}
          <div className="ops-result-delivery"><h3>生成之后是否获取了 MAA 文件？</h3><p>已记录获取 {current.maa.exported} 份，可观察方案 {current.maa.eligible} 份。</p>
            {canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'maa_exported')}>查看已获取文件用户 →</Link>}
            {data.coverage.maa_tracking_started_at && <p className="ops-observation-note">文件获取记录自 {timestamp(data.coverage.maa_tracking_started_at)} 开始。</p>}
            {!current.maa.complete && <p className="ops-observation-note">获取率按文件获取记录开始后生成的方案计算。</p>}
          </div>
        </section>
      </div>
      <div className="ops-question-grid">
        <section className="tool-panel ops-question" aria-labelledby="ops-service-title"><div className="ops-question-heading"><h2 id="ops-service-title">生成体验是否稳定？</h2>{canViewUsers && <Link className="ops-text-link" to={operationsUsersPath(data, 'failed')}>查看生成失败用户 →</Link>}</div>
          <dl className="ops-facts"><div><dt>生成成功率</dt><dd>{percent(current.success_rate)}</dd></div><div><dt>生成失败</dt><dd>{current.failed_requests} 次</dd></div><div><dt>完整等待 P50 / P95</dt><dd>{wait(current.p50_wait_ms)} / {wait(current.p95_wait_ms)}</dd></div><div><dt>森空岛导入成功率</dt><dd>{percent(data.skland.success_rate)}</dd></div></dl>
          <h3 className="ops-subheading">生成失败原因</h3>
          {data.failure_reasons.length ? <ul className="ops-failure-list">{data.failure_reasons.map((reason) => <li key={reason.reason_code}><span>{canViewUsers ? <Link className="ops-text-link" to={operationsUsersPath(data, 'failed', reason.reason_code)}>{operationsFailureLabels[reason.reason_code] ?? '其他生成问题'}</Link> : operationsFailureLabels[reason.reason_code] ?? '其他生成问题'}</span><strong>{reason.count} 次</strong></li>)}</ul>
            : <p className="ops-observation-note">该时段暂无已记录的生成失败。</p>}
        </section>
        <section className="tool-panel ops-question" aria-labelledby="ops-cost-title"><div className="ops-question-heading"><h2 id="ops-cost-title">计算资源投入是否划算？</h2>{canViewService && <Link className="ops-text-link" to={`${adminPath('queue')}?view=history`}>查看成本设置 →</Link>}</div>
          <dl className="ops-facts"><div><dt>计算资源估算费用</dt><dd>{money(current.cost.estimated_cny)}</dd></div><div><dt>每次成功生成</dt><dd>{money(current.cost.per_success_cny)}</dd></div><div><dt>已记录 / 应记录小时</dt><dd>{current.cost.recorded_hours} / {current.cost.expected_hours}</dd></div><div><dt>对应成功生成</dt><dd>{current.cost.successful_generations} 次</dd></div></dl>
          <p className="ops-observation-note">{costStatus(current.cost)}。费用按当前计算单价估算，统计至 {timestamp(current.cost.through)} 的已结束小时。</p>
          <p className="ops-observation-note">计算资源费用包含常驻和弹性实例；数据库、存储和邮件费用需另行核算。</p>
        </section>
      </div>
      <footer className="ops-data-note"><p>上期：{previous.from} 至 {previous.to}，按相同已过时长比较。观察期尚未完成和暂无样本的指标显示为“—”。</p>
        <p>MAA 文件获取统计服务器已提供文件的方案；实际导入和执行情况由用户在 MAA 中确认。</p>
        <p>生成成功率按已记录的成功和失败请求统计；排队中、已取消的任务可在任务监控中查看。</p>
      </footer>
    </>}
  </section>
}

function BusinessMetric({ label, value, detail, previous, href, action }: { label: string; value: string; detail: string; previous: string | null; href?: string; action?: string }) {
  return <section className="ops-key-metric" aria-label={label}><h2>{label}</h2><strong>{value}</strong><p>{detail}</p>{previous !== null && <small>上期 {previous}</small>}{href && <Link className="ops-text-link" to={href}>{action} →</Link>}</section>
}

function costStatus(cost: OperationsPeriod['cost']): string {
  if (!cost.prices_configured) return '配置计算单价后可查看'
  if (!cost.expected_hours) return '等待完整小时的费用记录'
  if (cost.recorded_hours < cost.expected_hours) return '费用记录未覆盖完整范围'
  if (!cost.successful_generations) return '对应时段暂无成功生成'
  return '按已结束小时的计算费用估算'
}
