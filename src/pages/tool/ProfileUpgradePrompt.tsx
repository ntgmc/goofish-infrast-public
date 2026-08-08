import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog'
import { apiJson } from '../../lib/api-client'
import type { InventoryResponse } from '../../lib/inventory-contracts'
import type { UserGameAccount } from '../../lib/types'
import { copy } from '../../copy/index'
import { isFreePreviewTrialActive } from './tool-utils'

const STORAGE_PREFIX = 'maatool:profile-upgrade-prompt:v1:'
const sessionDismissedUserIds = new Set<string>()

type UpgradeVoucherKind = 'limited' | 'lifetime'

export interface ProfileUpgradePromptProps {
  userId: string | null
  profile: UserGameAccount | null
  inventoryEnabled: boolean
  currentPath: string
  onOpenInventory: () => void
}

export function profileUpgradePromptStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export default function ProfileUpgradePrompt({
  userId,
  profile,
  inventoryEnabled,
  currentPath,
  onOpenInventory,
}: ProfileUpgradePromptProps) {
  const [open, setOpen] = useState(false)
  const [availableKinds, setAvailableKinds] = useState<UpgradeVoucherKind[]>([])
  const [sessionSuppressed, setSessionSuppressed] = useState(false)
  const eligible = Boolean(
    inventoryEnabled
      && userId
      && profile
      && profile.status === 'active'
      && profile.kind === 'free_preview'
      && profile.skland_binding,
  )
  const currentProfileId = profile?.id ?? null
  const currentProfileUid = profile?.skland_binding?.uid ?? null
  const trialActive = profile ? isFreePreviewTrialActive(profile) : false
  const shouldCheckInventory = eligible && currentPath !== '/tool/inventory' && !isPromptSuppressed(userId)

  useEffect(() => {
    setOpen(false)
    setAvailableKinds([])
    setSessionSuppressed(Boolean(userId && isPromptSuppressed(userId)))

    if (!shouldCheckInventory || !userId || !profile) return

    const controller = new AbortController()
    let cancelled = false
    void apiJson<InventoryResponse>('/api/user/inventory', { signal: controller.signal })
      .then((inventory) => {
        if (cancelled) return
        setAvailableKinds(getAvailableVoucherKinds(inventory, profile))
      })
      .catch(() => {
        // The prompt is optional; inventory failures must not block the workbench.
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [currentPath, currentProfileId, currentProfileUid, eligible, profile, shouldCheckInventory, trialActive, userId])

  useEffect(() => {
    if (!shouldCheckInventory || availableKinds.length === 0 || sessionSuppressed) return
    return waitForModalAvailability(() => setOpen(true))
  }, [availableKinds.length, sessionSuppressed, shouldCheckInventory])

  const description = useMemo(() => {
    if (availableKinds.length === 2) return copy.dashboard.pages_tool_ProfileUpgradePrompt_003
    if (availableKinds[0] === 'limited') return copy.dashboard.pages_tool_ProfileUpgradePrompt_002
    return copy.dashboard.pages_tool_ProfileUpgradePrompt_004
  }, [availableKinds])

  const dismissForSession = () => {
    if (userId) sessionDismissedUserIds.add(userId)
    setSessionSuppressed(true)
    setOpen(false)
  }

  const dismissPermanently = () => {
    if (userId) {
      sessionDismissedUserIds.add(userId)
      try {
        window.localStorage.setItem(profileUpgradePromptStorageKey(userId), 'done')
      } catch {
        // The in-memory session marker still prevents repeated prompts.
      }
    }
    setSessionSuppressed(true)
    setOpen(false)
  }

  if (!userId || !eligible || !shouldCheckInventory || availableKinds.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) dismissForSession() }}>
      <DialogContent
        showCloseButton
        closeLabel={copy.dashboard.pages_tool_ProfileUpgradePrompt_007}
        aria-describedby="profile-upgrade-prompt-description"
      >
        <DialogTitle>{copy.dashboard.pages_tool_ProfileUpgradePrompt_001}</DialogTitle>
        <DialogDescription id="profile-upgrade-prompt-description" className="mt-1">
          {description}
        </DialogDescription>
        <div className="tool-alert tool-alert--warning mt-3">
          {copy.dashboard.pages_tool_ProfileUpgradePrompt_005}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={dismissPermanently} className="tool-secondary-action">
            {copy.dashboard.pages_tool_ProfileUpgradePrompt_006}
          </button>
          <button type="button" onClick={() => { dismissForSession(); onOpenInventory() }} className="tool-primary-action">
            {copy.dashboard.pages_tool_ProfileUpgradePrompt_008}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getAvailableVoucherKinds(
  inventory: InventoryResponse,
  profile: UserGameAccount,
): UpgradeVoucherKind[] {
  if (!profile.skland_binding) return []
  const kinds: UpgradeVoucherKind[] = []
  const hasStack = (code: string, action: 'bind' | 'use') => inventory.stacks.some((stack) => (
    stack.item.code === code
      && stack.quantity > 0
      && stack.actions.includes(action)
  ))

  if (!isFreePreviewTrialActive(profile) && hasStack('limited_profile_voucher', 'use')) kinds.push('limited')
  if (hasStack('lifetime_profile_voucher', 'bind')) kinds.push('lifetime')
  return kinds
}

function isPromptSuppressed(userId: string | null): boolean {
  if (!userId || sessionDismissedUserIds.has(userId)) return Boolean(userId)
  try {
    return window.localStorage.getItem(profileUpgradePromptStorageKey(userId)) === 'done'
  } catch {
    return false
  }
}

function waitForModalAvailability(onAvailable: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  const isBlocked = () => Boolean(document.querySelector(
    'dialog[open], [role="dialog"][data-state="open"], [data-slot="dialog-content"][data-state="open"]',
  ))
  if (!isBlocked()) {
    onAvailable()
    return () => undefined
  }

  if (typeof MutationObserver === 'undefined' || !document.body) return () => undefined
  let observer: MutationObserver | null = null
  observer = new MutationObserver(() => {
    if (isBlocked()) return
    observer?.disconnect()
    onAvailable()
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['open', 'data-state'], childList: true, subtree: true })
  return () => observer?.disconnect()
}
