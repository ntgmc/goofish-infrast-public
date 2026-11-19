import { z } from 'zod'
import { copy } from '../copy'
import { apiJson } from './api-client'
import { scheduleExplanationStateSchema } from './schedule-explanation'
import { workspaceAssistantReplySchema, type WorkspaceAssistantRequest } from './workspace-assistant'

export async function readWorkspaceAssistant(profileId: string, task: WorkspaceAssistantRequest['task'], signal?: AbortSignal) {
  return scheduleExplanationStateSchema.parse(await apiJson(`/api/user/workspace-assistant?${new URLSearchParams({ profile_id: profileId, task })}`, {
    signal, fallbackMessage: copy.v2.workspaceAssistant.failed,
  }))
}

const responseSchema = z.object({ reply: workspaceAssistantReplySchema.nullable(), state: scheduleExplanationStateSchema })

export async function askWorkspaceAssistant(request: WorkspaceAssistantRequest, signal: AbortSignal) {
  return responseSchema.parse(await apiJson('/api/user/workspace-assistant', {
    method: 'POST', json: request, signal, timeoutMs: 95_000, fallbackMessage: copy.v2.workspaceAssistant.failed,
  }))
}
