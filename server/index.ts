import { createServer } from 'node:http'
import { nodeRequestToWebRequest, writeWebResponse } from './http-adapter'
import { routeRequest } from './routes'

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '127.0.0.1'

const server = createServer(async (req, res) => {
  try {
    const request = await nodeRequestToWebRequest(req)
    const response = await routeRequest(request)
    await writeWebResponse(res, response)
  } catch (error) {
    console.error('server request error:', error)
    await writeWebResponse(
      res,
      new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }),
    )
  }
})

server.listen(port, host, () => {
  console.log(`goofish-infrast-v1 API listening on http://${host}:${port}`)
})
