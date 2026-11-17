import { useContext, useId, useState } from 'react'
import { copy, CURRENT_LOCALE } from '../../../copy'
import type { AdminAiUsageDetail, AdminAiUsagePage, AiUsageFilters, AiUsageRecord, AiUsageTotals } from '../../../lib/ai-usage'
import { useAdminPanelQuery } from '../../../lib/admin-panel-query'
import { AdminQueryScope } from '../../../lib/private-query-scope'
import { getApiErrorMessage } from '../../../lib/api-client'
import { AdminDetailDialog } from '../shared/AdminDetailDialog'
import { PaginationControls } from '../shared/PaginationControls'
import { formatDate } from '../shared/helpers'
import './ai-usage.css'

const text = copy.aiUsage
const count = (value: number | null | undefined) => value == null ? text.no_data : value.toLocaleString(CURRENT_LOCALE)
const money = (value: number | null | undefined) => value == null ? text.no_data : `¥${(value / 1e6).toLocaleString(CURRENT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 12 })}`
function initialDraft() {
  const date = new Date(Date.now() - 30 * 86400000)
  return { from: new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    to: '', status: '', provider: '', model: '', user_id: '' }
}
function applyFilters(draft: ReturnType<typeof initialDraft>): AiUsageFilters {
  return { ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
    ...(draft.from ? { from: new Date(draft.from).toISOString() } : {}), ...(draft.to ? { to: new Date(draft.to).toISOString() } : {}) }
}

