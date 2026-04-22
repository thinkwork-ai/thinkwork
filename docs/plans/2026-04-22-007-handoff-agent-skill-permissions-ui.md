---
title: "handoff: agent-skill permissions.operations UI editor"
type: handoff
status: ready-for-brainstorm
date: 2026-04-22
predecessor_plan: docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md
---

# Handoff — agent-skill `permissions.operations` UI editor

## Pick it up with

Open a fresh session in this repo and run:

```
/ce:brainstorm based on docs/plans/2026-04-22-007-handoff-agent-skill-permissions-ui.md
```

That should spin up a structured brainstorm, followed by `/ce:plan`, then
`/ce:work`. This file is the whole context — read it top to bottom before
starting.

## Why this handoff exists

The prior session shipped `thinkwork-admin` (the Python skill that lets
admin agents drive the ThinkWork platform via GraphQL — 14 plan units, 16
PRs). The skill's authz model has **three layers** enforced
server-side; the middle layer — per-agent operation allowlist via
`agent_skills.permissions.operations` jsonb — is the real defense
against the shared-service-secret impersonation gap.

**The UI has no authoring surface for that jsonb field.** The existing
agent-template Skills tab (see References) lets operators toggle a
skill on/off but can't express "agent X may call `invite_member` and
`create_agent` but NOT `remove_tenant_member`." Without that authoring
path, enabling `thinkwork-admin` gives the agent **zero** allowed ops
(resolver refuses everything). The entire capability-trust model of
the admin skill depends on this UI.

Eric flagged this mid-smoke-test: "I need to enable this in the Admin UI
somehow, probably through built in tools. We probably need to add that
to the agent template screen as a new tab, etc."

This handoff frames the problem so a fresh session can brainstorm the
right UI shape rather than jumping straight to implementation.

## What just shipped (predecessor context)

`thinkwork-admin` skill, live on main as of 2026-04-22:

- **Python skill** in `packages/skill-catalog/thinkwork-admin/` — 15
  reads + 18 mutations + shared `_begin_mutation` / `_end_mutation`
  pipeline. `skill.yaml` declares every op with `default_enabled:
  true|false`.
- **Resolver defense** — `requireAdminOrApiKeyCaller` + 
  `requireAgentAllowsOperation` in
  `packages/api/src/graphql/resolvers/core/authz.ts`. The allowlist
  check reads
  `agent_skills.permissions.operations` jsonb.
