import type { Express } from 'express'
import type { RetryHandler } from '../retry-handler.js'
import type { UsageTracker } from '../usage-tracker.js'
import type { StreamUsage } from '../proxy/stream-handler.js'
import { formatAnthropicError } from '../proxy/error-normalizer.js'
import { registerPassthroughRoute } from './passthrough.js'

function extractMessageUsage(json: unknown): StreamUsage | undefined {
  const usage = (json as any)?.message?.usage
  if (!usage || (usage.input_tokens == null && usage.output_tokens == null)) return undefined
  const prompt = usage.input_tokens ?? 0
  const completion = usage.output_tokens ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

function extractStreamEventUsage(eventJson: unknown): StreamUsage | undefined {
  const event = eventJson as any
  if (event?.type === 'message_start' && event.message?.usage) {
    const prompt = event.message.usage.input_tokens ?? 0
    const completion = event.message.usage.output_tokens ?? 0
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
  }
  if (event?.type === 'message_delta' && event.usage) {
    const completion = event.usage.output_tokens ?? 0
    return { prompt_tokens: 0, completion_tokens: completion, total_tokens: completion }
  }
  return undefined
}

export function registerAnthropicMessages(
  app: Express,
  retry: RetryHandler,
  tracker?: UsageTracker,
) {
  registerPassthroughRoute(app, retry, tracker, {
    path: '/v1/messages',
    upstreamPath: '/messages',
    streamable: true,
    extractUsage: extractMessageUsage,
    extractStreamUsage: extractStreamEventUsage,
    renderError: formatAnthropicError,
    errorEventStyle: 'anthropic',
  })
}