import { authCopy } from './zh-CN/auth'
import { adminCopy } from './zh-CN/admin'
import { commonCopy } from './zh-CN/common'
import { dashboardCopy } from './zh-CN/dashboard'
import { domainCopy } from './zh-CN/domain'
import { metadataCopy } from './zh-CN/metadata'
import { optimizeCopy } from './zh-CN/optimize'
import { publicCopy } from './zh-CN/public'
import { toolsCopy } from './zh-CN/tools'
import { workspaceCopy } from './zh-CN/workspace'
import { featuresCopy } from './zh-CN/features'
import { publicContentCopy } from './zh-CN/public-content'
import { personalUseCopy } from './zh-CN/personal-use'
import { inventoryCopy } from './zh-CN/inventory'

export const CURRENT_LOCALE = 'zh-CN' as const

export const copy = {
  admin: adminCopy,
  common: commonCopy,
  public: publicCopy,
  auth: authCopy,
  dashboard: dashboardCopy,
  workspace: workspaceCopy,
  optimize: optimizeCopy,
  tools: toolsCopy,
  metadata: metadataCopy,
  domain: domainCopy,
  features: featuresCopy,
  publicContent: publicContentCopy,
  personalUse: personalUseCopy,
  inventory: inventoryCopy,
} as const
