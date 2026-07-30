import type { LoadBalancer } from './load-balancer.js'
import type { Forwarder, ForwardResult } from './proxy/forwarder.js'

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
  ): Promise<ForwardResultWithKey> {
    let lastError: Error | null = null

    const isAvailable = isKeyOverLimit
      ? async (idx: number) => {
          const over = await isKeyOverLimit(idx, limit5h!, limitWeek!)
          if (over) lb.markKeyFailed(idx)
          return !over
        }
      : undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const picked = await lb.getNextKey(isAvailable)
      if (!picked) {
        if (isKeyOverLimit) throw new KeyLimitError()
        throw new Error('No API keys available')
      }

      try {
        const result = await forwarder.forwardToOllama(path, body, picked.key)

        if (result.statusCode < 500) {
          return { ...result, keyIndex: picked.index }
        }

        lastError = new Error(
          `Ollama returned ${result.statusCode} for key ${maskKey(picked.key)}`,
        )
        lb.markKeyFailed(picked.index)
        const reader = result.body as NodeJS.ReadableStream
        reader.resume()

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        lb.markKeyFailed(picked.index)
      }
    }

    throw new Error(
      `All ${maxAttempts} attempts failed. Last error: ${lastError!.message}`,
    )
  }

  return { forwardWithRetry }
}

export type RetryHandler = ReturnType<typeof createRetryHandler>

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}
