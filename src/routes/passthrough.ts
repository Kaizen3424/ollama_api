import type { Express, Request, Response } from 'express'
import type { RetryHandler } from '../retry-handler.js'
import type { UsageTracker } from '../usage-tracker.js'
import { pipeStream, type StreamUsage } from '../proxy/stream-handler.js'
import { normalizeUpstreamError } from '../proxy/error-normalizer.js'

export interface PassthroughRouteOptions {
  path: string
  upstreamPath?: string
  streamable?: boolean
  extractUsage?: (json: unknown) => StreamUsage | undefined
  extractStreamUsage?: (eventJson: unknown) => StreamUsage | undefined
  renderError?: (statusCode: number, rawBody: string) => unknown
  errorEventStyle?: 'openai' | 'anthropic'
}

export function registerPassthroughRoute(
  app: Express,
  retry: RetryHandler,
  tracker: UsageTracker | undefined,
  options: PassthroughRouteOptions,
) {
  const {
    path,
    streamable = false,
    extractUsage,
    extractStreamUsage,
    renderError,
    errorEventStyle = 'openai',
  } = options
  const upstreamPath = options.upstreamPath ?? path

  app.post(path, async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>
    const isStreaming = streamable && body?.stream === true

    const controller = new AbortController()
    const onClientClose = () => {
      if (!res.writableEnded) {
        controller.abort()
      }
    }
    res.on('close', onClientClose)

    try {
      const result = await retry.forwardWithRetry(upstreamPath, body, controller.signal)
      const ollamaKeyIndex = result.keyIndex
      const proxyKeyIndex = (req as any).proxyKeyIndex ?? 0

      async function trackUsage(prompt: number, completion: number) {
        if (!tracker) return
        tracker.pushOllamaUsage(ollamaKeyIndex, `key-${ollamaKeyIndex + 1}`, prompt, completion)
        tracker.pushProxyUsage(proxyKeyIndex, prompt, completion)
      }

      const upstreamStatus = result.statusCode
      if (result.requestId) {
        res.setHeader('x-request-id', result.requestId)
      }

      if (!isStreaming) {
        let data = ''
        for await (const chunk of result.body as NodeJS.ReadableStream) {
          data += typeof chunk === 'string' ? chunk : chunk.toString()
        }

        if (upstreamStatus >= 400) {
          return res
            .status(upstreamStatus)
            .json(renderError ? renderError(upstreamStatus, data) : normalizeUpstreamError(upstreamStatus, data))
        }

        try {
          const parsed = JSON.parse(data)
          const usage = extractUsage ? extractUsage(parsed) : parsed.usage
          if (usage) {
            await trackUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
          }
          return res.status(200).json(parsed)
        } catch {
          return res.status(502).json(
            renderError ? renderError(502, data) : normalizeUpstreamError(502, data),
          )
        }
      }

      if (upstreamStatus >= 400) {
        let data = ''
        for await (const chunk of result.body as NodeJS.ReadableStream) {
          data += typeof chunk === 'string' ? chunk : chunk.toString()
        }
        return res
          .status(upstreamStatus)
          .json(renderError ? renderError(upstreamStatus, data) : normalizeUpstreamError(upstreamStatus, data))
      }

      await pipeStream(result.body as NodeJS.ReadableStream, res, {
        signal: controller.signal,
        usageExtractor: extractStreamUsage,
        errorEventStyle,
        onUsage: async (usage) => {
          await trackUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
        },
      })

    } catch (err) {
      if (res.destroyed || res.writableEnded) return
      const message = err instanceof Error ? err.message : String(err)
      const statusCode = (err as any)?.statusCode ?? 502
      const type = statusCode === 429 ? 'rate_limit_error' : 'proxy_error'
      const code = statusCode === 429 ? '429' : 'upstream_unavailable'
      res.locals._errMessage = message
      if (renderError) {
        const body = renderError(
          statusCode,
          JSON.stringify({ error: { message, type: statusCode === 429 ? 'rate_limit_error' : 'api_error' } }),
        )
        return res.status(statusCode).json(body)
      }
      return res.status(statusCode).json({
        error: { message, type, code },
      })
    } finally {
      res.off('close', onClientClose)
    }
  })
}
