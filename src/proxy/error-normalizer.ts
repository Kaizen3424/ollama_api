import type { ApiError } from '../types/openai.js'

const STATUS_TEXT: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  429: 'rate_limit_error',
  500: 'internal_server_error',
  502: 'bad_gateway',
  503: 'service_unavailable',
}

export function normalizeUpstreamError(statusCode: number, rawBody: string): ApiError {
  const type = STATUS_TEXT[statusCode] ?? 'upstream_error'
  const code = String(statusCode)

  try {
    const parsed = JSON.parse(rawBody)

    if (typeof parsed?.error === 'string') {
      return {
        error: { message: parsed.error, type, code },
      }
    }

    if (parsed?.error && typeof parsed.error === 'object') {
      const e = parsed.error as Record<string, unknown>
      return {
        error: {
          message: String(e.message ?? e.msg ?? 'Unknown upstream error'),
          type: String(e.type ?? type),
          code: String(e.code ?? code),
        },
      }
    }

    if (parsed?.message) {
      return {
        error: { message: String(parsed.message), type, code },
      }
    }

  } catch {
    // invalid JSON — fall through to generic
  }

  return {
    error: {
      message: rawBody ? `Upstream error: ${rawBody.slice(0, 500)}` : `Upstream returned ${statusCode}`,
      type,
      code,
    },
  }
}
