import express from 'express'
import cors from 'cors'
import pino from 'pino'
import { createRequire } from 'node:module'
import type { AppConfig } from './types/config.js'
import { createLoadBalancer } from './load-balancer.js'
import { createForwarder } from './proxy/forwarder.js'
import { createRetryHandler } from './retry-handler.js'
import { connectMongo, createUsageTracker, type UsageTracker } from './usage-tracker.js'
import { registerChatCompletions } from './routes/chat-completions.js'
import { registerCompletions } from './routes/completions.js'
import { registerEmbeddings } from './routes/embeddings.js'
import { registerModels } from './routes/models.js'
import { registerUsage } from './routes/usage.js'
import { registerAnthropicMessages } from './routes/anthropic-messages.js'
import type { ApiError } from './types/openai.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name: string; version: string }

const ENDPOINTS = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/v1/models' },
  { method: 'POST', path: '/v1/chat/completions' },
  { method: 'POST', path: '/v1/completions' },
  { method: 'POST', path: '/v1/embeddings' },
  { method: 'POST', path: '/v1/messages' },
  { method: 'GET', path: '/v1/usage' },
]

function requestLogger(logger: pino.Logger) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = process.hrtime.bigint()
    let logged = false

    const log = (aborted: boolean) => {
      if (logged) return
      logged = true

      const elapsedNs = process.hrtime.bigint() - start
      const durationSec = Number(elapsedNs) / 1e9
      const status = res.statusCode || 0
      const path = req.path || req.url
      const reason = (res.locals as { _errMessage?: string })?._errMessage
      const suffix = aborted ? ' (client aborted)' : ''
      const tail = reason ? ` — ${reason}` : ''

      const line = `${req.method} ${path} -> ${status} in ${durationSec.toFixed(2)}s${tail}${suffix}`

      if (status >= 500) logger.error(line)
      else if (status >= 400) logger.warn(line)
      else logger.info(line)
    }

    res.on('finish', () => log(false))
    res.on('close', () => log(true))

    next()
  }
}

export async function buildServer(config: AppConfig, prettyLogs = false) {
  const loggerConfig = prettyLogs
    ? {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }
    : { level: process.env.LOG_LEVEL ?? 'info' }

  const logger = pino(loggerConfig)
  const app = express()

  app.use(express.json({ limit: '50mb' }))
  app.use(cors({ origin: true }))

  app.use(requestLogger(logger))

  if (config.proxyApiKeys.length > 0) {
    app.use((req, res, next) => {
      const url = req.url
      if (url === '/' || url === '/health' || url.startsWith('/v1/models') || url.startsWith('/v1/usage')) {
        return next()
      }
      const anthropic = url.startsWith('/v1/messages')
      const auth = req.headers.authorization
      const xKey = req.headers['x-api-key']
      const token = auth?.startsWith('Bearer ')
        ? auth.slice(7)
        : Array.isArray(xKey)
          ? xKey[0]
          : xKey
      if (!token) {
        res.locals._errMessage = 'Invalid or missing API key'
        return res.status(401).json(
          anthropic
            ? {
                type: 'error',
                error: { type: 'authentication_error', message: 'Invalid or missing API key' },
              }
            : {
                error: { message: 'Invalid or missing API key', type: 'auth_error', code: '401' },
              },
        )
      }
      const idx = config.proxyApiKeys.indexOf(token)
      if (idx === -1) {
        res.locals._errMessage = 'Invalid or missing API key'
        return res.status(401).json(
          anthropic
            ? {
                type: 'error',
                error: { type: 'authentication_error', message: 'Invalid or missing API key' },
              }
            : {
                error: { message: 'Invalid or missing API key', type: 'auth_error', code: '401' },
              },
        )
      }
      ;(req as any).proxyKeyIndex = idx
      next()
    })
  }

  const lb = createLoadBalancer(config.keys, config.keyCooldownMs)
  const forwarder = createForwarder(config.upstreamBase)

  logger.info(`Loaded ${config.keys.length} API keys`)

  let tracker: UsageTracker | undefined
  try {
    const db = await connectMongo(config.mongodbUri, config.mongodbDatabase)
    tracker = createUsageTracker(db, config.usageFlushMs)
    logger.info('Connected to MongoDB')
  } catch (err) {
    logger.warn({ err }, 'MongoDB unavailable — usage tracking disabled')
  }

  const retry = createRetryHandler(
    lb, forwarder, config.maxRetries,
    tracker?.isKeyOverLimit,
    config.keyTokenLimit5h,
    config.keyTokenLimitWeek,
  )

  registerChatCompletions(app, retry, tracker)
  registerCompletions(app, retry, tracker)
  registerEmbeddings(app, retry, tracker)
  registerModels(app, forwarder, lb, logger)
  registerUsage(app, tracker)
  registerAnthropicMessages(app, retry, tracker)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: pkg.name,
      version: pkg.version,
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      upstream: config.upstreamBase,
      auth: {
        proxy_keys: config.proxyApiKeys.length,
      },
      keys: {
        ollama_keys: lb.getKeyCount(),
      },
      usage_tracking: !!tracker,
      endpoints: ENDPOINTS,
    })
  })

  app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = err.statusCode ?? 500
    res.locals._errMessage = err.message ?? 'Internal server error'
    const errorBody: ApiError = {
      error: {
        message: err.message ?? 'Internal server error',
        type: err.name ?? 'internal_error',
        code: String(statusCode),
      },
    }
    res.status(statusCode).json(errorBody)
  })

  return { app, lb, retry, tracker, logger }
}
