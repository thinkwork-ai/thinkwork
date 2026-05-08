---
title: ThinkWork Computer on Strands
type: feat
status: active
date: 2026-05-07
origin: docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md
---

# ThinkWork Computer on Strands

## Summary

Build the ThinkWork Computer on the Strands agent loop in three substrate layers: a new shared Python package `packages/computer-stdlib/` for tools and primitives, a new long-lived Python container `packages/computer-strands/` deployed to the existing `thinkwork-${stage}-computer-runtime` ECR (replacing the TS task-dispatcher), and a CE-derived skills folder + `load_skill` + adapter shims shipped only with a separate `packages/coding-worker-strands/` delegated worker. The existing per-Computer ECS+EFS reconciler in `terraform/modules/app/computer-runtime/` is preserved unchanged. Strands' first-class interrupt primitive bridges through a new `inbox.type='computer_approval'` row to mobile and back, with paused session state durable across ECS restart via a custom Aurora-backed SessionManager. The plan delivers in five phases ending with one golden workflow end-to-end on Eric's dev tenant.

---

## Problem Frame

The 2026-05-06 Computer reframe committed the Computer to ECS+EFS, always-on, per-user. The 2026-05-07 brainstorm committed Strands as the single foundation for the Computer and delegated workers. Today, `packages/computer-runtime/` is a TypeScript task-dispatcher with no model and no real tool surface; `packages/agentcore-strands/` runs Strands but is shaped for short-lived AgentCore Lambda invocations rather than a long-lived ECS service; and no path exists from external connectors into `computer_tasks`. This plan turns those three gaps into a staged delivery while preserving Marco/Flue work on its own track. (See origin: `docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md`.)

---

## Requirements

