import type { ServerResponse } from 'node:http'

export interface StreamUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface SseLineSplitter {
  push(chunk: string): string[]
  flush(): string | undefined
}

export function createSseLineSplitter(): SseLineSplitter {
  let buffer = ''
  return {
    push(chunk: string): string[] {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    },
    flush(): string | undefined {
      const leftover = buffer
      buffer = ''
      return leftover === '' ? undefined : leftover
    },
  }
}

export interface PipeStreamOptions {
  signal?: AbortSignal
  onUsage?: (usage: StreamUsage) => void | Promise<void>
  usageExtractor?: (eventJson: unknown) => StreamUsage | undefined
  errorEventStyle?: 'openai' | 'anthropic'
}

export async function pipeStream(
  upstreamBody: NodeJS.ReadableStream,
  res: ServerResponse,
  options: PipeStreamOptions = {},
): Promise<void> {
  const { signal, onUsage, usageExtractor, errorEventStyle = 'openai' } = options

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const splitter = createSseLineSplitter()

  const emitLine = (line: string): boolean => {
    if (res.destroyed || res.writableEnded) return false
    res.write(line)
    res.write('\n')
    return true
  }

  const emitErrorEvent = (message: string) => {
    if (errorEventStyle === 'anthropic') {
      const payload = JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message },
      })
      res.write('event: error\n')
      res.write(`data: ${payload}\n\n`)
      return
    }
    const payload = JSON.stringify({
      error: { message, type: 'proxy_error', code: '502' },
    })
    res.write(`data: ${payload}\n\n`)
    res.write('data: [DONE]\n\n')
  }

  try {
    for await (const chunk of upstreamBody) {
      if (res.destroyed || res.writableEnded || signal?.aborted) break
      const str = typeof chunk === 'string' ? chunk : chunk.toString()

      for (const line of splitter.push(str)) {
        if (!emitLine(line)) break

        if (onUsage && line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim()
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const parsed = JSON.parse(jsonStr)
              const usage = usageExtractor ? usageExtractor(parsed) : parsed?.usage
              if (usage) {
                await onUsage(usage)
              }
            } catch { /* not JSON — skip */ }
          }
        }
      }
    }
  } catch (err) {
    // upstream stream aborted (client disconnect or upstream failure mid-stream)
    const message = err instanceof Error ? err.message : String(err)
    const clientGone = res.destroyed || res.writableEnded || signal?.aborted
    if (!clientGone) {
      emitErrorEvent(message)
    }
  } finally {
    splitter.flush()
    if (!res.destroyed && !res.writableEnded) {
      res.end()
    }
  }
}
