import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { copy } from '../../copy/index'
import type { UserGameAccount } from '../../lib/types'
import { waitForModalAvailability } from './ProfileUpgradePrompt'
import { formatShanghaiDateTime, isFreePreviewTrialActive } from './tool-utils'

const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = 'maatool:profile-expiry-prompt:v1:'

interface Props {
  userId: string
  profiles: UserGameAccount[]
  onOpenExport: (profile: UserGameAccount) => void
}

export default function ProfileExpiryPrompt({ userId, profiles, onOpenExport }: Props) {
  const [now, setNow] = useState(Date.now)
  const [dismissed, setDismissed] = useState<Record<string, string>>({})
  const [openKey, setOpenKey] = useState<string | null>(null)
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const reminder = profiles
    .flatMap((profile) => {
      if (profile.status !== 'active' || profile.archived_at) return []
      const expiresAt = profile.kind === 'cdk'
        ? profile.expires_at
        : isFreePreviewTrialActive(profile) ? profile.trial?.ends_at : null
      if (!expiresAt) return []
      const expires = Date.parse(expiresAt)
      const remaining = expires - now
      if (!(remaining > 0 && remaining <= REMINDER_WINDOW_MS)) return []
      const key = `${STORAGE_PREFIX}${userId}:${profile.id}:${expiresAt}`
      if (dismissed[key] === day) return []
      try {
        if (window.localStorage.getItem(key) === day) return []
      } catch {
        // Browser storage is optional; keep reminding until dismissed in this session.
      }
      return [{ profile, expiresAt, expires, key }]
    })
    .sort((left, right) => left.expires - right.expires)[0]
  const key = reminder?.key ?? null

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    const refresh = () => setNow(Date.now())
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    setOpenKey(null)
    if (key) return waitForModalAvailability(() => setOpenKey(key))
  }, [key])

  if (!reminder || !key) return null
  const { profile, expiresAt } = reminder

  const dismiss = () => {
    const dismissedDay = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    setDismissed((current) => ({ ...current, [key]: dismissedDay }))
    setOpenKey(null)
    try {
      window.localStorage.setItem(key, dismissedDay)
    } catch {
      // Keep the reminder dismissed in this session when browser storage is unavailable.
    }
  }

  return (
    <Dialog open={openKey === key} onOpenChange={(open) => { if (!open) dismiss() }}>
      <DialogContent showCloseButton closeLabel={copy.dashboard.profile_expiry.close}>
        <DialogTitle>{copy.dashboard.profile_expiry.title}</DialogTitle>
        <DialogDescription>
          {(isFreePreviewTrialActive(profile) ? copy.dashboard.profile_expiry.trial_description : copy.dashboard.profile_expiry.description)(
            profile.display_name || copy.dashboard.profile_expiry.unnamed,
            formatShanghaiDateTime(expiresAt),
          )}
        </DialogDescription>
        <div className="mt-3 flex flex-wrap justify-end gap-3">
          <button type="button" className="tool-secondary-action" onClick={dismiss}>
            {copy.dashboard.profile_expiry.dismiss}
          </button>
          <button type="button" className="tool-primary-action" onClick={() => { dismiss(); onOpenExport(profile) }}>
            {copy.dashboard.profile_expiry.export}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
