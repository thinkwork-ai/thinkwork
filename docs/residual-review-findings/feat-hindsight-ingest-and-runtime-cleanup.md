# Residual Review Findings

Source: `ce-code-review mode:autofix` run `20260428-142736-fbdcffd9` against branch `feat/hindsight-ingest-and-runtime-cleanup` (HEAD `18d13a7c`).
Plan: [`docs/plans/2026-04-27-002-feat-hindsight-ingest-and-runtime-cleanup-plan.md`](../plans/2026-04-27-002-feat-hindsight-ingest-and-runtime-cleanup-plan.md)
Run artifact: `/tmp/compound-engineering/ce-code-review/20260428-142736-fbdcffd9/`

11 reviewers dispatched (correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, security, data-migrations, adversarial, kieran-python, kieran-typescript). 1 `safe_auto` fix applied (commit `18d13a7c` — removed unused `List` import). 1 finding dropped by validator (adv-3 false positive — wipe filter is safe). 19 actionable findings remain.

## P1 — Should Fix Before Merge

### 1. Wipe `--tenant` scope leaks across tenants for users belonging to multiple tenants
- **File:** `packages/api/scripts/wipe-external-memory-stores.ts:191`
- **Confidence:** 100 (cross-reviewer agreement: adversarial + data-migrations)
- **Why:** Banks are user-scoped (`user_<userId>`), not tenant-scoped. The `--tenant=A` predicate selects user banks for any user with at least one agent in tenant A — but the bank itself contains memories from every tenant the user has acted in. Running `--tenant=A` on a multi-tenant user wipes their tenant-B-derived memories too. The legacy filter does not include a tenant predicate.
- **Suggested fix:** Either (a) add `metadata->>'tenantId' = ${tenantId}::text` to the legacy predicate so only rows attributed to the named tenant are wiped, or (b) document the caveat in `--help` and the runbook ("`--tenant` scopes by user-membership-in-tenant, not row-tenant-of-origin").

### 2. Wipe inner DELETE loop has no max-iteration guard; `--max-deletes` only checks pre-count
- **File:** `packages/api/scripts/wipe-external-memory-stores.ts:244`
- **Confidence:** 100 (3-reviewer agreement: correctness + data-migrations ×2)
- **Why:** The runbook prerequisite is that AgentCore is fully repulled before the wipe. If that prerequisite is missed for either runtime, the still-running old container will continue inserting `context='thread_turn'` rows. The inner `for(;;)` loop never sees an empty batch, deleting forever. Even if it terminates, actual deletions can massively exceed `totalLegacy` from the count phase — `--max-deletes` is a snapshot guard, not an enforcement cap.
- **Suggested fix:** Track a running deleted-total across all banks. Abort with a clear `runtime-still-writing-legacy-rows` error when the running total exceeds `args.maxDeletes` OR when any single bank's iteration count exceeds `Math.ceil(rowCountForBank / batchSize) * 2`.

### 3. Long-thread retains can silently fail at the 256KB Lambda async-invoke ceiling
- **File:** `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py:73` (and Pi `hindsight.ts:241`)
- **Confidence:** 75 (adversarial)
- **Why:** AWS `InvocationType="Event"` has a hard 262144-byte payload limit. The full-history transcript carries up to 30 history entries; tool_results JSON in assistant messages can be tens of KB each, putting the payload near or over the limit. Both runtimes catch `RequestEntityTooLargeException` broadly and only log at WARN — no metric, no compensating retry, no fallback.
- **Suggested fix:** Add a payload-size check before invoke. On exceed: drop oldest history entries until under the limit, log INFO with the trim count. Or fall back to sending only the new pair and rely on the Lambda's DB-side merge.

### 4. Cross-runtime asymmetry: Strands always retains; Pi gates on `use_memory=true`
- **File:** `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:225`
- **Confidence:** 75 (adversarial)
- **Why:** Strands `_fire_retain_full_thread` runs unconditionally in `do_POST`. Pi `retainFullThread` short-circuits when `optionalBoolean(payload.use_memory)` returns false. Eval and skill paths sending `use_memory: false` produce divergent Hindsight state by runtime — confounding A/B comparison.
- **Suggested fix:** Pick one policy. If `use_memory=false` is meant to suppress retain, gate Strands' call on the same payload field. If retain should always run, drop the `use_memory` check from Pi (preserving it as a recall/reflect read-side gate only).

