import { useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../../../lib/types'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import { formatDate, getProfileAccessLabel, isFreePreviewProfile } from '../tool-utils'
import { copy } from '../../../copy/index'
import { usePersonalUseDeclaration } from '../../../hooks/usePersonalUseDeclaration'



export default function ProfilesSection({
  profiles,
  openingProfileId,
  onOpen,
  onEdit,
  meteredEnabled = false,
}: {
  profiles: UserGameAccount[]
  openingProfileId: string | null
  onOpen: (profile: UserGameAccount) => void
  onEdit: (payload: AuthSuccessResponse) => void
  meteredEnabled?: boolean
}) {
  const [meteredBusy, setMeteredBusy] = useState(false)
  const [meteredError, setMeteredError] = useState<string | null>(null)
  const { guard: guardPersonalUseDeclaration, declarationDialog } = usePersonalUseDeclaration({
    enabled: meteredEnabled,
    onError: setMeteredError,
  })
  const submitMetered = async (profileId?: string) => {
    setMeteredBusy(true); setMeteredError(null)
    try {
      await apiJson('/api/user/profiles/metered-personal', {
        method: 'POST', json: profileId ? { profile_id: profileId } : {},
        fallbackMessage: copy.metered.personal_profiles.open_failed,
      })
      onEdit(await apiJson<AuthSuccessResponse>('/api/user/profiles'))
    } catch (caught) { setMeteredError(getApiErrorMessage(caught, copy.metered.personal_profiles.open_failed)) }
    finally { setMeteredBusy(false) }
  }
  const createMetered = (profileId?: string) => {
    void guardPersonalUseDeclaration(
      'metered_personal_create',
      () => submitMetered(profileId),
      profileId ?? null,
    )
  }
  if (profiles.length === 0) {
    return (
<><section className="tool-panel p-6">
<h2 className="text-lg font-semibold text-ink-primary">{copy.dashboard.pages_tool_dashboard_ProfilesSection_001}</h2>
<p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.dashboard.pages_tool_dashboard_ProfilesSection_002}</p>
{meteredEnabled && <button type="button" disabled={meteredBusy} onClick={() => createMetered()} className="tool-primary-action mt-4">{copy.metered.personal_profiles.create}</button>}
{meteredError && <div className="tool-alert tool-alert--error mt-3">{meteredError}</div>}
</section>{declarationDialog}</>
    )
  }
  return (
    <div className="space-y-4">
      {meteredEnabled && <section className="tool-panel p-5 sm:p-6"><h2 className="font-semibold text-ink-primary">{copy.metered.personal_profiles.title}</h2><p className="mt-2 text-sm text-ink-secondary">{copy.metered.personal_profiles.description}</p>{!profiles.some((profile) => profile.kind === 'metered_personal') && <button type="button" disabled={meteredBusy} onClick={() => createMetered()} className="tool-secondary-action mt-4">{copy.metered.personal_profiles.create}</button>}{meteredError && <div className="tool-alert tool-alert--error mt-3">{meteredError}</div>}</section>}
    <section className="grid gap-4 xl:grid-cols-2">
      {profiles.map((profile, index) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          fallbackName={`${copy.dashboard.pages_tool_dashboard_ProfilesSection_003}${index + 1}`}
          opening={openingProfileId === profile.id}
          onOpen={() => onOpen(profile)}
          onSaved={onEdit}
          onConvert={() => createMetered(profile.id)}
          meteredEnabled={meteredEnabled}
          converting={meteredBusy}
        />
      ))}
    </section>{declarationDialog}</div>
  )
}

function ProfileCard({
  profile,
  fallbackName,
  opening,
  onOpen,
  onSaved,
  onConvert,
  converting,
  meteredEnabled,
}: {
  profile: UserGameAccount
  fallbackName: string
  opening: boolean
  onOpen: () => void
  onSaved: (payload: AuthSuccessResponse) => void
  onConvert: () => void
  converting: boolean
  meteredEnabled: boolean
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
        fallbackMessage: copy.dashboard.pages_tool_dashboard_ProfilesSection_004,
      })
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.dashboard.pages_tool_dashboard_ProfilesSection_005))
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
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{profile.note || (isFreePreviewProfile(profile) ? copy.dashboard.pages_tool_dashboard_ProfilesSection_006 : copy.dashboard.pages_tool_dashboard_ProfilesSection_007)}</p>
          <p className="mt-3 text-xs text-ink-muted">{profile.operator_count} {copy.dashboard.pages_tool_dashboard_ProfilesSection_008}{formatDate(profile.updated_at)}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="tool-primary-action disabled:cursor-wait"
        >
          {opening ? copy.dashboard.pages_tool_dashboard_ProfilesSection_009 : copy.dashboard.pages_tool_dashboard_ProfilesSection_010}
        </button>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="tool-secondary-action mt-4 px-3 text-sm" aria-expanded={editing}>{copy.dashboard.pages_tool_dashboard_ProfilesSection_011}</button>
      {meteredEnabled && isFreePreviewProfile(profile) && <button type="button" onClick={onConvert} disabled={converting} className="tool-secondary-action ml-2 mt-4 px-3 text-sm">{copy.metered.personal_profiles.convert}</button>}
      {editing && (
        <div className="tool-inset mt-4 space-y-3 p-4">
          {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
          <input aria-label={copy.dashboard.pages_tool_dashboard_ProfilesSection_012} value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.currentTarget.value)} className="tool-field" />
          <textarea aria-label={copy.dashboard.pages_tool_dashboard_ProfilesSection_013} value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.currentTarget.value)} className="tool-field resize-y" placeholder={copy.dashboard.pages_tool_dashboard_ProfilesSection_014} />
          <button type="button" onClick={() => void save()} className="tool-primary-action">{copy.dashboard.pages_tool_dashboard_ProfilesSection_015}</button>
        </div>
      )}
    </article>
  )
}
