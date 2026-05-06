---
title: "feat: Flue runtime production wiring — replaces oh-my-pi vendoring track"
type: feat
status: completed
date: 2026-05-03
completed: 2026-05-05
origin: docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
supersedes:
  - docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md
  - docs/plans/2026-04-27-001-test-pi-runtime-tools-mcp-memory-e2e-plan.md
  - docs/plans/2026-04-27-002-feat-pi-runtime-tool-execution-plan.md
  - docs/plans/2026-04-29-002-fix-pi-context-engine-split-tools-plan.md
---

# feat: Flue runtime production wiring — replaces oh-my-pi vendoring track

## Summary

Land the Flue-shaped parallel AgentCore runtime end-to-end: rename `packages/agentcore-pi/` → `packages/agentcore-flue/`, provision the AgentCore runtime via Terraform, wire ThinkWork resources through Flue's documented extension points (custom `SessionStore`, custom `ToolDef[]`, MCP via `connectMcpServer`, AgentCore Code Interpreter via the `@thinkwork/flue-aws` connector merged in #783), close the supply-chain / multi-tenant / callback-auth boundary controls, deliver the deep researcher as the first production agent on Flue, and gate plan completion on U14 shipping (with a post-launch ≥2-week DX/observability comparison artifact tracked separately). This plan supersedes the four 2026-04-26/27/29 vendoring plans.

---

## Problem Frame