## P2 — Should Fix

### 5. `messages.role='tool'` silently relabeled as `'user'` in `fetchThreadTranscript`
- **File:** `packages/api/src/handlers/memory-retain.ts:252`
- **Confidence:** 100 (cross-reviewer: adversarial + kieran-typescript)
- **Why:** The schema column `messages.role text NOT NULL` does not constrain values. The handler's filter passes any non-empty content; the subsequent map collapses `r.role !== 'assistant' && r.role !== 'system'` to `'user'`. A tool-output row would be presented to `retainConversation` as if the user said it.
- **Suggested fix:** Filter on role first: `.filter((r) => r.role === 'user' || r.role === 'assistant' || r.role === 'system')` before mapping. Drop unknown roles entirely.

### 6. mergeTranscriptSuffix may pick wrong k on coincidental match
- **File:** `packages/api/src/handlers/memory-retain.ts:286`
- **Confidence:** 75 (adversarial)
- **Why:** Algorithm runs k=max..1 and breaks on first suffix match. If the event payload carries history with internal repetition (e.g. user said 'ok'/'thanks' multiple times across the thread), the algorithm can match at a non-latest k position, dropping legitimate new-pair content that comes after the false-match suffix.
- **Suggested fix:** Restrict the match window to require event[k..] to be strictly NEW content not present in db.tail (additional anti-overlap check), or hash (role, content) pairs and compare positionally. Add a test for the 'ok x3 with assistant pairs between' pathological case.

### 7. Wipe script disables type checker on every `db.execute` result
- **File:** `packages/api/scripts/wipe-external-memory-stores.ts:215`
- **Confidence:** 80 (kieran-typescript)
- **Why:** Every db.execute boundary uses `: any`. The `CountRow`/`BankRow` interfaces are declared but only used in the post-coerce array. A future schema column rename won't fail at compile time.
- **Suggested fix:** Use `db.execute<CountRow>(sql\`...\`)` or wrap with a small `executeRows<T>` helper. Drop `as any` from the test mock; use a typed `ExecuteFn` in `buildDb`.

### 8. Pi `getLambdaClient(region)` ignores subsequent region argument
- **File:** `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:175`
- **Confidence:** 100 (correctness)
- **Why:** `_lambdaClient` is a module-level singleton initialized on first call. The `region` parameter is ignored on subsequent calls. Production region never changes (env-driven), so this is benign — but the parameter is misleading.
- **Suggested fix:** Drop the `region` parameter from `getLambdaClient`, or invalidate the cached client when `region` differs.

### 9. `__setLambdaClientForTest` module-singleton is a structural shortcut where DI would be cleaner
- **File:** `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:158`
- **Confidence:** 75 (cross-reviewer: maintainability + kieran-typescript)
- **Why:** Couples production module to its test harness via a soft-public `__set...` setter. `aws-sdk-client-mock` is already a devDependency. A `clientOverride?: LambdaClient` parameter mirroring the existing `envOverrides?` pattern would eliminate the seam.
- **Suggested fix:** Add `clientOverride?: LambdaClient` to `retainFullThread`; default to a freshly-constructed client. Drop `_lambdaClient` and `__setLambdaClientForTest`.

### 10. Snapshot-pattern docstring overstates `MEMORY_RETAIN_FN_NAME` guarantee
- **File:** `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts:220`
- **Confidence:** 75 (maintainability)
- **Why:** The docstring invokes `feedback_completion_callback_snapshot_pattern` (guard against mid-turn env shadowing). But `MEMORY_RETAIN_FN_NAME` is read from `process.env` at retain-call time, not at runtime startup. The actual `RuntimeEnv` snapshot covers only awsRegion, gitSha, buildTime, workspaceBucket, workspaceDir.
- **Suggested fix:** Either (a) thread `MEMORY_RETAIN_FN_NAME` through `RuntimeEnv` so it's genuinely captured at container init, or (b) tighten the comment to say "reads process env at call time; relies on no shadowing between turn entry and retain dispatch".

