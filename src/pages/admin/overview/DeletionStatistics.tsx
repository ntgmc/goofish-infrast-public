import { copy } from '../../../copy'
import type { OperationsDeletionReason, OperationsOverview } from '../../../lib/operations-overview'

const number = new Intl.NumberFormat('zh-CN')
const reasonLabel = (reason: OperationsDeletionReason) => reason === 'unrecorded' ? '未记录或已到期' : copy.dashboard.settings.deletion_reasons[reason]

export default function DeletionStatistics({ data }: { data: OperationsOverview }) {
  const { deletions, current, previous } = data
  return <section className="tool-panel ops-question ops-deletions" aria-labelledby="ops-deletions-title">
    <h2 id="ops-deletions-title">账号注销</h2>
    <p>已注销按所选日期统计，待注销为当前状态。</p>
    <dl className="ops-deletion-summary">
      <div><dt>所选时段已注销</dt><dd>{number.format(current.deleted_users)} <small>人</small><p>上期 {number.format(previous.deleted_users)} 人</p></dd></div>
      <div><dt>当前待注销</dt><dd>{number.format(deletions.pending)} <small>人</small></dd></div>
      <div><dt>累计已注销</dt><dd>{number.format(deletions.total_deleted)} <small>人</small></dd></div>
      <div><dt>当前处理失败</dt><dd>{number.format(deletions.failed)} <small>人</small>{deletions.failed > 0 && <p>包含在待注销人数中</p>}</dd></div>
    </dl>
    <h3 className="ops-subheading">注销原因</h3>
    {deletions.reasons.length ? <table className="ops-deletion-reasons">
      <caption className="sr-only">注销原因人数</caption>
      <thead><tr><th scope="col">原因</th><th scope="col">已注销</th><th scope="col">待注销</th></tr></thead>
      <tbody>{deletions.reasons.map((item) => <tr key={item.reason}><th scope="row">{reasonLabel(item.reason)}</th><td>{number.format(item.deleted)}</td><td>{number.format(item.pending)}</td></tr>)}</tbody>
    </table> : <p className="ops-observation-note">该时段暂无已完成注销，当前也没有待注销账号。</p>}
    {deletions.recent_feedback !== null && <details className="ops-deletion-feedback">
      <summary>补充说明（最近 {deletions.recent_feedback.length} 条）</summary>
      {deletions.recent_feedback.length ? <ul>{deletions.recent_feedback.map((item, index) => <li key={`${item.at}-${index}`}>
        <div><strong>{reasonLabel(item.reason)}</strong><span>{item.status === 'completed' ? '已注销' : '待注销'}</span></div>
        <time dateTime={item.at}>{item.status === 'completed' ? '完成于 ' : '申请于 '}{new Date(item.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time>
        <p>{item.detail}</p>
      </li>)}</ul> : <p className="ops-observation-note">暂无补充说明。</p>}
    </details>}
  </section>
}
