# Task List: Agent Compatibility Hardening

## Phase 1: Connection hardening — DONE

- [x] **Task 1: Client-disconnect abort** (forwarder, retry-handler, chat route, stream-handler)
  - Abort verified: "Client disconnected, aborting upstream request" logged on client cancel
- [x] **Task 2: Server timeouts + x-request-id**
  - keepAlive 120s / headers 125s / requestTimeout disabled; x-request-id forwarded (verified in logs + tests)

## Phase 2: New endpoints — DONE

- [x] **Task 3: Generic passthrough route factory** (`src/routes/passthrough.ts`)
  - Fixed `/v1/v1/` double-prefix bug via `upstreamPath` option
- [x] **Task 4: /v1/completions + /v1/embeddings**
  - completions: 400 invalid_request_error forwarded verbatim; embeddings: normalized 404; both 401 without key

## Checkpoint: Phases 1-2 — DONE
- [x] tsc + build clean
- [x] test-comprehensive.mjs 46/46 pass (before test extension)
- [x] Manual curl checks of both new endpoints + x-request-id + abort
- [x] Reviewed with human

## Phase 3: Verification & deliverables — DONE

- [x] **Task 5: Extended test suite** — sections 12-17 added
  - Full green run: 67/67 pass (maximax-m3 only, per user requirement — it's the model with vision support)
- [x] **Task 6: Agent integration docs + examples**
  - README: Express diagram, agent-compat matrix, endpoint docs; `.env.example` created; `examples/opencode.example.json` (valid JSON); `examples/hermes-config.yaml`

## Checkpoint: Complete
- [x] Full test suite green run — 67/67 (with `MAX_KEY_RETRIES=10` after server restart)
- [ ] Manual smoke: opencode/hermes pointed at proxy (user-side verification)
