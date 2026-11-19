import { useId, useRef, useState } from 'react'
import { CloseIcon, HelpHintIcon, NextIcon, SearchIcon } from '../../../components/icons'
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '../../../components/ui/dialog'
import FeedbackButton from '../../../components/FeedbackDialog'
import Link from '../../../components/InternalLink'
import { copy } from '../../../copy'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { sectionLabels, v2Path, v2SectionAvailable, type V2Section } from '../navigation'
import './page-help.css'

const text = copy.v2.workspaceAssistant

type Props = {
  page: 'skland' | 'generation' | 'result' | 'inventory'
  profileId?: string
  credentialInvalid?: boolean
  inventoryIssue?: boolean
  errorCode?: string | null
  recoveryAction?: 'retry' | 'review_input' | 'reauthorize' | 'contact_support' | 'none'
  failure?: boolean
  jobId?: string
  saveFailed?: boolean
  running?: boolean
  maaAvailable?: boolean
  maaDirect?: boolean
  couponBalance?: number
  onAuthorize?: () => void
  onRefreshInventory?: () => void
  onRetrySave?: () => void
  onRetryJob?: () => void
  onConfig?: () => void
  onOpenExport?: () => void
}

export default function PageHelp(props: Props) {
  const { features } = useSiteFeatures()
  const { content, isFallback } = usePublicContent()
  const [open, setOpen] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const nextAction = useRef<(() => void) | null>(null)
  const [question, setQuestion] = useState('')
  const [selection, setSelection] = useState<{ question: string; topic: boolean } | null>(null)
  const submitted = selection?.question ?? ''
  const selectedTopic = selection?.topic ? submitted : null
  const questionId = useId()
  const purchaseAvailable = features.pricing && !isFallback && Boolean(content.cdk_purchase.xianyu_url)
  const answer = submitted ? matchQuestion(submitted, props, purchaseAvailable) : null
  const source = answer?.faq && features.faq && (!isFallback || !officialPolicy.test(submitted)) ? content.faq.items.find((item) => item.id === answer.faq) : null
  const delivery = purchaseAvailable && /发货|多久.*收到|兑换码.*没收到/.test(submitted) && !/退款|补偿/.test(submitted)
    ? content.cdk_purchase.instructions || copy.public.purchase.delivery_help : null
  const action = answer && 'action' in answer ? answer.action : undefined
  const label = answer && 'label' in answer ? answer.label : undefined
  const section = answer?.section
  const topics = text.helpTopics[props.page].filter((topic) => topic !== text.helpFailureTopic || props.failure)
  const reply = submitted && (delivery || answer?.message || source?.answer || text.helpFallback)
  if (!features.workspace_page_help) return null

  const answerPanel = reply && <div className="v2-page-help-answer">
    <p>{reply}</p>
    <div className="v2-actions">
      {action && label && <button type="button" className="v2-button v2-button-secondary" onClick={() => { nextAction.current = action; setOpen(false) }}>{label}</button>}
      {section && !(section === 'support' && props.profileId) && v2SectionAvailable(section, features) && <Link className="v2-text-button" onClick={() => setOpen(false)} to={v2Path(section, props.profileId)}>{sectionLabels[section]}</Link>}
      {source && v2SectionAvailable('help', features) && <Link className="v2-text-button" onClick={() => setOpen(false)} to={v2Path('help')}>{text.helpFaq}</Link>}
      {props.profileId && <FeedbackButton profileId={props.profileId} failureJobId={answer?.faq === 'task-failure' ? props.jobId : undefined} className="v2-text-button" />}
      {!props.profileId && section !== 'support' && v2SectionAvailable('support', features) && <Link className="v2-text-button" onClick={() => setOpen(false)} to={v2Path('support')}>{sectionLabels.support}</Link>}
    </div>
    {source && answer?.message && <details className="v2-disclosure"><summary>{text.helpSource} · {source.question}</summary><p>{source.answer}</p></details>}
  </div>
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button ref={trigger} type="button" className="v2-page-help-trigger" aria-label={text.helpTitles[props.page]}><HelpHintIcon size={18} aria-hidden="true" /><span>{text.help}</span></button></DialogTrigger>
    <DialogContent className="v2-page-help" aria-describedby={undefined}
      onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus() }}
      onCloseAutoFocus={(event) => {
        if (!nextAction.current) return
        event.preventDefault()
        const run = nextAction.current
        nextAction.current = null
        trigger.current?.focus({ preventScroll: true })
        run()
      }}>
      <header className="v2-page-help-header">
        <DialogTitle ref={heading} tabIndex={-1}>{text.helpTitles[props.page]}</DialogTitle>
        <DialogClose className="v2-page-help-close" aria-label={copy.v2.close}><CloseIcon size={18} aria-hidden="true" /></DialogClose>
      </header>
      <div className="v2-page-help-body">
        <div className="v2-page-help-topics" role="group" aria-label={text.helpCommon}>
          <p>{text.helpCommon}</p>
          <div className="v2-page-help-topic-list">{topics.map((topic) => <div key={topic}>
            <button type="button" aria-expanded={selectedTopic === topic} onClick={() => setSelection(selectedTopic === topic ? null : { question: topic, topic: true })}>{topic}<NextIcon size={14} aria-hidden="true" /></button>
            {selectedTopic === topic && answerPanel}
          </div>)}</div>
        </div>
        <form className="v2-page-help-form" onSubmit={(event) => { event.preventDefault(); setSelection({ question: question.trim(), topic: false }) }}>
          <label htmlFor={questionId}>{text.helpPrompt}</label>
          <div className="v2-page-help-search">
            <input id={questionId} className="v2-input" type="search" value={question} maxLength={300} required placeholder={text.helpExamples[props.page]} onChange={(event) => setQuestion(event.currentTarget.value)} />
            <button type="submit" className="v2-button v2-button-secondary" disabled={!question.trim()}><SearchIcon size={16} aria-hidden="true" />{text.findHelp}</button>
          </div>
        </form>
        {!selectedTopic && answerPanel}
        <div role="status" className="sr-only">{reply}</div>
      </div>
    </DialogContent>
  </Dialog>
}

