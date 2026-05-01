## Residual Review Findings

Source: ce-code-review autofix run `20260501-145958-5884160c` against `feat/routines-phase-b-u6` (base `4fbba86a`).

Plan: `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` U6.

10 reviewers dispatched (correctness, testing, maintainability, project-standards, agent-native, learnings, reliability, security, adversarial, kieran-typescript). 16 autofixes applied + committed in `ac869296`. The findings below are residual actionable work.

### P1

- [P1][gated_auto → downstream-resolver][needs-verification] `packages/lambda/routine-task-python.ts:170-180` — **AsyncIterable stream consumption has no abort/timeout.** A stalled AgentCore stream pins the Lambda until its 360s timeout. The 60s `requestTimeout` on the SDK client only bounds the initial response.
  - Suggested fix: pass an `AbortController` whose signal is wired to a `setTimeout(reset)` and aborted on a per-stream deadline. Alternatively, race the for-await loop against a `setTimeout` Promise and return `errorClass: 'sandbox_stream_stall'`.
  - (reliability rel-002 + adversarial adv-1)

- [P1][manual → downstream-resolver] `packages/lambda/__tests__/routine-task-python.test.ts` — **`handler()` boundary fully untested.** Bearer auth doesn't apply (SFN integration), but `sandbox_misconfigured` early-return paths (both `SANDBOX_INTERPRETER_ID` and `ROUTINE_OUTPUT_BUCKET` missing) and `ROUTINE_PYTHON_ENV_ALLOWLIST` CSV parsing are untested.
  - Suggested fix: add a `describe("handler")` block that builds the SFN payload shape and asserts each error path. Test the env-var CSV parser (split + trim + filter).
  - (testing T1)

- [P1][manual → downstream-resolver] `packages/lambda/__tests__/` — **No integration tests against dev AgentCore + SFN.** Plan U6 lists two integration scenarios as verification criteria. None present.
  - Suggested fix: add `routine-task-python.integration.test.ts` and `routine-resume.integration.test.ts` gated behind `INTEGRATION=1` env, exercising the real SDK paths against dev. Wire to `pnpm sandbox:e2e`-style runner.
  - (testing T4)

### P2

- [P2][gated_auto → downstream-resolver] `packages/lambda/routine-task-python.ts:295-310` — **Multiple `structuredContent` events overwrite earlier output.** Each terminal event replaces stdout/stderr/exitCode in `out`. AgentCore docs don't guarantee single-shot, so a stream emitting two terminal events would drop the first. Today's adversarial fix bounds this for the streaming `content[]` path but not the `structuredContent` path.
  - Suggested fix: assert singleton via a guard (`if (sawStructured) ignore`) OR accumulate stdout/stderr additively across structured events. Document the contract in the ParsedStream JSDoc.
  - (correctness C3 + adversarial adv-2)

- [P2][manual → downstream-resolver] `packages/lambda/routine-task-python.ts:340-360` — **`extractExecutionId` collides on Map-state child execution ARNs.** `:retry-1`, `:Map:0` segments produce wrong ids. SFN's Map state child executions append segments after the parent execution id.
  - Suggested fix: parse the ARN segment after `:execution:<state-machine-name>:` and stop at the first colon. Add tests for Map child + redrive ARN forms.
  - (correctness C5 + adversarial adv-4)

- [P2][gated_auto → downstream-resolver] `packages/lambda/routine-resume.ts` — **SendTaskSuccess output >256KB throws ValidationException not in `_CONSUMED_ERROR_NAMES`.** The wrapper rethrows; the bridge surfaces the error to the operator, but the routine execution stays paused.
  - Suggested fix: catch `ValidationException` separately, re-call `SendTaskFailure` with `errorCode: 'OutputTooLarge'` and the truncated output as cause, then return `{ ok: true, alreadyConsumed: false, downgraded: 'output_too_large' }`.
  - (adversarial adv-7)

