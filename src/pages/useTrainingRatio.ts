import { useCallback, useEffect, useRef, useState } from 'react'
import { copy } from '../copy'
import { apiJson } from '../lib/api-client'
import type { CultivationData } from '../lib/cultivation-contract'
import { analyzeTrainingBalance } from '../lib/training-ratio'
import { useSiteFeatures } from '../lib/site-feature-context'
import type { useToolSession } from './tool/useToolSession'

const text = copy.trainingRatio
const initialDraft = { lmd: '0', exp: '0', books: ['0', '0', '0', '0'], useBooks: false }
type Draft = typeof initialDraft
export const trainingAmount = (value: string) => value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12

function readDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Draft | null
    if (value && typeof value.lmd === 'string' && typeof value.exp === 'string' && typeof value.useBooks === 'boolean'
      && Array.isArray(value.books) && value.books.length === 4 && value.books.every((entry) => typeof entry === 'string')) {
      return { lmd: value.lmd, exp: value.exp, books: value.books, useBooks: value.useBooks }
    }
  } catch { /* An unavailable or invalid draft starts a new calculation. */ }
  return initialDraft
}

export function useTrainingRatio(session: ReturnType<typeof useToolSession>) {
  const profile = session.activeProfile
  const { features } = useSiteFeatures()
  const canImport = Boolean(features.skland && session.user && profile?.skland_binding && profile.status === 'active' && !profile.archived_at)
  const draftKey = `maatool:training-ratio:${session.user?.id ?? 'guest'}:${profile?.id ?? 'none'}`
  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [draftFailed, setDraftFailed] = useState(false)
  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); setDraftFailed(false) }
    catch { setDraftFailed(true) }
  }, [draft, draftKey])
  const [source, setSource] = useState<'manual' | 'imported'>('imported')
  const [data, setData] = useState<{ inventory: { lmd: number; exp: number }; importedAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    if (!profile || !canImport || request.current && !request.current.signal.aborted) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      const result = await apiJson<CultivationData>('/api/cultivation-plan', { method: 'POST', json: { profile_id: profile.id, projects: [] }, signal: controller.signal, timeoutMs: 90000, fallbackMessage: text.importFailed })
      const inventory = { lmd: result.inventory['4001'] ?? 0, exp: result.inventory.exp ?? 0 }
      analyzeTrainingBalance(inventory)
      if (!controller.signal.aborted) setData({ inventory, importedAt: result.importedAt })
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error && caught.message !== 'invalid_training_resources' ? caught.message : text.importFailed) }
    finally { if (!controller.signal.aborted) { setBusy(false); request.current = null } }
  }, [canImport, profile?.id, session.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (canImport) void load()
    return () => request.current?.abort()
  }, [canImport, load])
  const valid = source === 'imported' ? Boolean(data) : trainingAmount(draft.lmd) && (draft.useBooks ? draft.books.every(trainingAmount) : trainingAmount(draft.exp))
  const inventory = source === 'imported' ? data?.inventory ?? null : valid ? { lmd: Number(draft.lmd), exp: draft.useBooks
    ? draft.books.reduce((sum, value, index) => sum + Number(value) * [200, 400, 1000, 2000][index], 0) : Number(draft.exp) } : null
  const balance = inventory ? analyzeTrainingBalance(inventory) : null
  return { draft, setDraft, draftFailed, source, setSource, data, busy, error, load, valid, inventory, balance, canImport }
}
