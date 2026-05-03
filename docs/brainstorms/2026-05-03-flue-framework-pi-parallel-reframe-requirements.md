---
date: 2026-05-03
topic: flue-framework-pi-parallel-reframe
related: docs/brainstorms/2026-04-26-pi-agent-runtime-parallel-substrate-requirements.md
---

# Reframing the Pi Parallel Runtime Around Flue

## Summary

Replace scoping commitment #1 of the 2026-04-26 Pi parallel brainstorm — "vendor selectively from oh-my-pi" — with "depend on `@flue/sdk` upstream, run an unmodified Flue harness inside a new AgentCore runtime named **Flue**, and integrate ThinkWork resources only through Flue's documented extension points." Two structural additions to 2026-04-26 scope (flagged explicitly): (a) Daytona as an operator-selectable second sandbox tier, gated on data-residency review (FR-6a); (b) an AgentCore Code Interpreter sandbox connector designed for upstream contribution (FR-8, lower-priority structural goal). All other commitments from 2026-04-26 are preserved. Plan revision is gated on **two** spikes — FR-9 (Flue feel — completed 2026-05-03 with verdict PROCEED-WITH-REFRAME) and FR-9a (AgentCore Code Interpreter integration + Bedrock routing — outstanding).

## Problem Frame

The 2026-04-26 Pi parallel brainstorm committed to vendoring specific oh-my-pi extensions (MCP, sub-agent task primitives) into the ThinkWork repo to fill what pi-mono lacks. A week of work has shipped against that strategy: `packages/agentcore-pi/` exists, depends on `@mariozechner/pi-agent-core` 0.70.2, has tests + Dockerfile + Lambda Web Adapter wiring, and has 144 KB of plan plus three follow-up plans on top.

Flue (`@flue/sdk` by FredKSchott / the Astro team) layers an opinionated TypeScript framework on top of pi-mono — agent-as-deployable-workspace, programmable headless harness, build pipeline, per-call role overlays with `agent < session < call` precedence, `flue add <connector>` distribution, `init()`-based trusted-handler injection, `SessionStore` interface, `SandboxFactory`, `ToolDef` contract — using the same `pi-agent-core` 0.70.2 substrate the existing `packages/agentcore-pi/` already pins. Flue is not "the same substrate, just upstream"; adopting it means accepting Flue's architectural opinions on top of shared low-level deps.

**Audience for "meaningfully different."** The 2026-04-26 brainstorm's stated product intent — Pi should "feel meaningfully different from Strands as a harness" — is honored at the **platform-engineer audience** (full prompt ownership, programmable extension points, no Strands-style hidden injection). It is **not** operator-visible or end-user-visible: FR-AE1 and FR-F2 outcome both demand responses indistinguishable from Strands, by design. The per-agent runtime selector is engineering optionality, not a user-decision-rule. Operator-facing nomenclature for the tier (currently `flue`) is open (see Outstanding Questions).

**Trusted-handler injection pattern.** Flue's design — confirmed by code read and by the FR-9 spike — is "trusted handler mints all per-invocation resources, harness runs the loop." Three direct examples in Flue's README (MCP via `connectMcpServer` with secrets from `env`; Cloudflare R2 mounted as agent filesystem via `getVirtualSandbox`; Daytona container provisioned per invocation) match the shape ThinkWork already uses. ThinkWork-specific resources — S3 skill catalog, per-user OAuth-authenticated MCP servers, AgentCore Memory + Hindsight, Aurora thread history, workspace files, S3-event triggers, completion callback — all plumb through Flue's documented `init()` options and pluggable interfaces with zero Flue source modifications.

