## Residual Review Findings

ce-code-review run 20260506-072813-96f6dad0 (mode:autofix). 9 reviewers dispatched; 3 safe_auto fixes applied in commit `d2f3e065`. Findings below are residual actionable work the autofix flow does not own.

### P1 / High

- **rel-001/002/005 cluster — LambdaClient missing timeout on awaited critical path.**
  File: `packages/agentcore-flue/agent-container/src/server.ts:1162-1173`. Reviewers: reliability (request_changes), correctness (P3, conf 80). The end-of-turn `await retainConversation(...)` blocks the user response. AWS SDK defaults retry without explicit timeout — control-plane slowness or 429 throttling can delay the user-facing 200 by SDK retry budget (~1-3s). Fix shape: pass `NodeHttpHandler({ connectionTimeout: 1000, requestTimeout: 2000 })` + `maxAttempts: 1` when constructing the LambdaClient, or switch the call site to `void retainConversation(...).catch(log)` fire-and-forget. Plan U2 explicitly chose `await` for LWA-lifecycle uncertainty — reversing the decision requires empirical LWA observation in dev first.

- **adv-001 — Cross-thread messages_history defense-in-depth.**
  Files: `packages/agentcore-flue/agent-container/src/runtime/tools/memory-retain-client.ts` + receiver `packages/api/src/handlers/memory-retain.ts`. Reviewer: adversarial (HIGH, conf 75). Flue retain client trusts `payload.messages_history` shape but stamps the request with `identity.tenantId/threadId`. If the upstream Lambda is compromised (currently restricted to chat-agent-invoke via IAM), foreign content lands in the tenant's Hindsight bank tagged under the wrong thread. Defense-in-depth gap, not a current-vulnerability — chat-agent-invoke loads history from DB by thread_id. Fix shape: receiver-side validation that messages_history entries are consistent with the stamped thread_id (re-fetch transcript, prefer DB over event tail), OR runtime-side schema cap on messages_history size + role/content tightening. File as separate plan; receiver is the natural defense location.

### P2 / Medium

- **rel-003 — No DLQ for memory-retain Lambda.**
  File: `terraform/modules/app/lambda-api/handlers.tf` (event_invoke_config block). Reviewer: reliability (medium, conf 75). With `MaximumRetryAttempts=0` and no `destination_config.on_failure`, transient Lambda invoke failures are dropped permanently with no replay path. Plan U3 explicitly chose "no DLQ — best-effort writeback". Revisit after observing dev failure rates; if persistent failure rate is non-trivial, add an SQS DLQ for manual replay.

- **rel-004 — No CloudWatch metric filter / alarm on memory_retain_failed.**
  File: `terraform/modules/app/lambda-api/handlers.tf`. Reviewer: reliability (medium, conf 75). Sustained retain failures are invisible until users notice memory loss. Fix shape: metric filter on `event=memory_retain_failed` log lines + CloudWatch alarm at >5/5min threshold to SNS. Operational follow-up; out of plan scope.

- **rel-005 / correctness-003 — LambdaClient constructed per-invocation.**
  File: `packages/agentcore-flue/agent-container/src/server.ts:1172`. Cross-reviewer (reliability + correctness). New LambdaClient on every turn pays a TLS handshake on the awaited critical path. Fix shape: memoize LambdaClient by region in the factory closure (or module-cached singleton). Pairs with rel-001/002 — address as a single "retain client SDK config" follow-up.

### P3 / Low

- **adv-002** — 256KB Lambda async invoke limit on long messages_history. Inbound chat-agent-invoke payload cap is 6MB; messages_history can exceed the 256KB async invoke limit silently. Add size cap if observed.
- **adv-004** — Rapid double-submit Bedrock cost amplification. Concurrent retain invokes from the same thread will both pay Bedrock embedding cost. UI-side debounce is the natural fix.
- **adv-005** — Empty `assistantContent` still ships transcript with stale history. If `pi-ai` swallows a ValidationException and returns empty content, retain fires anyway with history-only transcript. Consider gating on non-empty assistant turn at the call site.
- **adv-007** — Tool-use assistant turns have non-string content; current `typeof content === "string"` filter drops them. Verify chat-agent-invoke pre-normalizes assistant tool turns into string content before the retain hook receives them.

### Documentation follow-ups (advisory)

- Document Lambda Web Adapter in-flight Promise lifecycle in `docs/solutions/runtime-errors/` after dev observation. The `await` decision in plan U2 was conservative because the institutional record had no entry on this. Empirical confirmation either way (LWA freezes background promises at HTTP-response time, or it doesn't) closes the gap permanently.
- Clarify in PR description that `use_memory` opt-in gate is intentional. Non-Marco agents that don't set `use_memory: true` will silently skip retain. Pi reference uses the same conservative default.
- Extend `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` Phase 2 verification with the new `memory_retain_dispatched` log query so the next operator can spot retain regressions during launch.

### Demoted (soft bucket — Stage 5 step 6c)

testing-001, testing-003, testing-004 — testing-only, P3/advisory, single reviewer. Routed to testing_gaps in the run artifact.

### Pre-existing (not introduced by this PR)

`packages/agent-tools` typecheck failure — `package.json` missing `typescript` in devDependencies. Confirmed identical on `origin/main`. Out of PR scope; file separately.

---

Source: `/tmp/compound-engineering/ce-code-review/20260506-072813-96f6dad0/` (synthesis.md + per-reviewer JSON artifacts).
