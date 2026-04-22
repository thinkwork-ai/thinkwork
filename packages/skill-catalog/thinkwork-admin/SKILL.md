# thinkwork-admin

Drive the ThinkWork platform from inside the Strands container — create
agents, stamp templates, wire up teams and members. Admin/owner role
required; every operation is gated per-agent at the resolver.

At the imminent 4-enterprise × 100+-agent × ~5-template onboarding scale,
this skill is the difference between four humans running repetitive
stamp-outs and four humans supervising an agent doing it.

## Status

v0.3.0 — scaffolding + reads + full onboarding mutation surface ship
together.

- 15 read wrappers (Unit 7) — platform, agents, templates, teams, artifacts
- 18 mutation wrappers (Unit 8a) — tenants, teams, agents, templates
- 3-layer resolver defense (Unit 3) — invoker role + per-agent allowlist + scoped role-check
- Server-authoritative idempotency wire-through for `createAgent` (Unit 8b); other resolvers coming

## Auth model — three layers of defense

The wrapper and the GraphQL server cooperate. Each layer closes a
different threat:

### Layer 1 — Service authentication

The Strands container holds `THINKWORK_API_SECRET` and passes it as
`x-api-key` on every GraphQL call. `x-tenant-id`, `x-agent-id`, and
`x-principal-id` headers carry the calling context. `cognito-auth.ts`
already parses all four for apikey callers — no new headers were
introduced for this skill.

**Defends against:** external unauthenticated callers. Doesn't defend
against a rogue skill that also holds the service secret.

### Layer 2 — Per-agent allowlist (the key defense)

`requireAgentAllowsOperation` (Unit 3) looks up
`(agent_id from x-agent-id, skill_id='thinkwork-admin')` in
`agent_skills` and refuses unless the operation name appears in
`permissions.operations`.

**Defends against:** the service-secret impersonation gap. A rogue
skill (`google-email`, `skill-dispatcher`, anything) claims an admin's
`x-principal-id` and tries to call `removeTenantMember`. Its agent
doesn't have `thinkwork-admin` assigned at all, so layer 2 refuses.
Even a co-assigned agent only sees the ops the admin explicitly
enumerated in `permissions.operations`.

### Layer 3 — Invoker role gate

`requireAdminOrApiKeyCaller` (Unit 3) runs a live `tenant_members`
lookup on the `x-principal-id` + target tenant. **No caching.** Role
revocation takes effect on the next tool call (R16).

**Defends against:** a principal whose admin role was revoked after
the agent's turn started.

### The wrapper side — early-fail UX

The Python wrapper pre-flights the role gate via
`_check_admin_role()` before every mutation. This calls the scoped
`adminRoleCheck` query (no arguments — cannot be used as an
enumeration oracle) and refuses with `reason=missing_admin_role` if
the caller isn't `owner`/`admin`. Server-side gates remain
authoritative; this just keeps doomed calls from hitting the wire.

## Wrapper pipeline

Every mutation follows the same 5-step pipeline:

```
@_safe
  → _begin_mutation(op_name):
      _env()              — R15: refuse on no-invoker (CURRENT_USER_ID unset)
      _check_admin_role() — layer-3 pre-flight
      turn_cap.check_and_increment() — Unit 9 cap (default 50, overridable)
  → build GraphQL vars (forwards idempotencyKey when truthy)
  → _graphql(query, vars) — server-side layers 1/2/3 run here
  → _end_mutation(status, arguments):
      audit.emit() with three-pass secret redaction (Unit 12)
```

**Order is load-bearing.** Role check refuses BEFORE the turn counter
bumps — a member-role caller doesn't burn turn budget on doomed calls.
Turn-cap refusals HAVE bumped the counter — a retry after cap-exceeded
doesn't unwind the budget.

## Default-enabled cut (opt-in vs default)

The onboarding-cut ops are `default_enabled: true` in the skill
manifest. Admins extend per-agent via
`agent_skills.permissions.operations` to allow additional opt-in ops.

