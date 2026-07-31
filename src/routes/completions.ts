import type { Express } from 'express'
import type { RetryHandler } from '../retry-handler.js'
import type { UsageTracker } from '../usage-tracker.js'
import { registerPassthroughRoute } from './passthrough.js'

export function registerCompletions(
  app: Express,
  retry: RetryHandler,
  tracker?: UsageTracker,
) {
  registerPassthroughRoute(app, retry, tracker, {
    path: '/v1/completions',
    upstreamPath: '/completions',
    streamable: true,
  })
}
