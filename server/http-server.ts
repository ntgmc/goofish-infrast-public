import { createServer, type Server } from 'node:http'
import { nodeRequestToWebRequest, writeWebResponse } from './http-adapter'
import { RequestBodyTooLargeError } from './request-body-limits'
import { routeRequest } from './routes'

export function createApiServer(): Server {
  return createServer(async (req, res) => {
    try {
      const request = await nodeRequestToWebRequest(req)
      const response = await routeRequest(request)
      await writeWebResponse(res, response)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.shouldKeepAlive = false
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
        await writeWebResponse(
          res,
          new Response(JSON.stringify({ error: 'Request body too large' }), {
            status: 413,
            statusText: 'Payload Too Large',
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }),
        )
        return
      }

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
}
