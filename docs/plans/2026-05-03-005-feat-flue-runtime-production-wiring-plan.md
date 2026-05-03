---
title: "feat: Flue runtime production wiring — replaces oh-my-pi vendoring track"
type: feat
status: active
date: 2026-05-03
origin: docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
supersedes:
  - docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md
  - docs/plans/2026-04-27-001-test-pi-runtime-tools-mcp-memory-e2e-plan.md
  - docs/plans/2026-04-27-002-feat-pi-runtime-tool-execution-plan.md
  - docs/plans/2026-04-29-002-fix-pi-context-engine-split-tools-plan.md
---

# feat: Flue runtime production wiring — replaces oh-my-pi vendoring track

## Summary

Land the Flue-shaped parallel AgentCore runtime end-to-end: rename `packages/agentcore-pi/` → `packages/agentcore-flue/`, provision the AgentCore runtime via Terraform, wire ThinkWork resources through Flue's documented extension points (custom `SessionStore`, custom `ToolDef[]`, MCP via `connectMcpServer`, AgentCore Code Interpreter via the `@thinkwork/flue-aws` connector merged in #783), close the supply-chain / multi-tenant / callback-auth boundary controls, deliver the deep researcher as the first production agent on Flue, and gate success on a 2-week production traffic observation. This plan supersedes the four 2026-04-26/27/29 vendoring plans.

---

## Problem Frame

