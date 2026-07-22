import { useEffect, useState, type FormEvent } from 'react'
import AnnouncementBodyEditor from '../../../components/AnnouncementBodyEditor'
import type { Announcement, AnnouncementStats } from '../../../lib/types'
import {
  AnnouncementReachMetrics,
  EMPTY_ANNOUNCEMENT_REACH_STATS,
  formatDate,
} from '../modules'
import { SortableMasterDetailList } from '../shared/SortableMasterDetailList'

interface AnnouncementSettingsSectionProps {
  banner: Announcement
  announcements: Announcement[]
  stats: Record<string, AnnouncementStats>
  saving: boolean
  onSubmit: (event: FormEvent) => void
  onUpdateBanner: (patch: Partial<Pick<Announcement, 'active' | 'title' | 'body'>>) => void
  onAdd: () => string
  onUpdate: (id: string, patch: Partial<Pick<Announcement, 'active' | 'title' | 'body'>>) => void
  onDelete: (id: string) => void
  onReorder: (from: number, to: number) => void
}

export default function AnnouncementSettingsSection({
  banner,
  announcements,
  stats,
  saving,
  onSubmit,
  onUpdateBanner,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
}: AnnouncementSettingsSectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(() => announcements[0]?.id ?? null)
  const selectedIndex = announcements.findIndex((item) => item.id === selectedId)
  const selected = selectedIndex >= 0 ? announcements[selectedIndex] : null

  useEffect(() => {
    if (selectedId && announcements.some((item) => item.id === selectedId)) return
    setSelectedId(announcements[0]?.id ?? null)
  }, [announcements, selectedId])

  const addAnnouncement = () => setSelectedId(onAdd())
  const deleteSelected = () => {
    if (!selected) return
    const next = announcements[selectedIndex + 1] ?? announcements[selectedIndex - 1]
    onDelete(selected.id)
    setSelectedId(next?.id ?? null)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="tool-panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">全局横幅</h2>
            <p className="mt-1 text-sm text-ink-secondary">横幅全站只保留一个，独立显示，不进入普通公告列表和未读统计。</p>
          </div>
          <label className="tool-inset flex min-h-11 items-center gap-2 px-3 text-sm font-medium text-ink-secondary">
            <input type="checkbox" checked={banner.active} onChange={(event) => onUpdateBanner({ active: event.currentTarget.checked })} className="h-4 w-4 accent-brand-600" />
            启用横幅
          </label>
        </div>
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">横幅标题</span>
          <input value={banner.title} maxLength={80} onChange={(event) => onUpdateBanner({ title: event.currentTarget.value })} className="tool-field" />
        </label>
        <AnnouncementBodyEditor id="announcement-banner" value={banner.body} onChange={(body) => onUpdateBanner({ body })} />
        <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(banner.updated_at)}</p>
      </section>

      <section className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">弹出式公告</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">拖动手柄改变前台展示顺序；点选公告后在右侧编辑详细内容。</p>
          </div>
          <button type="button" onClick={addAnnouncement} className="tool-secondary-action px-3 text-sm">新增弹出式公告</button>
        </div>

        <div className="mt-5">
          <SortableMasterDetailList
            items={announcements.map((item) => ({
              id: item.id,
              title: item.title,
              description: item.body,
              meta: `${item.active ? '已启用' : '未启用'} · ${formatDate(item.updated_at)}`,
            }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReorder={(from, to) => onReorder(from, to)}
            ariaLabel="弹出式公告列表"
            emptyLabel="还没有弹出式公告。新增后保存即可生效。"
            detail={selected ? (
              <article className="tool-inset p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tool-status">弹出式公告</span>
                    <label className="tool-inset flex min-h-11 items-center gap-2 px-3 text-sm font-medium text-ink-secondary">
                      <input type="checkbox" checked={selected.active} onChange={(event) => onUpdate(selected.id, { active: event.currentTarget.checked })} className="h-4 w-4 accent-brand-600" />
                      启用
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={selectedIndex === 0} onClick={() => onReorder(selectedIndex, selectedIndex - 1)} className="tool-secondary-action px-3 text-sm">上移</button>
                    <button type="button" disabled={selectedIndex === announcements.length - 1} onClick={() => onReorder(selectedIndex, selectedIndex + 1)} className="tool-secondary-action px-3 text-sm">下移</button>
                    <button type="button" onClick={deleteSelected} className="tool-secondary-action border-error/40 bg-error/10 px-3 text-sm text-error">删除</button>
                  </div>
                </div>

                <AnnouncementReachMetrics stats={stats[selected.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS} />
                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">标题</span>
                  <input value={selected.title} maxLength={80} onChange={(event) => onUpdate(selected.id, { title: event.currentTarget.value })} className="tool-field" />
                </label>
                <AnnouncementBodyEditor id={`announcement-${selected.id}`} value={selected.body} onChange={(body) => onUpdate(selected.id, { body })} />
                <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(selected.updated_at)}</p>
              </article>
            ) : <div className="tool-inset border-dashed p-6 text-sm text-ink-muted">请从左侧列表选择一条公告查看和编辑详细内容。</div>}
          />
        </div>

        <button type="submit" disabled={saving} className="tool-primary-action mt-5">{saving ? '保存中…' : '保存横幅和公告'}</button>
      </section>
    </form>
  )
}