**Resolution paths from 2026-04-26 (each integration-confirmed during planning, not pre-resolved by Flue's mere existence).**
- MCP via `@modelcontextprotocol/sdk` streamable HTTP — Flue ships the dep at `packages/sdk/src/mcp.ts`. Integration check: confirm `connectMcpServer` accepts our per-user OAuth bearer headers without modification, with token-handle isolation per FR-3a.
- Sub-agent task primitives — `session.task(prompt, { cwd, role })` is documented and exercised by the FR-9 spike. Integration check: confirm semantics match `delegate_to_workspace` (S3-event triggers, completion callback, dual-keyed thread storage) or scope the gap.
- Session-store boundary — Flue's `SessionStore` interface is the boundary; we implement an Aurora-backed adapter. Integration check: confirm signature accepts thread-history rows without translation layer (FR-9a verifies).
- Sandbox abstraction — Flue's `SandboxFactory` is documented and exercised against Daytona by the FR-9 spike. Integration check: confirm `BashLike` is implementable against AgentCore Code Interpreter (FR-9a verifies).

**Structural constraints.** No Flue fork or Flue source modifications (FR-1, FR-3), with a CVE-workaround carveout (FR-3a). The AgentCore-side integration is structured to allow eventual upstream contribution (FR-8, lower-priority).

## Actors

Carry forward from `docs/brainstorms/2026-04-26-pi-agent-runtime-parallel-substrate-requirements.md`: A1 Operator, A2 ThinkWork agent, A3 End user, A4 Platform engineer. No new actors.

## Key Flows

- **FR-F1.** Operator routes an agent to the Flue runtime
  - Trigger: Operator changes the agent's runtime selector to `flue` in admin.
  - Actors: A1, A2
  - Steps: Same dispatch path as 2026-04-26 F1; the runtime selector is extended with the `flue` value alongside `strands`. Adding the value requires extending the `AgentRuntime` GraphQL enum (`packages/database-pg/graphql/types/agents.graphql`), the `AgentRuntimeDb`/`AgentRuntimeType` union literals, and the dispatcher conditional in `packages/api/src/lib/resolve-runtime-function-name.ts`. Whether the dispatch is later refactored into a registry shape is deferred to /ce-plan.
  - Outcome: Subsequent chat turns for that agent execute in the Flue AgentCore runtime, with thread history, memory, MCP servers, sub-agent paths, skills, and tools all available.
  - Covered by: FR-2, FR-3, FR-4

- **FR-F2.** End-user chat hits the Flue runtime, exercising the full tool surface
  - Trigger: End user sends a message to an agent flagged `runtime: flue`.
  - Actors: A3, A2
  - Steps: `chat-agent-invoke` Lambda dispatches to the Flue AgentCore runtime ID → Flue container's trusted handler runs → handler resolves `API_AUTH_SECRET` from Secrets Manager (FR-4b) and mints all per-invocation resources (sandbox = AgentCore Code Interpreter or Daytona per FR-F3, MCP server tools with OAuth token-handle isolation per FR-3a, AgentCore Memory + Hindsight tools, Aurora-backed `SessionStore` keyed on tenant per FR-4a, Bedrock model + provider settings, role + cwd from agent record) → handler calls `init()` from `@flue/sdk` and `session.prompt()` → harness loop runs → response returns → handler POSTs `/api/skills/complete` with token usage and metadata.
  - Outcome: End user sees a response indistinguishable from the same agent on Strands; all ThinkWork-specific logic lives at the boundary, not inside the Flue harness.
  - Covered by: FR-1, FR-3, FR-3a, FR-4, FR-4a, FR-4b, FR-5, FR-6, FR-7

- **FR-F3.** Operator selects sandbox tier per agent
  - Trigger: Operator changes an agent's sandbox setting in admin.
  - Actors: A1, A2
  - Steps: Default is AgentCore Code Interpreter. Daytona is a documented future option, becoming a live operator selection only after FR-6a's three gates close.
  - Outcome: The selected sandbox is provisioned at session start.
  - Covered by: FR-5, FR-6, FR-6a

- **FR-F4.** Two-spike validation precedes plan revision
  - Trigger: Platform engineer runs FR-9 (completed) and FR-9a (outstanding).
  - Actors: A4
  - Steps: FR-9 (1 hour, completed 2026-05-03 with verdict PROCEED-WITH-REFRAME) validated Flue feel + Daytona connector consumption against `examples/hello-world/`. FR-9a (4-6 hours, outstanding) builds an AgentCore Code Interpreter `SandboxFactory` against the real AWS service and verifies Bedrock model routing through Flue's `providers` config.
  - Outcome: Plan revision unlocks only when both spikes pass.
  - Covered by: FR-9, FR-9a

## Requirements

- **FR-1.** The new AgentCore runtime is named "Flue" and runs an unmodified `@flue/sdk` agent loop inside the container.
- **FR-2.** The runtime selector adds `flue` as a value alongside `strands`. Adding it requires extending the `AgentRuntime` GraphQL enum, the `AgentRuntimeDb`/`AgentRuntimeType` union literals, and the dispatcher conditional in `packages/api/src/lib/resolve-runtime-function-name.ts`. Whether the dispatch is refactored into a registry shape is deferred to /ce-plan; v1 ships as a switch extension.
- **FR-3.** All ThinkWork resources are injected at invocation time only through Flue's documented extension points: `init({sandbox})`, `init({tools})`, `init({model, providers})`, custom `SessionStore`, `init({role, cwd, id})`, and `payload` + `env`. No Flue source modifications, with the CVE-workaround carveout in FR-3a.
- **FR-3a.** Supply-chain integrity and CVE response: CI verifies `@flue/sdk` and its full transitive graph (through `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@modelcontextprotocol/sdk`, `just-bash`) against npm provenance attestation on every install. The Flue runtime container runs the agent loop in a separate Node `worker_thread` or child process from the trusted handler; OAuth bearer tokens are passed as opaque token-handle references and resolved on the handler side at MCP request time, never serialized into `ToolDef` objects passed to `init({tools})`. The Aurora-backed `SessionStore` adapter explicitly excludes any header value matching a bearer-token pattern from persisted compaction payloads. CVE response SLA: 48 hours. CVE workaround that requires Flue source modification is permitted as an exception to FR-1/FR-3 if submitted upstream concurrently and the fork is retired within 30 days of upstream acceptance.
- **FR-4.** The Flue runtime reuses, without duplication: the existing S3 skill-catalog filesystem, per-user OAuth-authenticated MCP servers, AgentCore Memory + Hindsight, workspace files, S3-event orchestration triggers, Aurora thread history, and the `/api/skills/complete` completion-callback contract.
- **FR-4a.** Multi-tenant isolation: the Aurora-backed `SessionStore` adapter keys all queries on `(tenantId, agentId, sessionId)` and fails closed if `tenantId` is absent from invocation context. Module-level state in the Flue container (MCP connection pools, compaction caches) is audited for cross-invocation persistence and either cleared per invocation or partitioned by `tenantId`. `session.task()` sub-agent spawns inherit the originating invocation's `tenantId` binding and cannot be overridden by agent-supplied parameters.
- **FR-4b.** Completion-callback auth and secret resolution: handler resolves `API_AUTH_SECRET` from Secrets Manager at invocation time (not module load), to survive the AgentCore env-injection race documented in `project_agentcore_deploy_race_env`. A 401 response from `/api/skills/complete` surfaces as a hard error to the invoking Lambda rather than a silent drop.
- **FR-5.** The default sandbox for the Flue runtime is AgentCore Code Interpreter, exposed to Flue as a custom `SandboxFactory` (or `BashFactory`). The connector documents the supported subset of `BashLike` operations (file I/O, code execution, shell-like operations) and explicitly names what it does not support; FR-9a verifies the gap is acceptable before plan revision.
- **FR-6.** Daytona is documented as a future operator-selectable sandbox via Flue's existing `flue add daytona` upstream connector, with no ThinkWork-side bundling. It becomes a live operator selection only after FR-6a closes.
- **FR-6a.** Daytona availability is gated on three closures: (a) audit of the upstream `flue add daytona` connector source enumerating exactly what data transmits to Daytona's API; (b) explicit admin-UI disclosure to operators that selecting Daytona routes execution data outside AWS infrastructure; (c) DPA review against enterprise tenant contractual data-residency requirements. Until all three close, Daytona stays a documented future option, not an admin runtime tier.
- **FR-7.** Python script-skills execute via subprocess, exposed to the Flue session as a tool (`run_skill` or equivalent) through `init({tools})`. Flue's `session.skill()` API is reserved for any future markdown-prompt-only skills; the existing skill-catalog is not rewritten.
- **FR-8.** The AgentCore Code Interpreter `SandboxFactory` is structured to minimize ThinkWork-monorepo imports where the cost is low, preserving the option to extract for upstream contribution. Where ThinkWork-internal logging, observability, or tenant-context resolution would otherwise duplicate, monorepo imports are accepted. Lower-priority structural goal; ThinkWork goals win on conflict. Flue maintainer-acceptance posture is unverified.
- **FR-9.** Hands-on Flue spike (1 hour) — **completed 2026-05-03 with verdict PROCEED-WITH-REFRAME**. Verdict at `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md`. Validated: prompt visibility, dispatch ergonomics, custom `ToolDef` injection, `session.task()` semantics, virtual sandbox, real Daytona container end-to-end. Did NOT validate: AgentCore Code Interpreter compatibility, Bedrock model routing, multi-tenant context propagation, MCP with real OAuth tokens, Aurora `SessionStore` interface fit, authoring a new connector.
- **FR-9a.** Integration spike (4-6 hours) — **outstanding**. Builds an AgentCore Code Interpreter `SandboxFactory` against the real AWS service and verifies one round-trip command (`bash -c "echo hello"` equivalent) succeeds; verifies Flue's `providers` config can route to `amazon-bedrock` (or names the gap if it can't); produces the AgentCore Code Interpreter capability matrix (supported `BashLike` operations vs gaps); cites or behaviorally tests AgentCore Code Interpreter's tenant-isolation guarantee. Verdict written to `docs/solutions/`. Plan revision unlocks only on FR-9a green.
- **FR-10.** Risk posture for `@flue/sdk`: pinned version in `pnpm-lock.yaml`; monthly upgrade cadence; integration-test suite anchors the upgrade gate (each upgrade attempt runs the suite before the upgrade ships); fork-and-pin contingency. Material simplification vs 2026-04-26: per-SHA vendor tracking and `PROVENANCE.md` maintenance disappear; lockfile pinning replaces them.
- **FR-10a.** Tripwires for re-decision: if Flue ships >2 breaking changes per quarter to extension-point interfaces (`init()`, `SessionStore`, `SandboxFactory`, `ToolDef`, MCP), or no commits in 90+ days, escalate to retire decision. The integration-test suite pins ThinkWork's coverage against future Flue releases.