The 2026-05-03 brainstorm reframed the Pi parallel runtime around Flue. The FR-9a integration spike (verdict: PROCEED-WITH-REFRAME, merged in #783) confirmed that AgentCore Code Interpreter implements Flue's `BashLike` / `SessionEnv` interface cleanly, that Bedrock model routing works through `amazon-bedrock/<full-arn-id>` model strings, and that the connector's surface is production-implementable. With the spike's verdict closed, the remaining work is implementation: provision the runtime, wire the integration, harden the boundary, ship the first agent. (See origin: `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md`.)

This plan replaces — not amends — the four prior plans that scoped the oh-my-pi vendoring strategy. Those plans stay on disk as historical record; their `Supersedes:` reference here lets `/ce-work` and reviewers trace the lineage when they encounter mid-flight references.

---

## Requirements

- R1. Rename `packages/agentcore-pi/` → `packages/agentcore-flue/` and migrate the in-flight scaffolding (Dockerfile, LWA wiring, package.json, tests). Internal-only rename — no production traffic was ever routed to the `pi` runtime, so this is a clean cutover, not a migration. (Origin: FR-1.)
- R2. Provision the `agentcore-flue` AgentCore runtime via Terraform: ECR repo, container build, IAM role, runtime ID. Wire into the deployment pipeline so `thinkwork deploy` provisions it alongside Strands. (Origin: FR-1, dependency carried from 2026-04-26.)
- R3. Replace the runtime selector value `pi` with `flue` across the GraphQL `AgentRuntime` enum, the `AgentRuntimeDb` / `AgentRuntimeType` union literals, and the `resolveRuntimeFunctionName` dispatcher. Migrate any agent records currently pinned to `pi` to `strands`. The selector is a 3-value extension (`strands | flue` after migration; `pi` retired). (Origin: FR-2; resolves origin OQ on `pi` selector persistence.)
- R4. Implement an Aurora-backed `SessionStore` against Drizzle thread-history rows, keyed on `(tenantId, agentId, sessionId)` with fail-closed semantics. (Origin: FR-3, FR-4, FR-4a.)
- R5. Implement a `run_skill` `ToolDef` that subprocesses the existing Python script-skills from `packages/skill-catalog/` without rewriting any skill source. (Origin: FR-7.)
- R6. Implement AgentCore Memory + Hindsight as custom `ToolDef[]` injected via `init({ tools })`. Resolves origin OQ "MCP-server vs ToolDef" — chooses ToolDef for both based on per-tool ergonomics (REST surfaces, no MCP-server tier needed, lower deployment complexity). (Origin: FR-4.)
- R7. Wire MCP via Flue's `connectMcpServer` with per-user OAuth token-handle isolation: bearer tokens are passed as opaque handles and resolved at MCP request time on the trusted-handler side, never serialized into `ToolDef` objects. The Flue agent loop runs in a separate Node `worker_thread` or child process from the trusted handler. (Origin: FR-3, FR-3a.)
- R8. Wire AgentCore Code Interpreter as the default sandbox via `@thinkwork/flue-aws` (merged in #783). Extend the connector with a `getInterpreterId(tenantId)` callback so the trusted handler resolves a per-tenant interpreter ID at invocation time. (Origin: FR-5; resolves residual P1 from spike verdict.)
- R9. Implement the Flue agent handler entry point at `packages/agentcore-flue/agent-container/src/server.ts`. The handler resolves `API_AUTH_SECRET` from Secrets Manager at invocation time, mints all per-invocation resources, calls `init()` from `@flue/sdk`, runs `session.prompt()`, and POSTs `/api/skills/complete` with token usage on completion. A 401 from the callback surfaces as a hard error. (Origin: FR-3, FR-4, FR-4b.)
- R10. Supply-chain integrity in CI: npm provenance attestation verification on every install for `@flue/sdk` and its full transitive graph (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@modelcontextprotocol/sdk`, `just-bash`); 48-hour CVE response SLA documented; CVE workaround carveout exception to FR-1/FR-3 (fork must submit upstream concurrently, retire within 30 days of upstream acceptance). (Origin: FR-3a.)
- R11. Multi-tenant isolation audit: Aurora `SessionStore` fails closed without `tenantId`; module-level Flue state (MCP connection pools, compaction caches) audited for cross-invocation persistence and either cleared or partitioned by `tenantId`; `session.task()` sub-agent spawns inherit the originating invocation's `tenantId` binding and cannot be overridden by agent-supplied parameters. (Origin: FR-4a.)
- R12. Mocked-AWS unit tests for the AgentCore Code Interpreter connector at `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` — happy-path `exec` / `readFile` / `writeFile` / `readdir`, edge case `readFile` on missing path, mocked AWS error responses surface to caller. (Residual P2 from spike verdict.)
- R13. Typed `CodeInterpreterStreamOutput` parsing in `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` — replace `Record<string, unknown>` casts with discriminated-union handling on the actual stream event types from `@aws-sdk/client-bedrock-agentcore`. (Residual P3 from spike verdict.)
- R14. First production agent on the Flue runtime: deep researcher with sub-agent fan-out, exercising MCP (search server), `session.task()` (child explore agents), at least one Python script-skill (result formatting), and AgentCore Memory in real conversations. (Origin: 2026-04-26 first-agent commitment + Success Criteria.)
- R15. DX comparison doc + ≥2-week production traffic gate. Write `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-{date}.md` covering prompt visibility, dispatch ergonomics, debugging, customization headroom, observability fidelity, trusted-handler-injection ergonomics. Track token usage, completion success rate, latency, and AgentCore Eval scores against an equivalent Strands-routed reference for ≥2 weeks. (Origin: Success Criteria.)

**Origin actors:** A1 Operator, A2 ThinkWork agent (instance), A3 End user, A4 Platform engineer.
**Origin flows:** F1 Operator routes agent to Flue, F2 End-user chat hits Flue runtime, F3 Operator selects sandbox tier, F4 Two-spike validation (FR-9 ✓ done in #783, FR-9a ✓ done in #783).
**Origin acceptance examples:** AE1 (covers FR-1/3/3a/4/4a/4b), AE2 (covers FR-2), AE3 (covers FR-5/6a — Daytona deferred per FR-6a gates), AE4 (covers FR-7), AE5 (FR-9a — already verified in spike).

---

## Scope Boundaries

- **Daytona as a live operator selection** — out at v1. Daytona stays a documented future option per origin FR-6a until its three closure gates land (connector data audit, admin-UI disclosure, DPA review). Operators see only AgentCore Code Interpreter at launch.
- **Strands runtime retirement or migration** — out (carried from origin). Strands stays default for existing and new agents; operators opt agents in to Flue per agent.
- **`session.skill()` API for Python skills** — out (carried from origin FR-7). Skills plumb through `init({ tools })` as `run_skill`. Markdown-prompt-only skills (none today) would be the only candidate for `session.skill()` if introduced later.
- **Skip-AgentCore-container deployment via `flue build --target node` to plain Lambda** — out (carried from origin Scope Boundaries). Captured as a future option only; v1 deploys via the AgentCore container path mirroring Strands.
- **OpenAPI/REST shared admin-ops library refactor** — out (separate brainstorm at `brainstorm/shared-admin-ops` — see memory `project_shared_admin_ops_brainstorm`).
- **Flue SDK source modifications** — out except for CVE workarounds per R10's exception clause.
- **Multi-provider model routing via `pi-ai` to non-Bedrock providers** — out (carried from origin). AWS-native preference holds.
- **Operator-facing renaming of the runtime tier** — out at v1. Tier shows as `flue` in admin per origin FR-1; the operator-naming question (keep `flue` vs descriptive vs hide) is captured in origin Outstanding Questions and resolved during admin UI design, not this plan.
- **Multi-harness-in-one-container architectures** — out (carried from origin). Each harness is its own AgentCore runtime ID.

### Deferred to Follow-Up Work

- **Operator-facing tier-naming refactor** if `flue` proves confusing once production traffic ships. Separate admin UI PR.
- **Daytona connector productionization** (FR-6a's three gates) — separate plan, gated on enterprise-tenant DPA review.
- **`@thinkwork/flue-aws` extraction to upstream Flue contribution** (origin FR-8) — gated on Flue maintainer acceptance and `@flue/sdk` npm publish.
- **OpenTelemetry distro for Node + AgentCore** matching Strands instrumentation surface (origin OQ, carried from 2026-04-26). Separate plan when an observability gap is named.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-strands/agent-container/container-sources/server.py` — reference for trusted-handler-injection pattern in the existing Python runtime. The Flue handler mirrors this shape end-to-end (resolve secrets at invocation time, mint resources, run loop, post completion).
- `packages/agentcore-pi/agent-container/Dockerfile` + `packages/agentcore-pi/agent-container/src/server.ts` — Node container scaffolding (LWA 0.9.1, `/ping`, `/invocations`) carried forward to the renamed `packages/agentcore-flue/`.
- `packages/agentcore-pi/agent-container/src/runtime/tools/{execute-code,memory_tools,hindsight,mcp,workspace-skills}.ts` — Python-runtime ToolDef equivalents that R5/R6/R7 port to the Flue runtime. The TypeScript implementations already exist for some (the Pi vendoring track was 7 days into building them); inventory what's salvageable in U2.
- `terraform/modules/app/agentcore-code-interpreter/main.tf` — Terraform pattern for provisioning AgentCore-managed resources. R2 mirrors this shape for the Flue runtime.
- `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` (merged in #783) — the AgentCore Code Interpreter `SandboxFactory`. R8 extends this with `getInterpreterId(tenantId)`.
- `packages/api/src/lib/resolve-runtime-function-name.ts` + `packages/database-pg/graphql/types/agents.graphql` — runtime-selector dispatch + GraphQL enum that R3 modifies.
- `packages/api/workspace-files.ts` — composed-AGENTS.md derive-skills pattern; relevant for how the Flue runtime discovers the agent's workspace context.

### Institutional Learnings

- `feedback_avoid_fire_and_forget_lambda_invokes` — Flue handler's completion callback (R9) uses synchronous semantics, surfaces 401s and other errors, no fire-and-forget.
- `feedback_completion_callback_snapshot_pattern` — Flue handler snapshots `THINKWORK_API_URL` + `API_AUTH_SECRET` at agent-coroutine entry; never re-reads `process.env` after the agent turn. R9's design follows this.
- `project_agentcore_deploy_race_env` — AgentCore env-injection race during terraform-apply. R9 mitigates by resolving secrets from Secrets Manager at invocation time, not module load.
- `project_agentcore_default_endpoint_no_flush` — `UpdateAgentRuntimeEndpoint` rejects DEFAULT with "managed through agent updates"; the 15-minute reconciler is the only flush. R2's runtime provisioning + future agent-updates flow inherits this constraint.
- `feedback_hindsight_async_tools` — Hindsight's `recall`/`reflect` wrappers must stay async with fresh client + retry. R6's TypeScript port preserves this.
- `feedback_pnpm_in_workspace` — pnpm only, never npm. R10's CI integrity check uses pnpm's lockfile.
- `feedback_decisive_over_hybrid` — when there's a tension (e.g., `pi` selector retire vs alias), commit to one side and name the compromise. R3 retires `pi` outright.

### External References

- Flue 0.3.10 source (cloned during the spike at `~/Projects/flue/`) — `packages/sdk/src/{agent,session,sandbox,mcp,roles}.ts`. Authoritative for `SessionStore` / `SandboxFactory` / `ToolDef` / `init()` shapes.
- `@aws-sdk/client-bedrock-agentcore` ^3.1028.0 — `BedrockAgentCoreClient`, `InvokeCodeInterpreterCommand`, `StartCodeInterpreterSessionCommand`, `StopCodeInterpreterSessionCommand`, `CodeInterpreterStreamOutput`. Already pinned in `packages/agentcore-pi/package.json`.

---

## Key Technical Decisions

- **Rename `packages/agentcore-pi/` → `packages/agentcore-flue/`.** The Pi runtime had no production traffic; the directory is internal-only. Renaming aligns the package name with the operator-visible tier (`flue`) and avoids the dual-naming overhead of running a "pi" package that hosts a "flue" runtime. Existing scaffolding (Dockerfile, LWA wiring, AWS SDK pins, tests) carries forward unchanged.
- **Retire the `pi` runtime selector value rather than aliasing.** Origin FR-2 named the values `strands | flue`. Aliasing `pi` → `flue` for compat is unnecessary because no production agents run on `pi`. Migration is a one-shot SQL/seed update during the deploy that lands R3.
- **AgentCore Memory + Hindsight as `ToolDef[]`, not MCP servers.** Origin OQ had this open. Decision: `ToolDef` chosen because (a) both surfaces are REST and easy to wrap, (b) avoids deploying a per-tenant MCP-server tier, (c) keeps state lifecycle inside the trusted handler boundary.
- **Aurora `SessionStore` adapter implements Flue's interface directly; translation layer is plan-time discovery.** R4 builds the adapter against Flue's documented `SessionStore` signature; if the signature requires turn/role semantics that don't map onto thread-history rows, the adapter introduces a translation layer. Decision deferred to implementation.
- **MCP token-handle isolation via worker_thread.** R7's pattern: trusted handler holds bearer tokens; the agent loop runs in a `worker_thread` and receives only token *handles*; the handle resolves to a real bearer at MCP request time on the handler side. Mitigates origin FR-3a supply-chain risk.
- **`getInterpreterId(tenantId)` callback on the AgentCore CI connector.** R8 extends `@thinkwork/flue-aws` with this callback rather than instantiating one connector per tenant request. Cleaner option for the trusted handler; matches origin FR-5 multi-tenant scoping.
- **AgentCore container hosting (not plain Lambda) for the Flue runtime.** Origin Scope Boundaries kept the plain-Lambda variant as a future option. AgentCore container parity with Strands keeps observability, IAM, and deployment patterns symmetric across runtimes.
- **2-week production traffic observation gate.** Origin Success Criteria. R15 ships the first agent (R14) and the comparison doc; the 2-week soak validates the bet under real load before declaring the reframe successful.

---

## Open Questions

### Resolved During Planning

- **`pi` selector value retirement vs persistence.** Resolved: retire. (See Key Technical Decisions.)
- **`packages/agentcore-pi/` vs `packages/agentcore-flue/`.** Resolved: rename the directory; the existing pi-mono substrate stays at the same `pi-agent-core` 0.70.2 pin.
- **AgentCore Memory + Hindsight surface.** Resolved: ToolDef both. (See Key Technical Decisions.)
- **Connector + getInterpreterId pattern.** Resolved: callback on the connector options. (See Key Technical Decisions.)
- **AgentCore container vs plain Lambda for v1.** Resolved: AgentCore container. (See Key Technical Decisions.)

### Deferred to Implementation

- **Aurora `SessionStore` translation-layer need.** R4 starts with a 1:1 adapter and introduces a translation layer only if Flue's signature requires semantics thread-history rows can't express. Discovery happens during U4.
- **Concurrent `session.task()` sub-agent AgentCore CI session strategy.** Spike noted that AgentCore CI serializes calls per-session. For sub-agent fan-out, R8's connector needs to either spawn fresh sessions per `session.task()` invocation (parallelism, more cold starts) or share one session (queueing). Decision belongs to U8 once we measure cold-start latency vs queue depth empirically.
- **Python skill subprocess strategy: cold spawn vs warm worker pool vs Unix-socket protocol.** Origin OQ, carried from 2026-04-26. R5 starts with cold spawn; measure latency before optimizing.
- **OpenTelemetry distro shape.** Carried from origin OQ; deferred to follow-up work (Scope Boundaries above).
- **Whether the existing `packages/agentcore-pi/agent-container/src/runtime/tools/*.ts` TypeScript ToolDef code is salvageable.** The Pi vendoring track was 7 days into building these; U1 inventories which files (memory_tools.ts, hindsight.ts, mcp.ts, workspace-skills.ts) survive the rename and which need rewrite for Flue's ToolDef contract. Discovery during U1, refactored as part of U5/U6/U7.

---

## Output Structure

```
packages/agentcore-flue/                                # renamed from packages/agentcore-pi/
├── package.json                                         # rename @thinkwork/agentcore-pi → @thinkwork/agentcore-flue
├── tsconfig.json
└── agent-container/
    ├── Dockerfile                                       # carry forward (Node 20 + LWA 0.9.1)
    ├── src/
    │   ├── server.ts                                    # NEW: Flue agent handler entry point (replace existing Pi server.ts)
    │   ├── sessionstore-aurora.ts                       # NEW: SessionStore impl backed by Drizzle thread-history
    │   ├── tools/
    │   │   ├── run-skill.ts                             # NEW: Python script-skill subprocess ToolDef
    │   │   ├── memory.ts                                # MIGRATE: from agentcore-pi/agent-container/src/runtime/tools/memory_tools.ts (port to ToolDef)
    │   │   ├── hindsight.ts                             # MIGRATE: from agentcore-pi/agent-container/src/runtime/tools/hindsight.ts
    │   │   └── workspace-skills.ts                      # MIGRATE: discover/derive workspace skills from S3
    │   ├── mcp.ts                                       # NEW: MCP wiring with OAuth token-handle isolation
    │   └── (other carried-forward files from agentcore-pi/)
    └── tests/
        ├── server.test.ts                               # NEW: handler invocation tests
        ├── sessionstore-aurora.test.ts                  # NEW
        └── tools/run-skill.test.ts                      # NEW

terraform/modules/app/agentcore-flue/                    # NEW: mirrors agentcore-code-interpreter pattern
├── main.tf                                              # ECR repo, container build, IAM role, runtime ID
├── variables.tf
├── outputs.tf
└── README.md

packages/flue-aws/connectors/agentcore-codeinterpreter.ts   # MODIFY: add getInterpreterId callback (#783's seed)
packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts   # NEW: residual P2 (mocked-AWS unit tests)

packages/database-pg/graphql/types/agents.graphql        # MODIFY: enum AgentRuntime { STRANDS PI } → { STRANDS FLUE }
packages/api/src/lib/resolve-runtime-function-name.ts    # MODIFY: 'strands' | 'pi' → 'strands' | 'flue'
packages/api/src/graphql/resolvers/agents/runtime.ts     # MODIFY: parseAgentRuntimeInput allow-list
packages/database-pg/drizzle/NNNN_migrate_pi_to_strands.sql   # NEW: data migration for any pi-pinned agent records

.github/workflows/ci.yml                                  # MODIFY: add npm provenance attestation step (R10)

docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-2026-MM-DD.md   # NEW: R15 comparison doc
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Trusted-handler injection pattern (Flue runtime invocation)

```
chat-agent-invoke Lambda
    ↓ (dispatches to runtime ID by agent.runtime selector)
AgentCore Flue runtime container (Node 20 + LWA)
    ↓ (handles /invocations request)
trusted-handler (server.ts)
    ↓
    ├── resolve API_AUTH_SECRET from Secrets Manager (FR-4b)
    ├── resolve interpreterId via connector.getInterpreterId(tenantId) (R8)
    ├── mint MCP tools (per-user OAuth → token-handle, not bearer) (R7)
    ├── mint Memory + Hindsight ToolDefs (R6)
    ├── mint run_skill ToolDef (R5)
    ├── construct AgentCore CI SandboxFactory via @thinkwork/flue-aws (R8)
    ├── construct Aurora SessionStore (R4)
    ├── construct Bedrock model string (amazon-bedrock/<full-arn-id>)
    └── pass everything to init() — agent loop runs in worker_thread
            ↓
        @flue/sdk session.prompt() (worker_thread)
            ↓
        agent loop: ToolDefs + SessionStore + SandboxFactory + role + cwd
            ↓ (returns)
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

The migration from `pi` → `flue` is a one-shot SQL update during U3's deployment; no production rows expected since no Pi traffic ever shipped.

---

## Implementation Units

Phases group units by dependency boundaries. A phase boundary is a natural commit/PR cut point but not a hard ship gate — multiple units within a phase can land independently.

### Phase 1: Foundation (rename + provision + selector)

- U1. **Rename `packages/agentcore-pi/` → `packages/agentcore-flue/`**

**Goal:** Migrate the in-flight scaffolding (Dockerfile, LWA wiring, package.json, AWS SDK pins, existing tests) from the now-superseded `agentcore-pi` directory to `agentcore-flue`. Inventory which `agentcore-pi/agent-container/src/runtime/tools/*.ts` files survive the rename (some are TypeScript ToolDef code that the Pi vendoring track had begun) and which need rewrite for Flue's ToolDef contract.

**Requirements:** R1.

**Dependencies:** None.

**Files:**
- Move: `packages/agentcore-pi/` → `packages/agentcore-flue/` (entire directory tree)
- Modify: `packages/agentcore-flue/package.json` (rename `@thinkwork/agentcore-pi` → `@thinkwork/agentcore-flue`)
- Modify: `pnpm-workspace.yaml` (if explicit package list — usually glob-based, may be no-op)
- Modify: any imports of `@thinkwork/agentcore-pi` across the monorepo (grep for usages, update)
- Modify: deploy scripts under `apps/cli/` referencing `agentcore-pi` paths
- Modify: Terraform variable names referencing `agentcore_pi` (rename to `agentcore_flue`)

**Approach:**
- Use `git mv` for the directory rename to preserve history.
- After rename, run `pnpm install` to regenerate the lockfile entry under the new name.
- Run `pnpm -r typecheck` to surface any broken imports.
- Document in the PR description which existing tools are being carried forward as-is (Dockerfile, LWA, server.ts shell — though server.ts will be rewritten in U9) and which are flagged for U5/U6/U7 ToolDef rewrites.

**Patterns to follow:**
- `packages/agentcore-strands/` directory layout (mirror at the top level).

**Test scenarios:**
- Test expectation: none — pure rename. Behavior verification happens in dependent units (U2 provisions terraform with the new name; U9 replaces server.ts).

**Verification:**
- `pnpm install` succeeds with `@thinkwork/agentcore-flue` registered.
- `pnpm -r typecheck` passes (no orphaned imports).
- `git log --follow packages/agentcore-flue/agent-container/Dockerfile` shows the rename history.

---

- U2. **Provision the `agentcore-flue` AgentCore runtime via Terraform**

**Goal:** Mirror the AgentCore Code Interpreter Terraform pattern to provision a Node-container AgentCore runtime: ECR repo, container build pipeline, IAM role with appropriate permissions, runtime ID export. Wire into the deployment pipeline so `thinkwork deploy` provisions it alongside Strands.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**
- Create: `terraform/modules/app/agentcore-flue/main.tf`
- Create: `terraform/modules/app/agentcore-flue/variables.tf`
- Create: `terraform/modules/app/agentcore-flue/outputs.tf` (export `runtime_id`, `function_name`)
- Create: `terraform/modules/app/agentcore-flue/README.md`
- Create: `terraform/modules/app/agentcore-flue/scripts/build.sh` (container build helper if needed; mirror agentcore-strands)
- Modify: `terraform/modules/app/main.tf` to wire the new module
- Modify: `apps/cli/src/commands/deploy.ts` to include the new runtime in the deploy flow (env var injection: `AGENTCORE_FLUE_FUNCTION_NAME`)

**Approach:**
- Pattern source: `terraform/modules/app/agentcore-code-interpreter/main.tf` (similar shape — ECR, IAM, AgentCore runtime resource).
- Container image: from `packages/agentcore-flue/agent-container/Dockerfile` (Node 20 + LWA 0.9.1).
- IAM role permissions: `bedrock-agentcore:InvokeCodeInterpreter`, `bedrock-agentcore:StartCodeInterpreterSession`, `bedrock-agentcore:StopCodeInterpreterSession`, `bedrock:InvokeModel*`, `secretsmanager:GetSecretValue` (for `API_AUTH_SECRET`), `s3:GetObject` (for skill catalog), Aurora Data API permissions (for SessionStore), `logs:*` (CloudWatch).
- Apply the AgentCore deploy-race mitigations from `project_agentcore_deploy_race_env` and `project_agentcore_default_endpoint_no_flush`.
- The runtime ID becomes `AGENTCORE_FLUE_FUNCTION_NAME` in `chat-agent-invoke`'s env, paired with the existing `AGENTCORE_FUNCTION_NAME` (Strands).

**Patterns to follow:**
- `terraform/modules/app/agentcore-code-interpreter/main.tf` (full pattern).
- `terraform/modules/app/agentcore-runtime/main.tf` (provisions the existing Strands runtime).

**Test scenarios:**
- Integration: `thinkwork deploy -s dev` provisions the new runtime cleanly without breaking existing resources. Verify via `aws bedrock-agentcore-control list-agent-runtimes` after deploy.
- Integration: the new runtime endpoint accepts an empty `/ping` request (LWA health check pattern).

**Verification:**
- Terraform plan shows the new module's resources (ECR repo, IAM role, runtime ID).
- After deploy, `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id>` returns READY.
- `chat-agent-invoke` can resolve `AGENTCORE_FLUE_FUNCTION_NAME` from its env (verified via Lambda console or invocation).

---

- U3. **Replace runtime selector value `pi` → `flue` (retire `pi`)**

**Goal:** Update the GraphQL `AgentRuntime` enum, `AgentRuntimeDb` / `AgentRuntimeType` union literals, the dispatcher in `resolveRuntimeFunctionName`, and any other code paths referencing `pi`. Migrate any agent records currently set to `runtime: 'pi'` to `runtime: 'strands'` (no production traffic was on `pi`; this is a clean cutover).

**Requirements:** R3. (Origin: FR-2.)

**Dependencies:** U2 (the new runtime ID needs to exist before the dispatcher can route to it).

**Files:**
- Modify: `packages/database-pg/graphql/types/agents.graphql` (enum `AgentRuntime { STRANDS PI }` → `{ STRANDS FLUE }`)
- Modify: `packages/api/src/lib/resolve-runtime-function-name.ts` (`'strands' | 'pi'` → `'strands' | 'flue'`; dispatcher updates)
- Modify: `packages/api/src/graphql/resolvers/agents/runtime.ts` (`parseAgentRuntimeInput` allow-list, `agentRuntimeToGraphql` mapping)
- Create: `packages/database-pg/drizzle/NNNN_migrate_pi_to_strands.sql` (data migration: `UPDATE agents SET runtime = 'strands' WHERE runtime = 'pi'`; same for `agent_templates` if applicable)
- Run: `pnpm schema:build` (regenerates `terraform/schema.graphql`)
- Run: `pnpm --filter @thinkwork/database-pg db:generate` (Drizzle migration if schema column constraint changes)
- Modify: codegen consumers — `pnpm --filter @thinkwork/{cli,admin,mobile,api} codegen` after the GraphQL change
- Modify: `apps/admin/src/` runtime selector UI (if it explicitly lists `pi` as an option, swap to `flue`)
- Test: `packages/api/src/lib/resolve-runtime-function-name.test.ts` (update existing tests if they reference `pi`)

**Approach:**
- Drizzle's `agents.runtime` column is `text`, so no DB schema migration needed — the data migration SQL is sufficient.
- The GraphQL enum is closed; codegen regeneration is required across all consumers.
- The data migration should be idempotent (`UPDATE ... WHERE runtime = 'pi'`).

**Test scenarios:**
- Happy path: GraphQL `setAgentRuntime(agentId: X, runtime: FLUE)` returns the agent with `runtime: 'flue'` persisted. *Covers AE2.*
- Edge case: passing `runtime: 'PI'` returns a GraphQL validation error (the enum no longer includes `PI`).
- Edge case: pre-existing agent records with `runtime: 'pi'` get migrated to `runtime: 'strands'` after the data migration runs.
- Integration: `chat-agent-invoke` dispatches to the Flue runtime ID when `agent.runtime === 'flue'`. *Covers AE2.*

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` passes after enum/union changes.
- `pnpm --filter @thinkwork/api test` passes (resolver tests updated).
- After deploy + data migration, `SELECT runtime, COUNT(*) FROM agents GROUP BY runtime` returns no `pi` rows.
- A test agent flipped from `strands` to `flue` in admin dispatches to the Flue runtime ID on next invocation.

---

### Phase 2: Harness Integration (SessionStore, tools, MCP, sandbox, handler)

- U4. **Implement Aurora-backed `SessionStore` for Flue**

**Goal:** Implement Flue's `SessionStore` interface against the existing Drizzle thread-history schema. Keyed on `(tenantId, agentId, sessionId)` with fail-closed semantics (R4 + R11). Surface a translation-layer requirement only if Flue's signature can't map onto thread-history rows directly.

**Requirements:** R4, R11. (Origin: FR-3, FR-4, FR-4a.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/sessionstore-aurora.ts`
- Create: `packages/agentcore-flue/agent-container/tests/sessionstore-aurora.test.ts`

**Approach:**
- Read Flue's `SessionStore` signature from `~/Projects/flue/packages/sdk/src/types.ts` (or `dist/types-*.d.mts` in the spike clone) at implementation time.
- Connect to Aurora via the existing data-API pattern (see `packages/database-pg/` for the connection helper).
- All queries scope on `(tenantId, agentId, sessionId)`. If `tenantId` is absent from invocation context, throw immediately.
- If Flue's interface requires turn/role semantics that thread-history rows don't expose (e.g., `getMessageWindow(sessionId, options)`, message-level partition tokens for compaction), introduce a translation layer at the adapter boundary; document the mapping in the file's header comment.
- Module-level state audit: no shared connection pools across invocations; each invocation gets its own SessionStore instance (matches FR-4a partitioning).

**Execution note:** Start with a failing integration test that writes one message and reads it back, then implement until green. The schema surface area is small enough that test-first discipline is easier than spec-driven implementation.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` thread-persistence path (Python) for the schema mapping.
- `packages/database-pg/src/schema/threads.ts` for the actual table shape.

**Test scenarios:**
- Happy path: write a message, read the session, message is present. *Covers AE1.*
- Happy path: write three messages across two `agent.session()` calls with the same agentId/sessionId; read returns all three in order.
- Edge case: missing `tenantId` throws immediately (fail-closed) — caller never gets a session reference.
- Edge case: `(tenantId=A, agentId=X, sessionId=S)` cannot read messages written under `(tenantId=B, agentId=X, sessionId=S)`. *Covers AE1.* Critical for FR-4a multi-tenant isolation.
- Error path: Aurora connection failure surfaces as a typed error, not a silent empty session.
- Integration: write → compaction trigger → read → compacted history reflects the trim. (Behavior depends on Flue's compaction config; may surface a translation-layer requirement.)

**Verification:**
- All test scenarios pass.
- The adapter implements every method Flue's `SessionStore` interface declares (no partial impls).
- Type-level: `const _: SessionStore = new AuroraSessionStore(...)` typechecks.

---

- U5. **Implement `run_skill` ToolDef for Python script-skills via subprocess**

**Goal:** Expose the existing `packages/skill-catalog/` Python script-skills to the Flue agent loop as a single `run_skill` tool. The tool spawns a Python subprocess against the existing skill script entry point; carry forward arg/result conventions from the existing Strands runtime's run-skill implementation.

**Requirements:** R5. (Origin: FR-7.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/tools/run-skill.ts`
- Create: `packages/agentcore-flue/agent-container/tests/tools/run-skill.test.ts`

**Approach:**
- Cold-spawn strategy in v1: each `run_skill` invocation forks a fresh Python subprocess. Measure latency before optimizing (warm worker pool / Unix socket — origin OQ deferred to implementation).
- Skill discovery: read S3 skill catalog at handler boot (or at invocation if dynamism is needed); the run_skill tool's `description` is built from the available skill manifest so the agent loop knows what skills exist.
- Skill execution: pass skill args as JSON to the subprocess via stdin; subprocess writes JSON result to stdout; non-zero exit is a tool error surfaced to the agent.
- The Python interpreter runs inside the AgentCore Flue container — Python 3.11 + the skill catalog deps must be present (Dockerfile addition).

**Execution note:** Integration-test against a real skill from `packages/skill-catalog/` (calculator or analyze-csv); cold-spawn latency observation is part of the test output.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py`'s skill execution path.
- `packages/agentcore-pi/agent-container/src/runtime/tools/workspace-skills.ts` if it had a TypeScript run-skill stub from the vendoring track (carry forward).

**Test scenarios:**
- Happy path: `run_skill('calculator', { expression: '2 + 3' })` returns 5. *Covers AE4.*
- Happy path: skill manifest lists all skills from S3 catalog; the tool's description is constructed correctly.
- Edge case: unknown skill name → typed error, not a Python crash.
- Error path: skill subprocess exits non-zero → tool returns error result with the skill's stderr.
- Error path: skill subprocess hangs → handler times out per Flue's `init({ tools: [{ timeout }] })` setting.
- Integration: a Python skill that imports `boto3` works (i.e., AWS credentials are inherited correctly from the container's IAM role).

**Verification:**
- All test scenarios pass.
- `run_skill` invocations against the real skill catalog match results from the Strands runtime invoking the same skill.

---

- U6. **Implement AgentCore Memory + Hindsight as `ToolDef[]`**

**Goal:** Port the existing Python AgentCore Memory + Hindsight tool wrappers to TypeScript ToolDefs, injected via `init({ tools })`. Preserve the async semantics + retry behavior from `feedback_hindsight_async_tools`.

**Requirements:** R6. (Origin: FR-4.)

**Dependencies:** U1.

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/tools/memory.ts` (AgentCore Memory L2 — `recall`, `retain`, `list`)
- Create: `packages/agentcore-flue/agent-container/src/tools/hindsight.ts` (Hindsight `recall` + `reflect`, with async wrapper + fresh client + aclose + retry)
- Create: `packages/agentcore-flue/agent-container/tests/tools/memory.test.ts`
- Create: `packages/agentcore-flue/agent-container/tests/tools/hindsight.test.ts`

**Approach:**
- AgentCore Memory: REST surface via `@aws-sdk/client-bedrock-agentcore` Memory L2 endpoints. Wrap in a `ToolDef` with descriptive `description` matching the Strands tool's wording.
- Hindsight: HTTP client against the deployed Hindsight endpoint (URL from env). The `recall` and `reflect` tool wrappers stay async-shaped per `feedback_hindsight_async_tools` — fresh client per invocation, retry on transient failures, aclose on completion. Docstring chain: `recall`'s description includes the REQUIRED FOLLOW-UP `reflect` instruction per `feedback_hindsight_recall_reflect_pair`.
- Both tools take `(tenantId, userId)` from the trusted handler's invocation scope; no agent-supplied tenant override.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/memory_tools.py` (semantics).
- `packages/agentcore-strands/agent-container/hindsight_tools.py` (async pattern).
- `packages/agentcore-pi/agent-container/src/runtime/tools/hindsight.ts` if salvageable from U1's inventory.

**Test scenarios:**
- Happy path (memory): `recall(query='test')` returns a list of records when matches exist.
- Happy path (memory): `retain(content='note')` writes a record discoverable by subsequent `recall`.
- Happy path (hindsight): `recall(query='test')` returns ranked records; `reflect(record_ids)` updates relevance scores.
- Edge case: missing tenantId/userId from handler → tool throws before HTTP call.
- Error path: Hindsight HTTP 5xx → retry per `feedback_hindsight_async_tools`; final failure surfaces as tool error.
- Integration: AgentCore Memory and Hindsight write to different stores; cross-recall confirms independence.

**Verification:**
- Tool descriptions match the Strands equivalents (so agents trained on Strands prompts understand the same surface).
- Async semantics: `recall` and `reflect` are reachable from the agent loop without blocking the event loop.

---

- U7. **Wire MCP via Flue's `connectMcpServer` with OAuth token-handle isolation**

**Goal:** Implement the MCP integration: trusted handler holds bearer tokens; the Flue agent loop runs in a `worker_thread` (or child process) and receives only opaque token *handles*; handles resolve to bearers at MCP request time on the trusted-handler side. The agent loop's MCP tools never see raw OAuth bearers.

**Requirements:** R7, R10. (Origin: FR-3, FR-3a.)

**Dependencies:** U1, U9 (handler shape needs to host the worker_thread split).

**Files:**
- Create: `packages/agentcore-flue/agent-container/src/mcp.ts` (MCP server connection + token-handle isolation)
- Create: `packages/agentcore-flue/agent-container/tests/mcp.test.ts`

**Approach:**
- The trusted handler (server.ts, U9) maintains a `Map<TokenHandle, OAuthBearer>` keyed by ephemeral handle IDs.
- The Flue agent loop runs in a `worker_thread`. The handler passes `ToolDef[]` constructed via `connectMcpServer({ url, headers: { Authorization: 'Handle ${handle}' } })` — but the actual fetch implementation is intercepted on the handler side: when MCP makes an HTTP request, the handler swaps the handle for the real bearer just before egress.
- Implementation detail: this requires either a custom `fetch` passed to `connectMcpServer` (which Flue supports per its README) that runs in the worker but proxies to the handler, OR running MCP entirely on the handler side and proxying tool calls over the worker boundary. The simpler path is the custom fetch, with handle resolution happening in a `MessageChannel` round-trip.
- The Aurora `SessionStore` adapter (U4) explicitly excludes any header value matching a bearer-token pattern from persisted compaction payloads (already in adapter's serialization rules, but cross-checked here).

**Execution note:** Test-first — start with a contract test that asserts no bearer tokens leak into ToolDef serialization, MCP request URLs (query strings), or SessionStore payloads. Then implement until the test passes.

**Patterns to follow:**
- `packages/agentcore-pi/agent-container/src/runtime/tools/mcp.ts` if salvageable from U1's inventory.
- Flue's MCP example in `~/Projects/flue/examples/hello-world/.flue/agents/with-tools.ts` and the README's `connectMcpServer` example.
- Node `worker_threads` + `MessageChannel` for the cross-worker handle resolution.

**Test scenarios:**
- Happy path: agent calls an MCP tool; tool fires HTTP with the real bearer; response returns to the agent loop.
- Happy path: simultaneous MCP calls from different agents in the same container don't cross-contaminate handles.
- Edge case: handle expires (e.g., handler restarts mid-session) → MCP call returns a typed auth-failure error, not a silent failure.
- Error path: MCP server returns 401 → agent loop sees a tool error; the trusted handler logs the failure and rotates the user's token if the OAuth refresh path is configured.
- Integration: token-leak check — assert via inspection that `JSON.stringify(toolDefs)` contains only handles, never bearers; same for `JSON.stringify(sessionStore.serialize())`. *Critical for FR-3a.*
- Integration: contract test spins up a fake MCP server and confirms the worker can complete a round-trip without ever materializing a bearer in worker memory.

**Verification:**
- All test scenarios pass.
- A grep + manual inspection of CloudWatch logs for a test invocation confirms no bearer-shaped strings appear in any log line.
- Worker-thread isolation verified — `worker.postMessage(...)` never carries a bearer; only handles cross the boundary.

---

- U8. **Wire AgentCore Code Interpreter via `@thinkwork/flue-aws` connector with `getInterpreterId(tenantId)`**

**Goal:** Use the connector merged in #783 as the default sandbox; extend its `AgentcoreCodeInterpreterOptions` interface with a `getInterpreterId(tenantId): Promise<string>` callback so the trusted handler resolves a per-tenant interpreter ID at invocation time. Decide concurrent-session-vs-fresh-session strategy for `session.task()` sub-agent fan-out.

**Requirements:** R8, R11. (Origin: FR-5; resolves residual P1 from spike verdict.)

**Dependencies:** U1.

**Files:**
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` (add callback option; pass tenantId-derived interpreter ID into the existing `AgentcoreCodeInterpreterApi` constructor)
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` (test the callback path; merged in U12 since the test file is created there)
- Modify: `packages/agentcore-flue/agent-container/src/server.ts` (handler — call into U8's connector with the per-tenant ID)

**Approach:**
- Connector option signature: `getInterpreterId?: (ctx: { tenantId?: string }) => Promise<string>`. If both `interpreterId` and `getInterpreterId` are provided, the callback wins. If neither, throw at instantiation.
- Per-tenant lookup: trusted handler passes `tenantId` from invocation context; the callback resolves to a Terraform-output-derived interpreter ID (e.g., from `/thinkwork/<stage>/<tenant>/code-interpreter-id` SSM Parameter Store). For v1 with one shared interpreter, the callback returns a static value.
- `session.task()` sub-agent strategy: each `task()` gets a fresh `SandboxFactory.createSessionEnv()` call → fresh AgentCore CI session via `StartCodeInterpreterSession`. This avoids cross-task queueing at the cost of per-task cold start. Measure cold start latency (~hundreds of ms per spike output) and revisit if it's user-visible.

**Patterns to follow:**
- The existing connector's `agentcoreCodeInterpreter(client, options)` factory — extend its options shape backward-compatibly.

**Test scenarios:**
- Happy path: `getInterpreterId({ tenantId: 'tenant-A' })` returns a tenant-A interpreter ID; invocations use it.
- Edge case: `getInterpreterId` throws (e.g., SSM lookup fails) → connector surfaces a typed error; handler returns 500 to the invoker, no orphaned AgentCore session.
- Edge case: missing `tenantId` in handler context → callback receives `undefined`; the callback's implementation decides whether to fail closed (recommended) or use a default.
- Integration: two parallel `session.task()` invocations create two separate AgentCore CI sessions (verify via `aws bedrock-agentcore-control list-code-interpreter-sessions`).

**Verification:**
- All test scenarios pass.
- Mocked-AWS unit tests in U12 cover the callback path.
- A real-AWS smoke from the handler invokes both the default interpreter and a per-tenant interpreter (when configured) and both succeed.

---

- U9. **Implement Flue agent handler entry point**

**Goal:** Replace `packages/agentcore-flue/agent-container/src/server.ts` with the Flue trusted-handler implementation. Resolves `API_AUTH_SECRET` from Secrets Manager at invocation time, mints all per-invocation resources (sandbox, tools, SessionStore, model, role, cwd), runs the agent loop in a `worker_thread`, posts the completion callback. Surfaces 401s from `/api/skills/complete` as hard errors.

**Requirements:** R9, R7, R8. (Origin: FR-3, FR-4, FR-4b.)

**Dependencies:** U1, U2, U3, U4, U5, U6, U8 (depends on every constructor; U7 finalizes the handle-resolution glue).

**Files:**
- Modify (replace): `packages/agentcore-flue/agent-container/src/server.ts`
- Create: `packages/agentcore-flue/agent-container/src/handler-context.ts` (per-invocation context resolution: tenantId, userId, agent record, secrets)
- Create: `packages/agentcore-flue/agent-container/tests/server.test.ts`

**Approach:**
- Handler shape mirrors the Strands `server.py` end-to-end: parse `/invocations` request → resolve secrets + invocation context → mint resources → spawn worker → run loop → post callback → return.
- Secrets resolution: `API_AUTH_SECRET` from Secrets Manager via `@aws-sdk/client-secrets-manager` per `feedback_completion_callback_snapshot_pattern` — at invocation time, snapshot, never re-read.
- Worker thread: `new Worker(...)` with the agent-loop entry point; pass `ToolDef[]` (with token handles, not bearers) + sandbox factory + sessionStore + model + role + cwd via `MessageChannel`. Receive results back the same way.
- Completion callback: `POST /api/skills/complete` with snapshotted secret; 401 throws (per `feedback_avoid_fire_and_forget_lambda_invokes`); other failures retry with backoff.

**Execution note:** Integration-test the full happy path against a deployed dev runtime (after U2's terraform applies) before treating U9 as done.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` end-to-end (Python equivalent).
- `feedback_completion_callback_snapshot_pattern` (snapshotting).
- `feedback_avoid_fire_and_forget_lambda_invokes` (synchronous + surface errors).

**Test scenarios:**
- Happy path: `/invocations` request with a valid agent runtime + tenantId returns a response indistinguishable from Strands. *Covers AE1.*
- Happy path: completion callback POSTs with the right shape (skill_run_id, status, token_usage, latency).
- Edge case: missing tenantId in invocation payload → 400 with typed error; no agent loop spawned.
- Edge case: Secrets Manager unreachable → 500 with retry-after; no fire-and-forget.
- Error path: `/api/skills/complete` returns 401 → handler throws; the wrapping Lambda surfaces the error to the orchestrator. *Covers FR-4b.*
- Error path: agent loop in worker thread throws unrecoverably → handler returns 500 with the error; no orphaned worker.
- Integration: token-handle isolation contract test — bearers never appear in worker thread memory or in the completion callback payload.

**Verification:**
- All test scenarios pass.
- A test agent on the Flue runtime (post-U2 deploy) completes an end-to-end chat turn through admin or mobile, with metrics flowing to the existing dashboards.
- Token-leak grep across CloudWatch logs for the test invocation: zero bearer-shaped strings.

---

### Phase 3: Productionization (boundary controls + spike residuals)

- U10. **Supply-chain integrity in CI (FR-3a)**

**Goal:** Add npm provenance attestation verification to CI for `@flue/sdk` and its full transitive graph (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@modelcontextprotocol/sdk`, `just-bash`). Document a 48-hour CVE response SLA and the FR-1/FR-3 carveout for security patches.

**Requirements:** R10. (Origin: FR-3a.)

**Dependencies:** None.

**Files:**
- Modify: `.github/workflows/ci.yml` (add provenance verification step after `pnpm install`)
- Create: `docs/solutions/integration-issues/flue-supply-chain-integrity-2026-MM-DD.md` (CVE response SLA + carveout policy)
- Create or modify: `scripts/verify-supply-chain.sh` (the actual verification helper called by CI)

**Approach:**
- npm provenance verification: run `npm audit signatures` (or the pnpm equivalent) against the lockfile after install, fail the build on unsigned or unverifiable packages in the Flue transitive graph.
- The 48h CVE SLA + fork-and-pin contingency goes into the solutions doc, cross-referenced from the brainstorm's FR-3a and from the new package's README.
- Carveout: a CVE workaround that requires Flue source modification is permitted as an exception to FR-1/FR-3 (no Flue source modifications), provided (a) the patch is submitted upstream concurrently and (b) the fork is retired within 30 days of upstream acceptance.

**Patterns to follow:**
- Existing `.github/workflows/ci.yml` shape — pnpm install + lint + typecheck + test + format:check pattern.
- `docs/solutions/workflow-issues/` formatting for the CVE SLA doc.

**Test scenarios:**
- Happy path: CI passes provenance verification with the current lockfile.
- Failure path: a synthetic unsigned dep (test fixture) fails the verification step; CI fails appropriately.

**Verification:**
- CI workflow includes the provenance step and runs successfully on this plan's PR.
- The SLA doc is discoverable from the brainstorm's FR-3a section (cross-link).

---

- U11. **Multi-tenant isolation audit (FR-4a)**

**Goal:** Verify the multi-tenant isolation invariants implemented in U4/U7/U8/U9 hold under audit. Audit module-level Flue state (MCP connection pools, compaction caches) for cross-invocation persistence; confirm `session.task()` sub-agent spawns inherit the originating invocation's `tenantId` and cannot be overridden by agent-supplied parameters.

**Requirements:** R11. (Origin: FR-4a.)

**Dependencies:** U4, U7, U9.

**Files:**
- Create: `packages/agentcore-flue/agent-container/tests/integration/tenant-isolation.test.ts`
- Modify (if audit reveals gaps): the relevant tool, sandbox, or sessionstore files

**Approach:**
- Audit checklist:
  1. Aurora `SessionStore` (U4): all queries scope on tenantId; no shared connection pool that bridges invocations.
  2. MCP wiring (U7): no module-level `Map<endpoint, MCPClient>` cache that could leak across tenants.
  3. AgentCore CI connector (U8): each `createSessionEnv()` returns a fresh API instance; no shared session ID.
  4. Compaction (Flue's built-in): if compaction caches state across invocations, partition the cache by tenantId or clear it per invocation.
  5. `session.task()`: trusted handler sets the worker thread's tenantId; `task()` calls inherit by reading the worker's scope, not from agent-supplied parameters.
- Audit method: code review + integration test that invokes the runtime under tenant A, then under tenant B, then asserts no state leakage.

**Test scenarios:**
- Integration: write a sentinel via `session.shell` under tenant A, switch to tenant B's invocation, attempt to read the sentinel — fails (per AgentCore CI session isolation per spike verdict).
- Integration: spawn a `session.task()` sub-agent that attempts to read tenant B's data via `Aurora SessionStore` — fails because the worker's tenantId is A.
- Integration: agent-supplied tenantId override (via prompt injection) does not affect the actual SessionStore queries — they still use the handler-set tenantId.
- Audit: `git grep -l 'new Map' packages/agentcore-flue/agent-container/src/` audited for any module-level state that could leak.

**Verification:**
- All scenarios pass.
- Audit checklist documented in the test file's header comment with a one-line pass/fail per item.

---

- U12. **Mocked-AWS unit tests for AgentCore CI connector (residual P2)**

**Goal:** Add the unit tests deferred from spike U2: vitest scenarios against a mocked `BedrockAgentCoreClient` covering happy-path `exec` / `readFile` / `writeFile` / `readdir`, edge case `readFile` on missing path, mocked AWS error responses surface to caller cleanly.

**Requirements:** R12. (Residual P2 from FR-9a verdict.)

**Dependencies:** None.

**Files:**
- Create: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts`

**Approach:**
- Use `aws-sdk-client-mock` (already a dev dep in `packages/agentcore-pi/`) to mock `BedrockAgentCoreClient`.
- Cover the cases listed in spike plan U2's Test scenarios:
  1. `exec("echo hello")` resolves to `{ stdout: "hello\n", exitCode: 0 }` (mocked AWS response with structured content).
  2. `readFile("/tmp/test.txt")` returns the mocked content string.
  3. `writeFile("/tmp/test.txt", "data")` calls `InvokeCodeInterpreterCommand` with `name: "writeFiles"` and the right shape.
  4. `readFile` on a path that the mocked AWS client returns an error for → caller receives a typed error.
  5. `readdir` on an empty directory → `[]`.
  6. `mkdir` + `rm` round-trip → both succeed.
  7. Type-level: factory function returns an object whose `createSessionEnv()` produces a `SessionEnv`.

**Patterns to follow:**
- Spike plan: `docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md` U2 Test scenarios list (verbatim source for what to cover).
- `aws-sdk-client-mock` usage in `packages/agentcore-pi/agent-container/tests/` (existing examples).

**Test scenarios:** (the unit tests themselves are the deliverable — no nested test scenarios)

**Verification:**
- `pnpm --filter @thinkwork/flue-aws test` runs and all scenarios pass.

---

- U13. **Typed `CodeInterpreterStreamOutput` parsing (residual P3)**

**Goal:** Replace the `Record<string, unknown>` casts in `consumeStream` (and other parse points) with discriminated-union handling on the actual `CodeInterpreterStreamOutput` type from `@aws-sdk/client-bedrock-agentcore`.

**Requirements:** R13. (Residual P3 from FR-9a verdict.)

**Dependencies:** None.

**Files:**
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.ts`
- Modify: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` (verify the typed parsing doesn't regress behavior)

**Approach:**
- Read the `CodeInterpreterStreamOutput` type from `node_modules/@aws-sdk/client-bedrock-agentcore/dist-types/models/models_0.d.ts`.
- Replace the `for await (const event of stream) { const e = event as Record<string, unknown>; ... }` pattern with a properly-typed iteration that uses the SDK's discriminated-union members (`event.result`, `event.streamOutput.event`, etc.).
- Where structuredContent shapes vary by tool (executeCommand vs readFiles vs listFiles), narrow the type explicitly per branch.

**Patterns to follow:**
- The `@aws-sdk/client-bedrock-agentcore` types as the authoritative shape.

**Test scenarios:**
- Regression: all existing U12 mocked tests still pass with the typed parsing.
- Type-level: connector source typechecks with `strict: true` (already on per `tsconfig.base.json`) — no `as` casts on stream events.

**Verification:**
- `pnpm --filter @thinkwork/flue-aws typecheck` passes with no `as Record<string, unknown>` casts on stream events.
- `pnpm --filter @thinkwork/flue-aws test` passes.

---

### Phase 4: First agent + production validation

- U14. **Deploy first agent (deep researcher) on Flue runtime**

**Goal:** Create the deep researcher agent, configure it with `runtime: 'flue'`, wire it to use one MCP server (search), `session.task()` for child explore agents, at least one Python skill (e.g., result formatting), and AgentCore Memory. Validate end-to-end via admin and mobile chat.

**Requirements:** R14. (Origin: 2026-04-26 first-agent commitment + Success Criteria.)

**Dependencies:** U2, U3, U9, U6, U7 (the deep agent exercises every Phase 2 unit).

**Files:**
- Create: agent record / template definition (paths depend on existing seed/config pattern; likely `packages/system-workspace/templates/deep-researcher/AGENTS.md` + a seed script that creates the agent record with `runtime: 'flue'`)
- Modify: `packages/system-workspace/` skill catalog or workspace defaults to include the search MCP and the formatting Python skill
- Create: `docs/solutions/architecture-patterns/flue-deep-researcher-launch-2026-MM-DD.md` (operator runbook + observation log)

**Approach:**
- Compose AGENTS.md routing for the deep researcher with sub-agent paths (e.g., `agents/explore/`) so `session.task()` has a target.
- Pick a Python skill that's safe to exercise — result formatting is good (deterministic, no side effects).
- Configure MCP search server: pick an existing one already wired for some other agent (avoids new connector work).
- Validate via admin and mobile chat: ask the agent to research a small topic, confirm sub-agent fan-out happens (visible in trace), confirm Python skill is invoked, confirm Memory is consulted.

**Patterns to follow:**
- Existing agent template seeding patterns in `packages/system-workspace/`.
- 2026-04-26 brainstorm's "first agent = deep researcher with sub-agent fan-out" specification.

**Test scenarios:**
- Happy path: end-user chat to the deep researcher returns a research summary with sub-agent traces visible. *Covers FR-F2.*
- Happy path: agent calls the search MCP, receives results, calls `session.task()` to expand on a finding, returns to top-level loop, calls the Python format skill, returns.
- Edge case: invocation without an MCP token (user not OAuth'd to search) → tool returns auth error gracefully; agent surfaces "I need search access to research this."
- Integration: token usage, completion success, latency, AgentCore Eval scores captured for this agent (data flows to the existing dashboards).

**Verification:**
- A test conversation with the deep researcher returns useful output through admin and mobile.
- Eval scores comparable to the equivalent Strands-routed reference agent (or divergence explained).
- The launch doc captures concrete observations: prompt visibility (yes/no), dispatch ergonomics (notes), debugging experience (notes).

---

- U15. **DX comparison doc + 2-week production traffic gate**

**Goal:** Write the durable DX comparison doc covering prompt visibility, dispatch ergonomics, debugging, customization headroom, observability fidelity, and trusted-handler-injection ergonomics. Track production metrics for the deep researcher on Flue against an equivalent Strands reference for ≥2 weeks.

**Requirements:** R15. (Origin: Success Criteria.)

**Dependencies:** U14.

**Files:**
- Create: `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-2026-MM-DD.md`
- (No code changes — this unit is a documentation + observation deliverable.)

**Approach:**
- Author the comparison doc within the first week of production traffic; capture concrete observations from U14's work + ongoing maintenance.
- Sections (right-sized): prompt visibility (where do agents see the system prompt), dispatch ergonomics (how does the trusted handler feel to extend), debugging (how do we trace a bad turn), customization headroom (where do we hit Flue's limits), observability fidelity (parity with Strands? gaps?), trusted-handler-injection ergonomics (vs Strands' decorator-based tool injection).
- Track metrics (token usage, completion success rate, latency p50/p95, AgentCore Eval scores) for ≥2 weeks. Capture in a trailing addendum to the comparison doc.
- Verdict at end: did the reframe pay off? Note follow-up work if it didn't.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` and `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md` for tone and structure.

**Test scenarios:**
- Test expectation: none — pure documentation + observation.

**Verification:**
- Comparison doc exists with all six sections populated.
- Metrics addendum covers ≥2 weeks of production traffic.
- A reader new to the project can decide from the doc whether Flue or Strands is right for a future agent template.

---

## System-Wide Impact

- **Interaction graph:** New AgentCore runtime ID joins the dispatch path. `chat-agent-invoke` Lambda already supports per-call runtime selection (carried from 2026-04-26); U3 extends the dispatcher to handle `flue`. Completion callback path unchanged (existing `/api/skills/complete` contract).
- **Error propagation:** Handler resolves secrets at invocation time and surfaces all errors synchronously (no fire-and-forget). 401 from completion callback surfaces as a hard error to `chat-agent-invoke`. MCP token-handle resolution failures surface as typed errors to the agent loop.
- **State lifecycle risks:** AgentCore CI sessions are created per-invocation and cleaned up via `cleanup: true`. `session.task()` sub-agents spawn fresh sessions (no cross-task queueing). MCP connection pools are not module-level (audited per U11). Aurora SessionStore connections are per-invocation; no shared pool that could bridge tenants.
- **API surface parity:** Strands runtime stays unchanged. The completion-callback contract, AgentCore Memory + Hindsight surfaces, and `/api/skills/complete` shape are reused without modification. The only operator-facing API change is the runtime selector enum (R3).
- **Integration coverage:** The integration test surface is large — Aurora SessionStore + AgentCore CI + Bedrock + MCP + Python skill subprocess + completion callback all need to compose correctly. U9 + U11 + U14 collectively exercise the full stack; mocked unit tests in U12/U13 cover the connector layer.
- **Unchanged invariants:** Strands runtime behavior, completion-callback contract, AgentCore Memory + Hindsight backing stores, S3 skill catalog format, AGENTS.md composition rules, agent record schema (other than the runtime enum value rename in U3).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Flue's `SessionStore` interface requires turn-level semantics that Drizzle thread-history rows don't expose | U4 introduces a translation layer at the adapter boundary; documented in the file's header comment. If the gap is wider than a translation layer can paper over, U4 returns a planning-time blocker rather than papering over with a partial impl. |
| AgentCore CI cold-start latency for `session.task()` sub-agents (per spike Gotchas: ~hundreds of ms per session) becomes user-visible | Measure during U14 deep-researcher launch. If p95 latency regresses meaningfully vs Strands, U8 revisits the per-task vs shared-session strategy with concrete numbers. Captured in U15 DX doc regardless. |
| Worker-thread + token-handle resolution for MCP (U7) is more complex than budgeted | Test-first execution note for U7 reduces the risk of paving over a leak. Fallback is process-level isolation (separate child process per invocation), at higher cost; documented in U7 if reached. |
| Flue ships a breaking change to `init()` / `SessionStore` / `SandboxFactory` / `ToolDef` mid-development | FR-10a tripwires (origin) — pinned `@flue/sdk` version in lockfile, monthly upgrade cadence, integration-test suite is the gate. U10 enforces the pin via provenance check. |
| `chat-agent-invoke` Lambda's runtime-selector plumbing doesn't support a 3-way dispatch as cleanly as origin assumed | Origin Outstanding Question. U3 surfaces this concretely; if the dispatcher needs material refactor, that work is its own unit (split out of U3 if needed). |
| Multi-tenant isolation gap discovered post-launch in production | FR-4a guards (U11 audit + integration tests) front-load the discovery. If a leak is discovered in production, the runtime selector lets us roll affected agents back to Strands per-agent without a deploy. |
| Python skill subprocess cold-spawn latency (each `run_skill` call) exceeds budget | Origin OQ deferred to implementation. U5 starts with cold spawn; if measurable in U14 latency tracking, follow-up plan introduces a warm worker pool or Unix socket protocol. |
| The 2-week production observation window in U15 surfaces a deal-breaker (e.g., compaction misbehavior, observability gap, eval-score regression) | U15's verdict explicitly accepts this outcome — the comparison doc captures the gap, and the runtime selector means existing Strands agents are unaffected. |
| Flue's pre-1.0 status causes a security CVE during production | FR-3a (U10) carveout: a security patch may be applied to a ThinkWork fork without upstream merge first, provided it's submitted upstream concurrently and the fork retired within 30 days of upstream acceptance. 48h CVE response SLA documented. |

---

## Documentation / Operational Notes

- **Deploy ordering:** U2 (terraform) must apply before U3 (selector) — otherwise the dispatcher would route to a non-existent runtime ID. The data migration in U3 is idempotent and runs after the new code lands.
- **Rollback:** any agent flipped from `strands` to `flue` can be flipped back without data loss (thread history schema is shared per R4). The Flue runtime ID stays provisioned even if no agents are using it.
- **Monitoring:** existing AgentCore + CloudWatch dashboards extend to the Flue runtime via the new function name. AgentCore Eval scores flow into the same store (per origin).
- **Runbook:** U14's launch doc covers operator-facing concerns (how to flip an agent, how to read the Flue trace, what to do if the agent loops). U15's comparison doc captures DX-side notes for engineers.
- **Hindsight URL:** Flue runtime container env needs `HINDSIGHT_API_URL` (existing convention from Strands). Terraform U2 provisions this.
- **OpenTelemetry:** deferred per Scope Boundaries; Flue traffic uses CloudWatch + structured logs at v1, with OTel parity as a follow-up plan when a concrete observability gap is named.

---

## Phased Delivery

### Phase 1: Foundation (U1, U2, U3)

Lands first because everything downstream depends on the renamed package, the provisioned runtime, and the working selector. Phase 1 ships behind the existing `strands` default — operators see no change until Phase 2 wires Flue end-to-end and Phase 4 launches the first agent.

### Phase 2: Harness Integration (U4, U5, U6, U7, U8, U9)

The bulk of the work. U9 (handler) is the integration point that ties U4-U8 together; treat U4-U8 as parallel-developable units and U9 as the convergence unit. U7's worker-thread design has the highest implementation risk — it gets test-first execution.

### Phase 3: Productionization (U10, U11, U12, U13)

Boundary controls (U10, U11) and the spike residuals (U12, U13). Can land in parallel with Phase 4 once Phase 2 is stable.

### Phase 4: Validation (U14, U15)

U14 ships the first agent; U15 captures the durable DX comparison and runs the 2-week production observation. The 2-week soak is the actual success gate per origin Success Criteria — the plan's `status: active → completed` flip in `ce-work` Phase 4 fires only after U15's verdict lands.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md](docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md)
- **FR-9 verdict (Flue feel spike):** [docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md](docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md)
- **FR-9a verdict (integration spike):** [docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md](docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md)
- **Spike plan (FR-9a):** [docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md](docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md)
- **Residual review findings:** [docs/residual-review-findings/feat-flue-fr9a-integration-spike.md](docs/residual-review-findings/feat-flue-fr9a-integration-spike.md)
- **Spike code seed (merged in #783):** `packages/flue-aws/`
- **Superseded plans:**
  - `docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md`
  - `docs/plans/2026-04-27-001-test-pi-runtime-tools-mcp-memory-e2e-plan.md`
  - `docs/plans/2026-04-27-002-feat-pi-runtime-tool-execution-plan.md`
  - `docs/plans/2026-04-29-002-fix-pi-context-engine-split-tools-plan.md`
- **Strands runtime reference:** `packages/agentcore-strands/agent-container/container-sources/server.py`
- **AgentCore Code Interpreter terraform pattern:** `terraform/modules/app/agentcore-code-interpreter/main.tf`
- **External: Flue 0.3.10 source** at `~/Projects/flue/packages/sdk/src/{agent,session,sandbox,mcp,roles}.ts` (cloned during the spike).
