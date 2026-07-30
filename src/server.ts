import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { AppConfig } from './types/config.js'
import { createLoadBalancer } from './load-balancer.js'
import { createForwarder } from './proxy/forwarder.js'
import { createRetryHandler } from './retry-handler.js'
import { connectMongo, createUsageTracker, type UsageTracker } from './usage-tracker.js'
import { registerChatCompletions } from './routes/chat-completions.js'
import { registerModels } from './routes/models.js'
import { registerUsage } from './routes/usage.js'
import type { ApiError } from './types/openai.js'

export async function buildServer(config: AppConfig, prettyLogs = false) {
  const loggerConfig = prettyLogs
    ? {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }
    : { level: process.env.LOG_LEVEL ?? 'info' }

  const app = Fastify({ logger: loggerConfig, bodyLimit: 50 * 1024 * 1024 })

  app.register(cors, { origin: true })

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 50 * 1024 * 1024 },
    (_req, body: string, done) => {
      try {
        done(null, JSON.parse(body))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  if (config.proxyApiKeys.length > 0) {
    app.addHook('onRequest', (req, reply, done) => {
      const url = req.url
      if (url === '/health' || url.startsWith('/v1/models') || url.startsWith('/v1/usage')) {
        return done()
      }
      const auth = req.headers.authorization
      if (!auth || !auth.startsWith('Bearer ')) {
        return reply.code(401).send({
          error: { message: 'Invalid or missing API key', type: 'auth_error', code: '401' },
        })
      }
      const token = auth.slice(7)
      const idx = config.proxyApiKeys.indexOf(token)
      if (idx === -1) {
        return reply.code(401).send({
          error: { message: 'Invalid or missing API key', type: 'auth_error', code: '401' },
        })
      }
      ;(req as any).proxyKeyIndex = idx
      done()
    })
  }

  const lb = createLoadBalancer(config.keys, config.keyCooldownMs)
  const forwarder = createForwarder(config.upstreamBase)

  app.log.info(`Loaded ${config.keys.length} API keys`)

  let tracker: UsageTracker | undefined
  try {
    const db = await connectMongo(config.mongodbUri, config.mongodbDatabase)
    tracker = createUsageTracker(db, config.usageFlushMs)
    app.log.info('Connected to MongoDB')
  } catch (err) {
    app.log.warn({ err }, 'MongoDB unavailable — usage tracking disabled')
  }

  const retry = createRetryHandler(
    lb, forwarder, config.maxRetries,
    tracker?.isKeyOverLimit,
    config.keyTokenLimit5h,
    config.keyTokenLimitWeek,
  )

  app.addHook('onRequest', (req, _reply, done) => {
    req.startTime = Date.now()
    done()
  })

  app.addHook('onResponse', (req, reply, done) => {
    const ms = Date.now() - (req.startTime ?? Date.now())
    const status = reply.statusCode
    const method = req.method.padEnd(6)
    const url = req.url
    const coloredStatus = status >= 400 ? `\x1b[31m${status}\x1b[0m` : `\x1b[32m${status}\x1b[0m`
    const coloredMs = ms >= 1000 ? `\x1b[33m${ms}ms\x1b[0m` : `${ms}ms`
    app.log.info(`${method} ${url} → ${coloredStatus} (${coloredMs})`)
    done()
  })

  registerChatCompletions(app, retry, tracker)
  registerModels(app, forwarder, lb)
  registerUsage(app, tracker)

  app.get('/health', async () => ({ status: 'ok' }))

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const statusCode = err.statusCode ?? 500
    const errorBody: ApiError = {
      error: {
        message: err.message ?? 'Internal server error',
        type: err.name ?? 'internal_error',
        code: String(statusCode),
      },
    }
    return reply.code(statusCode).send(errorBody)
  })

  return { app, lb, retry, tracker }
}

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number
    proxyKeyIndex?: number
  }
}