## Acceptance Examples

- **FR-AE1.** Covers FR-1, FR-3, FR-3a, FR-4, FR-4a, FR-4b. Given an agent on the Flue runtime, when end-user chat triggers an invocation, the trusted handler successfully resolves `API_AUTH_SECRET` from Secrets Manager + mints AgentCore Code Interpreter sandbox + at least one MCP tool with OAuth token-handle isolation + AgentCore Memory tools + Aurora-backed `SessionStore` keyed on tenantId + Bedrock model, passes them all to `init()` from `@flue/sdk`, and `session.prompt()` returns a response indistinguishable from the same agent on Strands.
- **FR-AE2.** Covers FR-2. Given an agent on the Strands runtime with thread history, when an operator flips its runtime selector to `flue`, the next invocation dispatches to the Flue AgentCore runtime ID and the conversation continues with thread history loaded from Aurora unchanged.
- **FR-AE3.** Covers FR-5, FR-6a. Given an agent on the Flue runtime with default sandbox, invocations use AgentCore Code Interpreter; Daytona is not selectable in admin until FR-6a's three gates close.
- **FR-AE4.** Covers FR-7. Given a Python script-skill in the existing skill-catalog, when the Flue agent calls the `run_skill` tool, the existing Python subprocess bridge executes the skill and returns its result, with no rewriting of the skill source.
- **FR-AE5.** Covers FR-9a. Given the FR-9a integration spike completed by a platform engineer, the artifact is a written verdict in `docs/solutions/` with the AgentCore Code Interpreter capability matrix (supported vs unsupported `BashLike` operations) and a Bedrock-routing pass/fail.

