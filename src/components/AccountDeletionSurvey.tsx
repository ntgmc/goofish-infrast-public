import { useId } from 'react'
import { copy } from '../copy'
import { ACCOUNT_DELETION_DETAIL_MAX_LENGTH, ACCOUNT_DELETION_REASONS, type AccountDeletionSurvey as Survey } from '../lib/account-deletion-contracts'

export default function AccountDeletionSurvey({ reason, detail, onReasonChange, onDetailChange, fieldClassName = 'tool-field' }: {
  reason: Survey['reason'] | ''
  detail: string
  onReasonChange: (reason: Survey['reason'] | '') => void
  onDetailChange: (detail: string) => void
  fieldClassName?: string
}) {
  const helpId = useId()
  const text = copy.dashboard.settings
  return <div className="grid min-w-0 gap-3">
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{text.deletion_reason}</span>
      <select required value={reason} onChange={(event) => onReasonChange(event.target.value as Survey['reason'] | '')} className={fieldClassName}>
        <option value="" disabled>{text.deletion_reason_placeholder}</option>
        {ACCOUNT_DELETION_REASONS.map((value) => <option key={value} value={value}>{text.deletion_reasons[value]}</option>)}
      </select>
    </label>
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{text.deletion_detail}</span>
      <textarea value={detail} onChange={(event) => onDetailChange(event.target.value)} maxLength={ACCOUNT_DELETION_DETAIL_MAX_LENGTH} rows={3} aria-describedby={helpId} className={`${fieldClassName} resize-y`} />
    </label>
    <p id={helpId} className="text-sm leading-6 text-ink-secondary">{text.deletion_survey_help}</p>
  </div>
}
