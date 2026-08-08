# Task List: Anthropic Compatible Proxy

## Phase 1: Foundation — DONE

- [x] **Task 1: Auth middleware — `x-api-key` + per-route error shape** (`src/server.ts`)
  - `x-api-key` accepted alongside `Authorization: Bearer`; 401s on `/v1/messages` are Anthropic-shaped (`type:error`/`authentication_error`), OpenAI routes unchanged
- [x] **Task 2: Stream + error normalizer Anthropic hooks**
  - `pipeStream` gained `usageExtractor` + `errorEventStyle: 'anthropic'` (mid-stream error emits `event: error`, no `[DONE]`); `formatAnthropicError` in error-normalizer

## Checkpoint: Foundation — DONE
- [x] tsc + build clean
- [x] Existing `test-comprehensive.mjs` green (69/69)

## Phase 2: Anthropic endpoint — DONE

- [x] **Task 3: `/v1/messages` route via generic passthrough**
  - `src/routes/anthropic-messages.ts` registers `/v1/messages` → upstream `/messages`; usage extracted from `message.usage` / `message_delta.usage` and tracked; upstream errors Anthropic-shaped; `x-request-id` forwarded
  - Upstream auth verified: `Authorization: Bearer` (ollama cloud) works alone — no x-api-key needed
- [x] **Task 4: test-anthropic.mjs live suite** — 45/45
  - non-streaming, system+Bearer, streaming event sequence, tool_use + tool_result round-trip, auth 401s (Anthropic + OpenAI shapes), upstream 404 passthrough, x-request-id, vision
  - Note: vision test needs `max_tokens >= 128` — thinking blocks consume the budget before text

## Checkpoint: Core complete — DONE
- [x] 45/45 anthropic + 69/69 comprehensive + build clean

## Phase 3: Polish — DONE

- [x] **Task 5: README Anthropic section, `.env.example`, `examples/claude-code.md`**
  - README: feature bullet, `/v1/messages` API docs, Claude Code agent section, matrix rows, testing section
  - `.env.example` created (was missing); `examples/claude-code.md` with setup, model naming, upstream limitations

## Checkpoint: Complete
- [x] All acceptance criteria met; build clean; 114/114 checks across both suites
- [ ] Manual user-side smoke with an Anthropic client (Claude Code / Cline)