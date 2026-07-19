// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import RegistrationSettingsSection from './RegistrationSettingsSection'

describe('RegistrationSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockResolvedValue({ settings: { version: 1, email_verification_required: true, updated_at: null } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads the default-on setting and saves an explicit disabled value', async () => {
    const user = userEvent.setup()
    render(<RegistrationSettingsSection />)
    const toggle = await screen.findByRole('checkbox', { name: '注册时要求验证邮箱' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '保存注册设置' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/registration-settings', expect.objectContaining({
      method: 'PUT',
      json: { email_verification_required: false },
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('注册设置已保存')
  })
})
