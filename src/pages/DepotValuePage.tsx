import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import AuthForm from '../components/AuthForm'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import SklandBindingDialog, { type SklandPayload } from '../components/SklandBindingDialog'
import { getCurrentSiteUrl } from '../lib/site-url'
import { apiJson, apiJsonOrNull } from '../lib/api-client'
import type { AuthMeResponse, DepotValueItem, DepotValueProfileResponse, DepotValueRequest, DepotValueResponse, UserGameAccount } from '../lib/types'
import { copy, CURRENT_LOCALE } from '../copy/index'


const LMD_ITEM_ID = '4001'

export default function DepotValuePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [depotText, setDepotText] = useState('')
  const [auth, setAuth] = useState<AuthMeResponse | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [depotProfile, setDepotProfile] = useState<UserGameAccount | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [result, setResult] = useState<DepotValueResponse | null>(null)
  const [loading, setLoading] = useState<DepotValueRequest['source'] | null>(null)
  const [profilePreparing, setProfilePreparing] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyAuthData = useCallback((data: AuthMeResponse | null) => {
    setAuth(data)
    const profiles = data?.profiles ?? []
    const firstSklandProfile = profiles.find((profile) => profile.skland_binding)
    setDepotProfile(profiles.find((profile) => profile.kind === 'depot_value') ?? null)
    setSelectedProfileId((current) => {
      if (current && profiles.some((profile) => profile.id === current && profile.skland_binding)) return current
      return firstSklandProfile?.id ?? ''
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    apiJsonOrNull<AuthMeResponse>('/api/auth/me')
      .then((data) => {
        if (cancelled || !data) return
        applyAuthData(data)
      })
      .catch(() => {
        if (!cancelled) applyAuthData(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyAuthData])

  useEffect(() => {
    if (result) drawShareCard(canvasRef.current, result)
  }, [result])

  const sklandProfiles = useMemo(
    () => auth?.profiles?.filter((profile) => profile.skland_binding) ?? [],
    [auth],
  )
  const selectedSklandProfile = useMemo(
    () => sklandProfiles.find((profile) => profile.id === selectedProfileId) ?? sklandProfiles[0] ?? null,
    [selectedProfileId, sklandProfiles],
  )

  const analyze = useCallback(async (payload: DepotValueRequest) => {
    setLoading(payload.source)
    setError(null)
    try {
      const data = await apiJson<DepotValueResponse>('/api/depot-value', {
        method: 'POST',
        json: payload,
        fallbackMessage: copy.tools.pages_DepotValuePage_001,
      })
      setResult(data)
      window.setTimeout(() => document.getElementById('depot-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch (caught) {
      setResult(null)
      setError((caught as Error).message)
    } finally {
      setLoading(null)
    }
  }, [])

  const ensureDepotProfile = useCallback(async (): Promise<UserGameAccount> => {
    setProfilePreparing(true)
    setError(null)
    try {
      const data = await apiJson<DepotValueProfileResponse>('/api/user/profiles/depot-value', {
        method: 'POST',
        fallbackMessage: copy.tools.pages_DepotValuePage_002,
      })
      if (!data.user || !data.depot_profile) {
        throw new Error(copy.tools.pages_DepotValuePage_003)
      }
      applyAuthData(data)
      setDepotProfile(data.depot_profile)
      setSelectedProfileId(data.depot_profile.id)
      return data.depot_profile
    } finally {
      setProfilePreparing(false)
    }
  }, [applyAuthData])

  const openSklandBinding = useCallback(async () => {
    setResult(null)
    setError(null)
    try {
      const profile = depotProfile ?? await ensureDepotProfile()
      setDepotProfile(profile)
      setSelectedProfileId(profile.id)
      setSklandDialogOpen(true)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [depotProfile, ensureDepotProfile])

  const readClipboard = async () => {
    setResult(null)
    setError(null)
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error(copy.tools.pages_DepotValuePage_004)
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) throw new Error(copy.tools.pages_DepotValuePage_005)
      setDepotText(text)
    } catch (caught) {
      setError((caught as Error).message || copy.tools.pages_DepotValuePage_006)
    }
  }

  const analyzeUpload = async (event: FormEvent) => {
    event.preventDefault()
    let inventory: unknown
    try {
      inventory = parseDepotText(depotText)
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
    await analyze({ source: 'upload', inventory })
  }

  const analyzeSkland = async () => {
    const profileId = selectedSklandProfile?.id
    if (profileId) {
      setSelectedProfileId(profileId)
      if (selectedSklandProfile?.skland_binding?.credential_status === 'invalid') {
        await openSklandBinding()
        return
      }
      await analyze({ source: 'skland', profile_id: profileId })
      return
    }
    if (!auth?.user) {
      setError(copy.tools.pages_DepotValuePage_007)
      return
    }
    await openSklandBinding()
  }

  const handleAuthenticated = (payload: AuthMeResponse) => {
    applyAuthData(payload)
    void openSklandBinding()
  }

  const handleSklandPayload = (payload: SklandPayload) => {
    applyAuthData(payload)
    const profile = payload.active_profile ?? payload.profiles?.find((item) => item.kind === 'depot_value') ?? null
    if (profile?.kind === 'depot_value') setDepotProfile(profile)
  }

  const handleSklandCompleted = (payload: SklandPayload) => {
    handleSklandPayload(payload)
    const completedProfile = payload.active_profile?.skland_binding
      ? payload.active_profile
      : payload.profiles?.find((profile) => profile.kind === 'depot_value' && profile.skland_binding)
    if (!completedProfile?.skland_binding) {
      setError(copy.tools.pages_DepotValuePage_008)
      return
    }
    setSklandDialogOpen(false)
    setSelectedProfileId(completedProfile.id)
    void analyze({ source: 'skland', profile_id: completedProfile.id })
  }

  const downloadShareImage = () => {
    const canvas = canvasRef.current
    if (!canvas || !result) return
    const link = document.createElement('a')
    link.download = `maa-depot-value-${result.percentile}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-6xl">
        <header className="tool-page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BrandLogo size="md" />
            <div className="min-w-0">
              <p className="section-index">{copy.tools.pages_DepotValuePage_009}</p>
              <h1 className="display-title mt-2 text-2xl text-ink-primary">{copy.tools.pages_DepotValuePage_010}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
                {copy.tools.pages_DepotValuePage_011}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            <ThemeSwitcher />
            <Link
              to="/"
              className="tool-secondary-action"
            >
              {copy.tools.pages_DepotValuePage_012}</Link>
            <Link
              to="/tool/profiles"
              className="tool-primary-action"
            >
              {copy.tools.pages_DepotValuePage_013}</Link>
          </nav>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <section className="tool-panel p-5 sm:p-6">
            <div>
              <div>
                <h2 className="text-lg font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_014}</h2>
                <p className="mt-1 text-sm leading-6 text-ink-secondary">
                  {copy.tools.pages_DepotValuePage_015}</p>
              </div>
            </div>

            {error && (
              <div className="tool-alert tool-alert--error mt-5" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={analyzeUpload} className="mt-5 space-y-5">
              <section className="tool-inset p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_016}</h3>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      {copy.tools.pages_DepotValuePage_017}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void readClipboard()}
                    className="tool-secondary-action"
                  >
                    {copy.tools.pages_DepotValuePage_018}</button>
                </div>
                <textarea
                  value={depotText}
                  onChange={(event) => {
                    setDepotText(event.currentTarget.value)
                    setResult(null)
                    setError(null)
                  }}
                  rows={9}
                  className="tool-field mt-4 resize-y font-mono"
                  placeholder={copy.tools.pages_DepotValuePage_019}
                />
                {depotText.trim() && (
                  <span className="tool-status tool-status--success mt-3">
                    {copy.tools.pages_DepotValuePage_020}{depotText.trim().length} {copy.tools.pages_DepotValuePage_021}</span>
                )}
              </section>

              <button
                type="submit"
                disabled={loading !== null || !depotText.trim()}
                className="tool-primary-action w-full"
              >
                {loading === 'upload' ? copy.tools.pages_DepotValuePage_022 : copy.tools.pages_DepotValuePage_023}
              </button>
            </form>

            <div className="mt-6 border-t border-surface-3 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_024}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">
                    {copy.tools.pages_DepotValuePage_025}</p>
                </div>
                {auth?.user && (
                  <span className="tool-status tool-status--success whitespace-nowrap">
                    {copy.tools.pages_DepotValuePage_026}</span>
                )}
              </div>
              {authLoading ? (
                <p className="tool-inset mt-4 p-3 text-sm text-ink-secondary">{copy.tools.pages_DepotValuePage_027}</p>
              ) : !auth?.user ? (
                <div className="tool-inset mt-4 p-4">
                  <AuthForm
                    compact
                    allowCdk={false}
                    intro={copy.tools.pages_DepotValuePage_028}
                    onAuthenticated={handleAuthenticated}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {sklandProfiles.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <select
                          value={selectedSklandProfile?.id ?? selectedProfileId}
                          onChange={(event) => setSelectedProfileId(event.currentTarget.value)}
                          className="tool-field flex-1"
                        >
                          {sklandProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {formatProfileLabel(profile)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void analyzeSkland()}
                          disabled={loading !== null || profilePreparing}
                          className="tool-secondary-action"
                        >
                          {loading === 'skland'
                            ? copy.tools.pages_DepotValuePage_029
                            : selectedSklandProfile?.skland_binding?.credential_status === 'invalid'
                              ? copy.tools.pages_DepotValuePage_030
                              : copy.tools.pages_DepotValuePage_031}
                        </button>
                      </div>
                      {selectedSklandProfile?.skland_binding?.credential_status === 'invalid' && (
                        <p className="tool-alert tool-alert--error" role="alert">
                          {copy.tools.pages_DepotValuePage_032}</p>
                      )}
                    </div>
                  )}
                  {sklandProfiles.length === 0 && (
                    <button
                      type="button"
                      onClick={() => void openSklandBinding()}
                      disabled={loading !== null || profilePreparing}
                      className="tool-primary-action w-full"
                    >
                      {profilePreparing ? copy.tools.pages_DepotValuePage_033 : copy.tools.pages_DepotValuePage_034}
                    </button>
                  )}
                </div>
              )}
              <p className="tool-alert tool-alert--warning mt-4">
                {copy.tools.pages_DepotValuePage_035}</p>
            </div>
          </section>

          <section className="tool-panel p-5 sm:p-6">
            <p className="section-index">{copy.tools.pages_DepotValuePage_036}</p>
            <h2 className="mt-2 text-lg font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_037}</h2>
            <div className="mt-4 space-y-4 text-sm leading-6 text-ink-secondary">
              <p>{copy.tools.pages_DepotValuePage_038}</p>
              <p>{copy.tools.pages_DepotValuePage_039}</p>
              <p>{copy.tools.pages_DepotValuePage_040}</p>
            </div>
          </section>
        </div>

        {result && (
          <section id="depot-result" className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <ResultSummary result={result} />
            <SharePanel result={result} canvasRef={canvasRef} onDownload={downloadShareImage} />
          </section>
        )}
        <SklandBindingDialog
          open={sklandDialogOpen}
          profile={depotProfile}
          context="depot"
          autoStart
          onOpenChange={setSklandDialogOpen}
          onPayload={handleSklandPayload}
          onCompleted={handleSklandCompleted}
        />
      </div>
    </main>
  )
}

function ResultSummary({ result }: { result: DepotValueResponse }) {
  return (
    <section className="tool-panel border-brand-600/25 p-5 sm:p-6">
      <p className="section-index">{copy.tools.pages_DepotValuePage_041}</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink-primary">
        {copy.tools.pages_DepotValuePage_042}{result.percentile}{copy.tools.pages_DepotValuePage_043}</h2>
      <p className="tool-inset mt-3 px-3 py-2 text-sm leading-6 text-ink-secondary">
        {formatRankingNote(result)}
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label={copy.tools.pages_DepotValuePage_044} value={formatNumber(result.total_equivalent_sanity)} />
        <Metric label={copy.tools.pages_DepotValuePage_045} value={`${result.priced_count}${copy.tools.pages_DepotValuePage_046}`} />
        <Metric label={copy.tools.pages_DepotValuePage_047} value={`${result.unpriced_count}${copy.tools.pages_DepotValuePage_048}`} />
      </div>

      {result.warnings.length > 0 && (
        <div className="mt-5 space-y-2">
          {result.warnings.map((warning) => (
            <p key={warning} className="tool-alert tool-alert--warning" role="status">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_049}</h3>
        <div className="tool-inset mt-3 divide-y divide-surface-3 overflow-hidden">
          {result.top_items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-surface-0 px-4 py-3">
              <span className="tool-status h-7 w-7 justify-center p-0 text-brand-300">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                <p className="mt-1 text-xs text-ink-muted">{copy.tools.pages_DepotValuePage_050}{formatNumber(item.count)} · {formatUnitSanityLabel(item)}</p>
              </div>
              <p className="text-sm font-semibold text-ink-primary">{formatNumber(item.equivalent_sanity)}</p>
            </div>
          ))}
        </div>
      </div>

      {result.unpriced_items.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_051}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.unpriced_items.map((item) => (
              <span key={item.id} className="tool-status">
                {item.name} × {formatNumber(item.count)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SharePanel({
  result,
  canvasRef,
  onDownload,
}: {
  result: DepotValueResponse
  canvasRef: RefObject<HTMLCanvasElement | null>
  onDownload: () => void
}) {
  return (
    <section className="tool-panel p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-primary">{copy.tools.pages_DepotValuePage_052}</h2>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            {copy.tools.pages_DepotValuePage_053}</p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="tool-primary-action"
        >
          {copy.tools.pages_DepotValuePage_054}</button>
      </div>
      <div className="mt-5 flex justify-center">
        <canvas
          ref={canvasRef}
          width={900}
          height={1600}
          className="tool-inset aspect-[9/16] w-full max-w-[24rem] shadow-sm"
          aria-label={`${copy.tools.pages_DepotValuePage_055}${result.percentile}${copy.tools.pages_DepotValuePage_056}`}
        />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function drawShareCard(canvas: HTMLCanvasElement | null, result: DepotValueResponse) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = 900
  const height = 1600
  canvas.width = width
  canvas.height = height
  const colors = getShareCardColors()

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, colors.backgroundStart)
  gradient.addColorStop(0.52, colors.backgroundMid)
  gradient.addColorStop(1, colors.backgroundEnd)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  drawCircle(ctx, 720, 170, 220, colors.orbit)
  drawCircle(ctx, 160, 1220, 260, colors.orbitAlt)

  ctx.fillStyle = colors.ink
  ctx.font = `600 34px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_057, 72, 96)
  ctx.font = `400 24px ${colors.bodyFont}`
  ctx.fillStyle = colors.muted
  ctx.fillText(result.ranking.mode === 'sample_adjusted'
    ? `${copy.tools.pages_DepotValuePage_058}${formatNumber(result.ranking.sample_count)}${copy.tools.pages_DepotValuePage_059}`
    : copy.tools.pages_DepotValuePage_060, 72, 136)

  ctx.fillStyle = colors.ink
  ctx.font = `700 60px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_061, 72, 260)
  ctx.font = `700 70px ${colors.displayFont}`
  ctx.fillText(`${copy.tools.pages_DepotValuePage_062}${result.percentile}${copy.tools.pages_DepotValuePage_063}`, 72, 350)

  drawRoundedRect(ctx, 72, 430, 756, 220, 28, colors.panel)
  ctx.fillStyle = colors.muted
  ctx.font = `500 28px ${colors.bodyFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_064, 112, 502)
  ctx.fillStyle = colors.accentAlt
  ctx.font = `700 82px ${colors.displayFont}`
  ctx.fillText(formatNumber(result.total_equivalent_sanity), 112, 596)

  ctx.fillStyle = colors.ink
  ctx.font = `700 34px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_065, 72, 740)

  result.top_items.slice(0, 5).forEach((item, index) => {
    const y = 804 + index * 116
    drawRoundedRect(ctx, 72, y, 756, 88, 18, colors.panelSubtle)
    ctx.fillStyle = colors.accent
    ctx.font = `700 28px ${colors.bodyFont}`
    ctx.fillText(String(index + 1).padStart(2, '0'), 104, y + 54)
    ctx.fillStyle = colors.ink
    ctx.font = `600 28px ${colors.displayFont}`
    ctx.fillText(truncateText(ctx, item.name, 380), 166, y + 40)
    ctx.fillStyle = colors.muted
    ctx.font = `400 22px ${colors.bodyFont}`
    ctx.fillText(`${copy.tools.pages_DepotValuePage_066}${formatNumber(item.count)}`, 166, y + 70)
    ctx.fillStyle = colors.accentAlt
    ctx.font = `700 28px ${colors.bodyFont}`
    ctx.textAlign = 'right'
    ctx.fillText(formatNumber(item.equivalent_sanity), 790, y + 54)
    ctx.textAlign = 'left'
  })

  drawRoundedRect(ctx, 72, 1400, 756, 104, 24, colors.panel)
  ctx.fillStyle = colors.ink
  ctx.font = `600 28px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_067, 112, 1446)
  ctx.fillStyle = colors.muted
  ctx.font = `400 22px ${colors.bodyFont}`
  ctx.fillText(`${copy.tools.pages_DepotValuePage_068}${getCurrentSiteUrl()}`, 112, 1484)
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fillStyle = fill
  ctx.fill()
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let next = text
  while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) {
    next = next.slice(0, -1)
  }
  return `${next}…`
}

function getShareCardColors() {
  const styles = window.getComputedStyle(document.documentElement)
  const read = (name: string) => styles.getPropertyValue(name).trim()
  return {
    backgroundStart: read('--share-bg-start'),
    backgroundMid: read('--share-bg-mid'),
    backgroundEnd: read('--share-bg-end'),
    ink: read('--share-ink'),
    muted: read('--share-muted'),
    accent: read('--share-accent'),
    accentAlt: read('--share-accent-alt'),
    orbit: read('--share-orbit'),
    orbitAlt: read('--share-orbit-alt'),
    panel: read('--share-panel'),
    panelSubtle: read('--share-panel-subtle'),
    displayFont: read('--font-display'),
    bodyFont: read('--font-body'),
  }
}

function formatProfileLabel(profile: UserGameAccount): string {
  const binding = profile.skland_binding
  return binding
    ? `${profile.display_name} · ${binding.nickname} (${binding.uid})${binding.credential_status === 'invalid' ? copy.tools.pages_DepotValuePage_069 : ''}`
    : profile.display_name
}

function parseDepotText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error(copy.tools.pages_DepotValuePage_070)
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new Error(copy.tools.pages_DepotValuePage_071)
  }
}

function formatRankingNote(result: DepotValueResponse): string {
  if (result.ranking.mode === 'sample_adjusted') {
    const weightText = `${Math.round(result.ranking.sample_weight * 100)}%`
    return `${copy.tools.pages_DepotValuePage_072}${formatNumber(result.ranking.sample_count)}${copy.tools.pages_DepotValuePage_073}${weightText}。`
  }
  if (result.ranking.sample_count > 0) {
    return copy.tools.pages_DepotValuePage_074
  }
  return copy.tools.pages_DepotValuePage_075
}

function formatUnitSanityLabel(item: DepotValueItem): string {
  if (item.id === LMD_ITEM_ID) return `${copy.tools.pages_DepotValuePage_076}${formatNumber(item.unit_sanity * 10000)}${copy.tools.pages_DepotValuePage_077}`
  return `${copy.tools.pages_DepotValuePage_078}${formatNumber(item.unit_sanity)}${copy.tools.pages_DepotValuePage_079}`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat(CURRENT_LOCALE, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}