- [P2][manual → downstream-resolver] **errorClass taxonomy: split `sandbox_invoke_failed` into `sandbox_throttled` / `sandbox_invalid_input` / `sandbox_invoke_failed`.** The current single class collapses retryable AWS throttles, deterministic validation errors, and unknown errors into one bucket. An agent reading routine_step_events later can't distinguish.
  - Suggested fix: add `awsErrorName` field to PythonTaskResult; preserve the SDK's `error.name` from each error envelope branch. Split the error class on the throttling/validation/access-denied branches in parseStream.
  - (agent-native warning #2 + reliability)

- [P2][manual → downstream-resolver] `packages/database-pg/src/schema/routine-step-events.ts` — **`errorClass` not promoted to a queryable column.** When U7 step-callback ingestion lands, ensure errorClass is preserved at a stable jsonb path (`error_json.errorClass`) or as a dedicated `error_class` text column. Document on the GraphQL type.
  - (agent-native warning #1 — Phase B U7 dependency)

- [P2][manual → downstream-resolver] `packages/lambda/routine-resume.ts` — **Bridge crash between DB consume-flag flip and routine-resume invoke leaves SFN execution stuck pending.** Phase B U8 territory but worth flagging now.
  - Suggested fix: reverse the bridge ordering (SendTaskSuccess first, then DB flip) OR add an outbox pattern. Current ordering is hard to recover from. Defer to U8 plan review.
  - (adversarial adv-6)

### P3

- [P3][gated_auto → downstream-resolver] `terraform/modules/app/lambda-api/main.tf` — **bedrock-agentcore IAM grant is `Resource = "*"`.** Step Functions doesn't expose per-resource ARNs for code-interpreter sessions today, but the broad grant admits any future code-interpreter the lambda role principal can name.
  - Suggested fix: add an ABAC condition on `aws:ResourceTag/tenantId` once the agentcore-code-interpreter module exposes per-tenant interpreters. Defer until then.
  - (security sec-4 + adversarial adv-10 + reliability)

- [P3][manual → downstream-resolver] `packages/lambda/routine-task-python.ts` — **Memory size unspecified; 256MB default may OOM on large stdout/stderr buffers.** The 1MB fallbackChunks cap helps but the structuredContent path still buffers stdout/stderr in full before truncation.
  - Suggested fix: bump `memory_size` to 1024MB in handlers.tf for routine-task-python OR add per-stream MAX_BYTES truncation in parseStream's structuredContent branch.
  - (reliability rel-006)

- [P3][advisory → human] **`exitCode: -1` semantic overload.** Returns -1 for session-start failure, invoke failure, S3 offload failure (when the user code didn't run), and user-code segfault/sigterm (when it did). An agent reading `output_json.exitCode == -1` can't distinguish.
  - Suggested fix: document the contract that `exitCode >= 0 ⇒ user code ran to completion`; require `errorClass` to be set whenever `exitCode == -1`. Add to PythonTaskResult JSDoc.
  - (agent-native warning #3)

- [P3][manual → downstream-resolver] `terraform/modules/app/lambda-api/variables.tf` — **Empty `agentcore_code_interpreter_id` default surfaces only at runtime.** Lambda fails closed with `sandbox_misconfigured` when env unset, which becomes a noisy retry storm under SFN's default Retry policy.
  - Suggested fix: add a Terraform precondition gated by `var.routines_enabled` that warns when interpreter id is empty AND the routines stack is being deployed. Defer until Phase B U7 wires routines_enabled.
  - (adversarial adv-5 + reliability rel-011)

- [P3][advisory → human] `packages/lambda/routine-resume.ts:130` — **Default `errorCode: 'RoutineApprovalRejected'` misclassifies non-rejection failures.** The bridge sometimes wants to fail with system errors not user rejections.
  - Suggested fix: drop the default; require explicit `errorCode` from the bridge, or change default to `RoutineFailureUnspecified`.
  - (reliability rel-008)

- [P3][manual → downstream-resolver] **Test coverage gaps from cross-reviewer:**
  - No test for `from __future__` ordering in env prelude (added the fix; needs lock-in)
  - No test for two consecutive `structuredContent` events
  - No test for ThrottlingException on routine-resume (re-throw path)
  - No test for the ValidationException output-too-large case
  - No test for empty-allowlist + non-empty env short-circuit
  - (testing T2/T5/T7 + adversarial)

### Pre-existing / not addressed in this PR

None.

### Coverage notes

- 10 reviewers dispatched; all 10 returned. No reviewer failures.
- 16 autofixes applied across routine-task-python.ts, its test file, handlers.tf, and main.tf. See commit `ac869296` for the diff.
- Validator drops: not run (autofix mode skips Stage 5b).
- Run artifact: `/tmp/compound-engineering/ce-code-review/20260501-145958-5884160c/`
