import type { FastifyReply } from 'fastify'

export interface StreamUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export async function pipeStream(
  upstreamBody: NodeJS.ReadableStream,
  reply: FastifyReply,
  onUsage?: (usage: StreamUsage) => void | Promise<void>,
): Promise<void> {
  const rawRes = reply.raw
  rawRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  for await (const chunk of upstreamBody) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString()

    if (str.startsWith('data: ') || str.startsWith('data:')) {
      rawRes.write(str)
      rawRes.write('\n\n')

      if (onUsage) {
        const jsonStr = str.replace(/^data:\s*/, '')
        try {
          const parsed = JSON.parse(jsonStr)
          if (parsed.usage) {
            await onUsage(parsed.usage)
          }
        } catch { /* not JSON, skip */ }
      }
    } else if (str.trim() === '[DONE]') {
      rawRes.write('data: [DONE]\n\n')
    } else if (str.trim().length > 0) {
      rawRes.write(`data: ${str}\n\n`)
    }
  }

  rawRes.end()
}
