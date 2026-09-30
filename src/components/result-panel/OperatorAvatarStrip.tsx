import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { RoomOperator } from './types'

export default function OperatorAvatarStrip({
  operators,
  fallbackText,
  compact = false,
  micro = false,
  showFullNames = false,
  large = false,
}: {
  operators: RoomOperator[];
  fallbackText: string;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
  large?: boolean;
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
}: {
  operator?: RoomOperator;
  placeholder?: string;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
  large?: boolean;
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

  return (
    <div className={`${tileWidth} min-w-0 text-center`} title={name}>
      <div className={`mx-auto overflow-hidden rounded-md border border-surface-3 bg-surface-2 ${operator ? '' : 'border-dashed'} ${avatarSize}`}>
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
      </div>
      <span className={labelClassName}>
        {name}
      </span>
    </div>
  )
}
