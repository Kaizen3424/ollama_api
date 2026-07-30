import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const prettyLogs = process.env.NODE_ENV !== 'production'

const { app, tracker } = await buildServer(config, prettyLogs)

const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`Listening on http://${config.host}:${config.port}`)
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

const shutdown = async () => {
  app.log.info('Shutting down...')
  if (tracker) await tracker.stopFlush()
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()