The 2026-05-03 brainstorm reframed the Pi parallel runtime around Flue. The FR-9a integration spike (verdict: PROCEED-WITH-REFRAME, merged in #783) confirmed that AgentCore Code Interpreter implements Flue's `BashLike` / `SessionEnv` interface cleanly, that Bedrock model routing works through `amazon-bedrock/<full-arn-id>` model strings, and that the connector's surface is production-implementable. With the spike's verdict closed, the remaining work is implementation: provision the runtime, wire the integration, harden the boundary, ship the first agent. (See origin: `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md`.)

This plan replaces — not amends — the four prior plans that scoped the oh-my-pi vendoring strategy. Those plans' `status:` frontmatter has been flipped to `superseded` with a back-pointer to this plan, so `/ce-work` and reviewers find the canonical artifact when scanning active plans.

---

## Requirements

- R1. Rename `packages/agentcore-pi/` → `packages/agentcore-flue/` and migrate the in-flight scaffolding (Dockerfile, LWA wiring, package.json, tests). No production traffic was ever routed to the `pi` runtime, so this is an internal rename. Dev/test agent records pinned to `pi` (if any exist) get migrated to `flue` (not `strands`) per R3 — the developer's intent was to try the non-Strands runtime, and `flue` is the spiritual successor. (Origin: FR-1.)
- R2. Provision the `agentcore-flue` AgentCore runtime via Terraform: ECR repo, Lambda+LWA function, IAM role, function name export. Wire into the deployment pipeline so `thinkwork deploy` provisions it alongside Strands. (Origin: FR-1, dependency carried from 2026-04-26.)
- R3. Replace the runtime selector value `pi` with `flue` across the GraphQL `AgentRuntime` enum, the `AgentRuntimeDb` / `AgentRuntimeType` union literals, and the `resolveRuntimeFunctionName` dispatcher. Migrate any agent records currently pinned to `pi` to `flue` (preserving developer intent — see R1). The data migration runs **before** the API code deploys, so the dispatcher never sees a `pi` value it can't route. The selector ships as `strands | flue` after migration; `pi` retired. (Origin: FR-2; resolves origin OQ on `pi` selector persistence.)
- R4. Implement an Aurora-backed `SessionStore` against the existing Drizzle thread-history schema. Mapping: Flue `sessionId` ↔ thread `id` (UUID); queries scope on `(tenantId, agentId, threadId)` using the existing `idx_messages_thread_id` and `idx_messages_tenant_id_created_at` indices on `messages`. No parallel sessions table. Adapter fails closed if `tenantId` is absent. (Origin: FR-3, FR-4, FR-4a.)
- R5. Implement a `run_skill` `ToolDef` that subprocesses the existing Python script-skills from `packages/skill-catalog/` without rewriting any skill source. Requires Dockerfile additions: install Python 3.11 + skill-catalog deps via `uv` (matching the Strands pattern). (Origin: FR-7.)
- R6. Implement AgentCore Memory + Hindsight as custom `ToolDef[]` injected via `init({ tools })`. Resolves origin OQ "MCP-server vs ToolDef" — chooses ToolDef for both based on per-tool ergonomics (REST surfaces, no MCP-server tier needed, lower deployment complexity). (Origin: FR-4.)
- R7. Wire MCP via Flue's `connectMcpServer` with per-user OAuth token-handle isolation: bearer tokens are passed as opaque handles and resolved at MCP request time on the trusted-handler side, never serialized into `ToolDef` objects. The Flue agent loop runs in a separate Node `worker_thread` (or child process — see U16's design choice). MCP tool response bodies are scrubbed for bearer-shaped strings before crossing back to the worker. (Origin: FR-3, FR-3a.)
- R8. Wire AgentCore Code Interpreter as the default sandbox via `@thinkwork/flue-aws` (merged in #783). The trusted handler reads `sandbox_interpreter_id` from the invocation payload (set by `packages/api/src/lib/sandbox-preflight.ts`) and passes it to the connector at instantiation — no SSM lookup from inside the runtime container. (Origin: FR-5; resolves residual P1 from spike verdict.)
- R9. Implement the Flue agent handler entry point at `packages/agentcore-flue/agent-container/src/server.ts`: parse `/invocations` request, resolve `API_AUTH_SECRET` from Secrets Manager at invocation time, mint per-invocation resources (sandbox, tools, SessionStore, model, role, cwd), call `init()` from `@flue/sdk`, dispatch to the worker thread (U16 finalizes the worker integration), POST `/api/skills/complete` on completion. A 401 from the callback surfaces as a hard error. (Origin: FR-3, FR-4, FR-4b.)
- R10. Supply-chain integrity in CI: pinned `@flue/sdk` + transitive graph in `pnpm-lock.yaml`, lockfile integrity verification on every install, distinct trust-tier handling for `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` (single-author pre-1.0; manual upgrade-review gate), 48-hour CVE response SLA documented, CVE workaround carveout exception to FR-1/FR-3 (fork must submit upstream concurrently, retire within 30 days of upstream acceptance OR within 90 days of upstream NACK, whichever fires first). (Origin: FR-3a.)
- R11. Multi-tenant isolation audit: Aurora `SessionStore` fails closed without `tenantId`; module-level Flue state (MCP connection pools, compaction caches) audited for cross-invocation persistence and either cleared or partitioned by `tenantId`; `session.task()` sub-agent spawns inherit the originating invocation's `tenantId` binding and cannot be overridden by agent-supplied parameters. Audit method includes a concurrent test (parallel invocations across alternating tenants) — sequential A-then-B is insufficient. (Origin: FR-4a.)
- R12. Mocked-AWS unit tests for the AgentCore Code Interpreter connector at `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` — happy-path `exec` / `readFile` / `writeFile` / `readdir`, edge case `readFile` on missing path, mocked AWS error responses surface to caller. (Residual P2 from spike verdict.)
- R13. Typed `CodeInterpreterStreamOutput` parsing in `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` — replace `Record<string, unknown>` casts with discriminated-union handling on the actual stream event types from `@aws-sdk/client-bedrock-agentcore`. (Residual P3 from spike verdict.)
- R14. First production agent on the Flue runtime: deep researcher with sub-agent fan-out, exercising MCP (search server), `session.task()` (child explore agents), at least one Python script-skill (result formatting), and AgentCore Memory in real conversations. Agent ships in admin and mobile chat; metric capture flows to the existing dashboards from the first invocation. (Origin: 2026-04-26 first-agent commitment + Success Criteria.)
- R15. Plan completion gates on U14 shipping (the deep researcher reaches end users and metric capture confirms instrumentation works). The post-launch ≥2-week DX comparison + production traffic observation lands as a separate operational artifact under `docs/solutions/architecture-patterns/`, owned by Phase 4 follow-up rather than blocking this plan's `status: active → completed` flip. (Origin: Success Criteria, re-scoped per scope-guardian feedback.)
- R16. Worker thread integration unit (split from R7 + R9): finalize the cross-thread MCP fetch interception design (see Open Questions for the three candidate mechanisms) and wire it into the handler. Surfaces token-handle resolution, response-body scrubbing, crash-trace redaction, and the worker-OOM containment posture as a single integrated deliverable. (Origin: FR-3, FR-3a.)

**Origin actors:** A1 Operator, A2 ThinkWork agent (instance), A3 End user, A4 Platform engineer.
**Origin flows:** F1 Operator routes agent to Flue, F2 End-user chat hits Flue runtime, F3 Operator selects sandbox tier, F4 Two-spike validation (FR-9 ✓ done in #783, FR-9a ✓ done in #783).
**Origin acceptance examples:** AE1 (covers FR-1/3/3a/4/4a/4b), AE2 (covers FR-2), AE3 (covers FR-5/6a — Daytona deferred per FR-6a gates), AE4 (covers FR-7), AE5 (FR-9a — already verified in spike).

---

## Scope Boundaries

- **Daytona as a live operator selection** — out at v1. Daytona stays a documented future option per origin FR-6a until its closure gates land (connector data audit, admin-UI disclosure, DPA review, **security review** added per ce-doc-review).
- **Strands runtime retirement or migration** — out (carried from origin). Strands stays default for existing and new agents; operators opt agents in to Flue per agent. Convergence/retirement triggers documented in the Strategic Commitments section below.
- **`session.skill()` API for Python skills** — out (carried from origin FR-7). Skills plumb through `init({ tools })` as `run_skill`. Markdown-prompt-only skills (none today) would be the only candidate for `session.skill()` if introduced later.
- **Skip-AgentCore-container deployment via `flue build --target node` to plain Lambda** — out (carried from origin Scope Boundaries). Captured as a future option only; v1 deploys via the AgentCore container path mirroring Strands.
- **OpenAPI/REST shared admin-ops library refactor** — out (separate brainstorm at `brainstorm/shared-admin-ops` — see memory `project_shared_admin_ops_brainstorm`).
- **Flue SDK source modifications** — out except for CVE workarounds per R10's exception clause.
- **Multi-provider model routing via `pi-ai` to non-Bedrock providers** — out (carried from origin). AWS-native preference holds.
- **Operator-facing runtime tier name change** — out at v1. **Decision (per `feedback_decisive_over_hybrid`): keep `flue` as the operator-facing name for v1.** A future plan can rename to descriptive (`node-typescript`) or hide behind a feature flag if operator-feedback proves it confusing; this plan does not hedge — `flue` ships and operator support material treats it as a stable name.
- **Multi-harness-in-one-container architectures** — out (carried from origin). Each harness is its own AgentCore runtime ID.

### Deferred to Follow-Up Work

- **Daytona connector productionization** (FR-6a's four gates) — separate plan, gated on enterprise-tenant DPA review + security review.
- **`@thinkwork/flue-aws` extraction to upstream Flue contribution** (origin FR-8) — gated on Flue maintainer acceptance and `@flue/sdk` npm publish.
- **OpenTelemetry distro for Node + AgentCore** matching Strands instrumentation surface (origin OQ, carried from 2026-04-26). Separate plan when an observability gap is named — the post-launch observation artifact (R15) flags whether this is needed before Flue can match Strands' AgentCore Eval scoring.
- **Post-launch DX comparison + production observation artifact** — owned by R15 outside this plan's scope.
- **Warm Python subprocess pool / Unix-socket protocol** — origin OQ; introduced only if R5's cold-spawn latency proves user-visible.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-strands/agent-container/container-sources/server.py` — reference for trusted-handler-injection pattern in the existing Python runtime. The Flue handler mirrors this shape end-to-end (resolve secrets at invocation time, mint resources, run loop, post completion).
- `packages/agentcore-pi/agent-container/Dockerfile` + `packages/agentcore-pi/agent-container/src/server.ts` — Node container scaffolding (LWA 0.9.1, `/ping`, `/invocations`) carried forward to the renamed `packages/agentcore-flue/`.
- `packages/agentcore-pi/agent-container/src/runtime/tools/{execute-code,memory_tools,hindsight,mcp,workspace-skills}.ts` — Python-runtime ToolDef equivalents that R5/R6/R7 port to the Flue runtime. The TypeScript implementations already exist for some (the Pi vendoring track was 7 days into building them); inventory what's salvageable in U1.
- `terraform/modules/app/agentcore-runtime/main.tf` — **the actual Strands runtime provisioning pattern** (Lambda + Lambda Web Adapter + ECR repo + IAM role). R2 mirrors this shape for the Flue runtime. (Note: the spike-era plan cited `agentcore-code-interpreter` as the pattern, but that module is an ECR substrate, not a runtime; corrected per ce-doc-review.)
- `packages/api/src/lib/sandbox-preflight.ts` — existing per-tenant interpreter ID resolution (`tenants.sandbox_interpreter_public_id` / `_internal_id` selected by template's `sandbox.environment`); threads `sandbox_interpreter_id` into the chat-agent-invoke payload. R8 consumes this; the runtime container does NOT do its own SSM lookup.
- `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` (merged in #783) — the AgentCore Code Interpreter `SandboxFactory`. R8 consumes it via the existing `interpreterId` option (no new callback needed).
- `packages/api/src/lib/resolve-runtime-function-name.ts` + `packages/database-pg/graphql/types/agents.graphql` — runtime-selector dispatch + GraphQL enum that R3 modifies.
- `packages/database-pg/src/schema/{messages,threads}.ts` — Drizzle thread-history schema; R4's adapter maps Flue `sessionId` ↔ `threads.id`.
- `packages/api/workspace-files.ts` — composed-AGENTS.md derive-skills pattern; relevant for how the Flue runtime discovers the agent's workspace context.
- `terraform/modules/app/lambda-api/handlers.tf` + `terraform/modules/app/lambda-api/variables.tf` + `terraform/modules/thinkwork/main.tf` — the env-var injection chain that wires `AGENTCORE_FUNCTION_NAME` into chat-agent-invoke today; U2 extends this for `AGENTCORE_FLUE_FUNCTION_NAME`.
- `.github/workflows/deploy.yml` — orchestrates the per-runtime container build + push + `aws lambda update-function-code` cycle. U2 + U1 add Flue equivalents to existing Strands + Pi steps.

### Institutional Learnings

- `feedback_avoid_fire_and_forget_lambda_invokes` — Flue handler's completion callback (R9) uses synchronous semantics, surfaces 401s and other errors, no fire-and-forget.
- `feedback_completion_callback_snapshot_pattern` — Flue handler snapshots `THINKWORK_API_URL` + `API_AUTH_SECRET` at agent-coroutine entry; never re-reads `process.env` after the agent turn. R9's design follows this.
- `project_agentcore_deploy_race_env` — AgentCore env-injection race during terraform-apply. R9 mitigates by resolving secrets from Secrets Manager at invocation time, not module load. **Boot-time env reads are wrapped in functions per `feedback_vitest_env_capture_timing` — no module-level `const X = process.env.Y` patterns that lock in `undefined` from a pre-injection boot.**
- `project_agentcore_default_endpoint_no_flush` — `UpdateAgentRuntimeEndpoint` rejects DEFAULT with "managed through agent updates"; the 15-minute reconciler is the only flush. R2's runtime provisioning + future agent-updates flow inherits this constraint.
- `feedback_hindsight_async_tools` — Hindsight's `recall`/`reflect` wrappers must stay async with fresh client + retry. R6's TypeScript port preserves this.
- `feedback_pnpm_in_workspace` — pnpm only, never npm. R10's CI integrity check uses pnpm's lockfile integrity field, not `npm audit signatures`.
- `feedback_decisive_over_hybrid` — when there's a tension (e.g., `pi` selector retire vs alias; `flue` operator-facing name), commit to one side and name the compromise. R3 retires `pi` outright; Scope Boundaries commits `flue` as the v1 name.
- `feedback_github_actions_vars_snapshot_at_trigger` — `vars.X` captured at workflow-dispatch, not step-render. U2's deploy.yml additions set Flue function name as a Terraform output → Lambda env var, not as a GHA `vars.` reference.

### External References

- Flue 0.3.10 source (cloned during the spike at `~/Projects/flue/`) — `packages/sdk/src/{agent,session,sandbox,mcp,roles}.ts`. Authoritative for `SessionStore` / `SandboxFactory` / `ToolDef` / `init()` shapes. **Per the spike, `connectMcpServer` accepts a custom `fetch` parameter — U16's design depends on this surface remaining stable across Flue 0.x bumps; an integration test asserts it.**
- `@aws-sdk/client-bedrock-agentcore` ^3.1028.0 — `BedrockAgentCoreClient`, `InvokeCodeInterpreterCommand`, `StartCodeInterpreterSessionCommand`, `StopCodeInterpreterSessionCommand`, `CodeInterpreterStreamOutput`. Already pinned in `packages/agentcore-pi/package.json` (carried forward via U1's rename).

---

## Key Technical Decisions

- **Rename `packages/agentcore-pi/` → `packages/agentcore-flue/`.** The Pi runtime had no production traffic; the directory is internal-only. Renaming aligns the package name with the operator-visible tier (`flue`) and avoids the dual-naming overhead. Existing scaffolding (Dockerfile, LWA wiring, AWS SDK pins, tests) carries forward; U1's Files list explicitly enumerates the cross-cutting symbolic surface (CI workflows, build-and-push scripts, terraform `moved {}` blocks, lambda-api env wiring, tsbuildinfo cache cleanup).
- **Retire the `pi` runtime selector value rather than aliasing.** Origin FR-2 named the values `strands | flue`. Any pi-pinned dev/test agent record migrates to `flue` (preserving the developer's "try the non-Strands runtime" intent), not `strands`. **Migration runs before code deploy, not after** — the dispatcher rejects unknown values, so the `pi` rows must clear before the new union literal ships.
- **AgentCore Memory + Hindsight as `ToolDef[]`, not MCP servers.** Origin OQ had this open. Decision: `ToolDef` chosen because (a) both surfaces are REST and easy to wrap, (b) avoids deploying a per-tenant MCP-server tier, (c) keeps state lifecycle inside the trusted handler boundary.
- **Aurora `SessionStore` adapter implements Flue's interface directly with explicit schema mapping: Flue `sessionId` ↔ `threads.id` (UUID).** No parallel sessions table. If Flue's interface requires turn/role semantics that thread-history rows don't expose (e.g., compaction-anchor IDs, message-window partition tokens), the adapter introduces a translation layer — but the schema baseline is the existing `threads` + `messages` tables, queried via the existing `idx_messages_thread_id` and `idx_messages_tenant_id_created_at` indices.
- **MCP token-handle isolation via worker_thread (mechanism finalized in U16).** R7's pattern: trusted handler holds bearer tokens; the agent loop runs in a `worker_thread` and receives only token *handles*; the handle resolves to a real bearer at MCP request time on the handler side. Three candidate mechanisms (custom-fetch via async MessageChannel, Atomics.wait synchronous bridge, MCP-on-handler-side proxying) — see Open Questions for the trade-offs and U16 for the resolution.
- **AgentCore CI per-tenant interpreter ID resolved by `chat-agent-invoke`, not by the runtime container.** R8 consumes `sandbox_interpreter_id` from the invocation payload (existing `sandbox-preflight.ts` writes it). The runtime container does NOT reach into SSM — that would widen the IAM scope and contradict FR-4a multi-tenant isolation.
- **AgentCore container hosting (not plain Lambda) for the Flue runtime.** Origin Scope Boundaries kept the plain-Lambda variant as a future option. AgentCore container parity with Strands keeps observability, IAM, and deployment patterns symmetric across runtimes. Implementation note: the existing `terraform/modules/app/agentcore-runtime/main.tf` provisions Strands as a Lambda+LWA function (not a Bedrock AgentCore Runtime resource — that resource type isn't in the AWS provider yet, per `terraform/modules/app/agentcore-memory/`'s comment). U2 follows the Lambda+LWA pattern.
- **`flue` is the v1 operator-facing runtime tier name.** No hedging. Future renames are a separate plan with explicit operator-feedback signal.
- **Plan completion gates on U14 (first agent ships)**, not on the post-launch observation artifact. The 2-week soak is operational, captured in a separate `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-{date}.md` with a minimum-invocation threshold (≥500 turns or extend window) before its own verdict fires.
- **Dual-runtime maintenance is intentional through 2026 Q3.** Strategic Commitments section (below) names convergence/retirement triggers explicitly — this is a deliberate posture, not a path-dependent outcome.

---

## Open Questions

### Resolved During Planning

- **`pi` selector value retirement vs persistence.** Resolved: retire (with a one-time data migration to `flue`). Migration runs before code deploy.
- **`packages/agentcore-pi/` vs `packages/agentcore-flue/`.** Resolved: rename the directory; existing pi-mono substrate stays at `pi-agent-core` 0.70.2 pin.
- **AgentCore Memory + Hindsight surface.** Resolved: ToolDef both. (See Key Technical Decisions.)
- **AgentCore CI per-tenant interpreter resolution.** Resolved: consume `sandbox_interpreter_id` from invocation payload (existing `sandbox-preflight.ts`), no callback or container-side SSM. (See Key Technical Decisions.)
- **AgentCore container vs plain Lambda for v1.** Resolved: AgentCore container, following the existing Lambda+LWA pattern in `agentcore-runtime`. (See Key Technical Decisions.)
- **Operator-facing `flue` tier name.** Resolved: ship as `flue`; no hedging. (See Scope Boundaries.)
- **Aurora SessionStore schema mapping.** Resolved: `sessionId` ↔ `threads.id`; queries on `(tenantId, agentId, threadId)`. (See Key Technical Decisions; translation layer remains plan-time discovery for compaction semantics only.)
- **R15 plan-completion gating.** Resolved: gates on U14 ship; post-launch observation is separate operational artifact.

### Deferred to Implementation

- **U16 worker_thread + token-handle resolution mechanism.** Three candidates with concrete trade-offs:
  1. **Custom-fetch via async MessageChannel** (simplest path; bearer briefly resides in worker memory during MCP request → response window; relies on `connectMcpServer`'s `fetch` parameter staying stable in Flue 0.x).
  2. **Atomics.wait synchronous bridge** (eliminates the bearer-in-worker window but is deadlock-prone with Flue's await-based MCP transport; rejected unless 1 and 3 both fail).
  3. **MCP-on-handler-side proxy** (no Flue source modifications; requires implementing a streamable-HTTP MCP transport adapter that proxies tool calls over the worker boundary; highest implementation cost).
  Decision: U16 starts with #1 + a contract test that fails loudly if a Flue 0.x bump breaks the `fetch` parameter. Falls back to #3 if #1 proves leak-prone in code review. #2 is a non-starter.
- **Aurora `SessionStore` translation-layer scope.** R4 starts with the schema mapping above (sessionId ↔ thread_id). If Flue's `SessionStore` interface requires methods that thread-history rows can't express without a Drizzle schema migration (new column or new table), the work expands to include a `drizzle/NNNN_*.sql` hand-rolled migration with `-- creates: public.X` markers per CLAUDE.md drift-reporter convention. **Surface during U4; if a schema migration is required, raise it as a planning-time decision before continuing.**
- **Concurrent `session.task()` sub-agent AgentCore CI session strategy.** Spike noted that AgentCore CI serializes calls per-session. For sub-agent fan-out, R8's connector spawns fresh sessions per `session.task()` invocation by default (parallelism, more cold starts). Cold-start latency is **not measured in the spike** — fabricated "~hundreds of ms" claim removed. U14 captures real cold-start numbers as a sub-step before declaring the strategy acceptable.
- **Python skill subprocess strategy: cold spawn vs warm worker pool vs Unix-socket protocol.** Origin OQ, carried from 2026-04-26. R5 starts with cold spawn; measure latency in U14 before optimizing.
- **OpenTelemetry distro shape.** Carried from origin OQ; deferred to follow-up work (Scope Boundaries above). Surfaces as a real gap in R15's post-launch artifact if AgentCore Eval scoring on Flue requires X-Ray spans on `aws/spans` (which Strands gets via its IAM `xray:PutTraceSegments` policy and ADOT exporter). U2's IAM role includes `xray:PutTraceSegments`/`PutTelemetryRecords`/`GetSamplingRules`/`GetSamplingTargets` so the wiring path is open even if the Node-side ADOT layer lands as follow-up.
- **Whether the existing `packages/agentcore-pi/agent-container/src/runtime/tools/*.ts` TypeScript ToolDef code is salvageable.** The Pi vendoring track was 7 days into building these; U1 inventories which files (memory_tools.ts, hindsight.ts, mcp.ts, workspace-skills.ts) survive the rename and which need rewrite for Flue's ToolDef contract. Discovery during U1, refactored as part of U5/U6/U7.
- **U10 graceful-degradation for provenance check.** If a transitive in the Flue graph loses provenance (maintainer change, signing key rotation, patch released without `--provenance` flag), CI starts hard-failing on every install. Define a fast soft-pin path: name a documented incident-response RACI (who authorizes hard-fail → warning), pin to the last known-good lockfile version, restore once upstream re-publishes with provenance. U10 documents this.

---

## Output Structure

```
packages/agentcore-flue/                                # renamed from packages/agentcore-pi/
├── package.json                                         # rename @thinkwork/agentcore-pi → @thinkwork/agentcore-flue
├── tsconfig.json
└── agent-container/
    ├── Dockerfile                                       # MODIFY: install Python 3.11 + skill-catalog deps via uv (R5)
    ├── pyproject.toml                                   # NEW: uv project for skill-catalog deps inside the container
    ├── src/
    │   ├── server.ts                                    # NEW: trusted handler entry point (replaces existing Pi server.ts)
    │   ├── handler-context.ts                           # NEW: per-invocation context (tenantId, userId, agent, secrets)
    │   ├── worker-entry.ts                              # NEW: worker_thread agent-loop entry (U16)
    │   ├── sessionstore-aurora.ts                       # NEW: SessionStore impl backed by Drizzle thread-history
    │   ├── tools/
    │   │   ├── run-skill.ts                             # NEW: Python script-skill subprocess ToolDef
    │   │   ├── memory.ts                                # MIGRATE: from agentcore-pi/.../memory_tools.ts (port to ToolDef)
    │   │   ├── hindsight.ts                             # MIGRATE: from agentcore-pi/.../hindsight.ts
    │   │   └── workspace-skills.ts                      # MIGRATE: discover/derive workspace skills from S3
    │   ├── mcp.ts                                       # NEW: MCP wiring with OAuth token-handle isolation glue
    │   └── (other carried-forward files from agentcore-pi/)
    └── tests/
        ├── server.test.ts                               # NEW: handler invocation tests
        ├── sessionstore-aurora.test.ts                  # NEW
        ├── worker-isolation.test.ts                     # NEW (U16): contract tests for token-handle isolation
        ├── integration/
        │   └── tenant-isolation.test.ts                 # NEW (U11): concurrent + sequential isolation
        └── tools/run-skill.test.ts                      # NEW

terraform/modules/app/agentcore-flue/                    # NEW: mirrors agentcore-runtime pattern (Lambda + LWA)
├── main.tf                                              # ECR repo, Lambda function (Image), IAM role
├── variables.tf
├── outputs.tf                                           # exports flue_function_name, flue_function_arn
└── README.md

terraform/modules/app/agentcore-runtime/main.tf          # MODIFY: add `moved {}` blocks for agentcore_pi → agentcore_flue (or delete pi resources entirely if rename is destructive)
terraform/modules/app/lambda-api/handlers.tf             # MODIFY: AGENTCORE_FLUE_FUNCTION_NAME = var.agentcore_flue_function_name
terraform/modules/app/lambda-api/variables.tf            # MODIFY: rename agentcore_pi_* → agentcore_flue_*
terraform/modules/thinkwork/main.tf                      # MODIFY: agentcore_flue_function_name = module.agentcore.agentcore_flue_function_name

packages/flue-aws/connectors/agentcore-codeinterpreter.ts        # MODIFY: U13 typed stream parsing (residual P3)
packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts   # NEW: residual P2 (mocked-AWS unit tests)

packages/database-pg/graphql/types/agents.graphql        # MODIFY: enum AgentRuntime { STRANDS PI } → { STRANDS FLUE }
packages/api/src/lib/resolve-runtime-function-name.ts    # MODIFY: 'strands' | 'pi' → 'strands' | 'flue'; AGENTCORE_FLUE_FUNCTION_NAME env
packages/api/src/graphql/resolvers/agents/runtime.ts     # MODIFY: parseAgentRuntimeInput allow-list
packages/database-pg/drizzle/NNNN_migrate_pi_to_flue.sql # NEW: pre-deploy data migration

.github/workflows/deploy.yml                              # MODIFY: rename agentcore-pi build/push/deploy steps to agentcore-flue
.github/workflows/ci.yml                                  # MODIFY: lockfile integrity verification step (R10)
packages/agentcore/scripts/build-and-push.sh             # MODIFY: rename `pi` case to `flue`

docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-2026-MM-DD.md   # POST-LAUNCH ARTIFACT (R15, separate from plan)
docs/solutions/integration-issues/flue-supply-chain-integrity-2026-MM-DD.md        # NEW (R10): CVE SLA + carveout policy
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Trusted-handler injection pattern (Flue runtime invocation)

```
chat-agent-invoke Lambda
    ↓ resolves agent.runtime → AGENTCORE_FLUE_FUNCTION_NAME
    ↓ calls sandbox-preflight → adds sandbox_interpreter_id to payload
AgentCore Flue runtime container (Node 20 + LWA)
    ↓ /invocations request
trusted-handler (server.ts)
    ↓
    ├── resolve API_AUTH_SECRET from Secrets Manager (FR-4b)
    ├── read sandbox_interpreter_id from invocation payload (R8)
    ├── mint MCP tools (per-user OAuth → token-handle, not bearer) (R7, U16)
    ├── mint Memory + Hindsight ToolDefs (R6)
    ├── mint run_skill ToolDef (R5)
    ├── construct AgentCore CI SandboxFactory via @thinkwork/flue-aws (R8)
    ├── construct Aurora SessionStore keyed on (tenantId, agentId, threadId) (R4)
    ├── construct Bedrock model string (amazon-bedrock/<full-arn-id>)
    └── spawn worker_thread (U16) — pass ToolDef[] + sandbox + sessionStore + model + role + cwd via MessageChannel
            ↓
        @flue/sdk session.prompt() (worker_thread)
            ↓ (any MCP tool call → custom fetch → MessageChannel round-trip)
        trusted-handler resolves token handle → real bearer → egress (response body scrubbed before crossing back)
            ↓
trusted-handler
    ↓
    ├── POST /api/skills/complete with token usage (FR-4b 401 → hard error)
    └── return response
```

### Runtime selector lifecycle

```
operator changes agent.runtime in admin
    → GraphQL mutation validates against AgentRuntime enum (STRANDS | FLUE)
    → Drizzle update writes 'flue' (or 'strands')
    → next chat-agent-invoke reads agent.runtime
    → resolveRuntimeFunctionName dispatches to AGENTCORE_FLUE_FUNCTION_NAME
    → AgentCore runtime ID dispatches to Flue container
```

The data migration `pi → flue` runs before the code deploy that ships the new union literal — by the time `resolveRuntimeFunctionName` rejects unknown values, no `pi` rows exist.

---

## Implementation Units

Phases group units by dependency boundaries. A phase boundary is a natural commit/PR cut point but not a hard ship gate — multiple units within a phase can land independently.

### Phase 1: Foundation (rename + provision + selector)

- U1. **Rename `packages/agentcore-pi/` → `packages/agentcore-flue/`**

**Goal:** Migrate the in-flight scaffolding from the now-superseded `agentcore-pi` directory to `agentcore-flue`, including all cross-cutting symbolic surface (CI workflows, build scripts, Terraform module addresses, env-var wiring). Inventory which `agentcore-pi/agent-container/src/runtime/tools/*.ts` files survive the rename and which need rewrite for Flue's ToolDef contract.

**Requirements:** R1.

**Dependencies:** None.

**Files:**
- Move: `packages/agentcore-pi/` → `packages/agentcore-flue/` (entire directory tree, via `git mv` to preserve history)
- Modify: `packages/agentcore-flue/package.json` (rename `@thinkwork/agentcore-pi` → `@thinkwork/agentcore-flue`)
- Modify: `pnpm-workspace.yaml` (if explicit package list — usually glob-based, may be no-op)
- Modify: any `import from '@thinkwork/agentcore-pi'` across the monorepo
- Modify: `packages/agentcore/scripts/build-and-push.sh` (rename `pi)` case to `flue)`)
- Modify: `.github/workflows/deploy.yml` — rename agentcore-pi filter paths, build-and-push steps (amd64 + arm64), image tags (`pi-latest` → `flue-latest`), `aws lambda update-function-code` step targeting `thinkwork-${stage}-agentcore-pi` → `agentcore-flue`
- Modify: `terraform/modules/app/agentcore-runtime/main.tf` — either delete the `aws_lambda_function.agentcore_pi` resources (rename happens via `agentcore-flue` module in U2 with `moved {}` blocks for state migration) OR keep them inside this module and rename to `agentcore_flue` (decide based on whether the new Flue module supersedes the existing dual-Lambda layout)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (`AGENTCORE_PI_FUNCTION_NAME` → `AGENTCORE_FLUE_FUNCTION_NAME`)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (rename `agentcore_pi_*` variables → `agentcore_flue_*`)
- Modify: `terraform/modules/thinkwork/main.tf` (variable plumbing through to lambda-api module)
- Add: `moved {}` blocks in the Flue module to migrate Terraform state from the old `module.agentcore_pi.*` addresses to `module.agentcore_flue.*` (otherwise destroy + recreate of ECR repo + IAM role)
- Cache cleanup: delete tsbuildinfo files in the renamed package per `feedback_worktree_tsbuildinfo_bootstrap`

**Approach:**
- `git mv` for the directory rename. After rename, run `pnpm install` to regenerate the lockfile entry under the new name. Run `pnpm -r typecheck`. Run a `terraform plan -target=module.agentcore` against dev to confirm `moved {}` blocks produce a no-op (no destroy/create on the renamed resources).
- Document in the PR description which existing tools are being carried forward as-is and which are flagged for U5/U6/U7 ToolDef rewrites.

**Patterns to follow:**
- `packages/agentcore-strands/` directory layout (mirror at the top level).

**Test scenarios:**
- Test expectation: none — pure rename. Behavior verification happens in dependent units.

**Verification:**
- `pnpm install` succeeds with `@thinkwork/agentcore-flue` registered.
- `pnpm -r typecheck` passes (no orphaned imports).
- `git log --follow packages/agentcore-flue/agent-container/Dockerfile` shows the rename history.
- `terraform plan` against dev produces no destroy/create for the renamed Terraform resources (pure `moved` semantics).
- `.github/workflows/deploy.yml` validates as YAML and the new build-and-push step shape matches existing Strands step.

---

- U2. **Provision the `agentcore-flue` AgentCore runtime via Terraform (Lambda + LWA pattern)**

**Goal:** Create a new Terraform module that provisions the Flue runtime as a Lambda+LWA function (mirroring the existing `agentcore-runtime` Strands pattern, NOT the `agentcore-code-interpreter` ECR-substrate pattern). Wire env vars through the existing chain. Make the runtime invokable by `chat-agent-invoke`.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**
- Create: `terraform/modules/app/agentcore-flue/main.tf` (ECR repo, Lambda function with `package_type = "Image"`, IAM role with appropriate permissions, CloudWatch log group)
- Create: `terraform/modules/app/agentcore-flue/variables.tf`
- Create: `terraform/modules/app/agentcore-flue/outputs.tf` (export `flue_function_name`, `flue_function_arn`)
- Create: `terraform/modules/app/agentcore-flue/README.md`
- Modify: `terraform/modules/app/main.tf` (wire the new module; pass region/stage/account_id as inputs)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add `AGENTCORE_FLUE_FUNCTION_NAME = var.agentcore_flue_function_name` env var on chat-agent-invoke handler)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (declare `agentcore_flue_function_name` variable)
- Modify: `terraform/modules/thinkwork/main.tf` (route output from agentcore module to lambda-api module)
- Modify: `.github/workflows/deploy.yml` (add Flue build-and-push + `aws lambda update-function-code` steps mirroring Strands)

**Approach:**
- Pattern source: `terraform/modules/app/agentcore-runtime/main.tf` (the **actual** Strands runtime: Lambda + LWA, not Bedrock AgentCore Runtime). The corresponding existing Pi resources (`aws_lambda_function.agentcore_pi`, log group, ECR repo entry) move to this new module via `moved {}` blocks (or get deleted in U1 if the layout simplifies).
- Container image: from `packages/agentcore-flue/agent-container/Dockerfile` (Node 20 + LWA 0.9.1, with U5's Python additions).
- IAM role permissions (mirroring Strands + adding Flue-specific): `bedrock-agentcore:InvokeCodeInterpreter`, `bedrock-agentcore:StartCodeInterpreterSession`, `bedrock-agentcore:StopCodeInterpreterSession`, `bedrock:InvokeModel*`, `secretsmanager:GetSecretValue` (for `API_AUTH_SECRET`), `s3:GetObject` (for skill catalog), Aurora Data API permissions (for SessionStore), `logs:*`, `xray:PutTraceSegments`/`PutTelemetryRecords`/`GetSamplingRules`/`GetSamplingTargets` (for AgentCore Eval span correlation per the existing `agentcore-runtime` pattern).
- Apply the AgentCore deploy-race mitigations: secrets resolved at invocation time, no module-load env reads, snapshotted per `feedback_completion_callback_snapshot_pattern`.
- The runtime function name becomes `AGENTCORE_FLUE_FUNCTION_NAME` in `chat-agent-invoke`'s env.

**Patterns to follow:**
- `terraform/modules/app/agentcore-runtime/main.tf` (full Lambda+LWA pattern; this is the actual Strands provisioning).
- `terraform/modules/app/lambda-api/handlers.tf` (env-var wiring).
- `.github/workflows/deploy.yml` Strands build-and-push steps as the model for the Flue equivalents.

**Test scenarios:**
- Integration: `thinkwork deploy -s dev` (or the equivalent CI deploy flow) provisions the new Lambda function cleanly. Verify via `aws lambda get-function --function-name thinkwork-${stage}-agentcore-flue`.
- Integration: the new Lambda accepts a synthetic `/ping` request via LWA (health check pattern).
- Integration: `chat-agent-invoke` Lambda's runtime env contains `AGENTCORE_FLUE_FUNCTION_NAME` set to the new function name (verify via `aws lambda get-function-configuration`).

**Verification:**
- Terraform plan shows the new module's resources cleanly with `moved {}` blocks producing no destroy/create on renamed pieces.
- After deploy, `aws lambda get-function --function-name thinkwork-${stage}-agentcore-flue --query 'Configuration.State'` returns `Active`.
- `aws lambda invoke --function-name thinkwork-${stage}-agentcore-flue --payload '{}' /tmp/out.json` returns a valid LWA response (or a typed error from the placeholder server.ts before U9 ships).

---

- U3. **Replace runtime selector value `pi` → `flue` (retire `pi`); migration runs before code deploy**

**Goal:** Update the GraphQL `AgentRuntime` enum, dispatcher, and codegen consumers. Migrate any agent records currently set to `runtime: 'pi'` to `runtime: 'flue'` (developer-intent preservation). **The data migration runs as a deploy.yml step before the API code update**, so the dispatcher never sees a `pi` value it can't route.

**Requirements:** R3. (Origin: FR-2.)

**Dependencies:** U2 (the new Flue runtime function name needs to exist and be wired into chat-agent-invoke env before the dispatcher can route to it).

**Files:**
- Modify: `packages/database-pg/graphql/types/agents.graphql` (enum `AgentRuntime { STRANDS PI }` → `{ STRANDS FLUE }`)
- Modify: `packages/api/src/lib/resolve-runtime-function-name.ts` (`'strands' | 'pi'` → `'strands' | 'flue'`; env reads `AGENTCORE_FUNCTION_NAME` and `AGENTCORE_FLUE_FUNCTION_NAME`)
- Modify: `packages/api/src/graphql/resolvers/agents/runtime.ts` (`parseAgentRuntimeInput` allow-list, `agentRuntimeToGraphql` mapping)
- Create: `packages/database-pg/drizzle/NNNN_migrate_pi_to_flue.sql` (data migration: `UPDATE agents SET runtime = 'flue' WHERE runtime = 'pi'`; same for `agent_templates` if applicable; with `-- creates: public.agents` marker if `db:migrate-manual` drift-reporter requires it)
- Modify: `.github/workflows/deploy.yml` (run the data migration BEFORE the chat-agent-invoke handler update; gate the Lambda update on migration success)
- Run: `pnpm schema:build`
- Run: `pnpm --filter @thinkwork/database-pg db:generate`
- Modify: codegen consumers — `pnpm --filter @thinkwork/{cli,admin,mobile,api} codegen`
- Audit: `apps/admin/src/` and `apps/mobile/src/` for `runtime ===` and `case '` patterns; update any switch/case logic that depends on knowing pi-vs-strands behavior at the UI tier
- Test: `packages/api/src/lib/resolve-runtime-function-name.test.ts`

**Approach:**
- Drizzle's `agents.runtime` column is `text`, so no DB schema migration needed — the data migration SQL is sufficient.
- Migration ordering: `deploy.yml` applies the SQL migration via `pnpm db:push` (or psql for hand-rolled SQL) BEFORE running `aws lambda update-function-code` on chat-agent-invoke. If migration fails, deploy aborts; no risk of code-vs-data skew.
- The data migration's SELECT-and-log step prints affected agentIds before UPDATE, so developers can recover their pi-pinned configs if intent was lost in translation.
- Pre-existing pi-pinned dev/test records → migrate to `flue`. Per `feedback_decisive_over_hybrid`, no aliasing.

**Test scenarios:**
- Happy path: GraphQL `setAgentRuntime(agentId: X, runtime: FLUE)` returns the agent with `runtime: 'flue'` persisted. *Covers AE2.*
- Edge case: passing `runtime: 'PI'` returns a GraphQL validation error (the enum no longer includes `PI`).
- Edge case: pre-existing agent records with `runtime: 'pi'` migrated to `flue` after data migration (logged before update for recovery).
- Integration: `chat-agent-invoke` dispatches to the Flue runtime function name when `agent.runtime === 'flue'`. *Covers AE2.*
- Integration: codegen consumers (admin + mobile) produce no `case 'pi'` references after regeneration.

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` passes.
- After deploy + migration, `SELECT runtime, COUNT(*) FROM agents GROUP BY runtime` returns no `pi` rows.
- Migration step's log output captures the list of migrated agentIds.

---

### Phase 2: Harness Integration (SessionStore, tools, MCP, sandbox, handler shell)

- U4. **Implement Aurora-backed `SessionStore` for Flue with explicit schema mapping**

**Goal:** Implement Flue's `SessionStore` interface against the existing Drizzle thread-history schema. Map Flue `sessionId` ↔ `threads.id` (UUID); keys queries on `(tenantId, agentId, threadId)` using existing indices. Fail closed if `tenantId` absent. If Flue's interface requires methods that thread-history rows can't express, surface as a planning-time decision before continuing.

**Requirements:** R4, R11. (Origin: FR-3, FR-4, FR-4a.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/sessionstore-aurora.ts` (header comment documents the schema mapping verbatim)
- Create: `packages/agentcore-flue/agent-container/tests/sessionstore-aurora.test.ts`
- Modify (potentially): `packages/database-pg/drizzle/NNNN_*.sql` only if a translation layer requires schema changes (escalate first)

**Approach:**
- Read Flue's `SessionStore` signature from `~/Projects/flue/packages/sdk/src/types.ts` (or `dist/types-*.d.mts`) at implementation time.
- Connect to Aurora via the existing data-API pattern (`packages/database-pg/`).
- Schema mapping (header comment in source file):
  - Flue `sessionId` → `threads.id` (UUID)
  - Flue messages → `messages` rows (keyed by `thread_id` → `threads.id`)
  - Tenant scoping: queries always include `WHERE messages.tenant_id = ?` using existing `idx_messages_tenant_id_created_at`
  - Agent scoping: read `threads.agent_id` for additional filtering when SessionStore exposes per-agent operations
- Fail-closed: if `tenantId` is absent from invocation context, throw immediately (caller never gets a session reference).
- If Flue's interface includes methods like `getMessageWindow`, `setCompactionAnchor`, `getPartitionToken` that thread-history rows can't express without schema changes — STOP and escalate as planning-time decision (don't paper over silently).

**Execution note:** Start with a failing integration test that writes one message and reads it back, then implement until green.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` thread-persistence path for the schema mapping reference.
- `packages/database-pg/src/schema/{messages,threads}.ts` for the actual table shape and existing indices.

**Test scenarios:**
- Happy path: write a message under (tenantA, agentX, threadId=S), read the session, message is present. *Covers AE1.*
- Happy path: write three messages across two `agent.session()` calls with the same agentId/sessionId; read returns all three in order.
- Edge case: missing `tenantId` throws immediately (fail-closed).
- Edge case (critical for FR-4a): `(tenantA, agentX, S)` cannot read messages written under `(tenantB, agentX, S)`. *Covers AE1.*
- Error path: Aurora connection failure surfaces as a typed error.
- Integration: write → compaction trigger → read → compacted history reflects the trim (may surface a translation-layer requirement if Flue's compaction needs schema we don't have).

**Verification:**
- All test scenarios pass.
- The adapter implements every method Flue's `SessionStore` interface declares (no partial impls).
- Type-level: `const _: SessionStore = new AuroraSessionStore(...)` typechecks.

---

- U5. **Implement `run_skill` ToolDef for Python script-skills via subprocess (Dockerfile + skill-catalog deps)**

**Goal:** Expose the existing `packages/skill-catalog/` Python script-skills to the Flue agent loop as a single `run_skill` tool. Includes Dockerfile additions to install Python 3.11 + skill-catalog deps inside the container.

**Requirements:** R5. (Origin: FR-7.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/tools/run-skill.ts`
- Create: `packages/agentcore-flue/agent-container/tests/tools/run-skill.test.ts`
- Modify: `packages/agentcore-flue/agent-container/Dockerfile` (install Python 3.11, install `uv`, COPY `packages/skill-catalog/` + `pyproject.toml`, run `uv sync` to install deps)
- Create: `packages/agentcore-flue/agent-container/pyproject.toml` (uv project for skill-catalog deps; mirror Strands' approach in `packages/agentcore-strands/pyproject.toml`)

**Approach:**
- Cold-spawn strategy in v1: each `run_skill` invocation forks a fresh Python subprocess. Cold-start latency observation captured during U14, not pre-decided.
- Skill discovery: the run_skill tool's `description` is built from the available skill manifest (read from S3 skill catalog at handler boot).
- Skill execution: pass skill args as JSON via stdin; subprocess writes JSON result to stdout; non-zero exit is a tool error.
- Dockerfile changes mirror Strands: install Python 3.11 from Debian bookworm packages, install `uv` (preferred per CLAUDE.md), use `uv sync` against the pyproject.toml to install transitive deps. The Strands container's `requirements.txt` or `pyproject.toml` is the model for the dependency list.

**Execution note:** Integration-test against a real skill (calculator); cold-spawn latency is part of the test output.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/Dockerfile` (Python+uv install pattern).
- `packages/agentcore-strands/agent-container/container-sources/server.py`'s skill execution path (semantic reference).

**Test scenarios:**
- Happy path: `run_skill('calculator', { expression: '2 + 3' })` returns 5. *Covers AE4.*
- Happy path: skill manifest lists all skills from S3 catalog; tool description constructed correctly.
- Edge case: unknown skill name → typed error, not a Python crash.
- Error path: skill subprocess exits non-zero → tool returns error result with stderr.
- Error path: skill subprocess hangs → handler times out per Flue's `init({ tools: [{ timeout }] })` setting.
- Integration: a Python skill that imports `boto3` works (AWS credentials inherited from the container's IAM role).

**Verification:**
- All test scenarios pass.
- `run_skill` invocations against the real skill catalog match results from the Strands runtime invoking the same skill.
- Container image size is within reasonable bounds vs Strands (Python install adds ~200-400 MB).

---

- U6. **Implement AgentCore Memory + Hindsight as `ToolDef[]`**

**Goal:** Port the existing Python AgentCore Memory + Hindsight tool wrappers to TypeScript ToolDefs, injected via `init({ tools })`. Preserve async semantics + retry behavior from `feedback_hindsight_async_tools`.

**Requirements:** R6. (Origin: FR-4.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/tools/memory.ts`
- Create: `packages/agentcore-flue/agent-container/src/tools/hindsight.ts`
- Create: `packages/agentcore-flue/agent-container/tests/tools/memory.test.ts`
- Create: `packages/agentcore-flue/agent-container/tests/tools/hindsight.test.ts`

**Approach:**
- AgentCore Memory: REST surface via `@aws-sdk/client-bedrock-agentcore` Memory L2 endpoints. Wrap in a `ToolDef` with descriptive `description` matching the Strands tool's wording.
- Hindsight: HTTP client against the deployed Hindsight endpoint (URL from env). The `recall` and `reflect` wrappers stay async-shaped per `feedback_hindsight_async_tools` — fresh client per invocation, retry on transient failures, aclose on completion. Docstring chain: `recall`'s description includes the REQUIRED FOLLOW-UP `reflect` instruction per `feedback_hindsight_recall_reflect_pair`.
- Both tools take `(tenantId, userId)` from the trusted handler's invocation scope; no agent-supplied tenant override.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/memory_tools.py` (semantics).
- `packages/agentcore-strands/agent-container/hindsight_tools.py` (async pattern).
- `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts` if salvageable from U1's inventory.

**Test scenarios:**
- Happy path (memory): `recall(query='test')` returns a list of records.
- Happy path (memory): `retain(content='note')` writes a record discoverable by subsequent `recall`.
- Happy path (hindsight): `recall(query='test')` returns ranked records; `reflect(record_ids)` updates relevance.
- Edge case: missing tenantId/userId → tool throws before HTTP call.
- Error path: Hindsight HTTP 5xx → retry per `feedback_hindsight_async_tools`; final failure surfaces as tool error.
- Integration: AgentCore Memory and Hindsight write to different stores; cross-recall confirms independence.

**Verification:**
- Tool descriptions match the Strands equivalents.
- Async semantics: `recall` and `reflect` are reachable from the agent loop without blocking the event loop.

---

- U7. **MCP wiring via Flue's `connectMcpServer` (handle-shaped headers; isolation finalized in U16)**

**Goal:** Implement the MCP integration: trusted handler constructs ToolDefs via `connectMcpServer`, headers carry token *handles* (not bearers). The actual cross-thread fetch interception + bearer resolution + response-body scrubbing is finalized in U16; this unit owns the MCP-client wiring + handle minting.

**Requirements:** R7. (Origin: FR-3, FR-3a.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/mcp.ts` (MCP server connection + token-handle minting)
- Create: `packages/agentcore-flue/agent-container/tests/mcp.test.ts`

**Approach:**
- Trusted handler maintains a `Map<TokenHandle, OAuthBearer>` keyed by ephemeral handle IDs (generated via `crypto.randomUUID()`).
- `connectMcpServer({ url, headers: { Authorization: 'Handle ${handle}' } })` is called in the trusted handler (NOT inside the worker thread); produces ToolDefs that carry only handles in their serialized form.
- ToolDef serialization contract: a contract test asserts `JSON.stringify(toolDefs)` contains only handles, never bearers.
- The custom-fetch interception (where the handle resolves to a bearer at egress) is implemented in U16 alongside the worker_thread split.

**Execution note:** Test-first — start with a contract test that asserts no bearer tokens leak into ToolDef serialization. Implement until green.

**Patterns to follow:**
- `packages/agentcore-pi/agent-container/src/runtime/tools/mcp.ts` if salvageable from U1's inventory.
- Flue's MCP example in `~/Projects/flue/examples/hello-world/.flue/agents/with-tools.ts`.
- `feedback_verify_wire_format_empirically` — verify MCP request shape against a test server before relying on it.

**Test scenarios:**
- Contract: `JSON.stringify(toolDefs)` produced by `connectMcpServer` with handle-shaped Authorization contains the handle string and no bearer-shaped strings.
- Happy path: handle minting + handle map round-trip (mint, store, look up, retrieve bearer).
- Edge case: handle expires (not in map) → resolution returns a typed auth-failure error.

**Verification:**
- All test scenarios pass.
- Bearer-shape regex grep across ToolDef serializations returns zero matches.

---

- U8. **Wire AgentCore Code Interpreter via `@thinkwork/flue-aws` connector (consume `sandbox_interpreter_id` from invocation payload)**

**Goal:** Use the connector merged in #783 as the default sandbox. Trusted handler reads `sandbox_interpreter_id` from the invocation payload (set by `packages/api/src/lib/sandbox-preflight.ts`) and instantiates the connector with that ID — no callback, no SSM lookup from the runtime container.

**Requirements:** R8. (Origin: FR-5.)

**Dependencies:** U1.

**Files:**
- Modify: `packages/agentcore-flue/agent-container/src/server.ts` (handler reads `payload.sandbox_interpreter_id` and passes to `agentcoreCodeInterpreter(client, { interpreterId })`)
- (No changes to `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` — the existing `interpreterId` option suffices)

**Approach:**
- Trusted handler signature: `payload: { tenantId, agentId, threadId, sandbox_interpreter_id, ... }`.
- Validation: if `sandbox_interpreter_id` is absent, return a typed error to chat-agent-invoke (sandbox-preflight should always populate it; absence is a contract violation upstream).
- `session.task()` sub-agent strategy: each `task()` calls `SandboxFactory.createSessionEnv()` → fresh AgentCore CI session via `StartCodeInterpreterSession`. Cold-start latency captured in U14.

**Patterns to follow:**
- `packages/api/src/lib/sandbox-preflight.ts` (canonical per-tenant resolution).
- `packages/api/src/handlers/chat-agent-invoke.ts` (how the payload field is set).

**Test scenarios:**
- Happy path: handler receives `payload.sandbox_interpreter_id` = 'thinkwork_dev_0015953e_pub-...'; constructs connector; agent loop runs cleanly.
- Edge case: missing `sandbox_interpreter_id` → handler returns 400 with typed error (no orphaned session).
- Integration: two parallel `session.task()` invocations create two separate AgentCore CI sessions (verify via `aws bedrock-agentcore-control list-code-interpreter-sessions`).

**Verification:**
- All test scenarios pass.
- A real-AWS smoke from the handler invokes the dev-account interpreter and returns a clean response.

---

- U9. **Implement Flue agent handler shell (server.ts entry point)**

**Goal:** Implement the trusted-handler shell at `packages/agentcore-flue/agent-container/src/server.ts`: parse `/invocations`, resolve secrets at invocation time (per `feedback_completion_callback_snapshot_pattern`), assemble per-invocation context, mint resources from U4-U8, dispatch to the worker thread (the worker integration is finalized in U16). POSTs `/api/skills/complete` on completion; 401 surfaces as hard error.

**Requirements:** R9. (Origin: FR-3, FR-4, FR-4b.)

**Dependencies:** U2, U3, U4, U5, U6, U7, U8.

**Files:**
- Modify (replace): `packages/agentcore-flue/agent-container/src/server.ts`
- Create: `packages/agentcore-flue/agent-container/src/handler-context.ts` (per-invocation context: tenantId, userId, agent, secrets)
- Create: `packages/agentcore-flue/agent-container/tests/server.test.ts`

**Approach:**
- Handler shape mirrors `packages/agentcore-strands/agent-container/container-sources/server.py` end-to-end.
- Secrets resolution: `API_AUTH_SECRET` from Secrets Manager via `@aws-sdk/client-secrets-manager` AT INVOCATION TIME, snapshotted, never re-read. Handler also wraps `THINKWORK_API_URL` and other env reads in functions per `feedback_vitest_env_capture_timing` to avoid module-load capture of pre-injection `undefined`.
- Worker dispatch: the handler creates resources but the actual `worker_thread.spawn(...)` integration with token-handle resolution is in U16; this unit ships with a placeholder dispatch (e.g., calls `init()` directly without worker isolation as a temporary path so U9 is testable independently).
- Completion callback: `POST /api/skills/complete` with snapshotted secret; 401 throws (per `feedback_avoid_fire_and_forget_lambda_invokes`); other failures retry with backoff. Error logging redacts the Authorization header value (CloudWatch log redaction or structured logger that omits known-sensitive fields).

**Execution note:** Integration-test the handler against a deployed dev runtime after U2's terraform applies.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` end-to-end.
- `feedback_completion_callback_snapshot_pattern`, `feedback_avoid_fire_and_forget_lambda_invokes`, `feedback_vitest_env_capture_timing`.

**Test scenarios:**
- Happy path: `/invocations` request with valid agent runtime + tenantId returns a response. *Covers AE1.*
- Happy path: completion callback POSTs with the right shape (skill_run_id, status, token_usage, latency).
- Edge case: missing tenantId → 400 with typed error.
- Edge case: Secrets Manager unreachable → 500 with retry-after.
- Error path: `/api/skills/complete` returns 401 → handler throws; force-401 test case asserts CloudWatch log contains no string matching the secret. *Covers FR-4b.*
- Integration: tested with placeholder direct-`init()` dispatch; U16 will swap in the worker integration.

**Verification:**
- All test scenarios pass.
- A test invocation completes end-to-end through chat-agent-invoke after U2 terraform deploy.
- CloudWatch log for a forced-401 invocation contains no bearer-shaped or secret-value strings.

---

### Phase 3: Productionization (boundary controls + spike residuals)

- U10. **Supply-chain integrity in CI (FR-3a) with graceful-degradation**

**Goal:** Add lockfile integrity verification to CI for `@flue/sdk` and its transitive graph. Document the 48-hour CVE response SLA, the FR-1/FR-3 carveout, and the graceful-degradation path when a transitive loses provenance.

**Requirements:** R10. (Origin: FR-3a.)

**Dependencies:** None.

**Files:**
- Modify: `.github/workflows/ci.yml` (add lockfile integrity step using pnpm's built-in `--frozen-lockfile` integrity check + an explicit verification of the `integrity:` field for the four named transitives)
- Create: `docs/solutions/integration-issues/flue-supply-chain-integrity-2026-MM-DD.md` (CVE response SLA, carveout policy, graceful-degradation RACI, distinct trust-tier handling for `@mariozechner/*` packages)
- Create or modify: `scripts/verify-supply-chain.sh` (the actual verification helper called by CI; specify the tooling concretely — pnpm lockfile integrity, no `npm audit signatures` since this workspace forbids npm)

**Approach:**
- pnpm lockfile already includes `integrity:` SHA hashes per package version. CI verifies these match on `pnpm install --frozen-lockfile`. For `@flue/sdk`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@modelcontextprotocol/sdk`, `just-bash`, the script compares the lockfile's pinned hash against the version actually installed.
- Distinct trust tiers documented in the SLA doc:
  - `@flue/sdk`, `@modelcontextprotocol/sdk`: lockfile integrity is the primary control.
  - `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`: lockfile integrity + manual upgrade-review gate (every version bump requires changelog + diff review by named reviewer before merge).
- 48h CVE SLA + carveout: a CVE workaround that requires Flue source modification is permitted as an exception to FR-1/FR-3, provided (a) submitted upstream concurrently, (b) fork retired within 30 days of upstream acceptance OR within 90 days of upstream NACK, whichever fires first.
- Graceful-degradation: if a transitive loses provenance/integrity (maintainer change, signing rotation), CI hard-fails. Fast soft-pin path: lock the integrity field to the last-known-good SHA in `pnpm-lock.yaml`, restore once upstream re-publishes. Named RACI for who authorizes the conversion (default: any platform engineer, with a posted note).

**Patterns to follow:**
- Existing `.github/workflows/ci.yml` shape.
- `docs/solutions/workflow-issues/` formatting.

**Test scenarios:**
- Happy path: CI passes integrity verification with the current lockfile.
- Failure path: a synthetic mismatched integrity hash (test fixture) fails the verification step.

**Verification:**
- CI workflow includes the integrity step and runs successfully on this plan's PR.
- The SLA + degradation doc is discoverable from the brainstorm's FR-3a section.

---

- U11. **Multi-tenant isolation audit (FR-4a) with concurrent test**

**Goal:** Verify the multi-tenant isolation invariants hold under audit AND under concurrent load. Sequential A-then-B tests are insufficient — add a concurrent-interleave test that catches races in module-level Flue state.

**Requirements:** R11. (Origin: FR-4a.)

**Dependencies:** U4, U7, U9, U16.

**Files:**
- Create: `packages/agentcore-flue/agent-container/tests/integration/tenant-isolation.test.ts`
- Modify (if audit reveals gaps): the relevant tool, sandbox, or sessionstore files

**Approach:**
- Audit checklist (header comment in test file with one-line pass/fail per item):
  1. Aurora `SessionStore` (U4): all queries scope on tenantId; no shared connection pool.
  2. MCP wiring (U7): no module-level `Map<endpoint, MCPClient>` cache.
  3. AgentCore CI connector (U8): each `createSessionEnv()` returns a fresh API instance.
  4. Compaction (Flue's built-in): if state caches across invocations, partition by tenantId.
  5. `session.task()`: trusted handler sets the worker tenantId; tasks inherit, can't be overridden.
- **Concurrent isolation test (new per ce-doc-review):** spawn N=10+ simultaneous invocations against a single container instance with alternating tenant IDs; each invocation writes a unique sentinel; assert no cross-tenant sentinel visibility. Use `Promise.all` against the container's `/invocations` endpoint OR a tool like `autocannon`.
- Sequential test still runs (catches obvious A→B leaks).

**Test scenarios:**
- Sequential isolation: write sentinel via `session.shell` under tenant A; switch to tenant B; sentinel not visible.
- Sequential isolation: spawn `session.task()` sub-agent that attempts to read tenant B's data via Aurora SessionStore — fails because worker's tenantId is A.
- Sequential isolation: agent-supplied tenantId override (prompt injection) does not affect SessionStore queries.
- **Concurrent isolation:** N=10+ parallel invocations with alternating tenants; each writes a unique sentinel; `find-and-read` reveals no cross-tenant matches.
- Audit grep: `git grep -l 'new Map' packages/agentcore-flue/agent-container/src/` → all hits are per-invocation, not module-level.

**Verification:**
- All scenarios pass.
- Audit checklist documented in test file header with explicit pass/fail per item.

---

- U12. **Mocked-AWS unit tests for AgentCore CI connector (residual P2)**

**Goal:** Add the unit tests deferred from spike U2: vitest scenarios against a mocked `BedrockAgentCoreClient`.

**Requirements:** R12. (Residual P2 from FR-9a verdict.)

**Dependencies:** None.

**Files:**
- Create: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts`

**Approach:**
- Use `aws-sdk-client-mock` (already a dev dep in `packages/agentcore-pi/`) to mock `BedrockAgentCoreClient`.
- Cover the cases listed in spike plan U2's Test scenarios (verbatim source).

**Patterns to follow:**
- Spike plan: `docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md` U2 Test scenarios.
- `aws-sdk-client-mock` usage in `packages/agentcore-pi/agent-container/tests/`.

**Test scenarios:** (the unit tests themselves are the deliverable)

**Verification:**
- `pnpm --filter @thinkwork/flue-aws test` runs and all scenarios pass.

---

- U13. **Typed `CodeInterpreterStreamOutput` parsing (residual P3)**

**Goal:** Replace the `Record<string, unknown>` casts in `consumeStream` with discriminated-union handling on the actual `CodeInterpreterStreamOutput` type from `@aws-sdk/client-bedrock-agentcore`.

**Requirements:** R13. (Residual P3 from FR-9a verdict.)

**Dependencies:** None.

**Files:**
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.ts`
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` (regression coverage)

**Approach:**
- Read `CodeInterpreterStreamOutput` from `node_modules/@aws-sdk/client-bedrock-agentcore/dist-types/models/models_0.d.ts`.
- Replace the cast-based parse with discriminated-union handling.

**Patterns to follow:**
- The `@aws-sdk/client-bedrock-agentcore` types as authoritative.

**Test scenarios:**
- Regression: all U12 mocked tests still pass.
- Type-level: connector source typechecks with `strict: true`; no `as Record<string, unknown>` on stream events.

**Verification:**
- `pnpm --filter @thinkwork/flue-aws typecheck` and `test` both pass.

---

- U16. **Worker thread integration: token-handle resolution + response scrubbing + crash redaction** *(NEW unit, split from R7+R9 per coherence/scope-guardian feedback)*

**Goal:** Finalize the worker_thread split: spawn the worker, route MCP fetch requests through the trusted handler via custom-fetch + MessageChannel, scrub MCP response bodies for bearer-shaped strings before crossing back to the worker, install crash-trace redaction. This is the "make the U7+U9 design real" unit.

**Requirements:** R16, R7. (Origin: FR-3a, FR-4a.)

**Dependencies:** U7, U9.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/worker-entry.ts` (worker_thread agent-loop entry point)
- Modify: `packages/agentcore-flue/agent-container/src/server.ts` (replace U9's placeholder direct-`init()` dispatch with the worker spawn + MessageChannel wiring)
- Modify: `packages/agentcore-flue/agent-container/src/mcp.ts` (custom fetch implementation that proxies through MessageChannel)
- Create: `packages/agentcore-flue/agent-container/tests/worker-isolation.test.ts`

**Approach:**
- Mechanism choice (plan-time decision per Open Questions C2): start with **#1 — async-fetch via MessageChannel**. The bearer briefly resides in worker memory during the MCP request → response window; this is documented as accepted risk and offset by the response-body scrubbing + log redaction.
- Custom fetch passed to `connectMcpServer({ url, headers, fetch: customFetch })`. The customFetch runs in the worker; on each request it posts a `MessageChannel` message to the handler with the handle, awaits the resolved bearer, fires the actual fetch, scrubs response body for bearer-shaped strings (regex `Bearer [A-Za-z0-9._-]{20,}` and the active bearer's literal value), returns to the worker.
- Contract test: mock an MCP server that returns a 401 with the bearer reflected in the response body. Assert the bearer does NOT appear in: SessionStore.serialize() output, CloudWatch logs (via test-time log capture), or worker thread memory after the response.
- Crash redaction: `unhandledRejection` and `uncaughtException` handlers in worker-entry.ts serialize crash context through a scrubbing function before posting to the handler's error channel. Handler-side log writer applies the same regex on output.
- Worker OOM containment: set `--max-old-space-size` for the worker thread; main thread catches `'exit'` event and returns 500 to the orchestrator. Container-level OOM (whole process) is a separate concern; U2's terraform allocates enough memory to make worker-OOM the more likely failure mode than container-OOM.
- Integration test asserts a Flue 0.x bump that removes the `fetch` parameter on `connectMcpServer` would fail loudly (test imports the parameter explicitly).

**Execution note:** Test-first — start with the failing bearer-leak contract test from U7's prep, then implement until green. The crash-redaction test cases come second.

**Patterns to follow:**
- Node `worker_threads` + `MessageChannel` standard usage.
- Flue's MCP example with custom `fetch` parameter (per `~/Projects/flue/packages/sdk/src/mcp.ts`).

**Test scenarios:**
- Happy path: agent calls an MCP tool; tool fires HTTP via custom fetch; bearer resolved on handler side; response scrubbed; agent sees clean response.
- Happy path: simultaneous MCP calls from different agents in the same container don't cross-contaminate handles.
- Edge case: handle expires (handler restarts mid-session) → MCP call returns typed auth-failure error.
- Error path: MCP server returns 401 with bearer reflected in body → response scrubbed; SessionStore.serialize() contains no bearer; CloudWatch log contains no bearer.
- Error path: worker thread OOM → main thread returns 500; crash trace contains no handle context, bearer, or sensitive payload.
- Contract test: Flue's `connectMcpServer` accepts a `fetch` parameter (asserted via TypeScript import + runtime call); guards against silent breakage on Flue 0.x bumps.

**Verification:**
- All scenarios pass.
- Bearer-shape regex grep across all CloudWatch logs from a forced-leak test: zero matches.
- Worker OOM test: container survives, main thread returns 500, no orphaned worker.

---

### Phase 4: First agent + plan completion

- U14. **Flue runtime serves a real chat turn end-to-end; smoke gate at deploy time**

**Goal:** Validate the Flue runtime end-to-end against a real deployed agent. The original framing ("deploy the deep researcher") was never load-bearing — the deep researcher was the example agent the 2026-04-26 brainstorm used to motivate validation, not an actual product priority. This unit closes when Flue runs a real chat turn against any agent in dev AND a deploy-time smoke gate prevents silent regressions.

**Requirements:** R14. (Origin: 2026-04-26 first-agent commitment, re-scoped 2026-05-05 — see Re-scope note below.)

**Dependencies:** U2, U3, U6, U7, U8, U9, U16 (the chat turn exercises every Phase 2 unit + worker integration).

**Files:**
- `packages/api/src/__smoke__/flue-marco-smoke.ts` (NEW; PR #827) — invokes the deployed Flue Lambda with a populated payload mirroring chat-agent-invoke's shape; asserts USER.md fingerprint in `response.content`.
- `scripts/post-deploy-smoke-flue.sh` (NEW; PR #827) — wrapper following `scripts/post-deploy-smoke-fat-folder.sh` pattern.
- `.github/workflows/deploy.yml` (modified; PR #827) — `flue-smoke-test` job, `needs: [update-agentcore-runtimes]`, gated `STAGE == 'dev'`.
- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` (renamed from `flue-deep-researcher-launch-...`, body rewritten 2026-05-05).

**Approach:**
- Deploy via the standard merge → `Deploy` workflow path. AgentCore runtime image build + image push handled by `update-agentcore-runtimes` job.
- A real chat turn against the dev tenant validates: LWA routing, Bedrock IAM, Sonnet 4.5 inference-profile prefix, workspace prompt loader, `pi-agent-core` Agent loop, runtime payload contract.
- The smoke gate makes silent regressions in any of those layers a deploy-blocker rather than an operator-noticed wrong answer.

**Re-scope note (2026-05-05):**

The original U14 wording bundled "validate Flue works" with "ship the deep researcher agent." On 2026-05-05 the validation half landed via Marco (a Default-template agent) + the shipped smoke gate — Marco answered through Flue with real tokens, the smoke now blocks any deploy where Flue can't answer with USER.md context.

The "deep researcher" half — seeding a specific agent template, instrumenting `session.task()` cold-start, capturing p50/p95/p99, comparing eval scores against Strands — was unwound: the deep researcher was never a real product priority (the project owner did not recognize the name when asked), the cold-start instrumentation requires code that was never written, and the eval comparison requires running AgentCore Evaluations on an agent that does not exist. The 2-week DX comparison + production observation deliverable continues as a separate operational artifact (per the existing Phase 4 follow-up below) and stays out of plan completion.

**Patterns to follow:**
- Existing post-deploy smoke at `scripts/post-deploy-smoke-fat-folder.sh` + `packages/api/src/__smoke__/fat-folder-smoke.ts`.

**Test scenarios:**
- Happy path: deployed Flue Lambda returns non-empty `response.content` containing USER.md fingerprint for Marco (default agent in dev).
- Edge case: smoke detects empty `response.content` even when token count is non-zero (catches silent ValidationException / AccessDenied that pi-agent-core swallows).
- Edge case: smoke detects `totalTokens === 0` (catches Bedrock not invoked at all).
- Edge case: smoke detects fingerprint mismatch (catches workspace prompt loader regressing to the pre-PR-#820 state).

**Verification:**
- Marco answers through Flue with USER.md context (validated 2026-05-05; smoke run captured `Your name is Eric Odom.` 4230 tokens model=us.anthropic.claude-sonnet-4-5-20250929-v1:0).
- The `flue-smoke-test` GitHub Actions job runs after every deploy and exits 0; failure makes the deploy workflow red.

---

### Phase 4 follow-up (separate from plan completion)

The DX comparison + 2-week production observation deliverable lands as a separate operational artifact at `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-{date}.md`, NOT as a plan unit. Owners track it post-launch:
- Sections: prompt visibility, dispatch ergonomics, debugging, customization headroom, observability fidelity (especially OTel/X-Ray parity for AgentCore Eval scoring), trusted-handler-injection ergonomics.
- Metric capture: token usage, completion success rate, latency p50/p95, AgentCore Eval scores. **Minimum threshold for the verdict to fire: ≥500 turns OR extend the observation window beyond 2 weeks if traffic is sparse.**
- Verdict outcome: did the reframe pay off? Triggers a Strategic Commitments review (see below) regardless of direction.

---

## Open Security Questions

Surfaced from the 2026-05-03 ce-doc-review security-lens pass; integrated into U7/U9/U10/U11/U16 design or carried as policy:

- **MCP error-reflection bearer leak.** A misconfigured or attacker-controlled MCP server could reflect bearer values in response bodies. Mitigation: response-body scrubbing in U16's custom fetch + contract test. Open question: do we also need an outbound-bearer audit (handler logs bearer-fingerprint hashes pre-egress so we can correlate post-hoc if a leak is suspected)? Defer to U16 implementation.
- **Aurora row-level security as defense-in-depth.** Plan currently relies on JS-layer `tenantId` checks in the SessionStore adapter. Defense-in-depth would add Aurora RLS policies (`tenantId = current_setting('app.tenant_id')`). Open question: does Aurora Serverless Data API support RLS via session parameters? If yes, add as U4 sub-step. If no, document as accepted risk + monitor for an Aurora feature update.
- **CVE fork max-lifetime on upstream NACK.** R10's carveout covers the upstream-accept path (30-day retire). NACK path now bounded at 90 days; after 90 days, security team evaluates: replace dep, promote fork to maintained internal package with explicit owner, OR remove gated feature. Documented in U10's SLA doc.
- **Pi sub-dep trust domain (single-author).** `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` are pre-1.0 single-author packages — distinct trust domain from `@flue/sdk`. R10 adds a manual upgrade-review gate for these specifically. Open: do we need an additional code-review-required CI check on PRs that bump these versions? Defer to U10 implementation.
- **Crash-trace + log redaction for worker thread.** U16 implements scrubbing for bearer-shaped strings; same pattern extends to handle context, internal state. Open question: do we need CloudWatch Logs subscription filters (regex-based) as a backstop in case in-process redaction misses a path? Defer to a security review post-launch if any near-miss surfaces in U16's contract tests.
- **AgentCore CI cross-tenant filesystem isolation.** Spike confirmed per-session isolation but did NOT test concurrent two-tenant sessions on the SAME interpreter. U11's concurrent isolation test exercises this. If the test surfaces a leak, the plan blocks on per-tenant interpreter provisioning before U14 ships.
- **`/api/skills/complete` 401 logging redaction.** U9 explicitly tests that a forced-401 invocation produces no bearer-shaped or secret-value strings in CloudWatch logs.
- **Worker OOM blast radius.** U16 specifies `--max-old-space-size` for the worker; U2's terraform allocates container memory generously enough to make worker-OOM the dominant failure mode (not container-OOM that kills neighboring tenant invocations). Open question: AgentCore container reuse semantics — does AgentCore pool one container across tenant invocations, or one container per invocation? If pooled, worker-OOM containment is critical; if per-invocation, less so. Confirm during U2's terraform plan review.

---

## System-Wide Impact

- **Interaction graph:** New AgentCore runtime function name joins the dispatch path. `chat-agent-invoke` already supports per-call runtime selection; U3 extends the dispatcher. Completion callback path unchanged.
- **Error propagation:** Handler resolves secrets at invocation time and surfaces all errors synchronously. 401 from completion callback → hard error. MCP token-handle resolution failures → typed errors to the agent loop. Worker OOM → 500 to chat-agent-invoke.
- **State lifecycle risks:** AgentCore CI sessions per-invocation cleaned via `cleanup: true`. `session.task()` sub-agents spawn fresh sessions. MCP connection pools NOT module-level (audited per U11). Aurora SessionStore connections per-invocation.
- **API surface parity:** Strands runtime stays unchanged. Completion-callback contract, AgentCore Memory + Hindsight surfaces, `/api/skills/complete` shape reused. Operator-facing API change: the runtime selector enum (R3). Codegen consumers (admin, mobile, cli, api) regenerated; switch/case logic audited per U3.
- **Integration coverage:** Aurora SessionStore + AgentCore CI + Bedrock + MCP + Python skill subprocess + completion callback all need to compose. U9 + U11 + U14 + U16 collectively exercise the full stack.
- **Unchanged invariants:** Strands runtime behavior, completion-callback contract, AgentCore Memory + Hindsight backing stores, S3 skill catalog format, AGENTS.md composition rules, agent record schema (other than the runtime enum).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Flue's `SessionStore` interface requires turn-level semantics that thread-history rows don't expose | U4 starts with the explicit schema mapping (sessionId ↔ thread_id); if Flue requires schema-level additions (compaction-anchor IDs, partition tokens), U4 escalates as a planning-time decision before continuing — does NOT silently land a partial impl. |
| AgentCore CI cold-start latency for `session.task()` sub-agents becomes user-visible | **Real measurement is part of U14's deliverable** (replaces the fabricated "~hundreds of ms" claim from earlier drafts). If p95 latency regresses meaningfully vs Strands, U8 revisits the per-task vs shared-session strategy with concrete numbers. |
| Worker_thread + token-handle resolution mechanism (U16) hits an unforeseen Flue API break | U16 includes a contract test that imports `connectMcpServer`'s `fetch` parameter explicitly; CI fails loudly on a Flue 0.x break. Fallback to mechanism #3 (MCP-on-handler-side proxy) documented in Open Questions. Mechanism #2 (Atomics.wait synchronous) is rejected as deadlock-prone. |
| Flue ships a breaking change to `init()` / `SessionStore` / `SandboxFactory` / `ToolDef` mid-development | FR-10a tripwires (origin) — pinned `@flue/sdk` version in lockfile, monthly upgrade cadence, integration-test suite is the gate. U10 enforces lockfile integrity. |
| `chat-agent-invoke`'s runtime-selector dispatcher already supports a 3-way switch | Resolved: U3's edits to `resolveRuntimeFunctionName.ts` are additive (new env var + new union literal); the existing 2-way conditional becomes a 3-way switch via straightforward extension. Verified by reading the source file. |
| Multi-tenant isolation gap discovered post-launch in production | FR-4a guards (U11 audit + concurrent-test + sequential-test) front-load discovery. Per-agent rollback via runtime selector is the production remediation path. |
| Python skill subprocess cold-spawn latency (each `run_skill` call) exceeds budget | Origin OQ deferred to implementation. U5 starts with cold spawn; U14 measures and the post-launch artifact captures. Optimization (warm pool, Unix socket) lands as follow-up if needed. |
| The post-launch 2-week observation surfaces a deal-breaker (compaction misbehavior, observability gap, eval-score regression) | The artifact captures the gap; runtime selector means existing Strands agents are unaffected. Strategic Commitments section's convergence/retirement triggers fire. |
| Flue's pre-1.0 status causes a security CVE during production | FR-3a (U10) carveout: security patch may be applied to a ThinkWork fork without upstream merge first; bounded by the 30-day-after-accept OR 90-day-after-NACK retirement clauses. 48h CVE response SLA. |
| **First-agent-on-parallel-runtime couples two bets (deep researcher × Flue validation)** | Mitigation: deep researcher's tool surface (search MCP, Python format skill, AgentCore Memory, `session.task()` sub-agents) is portable enough that an emergency rollback to Strands is feasible (per-agent runtime selector flip). U14's launch doc explicitly captures the rollback playbook. The opportunity-cost concern is real but accepted: Flue needs a real-traffic agent to validate the reframe. |
| **Operator-facing `flue` name proves confusing post-launch** | Accepted risk — committed in Scope Boundaries. If U14's launch doc + post-launch operator support flag confusion, a separate plan addresses naming. The decision is path-acceptable: better than indefinite hedge. |
| **Dual-runtime maintenance overhead drains team capacity** | Strategic Commitments section names the convergence/retirement triggers explicitly. Quarterly review re-evaluates posture. |

---

## Strategic Commitments

This plan commits ThinkWork to maintaining two production AgentCore runtimes (Strands + Flue) **through 2026 Q3** as a deliberate posture, not a path-dependent outcome. Operations cost is named, accepted, and time-bounded.

### Convergence / retirement triggers

The dual-maintenance posture is re-evaluated when any of these fire:

1. **Flue outperforms Strands materially** in the post-launch observation artifact (eval-score parity OR latency wins OR DX-team-velocity wins) → trigger a separate plan to migrate Strands agents to Flue and retire the Strands runtime container. Estimated 1-quarter migration window.
2. **One runtime becomes unmaintainable upstream** — Flue archived, Pi sub-deps abandoned, Strands deprecated by AWS, etc. → trigger a separate plan to retire the affected runtime; remaining runtime absorbs all agents.
3. **Team capacity drops below 2-runtime sustainability** (e.g., engineering team contracts, or 60%+ of agent-runtime PRs require dual-runtime work) → trigger a quarterly review with explicit options: pause Flue feature parity, accept-and-document divergence, OR retire the underused runtime.
4. **2026 Q3 review** (calendar-driven): even if no trigger fires, evaluate the dual-maintenance posture explicitly. The default outcome is "continue dual maintenance" but the review forces a deliberate decision.

### Tool-surface drift owner

Memory + Hindsight + run_skill ToolDef descriptions are kept in sync between Strands (Python) and Flue (TypeScript) by the platform-engineer team. Drift surfaces as agent-prompt regressions when an operator flips between runtimes. Drift-detection is part of the post-launch observation artifact.

---

## Documentation / Operational Notes

- **Deploy ordering:** the data migration in U3 runs **before** the API code update (gated in `.github/workflows/deploy.yml`). U2 (terraform) provisions the Flue Lambda before U3's code ship can route to it. The full sequence: (a) terraform-apply with Flue module + lambda-api env-var rename → (b) data migration `pi → flue` → (c) `aws lambda update-function-code` for chat-agent-invoke with the new union literal.
- **Rollback:** any agent flipped from `strands` to `flue` can be flipped back without data loss (thread history schema is shared). The Flue runtime stays provisioned even if no agents are using it. For a Flue-side incident, mass-rollback is a single SQL update.
- **Monitoring:** existing AgentCore + CloudWatch dashboards extend to the Flue runtime. AgentCore Eval scores flow into the same store IF U2's IAM role includes `xray:PutTraceSegments`; the post-launch artifact flags any gap.
- **Runbook:** U14's launch doc covers operator-facing concerns. The post-launch artifact (separate from plan) covers DX-side notes for engineers.
- **Hindsight URL:** Flue runtime container env needs `HINDSIGHT_API_URL` (existing convention from Strands). Terraform U2 provisions this.
- **Boot-time env reads:** all wrapped in functions per `feedback_vitest_env_capture_timing` to avoid module-load capture of pre-injection `undefined`.
- **OpenTelemetry:** deferred per Scope Boundaries; Flue traffic uses CloudWatch + structured logs at v1. Post-launch artifact flags whether AgentCore Eval scoring requires OTel/X-Ray parity (it does for Strands; Flue's path TBD by U14's measurement).

---

## Phased Delivery

### Phase 1: Foundation (U1, U2, U3)

Lands first because everything downstream depends on the renamed package, the provisioned runtime, and the working selector. Phase 1 ships behind the existing `strands` default — operators see no change until Phase 2 wires Flue end-to-end and Phase 4 launches the first agent.

### Phase 2: Harness Integration (U4, U5, U6, U7, U8, U9)

The bulk of the wiring. U9 (handler shell) is the integration point that ties U4-U8 together; treat U4-U8 as parallel-developable and U9 as the convergence unit. U7 has the highest implementation risk concentrated in U16's worker integration.

### Phase 2b: Worker integration (U16)

U16 finalizes the worker_thread + token-handle isolation design. Lands after U9 (which ships with placeholder direct-`init()` dispatch). Test-first execution; the bearer-leak contract test must fail before implementation begins, then pass cleanly.

### Phase 3: Productionization (U10, U11, U12, U13)

Boundary controls (U10, U11) and the spike residuals (U12, U13). Can land in parallel with Phase 2b once Phase 2 is stable.

### Phase 4: Validation (U14)

U14 ships the first agent end-to-end and captures cold-start measurements. Plan completion gates on U14 — `status: active → completed` flips when U14 lands. The post-launch DX comparison + 2-week observation are operational follow-ups, not plan units.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md](docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md)
- **FR-9 verdict (Flue feel spike):** [docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md](docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md)
- **FR-9a verdict (integration spike):** [docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md](docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md)
- **Spike plan (FR-9a):** [docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md](docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md)
- **Residual review findings:** [docs/residual-review-findings/feat-flue-fr9a-integration-spike.md](docs/residual-review-findings/feat-flue-fr9a-integration-spike.md)
- **Spike code seed (merged in #783):** `packages/flue-aws/`
- **Superseded plans** (status: superseded; see frontmatter `superseded_by`):
  - `docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md`
  - `docs/plans/2026-04-27-001-test-pi-runtime-tools-mcp-memory-e2e-plan.md`
  - `docs/plans/2026-04-27-002-feat-pi-runtime-tool-execution-plan.md`
  - `docs/plans/2026-04-29-002-fix-pi-context-engine-split-tools-plan.md`
- **Strands runtime reference:** `packages/agentcore-strands/agent-container/container-sources/server.py`
- **Strands Terraform pattern (the actual Lambda+LWA shape):** `terraform/modules/app/agentcore-runtime/main.tf`
- **Per-tenant interpreter resolution (existing):** `packages/api/src/lib/sandbox-preflight.ts`
- **External: Flue 0.3.10 source** at `~/Projects/flue/packages/sdk/src/{agent,session,sandbox,mcp,roles}.ts` (cloned during the spike).