The plan must satisfy all 34 origin requirements (with R16's Drive/Docs/Sheets explicitly deferred to follow-up work — see Scope Boundaries). Tracing the most load-bearing:

- R1, R3 (substrate): Strands as single foundation; Computer on ECS+EFS.
- R6, R7, R8 (stdlib): new `packages/computer-stdlib/`; eleven modules; reuses ThinkWork APIs.
- R9–R13 (session + goal loop): runtime/session loader; durable resume; structured turn status; event streaming.
- R14, R15 (workspace): workpapers convention `/workspace/.thinkwork/workpapers/<task-id>/`; safe path validation.
- R16, R17, R18 (tool surface): Google Workspace + MCP broker with approval gates and OAuth isolation.
- R19, R20, R21 (routines + memory): routine trigger/poll; Hindsight as primary backend; async-wrapper pattern.
- R22 (delegation): bounded delegation with input/output schema, budget, attribution.
- R23, R24 (approvals): Strands interrupts → ThinkWork HITL records → mobile → resume.
- R25, R26, R27 (CE skills port): skills folder + `load_skill` + adapter shims; vendored snapshot; coding-worker only.
- R28, R29, R30 (governance): per-tenant IAM; admin policy update applies on next step; budget enforcement at goal loop.
- R31, R32 (observability + evals): structured events; golden-workflow eval scaffolding.
- R33, R34 (acceptance): one golden workflow on Eric's dev tenant; v1 priority sequence.

**Origin actors:** A1 (Computer owner), A2 (admin/operator), A3 (Computer Strands agent), A4 (delegated worker), A5 (computer-stdlib), A6 (mobile), A7 (connectors), A8 (Marco/Flue, out-of-scope).

**Origin flows:** F1 (connector intake), F2 (goal-driven multi-step with approvals), F3 (parallel research), F4 (delegation), F5 (HITL interrupt + resume).

**Origin acceptance examples:** AE1–AE15. Plan-level coverage:
- Phase 5 acceptance smokes cover AE1–AE4, AE10, AE14, AE15 directly.
- Stdlib + worker unit/integration tests cover AE5, AE8, AE11, AE12, AE13.
- AE6 (Personal Daily Briefing), AE7 (Inbox-to-Task Conversion), and AE9 (Google Docs Drafting) are deferred — AE6 needs richer memory retention patterns; AE7 needs MCP-backed task creation bridges; AE9 needs Google Docs tools (deferred per the Drive/Docs/Sheets follow-up below).

---

## Scope Boundaries

Single list per Deep-feature tier. Origin scope boundaries carried forward, plan-local additions noted.

- Realtime voice / BidiAgent mode (origin).
- Generic desktop replacement UI for the Computer (origin).
- Arbitrary unapproved external mutations (origin).
- Multiple Computers per user (origin).
- Customer-uploaded arbitrary worker runtimes (origin).
- Self-modifying skill or code installation without approval (origin).
- Replacing existing AgentCore Managed Agents (Marco) immediately (origin).
- Migrating existing Flue work to Strands (origin).
- The compound-engineering plugin installed wholesale on either the Computer or the coding worker (origin).
- The `/lfg` slash-command UX (origin).
- Plugin auto-update from upstream EveryInc compound-engineering plugin (origin; vendored snapshot only).
- Skills folder for the Computer agent (origin; coding worker only).
- Browser / computer-use hooks (origin).
- Generalist coding for the coding worker beyond bug-fix scope (origin).
- PR-merge automation by the coding worker (origin).
- Multi-delegation persistent workspace cache across worker invocations (origin).
- Adopting Deep Agents itself as a runtime dependency (origin).
- AgentCore Memory and Wiki as writable memory surfaces (origin; recall-only).
- Local Flue `session.task()` subagent paths (n/a — Flue is not the substrate here).

### Deferred to Follow-Up Work

- **AgentCoreMemorySessionManager** as the session backend — v1 ships a custom Aurora-backed SessionManager; the AWS-native option is a v2 evaluation.
- **Google Drive / Docs / Sheets tools** in `google_workspace.py` — v1 ships Gmail + Calendar only; Drive search/read, Docs create/update/comment, Sheets read/update are deferred. (Origin R16 lists them; the v1 cut keeps Phase 3 scoped.)
- **Header-callable MCP transport wrapper** for OAuth token rotation — v1 reconstructs MCP clients per invocation; rotation patterns refined when token rotation matters in production.
- **`packages/computer-runtime/` (TS) deletion** — kept in repo for reference until the Strands runtime has shipped two clean deploys; deletion follows in a separate small PR.
- **Marketing positioning of "ThinkWork has a coding agent"** (origin; separate doc if pursued).

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-strands/agent-container/container-sources/server.py:683-1401` — existing tool registration with try/except graceful-degrade. This is the de-facto stdlib pattern; lifting into `packages/computer-stdlib/` is refactor of existing scaffolding, not greenfield.
- `packages/agentcore-strands/agent-container/container-sources/server.py:580-599` — MCP wiring: `MCPClient` + `streamablehttp_client(url, headers)` with `Authorization: Bearer` injection.
- `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` — async-wrapper pattern (preserve invariant per `feedback_hindsight_async_tools` memory).
- `packages/agentcore-strands/agent-container/container-sources/server.py:1531-1538` — canonical Strands `Agent(model=BedrockModel(...), system_prompt, tools=[...], plugins, messages, callback_handler=None)` setup.
- `terraform/modules/app/computer-runtime/main.tf:14-227` — single ECS cluster `thinkwork-${stage}-computer`, single shared EFS file system, per-Computer EFS access points + ECS services reconciled by a Lambda from DB rows. Already provisioned; image is the only change.
- `packages/database-pg/src/schema/computers.ts:25-247` — five Computer tables shaped: `computers`, `computer_tasks`, `computer_events`, `computer_snapshots`, `computer_delegations`. Schema gap: `computer_tasks.status` lacks `needs_approval`.
- `packages/api/src/lib/computers/tasks.ts:13-18` — `COMPUTER_TASK_TYPES` enum; line 158-183 `normalizeTaskInput`. Both extended in U2 to add new task types.
- `packages/api/src/handlers/computer-runtime.ts` — existing API surface for `claim`, `complete`, `fail`, `appendEvent`, `heartbeat`, `fetchConfig`. Reused; extended with approval-related endpoints in U8.
- `packages/api/src/__tests__/routine-approval-bridge.test.ts:60-69` — closest existing approval-bridge test pattern; partial reuse for Computer-side approvals.
- `inbox` table — existing mobile surface; extended with `type='computer_approval'` row type in U8.
- `packages/agentcore-flue/agent-container/src/__smoke__/flue-marco-smoke.ts` (referenced via `flue-runtime-launch-2026-05-04.md`) — 3-scenario deploy smoke gate pattern; mirrored for Computer in U4.
- `packages/agentcore/scripts/build-and-push.sh:50-52` — already accepts `--runtime strands`; extended for `--runtime computer-strands` in U3.
- `packages/api/src/lib/connectors/runtime.ts` — current connector runtime (zero `computer` references); the integration target for U15.

### Institutional Learnings

- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` — 3-scenario deploy smoke gate (`fresh-thread`, `multi-turn-history`, `memory-bearing`); regression detectors per row. Computer mirrors with a 4th scenario `interrupt-and-resume`.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — env snapshot at coroutine entry is load-bearing. PR #563's pattern (`test_snapshot_params_override_empty_env`) is reused in U4.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — multi-PR seam pattern; applied to U6 (approvals inert → live), U15 (connector dispatch inert → live), U16 (golden workflow).
- `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` — await Lambda dispatches; surface dispatch status in response payload (PR #838 `flue_retain` field). Pattern reused for Computer-side approval callback.
- `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md` — Bedrock model IDs require full inference profile prefix (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`); per-tenant Code Interpreter scoping.
- `docs/solutions/integration-issues/agentcore-runtime-role-missing-code-interpreter-perms-2026-04-24.md` — `bedrock-agentcore:StartCodeInterpreterSession` is a separate IAM grant.
- `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md` — split-arch image tags. Computer image is amd64 (ECS Fargate); coding worker image is arm64 (AgentCore).
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — explicit user-id predicate in multi-user OAuth. Applied to MCP broker in U11.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — narrow REST endpoint over widened `resolveCaller`. Connector dispatch (U15) uses a narrow `POST /api/connectors/dispatch-to-computer`.
- `docs/solutions/integration-issues/flue-supply-chain-integrity-2026-05-04.md` — supply-chain baseline for Python deps.

### External References

- https://strandsagents.com/docs/user-guide/concepts/agents/agent-loop/ — agent loop, stop reasons, no native max-iterations (must implement via hook).
- https://strandsagents.com/docs/user-guide/concepts/interrupts/ — first-class `tool_context.interrupt(name, reason)`; resume via `{"interruptResponse": {...}}`; state lives in `SessionManager`.
- https://strandsagents.com/docs/user-guide/concepts/agents/session-management/ — `SessionManager` ABC; `FileSessionManager`, `S3SessionManager`, custom backends.
- https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/ — agents-as-tools (in-process Python objects); fits delegation in U12.
- https://strandsagents.com/docs/user-guide/concepts/streaming/async-iterators/ — `stream_async()` for event emission into `computer_events` (U3 + U10).
- https://strandsagents.com/docs/community/session-managers/agentcore-memory/ — `AgentCoreMemorySessionManager` (deferred to v2).
- https://strandsagents.com/docs/user-guide/concepts/tools/mcp-tools/ — `MCPClient` + `streamablehttp_client(url, headers)`; headers read at construction.
- Strands version 1.38.0 (released 2026-04-30); Python ≥ 3.10.

---

## Key Technical Decisions

- **`packages/computer-stdlib/` is a new uv workspace member** (Python 3.11, ruff line-length 100, target py311 — per `CLAUDE.md` L25). Sibling to `packages/agentcore-strands/`.
- **Computer container = new `packages/computer-strands/` deployed to existing `thinkwork-${stage}-computer-runtime` ECR.** Replaces the TS image in the same ECR; per-Computer ECS reconciler in Terraform stays unchanged. The TS `packages/computer-runtime/` is kept in repo for two-deploy grace period, then deleted in a separate PR.
- **Coding worker = separate container `packages/coding-worker-strands/`** built into a new `thinkwork-${stage}-coding-worker` ECR (or sub-tag of agentcore ECR — decided in U13). Skills folder ships only here, not on the Computer.
- **`computer_tasks.status` extended with `needs_approval`** via Drizzle migration. Indexed on `(computer_id, status)` already; `needs_approval` rows are queryable as first-class state.
- **HITL bridge via existing `inbox` table** with new `type='computer_approval'`. Mobile rendering reuses the existing inbox surface; no parallel HITL store.
- **Custom `SessionManager` backed by Aurora `computer_snapshots`** for paused-state durability. `FileSessionManager` does not survive ECS restart; `AgentCoreMemorySessionManager` is AgentCore-specific.
- **Iteration budget enforced via Strands `BeforeToolCallEvent` hook** counting + `agent.cancel()`. No native max-iterations in Strands.
- **Sub-agent delegation = Strands agents-as-tools (in-process)** for v1 lightweight subagents. The coding worker is a *separate container* invoked via `InvokeAgentRuntime` (heavier blast radius, isolated scaling, AgentCore-managed) — chosen because `/lfg` runs minutes-to-hours and shouldn't share the Computer's process resources. Both shapes use the same `delegation` stdlib module; substrate is a delegation-payload field.
- **Result rows for delegations live in `computer_delegations`** (already shaped, currently unused). `agent_id` FK can be NULL for in-process subagents; populated for AgentCore-managed coding worker invocations.
- **CE skills folder ships only with the coding worker container.** Computer uses purpose-built tools.
- **Adapter shim list expands beyond the four named in origin** (`Skill`, `AskUserQuestion`, `TaskCreate/Get/List`, `Agent`). Spike (U13) enumerates `lfg.md` + transitively-loaded skills' tool references; production set (U14) extends to cover them. Confirmed candidates from spec-flow analysis: `WebSearch`, `WebFetch`, `TodoWrite`, `Mcp__*`, `ExitPlanMode`, `BashOutput`, `KillShell`, `SlashCommand`. `NotebookEdit` is excluded (Jupyter-only; out of v1 coding scope).
- **Env snapshot at runtime entry** — `_load_runtime_secrets()` at coroutine entry loads `THINKWORK_API_URL`, `API_AUTH_SECRET`, `HINDSIGHT_ENDPOINT` once; passes via parameters; never re-reads `os.environ` post-turn. Pattern from PR #563 reused.
- **3-scenario deploy smoke gate** (`fresh-thread`, `multi-turn-history`, `memory-bearing`) plus a 4th `interrupt-and-resume` scenario specific to Computer. Mirrors `flue-marco-smoke` shape exactly.
- **Computer ECR image is arm64** to match the existing per-Computer ECS reconciler — `packages/api/src/lib/computers/runtime-control.ts:325` hard-codes `cpuArchitecture: "ARM64"` in the task-definition builder, and flipping that is out of scope here. Coding worker image is also arm64 (AgentCore Runtime). The cited solution doc (`multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24`) is about Lambda-vs-AgentCore arch, not Fargate defaults; both Computer and coding-worker land on arm64.
- **Bedrock model strings use full inference-profile prefix** (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`). Default Computer model: `us.anthropic.claude-sonnet-4-6` (or whichever Sonnet is current at deploy time).
- **Per-tenant Code Interpreter `codeInterpreterIdentifier`** resolved by trusted handler from invocation context (FR-9a gap closure). Applies to coding worker; Computer doesn't use Code Interpreter directly.
- **Connector → Computer dispatch via narrow REST endpoint** `POST /api/connectors/dispatch-to-computer`, NOT widened `resolveCaller`.
- **Connector idempotency:** `computer_tasks.idempotency_key` populated with `linear:issue:<id>:<updated_at>` (and analogous patterns for other connectors). Existing partial unique index handles dedupe.
- **HITL no-response timeout:** 7 days default (configurable per-tenant); pending approval expires → task transitions to `blocked` with `reason: approval_timeout`.
- **HITL multi-in-flight:** mobile renders queue per Computer task; user processes in arrival order; no blocking on others.
- **Policy change mid-task:** re-validate on every tool call; previously-allowed-now-blocked → `policy_changed_mid_task` event + transition to `blocked`.
- **Hindsight unavailable:** 3 retries with exponential backoff; on persistent failure, log `level=warn`, run with empty briefing, do not fail the task.
- **CE skill recursion:** max depth 3; cycles detected by skill-name set; abort with explicit `skill_recursion_depth_exceeded` event.

---

## Open Questions

### Resolved During Planning

- **F1 connector idempotency contract:** `linear:issue:<id>:<updated_at>` (stable across retries; bumps on update). Applied to all connector types in U15.
- **F1 multi-Computer guard:** the user-to-Computer lookup is `SELECT id FROM computers WHERE tenant_id = $tenant AND owner_user_id = $userId AND status <> 'archived'` — the existing `uq_computers_active_owner` partial unique index already enforces ≤1 active Computer per user. Dispatch fails closed if the lookup returns zero rows; the 2+-rows branch is structurally unreachable today but kept as a defensive check in case the unique index is ever relaxed.
- **F4 worker timeout/heartbeat:** delegation has wall-clock timeout (default 1h, configurable per delegation); worker emits heartbeat events every 60s; >120s silence + budget breach → terminal failure.
- **F4 worker output validation:** every delegation declares output JSON schema; malformed → one bounded retry → terminal `output_schema_invalid`.
- **F5 race-window resolution:** approval write + Lambda dispatch atomic in same DB transaction; rescinded-after-dispatch surfaces as `approval_rescinded` event in audit (action may have completed).
- **R24 approval expansion:** add memory writes for sensitive content (regex pattern), delegation with new tool policy, routine sub-tool privilege escalation, workpaper writes outside `.thinkwork/workpapers/<task-id>/`. **`load_skill` for skills NOT in the vendored snapshot is a hard block at the shim, not an approval prompt** — surfacing "load unknown skill X?" as approval would train users to approve arbitrary skill loads and defeat the supply-chain control. Out-of-snapshot loads emit `skill_load_blocked` and return a structured error.
- **AE14 retry semantics:** model retries are Strands-internal; tool retries bounded per-tool (default 1); task-level retry only on operator action.
- **R20 Hindsight contradiction reconciliation:** most-recent retain wins; tombstone older fact via Hindsight existing pattern; surface in next briefing as "(updated)".
- **Computer ECR repointing:** build new Python image into existing `thinkwork-${stage}-computer-runtime` ECR; no Terraform changes to per-Computer reconciler.
- **Container runtime:** long-lived ECS Fargate (always-on per Computer); not Lambda. Python entrypoint runs the supervised loop.
- **Coding worker substrate:** AgentCore Runtime (separate container, separate ECR, invoked via `InvokeAgentRuntime`). NOT in-process Strands subagent. Reason: `/lfg` runs minutes-to-hours and benefits from independent scaling.

### Deferred to Implementation

- **Concrete Strands `BeforeToolCallEvent` hook implementation** for iteration counting; max counter source in `runtime_config.iteration_budget`.
- **MCP token-rotation pattern:** header-callable transport wrapper vs. per-invocation reconstruct (start with reconstruct; refine later).
- **Concrete `computer_snapshot` encoding** for paused Strands session state (likely msgpack of `agent.state` + `messages`).
- **Aurora SessionManager indexing strategy** for fast resume by `(tenant_id, computer_id, session_id)`.
- **Workpaper cleanup policy** on task completion / failure (retention period; S3 archive vs. EFS delete).
- **Tool-permission policy schema** (`runtime_config.tool_policy`).
- **Whether to use `service_tier="priority"`** on `BedrockModel` for the Computer (latency-sensitive) vs. coding worker (cost-tolerant).
- **Coding worker ECR location:** new `thinkwork-${stage}-coding-worker` ECR vs. sub-tag of `thinkwork-${stage}-agentcore`.
- **Heartbeat granularity for delegations:** 60s default, but exact cadence and emit point inside Strands lifecycle.
- **Aurora SessionManager test strategy:** integration tests against a real Aurora instance vs. localstack/RDS-Proxy mock.

#### From doc-review (2026-05-08, interactive walkthrough)

- **R16 v1 cut for Drive/Docs/Sheets:** is the Drive search/read + Docs create/update/comment + Sheets read/update set actually deferrable for v1, or does the v1 demo workflow surface a need? Plan currently defers; re-validate at planning time.
- **Pre-U6 Strands SessionManager round-trip spike:** stand up Strands 1.38.0 with `tool_context.interrupt`, persist + rehydrate `agent.state + messages` via msgpack against the real version, kill the process between persist and rehydrate, verify the resumed agent calls the model with the original conversation history intact. The current U6 inert phase only proves the snapshot is written; doesn't prove correct semantic resume.
- **Computer container Dockerfile entrypoint shape:** explicit polling-loop CMD (`python -m computer_strands.entrypoint`) rather than LWA HTTP server pattern inherited from `agentcore-strands`. The existing Strands Dockerfile expects AgentCore Runtime invocation context; ECS Fargate is fundamentally different.
- **CI image-build path filter additions in `.github/workflows/deploy.yml`:** new `computer_container` filter group; new `build-computer-container` job pointing at `packages/computer-strands/Dockerfile` and pushing to `thinkwork-${stage}-computer-runtime` ECR; new staleness detector. Existing `build-container` job builds only agentcore-strands and agentcore-flue.
- **4-scenario smoke gate ECS-async shape:** the smoke is NOT a verbatim mirror of `flue-marco-smoke` (Lambda invoke + read response) — Computer is a long-lived ECS poller. Smoke must INSERT `computer_tasks` row → poll status → POST approval response → poll completed. Only `interrupt-and-resume` is genuinely Computer-specific; the other three scenarios become "task lifecycle" with different goals.
- **Default Fargate sizing tuning:** `default_cpu = 256`, `default_memory = 512` likely undersized for Strands + Bedrock + Hindsight + MCP working set with multi-MCP concurrent connections. Bump to `512 / 2048` upfront, or treat as Phase 5 tuning gated by a memory-pressure smoke.
- **`AGENTCORE_MEMORY_ID` and `OTEL_EXPORTER_OTLP_ENDPOINT` resolution on ECS:** AgentCore Runtime injects these; ECS Fargate does not. Decide whether the Computer uses AgentCore Memory at all in v1 (R20 says Hindsight is primary, AgentCore Memory recall-only — confirm whether the AgentCore Memory client is needed). For OTEL, decide between dropping it on the Computer, running an ADOT sidecar, or pointing at a stage-level OTLP collector.
- **Encrypted-at-rest for `computer_snapshots.payload`:** paused session state (serialized `messages`) may include OAuth tokens, drafted email bodies, MCP tool outputs. Decide between column-level encryption (pgcrypto / RDS field encryption) vs. S3-reference + SSE-KMS per-tenant key. Aurora volume-level encryption is the floor; this question is about the second layer.
- **HITL approval queue cap:** maximum simultaneously-pending approvals per Computer task and per user. Without a cap, an attacker (or misbehaving agent) firing many parallel approval requests could exhaust inbox display capacity. Decide cap value.
- **Per-tenant Code Interpreter lifecycle:** lazy-create on first delegation (cold-start hits the user's first run) vs. eager-create on tenant onboarding (infra spend on every tenant + onboarding code path that doesn't exist yet). Pick one.
- **Coding worker first-run latency:** cold-clone repo per delegation × multiple `/lfg` cycles per Linear task. For a 100MB repo, 30s+ × N cycles = minutes of pure clone latency before any model token fires. Decide tolerance bound; if too slow, the brainstorm's "outer loop = Computer" pattern needs tightening (e.g., session reuse within one Linear task) or persistent-cache scope returns to v1.
- **Two-substrate operating cost (Flue + Strands):** plan commits to running both indefinitely. Operating two runtime engines means two upgrade paths, two security review surfaces, two MCP integration paths, two memory wiring patterns, two smoke gates, two image-build pipelines. Define the trigger condition that retires Flue (or accepts the two-substrate cost as permanent).
- **ECS image swap drain path:** during the deploy window between TS task-dispatcher and Python Strands image, both can run concurrently for minutes. The TS container has no notion of `needs_approval` or the new task types. Define drain semantics: kill-switch column to pause TS claims before SHA bump, or accept loss of in-flight tasks across the swap.
- **TS dispatcher rollback contract:** the deferred `packages/computer-runtime/` (TS) is "kept in repo for two-deploy grace period." Decide: (a) is it kept *deployable* (rollback path = previous image SHA, with explicit "in-flight `needs_approval` tasks are dropped on revert"), or (b) forward-only after the swap?
- **Image-rollout deploy fan-out:** per-Computer ECS reconciler currently reads the ECR repository URL but not a tagged SHA — new ECR pushes don't propagate to running services without explicit `aws ecs update-service --force-new-deployment` or per-Computer `restart` action. Add a deploy-time fan-out: iterate active `computers` rows after `aws ecr put-image` and call `controlComputerRuntime({action: 'restart', ...})` for each, OR add a new `redeploy` action that re-registers the task definition with the new image.
- **Hand-rolled `computer_tasks.status` CHECK constraint migration concurrency:** the migration must `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`. Live writes during the brief drop+add window can pass invalid statuses. Decide between (a) wrap drop+add in a single transaction (brief lock), (b) `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` (Postgres pattern, no lock window), or (c) accept the brief lock at dev scale. Document in the migration's `-- creates:` marker so the drift reporter sees the constraint-name change.
- **Adapter shim hypothesis labeling:** the eight extra shim candidates listed in Key Technical Decisions (`WebSearch`, `WebFetch`, `TodoWrite`, `Mcp__*`, `ExitPlanMode`, `BashOutput`, `KillShell`, `SlashCommand`) are pre-spike reasoning, not confirmed. U13 spike enumerates the actual coverage need empirically from `lfg.md` + transitively-loaded skills; U14 implements only the set U13 confirms. Labeling clarification (treat as "U13 spike hypothesis set", not "confirmed candidates").

---

## Output Structure

```
packages/
├── computer-stdlib/                              # NEW — shared Python package (uv workspace member)
│   ├── pyproject.toml
│   ├── src/computer_stdlib/
│   │   ├── __init__.py
│   │   ├── runtime.py                            # session loader, env snapshot
│   │   ├── goal_loop.py                          # turn status, budget enforcement, iteration hook
│   │   ├── workspace.py                          # workspace tools + workpaper convention
│   │   ├── memory.py                             # Hindsight async wrappers
│   │   ├── approvals.py                          # interrupt → inbox → resume bridge
│   │   ├── google_workspace.py                   # Gmail + Calendar tools (Drive/Docs/Sheets deferred)
│   │   ├── mcp_broker.py                         # per-user/tenant MCP resolution
│   │   ├── routines.py                           # routine trigger + poll
│   │   ├── delegation.py                         # Strands agents-as-tools + AgentCore InvokeAgentRuntime
│   │   ├── observability.py                      # event emission to computer_events
│   │   ├── session_store.py                      # custom SessionManager backed by Aurora
│   │   └── shims/                                # adapter shims (used by coding worker only)
│   │       ├── __init__.py
│   │       ├── skill_loader.py
│   │       ├── ask_user_question.py
│   │       ├── task_tools.py
│   │       └── agent_tool.py
│   └── tests/
│       └── (mirrors src/ structure)
├── computer-strands/                             # NEW — Computer container (long-lived ECS)
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── src/computer_strands/
│   │   ├── __init__.py
│   │   ├── entrypoint.py                         # ECS service entry: claim, run Strands, repeat
│   │   ├── config.py                             # runtime_env loader; env snapshot
│   │   └── system_prompt.py                      # generalist orchestrator prompt
│   └── tests/
├── coding-worker-strands/                        # NEW — coding worker container (per-delegation)
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── src/coding_worker_strands/
│   │   ├── __init__.py
│   │   ├── entrypoint.py                         # delegation invocation entry
│   │   └── system_prompt.py                      # coding-focused prompt
│   ├── skills/                                   # vendored CE skills snapshot
│   │   ├── coding/
│   │   │   ├── lfg.md
│   │   │   ├── plan.md
│   │   │   ├── work.md
│   │   │   ├── commit-push-pr.md
│   │   │   └── debug.md
│   │   └── manifest.yaml
│   └── tests/
├── api/
│   └── src/
│       ├── handlers/
│       │   ├── connector-to-computer.ts          # NEW
│       │   └── computer-approval-callback.ts     # NEW
│       └── lib/
│           └── computers/
│               ├── tasks.ts                      # MODIFIED — task-type enum extension
│               └── approvals.ts                  # NEW — inbox computer_approval helpers
└── database-pg/
    ├── src/schema/computers.ts                   # MODIFIED — needs_approval status
    └── drizzle/                                  # NEW migration
```

The implementing agent may adjust this layout (e.g., merge sibling packages, split tools into more granular modules) if implementation reveals a better structure. Per-unit `**Files:**` sections remain authoritative.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Computer task lifecycle

```
+-- Connector or scheduled trigger --+
              |
              v
   POST /api/connectors/dispatch-to-computer (idempotency_key required)
              |
              v
   computer_tasks INSERT (status='pending')
              |
              v
+-- Computer ECS task (long-lived) --+
   poll /api/computers/runtime/tasks/claim
   |
   on task: instantiate Strands Agent with
            session_manager=AuroraSessionManager(...),
            tools=[stdlib tools per tool_policy],
            system_prompt=orchestrator_prompt,
            messages=session.messages
   run agent.invoke(task.input)
              |
   inside agent loop:
     - tool calls -> stream events to computer_events
     - hook BeforeToolCallEvent -> increment counter, agent.cancel() if over budget
     - tool calls approvals.request(...) -> raises tool_context.interrupt(...)
              |
              v
   interrupt -> stdlib catches -> writes inbox row (type='computer_approval'),
                                  writes computer_event (type='needs_approval'),
                                  flips computer_tasks.status='needs_approval',
                                  exits agent loop, persists session via Aurora SessionManager
              |
              v
   ECS task moves on to next claim (other tasks keep running)
              |
              ... mobile push fires ...
              ... user opens inbox, taps approve/deny/edit ...
              v
   POST /api/computers/approval/respond
   |
   v
   inbox row resolved, computer_tasks.status='pending', emit computer_event
              |
              v
   Computer claims the task again; SessionManager hydrates the paused state;
   agent resumes with {"interruptResponse": {"interruptId": ..., "response": ...}}
   loop continues until done | blocked | failed
```

### Stdlib + delegation shape

```
computer-stdlib (Python package)
  ├── tools (decorated with @tool from strands)
  │     workspace, memory, google_workspace, mcp_broker, routines, ...
  │     each tool ↔ thinkwork API call
  │
  ├── Strands hooks
  │     BeforeToolCallEvent → iteration counter + budget check
  │     AfterToolCallEvent → emit computer_event (level=info, payload=tool result)
  │     ModelEvent → emit computer_event (level=debug, model deltas)
  │
  ├── delegation primitive
  │     stdlib.delegation.delegate(target, payload, output_schema, budget)
  │       → if target='in_process': spawn Strands subagent (agents-as-tools)
  │       → if target='agentcore': call InvokeAgentRuntime (coding worker)
  │       → returns delegation_id; Computer agent yields, completion event wakes it
  │
  └── shims (coding worker only)
        load_skill(name) reads packages/coding-worker-strands/skills/<name>.md
        AskUserQuestion → tool_context.interrupt(name='approval', reason={question, options})
        TaskCreate/Get/List → thinkwork API calls
        Agent → strands agents-as-tools
```

### Connector → Computer dispatch (F1)

```
Linear webhook
  → connector runtime claims (existing)
  → POST /api/connectors/dispatch-to-computer
       payload: {tenant, userId, kind='linear_issue', ref={issueId, updatedAt}, ...}
       idempotency_key derived: 'linear:issue:<id>:<updated_at>'
  → SELECT id FROM computers WHERE tenant_id = $t AND owner_user_id = $u AND status <> 'archived'
  → fail-closed if zero rows (the partial unique index prevents 2+ active per user)
  → INSERT computer_tasks ON CONFLICT (idempotency_key) DO NOTHING
  → emit computer_event (type='task_created', source='linear')
```

---

## Implementation Units

Five phases. U-IDs are stable; reorder/split keeps existing IDs in place.

### Phase 1 — Foundation

#### U1. Create `packages/computer-stdlib/` Python package skeleton

**Goal:** New uv workspace member with module layout for the eleven stdlib modules; tests scaffolding; ruff + pyright passing on empty stubs.

**Requirements:** R6, R7, R8.

**Dependencies:** None.

**Files:**
- Create: `packages/computer-stdlib/pyproject.toml`
- Create: `packages/computer-stdlib/src/computer_stdlib/__init__.py`
- Create: `packages/computer-stdlib/src/computer_stdlib/{runtime,goal_loop,workspace,memory,approvals,google_workspace,mcp_broker,routines,delegation,observability,session_store}.py` (stubs)
- Create: `packages/computer-stdlib/src/computer_stdlib/shims/{__init__,skill_loader,ask_user_question,task_tools,agent_tool}.py` (stubs)
- Create: `packages/computer-stdlib/tests/test_package_imports.py`
- Modify: `pyproject.toml` (root) — add `packages/computer-stdlib` as uv workspace member
- Modify: root `ruff.toml` / `pyproject.toml` — extend lint scope

**Approach:**
- Mirror `packages/agentcore-strands/pyproject.toml` shape: `pyproject.toml` lists only dev/test deps (pytest, pytest-asyncio, ruff). **Runtime deps live exclusively in the per-container `Dockerfile`** (`packages/computer-strands/Dockerfile` and `packages/coding-worker-strands/Dockerfile`) so each container pins its own Strands version independently. This avoids the uv workspace shared-resolution problem where `>=1.38.0` in one package would silently bump the other workspace member's effective Strands version. Computer container pins `strands-agents==1.38.x`; existing `agentcore-strands` (Marco) stays on `1.34.x` until explicitly bumped after the Computer is stable.
- Each module starts as a stub with a docstring naming its scope.
- Test scaffolding uses pytest conventions (`testpaths = ["packages/"]` in root `pyproject.toml`).

**Patterns to follow:**
- `packages/agentcore-strands/pyproject.toml` — uv workspace member shape.
- `packages/agentcore-strands/agent-container/Dockerfile` — Python 3.11, Bookworm, requirements.txt pin pattern.

**Test scenarios:**
- Happy path: `import computer_stdlib` succeeds; all named submodules import cleanly.
- Edge case: package install via `uv sync` from the monorepo root succeeds without conflicts with `agentcore-strands`.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/` passes.
- `pnpm typecheck` and `pnpm lint` pass at the monorepo root (no cross-language regressions).

---

#### U2. Schema migration: `computer_tasks.needs_approval` + task-type enum extension

**Goal:** Add `needs_approval` to `computer_tasks` status CHECK constraint; extend `COMPUTER_TASK_TYPES` to include `agent_goal`, `connector_dispatched`, `delegated_work`. Regenerate GraphQL codegen.

**Requirements:** R10, R12, R23.

**Dependencies:** None.

**Files:**
- Modify: `packages/database-pg/src/schema/computers.ts` — extend `computer_tasks_status_allowed` CHECK to include `needs_approval`.
- Create: `packages/database-pg/drizzle/NNNN_computer_tasks_needs_approval.sql` — hand-rolled migration with `-- creates:` markers per CLAUDE.md drift rules.
- Modify: `packages/api/src/lib/computers/tasks.ts` lines 13-18 — extend `COMPUTER_TASK_TYPES` with: `agent_goal` (used by U5 as the default user-initiated Computer goal task type), `connector_dispatched` (used by U15 for connector-routed work), `delegated_work` (used by U12 to track sub-delegations to coding-worker / other Strands subagents from `computer_delegations` row creation).
- Modify: GraphQL types under `packages/database-pg/graphql/types/computers.graphql` (or equivalent) to expose new status + types.
- Test: `packages/database-pg/src/schema/__tests__/computer-tasks-needs-approval.test.ts` (or extend existing test file).
- Test: `packages/api/src/lib/computers/__tests__/tasks.test.ts` (extend).

**Approach:**
- Hand-rolled SQL because partial-CHECK alteration must not be lost in journal; per `feedback_handrolled_migrations_apply_to_dev` memory, author runs `psql -f` to dev manually after merge.
- GraphQL codegen runs in every consumer (`pnpm --filter @thinkwork/admin codegen`, etc.) — listed in U3 verification.

**Patterns to follow:**
- `packages/database-pg/drizzle/<existing handrolled .sql>` for the `-- creates:` marker format.
- `packages/api/src/lib/computers/tasks.ts:158-183` for `normalizeTaskInput` extension.

**Test scenarios:**
- Happy path: insert `computer_tasks` row with `status='needs_approval'` succeeds.
- Edge case: insert with invalid status string fails the CHECK constraint as before.
- Happy path: `normalizeTaskInput` accepts each new task type and rejects unknowns.
- Edge case: existing rows with old statuses are unaffected by migration.
- **Covers AE10.** A task transition `pending → needs_approval → pending → completed` round-trips through schema validation without orphaned rows.

**Verification:**
- `pnpm --filter @thinkwork/database-pg test` passes.
- `pnpm --filter @thinkwork/api test` passes for the tasks module.
- After merge: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_*.sql` applies cleanly to dev; `pnpm db:migrate-manual --stage dev` reports green.

---

#### U3. Computer Strands container scaffold + ECR build pipeline

**Goal:** New `packages/computer-strands/` Python container that boots Strands, loads stdlib, runs an ECS-supervised loop. Build pipeline pushes to existing `thinkwork-${stage}-computer-runtime` ECR. `terraform/modules/app/computer-runtime/` is unchanged structurally.

**Requirements:** R1, R2, R4 (ECS+EFS pre-existing), R9 (runtime/session — wired in U5).

**Dependencies:** U1.

**Files:**
- Create: `packages/computer-strands/pyproject.toml`
- Create: `packages/computer-strands/Dockerfile`
- Create: `packages/computer-strands/src/computer_strands/__init__.py`
- Create: `packages/computer-strands/src/computer_strands/entrypoint.py` — supervised loop: claim task, run Strands agent, complete/fail
- Create: `packages/computer-strands/src/computer_strands/config.py` — env snapshot loader
- Create: `packages/computer-strands/src/computer_strands/system_prompt.py` — generalist orchestrator prompt
- Modify: `packages/agentcore/scripts/build-and-push.sh` lines 50-52 — add `computer-strands` runtime variant
- Modify: `.github/workflows/deploy.yml` — extend image-build path filter to include `packages/computer-strands/**` and `packages/computer-stdlib/**`; new step builds and pushes Computer image to `thinkwork-${stage}-computer-runtime` ECR
- Test: `packages/computer-strands/tests/test_entrypoint_smoke.py`

**Approach:**
- Entrypoint runs a supervised polling loop matching the existing TS `task-loop.ts` semantics: claim → handle → complete/fail → repeat. Inside `handle`, instantiate a Strands `Agent` with stdlib tools (added in U5); for U3, the Agent is a no-op stub that returns `{ok: true, taskType: <type>}`.
- Dockerfile is arm64 single-arch to match the per-Computer ECS task definition (`runtime-control.ts:325` hard-codes `cpuArchitecture: "ARM64"`); flipping that is out of scope here.
- `_load_runtime_secrets()` at coroutine entry per `agentcore-completion-callback-env-shadowing-2026-04-25.md` — explicit regression test in U4.
- Per-Computer ECS reconciler in Terraform stays as-is; reads image SHA from Lambda config (existing pattern). The deploy bumps that SHA after the new image lands.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/Dockerfile` — Python 3.11 Bookworm + Lambda Web Adapter (omitted here since we're ECS, not Lambda).
- `packages/computer-runtime/src/{index,task-loop,api-client}.ts` — semantic shape of the supervised loop (port to Python).
- `packages/agentcore/scripts/build-and-push.sh` lines 50-52 — `--runtime` flag.

**Test scenarios:**
- Happy path: container boots; `entrypoint.main()` reads required env vars and exits cleanly when `COMPUTER_RUNTIME_DRY_RUN=1`.
- Error path: missing `THINKWORK_API_URL` raises a clear startup error and exits non-zero.
- Edge case: claim returns null → loop sleeps `TASK_IDLE_DELAY_MS` and retries.
- Integration: a stub task (`taskType='noop'`) handled end-to-end through `claim → complete` API round-trip.

**Verification:**
- `uv run pytest packages/computer-strands/tests/` passes.
- `bash packages/agentcore/scripts/build-and-push.sh --runtime computer-strands --stage dev` succeeds locally.
- CI deploy pushes the image to ECR; new ECS task definition reconciler picks up the SHA on next reconciliation.

---

#### U4. Env-snapshot pattern + 4-scenario deploy smoke gate

**Goal:** Establish env-snapshot at coroutine entry (regression test pattern from PR #563); ship a deploy-time smoke gate scenarios (`fresh-thread`, `multi-turn-history`, `memory-bearing`, `interrupt-and-resume`) wired into `.github/workflows/deploy.yml`.

**Requirements:** R10, R11, R31.

**Dependencies:** U2, U3.

**Files:**
- Modify: `packages/computer-strands/src/computer_strands/entrypoint.py` — explicit `_load_runtime_secrets()` snapshot pattern with regression-test hooks.
- Create: `packages/computer-strands/tests/test_env_snapshot.py` — `test_snapshot_params_override_empty_env`, `test_snapshot_params_take_precedence_over_env` (mirroring PR #563).
- Create: `packages/api/src/__smoke__/computer-marco-smoke.ts` — three baseline scenarios + interrupt-and-resume (latter is inert until U6 ships, then live).
- Create: `scripts/post-deploy-smoke-computer.sh` — runner.
- Modify: `.github/workflows/deploy.yml` — `computer-smoke-test` job after `update-computer-runtime`.

**Approach:**
- Smoke scenarios mirror `flue-marco-smoke` shape verbatim. `interrupt-and-resume` scenario invokes the Computer with a goal that requires HITL approval; verifies the task transitions to `needs_approval`, then simulates an approval response and verifies the task completes.
- The 4th scenario lands inert in U4 (just the harness), goes live when U6 ships the approval bridge — see U6's seam-swap.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` smoke-gate table (regressions caught per scenario).
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` PR #563 test pattern.

**Test scenarios:**
- Happy path: snapshot params at coroutine entry override empty env; precedence is preserved across Bedrock + tool calls.
- Error path: snapshot missing `THINKWORK_API_URL` exits with structured error before any agent run.
- Integration: deploy smoke runs against dev; `fresh-thread` scenario succeeds; `multi-turn-history` returns non-empty content; `memory-bearing` shows `flue_retain.retained === true`-shaped event (renamed for Computer).
- **Covers F1 (smoke harness for connector dispatch readiness).**

**Verification:**
- `uv run pytest packages/computer-strands/tests/test_env_snapshot.py` passes.
- `bash scripts/post-deploy-smoke-computer.sh dev` returns 0 against deployed dev Computer.
- CI deploy fails if any of the 4 scenarios regresses.

---

### Phase 2 — Core stdlib modules

#### U5. Runtime/session loader + goal loop with iteration budget

**Goal:** `computer_stdlib.runtime` loads task/thread/owner/tenant/runtime config; `computer_stdlib.goal_loop` enforces structured turn status (`continue|done|needs_approval|blocked|failed`), iteration budget via `BeforeToolCallEvent` hook + `agent.cancel()`, and emits final thread updates.

**Requirements:** R9, R12, R13, R30.

**Dependencies:** U1, U2, U3.

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/runtime.py`
- Modify: `packages/computer-stdlib/src/computer_stdlib/goal_loop.py`
- Modify: `packages/computer-strands/src/computer_strands/entrypoint.py` — wire stdlib runtime+loop into supervised loop
- Test: `packages/computer-stdlib/tests/test_runtime.py`
- Test: `packages/computer-stdlib/tests/test_goal_loop.py`

**Approach:**
- `runtime.load_session(task_id)` returns a typed dataclass with task, thread, owner, tenant, template, workspace paths, available tool names per `runtime_config.tool_policy`, approval policy, and budget config.
- `goal_loop.run(session, agent_factory)` builds a Strands `Agent` from the session, registers a `BeforeToolCallEvent` hook that increments a counter and calls `agent.cancel()` if over budget; runs `agent.invoke(...)`; observes terminal state from agent return + interrupt + cancellation; emits a final structured task output to the API.
- The structured turn status type lives in `goal_loop.TurnStatus` (enum + payload).

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py:683-1401` — try/except graceful-degrade tool registration; lift the *shape* into stdlib.
- Strands docs: agent loop, hooks (`BeforeToolCallEvent`), `agent.cancel()` semantics.

**Test scenarios:**
- Happy path: `load_session` returns a populated session for a known task; missing fields default per template.
- Edge case: missing tenant ID raises `RuntimeError` (fail closed).
- Happy path: `goal_loop.run` returns `TurnStatus.DONE` when the agent completes; emits `task_completed` event.
- Edge case: iteration counter > budget triggers `agent.cancel()`; loop returns `TurnStatus.BLOCKED` with `reason='budget_exceeded'`. **Recovery contract:** `agent.cancel()` is terminal in Strands (cancellation ≠ pause; no `interruptResponse` resume payload). To recover from a budget-blocked task, the operator raises `runtime_config.iteration_budget` and triggers a fresh `agent.invoke()` — the AuroraSessionManager hydrates the prior conversation history but the cancelled run does NOT resume mid-step. Document this as the only recovery path; don't model BLOCKED as resumable via the interrupt path.
- Edge case: agent exits via `tool_context.interrupt(...)` → loop returns `TurnStatus.NEEDS_APPROVAL`.
- Error path: agent raises uncaught exception → emits `task_error` event, returns `TurnStatus.FAILED` with sanitized error payload.
- Integration: full loop against a stubbed Strands `Agent` shows event stream into `computer_events` matches expected sequence.
- **Covers AE14.** Bounded retry + permanent failure representation: a tool that raises 3 times in a row triggers terminal `TurnStatus.FAILED` with `reason='tool_call_retry_exhausted'`; the failure is emitted as a thread message + push, not just an event.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_runtime.py packages/computer-stdlib/tests/test_goal_loop.py` passes.
- Integration test (gated to dev) confirms a real Strands Agent run reports turn status correctly.
- **Marco regression smoke** — after U5 lands, run `flue-marco-smoke` (per `flue-runtime-launch-2026-05-04.md`); assert no regression on Marco's three deploy-gate scenarios. Lifting stdlib-shaped patterns out of `packages/agentcore-strands/agent-container/container-sources/server.py:683-1401` could disturb Marco's runtime; the smoke gate catches it.

---

#### U6. Approvals / interruption module + HITL bridge (inert seam → live)

**Goal:** `computer_stdlib.approvals.request(question, options, blast_radius)` raises `tool_context.interrupt(...)`; on interrupt, stdlib writes an `inbox` row (`type='computer_approval'`), flips `computer_tasks.status='needs_approval'`, emits a `needs_approval` `computer_event`, persists session via Aurora SessionManager, and exits the agent loop. Approval response endpoint resumes the task by re-claiming with `interruptResponse` payload. Ships **inert first** (request raises but resume doesn't fire) → **live second** (full round-trip working) per inert→live seam pattern.

**Requirements:** R10, R23, R24.

**Dependencies:** U2, U5.

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/approvals.py` — `approvals.request()`, `approvals.consume_response()`, helpers.
- Modify: `packages/computer-stdlib/src/computer_stdlib/session_store.py` — `AuroraSessionManager` implementing Strands `SessionManager` ABC; backs paused state to `computer_snapshots`.
- Create: `packages/api/src/handlers/computer-approval-callback.ts` — `POST /api/computers/approval/respond` (writes inbox response + flips task back to `pending` with `interruptResponse` payload in `input`).
- Create: `packages/api/src/lib/computers/approvals.ts` — inbox `computer_approval` row helpers.
- Modify: `packages/api/src/lib/computers/tasks.ts` — surface `interruptResponse` in `claim` payload when status was `needs_approval`.
- Modify: mobile `apps/mobile/` — extend inbox renderer to handle `computer_approval` type. **Minimum viable UX bar (required for U16 acceptance to be exercisable by a real human):** (1) question text legible; (2) `Approve` and `Deny` clearly tappable; (3) edit-and-approve supported for the email-send case (per AE1's "user can inspect, approve, reject, or edit each draft"); (4) push notification carries the question summary. Anything beyond this minimum (rich queue UI, action-payload preview pane, multi-select question rendering polish) is deferred — but the four-item minimum is gating, since U16's smoke gate fails for non-code reasons (UX unusability) without it.
- Test: `packages/computer-stdlib/tests/test_approvals_inert.py`
- Test: `packages/computer-stdlib/tests/test_approvals_live.py`
- Test: `packages/api/src/__tests__/computer-approval-bridge.test.ts`

**Execution note:** Land the inert seam first (`approvals.request` raises interrupt; SessionManager persists; task flips to `needs_approval`) — then in a follow-up commit (same PR is fine), land the live integration (resume path, mobile surface). A body-swap-safety integration test asserts the live default actually fires on resume (the test counts SessionManager hydrate calls + Strands agent invocations).

**Approach:**
- `approvals.request()` calls `tool_context.interrupt(name='computer_approval', reason={question, options, blast_radius, interrupt_id})`.
- The Computer's outer loop catches the interrupt at the goal-loop level, persists session via `AuroraSessionManager` (storing serialized agent.state + messages in `computer_snapshots.payload`), writes an inbox row, flips task status, emits event.
- Mobile shows the question; user responds; `POST /api/computers/approval/respond` writes the response, flips status back, includes a `wakeup` hint for the Computer to claim faster.
- Computer claims the task again; sees `interruptResponse` in payload; calls `agent.invoke({"interruptResponse": {...}})`; SessionManager hydrates state; agent resumes from where it interrupted.
- Multi-in-flight queue: each interrupt gets a unique `interrupt_id`; mobile renders a queue per Computer task; user processes in arrival order.
- Timeout: a scheduled job (or daily_idle Lambda) scans `inbox` for `computer_approval` rows older than 7 days (configurable); marks them expired; flips associated tasks to `blocked` with `reason='approval_timeout'`.
- Race-window: approval response + `RequestResponse` Lambda invoke happens within the same DB transaction (per `feedback_avoid_fire_and_forget_lambda_invokes`); if Lambda errors, transaction rolls back.
- Sensitive-action coverage list per Key Decisions: email send, calendar mutation, file deletion, repo write, external API mutation, routine trigger, high-cost actions, memory writes for sensitive content (regex), `load_skill` outside vendored snapshot, delegation with new tool policy, routine sub-tool privilege escalation, workpaper writes outside `.thinkwork/workpapers/<task-id>/`.

**Patterns to follow:**
- Strands docs: interrupts (`tool_context.interrupt`, resume payload).
- `packages/api/src/__tests__/routine-approval-bridge.test.ts:60-69` — closest existing approval-bridge test pattern.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — body-swap-safety test (count Strands agent invocations + SessionManager hydrate calls; >= 1 proves live path runs).

**Test scenarios:**
- **Inert phase (lands first):**
  - Happy path: `approvals.request(question, options)` raises `tool_context.interrupt` with correct `name` + `reason` payload structure.
  - Happy path: interrupt is caught at goal-loop level; AuroraSessionManager writes a `computer_snapshot` row; task flips to `needs_approval`; inbox row created with `type='computer_approval'`.
  - Edge case: interrupt with no options (prose response) is supported in payload.
- **Live phase (lands second):**
  - Happy path: `POST /api/computers/approval/respond` writes inbox response, flips task to `pending` with `interruptResponse` payload, emits resume event.
  - Happy path: Computer claims the task again; SessionManager hydrates paused state; `agent.invoke({"interruptResponse": {...}})` resumes from interrupt; agent continues to `done`.
  - Edge case: response with `denied: true` and no edit returns `TurnStatus.BLOCKED` with `reason='approval_denied'`.
  - Edge case: response with edited payload (e.g., user adjusted email body) propagates through tool_context resume; subsequent send uses edited content.
  - Edge case: approval expired (>7 days) → task transitions to `blocked` with `reason='approval_timeout'`; no resume.
  - Edge case: multiple `needs_approval` interrupts queue per task; mobile renders in arrival order; resolving the first leaves the others pending.
  - Edge case: approval rescinded after dispatch → emits `approval_rescinded` event; downstream action may have completed; audit shows divergence.
  - Edge case: SessionManager fails to hydrate (corrupt snapshot) → task transitions to `failed` with `reason='session_hydrate_failed'`.
  - Edge case: Computer ECS task restarts while a session is paused → next claim hydrates session correctly (paused state is durable).
  - Integration: full round-trip on dev — request approval → mobile shows question → approve → task completes.
  - **Covers AE10.** Approval round-trip including ECS restart between request and response shows full audit trail in `computer_events` and `inbox`.
  - **Covers AE15 (partial).** A policy change that disables a tool while a task is paused on approval triggers a re-validate on resume → previously-allowed-now-blocked → `policy_changed_mid_task` event + transition to `blocked`.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_approvals_*.py` passes.
- `pnpm --filter @thinkwork/api test` for `computer-approval-bridge.test.ts` passes.
- Smoke gate U4's `interrupt-and-resume` scenario goes from inert (skipped) to live (counted) when U6 lives lands.
- Body-swap-safety integration test asserts `model_calls >= 1` on resume (not just SessionManager hydrate count).

---

#### U7. Workspace + workpapers tools

**Goal:** `computer_stdlib.workspace` provides `read`, `write`, `search`, `list`, `delete` (delete is approval-gated for paths outside `.thinkwork/workpapers/<task-id>/`); workpaper convention `/workspace/.thinkwork/workpapers/<task-id>/`; safe path validation prevents traversal; optional S3 snapshot to `computer_snapshots`.

**Requirements:** R14, R15, R24 (path-traversal approval).

**Dependencies:** U1, U6 (for path-validation approval gating).

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/workspace.py`
- Test: `packages/computer-stdlib/tests/test_workspace.py`

**Approach:**
- All tools take `task_id` from Strands `tool_context.invocation_state` to scope writes to `.thinkwork/workpapers/<task_id>/`.
- Path validation: resolved absolute path must start with `/workspace/`; writes outside `.thinkwork/workpapers/<task_id>/` (e.g., user's existing project files) require approval via `approvals.request`.
- Optional snapshot: `workspace.snapshot()` zips a workpaper folder, uploads to S3 at `computer_snapshots.s3_prefix`, registers a `computer_snapshots` row.

**Patterns to follow:**
- Existing `packages/computer-runtime/src/workspace.ts` — TS shape of `writeWorkspaceFile`, `writeHealthCheck`. Port semantics; adapt for Python.
- Strands tool docstring conventions (drives JSON-schema generation).

**Test scenarios:**
- Happy path: `write` to `.thinkwork/workpapers/<task_id>/notes.md` succeeds; file persists across reads.
- Happy path: `read` returns the written content.
- Happy path: `search` with regex returns matching files within scoped workpaper dir.
- Edge case: `write` outside workpaper dir but inside `/workspace/` raises `tool_context.interrupt` for approval (covered by U6's pattern).
- Error path: `write` outside `/workspace/` (e.g., `/etc/passwd`) raises `PermissionError` (no approval option; hard fail).
- Error path: path traversal (`/workspace/../etc/passwd`) raises `PermissionError`.
- Edge case: `delete` of workpaper succeeds without approval; `delete` of project file raises interrupt.
- Edge case: workpaper dir doesn't exist → `write` creates it.
- Integration: `workspace.snapshot()` round-trips through S3; `computer_snapshots` row registered; manifest readable.
- **Covers F2 (partial).** Goal loop writes intermediate state to workpapers under task-id without polluting model context; summaries return to thread.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_workspace.py` passes.

---

#### U8. Memory module — Hindsight integration with failure modes

**Goal:** `computer_stdlib.memory` provides `recall`, `retain` async tools wrapping Hindsight (preserve `arecall`/`areflect`/fresh-client/`aclose`/retry pattern); `briefing(session)` injects a concise memory recap at run start; failure-mode policy: 3 retries with exponential backoff, log `level=warn`, run with empty briefing on persistent failure; contradiction reconciliation: most-recent-wins with tombstone.

**Requirements:** R20, R21.

**Dependencies:** U1, U5.

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/memory.py`
- Test: `packages/computer-stdlib/tests/test_memory.py`

**Approach:**
- Lift `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` patterns into stdlib; preserve async wrappers verbatim.
- `briefing(session)` calls `recall` with a Hindsight bank `user_<userId>` and tag set drawn from session context; truncates to a target token budget; returns a system-message-shaped string.
- Failure path: on persistent Hindsight failure (3 retries exhausted), log `level=warn` event with payload `{module: 'memory', error: ...}`; return empty briefing.
- Contradiction reconciliation: when a `retain` is called with a fact that conflicts (same key, different value) with an existing fact, tombstone the older fact via Hindsight's existing pattern; surface in next briefing as `(updated)`.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` — async wrapper invariant.
- `feedback_hindsight_async_tools` and `feedback_hindsight_recall_reflect_pair` memories.

**Test scenarios:**
- Happy path: `recall` returns relevant facts for a user.
- Happy path: `retain` writes a fact; subsequent `recall` surfaces it.
- Happy path: `briefing(session)` returns a non-empty briefing within token budget.
- Edge case: Hindsight unavailable for first 2 calls; 3rd succeeds → returns content with no log.
- Edge case: Hindsight unavailable for all 3 retries → `briefing` returns empty string; `level=warn` event emitted.
- Edge case: contradicting `retain` calls (same fact key, conflicting values) → most-recent wins; older tombstoned; subsequent briefing shows `(updated)` annotation.
- Error path: `retain` on `level=warn` failure does NOT fail the calling task.
- **Covers AE11.** Memory conditioning round-trip: a fact retained in run N surfaces in run N+1's briefing.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_memory.py` passes.

---

### Phase 3 — Tool surface

#### U9. Google Workspace tools (Gmail + Calendar)

**Goal:** `computer_stdlib.google_workspace` provides Gmail (search/read/summarize/draft, send-with-approval) and Calendar (availability, create/update/cancel-with-approval). Tokens resolved through ThinkWork user OAuth at tool-call time; never raw long-lived tokens in workpapers/prompts.

**Requirements:** R16, R17, R24.

**Dependencies:** U1, U6 (approval gating).

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/google_workspace.py`
- Modify: `packages/api/src/handlers/computer-runtime.ts` — add `POST /api/computers/runtime/google/token` (resolves user OAuth token at tool-call time; narrow REST endpoint per `service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`).
- Test: `packages/computer-stdlib/tests/test_google_workspace.py`
- Test: `packages/api/src/__tests__/computer-google-token.test.ts`

**Approach:**
- Tool implementations call `POST /api/computers/runtime/google/token` (with Computer's `API_AUTH_SECRET` bearer) to resolve a short-lived token at tool-call time. The handler MUST cross-check the `(computer_id, user_id, tenant_id)` triple before resolving: (a) the requesting Computer's identity belongs to the asserted tenant, (b) the requested `user_id` is the `owner_user_id` of that Computer, and (c) the Computer's ECS task ID matches the active ECS task for that Computer row. Without this predicate, any service-secret holder can request another user's Google token by asserting an arbitrary `user_id` (per `service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`). Tokens never leave the tool function; never serialized into prompt or workpaper.
- Send-with-approval pattern: `gmail_send(draft)` raises `approvals.request(question='Send this email?', options=['Send', 'Edit', 'Cancel'], blast_radius='external_email')`; on approval, calls Gmail API with the (possibly edited) payload.
- Calendar mutations follow the same approval pattern.
- Drive/Docs/Sheets are deferred to a follow-up unit (covered in Outstanding Questions / Deferred to Implementation if planning surfaces a v1 use case need; otherwise `out` of v1 stdlib per origin scope).

**Patterns to follow:**
- `packages/computer-runtime/src/api-client.ts:75-90` — `checkGoogleWorkspaceConnection` shape; extend the API surface for token resolution.
- Existing per-user OAuth resolution at `packages/api/src/lib/connectors/`.

**Test scenarios:**
- Happy path: `gmail_search(query)` returns a list of messages.
- Happy path: `gmail_summarize(messageIds)` returns concise summaries.
- Happy path: `gmail_draft(to, subject, body)` returns a draft ID; subsequent `gmail_send(draftId)` raises approval interrupt.
- Edge case: `gmail_send` after approval-deny → returns `{ok: false, reason: 'approval_denied'}` without sending.
- Edge case: `gmail_send` after approval-edit → uses edited body.
- Error path: token resolution fails (user revoked OAuth) → tool returns structured error; goal loop emits `level=warn` event; task continues with reduced capability.
- Edge case: token expires mid-call → one retry with refreshed token; second failure surfaces as error.
- Happy path: `calendar_availability(timeRange)` returns busy/free slots.
- Happy path: `calendar_create(event)` raises approval; on approval, creates event.
- **Covers AE1, AE2.** Email triage and calendar scheduling acceptance round-trips: full draft → approval → send/create flow.
- **Covers AE13 (partial).** Multi-step customer follow-up: draft email + propose calendar slot share the approval primitive.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_google_workspace.py` passes.
- `pnpm --filter @thinkwork/api test` for `computer-google-token.test.ts` passes.

---

#### U10. MCP broker + observability events

**Goal:** `computer_stdlib.mcp_broker` resolves tenant/user-approved MCP connections, exposes only policy-allowed tools per `runtime_config.tool_policy`, isolates OAuth tokens through ThinkWork service APIs (no raw tokens in tool defs), records every MCP tool use in `computer_events`. `computer_stdlib.observability` emits structured events for model messages, tool calls, approvals, retries, failures, completion.

**Requirements:** R18, R31, R32.

**Dependencies:** U1, U5.

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/mcp_broker.py`
- Modify: `packages/computer-stdlib/src/computer_stdlib/observability.py`
- Test: `packages/computer-stdlib/tests/test_mcp_broker.py`
- Test: `packages/computer-stdlib/tests/test_observability.py`

**Approach:**
- `mcp_broker.connect(connection_id, user_id)` resolves via ThinkWork API; constructs `MCPClient` with `streamablehttp_client(url, headers={'Authorization': f'Bearer {token}'})`; tools wrap the MCP tool calls and emit `computer_events` for every invocation.
- Per-user ID resolution uses explicit predicate per `oauth-authorize-wrong-user-id-binding-2026-04-21`: `WHERE id = $userId AND tenant_id = $tenant`, never `WHERE tenant_id = ? LIMIT 1`.
- Tool policy filter: `tool_policy.allowed_mcp_tools` (set or wildcard) is checked at registration time; disallowed tools never surface to the agent.
- Token rotation: per-invocation reconstruct (header-callable transport wrapper deferred to v2 per Scope Boundaries).
- Observability event shape: `{type, level, payload, task_id, computer_id, timestamp, duration_ms?}` matching existing `computer_events` schema.
- Stream events from Strands `stream_async()` into `computer_events` via `observability.emit(event)`.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/server.py:580-599` — MCP client construction + bearer header injection.
- `packages/api/src/handlers/chat-agent-invoke.ts` — MCP config builder pattern (used by Strands today).
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — explicit user-id predicate.
- `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md` — Secrets Manager OAuth client creds.

**Test scenarios:**
- Happy path: `mcp_broker.connect(connection_id, user_id)` returns a configured `MCPClient`.
- Happy path: tool call emits a `mcp_tool_invocation` `computer_event` with payload `{server, tool, duration_ms, ok}`.
- Edge case: tool not in `tool_policy.allowed_mcp_tools` is filtered out at registration — never surfaces to the agent.
- Edge case: token expired → reconstruct happens transparently; one retry; second failure surfaces as error.
- Error path: connection_id resolved to a different user (multi-user-tenant bug class) → fail closed; emit `level=error` event.
- Error path: `runtime_config.tool_policy` updated mid-task (R28, AE15) → next tool call re-validates; if newly disallowed → `policy_changed_mid_task` event + transition to `blocked`.
- Integration: full round-trip with a stubbed MCP server confirms tool registration, invocation, event emission.
- **Covers AE12.** MCP tool orchestration acceptance: CRM update payload preparation succeeds; external write requires approval (provided by U6); tokens stay isolated.
- **Covers AE15.** Governance policy mid-task: admin disables an MCP tool while task is running; next tool call fails closed with `policy_changed_mid_task`.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_mcp_broker.py packages/computer-stdlib/tests/test_observability.py` passes.

---

#### U11. Routines integration

**Goal:** `computer_stdlib.routines` provides `trigger`, `status`, `result` tools with approval gates for destructive or externally visible routine actions; routine outputs attach to thread/workpapers.

**Requirements:** R19, R24.

**Dependencies:** U1, U6 (approvals), U10 (observability).

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/routines.py`
- Test: `packages/computer-stdlib/tests/test_routines.py`

**Approach:**
- `routines.trigger(name, inputs)` raises `approvals.request` for any routine flagged as destructive/externally-visible (per routine catalog metadata).
- `routines.status(executionId)` polls; emits `routine_progress` event on each poll.
- `routines.result(executionId)` writes routine output to workpaper at `.thinkwork/workpapers/<task-id>/routines/<routine_name>/output.json`.
- Sub-tool privilege escalation guard per Key Decisions: a routine that requires tools the Computer's policy disallows is rejected with `tool_policy_violation` before invocation.

**Patterns to follow:**
- `packages/api/src/lib/routines/recipe-catalog.ts` — routine catalog shape (recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md learning).

**Test scenarios:**
- Happy path: `trigger` non-destructive routine without approval; emits event; returns `executionId`.
- Happy path: `status` polls; returns progress; emits per-poll event.
- Happy path: `result` writes output to workpaper; returns content reference.
- Edge case: destructive routine triggers approval interrupt; on approve, fires; on deny, returns `{ok: false}`.
- Error path: routine fails mid-run → `status` returns `failed`; `result` returns error payload; goal loop continues (does not propagate as task failure).
- Edge case: routine requires tools not in Computer's policy → rejected with `tool_policy_violation` event.
- **Covers AE4.** Routine trigger natural-language acceptance: name resolution, input check, budget check, trigger, poll, output, summary in thread.

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_routines.py` passes.

---

### Phase 4 — Delegation + CE skills port

**Sequencing gate:** U13 (CE skill port spike) MUST land and produce a `green` verdict BEFORE U14 ships. The U14 container, ECR, IAM, and Code Interpreter wiring exist primarily to host `/lfg`-style CE-derived workflows. If U13 returns `red` (`/lfg` doesn't port; rewrite skills natively required), the U14 infra investment is mostly wasted — the coding worker becomes "stdlib + system prompt" with no CE-derived skills, which is a Strands subagent with extra hops. Do not invest in U14 infra until the spike confirms the substrate makes sense.

#### U12. Delegation primitive — Strands agents-as-tools + AgentCore InvokeAgentRuntime

**Goal:** `computer_stdlib.delegation.delegate(target, payload, output_schema, budget)` supports two substrates: in-process Strands subagent (`target='in_process'`) and AgentCore Runtime delegated worker (`target='agentcore'`). Bounded by output schema, budget, heartbeat (60s default), wall-clock timeout (1h default). Result row in `computer_delegations`.

**Requirements:** R22.

**Dependencies:** U1, U5.

**Files:**
- Modify: `packages/computer-stdlib/src/computer_stdlib/delegation.py`
- Modify: `packages/database-pg/src/schema/computers.ts` — `computer_delegations` `agent_id` FK becomes nullable for in-process subagents (if not already)
- Test: `packages/computer-stdlib/tests/test_delegation.py`

**Approach:**
- `target='in_process'`: spawn a Strands `Agent` as a tool (agents-as-tools pattern); pass `payload` as input; receive structured output; emit lifecycle events.
- `target='agentcore'`: call `InvokeAgentRuntime` (Bedrock AgentCore) with the runtime ID resolved from `delegation_config[target_name]`; pass `payload` in invocation context; receive structured response; emit lifecycle events.
- Both targets validate output against `output_schema` (JSON Schema); malformed output → one bounded retry → terminal `output_schema_invalid`.
- Heartbeat: stdlib emits `delegation_heartbeat` events every 60s while the delegation is in flight; missing heartbeat for 120s + budget breach → terminal failure.
- Result row: writes `computer_delegations` with status, attribution (which worker), input/output artifacts, error.
- Non-blocking: `agent.delegate` raises an interrupt-equivalent that yields the calling agent; the Computer's outer loop wakes on the completion event.
- **Tool-policy intersection invariant:** the delegated worker's effective tool policy is `parent_policy ∩ requested_policy`, never a superset of `parent_policy`. If the requested policy is a superset, the call fails closed with `tool_policy_violation` BEFORE the worker is spawned. Applies to both `target='in_process'` and `target='agentcore'`. Without this invariant, an automated goal-loop decision to spawn a sub-agent with a default (possibly broader) policy would bypass the parent's tool restrictions.

**Patterns to follow:**
- Strands docs: agents-as-tools pattern.
- `packages/api/agentcore-invoke.ts` — `InvokeAgentRuntimeCommand` invocation pattern.
- `feedback_avoid_fire_and_forget_lambda_invokes` memory — `RequestResponse` for user-initiated invokes; surface errors.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — typed `{ok: false, reason: 'inert'}` until the live target wires up.

**Test scenarios:**
- Happy path (in_process): spawn subagent; receive output matching schema; `computer_delegations` row written with `status='completed'`.
- Happy path (agentcore): invoke runtime; receive output; row written with `agent_id` populated.
- Edge case: output schema validation fails → one retry → on second failure, terminal `output_schema_invalid`.
- Edge case: wall-clock timeout exceeded → emit terminal `delegation_timeout`; row `status='failed'`.
- Edge case: heartbeat missing 120s+ → terminal `delegation_heartbeat_lost`.
- Error path: AgentCore InvokeAgentRuntime returns 5xx → one retry; second failure surfaces.
- Edge case: delegation requesting a tool the parent doesn't have → `tool_policy_violation` BEFORE worker spawn (intersection invariant; superset rejected).
- Edge case: delegation requesting a stricter subset of the parent's policy → effective policy is the requested subset; worker spawns; subset is enforced.
- Integration: end-to-end delegation through `computer_delegations` lifecycle (pending → running → completed/failed) with full event trace.
- **Covers AE3.** Linear → delegate → result attribution acceptance.
- **Covers AE5 (partial).** Parallel research subagents pattern (when called multiple times concurrently).
- **Covers AE8 (partial).** Coding task delegation (the AgentCore target is exercised in U14 with the real coding worker).

**Verification:**
- `uv run pytest packages/computer-stdlib/tests/test_delegation.py` passes.

---

#### U13. CE skills port spike — `lfg.md` + adapter shim coverage enumeration

**Goal:** Validate the CE skills port pattern by translating one production CE skill (`lfg.md`) and its transitively-loaded skills onto a Strands worker. Capture the verdict + the actual tool-coverage need (which shims are required) to `docs/solutions/`. Spike output gates U14.

**Requirements:** R25, R26, R27.

**Dependencies:** U12.

**Files:**
- Create: `packages/computer-stdlib/src/computer_stdlib/shims/{skill_loader,ask_user_question,task_tools,agent_tool}.py` — production implementations
- Create: spike harness in `packages/computer-stdlib/tests/test_skill_port_spike.py` (or under `packages/coding-worker-strands/tests/`)
- Create: `docs/solutions/architecture-patterns/computer-strands-ce-skill-port-spike-verdict-2026-MM-DD.md` — verdict doc
- Modify: `docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md` — add cross-reference to verdict (one-line update)

**Approach:**
- Vendor `lfg.md` from upstream EveryInc compound-engineering plugin (snapshot version).
- Implement four core shims:
  - `Skill` → `load_skill(name)` reads from `packages/coding-worker-strands/skills/`
  - `AskUserQuestion` → `tool_context.interrupt(name='approval', reason={question, options, prose})`
  - `TaskCreate/Get/List` → ThinkWork API tool calls (likely under `computer_tasks`)
  - `Agent` → Strands agents-as-tools wrapper
- Run `lfg.md` against a stub coding worker; trace which tools are referenced.
- Enumerate transitively-loaded skills (`lfg` calls `plan` calls `work` calls `commit-push-pr` etc.) and their tool references.
- Write verdict doc capturing: which shims worked unmodified, which needed adaptation, which tools beyond the 4 core need coverage (candidates from spec-flow analysis: `WebSearch`, `WebFetch`, `TodoWrite`, `Mcp__*`, `ExitPlanMode`, `BashOutput`, `KillShell`, `SlashCommand`).
- Recursion depth bound: max 3; cycle detection by skill-name set; `skill_recursion_depth_exceeded` event on violation.

**Execution note:** Ship the spike with explicit `verdict_status: green | needs_adaptation | red` annotation. Green unblocks U14; needs_adaptation triggers a planning-time review of the spike scope; red triggers a re-direction (e.g., rewrite skills natively rather than port).

**Patterns to follow:**
- `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md` — spike verdict doc shape.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — body-swap-safety test pattern (assert the live shim actually fires, not just that the test passes).

**Test scenarios:**
- Happy path: `load_skill('lfg')` reads markdown; returns content; subsequent `Skill` calls in the markdown route through `load_skill`.
- Happy path: `lfg.md`'s `AskUserQuestion` call raises a Strands interrupt; resume continues the skill mid-execution.
- Edge case: `load_skill('nonexistent')` returns structured error; coding worker handles gracefully.
- Edge case: skill recursion depth >3 → abort with `skill_recursion_depth_exceeded`.
- Edge case: skill cycle (`a` loads `b` loads `a`) → detected; aborted.
- Edge case: skill references a tool with no shim → structured error; spike verdict captures the gap.
- Integration: end-to-end `lfg.md` run on the coding worker against a real test repo; verifies plan → work → test → commit → push → PR shape; CI watch may be skipped/stubbed for spike scope.

**Verification:**
- Verdict doc lands in `docs/solutions/architecture-patterns/`.
- Verdict status is `green` (or the spike output names the gap that requires re-scoping).
- Spike harness test passes locally and on CI.

---

#### U14. Coding worker container + production CE skills + shim coverage extension

**Goal:** New `packages/coding-worker-strands/` container with vendored CE skills snapshot (curated set), production-grade adapter shims (extended per U13 verdict), AgentCore Runtime registration. Build pipeline pushes to a new ECR.

**Requirements:** R22 (delegation), R25, R26, R27.

**Dependencies:** U13 (spike verdict green).

**Files:**
- Create: `packages/coding-worker-strands/pyproject.toml`
- Create: `packages/coding-worker-strands/Dockerfile` (arm64 for AgentCore Runtime)
- Create: `packages/coding-worker-strands/src/coding_worker_strands/{__init__,entrypoint,system_prompt}.py`
- Create: `packages/coding-worker-strands/skills/coding/{lfg,plan,work,commit-push-pr,debug}.md` (bug-fix-focused subset; `resolve-pr-feedback.md` and `skills/review/` are out of v1 per origin scope — wider coding scope is a deliberate post-v1 decision)
- Create: `packages/coding-worker-strands/skills/manifest.yaml`
- Modify: `packages/computer-stdlib/src/computer_stdlib/shims/` — extended shims per U13 verdict
- Modify: `packages/agentcore/scripts/build-and-push.sh` — `--runtime coding-worker-strands`
- Modify: `packages/agentcore/scripts/create-runtime.sh` — `--runtime coding-worker-strands`
- Modify: `packages/lambda/agentcore-admin.ts` — extend the existing per-tenant Code Interpreter provisioning (sites at lines 27 and 395 invoke `CreateCodeInterpreterCommand`) to cover the coding worker's CI environment. Per-tenant CI provisioning lives in this Lambda, not in `terraform/modules/app/agentcore-code-interpreter/` (that module hosts only the substrate ECR + IAM templates).
- Modify: `terraform/modules/app/agentcore-code-interpreter/main.tf` — extend `tenant_role_inline_policy_template` to include `bedrock-agentcore:StartCodeInterpreterSession` and siblings if the coding worker's IAM grant doesn't already cover them (per `agentcore-runtime-role-missing-code-interpreter-perms-2026-04-24`)
- Modify: `.github/workflows/deploy.yml` — extend image-build path filter; new step for coding worker image
- Test: `packages/coding-worker-strands/tests/test_entrypoint.py`
- Test: `packages/coding-worker-strands/tests/test_skill_loading_e2e.py`

**Approach:**
- Coding worker entrypoint receives an `InvokeAgentRuntime` payload (delegation context); resolves per-tenant `codeInterpreterIdentifier`; instantiates Strands Agent with system prompt + stdlib tools + skills folder + extended shims.
- System prompt is bug-fix-focused; instructs agent to call `load_skill('lfg')` for autonomous coding tasks.
- Terraform: AgentCore Runtime resource with separate IAM grant for Code Interpreter; arm64 image; full inference-profile-prefixed model ID.
- Vendored skills are a snapshot. Integrity gate: `manifest.yaml` carries an entry per skill file with a SHA256 hash of the expected content; CI re-hashes the vendored files on every PR build and fails if any hash drifts; any `skills/` change requires named-reviewer approval (Tier-1 gate per `flue-supply-chain-integrity-2026-05-04.md`). The Flue supply-chain CI gate covers JS deps only — extending it to cover the Python/markdown skills folder is part of U14, not assumed inherited.
- Coding worker uses the same `computer-stdlib` with extra `skills/` shipped only here.

**Patterns to follow:**
- `packages/agentcore-flue/agent-container/Dockerfile` — Python container shape (port to Strands base).
- `packages/agentcore/scripts/create-runtime.sh:64-78` — `aws bedrock-agentcore-control create-agent-runtime` invocation.
- `terraform/modules/app/agentcore-code-interpreter/main.tf` — per-tenant Code Interpreter resource pattern.
- `flue-fr9a-integration-spike-verdict-2026-05-03.md` — Bedrock model ID format; cwd gotcha.

**Test scenarios:**
- Happy path: container boots; `entrypoint.handle(payload)` instantiates Strands Agent with skills folder available.
- Happy path: `load_skill('lfg')` reads the vendored markdown and returns content.
- Happy path: `lfg.md` end-to-end against a real test repo (separate test branch, GitHub App token from secrets) opens a green draft PR.
- Edge case: `load_skill` for skill not in vendored snapshot is hard-blocked at the shim — emits `skill_load_blocked` and returns a structured error to the agent. NOT surfaced as an approval prompt (per R24 expansion: out-of-snapshot loads are a supply-chain boundary, not a user-discretion question).
- Edge case: `git push` to protected branch (e.g., `main`) is blocked structurally (GitHub App token policy).
- Edge case: skill recursion depth >3 → aborts with structured event.
- Error path: AgentCore Code Interpreter session fails to start → emit `level=error` event; `delegation` returns terminal failure.
- Integration: full delegation cycle from Computer → coding worker → green draft PR → result back to Computer.
- **Covers AE8.** Workspace coding task acceptance: Computer delegates; coding worker runs `/lfg`; PR opened; no unapproved push/PR; changed files recorded; Computer remains owner.

**Verification:**
- `uv run pytest packages/coding-worker-strands/tests/` passes.
- `bash packages/agentcore/scripts/build-and-push.sh --runtime coding-worker-strands --stage dev` succeeds.
- `bash packages/agentcore/scripts/create-runtime.sh --stage dev --runtime coding-worker-strands` provisions the AgentCore Runtime.
- E2E test (gated to dev) opens a real draft PR on a sandbox repo.

---

### Phase 5 — Wiring + acceptance

#### U15. Linear connector → Computer task wiring (inert seam → live)

**Goal:** Implement the connector → Computer dispatch path described in `2026-05-07-computer-first-connector-routing-requirements.md`. New narrow REST endpoint `POST /api/connectors/dispatch-to-computer`; idempotency via `computer_tasks.idempotency_key`; fail-closed multi-Computer guard; preserves connector_execution provenance per the connector-routing brainstorm. Ships **inert first** (endpoint accepts payload, returns `{ok: false, reason: 'inert'}`) → **live second** (full task creation + Computer claim).

**Requirements:** R1 (origin), F1 (origin).

**Dependencies:** U2 (task-type extension), U3 (Computer container claiming new task types), U6 (approval round-trip if connector dispatch needs HITL).

**Files:**
- Create: `packages/api/src/handlers/connector-to-computer.ts` — narrow endpoint
- Modify: `packages/api/src/lib/connectors/runtime.ts` — Linear connector calls dispatch endpoint
- Modify: `packages/api/src/lib/computers/tasks.ts` — accept `connector_dispatched` task type
- Test: `packages/api/src/__tests__/connector-to-computer-inert.test.ts`
- Test: `packages/api/src/__tests__/connector-to-computer-live.test.ts`
- Test: `packages/api/src/__tests__/connector-routing-idempotency.test.ts`

**Execution note:** Land inert seam first (endpoint scaffolded, returns typed `{ok: false, reason: 'inert'}`) → land live integration second with body-swap-safety test asserting `task_created` event fires and `computer_tasks` row inserted.

**Approach:**
- Endpoint: narrow `POST /api/connectors/dispatch-to-computer` accepts `{tenant, userId, kind, ref, idempotencyKey?}`; resolves the user's active Computer via `SELECT id FROM computers WHERE tenant_id = $tenant AND owner_user_id = $userId AND status <> 'archived'` (fail closed on zero rows; the `uq_computers_active_owner` partial unique index enforces ≤1 active); inserts `computer_tasks` row with derived `idempotency_key` (`linear:issue:<id>:<updated_at>` for Linear) on conflict do nothing.
- Connector runtime calls the endpoint after recording its own connector_execution row (preserves provenance per origin connector-routing brainstorm).
- Auth: endpoint accepts only service-level `API_AUTH_SECRET` (per `service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`).

**Patterns to follow:**
- `docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md` — origin direction.
- `packages/api/src/lib/connectors/runtime.ts` — existing connector runtime extension point.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — seam pattern.

**Test scenarios:**
- **Inert phase:**
  - Happy path: endpoint accepts payload, returns `{ok: false, reason: 'inert'}`; emits `dispatch_seam_called` audit event.
- **Live phase:**
  - Happy path: Linear webhook → connector_execution recorded → dispatch endpoint called → `computer_tasks` row inserted with stable `idempotency_key`.
  - Happy path: Computer claims the new task; goal loop fires; thread is created.
  - Edge case: duplicate Linear webhook (same `id`+`updated_at`) → second dispatch is a no-op due to unique constraint; no duplicate task.
  - Edge case: Linear issue updated (`updated_at` bumps) → new task with new idempotency_key; previous task remains for audit.
  - Edge case: user has no active Computer → fail closed with `{ok: false, reason: 'no_active_computer'}`; connector_execution recorded with `routing_failed`.
  - Edge case: user has 2+ active Computers (structurally unreachable today via `uq_computers_active_owner`; defensive branch retained) → fail closed; admin alert.
  - Error path: `API_AUTH_SECRET` missing/wrong → 401.
  - Body-swap-safety integration test: live default fires `task_created` event; assert `task_count == 1` after one webhook.
  - **Covers AE3.** Linear connector intake acceptance: visible owner is the Computer; delegated work is attributed.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes for the three new test files.
- E2E test (gated to dev): a real Linear webhook event creates a real `computer_tasks` row that the Computer claims and processes.

---

#### U16. Golden workflow E2E demo + acceptance smoke

**Goal:** Wire the full v1 acceptance flow on Eric's dev tenant: Linear bug-fix issue arrives → Computer claims → reads memory + workspace context → drafts plan → at least one HITL approval round-trip via mobile → optionally delegates to coding worker → external action applied (PR created or email sent or calendar event made) → final thread update + audit. Add the 4th smoke scenario to deploy gate.

**Requirements:** R33 (origin), R34 (origin), AE1, AE2, AE3, AE10, AE14, AE15.

**Dependencies:** U1–U9, U12, U13, U14, U15 are blocking for golden-workflow acceptance per origin R34's priority sequence. U10 (MCP broker) and U11 (routines) are NOT on the golden-workflow critical path (origin R34 doesn't list them as v1-acceptance prerequisites) — they may be in-flight or land after U16 without delaying acceptance. The observability half of U10 lands with U5 (event emission is critical-path); the MCP-broker half can ship later.

**Files:**
- Modify: `packages/api/src/__smoke__/computer-marco-smoke.ts` — wire the `interrupt-and-resume` scenario live (was inert in U4)
- Create: `packages/computer-strands/tests/test_golden_workflow_e2e.py` — E2E test exercising the full flow on dev (gated to manual run)
- Modify: `docs/solutions/architecture-patterns/` — write `computer-strands-launch-2026-MM-DD.md` capturing the launch verdict (mirrors `flue-runtime-launch-2026-05-04.md` shape)
- Modify: `STRATEGY.md` (if exists) — note the Computer launch milestone

**Approach:**
- E2E test creates a sandbox Linear issue with a known label; submits a webhook event simulating a Linear notification; polls for the `computer_tasks` row; waits for the Computer to handle it; verifies thread updates + at least one inbox approval round-trip; verifies the external action lands; verifies audit completeness.
- Launch doc captures: what's true after launch, smoke gate behavior, deferred items, rollback playbook.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` — launch doc shape.

**Test scenarios:**
- Happy path: golden workflow runs end-to-end on dev; PR opened (if delegation path) OR email sent (if email path) OR calendar event created (if calendar path).
- Edge case: HITL approval denied mid-flow → task transitions to `blocked`; user notified; no external action.
- Edge case: ECS task restarts mid-pause → on next claim, paused state hydrates correctly; resume continues.
- Edge case: budget exceeded mid-flow → `policy_changed_mid_task` or `budget_exceeded` event; transition to `blocked`.
- **Covers AE1.** (email path) Email triage round-trip with approval.
- **Covers AE2.** (calendar path) Calendar scheduling round-trip with approval.
- **Covers AE3.** (Linear path) Linear → Computer → delegate → result.
- **Covers AE10.** Approval resume with full audit context.
- **Covers AE14.** Failure recovery: a tool call fails → bounded retry → blocked state with clear next-action.
- **Covers AE15.** Governance: admin disables a tool mid-task → policy re-validate → blocked.

**Verification:**
- E2E test passes on dev.
- Smoke gate's 4 scenarios (`fresh-thread`, `multi-turn-history`, `memory-bearing`, `interrupt-and-resume`) all pass on every dev deploy.
- Launch doc lands in `docs/solutions/architecture-patterns/`.
- Rollback playbook documented and tested (column-flip rollback or ECR image revert).

---

## System-Wide Impact

- **Interaction graph:** New surfaces — `POST /api/connectors/dispatch-to-computer` (U15), `POST /api/computers/approval/respond` (U6), `POST /api/computers/runtime/google/token` (U9). Existing `chat-agent-invoke` MCP config builder is reused. Mobile inbox extends with `type='computer_approval'` (U6).
- **Error propagation:** Tool failures emit `level=error` events but don't propagate as task failures unless the goal loop exhausts retries (U5). Approval timeouts transition to `blocked`. Persistent infra failures (Hindsight, MCP) degrade gracefully with `level=warn` events.
- **State lifecycle risks:** Paused Strands sessions are durable in `computer_snapshots`; ECS task restart is recoverable. `computer_tasks` row idempotency prevents duplicates from connector retries. `computer_delegations` heartbeat detects orphaned worker invocations.
- **API surface parity:** No existing API surface is changed in v1 except the additions above. The TS `computer-runtime` API endpoints (claim/complete/fail/heartbeat/appendEvent) are unchanged; the new Python container speaks the same contract.
- **Integration coverage:** Body-swap-safety integration tests on inert→live seams (U6, U15). End-to-end golden workflow on dev (U16). 4-scenario deploy smoke gate (U4 + U16).
- **Unchanged invariants:** Existing Marco/Flue runtime, agent_templates dispatcher (`packages/api/src/lib/resolve-runtime-function-name.ts`), AgentCore Strands runtime for non-Computer agents, Hindsight async-wrapper pattern, Bedrock model inference profile prefixing, supply-chain baseline.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Strands `BeforeToolCallEvent` hook + `agent.cancel()` semantics don't match expectations (e.g., agent doesn't honor cancel mid-step) | U5 includes targeted test scenarios; if unworkable, fall back to a tool-wrapper pattern that checks budget before each call (slower but safer). |
| AuroraSessionManager paused-state encoding doesn't round-trip cleanly across ECS restart | U6 inert seam ships first with the encoding tested in isolation; live seam waits until round-trip is proven. msgpack of `agent.state + messages` is the working assumption. |
| CE skill port verdict is `red` (lfg.md fundamentally doesn't port) | U13 spike captures verdict explicitly; if red, U14 re-scopes to "rewrite skills natively" rather than "port." Plan continues without `/lfg` in v1; coding worker still ships with stdlib tools but no CE-derived workflows. |
| AgentCore Code Interpreter per-tenant `codeInterpreterIdentifier` provisioning has Terraform pattern gaps | U14 extends `terraform/modules/app/agentcore-code-interpreter/` per existing pattern; if gap is wider than expected, plan-time spike during Phase 4. |
| Connector-side connector_execution → Computer dispatch ordering creates orphan rows on partial failure | U15 makes the dispatch transactional with the connector_execution write where possible; orphan rows have a sweeper job per `mcp-approval-sweeper` pattern. |
| Mobile inbox UX for `computer_approval` queue rendering is more work than expected | U6 v1 uses minimal UX (single thread message + push per approval); rich queue UI deferred. |
| HITL no-response timeout sweeper job missed → tasks stuck in `needs_approval` forever | Cron-style sweeper Lambda runs daily; emits metric on expired-approval count for ops dashboards. |
| Per-tenant GitHub App installation flow has gaps | U14 explicitly defers tenant onboarding for GitHub App to a separate concern; v1 assumes Eric's tenant has the App installed manually. |
| Strands version 1.38.0 has breaking changes vs. 1.34.0 (current `agentcore-strands` pin) | Pin to a tested Strands version in U1; bump existing `agentcore-strands` only after Computer ships and is stable. |
| Build-pipeline image-tag drift (per `multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24`) leaks across Computer + coding worker | Use split-arch tags from day one (amd64 for Computer/Lambda, arm64 for AgentCore); explicit `--min-source-sha --strict` post-deploy verification. |

---

## Documentation / Operational Notes

- **Launch doc** lands at `docs/solutions/architecture-patterns/computer-strands-launch-2026-MM-DD.md` capturing the smoke-gate state, regression detectors, rollback playbook, and deferred items.
- **Spike verdicts** for U13 land at `docs/solutions/architecture-patterns/computer-strands-ce-skill-port-spike-verdict-2026-MM-DD.md`.
- **Operator runbook**: smoke gate behavior on every dev deploy; rollback via image-revert or per-Computer ECS reconciler config flip.
- **Memory updates**: after Phase 5 ships, update `MEMORY.md` index with a `project_thinkwork_computer_strands_launched.md` entry.
- **Cost monitoring**: per-Computer ECS Fargate cost is the dominant driver; CloudWatch dashboard tracking per-tenant spend.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md`
- **Related brainstorms:** `docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md`, `docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md`, `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md` (separate-track context)
- **Superseded brainstorm:** `docs/brainstorms/archived/2026-05-07-computer-generalist-and-coding-subagent-requirements.md`
- **Architecture patterns:** `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` (smoke-gate pattern), `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`, `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`
- **Workflow learnings:** `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`
- **Runtime errors:** `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md`
- **Build errors:** `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md`
- **Integration issues:** `docs/solutions/integration-issues/agentcore-runtime-role-missing-code-interpreter-perms-2026-04-24.md`, `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
- **Best practices:** `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`, `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`
- **External docs:** Strands SDK 1.38.0 — agent loop, interrupts, session management, multi-agent patterns, MCP, streaming, Bedrock provider (URLs in Context & Research → External References)
- **Related code:** `packages/agentcore-strands/agent-container/container-sources/server.py:683-1401, 580-599, 1531-1538`, `packages/database-pg/src/schema/computers.ts:25-247`, `terraform/modules/app/computer-runtime/main.tf:14-227`, `packages/api/src/lib/connectors/runtime.ts`, `packages/computer-runtime/src/{index,task-loop,api-client,workspace}.ts`
