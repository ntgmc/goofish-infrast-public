import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { copy } from '../../../copy/index'

interface SortableMasterItem {
  id: string
  title: string
  description?: string
  meta?: string
}

interface SortableMasterDetailListProps {
  items: SortableMasterItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onReorder: (from: number, to: number, activeId: string) => void
  ariaLabel: string
  emptyLabel?: string
  detail: React.ReactNode
}

export function SortableMasterDetailList({
  items,
  selectedId,
  onSelect,
  onReorder,
  ariaLabel,
  emptyLabel = copy.publicContent.admin_empty_list,
  detail,
}: SortableMasterDetailListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from < 0 || to < 0) return
    onReorder(from, to, String(active.id))
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.42fr)]">
      <div className="tool-inset min-w-0 p-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-surface-3 p-4 text-sm text-ink-muted">{emptyLabel}</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{
              screenReaderInstructions: {
                draggable: copy.publicContent.admin_drag_instructions,
              },
            }}
          >
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2" role="list" aria-label={ariaLabel}>
                {items.map((item) => (
                  <SortableMasterRow
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onSelect={() => onSelect(item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="min-w-0">{detail}</div>
    </div>
  )
}

function SortableMasterRow({ item, selected, onSelect }: { item: SortableMasterItem; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="listitem"
      className={`flex min-w-0 items-stretch rounded-xl border transition-colors ${selected ? 'border-brand-500/60 bg-brand-500/10' : 'border-surface-3 bg-surface-1 hover:border-surface-4'} ${isDragging ? 'z-20 opacity-70 shadow-xl' : ''}`}
    >
      <button
        type="button"
        className="flex min-h-14 w-11 shrink-0 touch-none items-center justify-center rounded-l-xl text-ink-muted hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70"
        aria-label={`${copy.publicContent.admin_drag_handle}：${item.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="min-w-0 flex-1 rounded-r-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70"
      >
        <span className="block truncate text-sm font-semibold text-ink-primary">{item.title || copy.publicContent.admin_untitled}</span>
        {item.description && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-ink-secondary">{item.description}</span>}
        {item.meta && <span className="mt-1 block text-[11px] text-ink-muted">{item.meta}</span>}
      </button>
    </div>
  )
}
