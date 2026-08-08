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

const ANTHROPIC_STATUS_TYPE: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  429: 'rate_limit_error',
}

export interface AnthropicApiError {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

export function formatAnthropicError(statusCode: number, rawBody: string): AnthropicApiError {
  try {
    const parsed = JSON.parse(rawBody)
    if (parsed?.type === 'error' && parsed?.error && typeof parsed.error.message === 'string') {
      return {
        type: 'error',
        error: {
          type: String(parsed.error.type ?? ANTHROPIC_STATUS_TYPE[statusCode] ?? 'api_error'),
          message: parsed.error.message,
        },
      }
    }
    if (
      parsed?.error &&
      typeof parsed.error === 'object' &&
      typeof parsed.error.message === 'string'
    ) {
      return {
        type: 'error',
        error: {
          type: String(parsed.error.type ?? ANTHROPIC_STATUS_TYPE[statusCode] ?? 'api_error'),
          message: parsed.error.message,
        },
      }
    }
    if (typeof parsed?.error === 'string' || typeof parsed?.message === 'string') {
      return {
        type: 'error',
        error: {
          type: ANTHROPIC_STATUS_TYPE[statusCode] ?? 'api_error',
          message: typeof parsed?.error === 'string' ? parsed.error : parsed.message,
        },
      }
    }
  } catch {
    // invalid JSON — fall through to generic
  }

  return {
    type: 'error',
    error: {
      type: ANTHROPIC_STATUS_TYPE[statusCode] ?? 'api_error',
      message: rawBody
        ? `Upstream error: ${rawBody.slice(0, 500)}`
        : `Upstream returned ${statusCode}`,
    },
  }
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