## Success Criteria

Carry forward from 2026-04-26:
- **At least one production agent serves real end-user traffic from the Flue runtime end-to-end (admin/mobile) for ≥2 weeks**, exercising MCP, sub-agent delegation via `session.task()`, and at least one Python skill in real conversations.
- **Operators can choose the runtime per agent in admin without engineering involvement** and can flip an agent back to Strands at any time without data loss.
- **A documented DX comparison lands in `docs/solutions/`**: prompt visibility, dispatch ergonomics, debugging, customization headroom, observability fidelity, trusted-handler-injection ergonomics.
- **Token usage, completion success rate, latency, and AgentCore Eval scores are comparable** between the Flue-routed agent and an equivalent Strands-routed reference (or are explained when they diverge).
- **Downstream `/ce-plan` has enough scope clarity to break this work into shippable units** without inventing product behavior or harness semantics.

New for this reframe:
- **Zero modifications to `@flue/sdk` source in the ThinkWork repo**, except CVE workarounds per FR-3a's exception clause.
- **Both spikes (FR-9 and FR-9a) capture verdicts in `docs/solutions/` as permanent artifacts** regardless of outcome.

## Scope Boundaries

- **Forking Flue, patching Flue internals, or monkey-patching Flue session/agent classes** — out, except CVE workarounds per FR-3a.
- **Bundling Daytona as a ThinkWork-specific connector** — out. Operators install the upstream Flue connector after FR-6a gates close.
- **Replacing or retiring the Strands runtime** — out (carried from 2026-04-26).
- **Migrating existing Strands agents off** — out (carried from 2026-04-26).
- **Adopting Flue's marketing framing for ThinkWork product positioning** — out (separate doc if pursued).
- **Rewriting the existing Python skill-catalog as TS-native Flue skills** — out. FR-7 is the integration path.
- **The "skip AgentCore container hosting on the Pi side, deploy via `flue build --target node` to plain Lambda" stretch alternative** — captured here as a future option, explicitly not pre-decided in v1 scope.

