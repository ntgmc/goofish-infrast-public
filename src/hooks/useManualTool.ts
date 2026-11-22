import { useEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../copy/index'
import { CONFIG_PRESETS, normalizeConfig } from '../lib/config'
import { createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson, resolveManualScheduleConfig, UnownedScheduleOperatorsError } from '../lib/manual-schedule-tool'
import { useSiteFeatures } from '../lib/site-feature-context'
import { mergeOperators } from '../lib/license'
import type { LicenseConfig, OptimizeResult } from '../lib/types'
import type { useToolSession } from '../pages/tool/useToolSession'
import { useTaskDraft } from '../lib/task-drafts'

export function useManualTool({ session, onDirtyChange }: { session: ReturnType<typeof useToolSession>; onDirtyChange?: (dirty: boolean) => void }) {
  const label = copy.tools.manualSchedule
  const { features } = useSiteFeatures()
  const available = session.profiles.filter((profile) => isManualScheduleProfileAvailable(profile) &&
    (features.metered_billing || !profile.kind.startsWith('metered_')))
  const profile = available.find((entry) => entry.id === session.activeProfile?.id) ?? available[0]
  const ready = Boolean(profile && profile.id === session.activeProfile?.id && !session.openingProfileId)
  const operators = useMemo(() => ready
    ? mergeOperators(session.workspace?.operators ?? [], session.eliteOverrides) : [],
  [ready, session.workspace?.operators, session.eliteOverrides])
  const draftKey = `manual-tool:${session.user?.id ?? 'guest'}:${profile?.id ?? 'none'}`
  const [preset, setPreset] = useTaskDraft(`${draftKey}:preset`, '')
  const [shiftHours, setShiftHours] = useTaskDraft<string | null>(`${draftKey}:hours`, null)
  const [configDraft, setConfigDraft] = useTaskDraft<LicenseConfig | null>(`${draftKey}:config`, null)
  const baseConfig = configDraft ?? normalizeConfig(preset ? CONFIG_PRESETS[preset] : session.workspace?.config ?? CONFIG_PRESETS['243'])
  const configuredHours = shiftHours ?? (Array.isArray(baseConfig.shift_hours) ? baseConfig.shift_hours.join('-') : baseConfig.shift_hours ?? '8-8-8')
  const [draft, setDraft] = useTaskDraft<{ source: OptimizeResult; config: LicenseConfig; profileId: string; revision: number } | null>(`${draftKey}:schedule`, null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const revision = useRef(0)
  const profileId = useRef(profile?.id)
  profileId.current = profile?.id
  const canUse = session.authStatus === 'authenticated' && ready && operators.some((operator) => operator.own) && features.schedule_generation
  const enabled = canUse && !importing

  useEffect(() => {
    onDirtyChange?.(false)
    setError(null)
    revision.current = (draft?.revision ?? 0) + 1
  }, [profile?.id])

  const configuration = (): LicenseConfig => ({
    ...baseConfig,
    schedule_mode: 'maa', dormitory_rule: 'fixed', shift_hours: configuredHours, Fiammetta: { enable: false },
    drones: { enable: false, order: 'pre', targets: [] },
    variable_shift_schedule: undefined,
  })

  function start() {
    if (!enabled || !profile) return
    if (draft && !window.confirm(label.replace)) return
    try {
      const config = configuration()
      const source = createBlankManualSchedule(config)
      setDraft({ source, config, profileId: profile.id, revision: ++revision.current })
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : label.importFailed)
    }
  }

  async function importSchedule(file: File | undefined) {
    if (!file || !enabled || !profile) return
    const selectedProfileId = profile.id
    const run = ++revision.current
    setImporting(true)
    setError(null)
    try {
      if (file.size > 5_000_000) throw new Error(label.tooLarge)
      const config = configuration()
      const source = parseManualScheduleJson(await file.text(), config, operators)
      if (revision.current === run && profileId.current === selectedProfileId) {
        if (draft && !window.confirm(label.replace)) return
        setDraft({ source, config: resolveManualScheduleConfig(source, config, operators), profileId: selectedProfileId, revision: run })
      }
    } catch (caught) {
      if (revision.current === run) setError(caught instanceof Error &&
        (caught instanceof UnownedScheduleOperatorsError ||
          [label.tooLarge, label.importMissingProduct, label.fiammettaInvalid, copy.common.facilityLayoutRequired].some((message) => message === caught.message))
        ? caught.message : label.importFailed)
    } finally {
      setImporting(false)
      if (upload.current) upload.current.value = ''
    }
  }

  return { available, profile, ready, operators, preset, setPreset, setConfigDraft, baseConfig, configuredHours,
    setShiftHours, draft, error, importing, upload, canUse, enabled, start, importSchedule }
}
