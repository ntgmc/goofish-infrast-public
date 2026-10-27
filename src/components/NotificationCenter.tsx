import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import { NotificationIcon as Bell } from './icons'
import { useNavigate } from 'react-router'
import { copy, CURRENT_LOCALE } from '../copy'
import { useNotificationQuery } from '../lib/notification-query'
import { itemIconPath } from '../lib/inventory-contracts'
import type { UserNotification } from '../lib/types'
import { UserQueryScope } from '../lib/private-query-scope'
import { useSiteFeatures } from '../lib/site-feature-context'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type NotificationCenterValue = {
  notifications: UserNotification[]
  unreadCount: number
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  markingAll: boolean
  markingId: string | null
  error: string | null
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  markRead: (notification: UserNotification) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null)

export function NotificationCenterProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { features } = useSiteFeatures()
  return <UserQueryScope.Provider value={userId}>{features.notifications
    ? <EnabledNotificationCenterProvider key={userId} userId={userId}>{children}</EnabledNotificationCenterProvider>
    : children}</UserQueryScope.Provider>
}

function EnabledNotificationCenterProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { notifications, unreadCount, nextCursor, loading, loadingMore, markingAll, markingId, error, refresh, loadMore, markRead, markAllRead } = useNotificationQuery(userId)

  return (
    <NotificationCenterContext.Provider value={{
      notifications,
      unreadCount,
      nextCursor,
      loading,
      loadingMore,
      markingAll,
      markingId,
      error,
      refresh,
      loadMore,
      markRead,
      markAllRead,
    }}>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copy.notifications.unreadLive(unreadCount)}
      </span>
      {children}
    </NotificationCenterContext.Provider>
  )
}

export function NotificationBell({ iconOnly = false, onInventory }: { iconOnly?: boolean; onInventory?: () => void }) {
  const center = useContext(NotificationCenterContext)
  if (!center) return null
  return <NotificationBellContent center={center} iconOnly={iconOnly} onInventory={onInventory} />
}

function NotificationBellContent({ center, iconOnly, onInventory }: { center: NotificationCenterValue; iconOnly: boolean; onInventory?: () => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const badge = center.unreadCount > 99 ? '99+' : String(center.unreadCount)
  const triggerLabel = copy.notifications.triggerLabel(center.unreadCount)

  const openNotification = async (notification: UserNotification) => {
    if (!notification.read_at) {
      try {
        await center.markRead(notification)
      } catch {
        return
      }
    }
    setOpen(false)
    if (notification.action?.kind === 'inventory') {
      if (onInventory) onInventory()
      else navigate('/tool/inventory')
    } else if (notification.action?.kind === 'feedback') {
      const triggers = [...document.querySelectorAll<HTMLButtonElement>('.feedback-trigger')]
      const trigger = triggers.find((button) => button.getClientRects().length > 0) ?? triggers[0]
      if (trigger) trigger.dispatchEvent(new CustomEvent('goofish:open-feedback', { detail: notification.action.feedback_id }))
      else navigate(`/v2?feedback=${encodeURIComponent(notification.action.feedback_id)}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (nextOpen) void center.refresh()
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className={`tool-secondary-action relative h-11 shrink-0 whitespace-nowrap py-0 ${iconOnly ? 'w-11 justify-center px-0' : 'px-3'}`}
        >
          <Bell aria-hidden="true" className="size-4" />
          {!iconOnly && <span className="hidden sm:inline">{copy.notifications.title}</span>}
          {center.unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-5 text-primary-foreground shadow-sm"
            >
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-label={copy.notifications.title}
        className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-surface-3 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">{copy.notifications.title}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">{copy.notifications.unreadLive(center.unreadCount)}</p>
          </div>
          <button
            type="button"
            onClick={() => void center.markAllRead()}
            disabled={center.unreadCount === 0 || center.markingAll || center.markingId !== null}
            className="tool-secondary-action h-9 px-3 text-xs disabled:cursor-wait disabled:opacity-60"
          >
            {center.markingAll ? copy.notifications.markingAllRead : copy.notifications.markAllRead}
          </button>
        </div>

        {center.error && (
          <div className="m-3 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger" role="alert">
            <span>{center.error}</span>
            <button type="button" onClick={() => void center.refresh()} className="shrink-0 font-semibold underline underline-offset-2">
              {copy.notifications.retry}
            </button>
          </div>
        )}

        <div className="max-h-[min(32rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain">
          {center.loading && center.notifications.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-secondary" role="status">{copy.notifications.loading}</p>
          )}
          {!center.loading && center.notifications.length === 0 && (
            <p className="p-8 text-center text-sm text-ink-secondary">{copy.notifications.empty}</p>
          )}
          {center.notifications.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => void openNotification(notification)}
              disabled={center.markingId === notification.id}
              className={`block w-full border-b border-surface-3 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${notification.read_at ? '' : 'bg-brand-500/5'}`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <strong className="truncate text-sm font-semibold text-ink-primary">{notification.title}</strong>
                    {!notification.read_at && <span className="tool-status tool-status--current shrink-0">{copy.notifications.unread}</span>}
                  </span>
                  <span className="mt-1 block text-xs text-ink-secondary">{notification.body}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-muted">{formatNotificationTime(notification.updated_at)}</span>
              </span>
              <span className="mt-3 grid gap-2">
                {notification.payload.kind === 'item_grant' && notification.payload.items.map((item) => (
                  <span key={`${item.item_code}:${item.expires_at ?? 'never'}`} className="flex items-center gap-3 rounded-xl bg-surface-2/70 p-2.5">
                    <img src={itemIconPath(item.icon_key)} alt="" width={40} height={40} className="size-10 shrink-0 object-contain" />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-xs font-semibold text-ink-primary">{item.name} ×{item.quantity}</strong>
                      <span className="mt-0.5 block text-[11px] text-ink-muted">{formatExpiry(item.expires_at)}</span>
                    </span>
                  </span>
                ))}
              </span>
            </button>
          ))}
          {center.nextCursor && (
            <div className="border-t border-surface-3 p-3 text-center">
              <button
                type="button"
                onClick={() => void center.loadMore()}
                disabled={center.loadingMore}
                className="tool-secondary-action h-9 px-4 text-xs disabled:cursor-wait"
              >
                {center.loadingMore ? copy.notifications.loadingMore : copy.notifications.loadMore}
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatNotificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(CURRENT_LOCALE, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatExpiry(value: string | null): string {
  if (!value) return copy.notifications.permanent
  const date = new Date(value)
  const formatted = Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(CURRENT_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return copy.notifications.expiresAt(formatted)
}
