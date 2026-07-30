# Ollama API Proxy

A lightweight OpenAI-compatible proxy for Ollama's cloud API with load balancing, rate limiting, token usage tracking, and multi-key authentication.

## Features

- **OpenAI-compatible** — drop-in replacement for `api.openai.com`
- **Load balancing** — round-robins across 48+ Ollama API keys
- **Key cooldown** — failed keys are skipped for 60s
- **Token limits** — per-key 5-hour (2M) and weekly (5M) limits enforced
- **Retry with key rotation** — up to 3 retries on failure, each using a different key
- **Proxy auth** — two proxy API keys for client authentication
- **Usage tracking** — per-proxy-key token usage persisted to MongoDB
- **Dynamic models** — fetches live model list from Ollama API with 5-min cache
- **Streaming** — SSE passthrough with usage data
- **Vision** — image inputs supported

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
| `MAX_KEY_RETRIES` | `3` | Max retries per request |
| `KEY_TOKEN_LIMIT_5H` | `2000000` | Per-key 5-hour token limit |
| `KEY_TOKEN_LIMIT_WEEK` | `5000000` | Per-key weekly token limit |
| `USAGE_FLUSH_MS` | `60000` | MongoDB flush interval |
| `MONGODB_URI` | — | MongoDB connection string |
| `MONGODB_DATABASE` | `ollama_proxy` | MongoDB database name |

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

All endpoints are OpenAI-format compatible.

### `GET /health`

Health check. Public.

### `GET /v1/models`

Lists available models. Fetched live from Ollama API with 5-min cache. Public.

### `POST /v1/chat/completions`

Chat completion. Requires proxy API key in `Authorization: Bearer <key>` header.

Supports:
- `stream: false` — standard response with usage
- `stream: true` — SSE stream with usage in final chunk
- `stream_options: { include_usage: true }` — usage in stream
- Image inputs (vision)

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

## Testing

```bash
node test-comprehensive.mjs
```

Requires the server to be running with the default `.env` keys.

## Architecture

```
Client → Fastify (port 3001) → Auth Hook → Load Balancer → Retry Handler → Forwarder → Ollama API
                                        ↓
                                   Usage Tracker → MongoDB
```

- **Load Balancer**: round-robin with cooldown tracking
- **Retry Handler**: up to 3 attempts, rotates keys, enforces token limits
- **Forwarder**: HTTP client via undici with 120s timeout
- **Usage Tracker**: batched MongoDB writes every 60s
