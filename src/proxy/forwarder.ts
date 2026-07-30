import { request } from 'undici'

export interface ForwardResult {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: NodeJS.ReadableStream
}

const REQUEST_TIMEOUT_MS = 120_000

export function createForwarder(upstreamBase: string) {
  function buildUrl(path: string): string {
    return `${upstreamBase}/v1${path}`
  }

  async function forwardToOllama(
    path: string,
    body: unknown,
    apiKey: string,
  ): Promise<ForwardResult> {
    const isStreaming = (body as Record<string, unknown>)?.stream === true

    const res = await request(buildUrl(path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': isStreaming ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS,
    })

    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
    }
  }

  async function forwardGetToOllama(
    path: string,
    apiKey: string,
  ): Promise<ForwardResult> {
    const res = await request(buildUrl(path), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      headersTimeout: 10000,
      bodyTimeout: 10000,
    })

    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
    }
  }

  return { forwardToOllama, forwardGetToOllama }
}

export type Forwarder = ReturnType<typeof createForwarder>
