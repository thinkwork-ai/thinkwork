---
title: "feat: thinkwork-admin skill — agents driving the ThinkWork platform"
type: feat
status: shipped
date: 2026-04-22
origin: docs/brainstorms/2026-04-22-agent-thinkwork-admin-skill-requirements.md
---

# feat: thinkwork-admin skill — agents driving the ThinkWork platform

> **Note on this file.** The original plan authored in the 2026-04-22
> session was lost from disk mid-execution (an early `gh pr merge`
> pass wiped an untracked file). This is a reconstruction from the
> executing agent's working context. The plan was shipped end-to-end
> in the same session — each unit's PR is linked inline below. A few
> minor details (exact per-test scenario wording in the deepest
> sections) may differ from the original author's exact phrasing;
> the unit goals, file lists, and decisions are faithful.

## Shipped — all units merged 2026-04-22

| Unit | PR | Commit | Summary |
|---|---|---|---|
| 2 | [#398](https://github.com/thinkwork-ai/thinkwork/pull/398) | `f820adc` | Role-gate + tenant-pin sweep across 13 admin-reachable mutations |
| 1 | [#401](https://github.com/thinkwork-ai/thinkwork/pull/401) | `3d06f73` | `CURRENT_USER_ID` plumbing through every agent invocation path |
| 3 | [#404](https://github.com/thinkwork-ai/thinkwork/pull/404) | `213820b` | `requireAdminOrApiKeyCaller` + `requireAgentAllowsOperation` + scoped `adminRoleCheck` |
| 4 | [#405](https://github.com/thinkwork-ai/thinkwork/pull/405) | `65da2f6` | `mutation_idempotency` table + server-authoritative helper |
| 6 | [#406](https://github.com/thinkwork-ai/thinkwork/pull/406) | `8a4f4bc` | Skill scaffolding — parser fix, wrapper, manifest shell |
| 9 | [#407](https://github.com/thinkwork-ai/thinkwork/pull/407) | `de275d6` | Per-turn mutation cap (default 50) |
| 11 | [#408](https://github.com/thinkwork-ai/thinkwork/pull/408) | `d3b5996` | `requireNotFromAdminSkill` guard + catastrophic-op manifest lint |
| 12 | [#409](https://github.com/thinkwork-ai/thinkwork/pull/409) | `14aca95` | Audit log + three-pass secret redaction (R21 negative test) |
| 7 | [#411](https://github.com/thinkwork-ai/thinkwork/pull/411) | `dcfbad4` | 15 read tool functions |
| 5 | [#412](https://github.com/thinkwork-ai/thinkwork/pull/412) | `1d6a09c` | `idempotencyKey: String` on 16 mutation inputs |
| 8a | [#413](https://github.com/thinkwork-ai/thinkwork/pull/413) | `9a0406b` | 18 Python mutation wrappers + shared pipeline |
| 8b | [#415](https://github.com/thinkwork-ai/thinkwork/pull/415) | `4e13ae1` | `runWithIdempotency<T>` helper + `createAgent` wire-through |
| 13 | [#416](https://github.com/thinkwork-ai/thinkwork/pull/416) | `6e9afad` | E2E smoke tests (TS + Python recipe-style) |
| 14 | [#420](https://github.com/thinkwork-ai/thinkwork/pull/420) | `f3736fc` | SKILL.md polish (311 lines; answers 5 new-hire questions) |
| 8c | [#423](https://github.com/thinkwork-ai/thinkwork/pull/423) | `5d14570` | Wire idempotency into `createTeam`, `createAgentTemplate`, `inviteMember` |

Unit 10 was removed during plan refinement (destructive-mutation confirmation
gate; superseded by Unit 3's per-agent allowlist verification at the
resolver). Unit 8 was shipped in three slices (8a/8b/8c) to keep each PR
under ~500 LOC.

## Overview

Ship a typed Python skill (`thinkwork-admin`) that lets admin-only agents
drive the ThinkWork platform by calling the GraphQL API from inside the
Strands container. v1 scope is **enterprise-onboarding automation plus
Marco read-only generalist**: the skill wraps broad reads + the mutation
subset needed to stamp out a new enterprise (tenant / member / team /
agent / template / skill-assignment). The common Marco-generalist writes
(label thread, snooze inbox, update routine, forget memory) are deferred
to v1.1 — v1 Marco can answer admin questions but cannot yet act on
day-to-day writes.

Admin-level blast radius is gated by: Cognito-only catastrophic tier,
per-agent operation allowlist verified at the resolver, role gate,
tenant pin, per-turn mutation cap, and structured audit log with secret
redaction.

## Problem frame

Admin agents today cannot create agents, stamp out templates, or wire up
teams the way a human admin does via `thinkwork-cli`. At the imminent
4-enterprise × 100+-agent × ~5-template onboarding scale
(`project_enterprise_onboarding_scale`), this is the difference between
4 humans doing repetitive stamping and 4 admins supervising an agent
doing it.

The brainstorm rejected:

- **Bundling the CLI binary** — infra commands can't run in-container;
  CLI is our own GraphQL client; stdout-parsing is strictly worse than
  typed tools.
- **Long-lived service-principal god-mode token** — audit opacity, leak
  surface, diverges from the existing skill-auth pattern.

**Landing point:** a typed Python skill over GraphQL, authenticated via
the existing `THINKWORK_API_SECRET` service secret + the invoker's
identity asserted via the existing `x-principal-id` header (reused from
`cognito-auth.ts`), role-gated at skill-wrapper and resolver,
tenant-pinned by construction, with per-agent operation-allowlist
verification at the resolver (the real defense against the shared-secret
impersonation gap).

## Requirements trace

Mapping each plan unit to origin requirement IDs (from the brainstorm):

- R1–R4 (skill shape & boundaries) → Units 6, 11
- R5 (read surface) → Unit 7
- R6 (default mutation surface) → Unit 8
- R7–R8 (allowlist + never-exposed tier) → Units 6 (manifest), 8 (enforcement), 11 (never-exposed check)
- R9 (codegen sharing) → Unit 7 deferred-to-impl note
- R10 + R10a/R10b (idempotency) → Units 4, 5, 8
- R11 (role gate, two layers) → Units 2, 3, 6 (wrapper), 8 (resolver call sites)
- R12 (required role) → Unit 2 (resolver), Unit 6 (wrapper)
- R13 (auth: service auth + runtime invoker) → Units 1, 3, 6
- R14 (tenant pin) → Unit 2
- R15 (no-invoker rule) → Units 1, 6
- R16 (role revocation DB-live) → Units 3, 6
- R17 (assignment rides `agent_skills`) → Unit 6 (skill.yaml mode)
- R18 (template-level does not auto-grant opt-in) → Unit 6 (skill.yaml default set)
- R19a (per-turn mutation cap) → Unit 9
- R19b (destructive confirmation gate) → **Dropped in refinement** — superseded by Unit 3's resolver-side per-agent allowlist check (`requireAgentAllowsOperation`)
- R19c (defense-in-depth framing) → Phase 5 posture (cap + never-exposed tier)
- R20 (structured audit log) → Unit 12
- R21 (token hygiene + negative test) → Unit 12, Unit 13
- R22 (operator visibility — logs only, no v1 dashboard) → Unit 12
- R23 (`setAgentSkills` pre-work role gate) → Unit 2 (expanded sweep, 14 mutations)
- R24 (runtime invoker assertion) → Unit 1
- R25 (tenant-pin codebase audit) → Unit 2

## Scope boundaries

### Out of scope

- Bundling `thinkwork-cli` as a binary
- Infra commands (`deploy`/`destroy`/`bootstrap`/`doctor`/`plan`/`outputs`/`status`/`update`/`config`/`login`/`logout`)
- AgentCore Code Interpreter / arbitrary-CLI sandbox (separate brainstorm)
- MCP/connector assignment (`assignTenantMcpServer`, `assignAgentMcpServer`, connector-assignment mutations) — no GraphQL surface today; templates pre-wire bindings via `agent_template_mcp_servers`
- The "never-exposed" catastrophic tier (`deleteTenant`, ownership transfer, last-admin removal, billing/spend, bulk-purge, cross-tenant mutation)
- Non-admin tenant roles
- Ops-runbook write-side — v1 only reads
- Recipe-skill / scheduled-routine orchestration — v1 orchestration is chat-driven only
- Tenant admin UI for editing per-agent mutation allowlist — uses existing jsonb-editing UI
- v1 dashboard for audit queryability — logs only, dashboards are v1.1
- **Webhook-triggered admin automation** — webhooks have no attributable human invoker; R15 causes any `thinkwork-admin` tool call invoked via a webhook-triggered agent to refuse. v1.1 work.

### Deferred to separate tasks

- **MCP/connector assignment via admin skill** — blocked on `tenantMcpServer`/`agentMcpServer`/`connector` GraphQL type extension. Separate v1.1 PR after schema work.
- **GraphQL codegen for Python consumers** — this plan hand-writes response types. If codegen tooling proves extensible to Python, a v1.1 follow-on replaces hand-written types.
- **Full stubbed-runtime integration tests** — deferred behind the shared-harness owner. Unit 13 ships contract/shape tests; end-to-end onboarding via actual Strands harness is v1.1.
- **Operator audit-log dashboard / saved queries** — v1.1.
- **Marco-generalist writes** (label thread, snooze inbox, update routine, forget memory) — v1.1 opt-in surface.

## Context & research

### Relevant code and patterns

- **`packages/agentcore-strands/agent-container/server.py`** — lines 1491–1613 (`do_POST` for `/invocations`). Sets per-request envs: `TENANT_ID`, `AGENT_ID`, `USER_ID`. Does **not** set `CURRENT_USER_ID` anywhere today.
- **`packages/api/src/handlers/chat-agent-invoke.ts`** — only chat path sets `CURRENT_USER_EMAIL` via `envOverrides`, guarded by `if (currentUserEmail)`.
- **`packages/skill-catalog/skill-dispatcher/scripts/dispatch.py`** — existing reader of `CURRENT_USER_ID` (line 24) and pattern for REST service-to-service calls via `Authorization: Bearer ${THINKWORK_API_SECRET}`.
- **`packages/skill-catalog/agent-thread-management/scripts/threads.py`** — canonical GraphQL-from-Python pattern. Uses `x-api-key: $THINKWORK_API_SECRET`, `x-tenant-id`, `x-agent-id` headers; `@_safe` decorator preserving Strands tool schema; 15s timeout. **This is the pattern to mirror.**
- **`packages/api/src/graphql/resolvers/core/authz.ts`** — existing `requireTenantAdmin(ctx, tenantId, dbOrTx?)` helper. Enforces `ctx.auth.authType === "cognito"`, resolves via `resolveCallerUserId`, accepts `owner` or `admin`. **Blocks service-auth callers by design** — do not widen; add a separate variant.
- **`packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`** — `resolveCallerUserId` / `resolveCallerTenantId`. Fallback for Google-federated users where `ctx.auth.tenantId` is null.
- **`packages/agentcore-strands/agent-container/skill_runner.py`** — `_parse_skill_yaml` is hand-rolled: flat `key: value`, bracket lists, two-level `scripts:` dict-list. **Parser bug:** list-item dict values skip bool/int coercion, so `default_enabled: true` lands as string `"true"`. Fix in Unit 6.
- **`packages/agentcore/agent-container/observability.py`** — `log_agent_invocation` shape, emits `STRUCTURED_LOG {json}` prefix for CloudWatch. Add `event_type: "admin_mutation"` variant.
- **Existing idempotency surfaces**: `packages/api/src/handlers/webhooks.ts:290` (`x-idempotency-key` + `webhookIdempotency` table); `heartbeats.graphql:27,46` (wakeup `idempotencyKey` input field). No shared helper yet.
- **`skill_runs` canonical-hash pattern**: canonical JSON (key-sorted, arrays preserved) + SHA256 over resolved inputs + partial unique index `WHERE status = 'running'`. Reuse shape for `mutation_idempotency` — but diverge deliberately to a **full** unique index for terminal-state dedup.

### Institutional learnings

- **Service endpoint vs widening `resolveCaller` auth** — do NOT widen `resolveCaller`/`requireTenantAdmin` to accept service auth. Stand up a dedicated surface that takes `tenantId`/`invokerUserId` explicitly.
- **`SELECT ... LIMIT 1 WHERE tenant_id = ?` without deterministic `ORDER BY`** is a bug. Skill wrappers writing tenant-scoped rows must respect this.
- **Skill-catalog slug-collision** — pre-flight `SELECT count(*) FROM agent_skills WHERE skill_id = 'thinkwork-admin' AND enabled = true` before first sync.
- **Inline helpers vs shared package for cross-surface code** — canonical JSON + SHA256 + partial unique index is the canonical idempotency shape. Reuse.
- **OAuth client credentials in Secrets Manager** — log ARNs not values; typed provider union as authorization surface.
- **Manually-applied drizzle migrations drift from dev** — any DDL in this plan uses `-- creates:` header + `to_regclass` pre-flight + apply-before-merge + `pnpm db:migrate-manual` gate.
- **Multi-tenant onboarding loops** — isolate per-tenant failure with subshells + ERR trap.
- **Defer integration tests until shared harness** — at PR time ship role-gate contract test, redaction negative test, idempotency hash round-trip test.

## Key technical decisions

- **Service auth + existing `x-principal-id` header** (not a new header). Origin R13. Skill calls GraphQL using `THINKWORK_API_SECRET` Bearer; invoker identity flows through the existing `x-principal-id` header that `cognito-auth.ts` already parses.
- **Separate `requireAdminOrApiKeyCaller` helper, not a widened `requireTenantAdmin`.** Keeps the existing Cognito-scoped gate intact.
- **Per-agent operation allowlist verified AT THE RESOLVER, not just the skill wrapper.** Document-review P0 finding: any skill with the shared service secret could claim any admin's principalId and bypass a wrapper-only allowlist. Defense: resolver looks up `(agent_id from x-agent-id, skill_id='thinkwork-admin')` in `agent_skills`, reads `permissions.operations` jsonb, and refuses unless the operation is explicitly listed. A rogue skill impersonating an admin fails here because its agent doesn't have thinkwork-admin assigned.
- **Server-side canonicalization for idempotency** (no Python/TypeScript hash parity). Unit 4's `idempotency.ts` normalizes + hashes inputs on the server; Python wrapper passes raw inputs + an optional client recipe-step key. Eliminates the cross-language parity problem.
- **Allowlist storage: `agent_skills.permissions.operations` jsonb string array.** Default set is the onboarding cut; admin can extend per-agent to any op the skill.yaml manifest declares. Ops not in manifest cannot be enabled. Enforcement is at resolver (authoritative) AND skill wrapper (early-fail UX).
- **Never-exposed tier = manifest exclusion + `authType !== 'cognito'` allow-list on catastrophic resolvers.** Stronger than the original `x-skill-id` deny-list: no apikey caller — regardless of skill origin — can reach catastrophic mutations.
- **Per-turn mutation cap keyed by `(tenant_id, thread_id, turn_id)`.** Tenant-id included to prevent warm-container cross-tenant counter collision. Default 50; overridable via `agent_skills.permissions.maxMutationsPerTurn`.
- **Destructive-mutation confirmation gate DROPPED (Unit 10 removed).** The assignment-time opt-in + resolver-side allowlist verification + turn cap + audit log is the v1 defense. A mid-call confirmation handshake is admin-approval ceremony on top of the capability-trust the admin already granted.
- **Audit log reuses `observability.log_agent_invocation` shape** with `event_type="admin_mutation"`.
- **Scoped `adminRoleCheck` query — no args, returns caller's own role only.** Cannot be used as an enumeration oracle.
- **Pre-work Unit 2 sweeps 14 mutations — the full reachable set.** Document-review audit found missing gates on `updateTeam`, `deleteTeam`, `removeTeamAgent`, `removeTeamUser`, `inviteMember`, `syncTemplateToAgent`, `syncTemplateToAllAgents`. Ships as a standalone security-fix PR independent of the admin-skill plan.
- **`applyTemplate` does not exist as a GraphQL primitive.** The skill calls `createAgentFromTemplate` + `syncTemplateToAgent` / `syncTemplateToAllAgents` directly.
- **Test-first posture for role-gate and idempotency units.**
- **Full unique index on `mutation_idempotency`** (deliberate divergence from `skill_runs`' partial index) — terminal-state dedup is the point. Full index also sidesteps the ON-CONFLICT-on-partial-index gotcha.

## Open questions

### Resolved during planning

- **RQ-1 (role taxonomy)** — verified: existing `requireTenantAdmin` uses `{owner, admin}`. No `billing_admin` / `org_owner` variants.
- **RQ-1a (shared taxonomy source)** — wrapper uses GraphQL `adminRoleCheck(userId, tenantId)` query. Server is single source of truth; aligns with R16 (DB-live revocation).
- **RQ-2 (mutation inventory)** — all onboarding-cut mutations except `applyTemplate` (doesn't exist, use primitives) are present.
- **RQ-3 (idempotency mechanism)** — server-side canonical-JSON + SHA256 hash per operation, `mutation_idempotency` table via resolver-side upsert + `ON CONFLICT DO NOTHING`.
- **RQ-4a (input normalization)** — lowercase strings, trim whitespace, sort map keys, drop null fields, preserve array order.

### Deferred to implementation

- Exact shape of `adminRoleCheck` GraphQL query response — decided during Unit 3.
- Error-shape contract for wrapper refusals — structured `{refused: true, reason: <enum>}` chosen.
- Per-turn cap storage — `(thread_id, turn_id)` sufficient or runtime needs a turn counter? Unit 9 resolved with `_INSTANCE_ID` fallback.
- Redaction filter regex — implementation detail for Unit 12.

## Output structure

New skill directory (Unit 6 creates):

```
packages/skill-catalog/thinkwork-admin/
├── skill.yaml
├── SKILL.md
├── scripts/
│   ├── thinkwork_admin.py       # main module
│   ├── turn_cap.py              # per-turn mutation counter (Unit 9)
│   ├── audit.py                 # admin_mutation log event wrapper (Unit 12)
│   ├── operations/
│   │   ├── __init__.py
│   │   ├── reads.py             # R5 read tool functions (Unit 7)
│   │   ├── tenants.py           # tenant mutations (Unit 8)
│   │   ├── teams.py
│   │   ├── agents.py
│   │   └── templates.py
└── tests/
    ├── test_wrapper.py
    ├── test_reads.py
    ├── test_turn_cap.py
    ├── test_redaction.py
    ├── test_onboarding_mutations.py
    └── test_onboarding_recipe_smoke.py
```

New API + DB artifacts (Units 2–5 create/modify):

```
packages/api/src/graphql/resolvers/core/
├── authz.ts                       # add requireAdminOrApiKeyCaller
├── adminRoleCheck.query.ts        # NEW — wrapper's role-check query
└── (14 mutation resolvers modified in Unit 2)

packages/api/src/lib/
└── idempotency.ts                 # NEW — canonical hash + upsert + runWithIdempotency

packages/database-pg/drizzle/
└── 0020_mutation_idempotency.sql  # NEW — hand-rolled migration
```

## Implementation units

### Phase 1: Pre-work gates (Units 1–2)

#### Unit 1 — Strands runtime invoker plumbing (end-to-end `CURRENT_USER_ID`)

**Goal.** Ensure `CURRENT_USER_ID` is honestly set in the Strands container env for every agent invocation path.

**Requirements:** R13, R15, R24.

**Files:**
- `packages/agentcore-strands/agent-container/server.py` — factor per-invocation env block into `_apply_invocation_env(payload)` helper, cover both the normal path AND the `kind="run_skill"` envelope branch, set `CURRENT_USER_ID` alongside existing `USER_ID`. Extend cleanup to prevent warm-container identity leak.
- `packages/api/src/handlers/chat-agent-invoke.ts` — add `user_id` to invocation payload.
- `packages/api/src/handlers/wakeup-processor.ts` — derive invoker from `agent_wakeup_requests.requested_by_actor_id` where `actor_type = 'user'`; null otherwise (R15 refuses downstream).
- `packages/lambda/job-trigger.ts` — derive invoker from `scheduled_jobs.created_by_id` where `created_by_type = 'user'`.
- `packages/api/src/handlers/webhooks.ts` — webhook invocations have no human invoker; leave `user_id` unset; R15 correctly refuses.
- Test: `test_invoker_env.py` — one scenario per invocation path + warm-container isolation.

**Execution note:** Test-first.

#### Unit 2 — Role-gate + tenant-pin sweep (standalone security PR)

**Goal.** Apply `requireTenantAdmin` + tenant-arg match-check to every mutation in the admin skill's default + opt-in reachable set that lacks one today. Ships as a standalone security-fix PR merging independently — the gaps it closes are live bugs regardless of whether the admin skill ever ships.

**Requirements:** R11b, R12, R14, R23, R25.

**Files** (14 mutations swept):

- `agents/setAgentSkills.mutation.ts`, `agents/setAgentCapabilities.mutation.ts`, `agents/createAgent.mutation.ts`
- `teams/{createTeam,updateTeam,deleteTeam,addTeamAgent,addTeamUser,removeTeamAgent,removeTeamUser}.mutation.ts`
- `core/{addTenantMember,inviteMember,updateTenant}.mutation.ts`
- `templates/{createAgentTemplate,syncTemplateToAgent,syncTemplateToAllAgents}.mutation.ts`

**Execution note:** Test-first. Before-fix baseline contract tests prove the bugs exist (member overwrites `agent_skills.permissions`; admin-of-B mutates tenant A via arg); after-fix tests prove refusal.

**Verification:** Audit table (committed in PR description) shows every reachable mutation marked `fixed ✓`.

### Phase 2: Admin-skill auth infrastructure (Units 3–5)

#### Unit 3 — `requireAdminOrApiKeyCaller` + per-agent allowlist verifier + scoped `adminRoleCheck`

**Goal.** Resolver-side authz primitives. Three layers of defense against the shared-secret impersonation gap.

**Requirements:** R7, R11b, R11c, R12, R13, R16.

**Files:**
- `packages/api/src/lib/cognito-auth.ts` — confirm `AuthResult` carries `principalId` + `agentId` for apikey callers (already present).
- `packages/api/src/graphql/resolvers/core/authz.ts` — add `requireAdminOrApiKeyCaller(ctx, tenantId, operationName, dbOrTx?)` and `requireAgentAllowsOperation(ctx, operationName, dbOrTx?)`.
- `packages/api/src/graphql/resolvers/core/adminRoleCheck.query.ts` — returns caller's own role on own tenant. No args.
- `packages/database-pg/graphql/types/core.graphql` — add `adminRoleCheck: AdminRoleCheckResult!` query.
- Test: contract tests covering all authz branches.

**Execution note:** Test-first.

#### Unit 4 — `mutation_idempotency` table + shared helper

**Goal.** DB table + server-authoritative idempotency helper. Canonicalization and hashing are server-side only.

**Requirements:** R10, R10a.

**Files:**
- `packages/database-pg/drizzle/0020_mutation_idempotency.sql` — hand-rolled migration, `-- creates: public.mutation_idempotency` header.
- `packages/database-pg/src/schema/mutation-idempotency.ts` — Drizzle mirror.
- `packages/api/src/lib/idempotency.ts` — `startOrLoadIdempotentMutation` + `completeIdempotentMutation` + `failIdempotentMutation` + `runWithIdempotency<T>` helper.
- Test: `idempotency.test.ts`.

**Pre-merge gate:** Apply migration to dev DB via `psql "$DATABASE_URL" -f ...`; `pnpm db:migrate-manual` reports zero drift.

**Execution note:** Migration follows the `-- creates:` header convention + `to_regclass` pre-flight + apply-before-merge + `pnpm db:migrate-manual` gate.

#### Unit 5 — Extend onboarding-cut mutation inputs with `idempotencyKey`

**Goal.** Wire `idempotencyKey: String` through each relevant mutation's input type.

**Requirements:** R10, R10a.

**Files:** 16 mutations across `core.graphql` / `agents.graphql` / `agent-templates.graphql` / `teams.graphql`. Input-object mutations get the field inside the input; bare-arg mutations (e.g., `removeTenantMember(id: ID!)`) get `idempotencyKey: String` as an optional top-level arg.

### Phase 3: Skill scaffolding (Unit 6)

#### Unit 6 — `thinkwork-admin` skill directory, manifest, Python client, wrapper role check

**Goal.** Create the skill package with `skill.yaml` declaring the operation manifest, the GraphQL client, env probe, `@_safe` decorator, and wrapper-side role pre-flight.

**Requirements:** R1, R2, R3, R11a, R11c, R13, R15, R16, R17, R18.

**Files:**
- `packages/skill-catalog/thinkwork-admin/skill.yaml`
- `packages/skill-catalog/thinkwork-admin/SKILL.md` (stub; Unit 14 finishes)
- `packages/skill-catalog/thinkwork-admin/scripts/thinkwork_admin.py`
- `packages/agentcore-strands/agent-container/skill_runner.py` — **parser fix** for list-item dict bool/int coercion. Without it, `default_enabled: true` lands as string `"true"`.
- Test: `test_wrapper.py` + parser-coercion test.

### Phase 4: Capability wrappers (Units 7–8)

#### Unit 7 — Read tool functions

**Goal.** Expose the v1 read surface as typed Python tool functions.

**Requirements:** R5.

**Scope shipped (15 reads):** `me`, `get_tenant`, `get_tenant_by_slug`, `get_user`, `list_tenant_members`, `list_agents`, `get_agent`, `list_all_tenant_agents`, `list_templates`, `get_template`, `list_linked_agents_for_template`, `list_teams`, `get_team`, `list_artifacts`, `get_artifact`.

Origin R5 listed ~20 reads spanning threads / inbox / memory / routines; this plan ships the onboarding + Marco-generalist subset that maps directly to existing GraphQL queries. Thread/inbox/memory reads land in a follow-on once the end-to-end Marco scenario exercises them.

#### Unit 8 — Onboarding mutation wrappers with idempotency + allowlist

**Goal.** Expose the R6 default-enabled mutation surface. Wire through idempotency keys and per-agent allowlist enforcement.

**Requirements:** R6, R7, R10, R10a, R10b, R11.

**Split into 8a / 8b / 8c to keep PRs reviewable:**

- **8a (#413):** 18 Python wrappers across `operations/{tenants,teams,agents,templates}.py`. Each wrapper: `@_safe` → `_begin_mutation(op_name)` (role check + turn cap) → `_graphql(...)` → `_end_mutation(status, args)` (audit emit).
- **8b (#415):** `runWithIdempotency<T>` helper in `packages/api/src/lib/idempotency.ts` + reference integration on `createAgent.mutation.ts`.
- **8c (#423):** Wire `runWithIdempotency` into `createTeam`, `createAgentTemplate`, `inviteMember` via the same 4-line pattern.

**Default-enabled vs opt-in cut:**

| Default-enabled | Opt-in |
|---|---|
| `update_tenant`, `add_tenant_member`, `update_tenant_member`, `invite_member`, `create_team`, `add_team_agent`, `add_team_user`, `create_agent`, `set_agent_skills`, `set_agent_capabilities`, `create_agent_template`, `create_agent_from_template`, `sync_template_to_agent`, `accept_template_update` | `remove_tenant_member`, `remove_team_agent`, `remove_team_user`, `sync_template_to_all_agents` |

### Phase 5: Safety rails (Units 9, 11)

#### Unit 9 — Per-turn mutation cap

**Goal.** Refuse mutations after the agent has issued `maxMutationsPerTurn` in a single turn.

**Requirements:** R19a.

**Files:** `packages/skill-catalog/thinkwork-admin/scripts/turn_cap.py`. Counter keyed by `(tenant_id, thread_id, turn_id)`. Default cap 50; override via `agent_skills.permissions.maxMutationsPerTurn`. Reads do not increment; only mutations call `check_and_increment`.

**Turn boundary fallback order:** `CURRENT_TURN_ID` env → `_INSTANCE_ID` env → module-scoped fallback counter per `(tenant, thread)`.

#### Unit 10 — REMOVED

Destructive-mutation confirmation gate. Superseded by Unit 3's resolver-side per-agent allowlist — the assignment-time allowlist is the single source of truth for what this agent may do; mid-call confirmation was ceremony on top of that, inconsistent with framework-baseline agent capability-trust (Managed Agents, Claude Code, OpenAI Agents — all trust at assignment time), added LLM-reasoning risk and token-replay surface without meaningful protection.

#### Unit 11 — Never-exposed tier enforcement

**Goal.** Prevent catastrophic operations from ever being callable via this skill.

**Requirements:** R8.

**Files:**
- `packages/api/src/graphql/resolvers/core/authz.ts` — add `requireNotFromAdminSkill(ctx)` helper (allow-list Cognito-only).
- Catastrophic resolvers — none exist today; helper ships as a primitive. `deleteTenant` / `transferTenantOwnership` / billing / bulk-purge mutations will call `requireNotFromAdminSkill(ctx)` at the top when they land.
- Manifest lint: `never-exposed-tier.test.ts` asserts 18 catastrophic op names (snake_case + camelCase variants) do NOT appear in `skill.yaml`.

### Phase 6: Observability (Unit 12)

#### Unit 12 — Audit logging + secret redaction

**Goal.** Structured log per tool call with invoker + role + refusal reason (R20); token-hygiene negative test proves secrets never appear in log output (R21).

**Requirements:** R20, R21, R22.

**Files:**
- `packages/skill-catalog/thinkwork-admin/scripts/audit.py` — `emit()` with three-pass redaction.
- Test: `test_redaction.py` — R21 negative test scans captured stdout for raw secret.

**Emission shape** (matches `observability.log_agent_invocation` so one CloudWatch Insights query joins agent_invocation + permission_denied + admin_mutation):

```json
{
  "timestamp": "...",
  "log_stream": "tenant_<tenant_id>",
  "event_type": "admin_mutation",
  "invoker_user_id": "...", "invoker_role": "admin",
  "agent_id": "...", "agent_tenant_id": "...",
  "operation_name": "create_agent",
  "arguments_redacted": { "..." },
  "status": "success|refused|failed",
  "refusal_reason": "...|null",
  "latency_ms": 123, "turn_count": 7
}
```

**Redaction — three passes, order-sensitive:**

1. **Key-name regex** — `(secret|token|password|authorization|api[_-]?key|credential|bearer|assertion|signing[_-]?key|private[_-]?key|access[_-]?[a-z]*token)` case-insensitive. Parent-key match redacts the full subtree.
2. **Value-shape regex** — JWT (`eyJ...`), GitHub (`ghp_/ghu_/ghs_`), Stripe (`sk_live_/sk_test_`), Slack (`xox[bpasr]-`), OpenAI (`sk-`), AWS (`AKIA...`), explicit `Bearer ` prefix.
3. **Exact-value** — string equality vs `THINKWORK_API_SECRET` literal.

### Phase 7: Tests & docs (Units 13–14)

#### Unit 13 — In-PR contract tests + e2e smoke

**Goal.** Ship the cheap-but-load-bearing tests at PR time.

**Files:**
- Per-unit contract tests ship with each originating unit (not in Unit 13).
- **`packages/api/src/__tests__/thinkwork-admin-e2e-smoke.test.ts`** — full `createAgent` resolver path, cached retry path, no-key short-circuit.
- **`test_onboarding_recipe_smoke.py`** — 4-step stamp-out-an-enterprise sequence with role-check-per-call + turn-counter accumulation + per-call audit emission.

#### Unit 14 — SKILL.md + skill.yaml docs

**Goal.** New-hire-readable docs per origin success criterion.

**Files:** `packages/skill-catalog/thinkwork-admin/SKILL.md`. Under 500 lines (311 shipped). Answers the five new-hire questions: rogue-skill defense, opt-in path, webhook behavior, idempotency key shape, last-owner guard.

## System-wide impact

- **Interaction graph:** changes touch ~17 mutation resolvers, 1 new query, 2 new authz helpers, the Strands container env, 4 invocation-sender handlers, `packages/database-pg/` (new table + 16 mutation input schema extensions), `packages/skill-catalog/thinkwork-admin/` (new package).
- **Error propagation:** wrapper-side refusals return structured errors the agent can reason about; resolver-side refusals propagate as GraphQL errors. Audit log captures both.
- **State lifecycle risks:** `mutation_idempotency` table grows without bound unless pruned. Nightly cleanup job deferred to v1.1.
- **API surface parity:** codegen regen in `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` after Unit 5.
- **Unchanged invariants:** `requireTenantAdmin` semantics and call sites are unchanged; `resolveCallerTenantId` is unchanged; existing skills' auth paths are unchanged.

## Risks & dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unit 1's `CURRENT_USER_ID` plumbing breaks an existing skill reading from a different env var | Low | Med | Search other skills; additive change |
| Unit 2's pre-work sweep breaks admin SPA / CLI flows relying on missing role checks | Med | High | Test-first — catch before code ships; regression-test existing admin flows |
| `mutation_idempotency` table hot-spot under onboarding burst | Low | Low | Standard PG index performance handles ~1K inserts/min for this scale |
| Schema drift — Unit 4's manual migration not applied before deploy | Low | High | `-- creates:` header + `to_regclass` pre-flight + `pnpm db:migrate-manual` gate + apply-before-merge |
| Skill-catalog slug collision | Very Low | Low | Pre-flight `SELECT count(*)` before first sync |
| Per-turn cap leaks across warm-container invocations | Med | Med | Explicit cross-invocation isolation test |

## Phased delivery

- **Phase 1 (Units 1–2):** Unit 2 ships as standalone security-fix PR independent of this plan. Unit 1 ships as targeted PR after.
- **Phase 2 (Units 3–5):** Depends on Phase 1.
- **Phase 3–4 (Units 6–8):** Core skill surface. Split 8 into 8a/8b/8c.
- **Phase 5 (Units 9, 11):** Single PR each.
- **Phase 6 (Unit 12):** Can ship in parallel with Phase 5.
- **Phase 7 (Units 13–14):** Per-unit test files ship with their originating unit; Unit 13 closes the e2e smoke gap only; Unit 14 ships SKILL.md polish.

## Operational notes

- **Codegen regen** after Unit 5 lands: `pnpm --filter @thinkwork/cli codegen`, same for `@thinkwork/admin`, `@thinkwork/mobile`, `@thinkwork/api`.
- **GraphQL Lambda deploy:** PR to main; merge pipeline handles rollout. Do NOT use `aws lambda update-function-code` directly.
- **Dev apply for Unit 4 migration:** `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0020_mutation_idempotency.sql` against dev BEFORE merging.
- **Operator runbook (v1.1):** CloudWatch Insights query for `STRUCTURED_LOG` lines where `event_type="admin_mutation"` filtered by tenant + status.
- **Rollout plan:** no feature flag — skill is only usable by admin-role callers on agents that have it assigned. Gradually opt-in agents per enterprise.
- **Cleanup job (deferred):** nightly prune of `mutation_idempotency` rows older than 7 days. Not in v1.

## Alternative approaches considered

- **Widen `requireTenantAdmin` to accept service-auth with explicit invoker** — rejected. Widening a shared helper turns the service secret into a universal impersonation credential.
- **Bundle `thinkwork-cli` binary** into the Strands container — rejected in origin Phase 2. Infra commands can't run in-container; stdout parsing is worse than typed calls.
- **Long-lived service principal with elevated privileges** — rejected in origin Phase 2. Audit opacity, leak surface.
- **Per-tool-call Cognito token subprocess env** (v1-draft approach) — rejected during refinement. Would have required a new auth subsystem.
- **CLI composite `thinkwork onboard-enterprise <yaml>` + Terraform seed** — acknowledged as simpler for onboarding-alone, loses when Marco-generalist is also in scope.
- **Ship role-gate fix separately from the admin-skill project** — accepted. Unit 2 ships as a standalone security-fix PR; ensures the fix lands before the skill ships.

## Sources & references

- **Origin document:** `docs/brainstorms/2026-04-22-agent-thinkwork-admin-skill-requirements.md`
- **Sibling brainstorm:** `docs/brainstorms/2026-04-22-agentcore-code-sandbox-admin-skill-seed.md` (sandbox escape hatch — orthogonal v1.1 work)
- **Bundled-CLI pattern precedent:** `docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md`
- **Related code:**
  - `packages/agentcore-strands/agent-container/server.py:1491–1613`
  - `packages/api/src/graphql/resolvers/core/authz.ts`
  - `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`
  - `packages/skill-catalog/agent-thread-management/scripts/threads.py`
  - `packages/skill-catalog/skill-dispatcher/scripts/dispatch.py`
  - `packages/agentcore/agent-container/observability.py`
  - `packages/database-pg/src/schema/agents.ts` (agent_skills.permissions)
- **Institutional learnings:**
  - `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`
  - `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`
  - `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
  - `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`
  - `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md`
  - `docs/solutions/logic-errors/bootstrap-silent-exit-1-set-e-tenant-loop-2026-04-21.md`
