import { useCallback, useRef, useState } from 'react'
import PersonalUseDeclarationDialog from '../components/PersonalUseDeclarationDialog'
import { copy } from '../copy/index'
import { apiJson } from '../lib/api-client'
import type {
  PersonalUseDeclarationAction,
  PublicPersonalUseDeclaration,
} from '../lib/personal-use-declaration'

type PendingOperation = {
  action: PersonalUseDeclarationAction
  profileId: string | null
  run: () => void | Promise<void>
}

type DeclarationStatus = {
  accepted: boolean
  effective: boolean
  declaration: PublicPersonalUseDeclaration
  acceptance?: {
    declaration_id: string
    declaration_version: string
    content_hash: string
    action: PersonalUseDeclarationAction
    accepted_at: string
  }
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
  const [declaration, setDeclaration] = useState<PublicPersonalUseDeclaration | null>(null)
  const pendingRef = useRef<PendingOperation | null>(null)
  const submittingRef = useRef(false)

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
      setDeclaration(status.declaration)
      setOpen(true)
    } catch (error) {
      onError(error instanceof Error && error.message ? error.message : copy.personalUse.confirmation_status_load_failed)
    }
  }, [enabled, onError, profileId])

  const close = useCallback(() => {
    if (submittingRef.current) return
    pendingRef.current = null
    setDeclaration(null)
    setOpen(false)
  }, [])

  const confirm = useCallback(async () => {
    const pending = pendingRef.current
    const document = declaration
    if (!pending || !document || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const status = await apiJson<DeclarationStatus>('/api/user/personal-use-declaration', {
        method: 'POST',
        json: {
          action: pending.action,
          declaration_id: document.id,
          content_hash: document.contentHash,
          ...(pending.profileId ? { profile_id: pending.profileId } : {}),
        },
        fallbackMessage: copy.personalUse.confirmation_submit_failed,
      })
      if (status.declaration.id !== document.id
        || status.declaration.contentHash !== document.contentHash
        || (status.effective && (
          status.acceptance?.declaration_id !== document.id
          || status.acceptance.content_hash !== document.contentHash
          || status.acceptance.action !== pending.action
        ))) {
        setDeclaration(status.declaration)
        throw new Error(copy.personalUse.confirmation_version_changed)
      }
      pendingRef.current = null
      setDeclaration(null)
      setOpen(false)
      await pending.run()
    } catch (error) {
      try {
        const query = pending.profileId ? `?profile_id=${encodeURIComponent(pending.profileId)}` : ''
        const latest = await apiJson<DeclarationStatus>(`/api/user/personal-use-declaration${query}`, {
          fallbackMessage: copy.personalUse.confirmation_status_load_failed,
        })
        setDeclaration(latest.declaration)
      } catch {
        // Preserve the document already shown when refreshing the latest version fails.
      }
      onError(error instanceof Error && error.message ? error.message : copy.personalUse.confirmation_submit_failed)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [declaration, onError])

  return {
    guard,
    declarationDialog: (
      <PersonalUseDeclarationDialog
        open={open}
        submitting={submitting}
        declaration={declaration}
        onClose={close}
        onConfirm={() => void confirm()}
      />
    ),
  }
}
