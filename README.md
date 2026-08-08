# Ollama API Proxy

A lightweight OpenAI- and Anthropic-compatible proxy for Ollama's cloud API with load balancing, rate limiting, token usage tracking, and multi-key authentication. Fully compatible with agentic clients such as [opencode](https://opencode.ai), [Hermes Agent](https://hermes-agent.nousresearch.com), and [Claude Code](https://code.claude.com).

## Features

- **OpenAI-compatible** — drop-in replacement for `api.openai.com` (chat completions, completions, embeddings passthrough)
- **Anthropic-compatible** — `POST /v1/messages` drop-in for the Anthropic Messages API (streaming, tools, vision, thinking passthrough)
- **Agent-ready streaming** — byte-faithful SSE passthrough: strict line buffering guarantees complete events (never truncated mid-JSON, regardless of upstream chunk boundaries), with OpenAI error events on mid-stream failures
- **Tool calling** — streamed `delta.tool_calls` and non-streaming `tool_calls` pass through unchanged
- **Load balancing** — round-robins across 48+ Ollama API keys
- **Key cooldown** — failed keys are skipped for 60s (7 days on weekly-limit hits)
- **Token limits** — per-key 5-hour (2M) and weekly (5M) limits enforced
- **Retry with key rotation** — configurable retries, each using a different key
- **Proxy auth** — proxy API keys for client authentication
- **Usage tracking** — per-proxy-key token usage persisted to MongoDB
- **Dynamic models** — fetches live model list from Ollama API with 5-min cache
- **Client-disconnect abort** — upstream generation is aborted when a client cancels (no wasted tokens)
- **Vision** — image inputs supported
- **Tracing** — upstream `x-request-id` forwarded to clients

## Prerequisites

- Node.js v24.12.0+
- MongoDB Atlas (or local MongoDB) instance
- Ollama cloud API keys

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Kaizen3424/ollama_api.git
cd ollama_api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `UPSTREAM_BASE` | `https://ollama.com` | Ollama API base URL |
| `PROXY_API_KEY1` | — | Client API key #1 (generate with `node -e "console.log('sk-'+require('crypto').randomBytes(24).toString('hex'))"`) |
| `PROXY_API_KEY2` | — | Client API key #2 |
| `KEY_COOLDOWN_MS` | `60000` | Cooldown period for failed keys |
| `MAX_KEY_RETRIES` | `3` | Max keys tried per request (raise if your pool has keys near limits) |
| `KEY_TOKEN_LIMIT_5H` | `2000000` | Per-key 5-hour token limit |
| `KEY_TOKEN_LIMIT_WEEK` | `5000000` | Per-key weekly token limit |
| `USAGE_FLUSH_MS` | `60000` | MongoDB flush interval |
| `MONGODB_URI` | — | MongoDB connection string |
| `MONGODB_DATABASE` | `ollama_proxy` | MongoDB database name |

> Note: keys that hit Ollama's weekly usage limit are cooled down for 7 days. If your key pool is shared and frequently exhausted, increase `MAX_KEY_RETRIES` (the bundled `.env` uses `10`).

### 3. Add Ollama API keys

Place your keys in `ollama_keys.txt`, one per line (line-numbered format supported):

```
1: ollama-key-1...
2: ollama-key-2...
```

## Run

```bash
npm run build   # Compile TypeScript
npm run start   # Start server
npm run dev     # Build + start in one step
```

## API

All endpoints are OpenAI-format compatible, plus the Anthropic `/v1/messages` endpoint.

### `GET /`

Server status. Public. Shows service name/version, uptime, upstream, key pool sizes, usage-tracking state, and the endpoint list.

### `GET /health`

Health check. Public. Returns `{ "status": "ok" }`.

### `GET /v1/models`

Lists available models. Fetched live from Ollama API with 5-min cache. Public.

### `POST /v1/chat/completions`

Chat completion. Requires proxy API key in `Authorization: Bearer <key>` header.

Supports:
- `stream: false` — standard response with usage
- `stream: true` — SSE stream with usage in final chunk
- `stream_options: { include_usage: true }` — usage in stream
- Tool calling (`tools`, `tool_choice`, `parallel_tool_calls`) — streamed and non-streamed
- Reasoning/thinking content (`reasoning` / `reasoning_content`)
- `response_format` (JSON mode / JSON schema)
- Image inputs (vision)

### `POST /v1/completions`

Text completion passthrough (same auth as chat completions). Note: current Ollama cloud models return `400 invalid_request_error` for this endpoint — the error is forwarded as-is.

### `POST /v1/messages`

Anthropic Messages API passthrough. Drop-in for `api.anthropic.com/v1/messages` — body and streaming events (`message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`) pass through byte-faithfully with no conversion. Requires a proxy API key via `x-api-key: <key>` (Anthropic clients) or `Authorization: Bearer <key>`.

Supports (upstream): streaming, system prompts, multi-turn, tool calling with `tool_use`/`tool_result` blocks, base64 vision images, extended thinking.

Not supported (upstream limitations, forwarded as errors): `count_tokens`, `tool_choice`, `metadata`, prompt caching, PDF documents, batches, citations.