| Kind | Default-enabled | Opt-in (admin must add to permissions.operations) |
|---|---|---|
| Reads | all 15 reads | — |
| Tenants | `update_tenant`, `add_tenant_member`, `update_tenant_member`, `invite_member` | `remove_tenant_member` |
| Teams | `create_team`, `add_team_agent`, `add_team_user` | `remove_team_agent`, `remove_team_user` |
| Agents | `create_agent`, `set_agent_skills`, `set_agent_capabilities` | — |
| Templates | `create_agent_template`, `create_agent_from_template`, `sync_template_to_agent`, `accept_template_update` | `sync_template_to_all_agents` |

Opt-in ops are in the manifest so the wrapper exposes them as tool
functions — but the resolver-side gate refuses unless an admin
explicitly listed the op name for that agent. The assignment-time
opt-in (admin naming each op) is the trust boundary.

## Extending an agent's allowlist

Set the `agent_skills.permissions.operations` jsonb to include the
additional op name. Example for a reconciler agent that needs to
clean up stale team memberships:

```json
{
  "operations": [
    "list_teams", "list_agents", "remove_team_agent"
  ]
}
```

The skill.yaml manifest is the **maximum** set an agent may ever be
granted. Adding an op name not in the manifest is a no-op — the
resolver only matches against operations the skill declares.

## Failure modes the wrapper surfaces

Every wrapper returns JSON. On failure, the shape is:

```json
{
  "refused": true,
  "reason": "<stable code>",
  "message": "<human-readable detail>"
}
```

Stable `reason` codes — Unit 12's audit log keys on them and
downstream graphs can count them:

| `reason` | Triggered by |
|---|---|
| `no_invoker` | R15 — `CURRENT_USER_ID` env unset (webhook-triggered invocation) |
| `env_misconfigured` | One of the required env vars missing (secret, tenant, agent) |
| `missing_admin_role` | Wrapper-side pre-check — caller isn't `owner`/`admin` |
| `allowlist_miss` | Resolver-side — op not in `agent_skills.permissions.operations` |
| `http_error` | Upstream HTTP error (non-200 from the GraphQL endpoint) |
| `internal` | Uncategorized Python exception — re-emitted with minimal info to avoid leaking internals |

## Idempotency

Every mutation accepts an optional `idempotency_key` kwarg. When
supplied, the server uses `(tenant_id, invoker_user_id, mutation_name,
idempotency_key)` as the dedup key. A retry with the same key returns
the prior call's result without re-executing.

**Recipe-level keying** — the canonical pattern is to build the key
from the recipe's business context so a mid-recipe resume picks up
where it left off:

```python
from operations.templates import create_agent_from_template
from operations.teams import add_team_agent

# Key per step so step 3 can safely retry even if step 2 succeeded.
agent = create_agent_from_template(
    template_id="tpl-onboarder",
    name="Marco",
    slug="marco",
    team_id="team-core",
    idempotency_key="onboard-acme:step-1:marco",
)
add_team_agent(
    team_id="team-core",
    agent_id=agent["id"],
    idempotency_key="onboard-acme:step-2:marco-join-core",
)
```

**Absent key** — the server derives the key from the canonical hash
of the resolved inputs. Identical-input retries still dedupe
automatically.

**Retry vs pending** — an in-flight retry (prior call still
`status=pending` because it crashed before commit) throws a
`MutationInFlightError` at the resolver; the wrapper surfaces it as
a refusal so the agent knows to back off.

## Per-turn mutation cap

Default cap = 50 mutations per agent turn (Unit 9, R19a). Overridable
per-agent via `agent_skills.permissions.maxMutationsPerTurn`. Reads do
**not** count; only mutation wrappers call `check_and_increment`.

Counter is keyed by `(tenant_id, thread_id, turn_id)` so warm
containers serving multiple tenants don't cross-contaminate.

## Audit log

Every tool call emits one `STRUCTURED_LOG` line to stdout (Unit 12):

```json
{
  "timestamp": "...",
  "log_stream": "tenant_<tenant_id>",
  "event_type": "admin_mutation",
  "invoker_user_id": "...",
  "invoker_role": "admin",
  "agent_id": "...",
  "agent_tenant_id": "...",
  "operation_name": "create_agent",
  "arguments_redacted": { "..." },
  "status": "success|refused|failed",
  "refusal_reason": "...|null",
  "latency_ms": 123,
  "turn_count": 7
}
```

