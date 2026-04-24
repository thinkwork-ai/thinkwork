---
title: "feat: V1 Agent Architecture — Final Call"
type: feat
status: active
date: 2026-04-23
deepened: 2026-04-23
origin: docs/brainstorms/2026-04-23-v1-agent-architecture-final-call-requirements.md
---

# V1 Agent Architecture — Final Call

## Overview

Pre-launch consolidation of the Thinkwork agent harness around a **file-first, skills-first** product model where every per-invocation capability is declared, resolved, and logged. Collapses four skill execution types to one (deletes the parallel composition runner), moves all skill-script execution into the AgentCore Code Interpreter sandbox, adds tenant self-serve plugin upload with an admin-approval gate on any bundled MCP endpoints, migrates the existing bundled skill corpus to the unified format, AND introduces a **Resolved Capability Manifest (RCM)** per agent invocation so customers and admins can answer the question "what is this agent actually running right now?" — today they cannot.

The core product bets:
- **File-first:** Workspace files are the foundation. SKILL.md bundles + `references/` + `scripts/` are the portable unit.
- **Skills-first:** Skills are the primary extensibility primitive. Tools (`execute_code`, `web_search`, `recall`/`reflect`, `artifacts`, `Skill`) are declared capabilities the runtime grants explicitly — they appear in the manifest alongside skills, not as an invisible parallel system.
- **One resolved truth per run:** At agent session start, the intersection of tenant kill-switches ∩ template blocks ∩ skill `allowed-tools` ∩ manifest — plus the workspace files loaded and MCP servers connected — is captured, logged, and exposable via admin UI. No capability exists in the runtime without appearing in the manifest.
- **Uniform extensibility:** Tenants extend by uploading a Claude-format SKILL.md bundle or Claude Code plugin; Strands is the sole orchestrator; sandbox is the universal script execution boundary.

Agent-authored skill drafts (the compounding loop) are deferred to v1.1 post-pilot; the product decision is preserved but the implementation is gated on pilot signal. See Scope Boundaries.

---

## Problem Frame

Two failure modes we're addressing simultaneously:

**Scaffolding.** The harness carries four skill execution types (`script` / `context` / `composition` / `declarative`) at the YAML/runtime layer, only two exercised in production. A parallel orchestrator (`composition_runner.py`, ~429 lines) duplicates what Strands does natively. Zero self-serve path for tenants to add skills.

**Opacity.** Capability assembly today is spread across ten-plus places: `agent_templates.skills`, `agent_templates.blocked_tools`, `tenants.disabled_builtin_tools` (proposed), `agent_template_mcp_servers` + `tenant_mcp_servers.status`, workspace files (`AGENTS.md`, `USER.md`, profile-aware loading), hard-coded built-ins in `server.py`, SKILL.md frontmatter, `allowed-tools` (informational), `agent_skills.permissions.operations`, and the Strands `AgentSkills` plugin's on-the-fly disclosure. Even after we collapse execution types and add upload, a customer or admin still cannot predict what an agent is actually running this turn. The scaffolding problem is what this plan was originally scoped for; **the opacity problem is equally important and was under-scoped**. A second-pass review confirmed the runtime is powerful enough — the danger is what a customer can see of it.

Four enterprises × 100+ agents × ~5 templates will hit imminently; post-launch, architectural changes to skill shape, template contracts, and agent runtime semantics become expensive to reverse.

The origin brainstorm (see origin: `docs/brainstorms/2026-04-23-v1-agent-architecture-final-call-requirements.md`) resolved nine product decisions. V1 implements eight of them; the ninth (agent-authored drafts) defers. This plan additionally introduces R12 (Resolved Capability Manifest) as a plan-originated requirement surfaced during review.

1. Tenant self-serve upload is the capability surface — **v1**
2. Exact Anthropic Agent Skills spec parity (SKILL.md + frontmatter + optional `scripts/` + optional `references/`) — **v1**
3. Claude Code plugin format parity (plugin.json + skills/ + mcp.json + honored/rejected field list) — **v1**
4. Built-ins default-on with tenant kill-switches — **v1** (schema + runtime filter in v1; admin UI defers per R6 note)
5. All skill scripts run in the sandbox — unified execution, first-party and uploaded — **v1**
6. Pre-launch migration of existing bundled skills to the unified format — **v1**
7. MCP endpoints inside uploaded plugins require admin approval before activation — **v1**
8. Agents can author skill drafts, opt-in per template (`skill_author` built-in) — **deferred to v1.1** (compounding loop gated on pilot signal)
9. One skill execution type; Strands is the sole orchestrator via the `Skill` tool — **v1**

---

## Requirements Trace

- R1. Tenant self-serve upload of Claude-format SKILL.md bundles (origin R1-R2).
- R2. Claude Code plugin format parity; plugin upload is atomic at the plugin level (origin R3, origin R12).
- R3. Exactly one skill execution type in the data model and runtime (origin R4).
- R4. All skill scripts execute inside the AgentCore Code Interpreter sandbox; Strands container never runs tenant-authored code (origin R5).
- R5. Strands is the sole orchestrator; the parallel `composition_runner.py` code path is removed (origin R6, origin R17).
- R6. Built-in tool baseline (`execute_code`, `web_search`, `recall`/`reflect`, `artifacts`, `Skill`) registered per agent session; template blocks narrow, never widen (origin R7-R11). Runtime filtering + `disabled_builtin_tools` schema column ship in v1; admin UI for editing the column can defer post-pilot.
- R7. Tenants can globally disable built-in tools; template can further narrow. No template can unblock what the tenant disabled (origin R10-R11).
- R8. MCP endpoints shipped inside an uploaded plugin register as pending and require admin approval before any agent can invoke them. Skills from the plugin install immediately; only the network-reaching MCP layer is gated (origin R13).
- R9. **Deferred to v1.1.** Agent-authored skill drafts via a template-opt-in `skill_author` built-in (origin R14-R16). The architectural seat is reserved but not implemented in v1. See Scope Boundaries.
- R10. Progressive disclosure via the Strands AgentSkills plugin remains the scale strategy; system-prompt up-front injection of every skill is rejected (origin R18).
- R11. All existing bundled skills migrate to the unified SKILL.md format before launch, with observably equivalent output for deterministic skills and shadow-traffic A/B validation for LLM-mediated skills (origin R19-R22).
- R12. **Resolved Capability Manifest (RCM) per invocation.** At every agent session start, the runtime captures a structured record of exactly which capabilities the session is granted — workspace files loaded, skills registered, built-in tools registered, MCP servers connected, and anything explicitly blocked — then logs it and makes it retrievable via admin UI. No capability may exist in an agent session without appearing in its manifest. Plan-originated from second-pass review; not carried from origin brainstorm.

**Origin actors:** A1 (tenant admin), A2 (template author), A3 (end user), A4 (agent — the drafts-authoring role is deferred with R9), A5 (Thinkwork SRE, explicitly non-gatekeeping).

**Origin flows:** F1 (plugin upload), F2 (agent invokes skill at runtime), F3 *(agent authors a draft — deferred to v1.1 with R9)*, F4 (tenant disables a built-in).

**Origin acceptance examples:** AE1 (covers R1, R2), AE2 (covers R3, plus origin R12 and R13 — plugin atomicity + MCP pending), AE3 (covers R4, R5, R6), AE4 (covers R6, origin R17, origin R21), AE5 (covers R10, R11), *AE6 (skill_author end-to-end — deferred with R9)*.

Origin R-ID → plan R-ID map for unambiguous traceability:

| Origin | Plan | Notes |
|---|---|---|
| origin R1, R2 | R1 | Self-serve upload |
| origin R3 | R2 | Plugin format parity |
| origin R4 | R3 | One execution type |
| origin R5 | R4 | All scripts in sandbox |
| origin R6 | R5 | Strands sole orchestrator |
| origin R7-R11 | R6 | Built-ins baseline |
| origin R10, R11 | R7 | Kill-switch precedence |
| origin R12 | part of R2 | Plugin atomicity |
| origin R13 | R8 | MCP admin approval |
| origin R14-R16 | R9 (deferred) | `skill_author` |
| origin R17 | R5 | Strands sole orchestrator |
| origin R18 | R10 | Progressive disclosure |
| origin R19-R22 | R11 | Pre-launch migration |
| *(plan-originated)* | R12 | Resolved Capability Manifest — surfaced during code-audit review; not in origin brainstorm |

---

## Scope Boundaries

### Deferred for later

*(Carried from origin — product/version sequencing.)*

- Cross-tenant marketplace / skill sharing. V1 tenants upload to their own library only.
- Skill signing / SHA256 verification at upload.
- Per-user skill enable/disable on mobile; tenant admin controls the library.
- Skill versioning UX (re-uploading overwrites; no side-by-side versions).
- Per-skill cost metering and quotas (tenant-level quotas stand).
- Semver compatibility contract for SKILL.md frontmatter.
- GitOps auto-sync of a plugin repo (V1 is upload via web + CLI).
- Rich draft review UI (plain diff + approve/reject is enough for V1).

### Outside this product's identity

*(Carried from origin — positioning rejection.)*

- Closed marketplace with revenue share.
- Human review / gatekeeping of tenant uploads by Thinkwork staff.
- Non-AWS runtimes (K8s, Docker Compose, Azure).
- Custom skill execution types beyond Claude's spec — the answer is always "write it in SKILL.md prose."
- Runtime-level workflow DSLs (BPMN, state machines). The model is the orchestrator.

### Deferred to Follow-Up Work

*(Plan-local — implementation intentionally split.)*

- **V1.1 compounding loop (origin R9).** The `skill_author` built-in tool, `skillDrafts` table, sandbox-to-API drafts endpoint, and admin draft-review/promotion UI. Rationale: origin defines this as "on templates with `skill_author` enabled during early pilots, ≥1 promoted skill per week per active template" — that's a pilot-measured outcome, not a pre-launch capability. Architectural seat is reserved (the `Skill` meta-tool and plugin upload path make v1.1 addition straightforward). A hard runtime-level stub rejects `skill_author` tool calls with "not registered" until v1.1 ships.
- **Admin UI for tenant kill-switches (part of R6).** The schema column and runtime filter ship in v1. The admin UI tab + GraphQL mutation to edit `disabled_builtin_tools` defer until a pilot requests it; until then operators flip the column via DB mutation or a minimal internal tool.
- **CLI `thinkwork skill push` full developer workflow.** Minimal implementation in U14 (POSTs a zip to the upload REST endpoint). Richer operator workflow (local SKILL.md lint, plugin preview, schema verification) defers to post-pilot.
- **Warm AgentCore flush on deploy (originally bundled in U14).** Moves to U2 so the deploy race is mitigated independently of CLI closeout.