### 11. Architectural invariant 'all Hindsight tools route through `make_hindsight_tools`' enforced only by docstring
- **File:** `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py:8`
- **Confidence:** 75 (cross-reviewer: maintainability + adversarial)
- **Why:** After U10 retires `install()`, the cost-attribution safety net is gone. A future contributor importing `hindsight_strands` directly to add a new memory tool will silently zero out `cost_events` for that tool with no test failure.
- **Suggested fix:** Add a CI grep guard: `grep -rn 'from hindsight_strands' packages/agentcore-strands/agent-container/container-sources/ | grep -v hindsight_tools.py` should return zero. Convert the review-time invariant into a build-time one.

### 12. Tenant anomaly ERROR log assertion uses substring match; doesn't pin truncation/no-content-leak
- **File:** `packages/api/src/handlers/memory-retain.test.ts:207`
- **Confidence:** 75 (testing)
- **Why:** Plan calls out "never include message content in logs; identifiers prefix-truncated; tenant anomaly is ERROR-level (DLQ surface)". Test asserts only `stringMatching(/tenant_anomaly/)`. A future change that logs full UUIDs or accidentally includes `r.content` would pass.
- **Suggested fix:** Pin the exact log shape with a tighter regex; add a negative assertion that no content fragment leaks into the log.

### 13. `reflect_model` closure-snapshot regression test missing
- **File:** `packages/agentcore-strands/agent-container/test_hindsight_tools.py:250`
- **Confidence:** 75 (testing)
- **Why:** Only retain has a regression test that mutates env post-registration and asserts the snapshotted value still wins. Reflect has the same closure capture but no equivalent test.
- **Suggested fix:** Mirror `test_retain_model_closure_snapshotted_at_registration` for reflect.

### 14. Wipe `--tenant` JOIN-against-agents SQL branch is untested
- **File:** `packages/api/scripts/wipe-external-memory-stores.test.ts:211`
- **Confidence:** 80 (testing)
- **Why:** The `--user` predicate is asserted via JSON.stringify of the count query; the `--tenant` predicate (which builds a non-trivial JOIN against `public.agents`) has no equivalent test. A typo in the column name or JOIN predicate would not be caught.
- **Suggested fix:** Add a `runWipe` test invocation with `tenantId` set; assert the count query's serialized form contains both the agents subquery and the supplied tenantId UUID.

## P3 — Nits

- **`memory-retain.ts:286`** — Add complexity comment on `mergeTranscriptSuffix` (`O(N×M); acceptable while messages_history is capped at 30 turns`). Reviewer: maintainability.
- **`memory-retain.ts:22`** — Alias the `messages` schema import as `messagesTable` to avoid shadowing local parameters and field names. Reviewer: kieran-typescript.
- **`hindsight_tools.py:145`** — Drop unreachable trailing `return f"Memory storage failed: {last_exc}"` after the retry loop in the new `retain` wrapper (same pattern in pre-existing `hindsight_recall`/`hindsight_reflect`). Reviewer: kieran-python.
- **`wipe-external-memory-stores.ts:130`** — `validateSurvey` accepts loose date strings that JS Date silently re-interprets (`2026-13-01` → 2027). Add regex validation. Reviewer: correctness.
- **`pi-loop.ts:222`** — `void retainFullThread().then(success, reject)` swallows errors thrown inside the success handler. Use `.then(success).catch(reject)` chained form. Reviewer: kieran-typescript.
- **`wipe-external-memory-stores.ts:247`** — DELETE batch transaction comment overstates atomicity guarantee (single statement is atomic by virtue of being one statement, not because db.execute opens a transaction). Reviewer: data-migrations.

## Test status

1798 tests passing across the touched test surfaces:
- API (TypeScript / vitest): 1712 tests, 143 files
- Strands (Python / pytest): 48 tests in this PR's test files (test_api_memory_client, test_server_chat_handler_retain, test_hindsight_tools, test_hindsight_usage_capture)
- Pi (TypeScript / vitest): 38 tests, 6 files

## Verdict

**Ready with fixes.** The 4 P1 findings (wipe cross-tenant leak, wipe-loop unboundedness, Lambda payload silent failure, `use_memory` cross-runtime asymmetry) should be addressed before merge OR explicitly accepted as known limitations with runbook updates. P2/P3 findings can be queued as follow-ups.
