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
<section className="tool-panel p-6">
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
    <article className="tool-panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink-primary">{profile.display_name || fallbackName}</h2>
            <span className={`tool-status ${isFreePreviewProfile(profile) ? 'tool-status--warning' : 'tool-status--current'}`}>{getProfileAccessLabel(profile)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{profile.note || (isFreePreviewProfile(profile) ? '免费个人排班可查看完整游戏内轮换，但不提供导出和高级分析。' : '暂无备注')}</p>
          <p className="mt-3 text-xs text-ink-muted">{profile.operator_count} 名干员 · 更新 {formatDate(profile.updated_at)}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="tool-primary-action disabled:cursor-wait"
        >
          {opening ? '正在准备...' : '准备这个账号'}
        </button>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="tool-secondary-action mt-4 px-3 text-sm" aria-expanded={editing}>修改名称和备注</button>
      {editing && (
        <div className="tool-inset mt-4 space-y-3 p-4">
          {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
          <input aria-label="档案名称" value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.currentTarget.value)} className="tool-field" />
          <textarea aria-label="档案备注" value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.currentTarget.value)} className="tool-field resize-y" placeholder="给这个账号写点备注" />
          <button type="button" onClick={() => void save()} className="tool-primary-action">保存</button>
        </div>
      )}
    </article>
  )
}
