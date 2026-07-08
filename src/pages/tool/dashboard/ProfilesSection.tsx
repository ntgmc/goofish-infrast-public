import { useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../../../lib/types'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import { formatDate, getProfileAccessLabel, isFreePreviewProfile } from '../tool-utils'


export default function ProfilesSection({
  profiles,
  openingProfileId,
  onOpen,
  onEdit,
}: {
  profiles: UserGameAccount[]
  openingProfileId: string | null
  onOpen: (profile: UserGameAccount) => void
  onEdit: (payload: AuthSuccessResponse) => void
}) {
  if (profiles.length === 0) {
    return (
<section className="rounded-xl border border-surface-3 bg-surface-1 p-6">
<h2 className="text-lg font-semibold text-ink-primary">还没有添加游戏账号</h2>
<p className="mt-2 text-sm leading-6 text-ink-secondary">可以在“添加账号”里创建免费预览，或输入未使用的 CDK 添加正式游戏账号。</p>
</section>
    )
  }
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {profiles.map((profile, index) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          fallbackName={`账号 ${index + 1}`}
          opening={openingProfileId === profile.id}
          onOpen={() => onOpen(profile)}
          onSaved={onEdit}
        />
      ))}
    </section>
  )
}

function ProfileCard({
  profile,
  fallbackName,
  opening,
  onOpen,
  onSaved,
}: {
  profile: UserGameAccount
  fallbackName: string
  opening: boolean
  onOpen: () => void
  onSaved: (payload: AuthSuccessResponse) => void
}) {
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(profile.display_name || fallbackName)
  const [note, setNote] = useState(profile.note)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    let data: AuthSuccessResponse
    try {
      data = await apiJson<AuthSuccessResponse>('/api/user/profiles', {
        method: 'PATCH',
        json: { profile_id: profile.id, display_name: displayName, note },
        fallbackMessage: '保存失败',
      })
    } catch (caught) {
      setError(getApiErrorMessage(caught, '保存失败'))
      return
    }
    onSaved(data)
    setEditing(false)
  }

  return (
    <article className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink-primary">{profile.display_name || fallbackName}</h2>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${isFreePreviewProfile(profile) ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-brand-300'}`}>{getProfileAccessLabel(profile)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{profile.note || (isFreePreviewProfile(profile) ? '免费个人排班可查看完整游戏内轮换，但不提供导出和高级分析。' : '暂无备注')}</p>
          <p className="mt-3 text-xs text-ink-muted">{profile.operator_count} 名干员 · 更新 {formatDate(profile.updated_at)}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-wait disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {opening ? '正在准备...' : '准备这个账号'}
        </button>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="mt-4 text-sm font-semibold text-brand-400 hover:text-brand-300">修改名称和备注</button>
      {editing && (
        <div className="mt-4 space-y-3 rounded-lg bg-surface-2 p-4">
          {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
          <input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" />
          <textarea value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="给这个账号写点备注" />
          <button type="button" onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">保存</button>
        </div>
      )}
    </article>
  )
}