## Key Decisions

- **Reframe scoping commitment #1 of 2026-04-26.** Replace "vendor selectively from oh-my-pi" with "depend on `@flue/sdk` upstream and integrate via documented extension points only." Same `pi-agent-core` 0.70.2 substrate; vendoring strategy retired; one upstream maintained instead of two. The simplification is real: per-SHA vendor tracking and `PROVENANCE.md` maintenance disappear; lockfile pinning replaces them.
- **Preserve scoping commitment #2 of 2026-04-26.** Full capability parity at v1 stays.
- **Default sandbox = AgentCore Code Interpreter.** AWS-native, managed. Tenant-isolation guarantee unverified (see Dependencies). Daytona is the escape hatch for operators who need full Linux, gated on FR-6a.
- **Strands stays default** for existing and new agents (carried from 2026-04-26).
- **Per-agent runtime selector extends with `flue`.** Switch-shaped extension is sufficient in v1; no registry abstraction. If a third harness is ever added, registry refactor happens then.
- **Python script-skills plumb through `init({tools})`.** Single skill catalog stays.
- **Two-spike gate.** FR-9 (Flue feel — done) unlocks the integration spike FR-9a; FR-9a (AgentCore CI + Bedrock routing) unlocks plan revision. The 1-hour-spike-gates-multi-week-reframe gradient is replaced by a stepped commitment.
- **AgentCore Code Interpreter sandbox is structurally biased toward upstream-contributable shape, not strictly enforced.** ThinkWork-internal imports are accepted where alternatives would duplicate.

