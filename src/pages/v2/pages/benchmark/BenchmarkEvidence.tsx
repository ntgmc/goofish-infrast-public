import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { copy } from '../../../../copy'
import { BENCHMARK_ASSETS, benchmarkNumber as number, type BenchmarkCase } from '../../../../lib/site-benchmark'

const text = copy.siteBenchmark
const addition = z.object({ operator: z.string(), room_index: z.number(), shift_index: z.number() })
const mood = z.object({ passed: z.boolean(), stable: z.boolean(), iterations: z.number(), additions: z.array(addition), unassigned: z.array(z.object({ operator: z.string(), shift_index: z.number() })) })
const plan = z.object({
  shift: z.number(), hours: z.number(),
  drones: z.object({ enable: z.boolean().optional(), room: z.string().optional(), index: z.number().optional(), order: z.string().optional() }),
  fiammetta: z.object({ enable: z.boolean().optional(), target: z.string().optional(), order: z.string().optional() }),
  moodErrors: z.array(z.object({ operator: z.string(), start: z.number(), needed: z.number() })),
  rooms: z.array(z.object({ kind: z.string(), index: z.number(), operators: z.array(z.string()), product: z.string().optional(),
    operatorsA: z.array(z.string()).optional(), operatorsB: z.array(z.string()).optional(),
    mood: z.array(z.object({ operator: z.string(), start: z.number(), end: z.number(), red_face: z.boolean().optional() })).optional(),
  })),
})
const evidenceSchema = z.object({ schemaVersion: z.literal(1), caseId: z.string(), nativePlans: z.array(plan), simulatedPlans: z.array(plan), mood,
  dormitoryDiagnosis: z.object({ mood, plans: z.array(plan), appliedAdditions: z.array(addition) }).nullable() })

export default function BenchmarkEvidence({ item }: { item: BenchmarkCase }) {
  const [source, setSource] = useState<'native' | 'simulated' | 'diagnosis'>('simulated')
  const [shift, setShift] = useState(0)
  const query = useQuery({
    queryKey: ['public', 'site-benchmark', BENCHMARK_ASSETS, item.id], staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${BENCHMARK_ASSETS}/cases/${item.id}.json`, { signal, credentials: 'omit' })
      if (!response.ok) throw new Error(text.evidenceError)
      const evidence = evidenceSchema.parse(await response.json())
      if (evidence.caseId !== item.id) throw new Error(text.evidenceError)
      return evidence
    },
  })
  if (query.isPending) return <p role="status">{text.evidenceLoading}</p>
  if (!query.data) return <div role="alert"><p>{text.evidenceError}</p><button type="button" className="v2-button v2-button-secondary" onClick={() => void query.refetch()}>{text.retry}</button></div>
  const evidence = query.data
  const plans = source === 'native' ? evidence.nativePlans : source === 'diagnosis' ? evidence.dormitoryDiagnosis!.plans : evidence.simulatedPlans
  const current = plans[shift]
  const roomName = (kind: string) => text.roomTypes[kind as keyof typeof text.roomTypes] ?? kind
  const order = (value?: string) => text.actionOrder[value as keyof typeof text.actionOrder] ?? ''
  return <section className="benchmark-evidence" aria-label={text.planTitle}>
    <h4>{text.planTitle}</h4><p className="benchmark-muted">{text.evidenceNote}</p>
    <div className="benchmark-switches" role="group" aria-label={text.planTitle}>{(['simulated', 'native', ...(evidence.dormitoryDiagnosis ? ['diagnosis'] : [])] as ('simulated' | 'native' | 'diagnosis')[]).map((value) => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)}>{value === 'native' ? text.nativePlans : value === 'diagnosis' ? text.diagnosis : text.simulatedPlans}</button>)}</div>
    <div className="benchmark-switches" role="group" aria-label={text.shifts}>{plans.map((plan, index) => <button type="button" key={index} aria-pressed={shift === index} onClick={() => setShift(index)}>{text.shift(index + 1)} · {text.hours(plan.hours)}</button>)}</div>
    <dl className="benchmark-actions-summary"><div><dt>{text.drones}</dt><dd>{current.drones.enable ? `${roomName(current.drones.room!)}${current.drones.index} · ${order(current.drones.order)}` : text.actionDisabled}</dd></div><div><dt>{text.fiammetta}</dt><dd>{current.fiammetta.enable ? `${current.fiammetta.target} · ${order(current.fiammetta.order)}` : text.actionDisabled}</dd></div></dl>
    {current.moodErrors.length > 0 && <ul className="benchmark-mood-errors">{current.moodErrors.map((error, index) => <li key={index}>{text.moodError(error.operator, error.start, error.needed)}</li>)}</ul>}
    <table className="benchmark-table benchmark-room-table"><thead><tr><th scope="col">{text.room}</th><th scope="col">{text.operators}</th><th scope="col">{text.mood}</th></tr></thead><tbody>{current.rooms.map((room) => <tr key={`${room.kind}-${room.index}`}><th scope="row">{roomName(room.kind)}{room.index}{room.product && <small>{text.products[room.product as keyof typeof text.products] ?? room.product}</small>}</th><td>{[...room.operators, ...room.operatorsA ?? [], ...room.operatorsB ?? []].join('、') || text.noOperators}</td><td>{room.mood?.map((entry) => <span key={entry.operator} className={entry.red_face ? 'benchmark-invalid' : undefined}>{entry.operator} {number(entry.start, 1)}→{number(entry.end, 1)}</span>) ?? '—'}</td></tr>)}</tbody></table>
    {evidence.dormitoryDiagnosis && <details className="benchmark-disclosure"><summary>{text.additions} · {evidence.dormitoryDiagnosis.appliedAdditions.length}</summary>{evidence.dormitoryDiagnosis.appliedAdditions.length ? <ul className="benchmark-additions">{evidence.dormitoryDiagnosis.appliedAdditions.map((addition) => <li key={`${addition.shift_index}-${addition.operator}`}>{text.shift(addition.shift_index + 1)} · {text.roomTypes.dormitory}{addition.room_index + 1} · {addition.operator}</li>)}</ul> : <p>{text.noAdditions}</p>}</details>}
  </section>
}
