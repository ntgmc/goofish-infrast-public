import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

const completedTourKeys = [
  'dashboard-overview',
  'dashboard-redeem',
  'workspace-setup',
  'optimize-overview',
  'optimize-tab-overview',
  'optimize-tab-plans',
  'optimize-tab-config',
  'optimize-tab-result',
  'optimize-tab-lab',
].map((id) => `maatool:guided-tour:${id}:v1`)

beforeEach(() => {
  if (typeof window === 'undefined') return
  for (const key of completedTourKeys) window.localStorage.setItem(key, 'done')
})