## Dependencies / Assumptions

- *[Verified by code read]* `@flue/sdk` accepts a custom `SandboxFactory` / `BashFactory`, custom `ToolDef[]`, custom `SessionStore`, and `init({model, providers})` — verified against `packages/sdk/src/{agent,session,sandbox,mcp,roles}.ts` in the Flue repo and the README's MCP / R2 / Daytona examples.
- *[Verified by code read]* Flue depends on `@mariozechner/pi-agent-core` 0.70.2 and `@mariozechner/pi-ai` 0.70.2 — the same versions `packages/agentcore-pi/package.json` already pins.
- *[Verified by FR-9 spike]* Flue's `session.task()`, custom `ToolDef` injection, role overlays, and Daytona connector all work end-to-end against `examples/hello-world/`.
- *[Partially verified]* `packages/agentcore-pi/Dockerfile` already builds Node 20 + Lambda Web Adapter 0.9.1 + `/ping` + `/invocations` against the AgentCore container contract. Remaining unknown: deployed AgentCore runtime provisioning accepts this image; Terraform does not yet provision an `agentcore-pi` (or `agentcore-flue`) runtime.
- *[Unverified, gated by FR-9a]* AgentCore Code Interpreter's API surface is sufficient to implement Flue's `BashLike` / `SessionEnv` interface. The existing `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts` enforces `language: python` only — mapping shell semantics onto a Python-only `InvokeCodeInterpreter` is either lossy (everything wrapped in `subprocess.run`) or requires rebuilding the base image. FR-9a picks one.
- *[Unverified, gated by FR-9a]* Flue's `providers` config can route models to `amazon-bedrock`. Existing Pi container calls `pi-ai`'s `getModel('amazon-bedrock', ...)` directly; Flue's higher-level `init({model, providers})` API takes prefixed strings (`anthropic/...`). FR-9a confirms the routing path or names the gap.
- *[Unverified, requires AWS doc citation]* AgentCore Code Interpreter is scoped per-tenant. If pool-based with cross-tenant reuse, residual filesystem state, env vars, or process memory could leak across tenants. Verify during FR-9a (citation or behavioral test) before FR-5 is finalized.
- *[Unverified]* Flue's `SessionStore` interface signature is rich enough to back onto Aurora thread-history rows via Drizzle. Pluggability is confirmed in the README; exact signature shape needs cross-check during planning. FR-9a touches this.
- *[Assumption]* Flue's pre-1.0, "experimental" status remains tolerable through the upgrade cadence + integration-test gate + tripwires (FR-10, FR-10a). Material difference from 2026-04-26's pi-mono assumption: Flue is the entire harness layer (qualitatively larger blast radius than `pi-agent-core` alone), so the tripwires matter more.
- *[Assumption]* The Flue maintainers (FredKSchott + the Astro team) accept a sandbox connector PR for AgentCore Code Interpreter without requiring a new connector category. The `connectors/README.md` in Flue explicitly invites new connectors within the existing `sandbox` category.
- *[Assumption]* A new build target (`--target agentcore-aws`), if we end up wanting it, requires Flue-team RFC. The sandbox connector alone can land first regardless.
- *[Assumption]* Flue remains MIT-licensed and actively maintained by upstream. Fork-and-pin contingency is the same posture as 2026-04-26's pi-mono contingency, sized larger to reflect the wider surface area.

## Outstanding Questions (deferred to planning)

