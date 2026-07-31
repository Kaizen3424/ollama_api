import type { LoadBalancer } from './load-balancer.js'
import type { Forwarder, ForwardResult } from './proxy/forwarder.js'

const WEEK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export interface ForwardResultWithKey extends ForwardResult {
  keyIndex: number
}

export class KeyLimitError extends Error {
  statusCode = 429
  constructor() {
    super('All API keys have exceeded their token limits')
    this.name = 'KeyLimitError'
  }
}

function isWeeklyLimitError(body: string): boolean {
  try {
    const parsed = JSON.parse(body)
    const msg = typeof parsed?.error === 'string' ? parsed.error : ''
    return msg.includes('weekly usage limit')
  } catch {
    return false
  }
}

async function readBodyStream(stream: NodeJS.ReadableStream): Promise<string> {
  let data = ''
  for await (const chunk of stream) {
    data += typeof chunk === 'string' ? chunk : chunk.toString()
  }
  return data
}

export function createRetryHandler(
  lb: LoadBalancer,
  forwarder: Forwarder,
  maxAttempts: number,
  isKeyOverLimit?: (keyIndex: number, limit5h: number, limitWeek: number) => Promise<boolean>,
  limit5h?: number,
  limitWeek?: number,
) {
  async function forwardWithRetry(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<ForwardResultWithKey> {
    let lastError: Error | null = null
    let lastStatusCode = 502

    const isAvailable = isKeyOverLimit
      ? async (idx: number) => {
          const over = await isKeyOverLimit(idx, limit5h!, limitWeek!)
          if (over) lb.markKeyFailed(idx)
          return !over
        }
      : undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) throw createAbortError()

      const picked = await lb.getNextKey(isAvailable)
      if (!picked) {
        if (isKeyOverLimit) throw new KeyLimitError()
        throw new Error('No API keys available')
      }

      try {
        const result = await forwarder.forwardToOllama(path, body, picked.key, signal)

        const sc = result.statusCode

        if (sc < 400) {
          return { ...result, keyIndex: picked.index }
        }

        if (sc === 429) {
          const errorBody = await readBodyStream(result.body)
          const cooldown = isWeeklyLimitError(errorBody) ? WEEK_COOLDOWN_MS : undefined
          lb.markKeyFailed(picked.index, cooldown)
          lastStatusCode = sc
          lastError = new Error(
            isWeeklyLimitError(errorBody)
              ? 'Key hit weekly usage limit'
              : `Ollama returned 429 for key ${maskKey(picked.key)}`,
          )
          continue
        }

        if (sc >= 500) {
          lastError = new Error(
            `Ollama returned ${sc} for key ${maskKey(picked.key)}`,
          )
          lastStatusCode = sc
          lb.markKeyFailed(picked.index)
          const reader = result.body as NodeJS.ReadableStream
          reader.resume()
          continue
        }

        return { ...result, keyIndex: picked.index }

      } catch (err) {
        if (signal?.aborted) {
          throw createAbortError()
        }
        lastError = err instanceof Error ? err : new Error(String(err))
        lb.markKeyFailed(picked.index)
      }
    }

    const err = lastError ?? new Error('All retry attempts failed')
    ;(err as any).statusCode = lastStatusCode
    throw err
  }

  return { forwardWithRetry }
}

export type RetryHandler = ReturnType<typeof createRetryHandler>

function createAbortError(): Error {
  const err = new Error('Request aborted by client')
  err.name = 'AbortError'
  ;(err as any).statusCode = 499
  return err
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}
