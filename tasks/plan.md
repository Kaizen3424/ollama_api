# Implementation Plan: Fix Issues & Dynamic Model List

## Overview

Fix 3 bugs in the Ollama API proxy and replace the hardcoded model list with a live fetch from the Ollama cloud API. The three bugs are: (1) token limits are tracked but never enforced during routing, (2) the streaming path's usage callback is missing an `await`, and (3) MongoDB flush can silently lose data on write failure.

## Architecture Decisions

- **Load balancer `getNextKey` becomes async** with an optional `isAvailable` predicate. This keeps exclusion logic outside the load balancer while still allowing the retry handler to skip over-limit keys. The load balancer remains generic — it doesn't import usage tracker or know about token limits.
- **Custom error class `KeyLimitError`** with `statusCode = 429` so the global error handler automatically returns the correct HTTP status. The route handler's catch block checks `err.statusCode` to decide between 502 and 429.
- **`pipeStream`'s `onUsage` callback becomes `void | Promise<void>`** so callers can `await` async callbacks. The stream loop `await`s the result, fixing the fire-and-forget bug.
- **Flush defers splice until after MongoDB write succeeds.** Entries are captured in a local variable and only removed from pending arrays after write confirmation. On failure, entries remain in the array for the next flush cycle.
- **Model list is cached in-memory with 5-minute TTL.** Fetched via `forwarder.forwardGetToOllama` using the first available key. Falls back to cache on fetch error. Cold-start fallback is an empty array with a warning log.

## Task List

### Phase 1: Foundation Fixes (no dependencies)

#### Task 1: Fix silent data loss on MongoDB flush failure

**Description:** In `flush()`, the `splice(0)` call removes entries from pending arrays before the `await updateOne`. If MongoDB write fails, those entries are gone forever. Fix by capturing the spliced array, writing to MongoDB, and only clearing from the pending array on success. On failure, re-queue entries and log the error.

**Files touched:**
- `src/usage-tracker.ts`

**Acceptance criteria:**
- [ ] `ollamaPending.splice(0)` captured to local variable, original array not cleared until after successful write
- [ ] `proxyPending.splice(0)` same pattern
- [ ] Failed writes are logged, entries remain in pending array for retry
- [ ] Successful writes clear the entries from pending

**Verification:**
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Estimated scope:** XS (1 file)

---

#### Task 2: Fix missing await on trackUsage in streaming path

**Description:** `pipeStream`'s `onUsage` callback signature is `(usage: StreamUsage) => void`, making it impossible to `await` an async callback. `chat-completions.ts:57-59` calls `trackUsage()` (which is `async`) inside the callback without `await`. Fix both: change `onUsage` type to `(usage: StreamUsage) => void | Promise<void>` and `await` the call in the stream loop, then add `await` on `trackUsage` in the streaming path.

**Files touched:**
- `src/proxy/stream-handler.ts`
- `src/routes/chat-completions.ts`

**Acceptance criteria:**
- [ ] `onUsage` type accepts `void | Promise<void>` return
- [ ] `pipeStream` loop `await`s the callback result
- [ ] Streaming path in `chat-completions.ts` uses `await trackUsage(...)`
- [ ] Non-streaming path unchanged (already has `await`)

**Verification:**
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Estimated scope:** XS (2 files)

---

### Phase 2: Token Limit Enforcement

#### Task 3: Make getNextKey async with optional exclude predicate

**Description:** Currently `getNextKey()` is synchronous and only checks cooldowns. Change it to `async` and accept an optional `isAvailable?: (index: number) => boolean | Promise<boolean>` predicate. If the predicate returns `false` for a key, treat it like a cooldown (skip it). If all keys are excluded, fall through with the same fallback logic (cooldowns cleared, return first key or null). This keeps the load balancer generic while enabling the retry handler to inject limit checks.

**Files touched:**
- `src/load-balancer.ts`
- `src/retry-handler.ts` (update callers to `await`)

**Acceptance criteria:**
- [ ] `getNextKey` is async, accepts optional `isAvailable` predicate
- [ ] Without predicate, behavior is identical to current
- [ ] With predicate, keys returning `false` are skipped
- [ ] All callers updated to `await`

**Verification:**
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Estimated scope:** S (1-2 files)

---

#### Task 4: Wire isKeyOverLimit into retry handler

