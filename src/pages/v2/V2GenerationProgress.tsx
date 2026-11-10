import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ScheduleProgress, { SCHEDULE_PROGRESS_COMPLETION_DURATION_MS, type ScheduleProgressState } from '../../components/ScheduleProgress'
import { motionTokens } from '../../components/MotionPrimitives'
import { useAppReducedMotion } from '../../lib/motion-preference'

export default function V2GenerationProgress({ progress, resultReady, action, children }: {
  progress: ScheduleProgressState | null
  resultReady: boolean
  action?: ReactNode
  children?: ReactNode
}) {
  const reduced = useAppReducedMotion()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const key = progress ? `${progress.jobId ?? 'local'}:${progress.startedAt}` : null
  const completed = progress?.estimatePhase === 'completed' || progress?.completedAt !== undefined
  const completedAt = progress?.completedAt
  useEffect(() => {
    if (!completed || !resultReady || !key) return
    const delay = reduced ? 0 : Math.max(0, (completedAt ?? Date.now()) + SCHEDULE_PROGRESS_COMPLETION_DURATION_MS + 200 - Date.now())
    const timer = window.setTimeout(() => setDismissed(key), delay)
    return () => window.clearTimeout(timer)
  }, [completed, completedAt, key, reduced, resultReady])
  return <>
    <AnimatePresence initial={false}>
      {progress && key !== dismissed && !(reduced && completed && resultReady) && <motion.div key="progress" className="v2-progress-handoff"
        initial={false} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.24, ease: motionTokens.ease.exit }}>
        <div className="v2-progress"><ScheduleProgress progress={progress} action={completed ? undefined : action} stageMotion /></div>
      </motion.div>}
    </AnimatePresence>
    {children}
  </>
}
