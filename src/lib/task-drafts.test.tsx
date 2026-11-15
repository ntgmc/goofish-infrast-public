// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { USER_LOGOUT_EVENT } from './auth-navigation'
import { TaskDraftProvider, useTaskDraft } from './task-drafts'

afterEach(cleanup)

function Draft({ scope }: { scope: string }) {
  const [value, setValue] = useTaskDraft(scope, '')
  return <input aria-label="业务草稿" value={value} onChange={(event) => setValue(event.target.value)} />
}

it('restores tab drafts after route unmounts, isolates accounts, and clears them on logout', () => {
  function Page() {
    const [scope, setScope] = useState('user-a:profile-a')
    const [visible, setVisible] = useState(true)
    return <><button onClick={() => setVisible(!visible)}>切换页面</button><button onClick={() => setScope(scope === 'user-a:profile-a' ? 'user-b:profile-b' : 'user-a:profile-a')}>切换用户</button>{visible && <Draft scope={scope} />}</>
  }
  render(<TaskDraftProvider><Page /></TaskDraftProvider>)
  fireEvent.change(screen.getByLabelText('业务草稿'), { target: { value: '未提交内容' } })
  fireEvent.click(screen.getByText('切换页面'))
  fireEvent.click(screen.getByText('切换页面'))
  expect(screen.getByLabelText('业务草稿')).toHaveValue('未提交内容')
  fireEvent.click(screen.getByText('切换用户'))
  expect(screen.getByLabelText('业务草稿')).toHaveValue('')
  fireEvent.click(screen.getByText('切换用户'))
  expect(screen.getByLabelText('业务草稿')).toHaveValue('未提交内容')
  fireEvent.click(screen.getByText('切换页面'))
  window.dispatchEvent(new Event(USER_LOGOUT_EVENT))
  fireEvent.click(screen.getByText('切换页面'))
  expect(screen.getByLabelText('业务草稿')).toHaveValue('')
  expect(sessionStorage.length).toBe(0)
})
