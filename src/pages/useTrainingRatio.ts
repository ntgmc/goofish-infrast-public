import { useEffect, useState } from 'react'
import { useSklandSnapshot } from '../hooks/useSklandSnapshot'
import { analyzeTrainingBalance } from '../lib/training-ratio'
import { useSiteFeatures } from '../lib/site-feature-context'
import type { useToolSession } from './tool/useToolSession'

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
  const [manualInventory, setManualInventory] = useState<{ lmd: number; exp: number } | null>(null)
  const snapshot = useSklandSnapshot(session.user?.id, profile, canImport)
  const stock = snapshot.data?.inventory
  const data = stock?.lmd !== null && stock?.exp !== null && stock?.fetchedAt
    ? { inventory: { lmd: stock.lmd, exp: stock.exp }, importedAt: stock.fetchedAt } : null
  const { busy, error, refresh: load } = snapshot
  const manualValid = trainingAmount(draft.lmd) && (draft.useBooks ? draft.books.every(trainingAmount) : trainingAmount(draft.exp))
  function applyManual() {
    if (!manualValid) return
    setManualInventory({ lmd: Number(draft.lmd), exp: draft.useBooks
      ? draft.books.reduce((sum, value, index) => sum + Number(value) * [200, 400, 1000, 2000][index], 0) : Number(draft.exp) })
  }
  const inventory = source === 'imported' ? data?.inventory ?? null : manualInventory
  const balance = inventory ? analyzeTrainingBalance(inventory) : null
  return { draft, setDraft, draftFailed, source, setSource, data, busy, error, load, manualValid, applyManual, inventory, balance, canImport }
}
