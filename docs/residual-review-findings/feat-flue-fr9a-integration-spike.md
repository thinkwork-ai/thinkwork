# Residual Review Findings — feat/flue-fr9a-integration-spike

Source: `ce-code-review mode:autofix` against the FR-9a integration spike.
Run artifact: `/tmp/compound-engineering/ce-code-review/20260503-164242-b3175beb/`
Branch: `feat/flue-fr9a-integration-spike`
Plan: `docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md`
Verdict: `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`

All three residuals are **explicitly accepted spike-tier scope** per the plan's `## Scope Boundaries`:
> "Production hardening — tenant scoping, OTel instrumentation, error handling beyond surface-level, and tests beyond a happy-path smoke are all out of scope at this tier."

They land during `/ce-plan` revision after the verdict is consumed (brainstorm Next Steps step 3 — "If FR-9a verdict = green: revise the 2026-04-26 plan + the three follow-up plans"). They are NOT separate tickets — the productionization work absorbs all three as a single plan revision.

## Residual Review Findings

- **[P1][manual → downstream-resolver]** `packages/flue-aws/connectors/agentcore-codeinterpreter.ts:36` — No tenant-aware interpreter ID lookup; one ID at construction time.
  Productionization requires the trusted handler to resolve a per-tenant `interpreterId` (or pass `tenantId` to the connector for multi-interpreter dispatch) per origin FR-4a multi-tenant isolation. Suggested fix at /ce-plan revision: accept a `getInterpreterId(tenantId)` callback in `AgentcoreCodeInterpreterOptions`, OR document the pattern of constructing one connector per tenant request and instantiating it inside the trusted handler with the right `interpreterId`.

- **[P2][manual → downstream-resolver]** `packages/flue-aws/connectors/agentcore-codeinterpreter.ts:1` — No mocked-AWS unit tests for the connector.
  Plan U2 specified a test file at `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` with mocked AWS scenarios (happy path, edge cases, error paths). End-to-end smoke against real AWS passed (verdict §"What was tested") but mocked unit tests would surface stream-parsing edge cases without burning real AWS calls. Suggested fix at /ce-plan revision: add vitest test scenarios per the plan U2 list: happy-path exec/readFile/writeFile/readdir, edge case readFile-on-missing-path, mocked AWS error responses surface to caller.

- **[P3][manual → downstream-resolver]** `packages/flue-aws/connectors/agentcore-codeinterpreter.ts:75` — Stream events parsed via untyped `Record<string, unknown>` casts; brittle vs SDK shape changes.
  `consumeStream` casts AgentCore CI stream events to `Record<string, unknown>` and accesses fields by string keys. Already documented in spike's Gotchas — productionization should switch to the typed `CodeInterpreterStreamOutput` from `@aws-sdk/client-bedrock-agentcore`. Suggested fix at /ce-plan revision: import `CodeInterpreterStreamOutput` from `@aws-sdk/client-bedrock-agentcore` and replace the cast-based parsing with discriminated-union handling on the actual stream event types.

## Source PR-review run context

- Mode: `mode:autofix` (LFG step 3)
- Reviewers: inline review (correctness + maintainability + project-standards). Multi-agent dispatch deemed disproportionate for a 5-file pre-validated spike.
- Verdict: Ready with fixes (1 safe_auto applied — `defaultCwd` field comment clarification at `packages/flue-aws/connectors/agentcore-codeinterpreter.ts:50`).
- Pre-commit checks: typecheck clean, prettier clean, lint not configured for the package (matches CLAUDE.md note that CLI lint is a no-op stub for non-app packages).
- End-to-end validation: spike already passed end-to-end against real AgentCore CI in dev account (`thinkwork_dev_0015953e_pub-5rETNEk2Vt`) — verdict file documents 11 SessionEnv probes all returning clean, plus Bedrock model routing confirmed via `amazon-bedrock/<full-arn-id>`.