export default function AiUsageSection() {
  const scope = useContext(AdminQueryScope)
  const [draft, setDraft] = useState(initialDraft)
  const [filters, setFilters] = useState<AiUsageFilters>(() => applyFilters(initialDraft()))
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const query = useAdminPanelQuery<AdminAiUsagePage>('ai-usage', `/api/admin/ai-usage?${params}`)
  const data = query.data
  return <section className="ai-usage min-w-0 space-y-5" aria-labelledby="ai-usage-title">
    <header><h2 id="ai-usage-title" className="text-lg font-semibold">{text.title}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{text.description}</p></header>
    <form className="tool-panel p-4 sm:p-6" onSubmit={(event) => {
      event.preventDefault()
      const from = draft.from ? Date.parse(draft.from) : Date.now() - 30 * 86400000
      const to = draft.to ? Date.parse(draft.to) : Date.now()
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 366 * 86400000) { setValidation(text.invalid_range); return }
      setFilters(applyFilters(draft)); setPage(1); setValidation(null)
    }}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">{(['from', 'to', 'provider', 'model', 'user_id'] as const).map((name) => <label key={name} className="grid min-w-0 gap-2 text-sm"><span>{name === 'user_id' ? text.user : text[name]}</span>
        <input className="tool-field min-w-0 w-full" type={name === 'from' || name === 'to' ? 'datetime-local' : 'text'} value={draft[name]} maxLength={name === 'provider' ? 80 : 128}
          onChange={(event) => { setDraft({ ...draft, [name]: event.currentTarget.value }); setValidation(null) }} /></label>)}
        <label className="grid min-w-0 gap-2 text-sm"><span>{text.status}</span><select className="tool-field" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value })}>
          <option value="">{text.all}</option>{(['succeeded', 'failed', 'pending'] as const).map((status) => <option key={status} value={status}>{text.statuses[status]}</option>)}</select></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button className="tool-primary-action" type="submit">{text.query}</button><button className="tool-secondary-action" type="button" onClick={() => { const next = initialDraft(); setDraft(next); setFilters(applyFilters(next)); setPage(1); setValidation(null) }}>{text.reset}</button>
        <button className="tool-secondary-action" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{text.refresh}</button></div>
      <p className="mt-3 text-xs leading-6 text-ink-muted">{text.filters_help}</p>
    </form>
    {validation && <p role="alert" className="tool-alert tool-alert--error">{validation}</p>}
    {query.error && <p role="alert" className="tool-alert tool-alert--error">{getApiErrorMessage(query.error, text.load_failed)}</p>}
    {query.isFetching && <p role="status" className="text-sm text-ink-muted">{text.loading}</p>}
    {data && <div className="min-w-0 space-y-5" aria-busy={query.isFetching}>
      <section aria-label={text.totals}><h3 className="mb-3 text-base font-semibold">{text.totals}</h3><dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        [text.requests, count(data.totals.requests)], [text.cost, money(data.totals.cost_micro_cny)],
        [text.input, count(data.totals.metered_requests ? data.totals.input_tokens : null)], [text.output, count(data.totals.metered_requests ? data.totals.output_tokens : null)],
      ].map(([label, value]) => <div key={label} className="tool-panel min-w-0 p-4"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
        <p className="mt-3 text-sm leading-7 text-ink-secondary">{text.succeeded} {count(data.totals.succeeded)} · {text.failed} {count(data.totals.failed)} · {text.pending} {count(data.totals.pending)}<br />
          {text.metered} {count(data.totals.metered_requests)} / {count(data.totals.requests)} · {text.cache_reported} {count(data.totals.cache_reported_requests)} / {count(data.totals.requests)}<br />
          {text.cached} {count(data.totals.cache_reported_requests ? data.totals.cached_input_tokens : null)} · {text.writes} {count(data.totals.metered_requests ? data.totals.cache_write_tokens : null)}</p>
        <p className="mt-2 text-sm leading-7 text-ink-secondary">{text.input_fee} {money(data.totals.input_cost_micro_cny)} · {text.output_fee} {money(data.totals.output_cost_micro_cny)}<br />{text.cached_fee} {money(data.totals.cached_input_cost_micro_cny)} · {text.write_fee} {money(data.totals.cache_write_cost_micro_cny)}</p>
        <p className="mt-2 text-sm leading-7 text-ink-secondary">{text.usage_cost} {money(data.totals.usage_cost_micro_cny)} · {text.estimated_cost} {money(data.totals.estimated_cost_micro_cny)} · {text.reserved_cost} {money(data.totals.reserved_cost_micro_cny)}</p>
        <p className="mt-3 text-xs leading-6 text-ink-muted">{text.accounting} {text.pricing_note}</p>
      </section>
      {data.items.length === 0 ? <p className="tool-panel p-6 text-sm text-ink-muted">{text.empty}</p> : <>
        <section className="tool-panel min-w-0 p-4 sm:p-6"><h3 className="mb-2 text-base font-semibold">{text.calls}</h3><p className="mb-3 text-xs text-ink-muted">{text.table_hint}</p><div role="region" aria-label={text.calls} tabIndex={0} className="ai-table-scroll"><table><thead><tr>{[text.time, text.identity, text.model_column, text.status, text.tokens, text.fee, text.actions].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
          <th scope="row"><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></th><td><span className="ai-record-id">{item.user_id ?? text.deleted_user}</span><small className="ai-record-id">{item.profile_id ?? text.no_result}</small></td>
          <td><span className="ai-model-name">{item.pricing?.provider ?? text.no_data}<small>{item.pricing?.model ?? text.no_data}</small></span></td><td>{text.statuses[item.status]}</td>
          <td>{text.input} / {text.output}<small>{count(item.usage?.input_tokens)} / {count(item.usage?.output_tokens)}</small><small>{text.cache_read} {count(item.usage?.cached_input_tokens)} · {text.writes} {count(item.usage?.cache_write_tokens)}</small></td>
          <td>{money(item.cost_micro_cny)}<small>{text.bases[item.cost_basis]}</small></td><td><button className="tool-secondary-action" type="button" onClick={() => setSelected(item.id)}>{text.detail}</button></td>
        </tr>)}</tbody></table></div><PaginationControls pagination={data.pagination} loading={query.isFetching} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} /></section>
        <AggregateTable title={text.daily} rows={data.daily.map((row) => ({ ...row, id: row.day, label: row.day }))} />
        <AggregateTable title={text.models} rows={data.models.map((row) => ({ ...row, id: JSON.stringify([row.provider, row.model, row.protocol]), label: `${row.provider ?? text.no_data} / ${row.model ?? text.no_data}`, subtitle: row.protocol ? copy.aiSettings.protocols[row.protocol as keyof typeof copy.aiSettings.protocols] : text.no_data }))} />
      </>}
    </div>}
    {selected && scope.active && <UsageDetail id={selected} onClose={() => setSelected(null)} />}
  </section>
}

function AggregateTable({ title, rows }: { title: string; rows: Array<AiUsageTotals & { id: string; label: string; subtitle?: string }> }) {
  return <section className="tool-panel min-w-0 p-4 sm:p-6"><h3 className="mb-2 text-base font-semibold">{title}</h3><p className="mb-3 text-xs text-ink-muted">{text.table_hint}</p><div role="region" aria-label={title} tabIndex={0} className="ai-table-scroll"><table><thead><tr>{[title === text.daily ? text.date : text.model_column, text.requests, text.input, text.cached, text.writes, text.output, text.fee].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}><th scope="row"><span className="ai-model-name">{row.label}{row.subtitle && <small>{row.subtitle}</small>}</span></th><td>{count(row.requests)}<small>{text.succeeded} {count(row.succeeded)} · {text.failed} {count(row.failed)} · {text.pending} {count(row.pending)}</small></td>
      <td>{count(row.metered_requests ? row.input_tokens : null)}<small>{count(row.metered_requests)} / {count(row.requests)} {text.metered}</small></td><td>{count(row.cache_reported_requests ? row.cached_input_tokens : null)}<small>{text.priced_fee} {money(row.cached_input_cost_micro_cny)}</small></td><td>{count(row.metered_requests ? row.cache_write_tokens : null)}<small>{text.priced_fee} {money(row.cache_write_cost_micro_cny)}</small></td><td>{count(row.metered_requests ? row.output_tokens : null)}<small>{text.priced_fee} {money(row.output_cost_micro_cny)}</small></td>
      <td>{money(row.cost_micro_cny)}<small>{text.usage_cost} {money(row.usage_cost_micro_cny)}</small><small>{text.estimated_cost} {money(row.estimated_cost_micro_cny)}</small><small>{text.reserved_cost} {money(row.reserved_cost_micro_cny)}</small></td></tr>)}</tbody></table></div></section>
}

function UsageDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const titleId = useId()
  const query = useAdminPanelQuery<AdminAiUsageDetail>('ai-usage-detail', `/api/admin/ai-usage?${new URLSearchParams({ id })}`)
  const item = query.data?.item
  return <AdminDetailDialog labelledBy={titleId} onClose={onClose}><section className="tool-panel flex max-h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-3 p-4 sm:px-6"><h2 id={titleId} tabIndex={-1} data-dialog-initial-focus className="text-lg font-semibold">{text.detail_title}</h2><button className="tool-secondary-action" type="button" onClick={onClose}>{text.close}</button></header>
    <div className="ai-usage min-w-0 overflow-y-auto p-4 sm:p-6">
      {query.isFetching && <p role="status">{text.details_loading}</p>}{query.error && <div role="alert" className="tool-alert tool-alert--error">{getApiErrorMessage(query.error, text.details_failed)}<button type="button" className="tool-secondary-action ml-3" onClick={() => void query.refetch()}>{text.retry}</button></div>}
      {item && <>
        <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">{[
          [text.id, item.id], [text.status, text.statuses[item.status]], [text.user, item.user_id ?? text.deleted_user], [text.profile, item.profile_id ?? text.no_data], [text.result, item.result_id ?? text.no_data],
          [text.time, formatDate(item.created_at)], [text.settled, item.settled_at ? formatDate(item.settled_at) : text.no_data], [text.duration, item.duration_ms === null ? text.no_data : `${count(item.duration_ms)} ms`],
          [text.provider, item.pricing?.provider ?? text.no_data], [text.model, item.pricing?.model ?? text.no_data], [text.protocol, item.pricing ? copy.aiSettings.protocols[item.pricing.protocol] : text.no_data], [text.request_id, item.provider_request_id ?? text.no_data],
          [text.reserved, money(item.reserved_micro_cny)], [text.cost, `${money(item.cost_micro_cny)} · ${text.bases[item.cost_basis]}`],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-all leading-6">{value}</dd></div>)}</dl>
        {item.error_code && <p className="tool-alert tool-alert--warning mt-5">{text.errors[item.error_code as keyof typeof text.errors] ?? item.error_code}</p>}
        <TokenBreakdown item={item} />
        <section className="mt-6"><h3 className="text-base font-semibold">{text.answer}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{query.data?.explanation?.text ?? text.answer_missing}</p></section>
      </>}
    </div>
  </section></AdminDetailDialog>
}

function TokenBreakdown({ item }: { item: AiUsageRecord }) {
  const { usage, pricing, breakdown } = item
  const ordinary = usage?.cached_input_tokens != null ? usage.input_tokens - usage.cached_input_tokens - usage.cache_write_tokens : null
  const rows = [
    [text.ordinary_input, ordinary, pricing?.inputPrice, breakdown?.input],
    [text.cache_read, usage?.cached_input_tokens, pricing?.cachedInputPrice, breakdown?.cached_input],
    [text.write_5m, usage?.cache_write_5m_tokens, pricing?.cacheWritePrice, breakdown?.cache_write_5m],
    [text.write_1h, usage?.cache_write_1h_tokens, pricing?.cacheWrite1hPrice, breakdown?.cache_write_1h],
    [text.output, usage?.output_tokens, pricing?.outputPrice, breakdown?.output],
  ] as const
  return <section className="mt-6"><h3 className="mb-3 text-base font-semibold">{text.breakdown}</h3><p className="mb-3 text-sm leading-6 text-ink-secondary">{text.input} {count(usage?.input_tokens)} · {text.writes} {count(usage?.cache_write_tokens)}</p>
    <p className="mb-3 text-xs text-ink-muted">{text.table_hint}</p><div role="region" aria-label={text.breakdown} tabIndex={0} className="ai-table-scroll"><table><thead><tr>{[text.category, text.count, text.unit_price, text.fee].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(([label, tokens, price, fee]) => <tr key={label}><th scope="row">{label}</th><td>{count(tokens)}</td><td>{price == null ? text.no_data : price.toLocaleString(CURRENT_LOCALE, { maximumFractionDigits: 12 })}</td><td>{money(fee)}</td></tr>)}</tbody></table></div>
    <p className="mt-3 text-xs leading-6 text-ink-muted">{text.snapshot} {text.pricing_note}</p>
  </section>
}
