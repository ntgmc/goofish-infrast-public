import { normalizeConfig } from '../../lib/config'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { licenseConfigSchema } from '../../lib/workspace-validation'
import sample from './sample-result.json'

export const SAMPLE_RESULT = sample.result as unknown as OptimizeResult
export const SAMPLE_OPERATORS: LicenseOperator[] = sample.operators
export const SAMPLE_CONFIG = normalizeConfig(licenseConfigSchema.parse({ ...sample.config, desc: SAMPLE_RESULT.title }))
