import { createApiServer } from './http-server'
import { startAccountDeletionWorker } from './account-data-lifecycle'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '127.0.0.1'

const server = createApiServer()
startAccountDeletionWorker()

server.listen(port, host, () => {
  console.log(`goofish-infrast-v1 API listening on http://${host}:${port}`)
})
