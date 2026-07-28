import { useEffect, useState } from 'react'
import { copy } from '../copy/index'

interface InputNumberProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  className?: string;
  onChange: (value: number) => void;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export default function InputNumber({
  id,
  label,
  value,
  min,
  max,
  disabled = false,
  className = '',
  onChange,
}: InputNumberProps) {
  const [draftValue, setDraftValue] = useState(() => String(value))

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const parsedDraft = Number(draftValue)
  const draftIsValid = draftValue.trim() !== '' && Number.isFinite(parsedDraft)
  const stepBase = draftIsValid ? clampInteger(parsedDraft, min, max) : value

  const commitValue = (nextValue: number) => {
    const boundedValue = clampInteger(nextValue, min, max)
    setDraftValue(String(boundedValue))
    if (boundedValue !== value) onChange(boundedValue)
  }

  const commitDraft = () => {
    if (disabled) return
    if (!draftIsValid) {
      setDraftValue(String(value))
      return
    }
    commitValue(parsedDraft)
  }

  return (
    <div className={`grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] ${className}`.trim()}>
      <button
        type="button"
        aria-label={`${copy.common.components_InputNumber_001}${label}`}
        disabled={disabled || stepBase <= min}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => commitValue(stepBase - 1)}
        className="tool-secondary-action rounded-r-none px-0 text-lg"
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        id={id}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={1}
        value={draftValue}
        disabled={disabled}
        onChange={(event) => setDraftValue(event.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="number-input-clean tool-field -ml-px min-w-0 rounded-none px-2 text-center disabled:text-ink-muted"
      />
      <button
        type="button"
        aria-label={`${copy.common.components_InputNumber_002}${label}`}
        disabled={disabled || stepBase >= max}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => commitValue(stepBase + 1)}
        className="tool-secondary-action -ml-px rounded-l-none px-0 text-lg"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}
