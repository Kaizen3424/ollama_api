import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RetryHandler } from '../retry-handler.js'
import type { UsageTracker } from '../usage-tracker.js'
import { pipeStream } from '../proxy/stream-handler.js'
import { normalizeUpstreamError } from '../proxy/error-normalizer.js'

export function registerChatCompletions(
  app: FastifyInstance,
  retry: RetryHandler,
  tracker?: UsageTracker,
) {
  app.post('/v1/chat/completions', async (req: FastifyRequest, reply) => {
    const body = req.body as Record<string, unknown>
    const isStreaming = body?.stream === true

    try {
      const result = await retry.forwardWithRetry('/chat/completions', body)
      const ollamaKeyIndex = result.keyIndex

      const proxyKeyIndex = req.proxyKeyIndex ?? 0

      async function trackUsage(prompt: number, completion: number) {
        if (!tracker) return
        tracker.pushOllamaUsage(ollamaKeyIndex, `key-${ollamaKeyIndex + 1}`, prompt, completion)
        tracker.pushProxyUsage(proxyKeyIndex, prompt, completion)
      }

      const upstreamStatus = result.statusCode

      if (!isStreaming) {
        let data = ''
        for await (const chunk of result.body as NodeJS.ReadableStream) {
          data += typeof chunk === 'string' ? chunk : chunk.toString()
        }

        if (upstreamStatus >= 400) {
          return reply.code(upstreamStatus).send(normalizeUpstreamError(upstreamStatus, data))
        }

        try {
          const parsed = JSON.parse(data)
          if (parsed.usage) {
            await trackUsage(parsed.usage.prompt_tokens ?? 0, parsed.usage.completion_tokens ?? 0)
          }
          return reply.code(200).send(parsed)
        } catch {
          return reply.code(502).send(normalizeUpstreamError(502, data))
        }
      }

      if (upstreamStatus >= 400) {
        let data = ''
        for await (const chunk of result.body as NodeJS.ReadableStream) {
          data += typeof chunk === 'string' ? chunk : chunk.toString()
        }
        return reply.code(upstreamStatus).send(normalizeUpstreamError(upstreamStatus, data))
      }

      await pipeStream(result.body as NodeJS.ReadableStream, reply, async (usage) => {
        await trackUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
      })

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const statusCode = (err as any)?.statusCode ?? 502
      const type = statusCode === 429 ? 'rate_limit_error' : 'proxy_error'
      const code = statusCode === 429 ? '429' : 'upstream_unavailable'
      req.log.error({ err, statusCode }, 'Chat completion failed')
      return reply.code(statusCode).send({
        error: { message, type, code },
      })
    }
  })
}
