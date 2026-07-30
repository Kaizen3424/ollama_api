# Task List: Fix Issues & Dynamic Model List

## Phase 1: Foundation Fixes

- [ ] **Task 1**: Fix silent data loss on MongoDB flush failure
  - Priority: High | Scope: XS (1 file) | Deps: None
- [ ] **Task 2**: Fix missing await on trackUsage in streaming path
  - Priority: High | Scope: XS (2 files) | Deps: None

### Checkpoint: Phase 1
- [ ] Build succeeds

## Phase 2: Token Limit Enforcement

- [ ] **Task 3**: Make getNextKey async with optional exclude predicate
  - Priority: High | Scope: S (1-2 files) | Deps: None
- [ ] **Task 4**: Wire isKeyOverLimit into retry handler
  - Priority: High | Scope: S (1 file) | Deps: Task 3
- [ ] **Task 5**: Connect config and tracker in server, handle 429
  - Priority: High | Scope: S (2 files) | Deps: Task 4
- [ ] **Task 6**: Token enforcement integration test
  - Priority: Medium | Scope: S (1 file) | Deps: Task 5

### Checkpoint: Phase 2
- [ ] Build succeeds
- [ ] Normal request → 200
- [ ] All keys over limit → 429

## Phase 3: Dynamic Model List

- [ ] **Task 7**: Fetch models from Ollama cloud API with caching
  - Priority: Medium | Scope: M (2 files) | Deps: None

### Checkpoint: Phase 3
- [ ] Build succeeds
- [ ] `/v1/models` returns live models from Ollama API

## Final Checkpoint
- [ ] Build succeeds
- [ ] All tests pass
- [ ] Server starts and responds correctly
