import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { MaterialIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import itemCatalog from '../../../data/skland-items.json'
import { matchesSearch } from '../../../lib/search'
import { Notice } from '../components/WorkspaceUI'

const text = copy.skland
const catalog: Record<string, { name: string; icon?: string; group: string; sort: number }> = itemCatalog
const manualIds = ['4002', '4003', '4004', '4005', '7004', '7003', '7001', 'classic_normal_ticket', 'classic_gacha'] as const
const manualSchema = z.partialRecord(z.enum(manualIds), z.number().int().min(0).max(1e12))
const groups = ['resources', 'materials', 'upgrades', 'other'] as const

export default function SklandBackpack({ items, names, userId, uid }: {
  items: Record<string, number> | null
  names: Record<string, string>
  userId: string
  uid: string
}) {
  const [search, setSearch] = useState('')
  const visible = Object.entries(items ?? {}).filter(([id]) => matchesSearch(`${names[id] ?? catalog[id]?.name ?? ''} ${id}`, search))
    .sort(([left], [right]) => (catalog[left]?.sort ?? Infinity) - (catalog[right]?.sort ?? Infinity)
      || (names[left] ?? catalog[left]?.name ?? '').localeCompare(names[right] ?? catalog[right]?.name ?? '', 'zh-CN', { numeric: true }))
  return <>
    <ManualResources key={JSON.stringify([userId, uid])} userId={userId} uid={uid} items={items} />
    {!items ? <Notice>{text.noInventory}</Notice> : <section className="v2-panel min-w-0 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><label className="v2-field min-w-0 w-full sm:w-auto sm:flex-1 sm:max-w-sm"><span>{text.search}</span><input type="search" className="v2-input" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="text-sm text-ink-secondary">{text.itemCount(visible.length)}</span></div>
      <div className="space-y-6">{groups.map((group) => {
        const entries = visible.filter(([id]) => (catalog[id]?.group ?? 'other') === group)
        return entries.length > 0 && <section key={group} aria-label={text.itemGroups[group]}>
          <h2 className="mb-3 border-b border-surface-3 pb-3 font-semibold">{text.itemGroups[group]}</h2>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{entries.map(([id, count]) => <div key={id} className="tool-inset flex min-w-0 items-center gap-3 p-3">
            <dt className="flex min-w-0 flex-1 items-center gap-3 text-sm"><ItemArt id={id} /><span className="min-w-0 break-words">{names[id] ?? catalog[id]?.name ?? text.unnamedItem}</span></dt>
            <dd className="shrink-0 font-semibold tabular-nums">{count.toLocaleString('zh-CN')}</dd>
          </div>)}</dl>
        </section>
      })}</div>
      {!visible.length && <p className="py-6 text-sm text-ink-secondary">{text.noItems}</p>}
    </section>}
  </>
}

function ItemArt({ id }: { id: string }) {
  const icon = catalog[id]?.icon
  const [failed, setFailed] = useState(false)
  return <span className="grid size-12 shrink-0 place-items-center" aria-hidden="true">
    {icon && !failed ? <img src={`/item-icons/${encodeURIComponent(icon)}.png`} alt="" width={48} height={48} className="size-12 object-contain" loading="lazy" onError={() => setFailed(true)} />
      : <MaterialIcon size={28} className="text-ink-muted" />}
  </span>
}

function ManualResources({ userId, uid, items }: { userId: string; uid: string; items: Record<string, number> | null }) {
  const storageKey = `maatool:skland-manual:v1:${JSON.stringify([userId, uid])}`
  const [initial] = useState(() => {
    try {
      const values = manualSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? '{}'))
      return { values: Object.fromEntries(Object.entries(values).map(([id, count]) => [id, String(count)])), error: '' }
    } catch { return { values: {} as Record<string, string>, error: text.manualLoadFailed } }
  })
  const [values, setValues] = useState(initial.values)
  const [notice, setNotice] = useState(initial.error)
  const [failed, setFailed] = useState(Boolean(initial.error))
  const missing = manualIds.filter((id) => items?.[id] == null)
  if (!missing.length) return null
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = manualSchema.safeParse(Object.fromEntries(Object.entries(values).filter(([, count]) => count.trim() !== '').map(([id, count]) => [id, Number(count)])))
    if (!parsed.success) { setFailed(true); setNotice(text.manualInvalid); return }
    try {
      localStorage.setItem(storageKey, JSON.stringify(parsed.data))
      setFailed(false)
      setNotice(text.manualSaved)
    } catch { setFailed(true); setNotice(text.manualSaveFailed) }
  }
  return <section className="v2-panel min-w-0 p-5 sm:p-6" aria-labelledby="skland-manual-resources">
    <h2 id="skland-manual-resources" className="mb-2 font-semibold">{text.manualResources}</h2>
    <p className="text-sm leading-6 text-ink-secondary">{text.inventoryHelp}</p>
    <form className="mt-5" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{missing.map((id) => <label key={id} className="tool-inset flex min-w-0 items-center gap-3 p-3">
        <ItemArt id={id} /><span className="v2-field min-w-0 flex-1"><span>{catalog[id].name}</span>
          <input type="number" inputMode="numeric" min="0" max="1000000000000" step="1" className="v2-input tabular-nums" placeholder={text.notRecorded} value={values[id] ?? ''}
            onChange={(event) => { setValues({ ...values, [id]: event.target.value }); setNotice('') }} />
        </span>
      </label>)}</div>
      <div className="mt-4 flex flex-wrap items-center gap-4"><button type="submit" className="v2-button v2-button-secondary">{text.saveResources}</button>
        {notice && <p role={failed ? 'alert' : 'status'} className={`text-sm ${failed ? 'text-error' : 'text-ink-secondary'}`}>{notice}</p>}
      </div>
    </form>
  </section>
}
