import { copy } from '../copy'
import SklandIcon from './SklandIcon'
import { AccountIcon, OperatorsIcon, ResourceStockIcon } from './icons'
import './skland-import-activity.css'

export default function SklandImportActivity({ phase, message, depot }: {
  phase: 'authorize' | 'read' | 'save'
  message: string
  depot: boolean
}) {
  const text = copy.workspace.sklandImportActivity
  return <div className="skland-import-activity" data-phase={phase} role="status" aria-busy="true">
    <div className="skland-transfer" aria-hidden="true">
      <div className="skland-transfer-source"><div className="skland-transfer-emblem"><SklandIcon size={32} /><i /></div><span>{text.source}</span></div>
      <svg className="skland-transfer-links" viewBox="0 0 100 152" preserveAspectRatio="none" fill="none">
        <path className="skland-transfer-wire" d="M0 76H24Q40 76 40 60V54Q40 38 56 38H100M24 76Q40 76 40 92V98Q40 114 56 114H100" />
        <path className="skland-transfer-packet" pathLength="100" d="M0 76H24Q40 76 40 60V54Q40 38 56 38H100" />
        <path className="skland-transfer-packet" pathLength="100" d="M0 76H24Q40 76 40 92V98Q40 114 56 114H100" />
      </svg>
      <div className="skland-transfer-target skland-transfer-operators">
        <div className="skland-transfer-records"><i /><div>{depot ? <AccountIcon size={21} /> : <OperatorsIcon size={21} />}<span /><span /></div></div>
        <span>{depot ? text.account : text.operators}</span>
      </div>
      <div className="skland-transfer-target skland-transfer-base">
        {depot ? <div className="skland-transfer-stock"><ResourceStockIcon size={30} /></div> : <div className="skland-transfer-rooms">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>}
        <span>{depot ? text.inventory : text.configuration}</span>
      </div>
    </div>
    <p className="skland-transfer-message">{message}</p>
  </div>
}
