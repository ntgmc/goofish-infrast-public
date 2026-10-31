// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '../../../test/query-render'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { copy } from '../../../copy'
import { siteBenchmark } from '../../../lib/site-benchmark'
import SiteBenchmark from './SiteBenchmark'

const text = copy.siteBenchmark
const evidenceFile = `${process.cwd()}/public/benchmarks/2026-10-31/cases/A01-S2-yituliu.json`

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('opens a shared failed case with the actual frozen evidence, and retains full-batch headlines while filtering', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(await readFile(`${process.cwd()}/public${url}`, 'utf8')))
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/v2/benchmarks?sample=A01&layout=S2&site=yituliu#benchmark-data']}><SiteBenchmark /></MemoryRouter>)
  expect(screen.getByText(text.shown(1, 90))).toBeInTheDocument()
  expect(document.querySelector('[data-score-id="A01-S2-yituliu"]')).toHaveAttribute('aria-expanded', 'true')
  await screen.findByText(text.moodError('香草', 0, 5.2))
  expect(fetch).toHaveBeenCalledWith('/benchmarks/2026-10-31/cases/A01-S2-yituliu.json', expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }))
  await user.click(screen.getByRole('button', { name: text.nativePlans }))
  expect(screen.queryByText(text.moodError('香草', 0, 5.2))).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.diagnosis }))
  expect(fetch).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: text.reset }))
  await user.selectOptions(screen.getByRole('combobox', { name: text.state }), 'failed')
  expect(screen.getByText(text.shown(49, 90))).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: text.headline('MaaTool', 30).join('') })).toBeInTheDocument()
  expect(document.querySelectorAll('.benchmark-score')).toHaveLength(49)
  expect(document.querySelectorAll('.benchmark-score s')).toHaveLength(49)
  await user.click(screen.getByRole('button', { name: text.reset }))
  expect(document.querySelectorAll('.benchmark-score')).toHaveLength(90)
  expect(document.querySelectorAll('.benchmark-score-pass s')).toHaveLength(0)
  await user.click(document.querySelector<HTMLButtonElement>('[data-score-id="A01-S2-riic"]')!)
  await screen.findByRole('button', { name: text.nativePlans })
  expect(screen.queryByRole('button', { name: text.diagnosis })).not.toBeInTheDocument()
  expect(document.querySelector('[data-case-id="A01-S2-yituliu"]')).not.toBeInTheDocument()
  const ownScore = document.querySelector<HTMLButtonElement>('[data-score-id="A01-S2-maatool"]')!
  await user.click(ownScore)
  expect(ownScore).toHaveAttribute('aria-expanded', 'true')
  expect(document.querySelector('[data-case-id="A01-S2-yituliu"]')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.closeEvidence }))
  expect(ownScore).toHaveFocus()
  expect(ownScore).toHaveAttribute('aria-expanded', 'false')
  const downloads = document.getElementById('benchmark-downloads')!
  expect(within(downloads).getByRole('link', { name: /CSV/ })).toHaveAttribute('href', '/benchmarks/2026-10-31/results.csv')
})

it('rejects another case returned for the selected URL and retries the same evidence read', async () => {
  const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'))
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...evidence, caseId: 'A02-S2-yituliu' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(evidence)))
  render(<MemoryRouter initialEntries={['/v2/benchmarks?sample=A01&layout=S2&site=yituliu']}><SiteBenchmark /></MemoryRouter>)
  await screen.findByText(text.evidenceError)
  expect(screen.queryByText(text.moodError('香草', 0, 5.2))).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: text.retry }))
  await screen.findByText(text.moodError('香草', 0, 5.2))
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('/benchmarks/2026-10-31/cases/A01-S2-yituliu.json'))
  await waitFor(() => expect(screen.queryByText(text.evidenceError)).not.toBeInTheDocument())
  expect(siteBenchmark.verification.commonFixturesConfirmed).toBe(false)
})