Usage (input/output tokens) is extracted from `message.usage` / `message_delta.usage` and tracked like OpenAI usage. Upstream errors are returned in Anthropic shape (`{"type":"error","error":{...}}`); auth failures return `authentication_error` with HTTP 401.

Client setup (e.g. Claude Code):

```bash
export ANTHROPIC_BASE_URL=http://localhost:3001
export ANTHROPIC_AUTH_TOKEN=<proxy-key>    # required but treated as the x-api-key
claude --model minimax-m3                  # use a real Ollama cloud model id
```

See `examples/claude-code.md` for details, including model naming and upstream limitations.

### `POST /v1/embeddings`

Embeddings passthrough (same auth). Note: currently not implemented upstream (`404`), returned in OpenAI error shape.

### `GET /v1/usage`

Proxy key usage breakdown. Public.

Response:
```json
{
  "object": "list",
  "total": { "total_prompt_tokens": 0, "total_completion_tokens": 0, "total_tokens": 0 },
  "proxy_keys": [
    { "key": "proxy-0", "label": "proxy-key-1", "total_prompt_tokens": 0, ... }
  ]
}
```

## Agent compatibility

The proxy is verified to work with agentic clients that speak the OpenAI or Anthropic API:

### Claude Code (Anthropic)

Point Claude Code at the proxy with `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` and an explicit model id — see `examples/claude-code.md`. Verified: non-streaming, SSE streaming, tool calling, multi-turn with tool results, vision, auth via `x-api-key`.

### opencode

Point opencode at the proxy as a custom OpenAI-compatible provider. See `examples/opencode.example.json` for a complete config:

```json
{
  "provider": {
    "ollama-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama Proxy",
      "options": { "baseURL": "http://localhost:3001/v1", "apiKey": "{env:OLLAMA_PROXY_API_KEY}" },
      "models": { "minimax-m3": { "name": "MiniMax M3 (via proxy)", "limit": { "context": 128000, "output": 65536 } } }
    }
  }
}
```

1. Run `/connect`, pick **Other**, enter the provider ID (`ollama-proxy`) and paste a proxy API key.
2. Copy the provider block above into your `opencode.json`, listing the models you want (ids must match `GET /v1/models`).
3. Set `"model": "ollama-proxy/<model>"` and optionally `"small_model"`.

### Hermes Agent

Point Hermes at the proxy as a **Custom endpoint** (`hermes model` -> "Custom endpoint") or via `config.yaml` — see `examples/hermes-config.yaml`.

Important: Hermes requires **at least 64,000 tokens of context** for agent use with tools, but Ollama cloud does not report context length through `/v1/models`. Set `context_length: 128000` explicitly in Hermes' config (see example) so it doesn't reject or misbehave.

### Verified behavior matrix

| Capability | Status |
|---|---|
| `POST /v1/chat/completions` (non-streaming) | Verified |
| `POST /v1/chat/completions` (SSE streaming) | Verified — strict line-buffered passthrough: complete `data:` events only, usage chunk, `[DONE]`; OpenAI error event + `[DONE]` if upstream dies mid-stream |
| Tool calls (non-streaming) | Verified — `tool_calls` + `finish_reason: "tool_calls"` |
| Tool calls (streaming) | Verified — AI-SDK `delta.tool_calls` format |
| Reasoning content | Verified — `reasoning` field passes through |
| Vision (`image_url`) | Verified |
| JSON mode (`response_format`) | Verified |
| `GET /v1/models` | Verified — OpenAI shape, cached 5 min, public |
| Auth (Bearer) | Verified — OpenAI error shape on 401 |
| `x-request-id` | Forwarded from upstream to client |
| Client disconnect | Upstream request aborted (logged) |
| `/v1/completions` | Passthrough (upstream rejects chat models with 400) |
| `/v1/embeddings` | Passthrough (not implemented upstream yet, 404) |
| `/v1/messages` (Anthropic, non-streaming) | Verified — `msg_*` id, content blocks, `stop_reason`, usage |
| `/v1/messages` (SSE streaming) | Verified — full event sequence, usage in `message_start`/`message_delta`, no `[DONE]` |
| `/v1/messages` tool calling | Verified — `tool_use` blocks + `tool_result` round-trip |
| `/v1/messages` vision | Verified — base64 `image` blocks |
| `/v1/messages` auth (`x-api-key`) | Verified — Anthropic-shaped 401, same key pool as Bearer |

## Testing

```bash
node test-comprehensive.mjs   # OpenAI-format suite
node test-anthropic.mjs       # Anthropic /v1/messages suite
```

Requires the server to be running with the default `.env` keys. Note: the suite makes live calls against Ollama cloud — if your key pool is currently exhausting its weekly usage limits, some checks may transiently fail with 429.

## Architecture

```
Client → Express (port 3001) → Auth Middleware → Load Balancer → Retry Handler → Forwarder → Ollama API
                                        ↓
                                   Usage Tracker → MongoDB
```

- **Load Balancer**: round-robin with cooldown tracking
- **Retry Handler**: rotates keys, enforces token limits, stops retrying when the client disconnects
- **Forwarder**: HTTP client via undici; no body timeout on streaming (long reasoning gaps never kill the stream), aborts upstream on client disconnect
- **Usage Tracker**: batched MongoDB writes every 60s