**Description:** Pass `isKeyOverLimit`, `keyTokenLimit5h`, and `keyTokenLimitWeek` to `createRetryHandler`. In `forwardWithRetry`, create a predicate for `getNextKey` that checks whether the candidate key has exceeded its token window limits. If all keys are over limit, throw a `KeyLimitError` (custom error class with `statusCode = 429`). Remove dead `forwardGetWithRetry`.

**Files touched:**
- `src/retry-handler.ts`

**Acceptance criteria:**
- [ ] `createRetryHandler` accepts optional `isKeyOverLimit`, `limit5h`, `limitWeek`
- [ ] `forwardWithRetry` creates predicate checking `isKeyOverLimit` per candidate
- [ ] All over-limit → throws `KeyLimitError` (status 429)
- [ ] Dead `forwardGetWithRetry` removed

**Verification:**
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 3

**Estimated scope:** S (1 file)

---

#### Task 5: Connect config and tracker in server, handle 429

**Description:** Wire the token limit config and tracker's `isKeyOverLimit` into `createRetryHandler` in `server.ts`. Update `chat-completions.ts` to check `err.statusCode` in the catch block and return the appropriate status code (429 vs 502).

**Files touched:**
- `src/server.ts`
- `src/routes/chat-completions.ts`

**Acceptance criteria:**
- [ ] `server.ts` passes `tracker.isKeyOverLimit`, `config.keyTokenLimit5h`, `config.keyTokenLimitWeek` to `createRetryHandler`
- [ ] `chat-completions.ts` catch block returns 429 for `KeyLimitError`, 502 otherwise
- [ ] Response body for 429 includes `type: "rate_limit_error"`

**Verification:**
- [ ] Build succeeds: `npm run build`

**Dependencies:** Task 4

**Estimated scope:** S (2 files)

---

#### Task 6: Token enforcement integration test

**Description:** Write a test that verifies the end-to-end token enforcement behavior: normal request returns 200, all keys over limit returns 429 with correct error shape.

**Files touched:**
- `test-enforcement.mjs` (new)

**Acceptance criteria:**
- [ ] Normal request → 200 when keys available
- [ ] All keys over limit → 429 with `error.type === "rate_limit_error"`

**Verification:**
- [ ] Test passes against running server

**Dependencies:** Task 5

**Estimated scope:** S (1 file)

---

### Phase 3: Dynamic Model List

#### Task 7: Fetch models from Ollama cloud API with caching

**Description:** Replace the hardcoded model list in `models.ts` with a live fetch from the Ollama cloud API. Use `forwarder.forwardGetToOllama('/models', key)` with a key from the load balancer. Cache the result in-memory with a 5-minute TTL. On fetch failure, fall back to cached data.

**Files touched:**
- `src/routes/models.ts`
- `src/server.ts` (update call)

**Acceptance criteria:**
- [ ] `registerModels` accepts `forwarder` and `lb`
- [ ] Fetches from `GET /v1/models` on first request
- [ ] 5-minute cache TTL
- [ ] Fetch error → fall back to cache or empty array
- [ ] OpenAI-compatible response format

**Verification:**
- [ ] Build succeeds: `npm run build`
- [ ] `GET /v1/models` returns live models

**Dependencies:** None

**Estimated scope:** M (2 files)

---

## Task Dependency Graph

```
Task 1 (flush) ──┐  (parallel)
Task 2 (await) ──┘

Task 3 (async LB) → Task 4 (retry limit) → Task 5 (server) → Task 6 (test)

Task 7 (models) ── (independent)
```

## Files Summary

| File | Change |
|------|--------|
| `src/usage-tracker.ts` | Defer `splice(0)` until after write succeeds |
| `src/proxy/stream-handler.ts` | `onUsage` returns `void \| Promise<void>`, awaited |
| `src/routes/chat-completions.ts` | `await trackUsage` in stream + check `err.statusCode` for 429 |
| `src/load-balancer.ts` | `getNextKey` async with optional predicate |
| `src/retry-handler.ts` | Wire limits, `KeyLimitError`, remove dead code |
| `src/server.ts` | Pass limits to handler, forwarder+lb to models |
| `src/routes/models.ts` | Live fetch with 5-min cache |
| `test-enforcement.mjs` | New integration test |
