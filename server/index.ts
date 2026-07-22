import { runApiProcess } from './api-process'
import { apiOnlyProcessHooks } from './api-process-hooks'
import { canServeApi, resolveAppRole } from './process-role'

if (process.env.NODE_ENV !== 'production' && !process.env.APP_ROLE?.trim()) {
  process.env.APP_ROLE = 'api'
}

const appRole = resolveAppRole()
if (!canServeApi(appRole)) throw new Error(`APP_ROLE=${appRole} cannot start the API entry point`)
if (process.env.NODE_ENV === 'production' && appRole !== 'api') {
  throw new Error('The production API requires APP_ROLE=api')
}

runApiProcess(apiOnlyProcessHooks)
