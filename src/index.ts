import type { Server } from 'node:http'
import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const prettyLogs = process.env.NODE_ENV !== 'production'

const { app, tracker, logger } = await buildServer(config, prettyLogs)

let server: Server

const start = async () => {
  try {
    server = app.listen(config.port, config.host, () => {
      logger.info(`Listening on http://${config.host}:${config.port}`)
    })
    server.keepAliveTimeout = 120_000
    server.headersTimeout = 125_000
    server.requestTimeout = 0
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

const shutdown = async () => {
  logger.info('Shutting down...')
  if (tracker) await tracker.stopFlush()
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()
