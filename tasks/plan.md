# Implementation Plan: Anthropic Compatible Proxy

## Overview

Expose `POST /v1/messages` on the existing Express proxy (`:3001`) so Anthropic-protocol clients (Claude Code, Cline Anthropic mode, etc.) can use the Ollama cloud key pool with all existing benefits: proxy API-key auth, load balancing, retry/key rotation, token-limit enforcement, usage tracking, and streaming. The upstream `ollama.com/v1/messages` (verified live: Anthropic-shaped 401 with `authentication_error` on unauthenticated probe) is passed through byte-faithfully — no message format conversion is written.

## Architecture Decisions

- **Pure passthrough, not conversion** — upstream already implements full Anthropic compat (messages, streaming, tools, vision, thinking; docs list `tool_choice`/`count_tokens`/metadata as upstream-unsupported, so we don't emulate them).
- **Reuse `registerPassthroughRoute` + `pipeStream`** — extend both with optional Anthropic hooks instead of forking new stream logic:
  - `extractUsage` / `extractStreamUsage` (Anthropic nests usage at `message.usage.input_tokens` and `message_delta.usage.output_tokens`, not top-level `usage`)
  - `renderError` (Anthropic error shape `{"type":"error","error":{"type","message"}}` instead of OpenAI's)
  - `errorEventStyle: 'anthropic'` (mid-stream failure emits `event: error` + anthropic body, **no** `[DONE]`)
- **Auth**: `x-api-key` header maps to the same `PROXY_API_KEY*` pool (both `x-api-key` and `Authorization: Bearer` accepted); 401 payloads are Anthropic-shaped on `/v1/messages`, OpenAI-shaped elsewhere.
- **Forwarded headers**: existing forwarder sends `Authorization: Bearer <ollama key>` as-is; `anthropic-version` client header is dropped (docs: accepted but not used). Upstream `x-request-id` forwarded as today.
- **No Task 5 (model alias rewriting)** — out of scope per user decision.

## Task List

### Phase 1: Foundation

- [ ] Task 1: Auth middleware — `x-api-key` + per-route error shape (`src/server.ts`)
- [ ] Task 2: Stream + error normalizer Anthropic hooks (`src/proxy/stream-handler.ts`, `src/proxy/error-normalizer.ts`)

### Checkpoint: Foundation
- [ ] `tsc --noEmit` + `npm run build` clean
- [ ] Existing routes still pass `node test-comprehensive.mjs`
- [ ] Review with human before proceeding

### Phase 2: Anthropic endpoint

- [ ] Task 3: `/v1/messages` route via generic passthrough (`src/routes/passthrough.ts` options, new `src/routes/anthropic-messages.ts`, `src/server.ts` wiring)
- [ ] Task 4: Live test suite (`test-anthropic.mjs`)

### Checkpoint: Core complete
- [ ] All tests green; manual `@anthropic-ai/sdk` smoke test
- [ ] Review with human before proceeding

### Phase 3: Polish

- [ ] Task 5: README Anthropic section, `.env.example`, `examples/claude-code.*`

### Checkpoint: Complete
- [ ] All acceptance criteria met, all tests pass
- [ ] Manual smoke: Anthropic client pointed at proxy (user-side verification)
- [ ] Ready for review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Upstream `/v1/messages` may require `x-api-key` header instead of Bearer | 401 on all forwarded requests | Verify once with live key in Task 3; add header alongside Bearer if needed |
| Upstream stream usage shape could drift | usage tracking gaps | Same failure mode as today's OpenAI path; extractor is tolerant (undefined → skip) |
| Claude Code defaults to `claude-*` model names | upstream 404 | README documents using a real cloud model id (`minimax-m3`, `glm-4.7:cloud`, ...) |
| Anthropic streams end with `message_stop`, not `[DONE]` | client-dependent parsing | Pass-through verbatim; SDKs expect exactly this |

## Open Questions

- None blocking. Implementation order: 1 -> 2 -> checkpoint -> 3 -> 4 -> checkpoint -> 5.