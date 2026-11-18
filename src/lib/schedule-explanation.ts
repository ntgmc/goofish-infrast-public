import { z } from 'zod'
import { ApiError } from './api-client'
import { readServerSentEvents } from './server-sent-events'

export const scheduleExplanationStateSchema = z.object({
  explanation: z.object({ text: z.string().min(1).max(4000), created_at: z.iso.datetime() }).nullable(),
  pending: z.boolean(),
  available: z.boolean(),
  reason: z.enum(['disabled', 'quota', 'budget', 'daily_limit', 'busy']).nullable(),
  quota: z.object({ kind: z.enum(['trial', 'monthly']), limit: z.number().int().nonnegative(), remaining: z.number().int().nonnegative(), resets_at: z.iso.datetime().nullable() }),
  provider: z.string().nullable(),
})

export type ScheduleExplanationState = z.infer<typeof scheduleExplanationStateSchema>

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string().max(4000) }),
  z.object({ type: z.literal('state'), state: scheduleExplanationStateSchema }),
  z.object({ type: z.literal('error'), error: z.string().max(500), code: z.string() }),
])

export async function readScheduleExplanationResponse(response: Response, onDelta: (text: string) => void) {
  if (response.headers.get('content-type')?.includes('application/json')) return scheduleExplanationStateSchema.parse(await response.json())
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('invalid_explanation_stream')
  let state: ScheduleExplanationState | undefined
  let length = 0
  for await (const data of readServerSentEvents(response.body)) {
    const event = eventSchema.parse(JSON.parse(data))
    if (event.type === 'error') throw new ApiError(event.error, 502, { code: event.code }, '/api/user/schedule-explanation')
    if (event.type === 'state') state = event.state
    else {
      length += event.text.length
      if (length > 4000) throw new Error('explanation_too_large')
      onDelta(event.text)
    }
  }
  if (!state || state.pending) throw new Error('incomplete_explanation_stream')
  return state
}
