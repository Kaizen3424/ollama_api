# Ollama API Proxy

A lightweight OpenAI- and Anthropic-compatible proxy for Ollama's cloud API with load balancing, rate limiting, token usage tracking, and multi-key authentication.

## Stack

- **Runtime:** Node.js 24 + TypeScript
- **Framework:** Express v4
- **Database:** MongoDB (usage tracking)
- **HTTP client:** undici

## How to Run

The workflow `Start application` runs `npm run dev` (compiles TypeScript then starts the server).

The server listens on the port set by the `PORT` secret (default: 3001).

## Environment Secrets

All secrets are configured in Replit's Secrets manager:

| Secret | Description |
|--------|-------------|
| `PORT` | Server port (default 3001) |
| `HOST` | Bind address (default 0.0.0.0) |
| `UPSTREAM_BASE` | Ollama API base URL |
| `PROXY_API_KEY1` | Client auth key #1 (Bearer or `x-api-key`) |
| `PROXY_API_KEY2` | Client auth key #2 |
| `KEY_COOLDOWN_MS` | Cooldown for failed keys (ms) |
| `MAX_KEY_RETRIES` | Max retries per request |
| `KEY_TOKEN_LIMIT_5H` | Per-key 5-hour token limit |
| `KEY_TOKEN_LIMIT_WEEK` | Per-key weekly token limit |
| `USAGE_FLUSH_MS` | MongoDB flush interval (ms) |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DATABASE` | MongoDB database name |

## Ollama API Keys

Place keys in `ollama_keys.txt` at the project root, one per line. Supports numbered format:
```
1: ollama-key-1...
2: ollama-key-2...
```

## API Endpoints

- `GET /` — server status (public)
- `GET /health` — health check (public)
- `GET /v1/models` — list models from Ollama (public)
- `POST /v1/chat/completions` — OpenAI chat completion, requires proxy API key (Bearer or `x-api-key`)
- `POST /v1/completions` — OpenAI text completion passthrough (same auth)
- `POST /v1/embeddings` — OpenAI embeddings passthrough (same auth)
- `POST /v1/messages` — Anthropic Messages API passthrough (`x-api-key` or Bearer auth; streaming, tools, vision supported)
- `GET /v1/usage` — token usage breakdown (public)

## Deployment

Configured for **autoscale** deployment:
- Build: `npm run build`
- Run: `node dist/index.js`

## User Preferences

- Secrets managed via Replit Secrets (not `.env` files)
- `ollama_keys.txt` holds Ollama API keys (gitignored)
