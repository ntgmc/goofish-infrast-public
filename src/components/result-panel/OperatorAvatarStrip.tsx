import { useState } from 'react'
import { Link2, Plus } from 'lucide-react'
import { copy } from '../../copy'
import type { RoomOperator } from './types'
import { operatorProfession, RECOVERY_SUPPORT_ICON_SRC } from './building-skills'

export default function OperatorAvatarStrip({
  operators,
  fallbackText,
  compact = false,
  micro = false,
  showFullNames = false,
  large = false,
  buttonChild = false,
  showProfession = false,
}: {
  operators: RoomOperator[];
  fallbackText: string;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
  large?: boolean;
  buttonChild?: boolean;
  showProfession?: boolean;
}) {
  if (operators.length === 0) {
    return <p className="text-sm leading-6 text-ink-secondary">{fallbackText}</p>
  }

  const gapClassName = micro ? 'gap-1.5' : compact ? 'gap-2' : 'gap-2.5'

  return (
    <div className={`flex flex-wrap ${gapClassName}`} aria-label={fallbackText}>
      {operators.map((operator, index) => (
        <OperatorAvatarTile
          key={`${operator.id || operator.name}-${index}`}
          operator={operator}
          compact={compact}
          micro={micro}
          showFullNames={showFullNames}
          large={large}
          buttonChild={buttonChild}
          showProfession={showProfession}
        />
      ))}
    </div>
  )
}

export function OperatorAvatarTile({
  operator,
  placeholder = '',
  compact = false,
  micro = false,
  showFullNames = false,
  large = false,
  buttonChild = false,
  showProfession = false,
}: {
  operator?: RoomOperator;
  placeholder?: string;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
  large?: boolean;
  buttonChild?: boolean;
  showProfession?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const canLoadImage = Boolean(operator?.id && !imageFailed)
  const name = operator?.name ?? placeholder
  const avatarSize = large ? 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]' : micro ? 'h-8 w-8' : compact ? 'h-10 w-10' : 'h-11 w-11'
  const tileWidth = large ? 'w-16 sm:w-[4.5rem]' : micro ? showFullNames ? 'w-14' : 'w-9' : compact ? 'w-12' : 'w-[3.25rem]'
  const labelClassName = [
    large ? 'mt-1.5 text-xs leading-4' : micro ? 'mt-0.5 text-[10px] leading-3' : 'mt-1 text-[11px] leading-4',
    showFullNames ? 'whitespace-normal break-words' : 'truncate',
    'block font-medium text-ink-secondary',
  ].join(' ')
  const initial = name.trim().slice(0, 1) || '?'
  const profession = showProfession && operator ? operatorProfession(operator) : undefined

  return (
    <div className={`${tileWidth} min-w-0 text-center`} title={operator ? undefined : name}
      data-operator-name={operator?.name} data-operator-id={operator?.id}
      data-operator-elite={operator?.elite} data-operator-level={operator?.level}
      tabIndex={operator && !buttonChild ? 0 : undefined}>
      <div className={`relative mx-auto overflow-hidden rounded-md border border-surface-3 bg-surface-2 ${operator ? '' : 'border-dashed'} ${avatarSize}`}>
        {canLoadImage ? (
          <img
            src={`/webp96/${operator?.id}.webp`}
            alt=""
            width={large ? 72 : micro ? 32 : compact ? 40 : 44}
            height={large ? 72 : micro ? 32 : compact ? 40 : 44}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-ink-muted" aria-hidden="true">
            {operator ? initial : <Plus size={24} />}
          </div>
        )}
        {profession && (
          <img src={`/operator-professions/${profession}.png`} alt={copy.domain.result_board_v2.professions[profession]}
            title={copy.domain.result_board_v2.professions[profession]}
            className={`absolute right-0 top-0 rounded-bl bg-zinc-950/85 p-0.5 ${large ? 'h-6 w-6' : micro ? 'h-3 w-3' : 'h-4 w-4'}`} />
        )}
        {operator?.crossStation && (
          <span
            role="img"
            aria-label={copy.domain.result_board_v2.cross_station}
            title={copy.domain.result_board_v2.cross_station_hint}
            className={`absolute left-0 top-0 flex items-center justify-center rounded-br bg-surface-1 text-brand-400 ${large ? 'h-5 w-5' : micro ? 'h-3 w-3' : 'h-4 w-4'}`}>
            <Link2 size={large ? 16 : micro ? 10 : 12} aria-hidden="true" />
          </span>
        )}
        {operator?.recoverySupport && (
          <img
            src={RECOVERY_SUPPORT_ICON_SRC}
            alt={copy.domain.result_board_v2.recovery_support}
            title={copy.domain.result_board_v2.recovery_support_hint}
            className={`absolute bottom-0 right-0 ${large ? 'h-5 w-5' : micro ? 'h-3 w-3' : 'h-4 w-4'}`}
          />
        )}
      </div>
      <span className={labelClassName}>
        {name}
      </span>
    </div>
  )
}