type Answer = { faq?: string; message?: string; section?: V2Section; action?: () => void; label?: string }
const officialPolicy = /退款|发货|购买|订单|多久.*收到|兑换码.*没收到|补偿|封号|冻结|账号限制|档案限制|风控|代练|转售|续费|续期/

function matchQuestion(question: string, props: Props, purchaseAvailable: boolean): Answer | null {
  if (officialPolicy.test(question)) {
    if (/退款|发货|订单|多久.*收到|兑换码.*没收到|补偿/.test(question)) return { section: 'support' }
    if (/冻结|封号|风控|限制/.test(question)) return { faq: 'risk-review', section: 'support' }
    if (/代练|转售/.test(question)) return { faq: 'personal-use' }
    if (/续费|续期/.test(question)) return { faq: 'profile-expiry', section: 'pricing' }
    return { message: purchaseAvailable ? copy.public.purchase.description : undefined, section: 'pricing' }
  }
  if (props.page === 'result' && /图片|截图/.test(question)) {
    return { message: text.exportImage, action: props.onOpenExport, label: text.openExport }
  }
  if (/导出|\bmaa\b|体验券/i.test(question)) {
    if (props.maaAvailable === false) return { faq: 'coupons', message: text.exportUnavailable, section: 'plans' }
    if (props.maaDirect) return { message: copy.optimize.maa_export.direct, action: props.onOpenExport, label: text.openExport }
    if (props.couponBalance === 0) return { faq: 'coupons', message: props.page === 'inventory' ? text.inventoryNoExportCoupon : text.noExportCoupon, section: props.page === 'inventory' ? undefined : 'inventory' }
    if (props.page === 'result' && props.couponBalance === undefined) return props.inventoryIssue
      ? { message: copy.optimize.maa_export.failed, section: 'inventory' }
      : { message: copy.optimize.maa_export.checking }
    return { faq: 'coupons', message: text.exportCoupon, section: props.onOpenExport ? undefined : 'plans', action: props.onOpenExport, label: text.openExport }
  }
  if (props.page === 'inventory' && /道具.*(哪里|在哪|怎么用|如何使用)/.test(question)) {
    return { message: text.inventoryUse }
  }
  if (/授权|绑定|凭据|失败|重试|超时/.test(question) && (props.recoveryAction === 'reauthorize' || props.errorCode === 'skland_credential_invalid' || (props.credentialInvalid && (props.page === 'skland' || !props.failure || /授权|绑定|凭据/.test(question))))) {
    return { faq: 'import-failure', message: text.authorize, section: props.onAuthorize ? undefined : 'skland', action: props.onAuthorize, label: copy.skland.bind }
  }
  if (/干员|练度/.test(question) && !/库存|背包/.test(question)) return { faq: 'missing-operators', section: 'skland' }
  if (/库存|背包|同步|刷新/.test(question) && (props.page === 'skland' || /库存|森空岛|干员/.test(question))) {
    return { faq: 'partial-import', message: props.inventoryIssue ? text.inventoryOld : text.inventoryCheck, section: props.page === 'skland' ? undefined : 'skland',
      action: props.onRefreshInventory, label: copy.skland.refresh }
  }
  if (/干员|练度|导入/.test(question)) return { faq: 'missing-operators', section: 'skland' }
  if (/授权|绑定|凭据/.test(question) && !props.failure) return { faq: 'import-failure', section: 'skland' }
  if (props.page === 'generation' && /失败|重试|超时|排队|进度|没反应|生成|开始|授权/.test(question)) {
    if (props.saveFailed) return { faq: 'config-validation', message: text.retryConfig, action: props.onRetrySave, label: copy.optimize.generation.retry_save }
    if (props.running) return { faq: 'waiting', message: text.waitForJob }
    if (!props.failure && /排队|进度/.test(question)) return { faq: 'waiting' }
    if (props.recoveryAction === 'contact_support') return { faq: 'task-failure', message: text.contactTaskSupport, section: 'support' }
    if (props.recoveryAction === 'review_input') return { faq: 'config-validation', message: text.reviewTaskInput, action: props.onConfig, label: copy.v2.configure }
    if (props.recoveryAction === 'retry') return { faq: 'task-failure', message: text.retryJob, action: props.onRetryJob, label: copy.v2.generationPage.retry }
    return { faq: props.failure ? 'task-failure' : 'config-validation', message: props.failure ? text.retryJob : undefined }
  }
  return null
}
