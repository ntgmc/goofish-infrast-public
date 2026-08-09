import { createHmac, randomUUID } from 'node:crypto'

export type AliyunEcsWorkerStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown'

export type AliyunEcsWorkerController = {
  getStatus: () => Promise<AliyunEcsWorkerStatus>
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type AliyunEcsWorkerControllerOptions = {
  accessKeyId: string
  accessKeySecret: string
  regionId: string
  instanceId: string
  endpoint?: string
  stoppedMode?: 'StopCharging' | 'KeepCharging'
  securityToken?: string
  fetch?: typeof globalThis.fetch
  now?: () => Date
  nonce?: () => string
  timeoutMs?: number
}

export class AliyunEcsApiError extends Error {
  constructor(
    readonly action: string,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'AliyunEcsApiError'
  }
}

export function createAliyunEcsWorkerController(
  options: AliyunEcsWorkerControllerOptions,
): AliyunEcsWorkerController {
  const accessKeyId = requireNonEmpty('accessKeyId', options.accessKeyId)
  const accessKeySecret = requireNonEmpty('accessKeySecret', options.accessKeySecret)
  const regionId = requireNonEmpty('regionId', options.regionId)
  const instanceId = requireNonEmpty('instanceId', options.instanceId)
  const endpoint = validateEndpoint(options.endpoint ?? 'https://ecs.aliyuncs.com')
  const stoppedMode = options.stoppedMode ?? 'StopCharging'
  const requestFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const nonce = options.nonce ?? randomUUID
  const timeoutMs = positiveInteger(options.timeoutMs, 10_000)

  if (typeof requestFetch !== 'function') throw new Error('Aliyun ECS autoscaling requires a fetch implementation')

  return {
    getStatus: async () => {
      const response = await callApi('DescribeInstanceStatus', {
        InstanceId: instanceId,
        IncludeAllStatus: 'true',
      })
      const statuses = response.InstanceStatuses?.InstanceStatus
      const status = Array.isArray(statuses) ? statuses[0]?.Status : undefined
      return normalizeStatus(status)
    },
    start: async () => {
      await callApi('StartInstance', { InstanceId: instanceId })
    },
    stop: async () => {
      await callApi('StopInstance', {
        InstanceId: instanceId,
        ForceStop: 'false',
        // StopCharging stops compute billing for eligible pay-as-you-go ECS
        // instances. The attached disks and public IP may still incur charges.
        StoppedMode: stoppedMode,
      })
    },
  }

  async function callApi(action: string, extra: Record<string, string>): Promise<AliyunRpcResponse> {
    const parameters: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: action,
      Format: 'JSON',
      RegionId: regionId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: nonce(),
      SignatureVersion: '1.0',
      Timestamp: formatTimestamp(now()),
      Version: '2014-05-26',
      ...extra,
      ...(options.securityToken?.trim() ? { SecurityToken: options.securityToken.trim() } : {}),
    }
    const signature = signRpcRequest(parameters, accessKeySecret)
    parameters.Signature = signature
    const url = new URL(endpoint)
    for (const [key, value] of Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))) {
      url.searchParams.set(key, value)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    timeout.unref?.()
    let response: Response
    try {
      response = await requestFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? `Aliyun ECS ${action} request timed out`
        : `Aliyun ECS ${action} request failed`
      throw new AliyunEcsApiError(action, 'request_failed', message)
    } finally {
      clearTimeout(timeout)
    }

    const payload = await parseResponse(response)
    if (!response.ok || typeof payload.Code === 'string') {
      throw new AliyunEcsApiError(
        action,
        typeof payload.Code === 'string' ? payload.Code : `http_${response.status}`,
        typeof payload.Message === 'string' ? payload.Message : `Aliyun ECS ${action} request failed`,
        typeof payload.RequestId === 'string' ? payload.RequestId : undefined,
      )
    }
    return payload
  }
}

export function createAliyunEcsWorkerControllerFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: Pick<AliyunEcsWorkerControllerOptions, 'fetch' | 'now' | 'nonce'> = {},
): AliyunEcsWorkerController | null {
  const accessKeyId = environment.ALIYUN_ACCESS_KEY_ID?.trim()
  const accessKeySecret = environment.ALIYUN_ACCESS_KEY_SECRET?.trim()
  const regionId = environment.ALIYUN_ECS_REGION_ID?.trim()
  const instanceId = (environment.ALIYUN_ECS_WORKER_INSTANCE_ID ?? environment.ALIYUN_ECS_INSTANCE_ID)?.trim()
  const values = [accessKeyId, accessKeySecret, regionId, instanceId]
  if (values.every((value) => !value)) return null
  if (values.some((value) => !value)) {
    throw new Error(
      'ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET, ALIYUN_ECS_REGION_ID and ALIYUN_ECS_WORKER_INSTANCE_ID (or ALIYUN_ECS_INSTANCE_ID) are required together',
    )
  }
  return createAliyunEcsWorkerController({
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    regionId: regionId!,
    instanceId: instanceId!,
    endpoint: environment.ALIYUN_ECS_ENDPOINT,
    stoppedMode: environment.ALIYUN_ECS_STOPPED_MODE === 'KeepCharging' ? 'KeepCharging' : 'StopCharging',
    securityToken: environment.ALIYUN_SECURITY_TOKEN,
    ...dependencies,
  })
}

export function signRpcRequest(
  parameters: Readonly<Record<string, string>>,
  accessKeySecret: string,
): string {
  const canonicalizedQueryString = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join('&')
  const stringToSign = `GET&%2F&${percentEncode(canonicalizedQueryString)}`
  return createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
}

function normalizeStatus(value: unknown): AliyunEcsWorkerStatus {
  if (value === 'Running') return 'running'
  if (value === 'Stopped') return 'stopped'
  if (value === 'Starting') return 'starting'
  if (value === 'Stopping') return 'stopping'
  return 'unknown'
}

function formatTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error('Aliyun ECS request timestamp is invalid')
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function validateEndpoint(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('ALIYUN_ECS_ENDPOINT must be a valid HTTPS URL')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('ALIYUN_ECS_ENDPOINT must be an HTTPS origin without credentials, path, query, or fragment')
  }
  return parsed.toString()
}

function requireNonEmpty(name: string, value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Aliyun ECS ${name} is required`)
  return normalized
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}

type AliyunRpcResponse = {
  Code?: unknown
  Message?: unknown
  RequestId?: unknown
  InstanceStatuses?: {
    InstanceStatus?: Array<{ Status?: unknown }>
  }
  [key: string]: unknown
}

async function parseResponse(response: Response): Promise<AliyunRpcResponse> {
  try {
    const payload = await response.json() as unknown
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as AliyunRpcResponse
      : {}
  } catch {
    return {}
  }
}
