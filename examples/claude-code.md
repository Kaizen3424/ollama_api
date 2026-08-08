# Claude Code via the Ollama API Proxy

Point [Claude Code](https://code.claude.com) at the proxy so it uses Ollama cloud models through the Anthropic-compatible endpoint (`/v1/messages`) with the proxy's key pool, load balancing, and usage tracking.

## Setup

Set these environment variables before launching Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3001   # proxy, not ollama.com
export ANTHROPIC_AUTH_TOKEN=<your PROXY_API_KEY1>  # required but only used as the x-api-key
export ANTHROPIC_MODEL=minimax-m3                  # must be a real Ollama cloud model id
```

Then run:

```bash
claude
```

Or as a one-liner:

```bash
ANTHROPIC_AUTH_TOKEN=<proxy-key> ANTHROPIC_BASE_URL=http://localhost:3001 claude --model minimax-m3
```

## Model naming

Claude Code defaults to `claude-*` model ids, which the proxy passes through verbatim and Ollama cloud does not recognize. Always pass a real Ollama cloud model id via `--model` (or the settings file below) — e.g. `minimax-m3`, `glm-4.7:cloud`, `qwen3-coder`. List available ids with `GET /v1/models`.

## Persistent configuration (optional)

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3001",
    "ANTHROPIC_AUTH_TOKEN": "sk-your-proxy-key",
    "ANTHROPIC_MODEL": "minimax-m3"
  }
}
```

## Known upstream limitations

Ollama's Anthropic compatibility does **not** implement these (the proxy does not emulate them):

- `POST /v1/messages/count_tokens` (token counting)
- `tool_choice` (forcing a specific tool)
- `metadata`, prompt caching, citations, PDF `document` blocks, `batches` API
- URL-based images (base64 images work)

Claude Code falls back gracefully on all of the above. Streaming, tools, vision, and extended thinking are supported.
