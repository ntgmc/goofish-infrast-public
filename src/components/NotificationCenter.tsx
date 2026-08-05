import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router'
import { copy, CURRENT_LOCALE } from '../copy'
import { apiJson, getApiErrorMessage } from '../lib/api-client'
import { itemIconPath } from '../lib/inventory-contracts'
import type { UserNotification, UserNotificationPage } from '../lib/types'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const POLL_INTERVAL_MS = 60_000

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
  markRead: (notificationId: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null)

export function NotificationCenterProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const refreshAbort = useRef<AbortController | null>(null)
  const loadMoreAbort = useRef<AbortController | null>(null)
  const mutationAbort = useRef<AbortController | null>(null)
  const mutationVersion = useRef(0)
  const currentUserId = useRef(userId)
  const hasLoaded = useRef(false)
  currentUserId.current = userId

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current
    const requestedUserId = userId
    const requestedMutationVersion = mutationVersion.current
    const controller = new AbortController()
    refreshAbort.current = controller
    if (!hasLoaded.current) setLoading(true)
    const request = apiJson<UserNotificationPage>('/api/user/notifications?limit=20', {
      fallbackMessage: copy.notifications.loadError,
      signal: controller.signal,
    }).then((page) => {
      if (currentUserId.current !== requestedUserId || mutationVersion.current !== requestedMutationVersion) return
      setNotifications(page.notifications)
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
      setError(null)
      hasLoaded.current = true
    }).catch((caught) => {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion
        && !isAbortError(caught)) {
        setError(getApiErrorMessage(caught, copy.notifications.loadError))
      }
    }).finally(() => {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion) {
        setLoading(false)
      }
      if (refreshInFlight.current === request) refreshInFlight.current = null
      if (refreshAbort.current === controller) refreshAbort.current = null
    })
    refreshInFlight.current = request
    return request
  }, [userId])

  useEffect(() => {
    mutationVersion.current += 1
    refreshAbort.current?.abort()
    loadMoreAbort.current?.abort()
    mutationAbort.current?.abort()
    hasLoaded.current = false
    refreshInFlight.current = null
    setNotifications([])
    setUnreadCount(0)
    setNextCursor(null)
    setError(null)
    setLoading(true)
    setLoadingMore(false)
    setMarkingAll(false)
    setMarkingId(null)
    void refresh()

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(refreshWhenVisible, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      refreshAbort.current?.abort()
      loadMoreAbort.current?.abort()
      mutationAbort.current?.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [refresh, userId])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || refreshInFlight.current) return
    setLoadingMore(true)
    const requestedUserId = userId
    const requestedMutationVersion = mutationVersion.current
    loadMoreAbort.current?.abort()
    const controller = new AbortController()
    loadMoreAbort.current = controller
    try {
      const page = await apiJson<UserNotificationPage>(
        `/api/user/notifications?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { fallbackMessage: copy.notifications.loadError, signal: controller.signal },
      )
      if (currentUserId.current !== requestedUserId || mutationVersion.current !== requestedMutationVersion) return
      setNotifications((current) => mergeNotifications(current, page.notifications))
      setUnreadCount(page.unread_count)
      setNextCursor(page.next_cursor)
      setError(null)
    } catch (caught) {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion
        && !isAbortError(caught)) {
        setError(getApiErrorMessage(caught, copy.notifications.loadError))
      }
    } finally {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion) {
        setLoadingMore(false)
      }
      if (loadMoreAbort.current === controller) loadMoreAbort.current = null
    }
  }, [loadingMore, nextCursor, userId])

  const markRead = useCallback(async (notificationId: string) => {
    const requestedUserId = userId
    mutationVersion.current += 1
    const requestedMutationVersion = mutationVersion.current
    mutationAbort.current?.abort()
    const controller = new AbortController()
    mutationAbort.current = controller
    setMarkingId(notificationId)
    try {
      const result = await apiJson<{ unread_count: number }>('/api/user/notifications', {
        method: 'PATCH',
        json: { notification_id: notificationId },
        fallbackMessage: copy.notifications.updateError,
        signal: controller.signal,
      })
      if (currentUserId.current !== requestedUserId || mutationVersion.current !== requestedMutationVersion) {
        throw new Error('Notification mutation superseded by a user change.')
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => (
        notification.id === notificationId && !notification.read_at
          ? { ...notification, read_at: readAt }
          : notification
      )))
      setUnreadCount(result.unread_count)
      setError(null)
    } catch (caught) {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion
        && !isAbortError(caught)) {
        setError(getApiErrorMessage(caught, copy.notifications.updateError))
      }
      throw caught
    } finally {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion) {
        setMarkingId(null)
      }
      if (mutationAbort.current === controller) mutationAbort.current = null
    }
  }, [userId])

  const markAllRead = useCallback(async () => {
    const requestedUserId = userId
    mutationVersion.current += 1
    const requestedMutationVersion = mutationVersion.current
    mutationAbort.current?.abort()
    const controller = new AbortController()
    mutationAbort.current = controller
    setMarkingAll(true)
    try {
      const result = await apiJson<{ unread_count: number }>('/api/user/notifications', {
        method: 'PATCH',
        json: { all: true },
        fallbackMessage: copy.notifications.updateError,
        signal: controller.signal,
      })
      if (currentUserId.current !== requestedUserId || mutationVersion.current !== requestedMutationVersion) return
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => (
        notification.read_at ? notification : { ...notification, read_at: readAt }
      )))
      setUnreadCount(result.unread_count)
      setError(null)
    } catch (caught) {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion
        && !isAbortError(caught)) {
        setError(getApiErrorMessage(caught, copy.notifications.updateError))
      }
    } finally {
      if (currentUserId.current === requestedUserId && mutationVersion.current === requestedMutationVersion) {
        setMarkingAll(false)
      }
      if (mutationAbort.current === controller) mutationAbort.current = null
    }
  }, [userId])

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

export function NotificationBell({ iconOnly = false }: { iconOnly?: boolean }) {
  const center = useContext(NotificationCenterContext)
  if (!center) return null
  return <NotificationBellContent center={center} iconOnly={iconOnly} />
}

function NotificationBellContent({ center, iconOnly }: { center: NotificationCenterValue; iconOnly: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const badge = center.unreadCount > 99 ? '99+' : String(center.unreadCount)
  const triggerLabel = copy.notifications.triggerLabel(center.unreadCount)

  const openNotification = async (notification: UserNotification) => {
    if (!notification.read_at) {
      try {
        await center.markRead(notification.id)
      } catch {
        return
      }
    }
    setOpen(false)
    if (notification.action?.kind === 'inventory') navigate('/tool/inventory')
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
              className="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand-500 px-1 text-center text-[10px] font-semibold leading-5 text-white shadow-sm"
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
                {notification.payload.items.map((item) => (
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

function mergeNotifications(primary: UserNotification[], secondary: UserNotification[]): UserNotification[] {
  const byId = new Map<string, UserNotification>()
  for (const notification of [...primary, ...secondary]) {
    if (!byId.has(notification.id)) byId.set(notification.id, notification)
  }
  return [...byId.values()].sort((left, right) => (
    right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id)
  ))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
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