Three-pass redaction (key-name regex, value-shape regex, exact-value)
ensures the service secret never reaches stdout. The R21 negative
test in `test_redaction.py` scans captured output for the raw
secret and fails if it appears.

CloudWatch Insights query to audit all admin mutations for a tenant:

```
fields @timestamp, operation_name, status, invoker_user_id, refusal_reason
| filter @message like /STRUCTURED_LOG/
| filter log_stream = "tenant_<tenant_id>"
| filter event_type = "admin_mutation"
| sort @timestamp desc
```

## Catastrophic ops — never-exposed tier

The following op names MUST NEVER appear in this manifest: `delete_tenant`,
`transfer_tenant_ownership`, `transfer_ownership`, `update_billing`,
`charge_tenant`, `refund_tenant`, `bulk_purge`, `purge_tenant`,
`move_tenant` (and their camelCase variants).

Unit 11's manifest-lint test enforces this. When one of these
resolvers ships (none today), its author calls
`requireNotFromAdminSkill(ctx)` at the top — allow-list Cognito-only,
refuses any apikey caller regardless of allowlist membership.

## Pre-work dependencies

The skill relies on seven prior units:

| Unit | Artifact | Why |
|---|---|---|
| 1 | `CURRENT_USER_ID` plumbing | R15 — `_env()` refuses without it |
| 2 | Role-gate + tenant-pin sweep | 13 resolvers previously lacked role checks |
| 3 | `requireAdminOrApiKeyCaller` + `requireAgentAllowsOperation` | Layers 2+3 of the defense |
| 4 | `mutation_idempotency` table + server-side helper | Retry dedup |
| 5 | `idempotencyKey: String` on 16 mutation inputs | Wire the key through to the resolver |
| 9 | `turn_cap` module | Per-turn mutation cap |
| 12 | `audit.emit()` with redaction | Structured audit log |

## Development

```bash
# All thinkwork-admin pytests:
uv run --no-project --with pytest pytest packages/skill-catalog/thinkwork-admin/tests/

# Single test:
uv run --no-project --with pytest pytest \
  packages/skill-catalog/thinkwork-admin/tests/test_wrapper.py::EnvTests::test_missing_current_user_id_refuses_loudly

# Mutation wrapper tests (all 18 mutations, parametrically):
uv run --no-project --with pytest pytest \
  packages/skill-catalog/thinkwork-admin/tests/test_onboarding_mutations.py

# R21 redaction negative test (CRITICAL — run before any audit.py changes):
uv run --no-project --with pytest pytest \
  packages/skill-catalog/thinkwork-admin/tests/test_redaction.py::R21NegativeTest

# End-to-end recipe smoke (Unit 13):
uv run --no-project --with pytest pytest \
  packages/skill-catalog/thinkwork-admin/tests/test_onboarding_recipe_smoke.py
```

## Five questions a new-hire should be able to answer after reading this

1. **What stops a rogue skill holding the shared service secret from
   calling `removeTenantMember`?** Layer 2 (per-agent allowlist) — its
   agent doesn't have `thinkwork-admin` assigned at all.
2. **How does an admin opt an agent into `sync_template_to_all_agents`?**
   Add `"sync_template_to_all_agents"` to that agent's
   `agent_skills.permissions.operations` jsonb.
3. **What happens if a webhook triggers an admin-skill call?**
   `_env()` sees no `CURRENT_USER_ID` and refuses with
   `reason=no_invoker`. Webhook-invoker plumbing is v1.1 work.
4. **What key should the skill pass to dedupe a create-agent step in
   a 20-enterprise onboarding sweep?** A recipe-step key like
   `onboard-acme-inc:step-3:create-agent:marco` — per-enterprise,
   per-step, per-entity.
5. **Why don't `update_tenant_member` and `remove_tenant_member` need
   a separate last-owner guard in this skill?** The resolver already
   enforces it inside a `FOR UPDATE` transaction; the skill's trust
   boundary is the resolver.

## Sources

- Plan: `docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md`
- Origin brainstorm: `docs/brainstorms/2026-04-22-agent-thinkwork-admin-skill-requirements.md`
- Three-layer defense derivation: document-review P0 finding
  (service-auth impersonation)
- Redaction design: `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`
