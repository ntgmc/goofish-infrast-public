// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import ThanksPage from './ThanksPage'

describe('ThanksPage', () => {
  it('renders the verified default projects, developer, and generic helper credit', () => {
    render(<MemoryRouter><ThanksPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: '致谢' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数据与社区项目' })).toBeInTheDocument()
    expect(screen.getByText('一图流')).toBeInTheDocument()
    expect(screen.getByText('企鹅物流')).toBeInTheDocument()
    expect(screen.getByText('PRTS Wiki')).toBeInTheDocument()
    expect(screen.getByText('MAA')).toBeInTheDocument()
    expect(screen.getByText('铃语')).toBeInTheDocument()
    expect(screen.getByText('所有参与开发、测试、反馈与验证的协助者')).toBeInTheDocument()
  })
})
