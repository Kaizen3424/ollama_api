# Implementation Plan: Agent Compatibility Hardening (opencode + Hermes)

## Overview

The Express proxy already delivers fully OpenAI-compliant chat completions — verified via live probes on 2026-07-31: streaming `delta.tool_calls` in exact AI-SDK format, non-streaming `tool_calls`, `reasoning` content, vision, usage chunk + `data: [DONE]`, and OpenAI-shaped errors. opencode (`@ai-sdk/openai-compatible`) and Hermes (custom endpoint) can already talk to it. This plan hardens the remaining gaps: client-disconnect abort (stops wasted Ollama tokens), server timeouts tuned for long agent sessions, `x-request-id` tracing, new passthrough endpoints (`/v1/completions`, `/v1/embeddings`), a test suite locking in tool-call/reasoning behavior, and agent integration docs + examples.

## Architecture Decisions

- **Passthrough remains the strategy** — upstream Ollama Cloud is AI-SDK compliant; the proxy adds no response rewriting. New endpoints are transparent forwarders.
- **Generic route factory** for the new POST endpoints (reuses retry handler, error normalizer, usage tracking, auth).
- **Abort plumbing**: one `AbortSignal` derived from the Express response (`res.on('close')`) → per-attempt `AbortSignal` in the retry handler → undici `request({ signal })`. Retries stop once the client is gone.
- **No `/v1/responses` translation layer** (deferred — chat completions covers both agents).
- **No fabricated context lengths** in `/v1/models` — Hermes' `context_length` override is documented in the example config instead.

## Task List

### Phase 1: Connection hardening (foundation)

- [ ] Task 1: Client-disconnect abort (forwarder, retry-handler, chat route, stream-handler)
- [ ] Task 2: Server timeouts + x-request-id forwarding

### Phase 2: New endpoints

- [ ] Task 3: Generic passthrough route factory + refactor chat route
- [ ] Task 4: /v1/completions + /v1/embeddings routes

### Checkpoint: Phases 1-2
- [ ] `tsc --noEmit` + `npm run build` clean
- [ ] `node test-comprehensive.mjs` all pass
- [ ] Manual curl checks of both new endpoints pass
- [ ] Review with human before proceeding

### Phase 3: Verification & deliverables

- [ ] Task 5: Extended test suite (tools, reasoning, JSON mode, x-request-id, new endpoints)
- [ ] Task 6: README agent-compat section, .env.example, example configs

### Checkpoint: Complete
- [ ] All acceptance criteria met, all tests pass
- [ ] Manual smoke: opencode/hermes pointed at proxy (user-side verification)
- [ ] Ready for review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Upstream Ollama Cloud changes API shape | Compatibility breaks silently | Tests pin the observed behavior; error normalizer already wraps upstream failures |
| Abort wiring kills valid requests | Broken streaming | Abort only fires on client close before completion; abort-listener cleanup; full regression suite |
| Disabling `requestTimeout` | Slowloris exposure | Body must still arrive before response phase; proxy is LAN/trusted-key use; documented tradeoff |
| `/v1/embeddings` unsupported upstream | Endpoint 404s | Passthrough returns normalized OpenAI-shaped error; docs note upstream support is pending |

## Open Questions

- None blocking. Implementation order: Task 1 -> 2 -> 3 -> 4 -> checkpoint -> 5 -> 6.