- **Scoped role check** — `adminRoleCheck` GraphQL query (no args,
  caller's own tenant only; cannot be an enumeration oracle).
- **Server-side idempotency** — `mutation_idempotency` table +
  `runWithIdempotency<T>` wrapper; wired into `createAgent`,
  `createTeam`, `createAgentTemplate`, `inviteMember`.
- **Audit log** — three-pass secret redaction emits
  `STRUCTURED_LOG {event_type="admin_mutation", ...}` per call.

Full shipped-units table is in `docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md`.

## The actual problem to solve

### Core requirement

Operators need to author `agent_skills.permissions.operations` — a jsonb
string array of op slugs — for each (agent, skill) pair where the skill
is `thinkwork-admin` (or any future skill with the same opt-in shape).

### Shape constraints

- **Per-skill manifest is the source of truth for available ops.**
  `skill.yaml` in `packages/skill-catalog/<skill>/` declares a `scripts:`
  list; each entry is a tool function name + `default_enabled: bool`.
  The manifest is the **maximum** set an agent may ever be granted.
  Adding an op name not in the manifest is a no-op — the resolver only
  checks against manifest-declared ops.
- **Default-enabled flag maps to UI default.** Ops with
  `default_enabled: true` pre-check; `default_enabled: false` are
  opt-ins the operator must deliberately enable.
- **Catastrophic ops MUST NOT appear in any manifest.** Unit 11's
  `packages/api/src/__tests__/never-exposed-tier.test.ts` enforces this
  at lint-test time. The UI doesn't need to re-enforce it.
- **Authoritative enforcement lives on the server** —
  `requireAgentAllowsOperation` in the resolver. The UI writes to
  `permissions.operations`; the resolver validates on every mutation.
  No client-side check is load-bearing.

### Three design options Eric's already considered

**A. Per-skill "Permissions" sub-panel in the existing Skills tab.**
When the selected skill has ops with meaningful opt-in (thinkwork-admin
does; most other skills don't), expand a multi-select of ops declared
in the skill's manifest. User picks which ops to allow; on save the UI
serializes `{operations: [slug1, slug2, ...]}` into `permissions`.
Most generalizable.

**B. Dedicated "Admin Skill" tab on the agent-template screen.**
Specifically for `thinkwork-admin` (and future skills with the same
opt-in shape). Splits the concern cleanly but doesn't generalize.

**C. Per-agent permissions editor, not per-template.**
Templates grant which skills exist; agents narrow the permissions per
instance. Matches the mental model "template = skill shape, agent =
actual trust boundary."

Eric's leaning toward **A** (generalizable). But the brainstorm should
pressure-test whether per-template vs per-agent is the right layer —
templates are shared across many agents, so per-template trust
assignments have larger blast radius. See "Grill questions" below.

## Key files for the brainstorm + plan

### Existing admin SPA surfaces

| File | What's there |
|---|---|
| `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` | Template edit page. Four tabs: Configuration / Workspace / Skills / MCP Servers. The toggle group is ~line 571 |
| `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` | Per-agent skills page. Uses `SetAgentSkillsMutation` + `listCatalog()` + `installSkillToAgent()` from `@/lib/skills-api` |
| `apps/admin/src/lib/skills-api.ts` | Client-side skill catalog helpers |
| `apps/admin/src/lib/graphql-queries.ts` | Contains `AgentDetailQuery` + `SetAgentSkillsMutation` |
| `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx` | Precedent for an "opt-in with configuration" UI pattern (the web-search tool with API key entry) |

### Relevant DB + schema

| File | Notes |
|---|---|
| `packages/database-pg/src/schema/agents.ts` | `agent_skills` table. `permissions: jsonb("permissions")` is the field to author |
| `packages/database-pg/src/schema/builtin-tools.ts` | `tenant_builtin_tools` precedent — per-tenant tool config + Secrets Manager ref |
| `packages/database-pg/graphql/types/agents.graphql` | `AgentSkillInput` has `permissions: AWSJSON` — the field the UI needs to write |
| `packages/skill-catalog/thinkwork-admin/skill.yaml` | Reference manifest with `default_enabled` per script. The UI needs to parse manifests to render the op-selector |

### Resolvers the UI will call

- `setAgentSkills` (`packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`) — replaces the full skill set for an agent; per-skill `permissions` passed through as AWSJSON string.
- `agentSkills` query (via `agent` field resolvers in `apps/admin/src/gql/graphql.ts`) — reads current state.

### Skill-manifest discovery

The skill catalog is synced to the DB by
`packages/skill-catalog/scripts/sync-catalog-db.ts` into the
`skill_catalog` table. The UI likely needs a query that returns the
parsed manifest structure (scripts list with `default_enabled` per op)
so it can render the op-selector. **Open question: does the GraphQL API
expose the manifest structure today, or does the UI need to fetch
`skill.yaml` contents?** Check `SkillCatalogEntry` / `CatalogSkill`
shapes in the current codebase.

## Grill questions the brainstorm should surface

1. **Per-template vs per-agent authorship.** A template-level
   permissions assignment propagates to every agent instantiated from
   that template. Is that too much blast radius? Or is it the right
   granularity for "all reconciler agents may call the same ops"?
2. **Migration for existing assignments.** Any agents currently
   assigned `thinkwork-admin` without a manifest-editor-authored
   `permissions.operations` have an empty allowlist — every call
   refuses. Is there a migration step to seed `permissions.operations =
   [all default_enabled ops]`? Or does Eric intend to author them
   manually?
3. **Per-agent override of template.** If the template grants
   `thinkwork-admin` with ops `[invite_member]` and an agent-level
   permissions entry broadens it to `[invite_member, create_team]`,
   what wins? Current resolver reads the agent-level row — the
   template-level serves as default. Does the UI need to show
   "inherited from template" vs "agent override"?
4. **Catastrophic name surface check.** If the UI reads the manifest
   and an op name somehow slips past Unit 11's test, does the UI need
   a second guard or does the lint test (run pre-deploy) suffice?
5. **Who can author?** Same permissions as editing the template — any
   tenant admin? Or does this deserve stricter control (owners only)?
6. **Discoverability.** When a skill has ZERO ops the agent can call,
   should the UI warn loudly? "thinkwork-admin is assigned but no ops
   are allowed — this agent cannot use it."
7. **Opt-in defaults across skills.** `thinkwork-admin` is currently the
   only skill where `permissions.operations` matters. If future skills
   adopt the same pattern, does the UI need a way to declare "this
   skill uses operation-level permissions" vs "this skill's
   permissions is a free-form jsonb"?

## Constraints / gotchas inherited from the admin-skill plan

- **Operation names are the resolver-side enforcement key.** A typo
  "invite_memeber" in the UI silently works (the resolver refuses that
  name but the user thinks they enabled the op). Autocomplete from the
  manifest is not a nice-to-have.
- **The `permissions` column is `AWSJSON`** at the GraphQL layer —
  round-trips as a stringified JSON. The UI needs to JSON.stringify
  the `{operations: [...]}` shape on save and JSON.parse on load.
- **`setAgentSkills` replaces the FULL skill set.** The UI must include
  all the agent's other existing skill assignments in the mutation, or
  they'll get dropped. Existing `$agentId_.skills.tsx` likely already
  handles this — verify in the brainstorm.
- **Never-exposed tier stays server-enforced.** Unit 11's
  `requireNotFromAdminSkill` guards catastrophic resolvers. The UI
  should not need to know about this tier — the resolver refuses
  apikey callers regardless of what the manifest says.

## Expected outputs from the brainstorm + plan

1. A brainstorm document exploring the three design options + the grill
   questions above, landing on a concrete recommended UI shape.
2. A plan doc: `docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md`
   following the repo's plan conventions (Overview, Problem Frame,
   Requirements Trace, Scope, Context & Research, Key Technical
   Decisions, Open Questions, Output Structure, Implementation Units,
   System-Wide Impact, Risks, Phased Delivery, Sources).
3. Execution against the plan (likely 2-4 small PRs: GraphQL schema
   surface for manifest metadata → React component for op-selector →
   wire into Skills tab → migration/seeding for existing assignments).

## Not in scope for this handoff

- Marco v1.1 writes (`label_thread`, `snooze_inbox`, `update_routine`,
  `forget_memory`). Separate brainstorm when it comes up.
- Nightly cleanup job for `mutation_idempotency` rows > 7 days.
  30-min job, land when someone's motivated.
- The agentcore-code-sandbox brainstorm
  (`docs/brainstorms/2026-04-22-agentcore-code-sandbox-admin-skill-seed.md`)
  is orthogonal — don't let its decisions back-pressure this plan.

## Invocation

In a fresh session:

```
/ce:brainstorm based on docs/plans/2026-04-22-007-handoff-agent-skill-permissions-ui.md
```

The skill should pick up the context from this file, interview the
operator on the grill questions, land on a design, then hand off to
`/ce:plan` and `/ce:work`.
