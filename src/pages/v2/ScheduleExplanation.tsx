import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { copy } from '../../copy'
import { apiJson } from '../../lib/api-client'
import { scheduleExplanationStateSchema } from '../../lib/schedule-explanation'
import type { OptimizeResult } from '../../lib/types'
import './schedule-explanation.css'

const text = copy.scheduleExplanation

export default function ScheduleExplanation({ userId, profileId, resultId, sample, result }: {
  userId?: string; profileId?: string; resultId?: string; sample: boolean; result: OptimizeResult
}) {
  if (sample) return <section className="v2-explanation" aria-label={text.sampleTitle}>
    <h2>{text.sampleTitle}</h2>
    <p>{text.sample((result.daily_production?.trading?.LMD ?? 0).toLocaleString('zh-CN'),
      ((result.daily_production?.manufacturing?.['Battle Record'] ?? 0) * 1000).toLocaleString('zh-CN'))}</p>
    <p className="v2-muted">{text.sampleAction}</p>
  </section>
  return userId && profileId && resultId ? <PersonalExplanation key={`${userId}:${profileId}:${resultId}`} userId={userId} profileId={profileId} resultId={resultId} /> : null
}

function PersonalExplanation({ userId, profileId, resultId }: { userId: string; profileId: string; resultId: string }) {
  const client = useQueryClient()
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const key = ['user', userId, profileId, 'schedule-explanation', resultId]
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiJson<unknown>(`/api/user/schedule-explanation?${new URLSearchParams({ profile_id: profileId, result_id: resultId })}`, { signal, fallbackMessage: text.failed }).then(parseState),
    refetchInterval: (query) => query.state.data?.pending ? 2500 : false,
  })
  const mutation = useMutation({
    mutationFn: () => apiJson<unknown>('/api/user/schedule-explanation', {
      method: 'POST', json: { profile_id: profileId, result_id: resultId }, timeoutMs: 105000, fallbackMessage: text.failed,
    }).then(parseState),
    retry: false,
    onMutate: () => client.cancelQueries({ queryKey: key }),
    onSuccess: async (data) => {
      if (!active.current || !client.getQueryState(key)) return
      client.setQueryData(key, data)
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'user' && query.queryKey[1] === userId && query.queryKey[3] === 'schedule-explanation' })
    },
    onError: () => { if (active.current) void query.refetch({ cancelRefetch: false }) },
  })
  const state = query.data
  const pending = mutation.isPending || state?.pending
  const error = mutation.error ?? query.error
  return <section className="v2-explanation" aria-label={text.title} aria-busy={pending || query.isPending}>
    <div className="v2-explanation-heading"><div><h2>{text.title}</h2><p className="v2-muted">{text.description}</p></div>
      {!state?.explanation && state?.available && <button className="v2-button v2-button-secondary" type="button" disabled={pending} onClick={() => mutation.mutate()}>{pending ? text.generating : text.generate}</button>}
    </div>
    {state?.explanation ? <><div className="v2-explanation-body">{state.explanation.text.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><p className="v2-muted">{text.saved} {text.estimate}</p></> : <>
      {(query.isPending || pending || state?.reason) && <p role="status">{query.isPending ? text.loading : pending ? text.pending : state?.reason ? text.reason[state.reason] : ''}</p>}
      {state && <p className="v2-muted">{text.quota(state.quota.remaining, state.quota.limit, state.quota.kind === 'monthly')}
        {state.quota.resets_at && <> {text.reset(new Date(state.quota.resets_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</>}</p>}
      {state?.available && state.provider && <p className="v2-muted">{text.disclosure(state.provider)}</p>}
    </>}
    {error && <p role="alert" className="v2-explanation-error">{error.message} <button type="button" className="v2-text-button" onClick={() => { mutation.reset(); void query.refetch({ cancelRefetch: false }) }}>{text.retry}</button></p>}
  </section>
}

function parseState(value: unknown) {
  const parsed = scheduleExplanationStateSchema.safeParse(value)
  if (!parsed.success) throw new Error(text.failed)
  return parsed.data
}