- *[Affects FR-3, FR-4]* Concrete shape of the Aurora-backed `SessionStore` adapter: does Flue's `SessionStore` interface map 1:1 onto thread-history rows, or do we need a translation layer for thread/role/turn semantics? FR-9a touches this.
- *[Affects FR-5]* AgentCore Code Interpreter API shape: precise capability matrix (supported vs unsupported `BashLike` operations). FR-9a produces this.
- *[Affects FR-7, carried from 2026-04-26]* Python skill subprocess strategy: cold spawn vs warm worker pool vs Unix-socket protocol.
- *[Affects FR-4]* AgentCore Memory + Hindsight: surface as MCP servers vs custom `ToolDef[]`?
- *[Affects FR-2]* `chat-agent-invoke` Lambda's runtime-selector plumbing: confirm the dispatcher accepts a third value cleanly; whether to introduce a registry vs keep the switch is part of this.
- *[Affects FR-8]* What does the Flue team consider acceptable for the AgentCore sandbox connector PR — file structure, license headers, test coverage expectations, prior coordination requirements?
- *[Affects FR-1, carried from 2026-04-26]* OpenTelemetry distro shape for Node + AgentCore — match the Strands container's instrumentation surface.
- *[Affects operator-facing UX]* Operator-facing nomenclature for the runtime tier: keep `flue` (vendor name), rename to descriptive (`node-typescript` or similar), or hide behind an engineering feature flag entirely (no operator-visible selector). Decision deferred to admin UI design.
- *[Affects FR-1, FR-2]* Naming relationship between the in-flight `packages/agentcore-pi/` and the Flue-shaped runtime: does the existing Pi container repurpose to become the Flue runtime container (rename + replace contents), does Flue stand up a separate `packages/agentcore-flue/`, or do both coexist? The 2026-04-26 vendoring track and the Flue reframe currently both target the same physical container slot.
- *[Affects 2026-04-26 first-agent commitment]* Deep-researcher launch timeline impact: how does the multi-week reframe affect the first-agent commitment? Quantify salvageable work from `packages/agentcore-pi/` (pi-agent-core dep, AgentCore container scaffolding, tests around the boundary) vs discarded (vendored MCP/task primitives if those merged), and net redirect cost in eng-days.

## Next Steps

1. **FR-9 hands-on Flue spike — DONE** (2026-05-03, verdict PROCEED-WITH-REFRAME at `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md`).
2. **Run FR-9a integration spike (4-6 hours).** Build an AgentCore Code Interpreter `SandboxFactory` against the real AWS service; verify Bedrock model routing through Flue's `providers` config; capture capability matrix + tenant-isolation citation + verdict to `docs/solutions/`.
3. **If FR-9a verdict = green:** revise the 2026-04-26 plan + the three follow-up plans to swap "vendor oh-my-pi" tasks for "implement Flue extension-point integrations." Trigger `/ce-plan` with this brainstorm + both spike artifacts as input.
4. **If FR-9a verdict = AgentCore CI gap is wider than tolerable but Bedrock routing works:** decide between (a) wrap-in-python with documented degraded shell semantics, (b) rebuild the AgentCore CI base image (then re-evaluate FR-8 separability + R13 lineage), (c) make Daytona the practical default and AgentCore CI a future option. Capture the decision as an addendum.
5. **If FR-9a verdict = Bedrock routing is broken:** identify the specific gap; if it requires a Flue feature ask, the reframe blocks (FR-1/FR-3 violation). Re-decide between staying on the vendoring track or accepting the FR-1/FR-3 carveout.
6. **Intermediate rollback gate during execution.** At the end of the first integration unit (AgentCore CI `SandboxFactory` + Aurora `SessionStore` adapter both pass an end-to-end smoke against a single agent), evaluate whether to continue. Named fall-back: if either fails irrecoverably, revert to the 2026-04-26 vendoring plan; the in-flight `packages/agentcore-pi/` work survives intact since both paths share `pi-agent-core` 0.70.2.
