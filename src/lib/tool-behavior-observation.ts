import { z } from 'zod'
import { DASHBOARD_SECTIONS, OPTIMIZE_ROUTE_SECTIONS, WORKSPACE_SETUP_SECTIONS } from './app-routes'

const STORAGE_PREFIX = 'maatool:behavior-observation:v1:'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_EVENTS = 500
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const eventSchema = z.object({
  name: z.enum([
    'page_visit', 'profile_open', 'workspace_load', 'data_import', 'data_refresh', 'config_save',
    'preset_save', 'preset_use', 'preset_rename', 'preset_delete', 'result_select', 'history_config_select', 'result_load',
    'result_export_maa', 'result_export_full', 'result_archive', 'result_unarchive',
    'result_rename', 'result_delete', 'schedule_submit', 'scenario_submit', 'job_cancel',
    'entry_prompt_shown', 'entry_enable', 'entry_disable', 'entry_snooze', 'entry_auto_open',
  ]),
  at: z.number().int().nonnegative(),
  session: identifier,
  page: z.enum([
    ...DASHBOARD_SECTIONS.map((section) => `dashboard.${section}`),
    ...WORKSPACE_SETUP_SECTIONS.map((section) => `setup.${section}`),
    ...OPTIMIZE_ROUTE_SECTIONS.map((section) => `optimize.${section}`),
  ]),
  profile: identifier.optional(),
  subject: identifier.optional(),
  duration_ms: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
  outcome: z.enum(['succeeded', 'failed', 'aborted']).optional(),
})

export type ToolBehaviorEvent = z.infer<typeof eventSchema>
type EventInput = Pick<ToolBehaviorEvent, 'name'> & Partial<Omit<ToolBehaviorEvent, 'name' | 'session' | 'page'>>
interface ObservationContext {
  userId: string
  session: string
  page: string
  profile?: string
}
let activeContext: ObservationContext | null = null

export function startToolBehaviorObservation(userId: string, session: string): () => void {
  const context = { userId, session, page: 'dashboard.profiles' }
  activeContext = context
  return () => { if (activeContext === context) activeContext = null }
}

export function setToolBehaviorPage(page: string, profile: string | null): void {
  if (activeContext) {
    activeContext.page = page
    activeContext.profile = profile ?? undefined
  }
}

export function readToolBehaviorEvents(userId: string): ToolBehaviorEvent[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) ?? '[]')
    if (!Array.isArray(raw)) return []
    const now = Date.now()
    return raw.slice(-MAX_EVENTS).flatMap((item) => {
      const parsed = eventSchema.safeParse(item)
      return parsed.success && parsed.data.at >= now - RETENTION_MS && parsed.data.at <= now ? [parsed.data] : []
    })
  } catch {
    return []
  }
}

export function recordToolBehavior(input: EventInput): boolean {
  const context = activeContext
  if (!context) return false
  return appendEvent(context, input)
}

function appendEvent(context: ObservationContext, input: EventInput): boolean {
  const event = eventSchema.safeParse({
    at: Date.now(), session: context.session, page: context.page, profile: context.profile, ...input,
  })
  if (!event.success) return false
  try {
    const events = readToolBehaviorEvents(context.userId)
    events.push(event.data)
    window.localStorage.setItem(`${STORAGE_PREFIX}${context.userId}`, JSON.stringify(events.slice(-MAX_EVENTS)))
    return true
  } catch {
    return false
  }
}

export function observeToolApiRequest(url: string, method: string | undefined, json: unknown): (outcome: ToolBehaviorEvent['outcome'], durationMs: number) => void {
  const context = activeContext && { ...activeContext }
  if (!context || !url.startsWith('/api/')) return () => undefined
  const parsed = new URL(url, 'https://observation.invalid')
  const body = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const verb = (method ?? 'GET').toUpperCase()
  const profile = body.profile_id ?? (body.identity && typeof body.identity === 'object'
    ? (body.identity as Record<string, unknown>).profileId : undefined) ?? parsed.searchParams.get('profile_id') ?? context.profile
  let name: ToolBehaviorEvent['name'] | undefined
  let subject: unknown = body.result_id
  if (verb === 'GET' && parsed.pathname === '/api/user/workspace' && parsed.searchParams.has('profile_id')) {
    name = context.page.startsWith('dashboard.') ? 'profile_open' : 'workspace_load'
  }
  if (verb === 'GET' && /^\/api\/user\/results\/[^/]+$/.test(parsed.pathname)) {
    name = 'result_load'
    subject = parsed.pathname.split('/').pop()
  }
  if (verb === 'PATCH' && parsed.pathname === '/api/user/workspace') {
    if (body.operators !== undefined) name = 'data_import'
    else if (body.saved_config_action && typeof body.saved_config_action === 'object') {
      const action = body.saved_config_action as Record<string, unknown>
      const names = { save: 'preset_save', touch: 'preset_use', rename: 'preset_rename', delete: 'preset_delete' } as const
      name = names[action.type as keyof typeof names]
      subject = action.id
    } else if (body.config !== undefined) name = 'config_save'
  }
  if (verb === 'POST') {
    const names: Record<string, ToolBehaviorEvent['name']> = {
      '/api/user/skland/login/confirm': 'data_import',
      '/api/user/skland/free-preview/login/confirm': 'data_import',
      '/api/user/skland/import/refresh': 'data_refresh',
      '/api/user/maa-export': 'result_export_maa',
      '/api/user/full-result-export': 'result_export_full',
    }
    name = names[parsed.pathname]
    if (parsed.pathname === '/api/optimization/jobs') name = body.kind === 'scenario_comparison' ? 'scenario_submit' : 'schedule_submit'
    if (/^\/api\/optimization\/jobs\/[^/]+\/cancel$/.test(parsed.pathname)) {
      name = 'job_cancel'
      const segments = parsed.pathname.split('/')
      subject = segments[segments.length - 2]
    }
    if (parsed.pathname === '/api/user/result-archive') {
      const actions = { archive: 'result_archive', unarchive: 'result_unarchive', rename: 'result_rename', delete: 'result_delete' } as const
      name = actions[body.action as keyof typeof actions]
    }
  }
  if (!name) return () => undefined
  const capturedName = name
  return (outcome, durationMs) => {
    if (activeContext?.userId !== context.userId || activeContext.session !== context.session) return
    appendEvent({ ...context, profile: typeof profile === 'string' ? profile : undefined }, {
      name: capturedName, outcome, duration_ms: Math.min(24 * 60 * 60 * 1000, Math.max(0, Math.round(durationMs))),
      ...(typeof subject === 'string' && identifier.safeParse(subject).success && { subject }),
    })
  }
}

export function clearToolBehaviorEvents(userId: string): boolean {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${userId}`)
    return true
  } catch {
    return false
  }
}

export function exportToolBehaviorData(userId: string): string {
  const profiles = new Map<string, string>()
  const subjects = new Map<string, string>()
  function alias(values: Map<string, string>, value: string, prefix: string): string {
    if (!values.has(value)) values.set(value, `${prefix}_${values.size + 1}`)
    return values.get(value)!
  }
  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    retention_days: 30,
    events: readToolBehaviorEvents(userId).sort((left, right) => left.at - right.at).map((event) => ({
      ...event,
      ...(event.profile && { profile: alias(profiles, event.profile, 'profile') }),
      ...(event.subject && { subject: alias(subjects, event.subject, 'item') }),
    })),
  }, null, 2)
}
