import { useEffect, useRef, type KeyboardEvent } from 'react'

export function AdminTabs<T extends string>({ label, items, value, onChange, disabled = false }: {
  label: string
  items: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (list && selected) list.scrollLeft = selected.offsetLeft - (list.clientWidth - selected.clientWidth) / 2
  }, [value])

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length
      : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onChange(items[next].id)
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next].focus()
  }
  return <div ref={listRef} className="admin-tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => <button key={item.id} type="button" role="tab" disabled={disabled} aria-selected={item.id === value}
      tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={(event) => move(event, index)}>{item.label}</button>)}
  </div>
}
