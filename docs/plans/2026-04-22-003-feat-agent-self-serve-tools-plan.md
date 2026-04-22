---
title: "feat: self-serve agent tools — rename, identity fields, user profile"
type: feat
status: active
date: 2026-04-22
---

# feat: self-serve agent tools — rename, identity fields, user profile

## Overview

Close the capability gap that SOUL.md's "Never fabricate capability" rule exposed. The agent currently can't take any of the actions the workspace templates invite — self-rename, update its own personality fields, update what to call the human, maintain human context — so it either refuses or (worse, pre-SOUL-update) fabricates success.

This plan ships three tool families in one PR, plus the backing DB + auth work:

1. **`update_agent_name`** — agent renames itself.
2. **`update_identity(field, value)`** — agent updates Creature / Vibe / Emoji / Avatar on its own IDENTITY.md.
3. **`update_user_profile(field, value)`** — agent updates structured human info (call_by, phone, notes, family, context) on `user_profiles`; USER.md re-renders automatically via the existing write-at-assignment path.

Also bundles the pre-existing cross-tenant authz fix on `updateAgent` (ADV-005 from PR #386 review) since tool 1 depends on scoped auth.

## Problem Frame

The IDENTITY.md and USER.md templates (PR #386) scaffold sections the agent is supposed to fill in over time — Creature, Vibe, Phone, Notes, Family, Context. But the agent has no tool path to actually edit any of these. `write_memory` only accepts `memory/*` basenames. The GraphQL `updateAgent` mutation is only exposed to humans through the admin UI. Result: the template invites behavior the runtime makes impossible.

Today's empirical proof: asking Marco to rename himself produced "Done. I'm Zig now" followed by nothing actually happening (the model roleplayed). PR #388 adds a SOUL.md rule to prevent the roleplay, but doesn't enable the action. This plan enables the action.

## Requirements Trace

- **R1.** Agent can rename itself via `update_agent_name(name: str)`. Reuses the existing `writeIdentityMdForAgent` write-at-rename path from PR #386. DB row + IDENTITY.md Name line stay atomic. Enforces: agent can only rename itself (not other agents), name is non-empty, new-name sanitization matches what the human-triggered rename already does.
- **R2.** Agent can update its own IDENTITY.md personality fields (Creature, Vibe, Emoji, Avatar) via `update_identity(field: Literal, value: str)`. Line-surgery on IDENTITY.md, same pattern as Name-line surgery. Never touches the Name line (that's the rename tool).
- **R3.** Agent can update structured human info via `update_user_profile(field: Literal, value: str)` where `field` ∈ `{call_by, phone, notes, family, context}`. Writes go to `user_profiles` table; USER.md re-renders via the existing `writeUserMdForAssignment` path.
- **R4.** `user_profiles` schema gains 5 nullable text columns: `call_by`, `phone`, `notes`, `family`, `context`. USER.md template + `PlaceholderValues` gain 5 new tokens: `{{HUMAN_CALL_BY}}`, `{{HUMAN_PHONE}}`, `{{HUMAN_NOTES}}`, `{{HUMAN_FAMILY}}`, `{{HUMAN_CONTEXT}}`.
- **R5.** `updateAgent` mutation tightens the WHERE clause to include `tenant_id`, closing the pre-existing cross-tenant rename gap (ADV-005). Service-auth callers (i.e. the agent) pass a matching `x-tenant-id` header; JWT callers use the caller's tenant from auth context.
- **R6.** All self-serve edits log an audit line: `[agent_self_edit] tenant=X agent=Y tool=Z field=F before=A after=B`. Same shape as the existing mutation logs.
- **R7.** Backfill existing USER.md on dev so new placeholders render as em-dash (not literal `{{HUMAN_CALL_BY}}`).

## Scope Boundaries

- **Human-initiated changes still go through the admin UI** (the existing `updateAgent` mutation). Self-serve tools are an addition, not a replacement.
- **`write_memory` stays scoped to `memory/*`.** It is NOT extended to accept IDENTITY.md / USER.md basenames. New tools have narrow purpose-named scope instead.
- **No self-delete, no self-template-change, no self-pair-change.** Those remain human-only.
- **No admin UI changes required** for v1. The admin workspace tab already renders whatever the composer returns — new template shape with the 5 new lines will just show.

### Deferred to Separate Tasks

- **Audit UI surface** showing "last self-edit" timestamps — v2.
- **Revert self-edit** — v2.
- **Structured `family` table** (one row per family member with contact info) — v2 if unstructured text proves insufficient.
- **Rate limiting** on self-edits (prevent runaway writes) — v2 if observed.

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/identity-md-writer.ts` (PR #386) — name-line surgery pattern. `update_identity` reuses the regex-anchor approach for the 4 personality fields.
- `packages/api/src/lib/user-md-writer.ts` (Unit 6) — write-at-assignment writer that reads the template, substitutes placeholders, writes to S3. Adding 5 new placeholders requires extending `PlaceholderValues` in `placeholder-substitution.ts` and reading new columns in `resolveAssignment`.
- `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts` — transaction-wrapped side-effect pattern. New `updateUserProfile` resolver mirrors this shape but writes to `user_profiles` and triggers `writeUserMdForAssignment` for every agent paired to the affected human.
- `packages/agentcore-strands/agent-container/write_memory_tool.py` — canonical Python `@tool` wrapper. New tools mirror the auth + env-variable pattern (`AGENT_ID`, `TENANT_ID` from container env).
- `packages/database-pg/src/schema/core.ts` — `user_profiles` table definition. Adds 5 nullable text columns.
- `packages/api/src/lib/placeholder-substitution.ts` — `PlaceholderValues` type. Adds `HUMAN_CALL_BY`, `HUMAN_PHONE`, `HUMAN_NOTES`, `HUMAN_FAMILY`, `HUMAN_CONTEXT`.

### Institutional Learnings

- `project_workspace_user_md_server_managed` memory: USER.md is written in full on assignment events, no read-time substitution. This plan preserves that invariant — the new fields flow through the same write-at-event machinery.
- PR #386 review findings surfaced the PLATFORM.md vs `write_memory`-scope mismatch (agent-native F2). This plan closes it not by expanding `write_memory` but by adding purpose-named tools, keeping `write_memory`'s "only memory/" rule honest.
- PR #386 adversarial review ADV-005: `updateAgent` lacks a tenant predicate. Fixing it here because the agent's tool will call it, and scoped auth is a must.

## Key Technical Decisions

- **Purpose-named tools over extended `write_memory`.** Three focused tools (`update_agent_name`, `update_identity`, `update_user_profile`) rather than one catch-all. Keeps each tool's scope + audit trail narrow.
- **`user_profiles` text columns, not JSON.** Simpler schema, easier backfill, matches how existing profile columns (title, timezone, pronouns) are stored. JSON is a premature optimization until `family` needs structure.
- **Full-rewrite-on-edit for USER.md, not line-surgery.** Because the edit goes to DB first, then re-renders USER.md from template+placeholders, the entire file regenerates. Different from IDENTITY.md's line-surgery because IDENTITY.md has agent-authored prose below the placeholder-line that we want to preserve; USER.md's template is authoritative.
- **Agent tools call GraphQL mutations over HTTP, not direct DB.** Keeps all writes auditable through the same entry point humans use. Consistent authz model.
- **Service auth for agent tools uses `x-api-key` + `x-tenant-id` + new `x-agent-id` header.** The mutation resolvers compare the header agent-id to the target agent-id — an agent can only act on itself.

## Open Questions

### Resolved During Planning

- **Q: Should `family` be structured (separate table) or unstructured (text column)?** A: Text for v1. Start simple; promote to a table if the agent needs to query or cross-reference family members.
- **Q: Does `memory/contacts.md` overlap with the new `family` field?** A: Different concerns — `family` is the human's family (bounded, slow-changing), `memory/contacts.md` is everyone the agent has interacted with (unbounded, grows over time). Keep both.
- **Q: Should `update_user_profile` notify the human somehow?** A: No for v1. Audit log is sufficient. If runaway writes happen, add rate limiting + notification in v2.

### Deferred to Implementation

- Exact regex anchors for IDENTITY.md's Creature / Vibe / Emoji / Avatar lines — empirically verify against the new template shape before writing tests. Expected: `^- \*\*Creature:\*\*.*$/m` etc.
- Whether `updateUserProfile` should fire `writeUserMdForAssignment` for EVERY agent paired with that human, or only the agent calling the tool — start with all paired agents (matches human-initiated profile-update behavior), verify at test time.

## Implementation Units

- [ ] **Unit 1: DB migration — 5 new columns on `user_profiles`**

**Goal:** Extend `user_profiles` with nullable text columns for call_by, phone, notes, family, context.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `packages/database-pg/src/schema/core.ts` — add 5 columns to `userProfiles` table.
- Create: `packages/database-pg/drizzle/NNNN_agent_self_serve_user_profile_fields.sql` — generated migration.

**Approach:**
- Run `pnpm --filter @thinkwork/database-pg db:generate` after schema edit.
- All columns nullable, no defaults — existing rows get NULL which substitutes as em-dash in USER.md.
- Regenerate GraphQL codegen in every consumer after schema edit.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/api typecheck` after codegen — clean.
- Edge case: DB push to dev — migration applies cleanly, existing USER.md still renders (em-dashes for new fields).

**Verification:** Run `pnpm db:push -- --stage dev`, then `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles'` returns the 5 new columns.

---

- [ ] **Unit 2: Placeholder substitution — 5 new `HUMAN_*` tokens**

**Goal:** Extend `PlaceholderValues` and the `substitute` function to recognize `HUMAN_CALL_BY`, `HUMAN_PHONE`, `HUMAN_NOTES`, `HUMAN_FAMILY`, `HUMAN_CONTEXT`. Extend `writeUserMdForAssignment`'s `resolveAssignment` to read the new columns.

**Requirements:** R3, R4

**Dependencies:** Unit 1 (needs the columns to exist in codegen).

**Files:**
- Modify: `packages/api/src/lib/placeholder-substitution.ts` — add 5 tokens to the placeholder enum.
- Modify: `packages/api/src/lib/user-md-writer.ts` — `resolveAssignment` reads new columns, populates `values`.
- Modify: `packages/api/src/__tests__/placeholder-substitution.test.ts` — add 5 test cases for the new tokens.
- Modify: `packages/api/src/__tests__/user-md-writer.test.ts` — extend existing tests to cover new fields (null → em-dash, set → rendered).

**Patterns to follow:** existing handling of `HUMAN_TIMEZONE` / `HUMAN_PRONOUNS` — same null-fallback-to-em-dash shape.

**Test scenarios:**
- Happy path: template with `{{HUMAN_CALL_BY}}` + profile.call_by="Ricky" → renders "Ricky".
- Edge case: template with `{{HUMAN_CALL_BY}}` + profile.call_by=null → renders "—".
- Happy path: all 5 new tokens substitute correctly in one template render.

**Verification:** Full `pnpm --filter @thinkwork/api test` green.

---

- [ ] **Unit 3: USER.md template refresh — render new fields**

**Goal:** Rewrite USER.md template to use the 5 new placeholders instead of scaffolded prose.

**Requirements:** R3, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/workspace-defaults/src/index.ts` — `USER_MD` const.
- Modify: `packages/memory-templates/USER.md` — mirror.
- Bump `DEFAULTS_VERSION` 2 → 3.

**Approach:**
- Replace prose scaffolds (`*(tbd — ask or wait)*`, `*(getting to know them)*`, `*(Track family names + contact as they come up. Edit freely.)*`, `*(Getting to know {{HUMAN_NAME}} — more to come.)*`) with the corresponding `{{HUMAN_*}}` tokens.
- Keep the structure:

```markdown
- **Name:** {{HUMAN_NAME}}
- **What to call them:** {{HUMAN_CALL_BY}}
- **Pronouns:** {{HUMAN_PRONOUNS}}
- **Timezone:** {{HUMAN_TIMEZONE}}
- **Phone:** {{HUMAN_PHONE}}
- **Notes:** {{HUMAN_NOTES}}

## Family

{{HUMAN_FAMILY}}

## Context

{{HUMAN_CONTEXT}}
```

- Empty values render as em-dash — USER.md still reads cleanly before the agent has filled anything in.

**Test scenarios:**
- Parity test green (`pnpm --filter @thinkwork/workspace-defaults test`).

**Verification:** `loadDefaults()["USER.md"]` returns the new shape with 5 new placeholders.

---

- [ ] **Unit 4: Close cross-tenant authz gap on `updateAgent`**

**Goal:** Tighten `updateAgent` mutation's WHERE to include `tenant_id`, and accept an `x-agent-id` header for service-auth agent-initiated calls where the agent can only act on itself.

**Requirements:** R5

**Dependencies:** None (independent)

**Files:**
- Modify: `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts` — add tenant predicate to the SELECT + UPDATE.
- Modify: `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` — extract caller's allowed agent scope (for service auth, from `x-agent-id` header; for JWT, from `ctx.auth`).
- Create: `packages/api/src/__tests__/update-agent-authz.test.ts` — test the tenant + agent-scope guards.

**Approach:**
- Before the existing transaction, compute `allowedAgentId` (JWT: null meaning all; service: required, from header).
- Add `eq(agents.tenant_id, callerTenantId)` to the existing `eq(agents.id, args.id)` predicate.
- If `allowedAgentId` is set and != `args.id`, throw 403 FORBIDDEN.

**Execution note:** Test-first — security fix regression tests are cheap insurance.

**Test scenarios:**
- Happy path: JWT caller updates agent in own tenant → succeeds.
- Error path: JWT caller updates agent in different tenant → 404 (not 403, to avoid leaking existence).
- Happy path: service caller with `x-agent-id=A` updates agent A → succeeds.
- Error path: service caller with `x-agent-id=A` tries to update agent B → 403.
- Error path: service caller with no `x-agent-id` header → 403.

**Verification:** New tests green; existing updateAgent tests untouched.

---

- [ ] **Unit 5: New mutation — `updateUserProfile`**

**Goal:** GraphQL mutation that updates `user_profiles` columns and triggers `writeUserMdForAssignment` for every agent paired with that human.

**Requirements:** R3, R6

**Dependencies:** Unit 1, Unit 2, Unit 4 (authz pattern reuse).

**Files:**
- Create: `packages/api/src/graphql/resolvers/users/updateUserProfile.mutation.ts`.
- Modify: `packages/database-pg/graphql/types/user.graphql` — add mutation + input type.
- Modify: `packages/api/src/graphql/resolvers/index.ts` — register resolver.
- Create: `packages/api/src/__tests__/update-user-profile.test.ts`.

**Approach:**
- Input: `{ userId: ID!, field: UserProfileField!, value: String }`. Field is enum of `{CALL_BY, PHONE, NOTES, FAMILY, CONTEXT}` (enumerated to keep service-auth scope narrow).
- Transaction: UPDATE user_profiles → for each agent where `human_pair_id = userId`, call `writeUserMdForAssignment(tx, agent.id, userId)` → log audit.
- Authz: service caller must have `x-agent-id` whose agent is paired with `userId`; JWT caller must be in same tenant as user.
- Same transactional guarantee as updateAgent: S3 failures roll back the DB write.

**Execution note:** Test-first — this is the heaviest new mutation.

**Test scenarios:**
- Happy path: agent paired with user → update `call_by` → profile row updated, USER.md re-rendered with new value.
- Happy path: one user paired with 2 agents → update field → BOTH agents' USER.md get re-rendered (mocked writer called twice).
- Happy path: update `notes` to empty string / null → USER.md renders em-dash.
- Error path: agent NOT paired with user → 403.
- Error path: S3 failure mid-transaction → DB rollback; row stays at old value.
- Edge case: field value contains markdown that breaks USER.md rendering — flag for follow-up if detected.

**Verification:** Tests green; one manual dev invocation via GraphQL updates a field and USER.md composer reflects it.

---

- [ ] **Unit 6: Agent tool — `update_agent_name`**

**Goal:** Python `@tool` in the Strands container that calls `updateAgent` mutation with a new name.

**Requirements:** R1, R6

**Dependencies:** Unit 4 (scoped authz).

**Files:**
- Create: `packages/agentcore-strands/agent-container/update_agent_name_tool.py`.
- Modify: `packages/agentcore-strands/agent-container/server.py` — register the tool on the Strands agent.
- Create: `packages/agentcore-strands/agent-container/test_update_agent_name_tool.py`.

**Approach:**
- Tool signature: `update_agent_name(new_name: str) -> str`. Returns a status message the agent shows to the human.
- Reads `AGENT_ID`, `TENANT_ID`, `THINKWORK_API_URL`, `THINKWORK_API_SECRET` from env.
- POSTs GraphQL mutation with `x-api-key`, `x-tenant-id`, `x-agent-id` headers.
- On success: returns `"Renamed to {new_name}."` On failure: returns `"Couldn't rename: {error}"` — the SOUL.md rule catches the lying case if the tool fails.

**Patterns to follow:** `packages/agentcore-strands/agent-container/write_memory_tool.py` for tool shape + auth plumbing.

**Test scenarios:**
- Happy path: tool with valid name → GraphQL mutation called once with right headers → success message.
- Error path: empty name → tool returns error message without calling mutation.
- Error path: GraphQL returns 403 (wrong agent) → tool surfaces the error.
- Error path: GraphQL returns 500 → tool returns "temporary failure" style message.

**Verification:** pytest green; manual invoke: agent's `update_agent_name("Zig")` through a chat invocation results in observed rename + IDENTITY.md update.

---

- [ ] **Unit 7: Agent tool — `update_identity`**

**Goal:** Python `@tool` that line-edits one of the 4 personality fields on IDENTITY.md.

**Requirements:** R2, R6

**Dependencies:** None (separate S3 write path).

**Files:**
- Create: `packages/agentcore-strands/agent-container/update_identity_tool.py`.
- Modify: `packages/api/workspace-files.ts` — support a new action `"update-identity-field"` with line-surgery on IDENTITY.md.
- Create: `packages/api/src/lib/identity-field-writer.ts` — server-side helper that does the line-surgery per field.
- Modify: `packages/agentcore-strands/agent-container/server.py` — register the tool.
- Create: `packages/api/src/__tests__/identity-field-writer.test.ts`.
- Create: `packages/agentcore-strands/agent-container/test_update_identity_tool.py`.

**Approach:**
- Tool signature: `update_identity(field: Literal["creature", "vibe", "emoji", "avatar"], value: str) -> str`. `Literal` type prevents the agent from passing `"name"`.
- Calls `/api/workspaces/files` with `{action: "update-identity-field", agentId, field, value}`.
- Server-side line-surgery: regex anchor per field (`- **Creature:** .*$`, etc.). Sanitize value the same way `identity-md-writer.ts` sanitizes the name (strip newlines, function-form replacement).
- Never touches the Name line (enforced by `Literal` + server-side whitelist).

**Patterns to follow:** `packages/api/src/lib/identity-md-writer.ts` surgery pattern; test-first.

**Test scenarios:**
- Happy path: set creature="wise fox" → IDENTITY.md shows `- **Creature:** wise fox`; other lines untouched.
- Happy path: update all 4 fields in sequence → all 4 updated.
- Error path: field="name" → server rejects (allowlist).
- Error path: value contains newlines → collapsed to spaces.
- Error path: anchor not found (agent rewrote line into prose) → returns error, tells agent the field shape is broken.

**Verification:** Tests green; manual: agent updates its Emoji to "🦊", IDENTITY.md composer confirms.

---

- [ ] **Unit 8: Agent tool — `update_user_profile`**

**Goal:** Python `@tool` that updates one of the 5 human-profile fields on the agent's paired human.

**Requirements:** R3, R6

**Dependencies:** Unit 5 (mutation must exist).

**Files:**
- Create: `packages/agentcore-strands/agent-container/update_user_profile_tool.py`.
- Modify: `packages/agentcore-strands/agent-container/server.py` — register tool.
- Create: `packages/agentcore-strands/agent-container/test_update_user_profile_tool.py`.

**Approach:**
- Tool signature: `update_user_profile(field: Literal["call_by", "phone", "notes", "family", "context"], value: str) -> str`.
- Derives `userId` from `USER_ID` env (already set by chat-agent-invoke).
- POSTs `updateUserProfile` GraphQL mutation.
- Tool-level guards: empty value is allowed (clears the field); over-length value (>10KB) rejected with clear error.

**Patterns to follow:** same auth + env pattern as `update_agent_name_tool.py`.

**Test scenarios:**
- Happy path: `update_user_profile("call_by", "Rick")` → mutation called → success.
- Happy path: `update_user_profile("notes", "Likes tight responses, hates filler")` → USER.md Notes line updates.
- Error path: no `USER_ID` in env (unpaired invocation) → tool surfaces clear error.
- Error path: over-long value → tool rejects locally before mutation call.
- Happy path: empty string → clears the field (renders em-dash).

**Verification:** Tests green; manual: agent records "Likes tight responses" via tool, USER.md composer shows it.

---

- [ ] **Unit 9: MEMORY_GUIDE.md update — teach agents when to use the new tools**

**Goal:** The new tools exist but the model needs instruction on when to use them vs `write_memory`. Update MEMORY_GUIDE.md to teach the routing.

**Requirements:** R1, R2, R3

**Dependencies:** Units 6, 7, 8.

**Files:**
- Modify: `packages/system-workspace/MEMORY_GUIDE.md`.
- Modify: `packages/workspace-defaults/src/index.ts` — `MEMORY_GUIDE_MD` const.

**Approach:**
- Add a section `## Editing Yourself and Your Human` that enumerates each tool, its scope, and when to call it.
- Specifically: "If the human says 'call me Rick', call `update_user_profile('call_by', 'Rick')` — don't just remember it, update it."
- Re-use the existing MEMORY_GUIDE tone — crisp, example-driven.

**Test scenarios:** parity test green; manual: ask Marco "call me Rick from now on" — expect tool call + success, not just a memory/preferences entry.

**Verification:** parity test green.

---

- [ ] **Unit 10: Backfill + deploy verification**

**Goal:** After merge + deploy, re-seed dev templates to DEFAULTS_VERSION=3 and run backfill-user-md so existing agents pick up the 5 new placeholder substitutions (render em-dash where call_by/phone/notes/family/context are null).

**Requirements:** R7

**Dependencies:** All prior units merged + deployed.

**Files:** none (ops action).

**Approach:**
- `seed-workspace-defaults.ts` to push new defaults.
- Per-template S3 refresh via the shell script pattern from PR #386.
- `backfill-user-md --commit` to re-render every paired agent's USER.md.

**Test scenarios:** composer `get USER.md` for Marco shows the new shape; direct AgentCore chat "call me Rick" triggers `update_user_profile` successfully and next chat's USER.md composed view shows "Rick".

**Verification:** Q2 chat test (`What is my name?`) still returns correct name; new Q: "What should I call you?" expected to return the user's current call_by or Name if unset.

## System-Wide Impact

- **Interaction graph:** `updateAgent` and new `updateUserProfile` both trigger S3 writes inside transactions. New `updateUserProfile` fans out to N agents (every agent paired with the human) — must handle per-agent partial failure without aborting the whole transaction.
- **Error propagation:** Tool-level failures surface as text returned to the model. The model then decides whether to retry or admit the limit (SOUL.md rule).
- **State lifecycle risks:** Re-pair wipes `user_profiles.notes/family/context` on the target human? NO — user_profiles is human-scoped, not agent-scoped. Re-pairing agent A from human X to human Y doesn't touch X's profile. Good.
- **API surface parity:** GraphQL schema gains `UserProfileField` enum + `updateUserProfile` mutation. Codegen regenerates in all consumers.
- **Integration coverage:** Cross-layer test: agent tool → GraphQL mutation → DB update → S3 USER.md re-render → composer get → new content visible. Integration tests in packages/api/test/integration cover the server half; Python tests cover the tool half. End-to-end only covered by manual Unit 10 verification.
- **Unchanged invariants:** `write_memory` scope (memory/* only) stays unchanged. `MANAGED_FILES = ["USER.md"]` stays unchanged — USER.md is still server-managed. Agent still can't write directly to USER.md; writes flow through `user_profiles`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Agent spams `update_user_profile` calls, flooding S3 writes | MEMORY_GUIDE.md instruction plus tool-level rate limit as v2 enhancement. For v1, acceptable (paying customers aren't in the loop yet). |
| `family` or `notes` contains large markdown that breaks template rendering | Tool-level length cap (10KB per field). Composer currently imposes no limit but will fail gracefully. |
| Cross-tenant authz fix breaks existing admin UI flows | Unit 4 tests cover JWT caller happy path. Manual admin-UI test post-deploy confirms rename still works. |
| `updateUserProfile` fanout to multiple agents partially fails | Transaction rolls back, DB stays consistent. Per-agent S3 writes already wrap one retry. |
| New placeholders unrendered on agents that haven't been re-seeded | Unit 10 backfill handles all dev agents. For prod, run once per tenant. |
| Agent calls `update_agent_name` too frequently, name ping-pongs | Accepted risk for v1. Add rate limit if observed in practice. |

## Documentation / Operational Notes

- Update `docs/src/content/docs/concepts/agents/workspace-overlay.mdx` — add a section on self-serve agent tools.
- Update `docs/src/content/docs/concepts/agents/templates.mdx` if present — note the new user_profiles fields.
- Deploy order: merge PR → deploy → run db:push → run Unit 10 backfill → manual smoke test.
- No runbook changes beyond the existing backfill pattern.

## Sources & References

- **Direct predecessor PRs:** #382 (workspace_tenant_id fix), #383 (USER.md backfill), #386 (personality templates + IDENTITY.md write-at-rename), #388 (SOUL.md "never fabricate" rule).
- **Review findings addressed:** ADV-005 (cross-tenant authz), F2/F3/F4 (agent-native capability gaps on IDENTITY.md and USER.md from PR #386 review).
- **Origin conversation:** empirical fake-rename test on 2026-04-22 showed Marco fabricating a rename; Eric's spec callout on the same day: "we had a specified goal of allowing the user access to a limited set of direct agent tools."
- **Memory references:** `project_workspace_user_md_server_managed`, `feedback_hindsight_async_tools`, `feedback_worktree_isolation`.