---

## Security Invariants

*(These are non-negotiable properties every implementation unit must honor. Violating any of them requires a recorded, reviewed security decision, not silent departure.)*

- **SI-1. No shared bearer secret inside a session that runs tenant-authored Python.** Any sandbox-to-API callback (v1 has none; v1.1 `skill_author` will have one) must use short-lived per-invocation capability tokens, NOT `THINKWORK_API_SECRET`. Token payload: `{aud, exp≤60s, tenant_id, user_id, principal_id, draft_id or other resource-scope}`, signed with a key unreadable from inside the sandbox.
- **SI-2. Args are data, not code.** The skill dispatcher must NEVER embed `repr(args)` into an `executeCode` string. Args travel through `writeFiles` as `json.dumps(args)`, loaded inside the session via `json.load(open(...))`.
- **SI-3. Session pool key includes user_id.** The AgentCore Code Interpreter preamble binds per-user OAuth tokens into session `os.environ`. Reusing a session across users leaks tokens. Pool key: `(tenant_id, user_id, environment)`.
- **SI-4. Plugin zip validation happens before any S3 write or DB insert.** Path-normalization-escape, max decompressed size, max file count, and symlink rejection are preconditions, not post-conditions.
- **SI-5. Approved MCP endpoints are hash-pinned.** `approveMcpServer` records `hash(url, auth_config)`. Any subsequent update to `url` or `auth_config` on an `approved` row automatically reverts `status` to `pending` and clears the approval metadata.
- **SI-6. Module namespace reset between invocations.** The skill dispatcher either runs each call in a fresh subprocess or explicitly `importlib.invalidate_caches()` + purges `sys.modules["scripts.<slug>.*"]` before each call, to prevent monkey-patches persisting across skills in the same pool session.
- **SI-7. Every capability is declared.** No tool, skill, MCP server, or workspace-file set may be present in an agent session without appearing in that session's Resolved Capability Manifest (R12). Built-in tools register through the same manifest path as user-uploaded skills — Python implementation is an implementation detail, not a reason to skip the declaration. A capability that does not appear in the manifest is not granted; enforcement is code, not policy.

---

## Key Technical Decisions

