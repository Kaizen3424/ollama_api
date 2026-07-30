import type { FastifyInstance } from 'fastify'
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

export function registerModels(app: FastifyInstance, forwarder: Forwarder, lb: LoadBalancer) {
  app.get('/v1/models', async (_req, reply) => {
    const now = Date.now()
    if (cachedModels && now - cacheTime < CACHE_TTL) {
      return reply.code(200).send({ object: 'list', data: cachedModels })
    }

    const key = lb.getKeyAt(0)
    if (key) {
      try {
        cachedModels = await fetchModels(forwarder, key)
        cacheTime = now
        return reply.code(200).send({ object: 'list', data: cachedModels })
      } catch (err) {
        _req.log.warn({ err }, 'Failed to fetch models from upstream, using cache')
        if (cachedModels) {
          return reply.code(200).send({ object: 'list', data: cachedModels })
        }
      }
    } else {
      _req.log.warn('No API keys available for model fetch, using cache')
      if (cachedModels) {
        return reply.code(200).send({ object: 'list', data: cachedModels })
      }
    }

    return reply.code(200).send({ object: 'list', data: [] })
  })
}
