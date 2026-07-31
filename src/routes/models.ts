import type { Express, Request, Response } from 'express'
import type pino from 'pino'
import type { ModelInfo, ModelListResponse } from '../types/openai.js'
import type { Forwarder } from '../proxy/forwarder.js'
import type { LoadBalancer } from '../load-balancer.js'

let cachedModels: ModelInfo[] | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

async function fetchModels(forwarder: Forwarder, key: string): Promise<ModelInfo[]> {
  const result = await forwarder.forwardGetToOllama('/models', key)
  if (result.statusCode >= 400) {
    throw new Error(`Upstream returned ${result.statusCode} for /v1/models`)
  }
  let data = ''
  for await (const chunk of result.body) {
    data += typeof chunk === 'string' ? chunk : chunk.toString()
  }
  const parsed = JSON.parse(data)
  return (parsed.data ?? []).map((m: any) => ({
    id: m.id,
    object: 'model',
    created: m.created ?? Math.floor(Date.now() / 1000),
    owned_by: m.owned_by ?? 'unknown',
  }))
}

export function registerModels(app: Express, forwarder: Forwarder, lb: LoadBalancer, logger: pino.Logger) {
  app.get('/v1/models', async (req: Request, res: Response) => {
    try {
      const now = Date.now()
      if (cachedModels && now - cacheTime < CACHE_TTL) {
        return res.status(200).json({ object: 'list', data: cachedModels })
      }

      const key = lb.getKeyAt(0)
      if (key) {
        try {
          cachedModels = await fetchModels(forwarder, key)
          cacheTime = now
          return res.status(200).json({ object: 'list', data: cachedModels })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          res.locals._errMessage = message
          logger.warn({ err }, `Failed to fetch models from upstream: ${message}`)
          if (cachedModels) {
            return res.status(200).json({ object: 'list', data: cachedModels })
          }
        }
      } else {
        res.locals._errMessage = 'No API keys available'
        logger.warn('No API keys available for model fetch, using cache')
        if (cachedModels) {
          return res.status(200).json({ object: 'list', data: cachedModels })
        }
      }

      return res.status(200).json({ object: 'list', data: [] })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.locals._errMessage = message
      logger.error({ err }, `Models handler error: ${message}`)
      return res.status(500).json({
        error: { message: 'Internal server error', type: 'internal_error', code: '500' },
      })
    }
  })
}
