import { describe, expect, it, vi } from 'vitest'
import {
  AliyunEcsApiError,
  createAliyunEcsWorkerController,
  createAliyunEcsWorkerControllerFromEnvironment,
  signRpcRequest,
} from './aliyun-ecs-worker-controller'

const baseOptions = {
  accessKeyId: 'test-access-key',
  accessKeySecret: 'test-secret',
  regionId: 'cn-hangzhou',
  instanceId: 'i-test-worker',
  now: () => new Date('2026-08-09T04:00:00.000Z'),
  nonce: () => 'fixed-nonce',
}

describe('Aliyun ECS worker controller', () => {
  it('signs and reads the worker instance status without exposing the secret', async () => {
    let requestedUrl: URL | null = null
    const request = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString())
      return Response.json({
        RequestId: 'request-1',
        InstanceStatuses: { InstanceStatus: [{ InstanceId: 'i-test-worker', Status: 'Running' }] },
      })
    })
    const controller = createAliyunEcsWorkerController({ ...baseOptions, fetch: request as typeof fetch })

    await expect(controller.getStatus()).resolves.toBe('running')

    expect(request).toHaveBeenCalledOnce()
    const url = requestedUrl!
    expect(url.protocol).toBe('https:')
    expect(url.searchParams.get('Action')).toBe('DescribeInstanceStatus')
    expect(url.searchParams.get('InstanceId')).toBe('i-test-worker')
    expect(url.searchParams.get('Timestamp')).toBe('2026-08-09T04:00:00Z')
    expect(url.toString()).not.toContain('test-secret')
    const parameters = Object.fromEntries([...url.searchParams.entries()].filter(([key]) => key !== 'Signature'))
    expect(url.searchParams.get('Signature')).toBe(signRpcRequest(parameters, 'test-secret'))
  })

  it('starts and stops the instance in stop-charging mode', async () => {
    const actions: URL[] = []
    const request = vi.fn(async (input: string | URL | Request) => {
      actions.push(new URL(input instanceof Request ? input.url : input.toString()))
      return Response.json({ RequestId: `request-${actions.length}` })
    })
    const controller = createAliyunEcsWorkerController({ ...baseOptions, fetch: request as typeof fetch })

    await controller.start()
    await controller.stop()

    expect(actions.map((url) => url.searchParams.get('Action'))).toEqual(['StartInstance', 'StopInstance'])
    expect(actions[1]?.searchParams.get('StoppedMode')).toBe('StopCharging')
    expect(actions[1]?.searchParams.get('ForceStop')).toBe('false')
  })

  it('returns a bounded API error and validates all-or-none environment configuration', async () => {
    const controller = createAliyunEcsWorkerController({
      ...baseOptions,
      fetch: vi.fn(async () => Response.json({
        Code: 'IncorrectInstanceStatus',
        Message: 'The instance is already stopping.',
        RequestId: 'request-error',
      }, { status: 400 })) as typeof fetch,
    })

    await expect(controller.stop()).rejects.toMatchObject<Partial<AliyunEcsApiError>>({
      name: 'AliyunEcsApiError',
      action: 'StopInstance',
      code: 'IncorrectInstanceStatus',
      requestId: 'request-error',
    })
    expect(createAliyunEcsWorkerControllerFromEnvironment({})).toBeNull()
    expect(() => createAliyunEcsWorkerControllerFromEnvironment({
      ALIYUN_ACCESS_KEY_ID: 'only-one-value',
    })).toThrow('are required together')
  })
})
