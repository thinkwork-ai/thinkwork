# thinkwork-admin

Drives the ThinkWork platform from inside the Strands container — create
agents, templates, teams, members. Admin/owner role required; every
operation is gated per-agent at the resolver.

**Status:** Scaffolding only (Unit 6 of the thinkwork-admin skill plan).
Read and mutation operations ship in Units 7 and 8. Until then this
package declares the wrapper helpers and manifest shell; the skill
exposes no tool functions.

## Auth model (three layers)

The Python wrapper and the GraphQL server cooperate:

1. **Service auth.** The container passes `THINKWORK_API_SECRET` as
   `x-api-key`, along with the `x-tenant-id`, `x-agent-id`, and
   `x-principal-id` (the invoker's user id, populated by Unit 1's
   `CURRENT_USER_ID` plumbing). See
   `packages/api/src/lib/cognito-auth.ts`.
2. **Per-agent allowlist.** At assignment time an admin explicitly
   lists the operations this agent may call in
   `agent_skills.permissions.operations`. The wrapper reads that list
   client-side for early-fail UX; the server enforces it again on
   every gated mutation via `requireAgentAllowsOperation` (Unit 3).
3. **Invoker role.** `requireAdminOrApiKeyCaller` (Unit 3) runs a live
   `tenant_members` lookup on every call — no caching. Role revocation
   takes effect on the next tool call (R16).

A rogue skill holding the shared service secret and claiming an admin's
principalId fails at layer 2 because its agent does not have
`thinkwork-admin` assigned at all. This is the defense against the
P0 service-secret impersonation gap.

## Wrapper helpers

From `scripts/thinkwork_admin.py`:

- `_env()` — reads and validates `THINKWORK_API_URL`, secret,
  `TENANT_ID`, `AGENT_ID`, `CURRENT_USER_ID`. Raises a clean error when
  `CURRENT_USER_ID` is missing (R15 — no human invoker → refuse).
- `_graphql(query, variables)` — minimal GraphQL client; attaches the
  `x-principal-id` / `x-tenant-id` / `x-agent-id` / `x-api-key`
  headers the server already parses. Mirrors the existing
  `agent-thread-management/scripts/threads.py` pattern.
- `@_safe` — decorator that catches errors, preserves the Strands tool
  schema, and returns a JSON-serialized `{error: ...}` shape instead
  of propagating an exception.
- `_check_admin_role()` — calls the scoped `adminRoleCheck` query and
  refuses if the caller isn't `owner` or `admin` on the resolved
  tenant. Units 7/8 wire this into the per-tool dispatch path.

## Pre-work dependencies

Landed before this package:

- **Unit 1** — `CURRENT_USER_ID` plumbed through every invocation path
  so the wrapper's `_env()` can trust it.
- **Unit 2** — role-gate + tenant-pin sweep on every mutation the
  admin skill will reach.
- **Unit 3** — `requireAdminOrApiKeyCaller`, `requireAgentAllowsOperation`,
  and the scoped `adminRoleCheck` GraphQL query.

## Coming next

- **Unit 7** — ~20 read tool functions (`list_agents`, `get_tenant`, …)
- **Unit 8** — onboarding mutations with idempotency + allowlist
- **Unit 9** — per-turn mutation cap
- **Unit 11** — catastrophic-tier block (`requireNotFromAdminSkill`)
- **Unit 12** — structured audit log + secret-redaction negative test

See `docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md`.