- **`Skill` meta-tool, not per-skill named tools.** A single `Skill(name, args)` meta-tool dispatches by slug. The Strands `AgentSkills` plugin remains responsible for Level-1 progressive disclosure ONLY — injecting skill name+description into the system prompt. Our `Skill` meta-tool is the invocation path (AgentSkills' built-in `skills` tool from the Strands SDK is NOT registered in our runtime; it overlaps with our meta-tool and the two should not coexist). Trade-off: the Claude Code CLI invokes skills by `cat SKILL.md`; we invoke by meta-tool. **Bundle format is spec-parity; invocation mechanism is Strands-idiomatic.** Tenants bringing skills expecting enforcement of `allowed-tools` will see a security surprise — see next decision.
- **`allowed-tools` frontmatter: informational, not enforcement.** The Anthropic spec's `allowed-tools` field is Claude-Code-only. Effective runtime ceiling is the harness-constructed tool allowlist. V1 plan: parse `allowed-tools` at upload time for operator review (admin UI surfaces it), **intersect it** with the harness allowlist at session construction (tightens to declared floor, never widens), and log any declared tool that is not in the session allowlist. Tenants cannot rely on `allowed-tools` as an attack-surface limit; they must rely on template blocks + tenant kill-switches.
- **All Code Interpreter skill dispatch uses `writeFiles` + load-args-from-file.** Standardized entrypoint is `scripts/<skill_slug>/entrypoint.py` with a module-level `run(**kwargs) -> dict` that the validator checks for. Args serialize via `writeFiles([{path: "_args.json", text: json.dumps(args)}])`; the executeCode payload loads them. No `repr()` of model-controlled data in a code string. See SI-2.
- **Multi-entrypoint migration policy.** 9 of 12 current script skills declare multiple callables (`thinkwork-admin` has 33 entries). Per-slug migration decision during U1 bucketing: (a) if entries share input shape and differ only by verb, collapse via an `action: str` arg dispatched inside `entrypoint.py`; (b) if entries are independent with different signatures, explode into N distinct slugs that share a `references/` folder and each have their own `scripts/<sub_slug>/entrypoint.py`. Plugin upload format allows both shapes; neither requires a new execution-type primitive.
- **Session pool per `(tenant_id, user_id, environment)`.** Cold starts are 2–5s; per-skill-call sessions are prohibitively slow. Pool scope is per-tenant-user-environment with LRU eviction (8 sessions per tenant, 30-min idle). User-scoped is non-negotiable per SI-3.
- **Module namespace reset per call (SI-6).** Within a pool session, the dispatcher purges `sys.modules["scripts.<slug>.*"]` and calls `importlib.invalidate_caches()` before each invocation. This prevents monkey-patching persistence. Cost is small (module re-import on warm filesystem).
- **Plugin install is a saga, not a transaction (SI-4).** Distributed state across Aurora + S3 cannot be a plain DB transaction. See U10 for the three-phase saga.
- **Reject Claude Code plugin fields that have no Strands analogue.** `hooks/`, `monitors/`, `themes/`, `lspServers/`, `outputStyles/`, `bin/`, `channels` → reject with a clear validator error. `commands/` → warn-and-ignore (UI-only concept). Honor: `name`, `version`, `description`, `author`, `skills`, `mcpServers`/`mcp.json`, `agents`, `userConfig` (pass through to tenant prompt at enable time).
- **MCP pending/approved as a status column + url_hash pin (SI-5).** Mirrors the existing `userMcpTokens.status` pattern. `buildMcpConfigs` filters `status = 'approved' AND enabled = true`. Hash pin at approve time; any url/auth_config mutation reverts to `pending`.
- **Pre-migration slug-collision sweep runs BEFORE any schema or runtime changes.** U1 is the hard first step. Each of the ~22 current bundled skills gets an explicit migration verdict (in-place swap vs. rename-to-legacy vs. retire) before U3 touches schema. Retirement criterion requires FOUR signals: zero `agent_skills` enabled rows, AND last commit > 90 days, AND no open issue referencing the slug, AND explicit feature-owner sign-off.
- **Dockerfile structural fix (U2) happens before any new Python modules ship.** Same-class bug has recurred 4× in 7 days.
- **Nested-Skill depth = 5 (not 10), plus 50-total-per-turn budget.** Current corpus max observed depth is 3; 5 leaves headroom. Depth limit catches runaway recursion; total-call budget catches sequential-loop abuse; both are needed.
- **Characterization testing is bifurcated (U7).** Deterministic script skills (~12) use cheap pytest parametrize with mocked AgentCore. LLM-mediated skills (current `composition` + `context`, ~9 skills) use **60-day shadow-traffic A/B** — feature flag retains the legacy path in parallel, real production invocations fan out to both, divergence metrics drive per-skill cutover. Keyword-match tolerance is NOT the gate for these; semantic divergence on rare paths is the failure mode that would otherwise ship silently.
- **Compounding (skill_author) defers to v1.1.** Architectural seat preserved; implementation not worth pre-launch scope.
- **Built-in tools are declared capabilities, not a parallel system.** `execute_code`, `web_search`, `recall`, `reflect`, `artifacts`, `Skill` register through the same `capabilities` table / catalog entry that uploaded skills use (with `source='builtin'` and an implementation pointer to the Python module). This means they are assignable, blockable, auditable, and manifest-visible on the same primitives. The implementation code stays in the Strands container; the *declaration* lives in the catalog. Future changes to the set of built-ins are data changes, not code-registration changes.
- **Resolved Capability Manifest is the single truth.** At `Agent(tools=...)` construction, the runtime assembles and captures the full set of skills + tools + MCP + workspace files + blocks in one structured record. The record is logged per-session (CloudWatch structured log), stored for audit (short-TTL row or S3 object), retrievable via admin UI ("show me the manifest for this agent's next session"). This is the single question an operator asks when debugging: "what does this agent have?" — and it has one answer, not ten.

---

## Context & Research

### Relevant Code and Patterns

**Runtime (Python / Strands)**
- `packages/agentcore-strands/agent-container/server.py:241-354` — system prompt assembly; lines 290-310 are the context-SKILL-body injection loop that collapses.
- `packages/agentcore-strands/agent-container/server.py:544-778` — sandbox session wiring + quota + audit logging.
- `packages/agentcore-strands/agent-container/server.py:1350-1420` — Strands `AgentSkills` plugin registration; drop the `AGENTS.md`-present conditional.
- `packages/agentcore-strands/agent-container/sandbox_tool.py:68-288` — `execute_code` tool closure with structured errors.
- `packages/agentcore-strands/agent-container/sandbox_preamble.py:1-54` — **why SI-3 is load-bearing**: preamble injects per-user OAuth tokens into session `os.environ`.
- `packages/agentcore-strands/agent-container/run_skill_dispatch.py:109-254, 467-511` — execution-type branches that delete.
- `packages/agentcore-strands/agent-container/skill_runner.py:178, 262, 330-381` — execution-type filters.
- `packages/agentcore-strands/agent-container/composition_runner.py` — delete (~429 lines).
- `packages/agentcore-strands/agent-container/skill_inputs.py` — delete (~359 lines).

**API / handlers**
- `packages/api/src/lib/sandbox-preflight.ts` — discriminated-union preflight.
- `packages/api/src/lib/mcp-configs.ts:37-80` — MCP joiner; add `status = 'approved'` filter.
- `packages/api/src/lib/skills/permissions-subset.ts:1-60` — permissions are on `agent_skills`, NOT `agent_templates`.
- `packages/api/src/graphql/resolvers/core/authz.ts:14-155` — `requireTenantAdmin` discipline.
- `packages/api/src/handlers/skills.ts:632-742, 1004-1115` — existing per-file upload path.

**Admin UI**
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — path-based tabs.
- `apps/admin/src/routes/_authed/_tenant/capabilities/skills/index.tsx` — extend with "Plugins" section.
- `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx` — add `status='pending'` rendering.
- `apps/admin/src/lib/skills-api.ts:199-207` — presigned-URL client pattern.

**Schema**
- `packages/database-pg/src/schema/skills.ts:23-69` — DB-layer `execution` is `'script' | 'mcp' | 'context'` (composition/declarative are YAML-only). U3 adds columns; U6 drops DB `execution` + `mode` via follow-up migration.
- `packages/database-pg/src/schema/skills.ts:75-105` — `tenantSkills.source`.
- `packages/database-pg/src/schema/mcp-servers.ts:33-70` — `tenantMcpServers`; add `status` + `url_hash`.
- `packages/database-pg/src/schema/mcp-servers.ts:143-173` — `userMcpTokens.status` — precedent.
- `packages/database-pg/src/schema/tenants.ts` — add `disabled_builtin_tools: jsonb`.

**CLI**
- `apps/cli/src/commands/skill.ts:11-80` — stubs; U14 implements `push` minimally.
- `apps/cli/src/commands/login.ts` — Cognito session pattern.

**Tests**
- `packages/agentcore-strands/agent-container/test_composition_runner*.py` + 3 related files — delete.
- `packages/agentcore-strands/agent-container/test_server_run_skill.py` — rewrite mocks from composition_runner to unified dispatcher.
- **Every test currently uses `sys.path.insert(0, os.path.dirname(__file__))`.** U2 must add `conftest.py` that repoints to `container-sources/`.

### Institutional Learnings

- `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md` — **critical for U1**. Four-signal retirement rule.
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` — **U2 class fix**. Bug recurred 4× in 7 days.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — **U3 gate**. Hand-rolled SQL discipline.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — **critical for U10, U11**.
- `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md` — Secrets Manager pattern.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — narrow REST for any sandbox-to-API callback (relevant v1.1).
- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md` — **U7 guidance**.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — per-stage counters.
- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md` — **U10 constraint**.
- Memory `project_agentcore_deploy_race_env.md` — **U2 constraint**.

### External References

- **Anthropic Agent Skills spec** ([platform.claude.com/docs/en/agents-and-tools/agent-skills/overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)) — `scripts/` is convention. `allowed-tools` is Claude-Code-CLI-only. Skills are NOT tools upstream — progressive disclosure uses `bash + cat SKILL.md`. Our `Skill` meta-tool is Strands-idiomatic.
- **Claude Code plugin reference** ([code.claude.com/docs/en/plugins-reference](https://code.claude.com/docs/en/plugins-reference)) — Honor: `skills`, `mcpServers`, `agents`, `userConfig`. Reject: `hooks`, `monitors`, `themes`, `lspServers`, `outputStyles`, `bin`, `channels`. Warn: `commands`.
- **Bedrock AgentCore Code Interpreter dispatch** ([docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-file-operations.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-file-operations.html)) — `writeFiles` + `executeCode`; no named-entrypoint primitive. Cold start 2–5s; default timeout 900s. Inline `writeFiles` 100MB/file. Billing per-second active.
- **Strands tools** ([strandsagents.com/docs/user-guide/concepts/tools](https://strandsagents.com/docs/user-guide/concepts/tools/)) — no per-session tool toggling, no recursion budget, no lazy tool loading primitives. `AgentSkills` IS Strands-native — keep for Level-1 disclosure only.

---

## Open Questions

### Resolved During Planning

- **AgentCore dispatch mechanism?** → `writeFiles` for bundle + args-JSON, then `executeCode` loading args from file. Entrypoint `scripts/<skill_slug>/entrypoint.py` with `run(**kwargs) -> dict`.
- **`Skill` tool signature?** → Single meta-tool `Skill(name: str, args: dict) -> dict`. Depth cap 5, per-turn total cap 50.
- **Draft storage (v1.1).** → S3 `tenants/<tenant_id>/skill-drafts/<draft_id>/...`. Deferred.
- **`allowed-tools` enforcement point?** → Intersect with harness allowlist at session construction; narrow-only.
- **Claude Code plugin `hooks/commands/` semantics?** → Reject `hooks/monitors/themes/lspServers/outputStyles/bin/channels`; warn-ignore `commands/`; honor `skills/mcp.json/agents/userConfig`.
- **`web_search` first-party vs built-in?** → Native built-in.
- **Skill count?** → Definitive from U1 census; plan targets "all bundled skills."
- **Multi-entrypoint migration?** → Policy in Key Technical Decisions; per-slug choice in U1.

### Deferred to Implementation

- Saga compensation details: S3 staging prefix layout + sweeper interval (U10).
- Session pool eviction trigger on plugin re-upload (bump counter mechanics) — U4 defines interface; implementation tunes.
- Non-OAuth API keys (Exa, SerpAPI) current skills declare in `requires_env` — U8 per-slug plan: extend preamble loader or retire.
- Exact admin UI layout for plugins + MCP approval — lands during implementation.
- Retirement of bundled skills — answered by U1 census + four-signal rule.
- `install_skills.py` canonical location (duplicated) — U6 resolves.

---

## Output Structure

*(Only shows net-new directories.)*

```
packages/agentcore-strands/agent-container/
├── container-sources/           # NEW — wildcard-COPY target (U2)
│   ├── server.py                # moved
│   ├── sandbox_tool.py          # moved
│   ├── skill_dispatcher.py      # NEW (U4)
│   ├── skill_session_pool.py    # NEW (U4)
│   ├── skill_meta_tool.py       # NEW (U5)
│   └── _boot_assert.py          # NEW (U2)
├── conftest.py                  # NEW — sys.path to container-sources
└── test_*.py                    # EDITED — sys.path.insert lines removed

packages/api/src/
├── handlers/
│   ├── plugin-upload.ts         # NEW (U10)
│   └── mcp-approval.ts          # NEW (U11)
├── lib/
│   ├── plugin-validator.ts      # NEW (U9)
│   ├── plugin-zip-safety.ts     # NEW (U9)
│   └── plugin-installer.ts      # NEW (U10)

apps/admin/src/routes/_authed/_tenant/capabilities/
└── plugins/                     # NEW (U10)

packages/database-pg/drizzle/
├── 0024_v1_agent_architecture.sql    # NEW additive (U3)
└── 0025_collapse_execution_types.sql # NEW column-drop (U6)
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

**End-to-end skill invocation (F2, unified path, security-hardened):**

```
Tenant admin uploads plugin.zip
        │
        ▼
 /api/plugins/upload (OPTIONS-safe, requireTenantAdmin)
   ├─► plugin-validator + plugin-zip-safety (SI-4)
   ├─► Phase 1: DB insert plugin_uploads status=staging (own txn)
   ├─► Phase 2: S3 copy bundle → tenants/<tid>/skills/<slug>/
   ├─► Phase 3: DB insert tenant_skills + tenant_mcp_servers(status=pending)
   │            update plugin_uploads status=installed (own txn)
   └─► background sweeper cleans orphaned staging > 1h
        │
        ▼ (admin later approves MCP rows — SI-5 hash-pins)
        ▼
 Strands harness builds Agent(tools=[...])
   ├─► filter by tenant kill-switches + template blocks
   ├─► register built-ins: execute_code, web_search, recall, reflect, artifacts, Skill
   └─► register AgentSkills (Level-1 disclosure ONLY)
        │
        ▼ Model calls Skill("sales-prep", {account: "Acme"})
        │
        ▼
 Skill meta-tool dispatch  ◄── skill_dispatcher.py (U4)
   ├─► acquire session from pool keyed (tenant_id, user_id, environment)  [SI-3]
   ├─► purge sys.modules["scripts.<slug>.*"]; importlib.invalidate_caches() [SI-6]
   ├─► writeFiles scripts/ + references/ + _args.json = json.dumps(args)  [SI-2]
   ├─► executeCode("import json; args=json.load(open('_args.json'));
   │                from scripts.<slug>.entrypoint import run;
   │                print(json.dumps(run(**args)))")
   └─► parse stdout as JSON; structured error on non-JSON
        │
        ▼ (recurses up to depth 5, 50 total Skill calls per turn)
```

---

## Implementation Units

- [ ] U1. **Pre-migration census + slug-collision sweep**

**Goal:** Definitive inventory of every bundled skill, its YAML `execution` type, multi-entrypoint shape, and `agent_skills` production usage.

**Requirements:** R11, R3

**Dependencies:** None.

**Files:**
- Create: `packages/skill-catalog/scripts/census.ts`
- Create: `docs/plans/2026-04-23-007-feat-v1-agent-architecture-final-call-plan.census.md` (output committed)
- Test: `packages/skill-catalog/__tests__/census.test.ts`

**Approach:**
- Walk every `packages/skill-catalog/*/skill.yaml`: record slug, YAML `execution`, `mode`, number of `scripts:` entries, presence of `scripts/`, `references/`, `requires_env`.
- Query prod + staging Aurora: `SELECT count(*), count(DISTINCT tenant_id) FROM agent_skills WHERE skill_id = '<slug>' AND enabled = true`.
- Query repo: `git log --since="90 days ago" -- packages/skill-catalog/<slug>`.
- Bucket per slug:
  - `zero-rows-safe-swap`
  - `low-rows-notify`
  - `needs-explicit-migration` (rename legacy + create new canonical)
  - `retirement-candidate` (FOUR signals: zero rows + commit > 90 days + no open issue + feature-owner sign-off)
- Per multi-entry slug: record each callable name + collapse-via-action vs explode-into-N decision.
- Re-runnable; output committed.

**Execution note:** Characterization-first — produce census before touching anything else.

**Patterns to follow:**
- `packages/skill-catalog/scripts/sync-catalog-db.ts:30-117`.
- `packages/api/src/lib/aurora-client.ts`.

**Test scenarios:**
- Happy path: fixture repo with 3 skills produces correct buckets + entrypoint metadata.
- Edge case: four-signal rule keeps a dormant-pre-launch slug in `low-rows-notify`, NOT `retirement-candidate`.
- Edge case: multi-entry slug (thinkwork-admin shape) captures all 33 callables + signature hints.
- Error path: Aurora failure → actionable error; no empty counts.
- Integration: run against dev; output matches manual psql.

**Verification:** Every migrating skill has an explicit bucket and multi-entry decision. Dev-db spot-check PASS.

---

- [ ] U2. **Dockerfile structural fix + deploy race mitigation**

**Goal:** Eliminate "new module ships disabled" bug class before U4 adds new Python modules. Also land warm AgentCore flush (decoupled from U14).

**Requirements:** R4 prerequisite; ops hardening.

**Dependencies:** None.

**Files:**
- Modify: `packages/agentcore-strands/Dockerfile` — single-line `COPY container-sources/ /app/`
- Create: `packages/agentcore-strands/agent-container/container-sources/` + move all `.py` modules into it
- Create: `packages/agentcore-strands/agent-container/container-sources/_boot_assert.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — call `_boot_assert` on startup
- Create: `packages/agentcore-strands/agent-container/conftest.py` — insert `container-sources/` into sys.path for tests
- Modify: every `packages/agentcore-strands/agent-container/test_*.py` — remove `sys.path.insert(0, os.path.dirname(__file__))` (conftest handles it)
- Create: `packages/agentcore-strands/agent-container/test_boot_assert.py`
- Modify: `scripts/post-deploy.sh` — warm AgentCore Strands flush after Terraform apply
- Modify: deploy runbook

**Approach:**
- Wildcard COPY is primary fix. EXPECTED_TOOLS boot assert defense-in-depth.
- `conftest.py` + source move MUST land same PR or all tests break with `ModuleNotFoundError`.
- Warm-flush: AgentCore admin API to force container spin-up on new env vars; 15-min reconciler catches orphans.

**Patterns to follow:**
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`.
- Memory `project_agentcore_deploy_race_env.md`.

**Test scenarios:**
- Happy path: container boots; `_boot_assert` reports "N/N expected tools"; pytest green.
- Edge case: deliberately missing module → boot fails with exact name.
- Error path: module import raises → loud boot failure with name in log.
- Integration: `docker build` + `docker run` OK; pytest passes against moved layout.
- Integration: synthetic deploy — add env var → apply → warm flush → next invocation sees new var.

**Verification:** New `.py` added in later unit registers with zero Dockerfile change. Deliberately-missing module triggers boot failure. Deploy race mitigated.

---

- [ ] U3. **Additive schema migration (no drops in v1 Phase 1)**

**Goal:** Reshape persistence for unified model. **Additive only in this unit** — no column drops. Add `tenantMcpServers.status` + `url_hash`, add `tenants.disabled_builtin_tools`, add `pluginUploads` audit table. Column drops defer to U6.

**Requirements:** R1, R2, R6, R7, R8

**Dependencies:** U1 (slug-rename buckets).

**Files:**
- Create: `packages/database-pg/drizzle/0024_v1_agent_architecture.sql` (hand-rolled with `-- creates:` markers + `to_regclass` + `Apply manually:` header)
- Modify: `packages/database-pg/src/schema/mcp-servers.ts` — add `status: 'pending' | 'approved' | 'rejected'` (default `'approved'` existing), `url_hash: text | null`, `approved_by: uuid | null`, `approved_at: timestamptz | null`
- Modify: `packages/database-pg/src/schema/tenants.ts` — add `disabled_builtin_tools: jsonb` (default `'[]'`)
- Create: new `pluginUploads` table in `skills.ts` (columns: `id`, `tenant_id`, `uploaded_by`, `uploaded_at`, `bundle_sha256`, `plugin_name`, `plugin_version`, `status: 'staging' | 'installed' | 'failed'`, `s3_staging_prefix`, `error_message`)
- Modify: `packages/database-pg/graphql/types/*.graphql`
- Regenerate: `pnpm schema:build` + codegen for all consumers
- Test: `packages/database-pg/__tests__/migration-0024.test.ts`

**Approach:**
- NO column drops. DB-layer `skillCatalog.execution` is `'script' | 'mcp' | 'context'`; `composition` + `declarative` live at YAML only.
- `Apply manually:` header + `-- creates:` markers for plugin_uploads, tenant_mcp_servers.status, tenant_mcp_servers.url_hash, tenants.disabled_builtin_tools.
- `to_regclass` pre-flight fails closed on missing pre-state.
- Slug renames from U1's `needs-explicit-migration` bucket applied as `UPDATE skill_catalog SET slug = slug || '-legacy' WHERE slug IN (...)` in the same migration.

**Execution note:** Apply to dev before PR merge; paste `\d+` outputs into the PR.

**Patterns to follow:**
- `packages/database-pg/drizzle/0018_*.sql`.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.

**Test scenarios:**
- Happy path: migration applies cleanly; new columns correct defaults; existing MCP rows `status='approved'`.
- Edge case: idempotent (`ADD COLUMN IF NOT EXISTS`).
- Error path: pre-flight fails loudly on missing table.
- Edge case: slug rename transactional with `agent_skills` update.
- Integration: `pnpm db:migrate-manual` clean; deploy gate passes.

**Verification:** Deploy gate green. GraphQL codegen passes. No existing agent loses MCP (default `status='approved'`).

---

- [ ] U4. **Unified skill dispatcher (SI-2/SI-3/SI-6 hardened)**

**Goal:** Single code path for every skill-with-scripts invocation. Honors all three sandbox security invariants.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U2, U3.

**Files:**
- Create: `packages/agentcore-strands/agent-container/container-sources/skill_dispatcher.py`
- Create: `packages/agentcore-strands/agent-container/container-sources/skill_session_pool.py`
- Modify: `container-sources/server.py` — wire new dispatcher
- Modify: `packages/api/src/lib/sandbox-preflight.ts` — extend preflight for non-`execute_code` calls
- Test: `packages/agentcore-strands/agent-container/test_skill_dispatcher.py`
- Test: `packages/agentcore-strands/agent-container/test_skill_session_pool.py`
- Test: `packages/agentcore-strands/agent-container/test_skill_dispatcher_security.py` (explicit SI-2/SI-3/SI-6 coverage)

**Approach:**
- Interface: `dispatch_skill_script(tenant_id, user_id, skill_slug, args, environment) -> {status, result|error}`.
- Pool key `(tenant_id, user_id, environment)`. LRU cap 8 per (tenant,user). 30-min idle. Forced flush on kill-switch toggle (U12) and plugin re-upload (DB bump-counter).
- Per-call sequence:
  1. Acquire session.
  2. Purge `sys.modules["scripts.<slug>.*"]` + `importlib.invalidate_caches()` (SI-6).
  3. `writeFiles` bundle files + `_args.json = json.dumps(args)` (SI-2).
  4. `executeCode("import json; args = json.load(open('_args.json')); from scripts.<slug>.entrypoint import run; print(json.dumps(run(**args)))")`.
- Parse stdout as JSON; structured error on non-JSON.
- Reuse `server.py:682-755` quota + audit (extract to shared module).
- Depth counter per-turn: reject > 5. Total-call counter: reject > 50.

**Technical design** *(directional):*

```python
def dispatch_skill_script(tenant_id, user_id, skill_slug, args, environment):
    # SI-3: user-scoped pool key
    session = pool.acquire((tenant_id, user_id, environment))

    # SI-6: module namespace reset
    session.execute_code(_PURGE_MODULE_CACHE.format(slug=skill_slug))

    bundle = catalog.load_bundle(skill_slug)
    files = bundle.files_for_interpreter() + [
        # SI-2: args as data, never embedded as Python
        {"path": "_args.json", "text": json.dumps(args)},
    ]
    session.write_files(files)

    code = (
        "import json; args = json.load(open('_args.json')); "
        f"from scripts.{skill_slug}.entrypoint import run; "
        "print(json.dumps(run(**args)))"
    )
    result = session.execute_code(code, timeout=bundle.timeout_s or 60)
    return parse_result(result)
```

**Execution note:** Integration-test-first — mock AgentCore before real Code Interpreter. Security tests SI-2/SI-3/SI-6 same PR.

**Patterns to follow:**
- `sandbox_tool.py:68-288`, `sandbox_preamble.py:1-36`, `server.py:544-778`.

**Test scenarios:**
- **Covers AE3.** Happy path: fixture skill `scripts/entrypoint.py` executes via dispatcher; runs in sandbox not test process.
- Happy path: pure-SKILL.md skill → no-op signal; no session provisioned.
- **Security — SI-2.** Edge case: `args = {"x": "__import__('os').system('...')"}` → ends up as string in `_args.json`; `run()` gets string; no injection.
- **Security — SI-3.** Edge case: user A and user B on same tenant → different pool sessions. Test pool keys.
- **Security — SI-6.** Edge case: skill A monkey-patches `builtins.print`; next skill B in same session sees original `print`.
- Edge case: pool cap 8 hit → LRU eviction → new session OK.
- Edge case: plugin re-upload bumps counter; pool evicts affected sessions.
- Error path: script `RuntimeError` → structured error not uncaught.
- Error path: non-JSON stdout → `SkillOutputParseError` with stdout captured.
- Error path: timeout → `SkillTimeout`, session flushed.
- Integration: nested `Skill` → depth 5 OK, 6 rejected; total 50/turn OK, 51 rejected.

**Verification:** Every U1-bucketed skill deterministic-equivalent (or shadow-clean). All security tests PASS. Pool reuse > 60% in 10-min soak.

---

- [ ] U5. **`Skill` meta-tool + AgentSkills Level-1-only**

**Goal:** Single `Skill(name, args)` meta-tool. AgentSkills plugin always-on for Level-1 injection — but its built-in `skills` tool is NOT registered (our meta-tool is sole invocation).

**Requirements:** R3, R5, R6, R10

**Dependencies:** U4.

**Files:**
- Modify: `container-sources/server.py` — register `Skill` meta-tool; drop `AGENTS.md`-conditional at ~line 1362; configure AgentSkills to NOT register its `skills` tool
- Create: `container-sources/skill_meta_tool.py`
- Test: `packages/agentcore-strands/agent-container/test_skill_meta_tool.py`

**Approach:**
- `Skill(name: str, args: dict) -> dict`: validate `name` in session allowlist; delegate to `dispatch_skill_script` when bundle has `scripts/`; else return SKILL.md body for in-prompt consumption.
- Allowlist built at `Agent(tools=...)` from tenant-skills ∩ template-skills ∩ template-not-blocked ∩ tenant-not-disabled.
- Intersect `allowed-tools` frontmatter with session allowlist (narrow-only); warn if declared tool missing from session.
- AgentSkills: always-on; suppress its built-in `skills` tool (wrap/subclass if SDK doesn't allow suppression).

**Patterns to follow:**
- `server.py:1354-1376`.

**Test scenarios:**
- **Covers AE4.** Happy path: `Skill("sales-prep", …)` → dispatcher; nested `Skill("gather-crm-context", …)` through same path.
- Edge case: pure-SKILL.md → body returned, no sandbox.
- Edge case: registry shows only our `Skill` (not AgentSkills' `skills`).
- Error path: unknown slug → `SkillNotFound`.
- Error path: in catalog but not in session allowlist → `SkillUnauthorized`.
- Error path: `allowed-tools: [Bash]` but session excludes Bash → warning; tool not registered.
- Integration: Level-1 name+description in system prompt; model invokes via our meta-tool.

**Verification:** Every composition runs via meta-tool = pre-migration-equivalent (U7). Registry has exactly one skill-invocation tool.

---

- [ ] U6. **Delete composition_runner, declarative scaffolding, type-branching + migration 0025**

**Goal:** Remove parallel orchestrator and execution-type branches. Drop DB `skillCatalog.execution` + `mode` columns via follow-up 0025 after runtime cutover. Net deletion: ~788 Python lines + 4 test files.

**Requirements:** R3, R5

**Dependencies:** U4, U5, U7 (PASS gates).

**Files:**
- Delete: `composition_runner.py`, `skill_inputs.py`, `test_composition_runner.py`, `test_composition_runner_auto_compound.py`, `test_skill_inputs.py`, `test_skill_runner_compositions.py`, `test_workflow_skill_context.py`
- Modify: `container-sources/run_skill_dispatch.py` — collapse to unified path
- Modify: `container-sources/skill_runner.py` — remove `load_composition_skills`; collapse `register_skill_tools*` into one
- Modify: `container-sources/server.py` — remove execution-type context-body loop at old 290-310
- Modify: `packages/api/src/lib/workspace-map-generator.ts:285-429`
- Modify: `packages/api/src/handlers/skills.ts:632-742`
- Modify: `packages/api/src/handlers/chat-agent-invoke.ts:305`, `wakeup-processor.ts:342`
- Resolve: `install_skills.py` duplication
- Rewrite: `test_server_run_skill.py` — mocks of unified dispatcher
- Create: `packages/database-pg/drizzle/0025_collapse_execution_types.sql` (hand-rolled: `ALTER TABLE skill_catalog DROP COLUMN IF EXISTS execution, DROP COLUMN IF EXISTS mode` with markers)
- Modify: `packages/database-pg/src/schema/skills.ts` — remove `execution`, `mode`
- Regenerate codegen.

**Approach:**
- Small reviewable commits; tests between.
- Post-delete: `grep -R "composition_runner\|CompositionSkill\|execution.*composition\|execution.*declarative\|skillCatalog\.execution\|skillCatalog\.mode" packages/` = 0.
- 0025 applies AFTER runtime deploy succeeds.

**Execution note:** U7 PASS is blocking gate; do NOT merge before shadow-clean per-slug.

**Patterns to follow:**
- `docs/plans/2026-04-23-006-refactor-sandbox-drop-required-connections-plan.md`.

**Test scenarios:**
- Happy path: full pytest green post-deletion + rewrite.
- Edge case: grep for deleted symbols returns zero.
- Integration: U7 harness PASS every slug.
- Integration: 0025 applies clean; `pnpm db:migrate-manual` clean.

**Verification:** Python LOC down ≥ 788 + 4 test files. Zero refs to deleted modules. DB schema no longer has `execution`/`mode`.

---

- [ ] U7. **Characterization: bifurcated deterministic + LLM-mediated**

**Goal:** Validate "observably equivalent" at two fidelity levels. Cheap pytest parametrize for deterministic skills; 60-day shadow-traffic A/B for LLM-mediated skills.

**Requirements:** R11

**Dependencies:** U1 (bucketing), U4 (dispatcher).

**Files:**
- Create: `packages/skill-catalog/characterization/deterministic_harness.py`
- Create: `packages/skill-catalog/characterization/fixtures/<slug>/inputs.json` + `golden.json` per deterministic skill
- Create: `container-sources/shadow_dispatch.py` (dual-dispatch when flag set; logs divergence)
- Modify: `container-sources/skill_dispatcher.py` — hook into shadow_dispatch when flag matches
- Create: CloudWatch dashboard `skill-migration-divergence`
- Test: `packages/skill-catalog/__tests__/characterization.test.ts`
- Test: `packages/agentcore-strands/agent-container/test_shadow_dispatch.py`

**Approach:**
- **Deterministic (~12 skills):** pytest parametrize. `run(**args)` fixture `inputs.json` compared byte-equal (structurally for floats) against `golden.json`. Captured pre-migration; `--regenerate` for intentional changes.
- **LLM-mediated (~9 skills):** shadow-traffic.
  - Flag `SKILL_DISPATCH_SHADOW` lists slugs for dual-dispatch.
  - Every real invocation runs BOTH paths.
  - Only OLD path's result returned during shadow.
  - Per-call divergence logged: `(slug, tenant_id, old_hash, new_hash, old_tokens, new_tokens, per_stage_counts)`.
  - Cutover: 100+ invocations AND divergence < 5% by shape AND human-judge sample 20/week clean.
  - Per-slug cutover flips shadow → canonical; legacy path stops for that slug.
- U7 produces dashboard + per-slug cutover decisions.

**Execution note:** Deterministic captures pre-U4. Shadow infra lands with U4.

**Patterns to follow:**
- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md`.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`.

**Test scenarios:**
- Happy path (det): all 12 det-slugs have fixtures+golden; pytest PASS per slug.
- Happy path (shadow): listed slug dual-dispatches; CloudWatch records both.
- Edge case (det): byte-equal diff → test fails; blocks U8 for that slug.
- Edge case (shadow): per-stage counters ID divergence stage.
- Error path (det): regenerate without `--confirm` refuses.
- Integration: post-cutover per-slug, legacy path stops; U6 globally merges only when all 9 cut over.

**Verification:** Det harness green all 12. Shadow dashboard shows 30+ days clean all 9. Human-judge sample no semantic regressions.

---

- [ ] U8. **Migrate bundled skills to SKILL.md + sandbox**

**Goal:** Rewrite each skill's on-disk shape. Apply U1 multi-entry policy. Compositions become SKILL.md prose with `allowed-tools: [Skill]`. Declarative stubs dissolve.

**Requirements:** R3, R11

**Dependencies:** U1, U4, U5, U7, U3.

**Files:**
- Modify: every `packages/skill-catalog/<slug>/` — replace `skill.yaml` with `SKILL.md` + `scripts/` + `references/`
- Modify: `packages/skill-catalog/scripts/sync-catalog-db.ts` — walk SKILL.md frontmatter
- Delete: declarative phase stubs (frame / gather / synthesize / package / compound / skill-dispatcher)
- Modify: composition SKILL.md files — convert to `allowed-tools: [Skill]` prose
- **Multi-entrypoint (per U1 bucket):**
  - `thinkwork-admin` (33): explode OR collapse
  - `agent-thread-management` (12): explode OR collapse
  - `google-calendar` (6), `google-email` (5), `web-search` (3), `artifacts` (3), `workspace-memory` (3): per-slug
- Per-slug PR gated by U7 PASS (deterministic) or 30+ days shadow-clean (LLM).
- **Non-OAuth env skills** (e.g. `web-search` `EXA_API_KEY`, `SERPAPI_KEY`): same-PR extend `sandbox_preamble.py` loader or retire.
- Test: `packages/skill-catalog/__tests__/bundled-skills-shape.test.ts`

**Approach:**
- Dependency order: leaves first, then compositions.
- `needs-explicit-migration` bucket: old → `-legacy` via 0024 data migration; new canonical co-exists 30 days.
- `retirement-candidate`: delete; commit message shows four-signal evidence.

**Execution note:** Per-skill PR; never batch.

**Patterns to follow:**
- [Anthropic skills repo](https://github.com/anthropics/skills).

**Test scenarios:**
- Happy path: `pnpm sync:catalog` upserts; zero YAML `execution:` refs.
- Edge case (collapse): `action: "list"` vs `action: "delete"` dispatch through one entrypoint.
- Edge case (explode): each sub-slug has own `scripts/<sub>/entrypoint.py`; each registers independently.
- Error path: malformed frontmatter → clear parse error.
- Integration (det): test tenant invokes every det skill via `Skill(…)`; PASS.
- Integration (shadow): LLM skills 30-day shadow-clean.
- Integration (non-OAuth env): `web-search` sees `EXA_API_KEY` in sandbox.

**Verification:** U7 det green every slug. 30+ day shadow-clean every LLM slug before U6 gate. `grep -R 'execution:' packages/skill-catalog/` returns zero.

---

- [ ] U9. **Plugin + SKILL.md + zip-safety validator (SI-4)**

**Goal:** Full validation before any S3 write or DB insert. Zip safety, plugin.json fields, SKILL.md frontmatter.

**Requirements:** R2, R3, R8, SI-4

**Dependencies:** U3.

**Files:**
- Create: `packages/api/src/lib/plugin-validator.ts`
- Create: `packages/api/src/lib/skill-md-parser.ts`
- Create: `packages/api/src/lib/plugin-field-policy.ts`
- Create: `packages/api/src/lib/plugin-zip-safety.ts`
- Test: `packages/api/src/lib/__tests__/plugin-validator.test.ts`
- Test: `packages/api/src/lib/__tests__/plugin-zip-safety.test.ts`

**Approach:**
- Accept zip stream or unpacked tree.
- Zip safety FIRST (SI-4):
  - Reject normalized-path `..` or absolute path entries
  - Reject total decompressed > 50 MB
  - Reject > 500 entries
  - Reject symlink entries
- plugin.json: `name` required; honor allowlist (`version`, `description`, `author`, `skills`, `mcpServers`, `agents`, `userConfig`); HARD REJECT deny list (`hooks`, `monitors`, `themes`, `lspServers`, `outputStyles`, `bin`, `channels`); WARN+IGNORE `commands`.
- Per SKILL.md: `name` + `description` required; `name` matches `[a-z0-9-]+`, max 64 chars, no "anthropic"/"claude"; `description` ≤1024 chars; capture `allowed-tools` informationally.
- Extract `mcp.json` servers for U10 to stage as `status='pending'`.
- Structured result: `{valid, skills, mcp_servers, allowed_tools_declared, warnings}` or `{valid:false, errors}`.

**Patterns to follow:**
- `packages/api/src/lib/skills/permissions-subset.ts`.
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference).

**Test scenarios:**
- Happy path: valid 3-skill + 1-MCP plugin → valid structured result.
- Happy path: plugin with `commands/` → valid with warning.
- Edge case: SKILL.md `allowed-tools: [Read, Grep]` → surfaced informationally.
- **Security (SI-4).** Error: zip entry `../../../etc/passwd` → `ZipPathEscape`.
- **Security (SI-4).** Error: 10KB zip decompressing to 500MB → `ZipDecompressedTooLarge`.
- **Security (SI-4).** Error: 1000-entry zip → `ZipTooManyEntries`.
- **Security (SI-4).** Error: symlink entry → `ZipSymlinkNotAllowed`.
- Error: `plugin.json` with `hooks/` → `unsupported field: hooks`.
- Error: SKILL.md `name: claude-bot` → rejected per spec.
- Error: `name` > 64 chars → rejected.
- Error: SKILL.md missing `description` → structured error with path.

**Verification:** Rejects every known-unsupported field. Rejects every canonical zip-attack. Valid plugins produce structured result U10 consumes.

---

- [ ] U10. **Plugin upload REST + saga installer + admin UI**

**Goal:** Admin uploads plugin.zip; server validates (U9), installs via three-phase saga, surfaces structured errors.

**Requirements:** R1, R2, R7, R8, SI-4

**Dependencies:** U2, U3, U9.

**Files:**
- Create: `packages/api/src/handlers/plugin-upload.ts` (REST Lambda; OPTIONS-safe)
- Create: `packages/api/src/lib/plugin-installer.ts` (saga writer)
- Create: `packages/api/src/lib/plugin-staging-sweeper.ts` (hourly EventBridge)
- Modify: `scripts/build-lambdas.sh` — add `plugin-upload`
- Create: `apps/admin/src/routes/_authed/_tenant/capabilities/plugins/index.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/capabilities/plugins/$uploadId.tsx`
- Create: `apps/admin/src/lib/plugins-api.ts`
- Modify: `terraform/modules/app/api-gateway.tf` — `POST /api/plugins/upload` + `OPTIONS`
- Modify: `packages/lambda/` — register sweeper (1hr)
- Test: `packages/api/src/__tests__/plugin-upload.test.ts`
- Test: `packages/api/test/integration/plugin-upload/happy-path.test.ts`
- Test: `packages/api/test/integration/plugin-upload/options-preflight.test.ts`
- Test: `packages/api/test/integration/plugin-upload/saga-failure-recovery.test.ts`

**Approach:**
- Two-step: client presigned URL → PUT zip → `POST /api/plugins/upload {s3_key}` → install.
- **Three-phase saga:**
  - **Phase 1 (short DB txn):** `requireTenantAdmin` → U9 validate (zip-safety first) → INSERT `plugin_uploads` `status='staging'`, `s3_staging_prefix`, `bundle_sha256` → COMMIT. Audit survives any later failure.
  - **Phase 2 (S3):** copy from staging to canonical `tenants/<tid>/skills/<slug>/` (content-addressed then atomic rename).
  - **Phase 3 (short DB txn):** INSERT `tenant_skills` + `tenant_mcp_servers status='pending'` + UPDATE `plugin_uploads status='installed'` → COMMIT.
  - **Any phase failure:** UPDATE `plugin_uploads status='failed'` with error_message; hourly sweeper deletes orphaned S3 staging > 1h.
- `requireTenantAdmin(ctx, tenantId)` BEFORE any side effect. Derive `tenantId` from authenticated request principal.
- `OPTIONS` returns 2xx without `authenticate()`.
- Admin UI: drag-drop → progress → success linking to detail; validation failure → structured errors.

**Execution note:** Integration-test-first for OPTIONS + saga-failure-recovery.

**Patterns to follow:**
- `packages/api/src/handlers/skills.ts:1064-1077`.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`.
- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`.

**Test scenarios:**
- **Covers AE1.** Happy path: valid plugin → 3 skills in admin list; 1 MCP `pending`.
- **Covers AE2.** Edge: plugin with mcp.json → MCP `status='pending'`; agents can't invoke until U11.
- Edge: re-upload same plugin → idempotent; bumps counter (U4 pool eviction).
- Edge (saga): Phase 2 fails mid-copy → `status='failed'`; Phase 3 doesn't run; sweeper cleans.
- Edge (saga): Phase 3 DB fails → staged S3 exists; `status='failed'`; sweeper cleans.
- Error: zip with path traversal → Phase 1 rejects via U9; 400; no DB.
- Error: non-admin → 403 before any side effect.
- Error: zip bomb → rejected at Phase 1; quick 400.
- Integration: OPTIONS returns 204 with CORS; no auth.
- Integration: end-to-end admin UI → upload → list → invoke in test template.
- Integration: kill sweeper mid-run → staging survives; next tick handles.

**Verification:** Plugin uploaded via admin UI invocable in 30s. OPTIONS smoke PASS. Saga-failure-recovery PASS every boundary.

---

- [ ] U11. **MCP admin-approval with hash-pin + notification + TTL (SI-5)**

**Goal:** Pending → approved (hash-pinned) or rejected. `buildMcpConfigs` filters approved. Notification on new pending. Stuck auto-reject at 30 days.

**Requirements:** R8, SI-5

**Dependencies:** U3, U10.

**Files:**
- Create: `packages/api/src/handlers/mcp-approval.ts` (`approveMcpServer`, `rejectMcpServer`)
- Create: `packages/api/src/lib/mcp-server-hash.ts`
- Modify: `packages/api/src/lib/mcp-configs.ts:37-80` — filter `status='approved' AND enabled=true`; defensive `url_hash` match check at config-build
- Modify: MCP resolvers — pre-save hook reverting `approved→pending` on `url` or `auth_config` mutation
- Modify: `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx` — render pending, approve/reject actions
- Admin badge count in sidebar for pending
- Sweeper — daily EventBridge; auto-reject pending > 30 days
- Modify: `packages/database-pg/graphql/types/mcp-servers.graphql`
- Regenerate codegen
- Test: `packages/api/src/__tests__/mcp-approval.test.ts`
- Test: `packages/api/src/__tests__/mcp-approval-url-swap.test.ts` (SI-5 specific)
- Test: `packages/api/src/__tests__/mcp-approval-ttl-sweeper.test.ts`
- Test: `packages/api/src/lib/__tests__/mcp-configs-approved-filter.test.ts`

**Approach:**
- Approval: `requireTenantAdmin` (tenantId from row). Compute `url_hash = sha256(canonical(url, auth_config))`. Set `status='approved'`, `approved_by`, `approved_at`, `url_hash`.
- Rejection: `requireTenantAdmin`. `status='rejected'` with reason.
- Any `updateMcpServer` modifying `url` or `auth_config` on approved → revert `status→pending` + clear approval metadata (enforced in resolver).
- Admin UI badge count pending; list sortable by age.
- TTL sweeper: `WHERE status='pending' AND created_at < now() - interval '30 days'` → auto-reject.
- Agent graceful error: skill declaring `allowed-tools: [mcp:pending-server]` → clear "mcp server pending approval, skipping" log, not generic tool-not-found.

**Patterns to follow:**
- `schema/mcp-servers.ts:143-173` userMcpTokens.status precedent.
- `graphql/resolvers/core/authz.ts:14-155` requireTenantAdmin.

**Test scenarios:**
- **Covers AE2.** Happy: admin approves → `status='approved'`, `url_hash` set → test agent sees server.
- Happy: admin rejects → `status='rejected'`; never visible.
- **Security (SI-5).** Edge: approved row; `updateMcpServer` changes `url` → revert to pending, clear `url_hash`, `approved_by` null.
- Edge: `enabled=false AND status='approved'` → filtered out (enabled wins).
- Edge: `buildMcpConfigs` hashes current row; mismatch → treat as pending (defensive).
- Edge: pending > 30 days → sweeper auto-rejects.
- Error: non-admin approve → 403.
- Error: non-existent ID → 404; wrong-tenant → 403.
- Integration: full URL-swap attack test (admin approves url A; mutation changes to B; revert fires).
- Integration: plugin upload → pending → approve → template → agent sees.

**Verification:** Pending unreachable. Approved works end-to-end. URL-swap provably reverts. Stuck > 30 days auto-resolves.

---

- [ ] U12. **Tenant kill-switch runtime filter (UI deferred)**

**Goal:** Runtime filter + schema. Admin UI + mutation defer per Scope Boundaries.

**Requirements:** R6, R7

**Dependencies:** U3.

**Files:**
- Schema column `tenants.disabled_builtin_tools` lands in U3.
- Modify: `container-sources/server.py` — at `Agent(tools=...)` filter built-ins by `tenant.disabled_builtin_tools` ∪ `template.blocked_tools` (tenant wins disable)
- Add: kill-switch flush event — pool subscribes and evicts affected sessions
- Test: `packages/agentcore-strands/agent-container/test_builtin_tool_filtering.py`

**Approach:**
- Load tenant `disabled_builtin_tools` at session start; filter. Template `blocked_tools` intersects (narrows further).
- Until UI ships: operators flip column via direct DB / internal tool. Document in runbook.
- `recall`/`reflect` can be disabled; log WARN at session start ("memory engine load-bearing") for operator visibility.

**Patterns to follow:**
- `built-in-tools.tsx:70-79` for future UI.

**Test scenarios:**
- **Covers AE5.** Happy: `disabled_builtin_tools=['execute_code']` → new session → tool not registered.
- Edge: tenant disables + template blocks → still disabled.
- Edge: tenant disables; template doesn't → still disabled (tenant trumps).
- Edge: tenant allows; template blocks → blocked.
- Edge: tenant disables `recall` → WARN logged; tool not registered.
- Error: unknown tool name → runtime no-op; admin tooling surfaces warning.
- Integration: update via DB → pool flush → next session filters correctly.

**Verification:** Kill-switch takes effect next session. Template can't widen. `recall`/`reflect` honor with WARN.

---

- [ ] U13. **[DEFERRED to v1.1 — `skill_author` + drafts + promotion]**

*(Architectural seat reserved. Gated on pilot signal per Scope Boundaries. Unified `Skill` meta-tool + plugin saga make v1.1 addition additive, not restructuring. When ships, MUST honor SI-1: sandbox-to-API uses short-lived scoped capability tokens, NOT `THINKWORK_API_SECRET`.)*

**Runtime stub in v1:** If a template has `skill_author` permission flag, Strands harness logs WARN at session construction ("skill_author requested but not implemented in this runtime version"). Tool not registered. Model calling `Skill("skill_author", ...)` → `SkillNotFound`. Prevents silent half-state.

---

- [ ] U14. **CLI `thinkwork skill push` (minimal)**

**Goal:** Developer CLI wraps U10 REST endpoint. Warm-flush moved to U2. Richer workflow defers.

**Requirements:** R1

**Dependencies:** U10.

**Files:**
- Modify: `apps/cli/src/commands/skill.ts` — implement `push`
- Create: `apps/cli/src/lib/plugin-zip.ts`
- Create: `apps/cli/src/lib/plugin-push.ts`
- Test: `apps/cli/__tests__/skill-push.test.ts`

**Approach:**
- `thinkwork skill push <folder>` → local plugin.json sanity check → zip → presigned + POST to U10 → report plugin ID + admin approval URL.
- Reuses `~/.thinkwork/config.json` session.

**Patterns to follow:**
- `apps/cli/src/commands/login.ts`.

**Test scenarios:**
- Happy: `push ./my-plugin` → zip → upload → returns ID.
- Edge: missing `plugin.json` → fail locally.
- Error: not logged in → prompts `thinkwork login`.
- Error: 400 → structured errors surfaced.
- Integration: local harness — push → admin sees plugin.

**Verification:** Round-trips end-to-end.

---

- [ ] U15. **Resolved Capability Manifest (RCM) + built-ins-as-catalog-entries**

**Goal:** At every agent session start, capture exactly what capabilities the session was granted (skills, tools, MCP servers, workspace files, and explicit blocks) into a structured manifest. Log it, audit it, expose it via admin UI. Additionally: register the current hard-coded built-in tools (`execute_code`, `web_search`, `recall`, `reflect`, `artifacts`, `Skill`) as catalog entries with `source='builtin'` so the manifest model is uniform across all capability types.

**Requirements:** R6, R12, SI-7

**Dependencies:** U3 (schema), U4 (dispatcher exists), U5 (tool registration path is the capture point), U12 (kill-switch column lands).

**Files:**
- Modify: `packages/database-pg/drizzle/0024_v1_agent_architecture.sql` — add `capability_catalog` table (unified `skills` + `tools` registry; columns: `id`, `slug`, `type: 'skill' | 'tool' | 'mcp-server'`, `source: 'builtin' | 'tenant-library' | 'community'`, `implementation_ref` nullable JSONB, `spec` JSONB, timestamps). Backfill existing `skill_catalog` rows as `type='skill'`; seed the 6 current built-in tools as `type='tool'` + `source='builtin'` rows. Add `resolved_capability_manifests` table (short-TTL, 30 days) with `session_id`, `agent_id`, `user_id`, `tenant_id`, `manifest_json`, `created_at`.
- Modify: `packages/database-pg/src/schema/` — add the two new tables + backfill/seed script.
- Create: `packages/agentcore-strands/agent-container/container-sources/capability_manifest.py` — at session start, build the manifest struct, emit structured CloudWatch log, POST to `/api/runtime/manifests` (or write directly to Aurora via an RDS-Data-API-scoped narrow endpoint). Capture: `{session_id, agent_id, template_id, user_id, tenant_id, skills: [{slug, version, source}], tools: [{slug, source, implementation_ref}], mcp_servers: [{id, url_hash, status}], workspace_files: [{path, mtime_or_hash}], blocks: {tenant_disabled_builtins: [], template_blocked_tools: []}, runtime_version, timestamp}`.
- Modify: `container-sources/server.py` — at `Agent(tools=...)` construction, call `capability_manifest.build_and_log()`. Log even on short-lived sessions.
- Create: `packages/api/src/handlers/manifest-log.ts` — narrow REST endpoint for runtime to POST manifests. `requireThinkworkApi` (shared secret, no tenant OAuth needed — this is runtime→API). Writes to `resolved_capability_manifests` table.
- Create: `packages/api/src/graphql/resolvers/runtime/manifests.ts` — GraphQL query `runtimeManifestsByAgent(agent_id, limit)` and `runtimeManifestsByTemplate(template_id, limit)` for admin UI. `requireTenantAdmin`.
- Create: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.manifest.tsx` — "Manifest preview" tab showing last N invocations' manifest JSON with diff viewer between invocations.
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx` — "Runtime manifest" section showing recent manifests per agent.
- Update: built-in tool registration in `container-sources/server.py` reads from `capability_catalog WHERE source='builtin'` to know which built-ins to activate — still calls the local Python implementation referenced by `implementation_ref.module_path`, but presence in the manifest is the *declaration*.
- Test: `packages/agentcore-strands/agent-container/test_capability_manifest.py`
- Test: `packages/api/src/__tests__/manifest-log.test.ts`
- Test: `packages/agentcore-strands/agent-container/test_builtin_tools_as_capabilities.py` (SI-7 coverage — no tool registers without a capability_catalog row).

**Approach:**
- Schema: one unified `capability_catalog` table. `type` distinguishes skill / tool / mcp-server. `implementation_ref` for tools is `{module_path, class_name}` or similar — the Strands harness reads it at startup and instantiates. For skills it's null (dispatch goes through U4 skill_dispatcher). For MCP it's `{mcp_server_id}` pointer.
- Manifest table is append-only with TTL. Each row captures the exact resolved state for one session. Admin UI reads last N.
- Runtime flow: session starts → harness computes `Agent(tools=...)` by intersecting catalog ∩ template assignments ∩ kill-switches ∩ workspace overrides → `capability_manifest.build_and_log()` captures the resolved set → logs to CloudWatch structured + POSTs to `/api/runtime/manifests` → continues with `Agent(tools=...)` construction.
- SI-7 enforcement: `Agent(tools=...)` receives its tool list FROM the resolved manifest, not from ad-hoc Python registration. A tool that isn't in the manifest isn't in the session. Test that a capability-catalog-missing built-in fails closed (tool not registered, not silently available).
- Backfill: migrate existing `skill_catalog` rows into `capability_catalog` with `type='skill'`. Seed six rows for built-in tools. Legacy `skill_catalog` table stays as a view or alias during transition, or is dropped after U6.
- Built-ins become declarative: adding a new built-in tool post-launch = insert a `capability_catalog` row + ship the Python implementation in the container. Admin can block it per-tenant via `disabled_builtin_tools` (U12) or per-template via `blocked_tools`. Same primitives as every other capability.

**Technical design** *(directional):*

```python
# container-sources/capability_manifest.py — directional, not spec
def build_and_log(agent, template, user, tenant):
    # Read authoritative declarations
    catalog = api.fetch_capabilities(tenant_id=tenant.id)
    template_assignments = template.skills_and_tools()
    tenant_kill_switches = tenant.disabled_builtin_tools
    template_blocks = template.blocked_tools
    mcp_approved = api.fetch_mcp_servers(tenant_id=tenant.id, status='approved')
    workspace_files = workspace_composer.expand_file_list(agent, template)

    # Intersect/narrow
    skills = [c for c in catalog if c.type == 'skill' and c.slug in template_assignments]
    tools = [
        c for c in catalog
        if c.type == 'tool'
        and c.source == 'builtin'
        and c.slug not in tenant_kill_switches
        and c.slug not in template_blocks
    ]
    mcp = [m for m in mcp_approved if m.id in template.mcp_server_ids]

    manifest = {
        "session_id": agent.session_id,
        "agent_id": agent.id,
        "template_id": template.id,
        "user_id": user.id,
        "tenant_id": tenant.id,
        "skills": [{"slug": s.slug, "version": s.version, "source": s.source} for s in skills],
        "tools": [{"slug": t.slug, "source": t.source, "implementation_ref": t.implementation_ref} for t in tools],
        "mcp_servers": [{"id": m.id, "url_hash": m.url_hash, "status": m.status} for m in mcp],
        "workspace_files": [{"path": f.path, "version": f.version} for f in workspace_files],
        "blocks": {
            "tenant_disabled_builtins": list(tenant_kill_switches),
            "template_blocked_tools": list(template_blocks),
        },
        "runtime_version": RUNTIME_VERSION,
        "timestamp": now(),
    }

    logger.info("capability_manifest", extra={"manifest": manifest})
    api.post_manifest(manifest)  # narrow endpoint with thinkwork API secret
    return manifest
```

**Execution note:** The manifest build happens once per session; it's not on the hot path of tool invocations. Optimize for correctness and completeness over speed.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/sandbox_tool.py` — structured logging pattern.
- `packages/api/src/handlers/skills.ts` — narrow REST handler shape.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — template detail tab pattern.

**Test scenarios:**
- Happy path: agent session starts → manifest logged to CloudWatch → row in `resolved_capability_manifests` → admin UI shows it.
- Happy path: two sessions for same agent produce different manifests if template was edited between them; diff viewer surfaces the delta.
- Happy path (SI-7): removing a built-in from `capability_catalog` causes that built-in to not register on the next session, even though the Python implementation still exists.
- Edge case: agent with zero skills assigned produces a manifest with empty `skills: []`; still logged.
- Edge case: MCP server with `status='pending'` does NOT appear in manifest; only `status='approved'` MCP servers land.
- Edge case: tenant kill-switch for `execute_code` → manifest's `tools` array omits `execute_code`; manifest's `blocks.tenant_disabled_builtins` lists it.
- Error path: manifest POST to `/api/runtime/manifests` fails → structured CloudWatch log still emitted (durable observability); agent session continues (manifest is non-blocking).
- Error path: `capability_catalog` table unavailable → hard fail session start with clear error (better than silently running with ambiguous capabilities).
- Integration: full end-to-end — agent invoked via test tenant → skill invocation happens → admin UI shows the manifest; the `Skill` call resolves from the manifest's declared skills, not from a separate ad-hoc lookup.
- Integration: manifest schema is stable across one sample of each capability type (skill, built-in tool, MCP server, workspace file, block entry).

**Verification:** Every agent session produces exactly one manifest. Admin UI lets you open any template and see "here's what the next session would have" (preview). SI-7 holds under test: a capability without a catalog row cannot appear in a session's tool list.

---

## System-Wide Impact

- **Interaction graph:** Strands ↔ AgentCore CI ↔ Aurora ↔ S3 ↔ admin UI. Saga state visible via `plugin_uploads` audit; MCP approval metadata; skill_runs.
- **Error propagation:** Saga failures → explicit `status='failed'` rows. Sandbox errors → structured results. MCP pending → graceful "pending" signals, not generic tool-not-found.
- **State lifecycle risks:** Pool LRU respects in-flight refcounts. Plugin re-upload bumps counter. Stuck pending MCP auto-rejects at 30 days.
- **API surface parity:** New mutations on GraphQL + admin SPA. Mobile unchanged.
- **Integration coverage:** U7 shadow traffic is cross-layer gate for LLM skills.
- **Unchanged invariants:**
  - Tenant isolation at CI resource level.
  - Per-user OAuth via `user_mcp_tokens`.
  - Profile-aware workspace loading (orthogonal).
  - `execute_code` behavior (inline eval) — new dispatcher is separate code path.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Slug collision silently breaks production | Medium | High | U1 pre-flight; U7 PASS gate; 30-day `-legacy` window. |
| AgentCore latency at production volume | Medium | High | U4 user-scoped pool; measure P95 staging; escalate to AWS. |
| Dockerfile class-bug recurs | Low | High | U2 wildcard COPY + EXPECTED_TOOLS assertion before new modules. |
| MCP gate missed on unjoined code path | Low | Critical | U11 single filter site + defensive `url_hash` re-check. |
| **Args-as-code injection** (SI-2) | Eliminated | Critical | JSON-via-writeFiles; test coverage SI-2. |
| **API secret readable by tenant scripts** (SI-1) | Reduced to v1.1 only | Critical | V1 has no sandbox-to-API callback; v1.1 `skill_author` enforces SI-1. |
| **Zip extraction attacks** (SI-4) | Medium | Critical | U9 rejects path-escape/bomb/symlink/count before S3 write. |
| **Session cross-user OAuth leak** (SI-3) | Eliminated | Critical | Pool key includes `user_id`; test coverage. |
| **Module namespace pollution** (SI-6) | Medium | High | `importlib.invalidate_caches()` + `sys.modules.pop` per call. |
| **MCP URL-swap post-approval** (SI-5) | Low | Critical | `url_hash` pin; mutation reverts to pending; test coverage. |
| **Plugin install distributed-txn corruption** | Medium | Medium | U10 three-phase saga + hourly sweeper. |
| **LLM skill semantic regression ships silently** | High without mitigation, Low with | High | U7 shadow A/B 60 days per slug; keyword-match NOT the gate; human-judge sample 20/week. |
| **"Exact spec parity" confuses enforcement-expecting tenants** | Medium | Medium | Admin UI surfaces `allowed-tools` declared vs effective; intersect-narrow at registration. |
| **U1 retirement misreads dormancy** | Medium | Medium | Four-signal rule (zero rows + 90 days + no issue + feature-owner sign-off). |
| **Stuck pending MCP forever** | High without, Low with | Medium | Admin badge + 30-day TTL + graceful runtime error. |
| Warm container pre-env boot | Medium | Medium | U2 post-deploy flush + 15-min reconciler. |
| Hand-rolled SQL drift | Low | Medium | `-- creates:` + `to_regclass` + deploy gate. |
| OPTIONS preflight CORS regression | Medium | Low | U10 integration test. |
| Skill count mismatch | Low (addressed) | Low | U1 census authoritative. |
| **Opacity at scale** (the originating review concern) | ~~High~~ Reduced by R12/U15 | High | Resolved manifest per invocation makes capability assembly visible; admin UI preview for templates; CloudWatch structured logs for every session. |
| **Manifest-log growth** | Medium | Low | 30-day TTL on `resolved_capability_manifests`; sampled retention beyond that (e.g., 1 per template per day) for longer-horizon debugging. |
| **Manifest becomes stale vs. actual runtime behavior** | Low | Medium | SI-7 enforces manifest-as-source-of-truth at `Agent(tools=...)` construction; test coverage verifies the tool list cannot diverge from what the manifest declares. |

---

## Documentation / Operational Notes

- **Pre-launch runbook:**
  - Seed in-repo catalog as Thinkwork-seed plugin per tenant.
  - Warm-flush per U2; smoke invocation.
  - `pnpm db:migrate-manual` on target stage.
  - Confirm shadow-traffic flag set for 9 LLM-mediated skills.
- **Admin docs:** "Uploading plugins" (format, MCP approval, validation errors).
- **Developer docs:** "Writing a Skill" — Thinkwork conventions (`scripts/<slug>/entrypoint.py` with `run(**kwargs) -> dict`, JSON-args-via-writeFiles, `allowed-tools` informational/intersect-narrow, multi-entry options).
- **Observability metrics:** `plugin_upload_count`, `plugin_validation_failures`, `plugin_zip_safety_rejections` (by reason), `mcp_pending_count`, `mcp_pending_age_p95`, `skill_dispatch_cold_start_ms`, `skill_dispatch_pool_hit_rate`, `skill_migration_divergence_rate` (per-slug), `skill_dispatch_depth_max`, `skill_dispatch_total_calls_per_turn`. Tagged by tenant.
- **Rollback:** Legacy slug flip 30 days post per-skill cutover. Shadow keeps legacy alive until all cut over; any regression re-enables legacy for that slug with no config change.

---

## Phased Delivery

### Phase 1 — Foundation
- U1 (census), U2 (Dockerfile + warm-flush), U3 (additive schema).

### Phase 2 — Unified dispatch (internal, shadow-ready)
- U4 (dispatcher SI-2/SI-3/SI-6), U5 (meta-tool), U7 (deterministic + shadow infra).

### Phase 3 — Skill migration (per-slug PRs, U7-gated)
- U8 lands per-skill (harness PASS deterministic; 30+ days shadow-clean LLM).
- U6 (delete + 0025 column-drop) lands only when every slug cut over.

### Phase 4 — Tenant self-serve + observability (user-visible)
- U9, U10, U11, U12 (runtime filter only), U15 (RCM + built-ins-as-catalog-entries).

### Phase 5 — Closeout
- U14 (minimal CLI push).

**Launch-readiness gate:** Phases 1-2 merged; Phase 3 all det skills cut over and all LLM skills shadow-clean 30+ days; Phase 4 merged (including U15 RCM live in staging — every session produces a manifest, admin UI shows manifest preview); `pnpm db:migrate-manual` clean on staging; end-to-end admin-UI → upload → invoke test.

**V1.1 trigger:** Pilot feedback signal on self-authored capability → U13 (compounding loop) via separate plan with SI-1 tokens.

---

## Success Metrics

- **Platform bet validated:** ≥ 1 pilot tenant uploads a custom plugin within first 30 days with zero Thinkwork engineering tickets.
- **Runtime simplicity:** Python LOC in `packages/agentcore-strands/agent-container/` decreases by ≥ 788 lines + 4 test files post-U6. Zero references to `composition_runner`, `CompositionSkill`, execution-type branching.
- **Migration correctness:** U7 deterministic PASS every det-slug. Every LLM-slug 30+ days shadow-clean (<5% divergence by shape, zero human-judged semantic regressions in sampled reviews).
- **Operational stability:** `plugin_validation_failures` < 1% uploads; `skill_dispatch_cold_start_ms` P99 ≤ 5000ms; `plugin_upload` P99 ≤ 10s; `mcp_pending_age_p95` < 72h.
- **Security invariants hold:** SI-1 through SI-7 enforced in code, test-covered, no violations in audit logs first 30 days post-launch.
- **Capability transparency (R12):** 100% of agent sessions produce a manifest. Admin can answer "what is this agent running" for any session within 5 seconds via UI. Zero reports during pilots of "unexpected tool/skill behavior" that cannot be explained by the manifest.

---

## Alternative Approaches Considered

- **Keep four execution types; add tenant upload as a fifth.** Rejected: perpetuates scaffolding this plan removes.
- **Run uploaded scripts in Strands container with seccomp/chroot.** Rejected: duplicates AgentCore microVM.
- **Per-skill named tools.** Rejected: token-budget untenable at tenant scale.
- **Skip pre-launch migration; dual-path forever.** Rejected: bounded via shadow traffic anyway.
- **Auto-approve MCP with domain allowlist.** Rejected: adds trust-management; manual approval is one click.
- **Human review of tenant uploads by SRE.** Out of product identity.
- **Ship U13 in v1.** Rejected: compounding-loop is pilot-measured; seat reserved.
- **Admin UI for kill-switches in v1.** Deferred: runtime + schema ship; UI waits on pilot request.
- **Use Strands' built-in `skills` tool as invocation path.** Rejected: overlaps our `Skill` meta-tool.
- **Keep built-in tools as hard-coded Python registrations.** Rejected per SI-7: opacity risk — built-ins are half the capability surface, hiding them from the manifest means admins can't predict or block them with the same primitives used elsewhere. Built-ins register through the same `capability_catalog` table; Python implementation remains in the container but is referenced by `implementation_ref`, not magic-registered at import time.
- **Defer the Resolved Capability Manifest to v1.1.** Rejected: a second-pass code audit identified opacity as the dominant debugging and trust problem. Without the manifest, the other v1 work (unified execution, self-serve upload, MCP approval) ships a runtime that's cleaner but still opaque. The manifest is cheap once the harness is already assembling `Agent(tools=...)` — capturing and logging it is small work with disproportionate clarity gains.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-23-v1-agent-architecture-final-call-requirements.md`
- Anthropic Agent Skills spec: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Claude Code Plugins reference: https://code.claude.com/docs/en/plugins-reference
- AgentCore Code Interpreter: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-file-operations.html
- Strands tools: https://strandsagents.com/docs/user-guide/concepts/tools/
- Slug collision: `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
- Dockerfile class fix: `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`
- Migration drift: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Admin-mutation discipline: `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
- Narrow REST over resolveCaller: `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
- OPTIONS bypass: `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md`
- Per-stage counters: `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`
- Defer integration harness: `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md`
- Prior sandbox cleanup: `docs/plans/2026-04-23-006-refactor-sandbox-drop-required-connections-plan.md`
- Prior composable hardening: `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md`
- Prior permissions UI: `docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md`
