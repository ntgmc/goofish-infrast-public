import { useCallback, useRef, useState } from 'react'
import PersonalUseDeclarationDialog from '../components/PersonalUseDeclarationDialog'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import type { PersonalUseDeclarationAction } from '../lib/personal-use-declaration'

type PendingOperation = {
  action: PersonalUseDeclarationAction
  profileId: string | null
  run: () => void | Promise<void>
}

type DeclarationStatus = {
  accepted: boolean
}

export function usePersonalUseDeclaration({
  enabled,
  profileId,
  onError,
}: {
  enabled: boolean
  profileId?: string | null
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<PendingOperation | null>(null)

  const guard = useCallback(async (
    action: PersonalUseDeclarationAction,
    run: () => void | Promise<void>,
    operationProfileId: string | null = profileId ?? null,
  ) => {
    if (!enabled) {
      await run()
      return
    }
    try {
      const query = operationProfileId ? `?profile_id=${encodeURIComponent(operationProfileId)}` : ''
      const status = await apiJson<DeclarationStatus>(`/api/user/personal-use-declaration${query}`, {
        fallbackMessage: copy.personalUse.confirmation_status_load_failed,
      })
      if (status.accepted) {
        await run()
        return
      }
      pendingRef.current = { action, profileId: operationProfileId, run }
      setOpen(true)
    } catch (error) {
      onError(error instanceof Error && error.message ? error.message : copy.personalUse.confirmation_status_load_failed)
    }
  }, [enabled, onError, profileId])

  const close = useCallback(() => {
    if (submitting) return
    pendingRef.current = null
    setOpen(false)
  }, [submitting])

  const confirm = useCallback(async () => {
    const pending = pendingRef.current
    if (!pending || submitting) return
    setSubmitting(true)
    try {
      await apiJson('/api/user/personal-use-declaration', {
        method: 'POST',
        json: {
          action: pending.action,
          ...(pending.profileId ? { profile_id: pending.profileId } : {}),
        },
        fallbackMessage: copy.personalUse.confirmation_submit_failed,
      })
      pendingRef.current = null
      setOpen(false)
      await pending.run()
    } catch (error) {
      onError(error instanceof Error && error.message ? error.message : copy.personalUse.confirmation_submit_failed)
    } finally {
      setSubmitting(false)
    }
  }, [onError, submitting])

  return {
    guard,
    declarationDialog: <PersonalUseDeclarationDialog open={open} submitting={submitting} onClose={close} onConfirm={() => void confirm()} />,
  }
}
