import { createSklandConnectorServer } from './skland-connector'

const port = Number(process.env.SKLAND_CONNECTOR_PORT ?? 3300)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SKLAND_CONNECTOR_PORT 无效。')
const server = createSklandConnectorServer(process.env.SKLAND_CONNECTOR_TOKEN?.trim() ?? '')
server.listen(port, '127.0.0.1', () => console.info('Skland connector listening on loopback'))
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 30_000).unref()
  })
}
