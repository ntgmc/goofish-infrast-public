import { authCopy } from './zh-CN/auth'
import { commonCopy } from './zh-CN/common'
import { dashboardCopy } from './zh-CN/dashboard'
import { domainCopy } from './zh-CN/domain'
import { metadataCopy } from './zh-CN/metadata'
import { optimizeCopy } from './zh-CN/optimize'
import { publicCopy } from './zh-CN/public'
import { toolsCopy } from './zh-CN/tools'
import { workspaceCopy } from './zh-CN/workspace'

export const CURRENT_LOCALE = 'zh-CN' as const

export const copy = {
  common: commonCopy,
  public: publicCopy,
  auth: authCopy,
  dashboard: dashboardCopy,
  workspace: workspaceCopy,
  optimize: optimizeCopy,
  tools: toolsCopy,
  metadata: metadataCopy,
  domain: domainCopy,
} as const
