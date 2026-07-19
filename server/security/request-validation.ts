import { z } from 'zod'
import { REQUEST_BODY_LIMITS, type RequestBodyProfile } from './request-policy'

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const validatedBodies = new WeakMap<Request, { schema: z.ZodType; value: unknown }>()

type ValidationIssue = { path: string; code: string }

export class RequestInputError extends Error {
  readonly status: number
  readonly code: string
  readonly issues: ValidationIssue[]

  constructor(message: string, code = 'invalid_request', status = 400, issues: ValidationIssue[] = []) {
    super(message)
    this.name = 'RequestInputError'
    this.status = status
    this.code = code
    this.issues = issues.slice(0, 10)
  }
}

export async function validateAndStoreJsonBody(
  req: Request,
  schema: z.ZodType,
  profile: RequestBodyProfile,
  enforceSchema = true,
): Promise<void> {
  const bytes = new Uint8Array(await req.clone().arrayBuffer())
  const byteLimit = REQUEST_BODY_LIMITS[profile]
  if (byteLimit > 0 && bytes.byteLength > byteLimit) {
    throw new RequestInputError('Request body too large.', 'payload_too_large', 413)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RequestInputError('Request body must be valid UTF-8.')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (!text.trim()) throw new RequestInputError('Request body must contain JSON.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RequestInputError('Malformed JSON request body.')
  }

  assertJsonComplexity(parsed, profile)
  const result = schema.safeParse(parsed)
  if (!result.success) {
    if (!enforceSchema) {
      validatedBodies.set(req, { schema, value: parsed })
      return
    }
    throw new RequestInputError(
      'Request body does not match the expected schema.',
      'invalid_request',
      400,
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    )
  }
  validatedBodies.set(req, { schema, value: result.data })
}

export async function getValidatedJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  if (!validatedBodies.has(req)) await validateAndStoreJsonBody(req, schema, 'standard', false)
  const entry = validatedBodies.get(req)
  if (!entry || entry.schema !== schema) {
    throw new Error('Validated request body is unavailable or uses the wrong schema')
  }
  return entry.value as z.output<S>
}

export async function getValidatedJsonRecord(req: Request): Promise<Record<string, unknown>> {
  if (!validatedBodies.has(req)) {
    await validateAndStoreJsonBody(req, z.record(z.string(), z.unknown()), 'credential', false)
  }
  const entry = validatedBodies.get(req)
  if (!entry || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) {
    throw new Error('Validated request body is not an object')
  }
  return entry.value as Record<string, unknown>
}

export async function getValidatedJsonValue(req: Request): Promise<unknown> {
  if (!validatedBodies.has(req)) await validateAndStoreJsonBody(req, z.unknown(), 'depot', false)
  const entry = validatedBodies.get(req)
  if (!entry) throw new Error('Validated request body is unavailable')
  return entry.value
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, sortJsonValue(record[key])]),
  )
}

function assertJsonComplexity(value: unknown, profile: RequestBodyProfile): void {
  const budget = profile === 'depot'
    ? { depth: 24, nodes: 50_000, objectKeys: 512, arrayItems: 20_000 }
    : profile === 'compute'
      ? { depth: 24, nodes: 20_000, objectKeys: 256, arrayItems: 5_000 }
      : { depth: 24, nodes: 10_000, objectKeys: 256, arrayItems: 2_000 }
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0

  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > budget.nodes) throw new RequestInputError('JSON request is too complex.')
    if (current.depth > budget.depth) throw new RequestInputError('JSON request is nested too deeply.')
    if (!current.value || typeof current.value !== 'object') continue

    if (Array.isArray(current.value)) {
      if (current.value.length > budget.arrayItems) throw new RequestInputError('JSON array contains too many items.')
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 })
      continue
    }

    const record = current.value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length > budget.objectKeys) throw new RequestInputError('JSON object contains too many fields.')
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) throw new RequestInputError('JSON request contains a forbidden field name.')
      if (key.length > 128) throw new RequestInputError('JSON field name is too long.')
      stack.push({ value: record[key], depth: current.depth + 1 })
    }
  }
}
