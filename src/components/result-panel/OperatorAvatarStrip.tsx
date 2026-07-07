import { useState } from 'react'
import type { RoomOperator } from './types'

export default function OperatorAvatarStrip({
  operators,
  fallbackText,
  compact = false,
  micro = false,
  showFullNames = false,
}: {
  operators: RoomOperator[];
  fallbackText: string;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
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
        />
      ))}
    </div>
  )
}

function OperatorAvatarTile({
  operator,
  compact = false,
  micro = false,
  showFullNames = false,
}: {
  operator: RoomOperator;
  compact?: boolean;
  micro?: boolean;
  showFullNames?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const canLoadImage = Boolean(operator.id && !imageFailed)
  const avatarSize = micro ? 'h-8 w-8' : compact ? 'h-10 w-10' : 'h-11 w-11'
  const tileWidth = micro ? showFullNames ? 'w-14' : 'w-9' : compact ? 'w-12' : 'w-[3.25rem]'
  const labelClassName = [
    micro ? 'mt-0.5 text-[10px] leading-3' : 'mt-1 text-[11px] leading-4',
    showFullNames ? 'whitespace-normal break-words' : 'truncate',
    'block font-medium text-ink-secondary',
  ].join(' ')
  const initial = operator.name.trim().slice(0, 1) || '?'

  return (
    <div className={`${tileWidth} min-w-0 text-center`} title={operator.name}>
      <div className={`mx-auto overflow-hidden rounded-md border border-surface-3 bg-surface-2 ${avatarSize}`}>
        {canLoadImage ? (
          <img
            src={`/webp96/${operator.id}.webp`}
            alt=""
            width={micro ? 32 : compact ? 40 : 44}
            height={micro ? 32 : compact ? 40 : 44}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-ink-muted" aria-hidden="true">
            {initial}
          </div>
        )}
      </div>
      <span className={labelClassName}>
        {operator.name}
      </span>
    </div>
  )
}
