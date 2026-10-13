// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PERSONAL_USE_DECLARATION } from '../lib/personal-use-declaration'
import { usePersonalUseDeclaration } from './usePersonalUseDeclaration'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../lib/api-client', () => ({ apiJson: mocks.apiJson }))

const declaration = {
  ...PERSONAL_USE_DECLARATION,
  contentHash: 'b'.repeat(64),
}

afterEach(() => {
  cleanup()
  mocks.apiJson.mockReset()
})

describe('usePersonalUseDeclaration', () => {
  it.each(['load', 'confirm'])('routes %s failures to the protected operation’s error handler', async (stage) => {
    const run = vi.fn()
    const onError = vi.fn()
    const onOperationError = vi.fn()
    if (stage === 'load') mocks.apiJson.mockRejectedValueOnce(new Error('无法读取声明'))
    else mocks.apiJson.mockResolvedValueOnce({ declaration, accepted: false, effective: true })
      .mockRejectedValueOnce(new Error('确认失败'))
      .mockResolvedValueOnce({ declaration, accepted: false, effective: true })
    render(<Harness run={run} onError={onError} onOperationError={onOperationError} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '开始生成' }))
    if (stage === 'confirm') {
      await user.click(await screen.findByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: '确认并继续' }))
    }
    await waitFor(() => expect(onOperationError).toHaveBeenCalledWith(stage === 'load' ? '无法读取声明' : '确认失败'))
    expect(run).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('posts the server document identity and replays the protected operation', async () => {
    const run = vi.fn()
    const onError = vi.fn()
    mocks.apiJson
      .mockResolvedValueOnce({ declaration, accepted: false, effective: true })
      .mockResolvedValueOnce({
        declaration,
        accepted: true,
        effective: true,
        acceptance: {
          declaration_id: declaration.id,
          declaration_version: declaration.version,
          content_hash: declaration.contentHash,
          action: 'optimization_generate',
          accepted_at: '2026-08-01T00:00:00.000Z',
        },
      })
    render(<Harness run={run} onError={onError} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '开始生成' }))
    expect(await screen.findByText(new RegExp(declaration.version))).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '确认并继续' }))

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(onError).not.toHaveBeenCalled()
    expect(mocks.apiJson).toHaveBeenNthCalledWith(2, '/api/user/personal-use-declaration', expect.objectContaining({
      method: 'POST',
      json: {
        action: 'optimization_generate',
        profile_id: 'profile-1',
        declaration_id: declaration.id,
        content_hash: declaration.contentHash,
      },
    }))
  })
})

function Harness({ run, onError, onOperationError }: { run: () => void; onError: (message: string) => void; onOperationError?: (message: string) => void }) {
  const { guard, declarationDialog } = usePersonalUseDeclaration({
    enabled: true,
    profileId: 'profile-1',
    onError,
  })
  return (
    <>
      <button type="button" onClick={() => void guard('optimization_generate', run, undefined, onOperationError)}>开始生成</button>
      {declarationDialog}
    </>
  )
}
