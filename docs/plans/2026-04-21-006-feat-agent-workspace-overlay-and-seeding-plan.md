---
title: Agent workspace files — defaults, overlay inheritance, and human sync
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md
---

# Agent workspace files — defaults, overlay inheritance, and human sync

## Overview

Workspace files (`IDENTITY.md`, `USER.md`, `GUARDRAILS.md`, etc.) define most of what a ThinkWork agent is. Today the copy-on-create plumbing exists but (a) the `_catalog/defaults/workspace/` S3 prefix has no source-controlled content, (b) agents fork at creation and never receive template updates, and (c) assigning a human doesn't persist their identity into `USER.md`. This plan replaces the copy-on-create model with a server-side **live overlay composer**, pins guardrail-class files per agent with an explicit "accept update" action, makes `USER.md` server-managed by the assignment event, and seeds an opinionated default workspace sourced from the repo.

Phase 1 ships independently to populate the empty defaults and fix the "0 files" admin UI state. Phases 2 and 3 are the architectural substance (composer + integration). Phase 4 adds the admin UI affordances and migrates existing agents.

**Scale context:** Imminent onboarding of 4 enterprise tenants × 100+ agents each × ~5 templates (~400+ total agents, see memory `project_enterprise_onboarding_scale`). Plan sizing assumes this scale: per-file granularity, diff preview before accept, hash-addressable pinned versions, and an immutable audit trail are all load-bearing for operator UX and customer compliance. Arguments for "simplify for 4 agents" do not apply.

## Problem Frame

See origin for the full frame. In short:
- **Seeding gap** — `_catalog/defaults/workspace/` is empty per tenant. Every template shows "0 files" in the admin UI.
- **Inheritance gap** — `copyTemplateWorkspace()` forks at creation. Template edits never reach existing agents.
- **Assignment gap** — `{{HUMAN_NAME}}` is substituted at runtime bootstrap in memory and then written back to S3 as an agent-scoped override with only `name` substituted. Assigning a human doesn't refresh `USER.md`.

The durable fix is a read-time overlay for live-class files, pinned versions for guardrail-class files, and a write-at-assignment flow for `USER.md`.

## Requirements Trace

All requirements originate from `docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md`.

- R1, R3. Seed opinionated default workspace files into `_catalog/defaults/workspace/` per tenant; content is source-controlled and deployed to every tenant on creation plus a re-seed action.
- R2. Placeholder variables — canonical set: `{{AGENT_NAME}}`, `{{HUMAN_NAME}}`, `{{HUMAN_EMAIL}}`, `{{HUMAN_TITLE}}`, `{{HUMAN_TIMEZONE}}`, `{{HUMAN_PRONOUNS}}`, `{{TENANT_NAME}}`. Same set is used everywhere the composer runs substitution (live-class files at read-time, USER.md at write-time during assignment). Values are sanitized before insertion (prompt-injection safety).
- R4, R5. Agents store only overridden files under `{agent}/workspace/`. Read resolution chains agent → template → defaults. S3 prefix at every level is derived from the authenticated tenant, never caller input (cross-tenant isolation).
- R6. Writes always land at agent scope; the template base is never mutated by an agent-scoped action.
- R7. Admin UI and Strands runtime receive the composed view — neither implements the chain.
- R8, R8a-d. Revert action deletes the agent-scoped override. Guardrail-class files (`GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`) are **pinned**: each agent records a content hash of the version it was created against; template edits to these files surface as a "Template update available" badge and require per-agent explicit accept.
- R9, R10, R11, R11a. On `updateAgent` changes to `human_pair_id`, the server substitutes and writes the full `USER.md` to the agent's S3 prefix. USER.md always overrides the template after first assignment. Pre-assignment, USER.md inherits normally.
- R12, R13. Strands runtime has a workspace-write tool with a basename **enum** (one of `lessons.md`, `preferences.md`, `contacts.md`), not a path. All other files are read-only from the runtime.
- R14, R15, R16. Admin UI shows inherited/overridden badges, template-update badges on pinned files, and offers override/revert/accept-update actions. The template workspace tab shows the composed template (defaults passthrough visible).
- R17, R18. One-shot backfill seeds defaults for existing tenants. One-shot migration for the 4 existing agents uses a **placeholder-aware** comparator to convert byte-matching-after-reverse-substitute files from "forked copy" to "inherited."

## Scope Boundaries

- **Not** addressing sub-workspaces (`{workspace-slug}/CONTEXT.md` — the Marco-agent screenshot's "Workspaces" primitive). Separate initiative.
- **Not** redesigning the Strands router profile system.
- **Not** introducing a visual diff tool for general overrides vs. template base (pinned-file accept-update gets a simple diff preview; general files don't).
- **Not** introducing multiple archetypal default sets.
- **Not** changing how memory/wiki primitives relate to workspace files.
- `agentVersions.workspace_snapshot` semantics are preserved — but the implementation changes to invoke the composer before persisting (covered in Unit 5).

### Deferred to Separate Tasks

- **Content authoring for the 11 default files**: This plan delivers the seed pipeline; the prose content of `SOUL.md`, `IDENTITY.md`, `GUARDRAILS.md`, etc. is a parallel deliverable. **Owner: Eric Odom** (user is the realistic named owner given current product stage). Unit 2 ships using the existing content already present in `packages/system-workspace/` + `packages/memory-templates/` + the inline `DEFAULT_FILES` in `workspace-copy.ts:47-210` as v1 content — this is already prose-quality, not placeholder text. A follow-up content-review pass before enterprise onboarding tightens the copy for enterprise audience. **Phase 1 is NOT gated on content rewrite** — it ships with existing prose.
- **Interaction with per-user memory/wiki refactor** (see memory `project_memory_scope_refactor`): Unit 7's memory-write tool may be superseded when memory becomes user-scoped. Treated as independent for now; flagged in Risks.

## Context & Research

### Relevant Code and Patterns

- **`packages/api/src/lib/workspace-copy.ts`** — current `DEFAULT_FILES` hard-coded Record (lines 27-210, 12 files including `TOOLS.md` which is not in R1). `ensureDefaultsExist()` (257) lazily seeds per tenant. `copyTemplateWorkspace()` (303) is the fork-at-creation step being replaced. `listTemplateFiles`/`listAgentFiles` (356, 368) stay — composer consumes them.
- **`packages/api/workspace-files.ts`** — current `/internal/workspace-files` Lambda. Bearer-token auth (`API_AUTH_SECRET`), **no DB client**, tenant is caller-supplied. Handler will be rewritten in Unit 5 with tenant hardening.
- **`packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts`** — exemplar pattern at lines 34-83 for "when `runtimeConfig` changes, invoke Job Schedule Manager." The USER.md write on `human_pair_id` change follows the same side-effect shape.
- **`packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts`** — calls `copyTemplateWorkspace` at line 103-107. Under overlay this becomes pinned-version initialization only.
- **`packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`** — becomes the mechanical base for `acceptTemplateUpdate` (scoped to one pinned file).
- **`packages/api/src/lib/agent-snapshot.ts`** — `readWorkspaceFiles()` at line 164 reads `{agent}/workspace/` directly. Under overlay this must invoke the composer, or snapshots silently capture override-only state. Fixed in Unit 5.
- **`packages/api/src/handlers/bootstrap-workspaces.ts`** — precedent for one-shot Lambda handlers invokable via `npx tsx`. Units 3 and 10 follow this pattern.
- **`packages/agentcore-strands/agent-container/server.py`** — `_bootstrap_personality_files` at lines 166-214 downloads templates, substitutes `{{AGENT_NAME}}` / `{{HUMAN_NAME}}`, and **writes substituted content back to S3** at lines 208-214. This rogue S3 write must be removed (Unit 7) or the overlay's "first hit wins" rule permanently forks every agent at first boot.
- **`apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`** — the agent workspace UI. Split-pane tree + CodeMirror editor. Rewritten in Unit 9 for badges/actions.
- **`apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`** — the template editor (the "0 files" screen in the origin screenshot). Uses `instanceId: '_catalog/${slug}'` convention to reuse the same workspace-files endpoint. Unit 9 updates this route to show defaults-passthrough.
- **`packages/database-pg/drizzle/`** — Drizzle SQL migration location; latest is `0016_wiki_schema_drops.sql`. Unit 1 adds `0017_agent_workspace_overlay.sql`.
- **`packages/database-pg/src/schema/`** — `agents.ts`, `agent-templates.ts`, `core.ts` (users, user_profiles, tenants). `user_profiles.notification_preferences` is JSONB; adding `title`/`timezone`/`pronouns` as nullable columns keeps the profile surface coherent without repurposing.
- **Testing pattern** — Vitest with `vi.hoisted` for shared mocks (see `packages/api/src/__tests__/wiki-resolvers.test.ts:15-60`). No existing S3 test harness found; plan introduces `aws-sdk-client-mock` in Unit 4.

### Institutional Learnings

No relevant entries in `docs/solutions/` — novel territory. Budget a `/ce:compound` pass after Phase 2 and Phase 4 to capture learnings on S3 overlay composition and placeholder-aware migration.

Load-bearing entries from `memory/`:
- `feedback_avoid_fire_and_forget_lambda_invokes` — USER.md write on assignment must be RequestResponse with errors surfaced to the caller; no fire-and-forget invoke.
- `feedback_oauth_tenant_resolver` — `ctx.auth.tenantId` is null for Google-federated users; tenant binding in Unit 5 must use `resolveCallerTenantId(ctx)` or equivalent rather than trusting the JWT directly.
- `feedback_verify_wire_format_empirically` — before Unit 10 runs destructive S3 deletes on the 4 existing agents, curl the live endpoint to confirm the composed view matches expectations.
- `feedback_graphql_deploy_via_pr` — no direct `aws lambda update-function-code` calls; all Lambda deploys go through PR merge.
- `project_memory_scope_refactor` — per-user memory/wiki refactor may subsume Unit 7's memory-write tool. Tracked as a Risk.
- `feedback_pnpm_in_workspace` — all install/script commands use `pnpm`, never `npm`.

### External References

None used. Stack is internal (Next.js admin, GraphQL Lambda, Strands Python, S3). No external best-practices research warranted.

## Key Technical Decisions

- **Overlay composer is server-side, single source of truth** in `packages/api/src/lib/workspace-overlay.ts`. Both `/internal/workspace-files` and `agent-snapshot.ts` consume it. The Strands runtime fetches composed files from the internal endpoint rather than re-implementing the chain in Python. Rationale: avoid TS/Python composer divergence; admin UI and Strands see identical composition.
- **Default content is source-controlled** in a new package `packages/workspace-defaults/files/*.md`, bundled into the API package at build time. Rationale: reviewable via PR, replaces the hard-coded `DEFAULT_FILES` Record that mixes content with plumbing.
- **Pinned versions use content hash, not S3 VersionId.** The hash is computed on the raw template base content (pre-substitution). Rationale: works without enabling S3 object versioning; portable across backups; easy to compare.
- **User profile fields (`title`, `timezone`, `pronouns`) land as nullable columns on `user_profiles`**, not on `users`. Rationale: matches existing schema separation (core identity on `users`, presentation/preference on `user_profiles`).
- **Strands memory-write tool parameter is a basename enum** (`"lessons.md" | "preferences.md" | "contacts.md"`), not a path. Rationale: scope escape is impossible by construction — there's no path to traverse. Enforced at the tool definition AND at the server-side handler.
- **Placeholder sanitization is a shared module** invoked inside the composer before any substitution. Rationale: a single audit point for all user-controlled values entering agent prompts.
- **`/internal/workspace-files` tenant binding is derived from the authenticated caller**, not the request body. The admin UI sends its Cognito access token; the handler extracts tenant via `resolveCallerTenantId(ctx)`. Legacy bearer-token callers lose the ability to name an arbitrary tenant. Rationale: closes the cross-tenant isolation hole flagged in the security review.
- **Migration uses reverse-substitute-then-compare.** For each file in each existing agent's S3 prefix, normalize by substituting template placeholders with the agent's current `{{AGENT_NAME}}` and `{{HUMAN_NAME}}`, then compare to the template base as the agent would see it today. Rationale: the current bootstrap already baked values in; naive byte-comparison always fails. **Caveat**: agents whose name is a common noun ("Assistant", "User") may produce spurious matches if the template prose also contains that word; dry-run report flags these for manual review.
- **Composer caching is required, not deferred.** Cache key: `sha256(agent_id + join-of-base-layer-etags-in-chain)`. Invalidation happens on any S3 write to `{agent}/workspace/`, `_catalog/{template}/workspace/`, or `_catalog/defaults/workspace/` that the handler performs (composed views keyed on one of those prefixes are invalidated). At cold-start scale (100+ agents × 11 files in the same minute), this changes per-agent compose cost from 33 S3 HEAD/GETs to a handful. Cache in DynamoDB or Elasticache; implementer picks based on existing infrastructure.
- **Rate limiting on `/internal/workspace-files`.** Per-tenant request cap (e.g., 100 req/s per tenant) with fail-fast 429 on breach. Prevents one runaway agent/tenant from starving the others and limits blast radius of an injection-driven infinite loop.
- **`USER.md` write-on-assignment is synchronous with the DB commit.** The `updateAgent` mutation writes the S3 object inside the same request as the `human_pair_id` update; if the S3 write fails, the mutation fails and the DB change is rolled back (outbox pattern, retried on transient errors). Rationale: avoids the "DB points at human B but S3 USER.md says human A" divergence.

## Open Questions

### Resolved During Planning

- **Where does the composer live?** Shared library `packages/api/src/lib/workspace-overlay.ts`, consumed by two callers (internal endpoint + snapshot). Strands fetches via the endpoint, no Python composer.
- **Pinned-version reference format?** Content hash (SHA-256 of raw template base), not S3 VersionId.
- **Where do `title`/`timezone`/`pronouns` live?** New nullable columns on `user_profiles`.
- **Strands write tool shape?** Basename enum, not path.
- **Default content location?** New `packages/workspace-defaults/` package with source-controlled markdown files.
- **USER.md write atomicity?** Synchronous with DB commit via outbox/retry; on failure the assignment rolls back.

### Deferred to Implementation

- **Tenant-derivation mechanism for `/internal/workspace-files`** — Cognito JWT vs. session lookup via `resolveCallerTenantId`. Depends on which path the admin UI currently uses when calling the endpoint (today it uses a shared bearer token; the admin's session token is already available). Implementer chooses the concrete wiring.
- *(resolved during planning — see Key Technical Decisions)* Composer caching is a Unit 4/5 requirement, not a deferred concern. At 400+ agents across 4 tenants with mass-wakeup possible, per-request compose would saturate the Lambda.
- **Template-delete semantics** — block delete while agents reference the template (simplest), or cascade to defaults. Implementer picks based on admin UX preference.
- **Error-handling policy for composition failures** — transient S3 errors: fail closed (return 502 to caller) or fall through to defaults. Recommend fail-closed for safety-critical files (guardrail-class) and fail-through for cosmetic files.
- **`packages/memory-templates/` and `packages/system-workspace/` existence** — CONFIRMED to exist. `packages/system-workspace/` holds `CAPABILITIES.md`, `GUARDRAILS.md`, `MEMORY_GUIDE.md`, `PLATFORM.md`. `packages/memory-templates/` holds `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md`. Both are actively consumed by `scripts/bootstrap-workspace.sh:35-46` and the deploy workflow. Unit 2 must **reconcile with these existing packages**, not duplicate them. Recommended path: keep the existing two packages as the canonical source, add `packages/workspace-defaults/` with only the three new memory stubs (`memory/lessons.md`, `memory/preferences.md`, `memory/contacts.md`) and a `loadDefaults()` aggregator that re-exports the 8 existing files + 3 new ones as one 11-file set. Also update `scripts/bootstrap-workspace.sh` and `.github/workflows/deploy.yml:50-51` to consume the aggregator.
- **S3 test harness** — `aws-sdk-client-mock` is the recommended library; confirm it's not already present in lockfile before adding.
- **Scope extensibility for Strands memory-write tool** — if `memory/projects.md` or `memory/people.md` become useful, planning/design decides whether to broaden the enum or add a separate tool.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Read path (composer)

```
composer.resolve(tenant, agentSlug, path) {
  tenant = resolveCallerTenantId(ctx)       // never caller-supplied
  templateSlug = lookup agents.template_id  // DB, scoped to tenant
  fileClass = classify(path)                // pinned vs live

  if (fileClass == pinned) {
    pinnedHash = agents.agent_pinned_versions[path]
    // pinned files NEVER fall through to latest template base
    // until operator accepts the update
    if override exists at {agent}/workspace/{path}:
      return { source: "agent-override", content: s3.get(...) }
    // find the template-base object whose content hashes to pinnedHash
    // (stored under _catalog/{template}/workspace/{path}@{hash} or similar)
    return { source: "template-pinned", content: lookupByHash(pinnedHash) }
  }

  // live-class resolution
  for prefix in [
    `tenants/${tenant}/agents/${agentSlug}/workspace/`,
    `tenants/${tenant}/agents/_catalog/${templateSlug}/workspace/`,
    `tenants/${tenant}/agents/_catalog/defaults/workspace/`,
  ]:
    if s3.head(prefix + path) exists:
      content = s3.get(prefix + path)
      return {
        source: sourceFor(prefix),                    // agent-override | template | defaults
        content: substitute(sanitize(ctx.vars), content),
      }
  throw FileNotFound
}
```

### Write path (assignment)

```
updateAgent mutation {
  if input.human_pair_id is defined:
    old = load agent
    if input.human_pair_id != old.human_pair_id:
      human = load users + user_profiles by input.human_pair_id
      template_user_md = composer.resolve(tenant, agentSlug, "USER.md")
      rendered = substitute(sanitize({
        HUMAN_NAME, HUMAN_EMAIL, HUMAN_TITLE, HUMAN_TIMEZONE, HUMAN_PRONOUNS,
      }), template_user_md)
      s3.put({agent}/workspace/USER.md, rendered)    // synchronous, retries on transient errors
  db.update(agents).set(...)
}
```

### Strands runtime read (simplified)

```
_ensure_workspace_ready {
  for each path in PERSONALITY_TEMPLATE_FILES + system files:
    body = http.get(`/internal/workspace-files?action=get&agent=${id}&path=${path}`)
    fs.write(WORKSPACE_DIR + "/" + path, body)
  # NO S3 write-back. No substitution inside the runtime.
}
```

## Implementation Units

### Phase 1 — Foundation (shippable standalone)

- [ ] **Unit 1: Schema migrations for pinned versions and user profile fields**

**Goal:** Add `agents.agent_pinned_versions jsonb`, add `user_profiles.title`, `user_profiles.timezone`, `user_profiles.pronouns` (all nullable text). These columns are prerequisites for R8c and R10.

**Requirements:** R8c, R10

**Dependencies:** None

**Files:**
- Create: `packages/database-pg/drizzle/0017_agent_workspace_overlay.sql`
- Modify: `packages/database-pg/src/schema/agents.ts` (add `agent_pinned_versions`)
- Modify: `packages/database-pg/src/schema/core.ts` (add three columns to `user_profiles`)
- Test: `packages/database-pg/src/__tests__/schema-agent-workspace-overlay.test.ts`

**Approach:**
- Single SQL migration: two `ALTER TABLE`s, no backfill required (JSONB defaults to NULL, profile fields default to NULL).
- Drizzle schema regeneration via `pnpm db:generate` after the schema file edits.
- No data migration in this unit — Unit 10 handles the 4 existing agents.

**Patterns to follow:**
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` for migration structure.
- `notification_preferences jsonb` on `user_profiles` for JSONB idiom.

**Test scenarios:**
- Happy path: inserting an agent row with `agent_pinned_versions = {"GUARDRAILS.md": "sha256:abc"}` round-trips through Drizzle.
- Edge case: inserting an agent row with `agent_pinned_versions = NULL` reads back as `null` (not an empty object).
- Happy path: updating a `user_profiles` row to set `title = "Founder"` and reading back returns the value.
- Edge case: legacy `user_profiles` rows created before migration read back with `title = null`, `timezone = null`, `pronouns = null`.

**Verification:**
- Migration applies cleanly in a fresh dev DB and in a DB with existing `user_profiles` rows.
- Type checking across the API package passes with the new columns.

---

- [ ] **Unit 2: Source-controlled workspace defaults package**

**Goal:** Move the 11 default files from the hard-coded `DEFAULT_FILES` Record into a new `packages/workspace-defaults/` package with one markdown file per name. Replace `DEFAULT_FILES` imports in `workspace-copy.ts` with a package-provided `loadDefaults()` function.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Create: `packages/workspace-defaults/package.json`
- Create: `packages/workspace-defaults/tsconfig.json`
- Create: `packages/workspace-defaults/src/index.ts` (exports `loadDefaults()` returning `Record<string, string>`)
- Create: `packages/workspace-defaults/files/SOUL.md`
- Create: `packages/workspace-defaults/files/IDENTITY.md`
- Create: `packages/workspace-defaults/files/USER.md`
- Create: `packages/workspace-defaults/files/GUARDRAILS.md`
- Create: `packages/workspace-defaults/files/MEMORY_GUIDE.md`
- Create: `packages/workspace-defaults/files/CAPABILITIES.md`
- Create: `packages/workspace-defaults/files/PLATFORM.md`
- Create: `packages/workspace-defaults/files/ROUTER.md`
- Create: `packages/workspace-defaults/files/memory/lessons.md`
- Create: `packages/workspace-defaults/files/memory/preferences.md`
- Create: `packages/workspace-defaults/files/memory/contacts.md`
- Modify: `packages/api/package.json` (add workspace-defaults dep)
- Modify: `packages/api/src/lib/workspace-copy.ts` (replace `DEFAULT_FILES` with `loadDefaults()`; drop `TOOLS.md` which is not in R1)
- Test: `packages/workspace-defaults/src/__tests__/load-defaults.test.ts`

**Approach:**
- Bundle markdown files via `import.meta.glob` or a build-time concat step. Keep the loader synchronous so existing call sites don't change shape.
- Placeholder content in this unit: each file has a short working template with the correct `{{PLACEHOLDERS}}` in place. Production-quality copy arrives in a follow-up PR (see Scope Boundaries / Deferred to Separate Tasks).
- Delete `TOOLS.md` from the set — it's in the current `DEFAULT_FILES` but not in R1's canonical list and is superseded by `CAPABILITIES.md`.

**Patterns to follow:**
- `packages/system-workspace/` if it exists; otherwise `packages/ui-tokens/` or any other content-bundle package in the monorepo.
- pnpm workspace protocol for package linking (`"workspace:*"`).

**Test scenarios:**
- Happy path: `loadDefaults()` returns exactly 11 keys matching R1's canonical list.
- Happy path: each returned value is the file contents verbatim (no trimming, no line-ending normalization).
- Edge case: `memory/lessons.md` is keyed with forward slashes on all platforms (no Windows backslash leakage).
- Error path: none — this is pure file loading; absence of a file is a build-time error, not runtime.

**Verification:**
- `pnpm build` succeeds with the new package included.
- `workspace-copy.ts` compiles without referencing the old inline `DEFAULT_FILES` Record.

---

- [ ] **Unit 3: Seed `_catalog/defaults/workspace/` across tenants**

**Goal:** Write the 11 default files into every tenant's `_catalog/defaults/workspace/` on tenant creation and via a one-shot re-seed handler. This alone fixes the "0 files" admin UI state for new templates, because `copyDefaultsToTemplate` already runs on template create — it just had no source content.

**Requirements:** R1, R3, R17

**Dependencies:** Unit 2

**Files:**
- Create: `packages/api/src/handlers/seed-workspace-defaults.ts` (one-shot Lambda handler + `npx tsx` runnable)
- Modify: `packages/api/src/lib/workspace-copy.ts` — `ensureDefaultsExist()` pulls from `loadDefaults()` and overwrites (not "create if missing") when a new `DEFAULTS_VERSION` constant increments.
- Modify: tenant-create hook (likely `packages/api/src/graphql/resolvers/tenants/createTenant.mutation.ts` or equivalent — verify during implementation) to call `ensureDefaultsExist` synchronously.
- Test: `packages/api/src/__tests__/seed-workspace-defaults.test.ts`

**Approach:**
- Handler iterates all tenants (via `db.select().from(tenants)`) and calls `ensureDefaultsExist(tenantSlug)` for each.
- `ensureDefaultsExist` compares a `_defaults_version` metadata key in S3 to a `DEFAULTS_VERSION` constant in `packages/workspace-defaults`. Mismatch → rewrite all 11 files. Match → no-op.
- Invoke via Lambda (post-merge) and via `npx tsx packages/api/src/handlers/seed-workspace-defaults.ts` for local/ops runs.
- No destructive action on existing template or agent prefixes — only touches `_catalog/defaults/`.

**Execution note:** Test-first on the version-gate logic — the "only rewrite when version changes" behavior is the one place this could go wrong.

**Patterns to follow:**
- `packages/api/src/handlers/bootstrap-workspaces.ts` for handler shape and local-run support.

**Test scenarios:**
- Happy path: empty tenant prefix + `DEFAULTS_VERSION=1` → all 11 files written to S3 with expected keys.
- Happy path: `_defaults_version=1` already at S3, `DEFAULTS_VERSION=1` → no writes performed.
- Happy path: `_defaults_version=1` at S3, `DEFAULTS_VERSION=2` → all 11 files overwritten and version bumped.
- Edge case: a tenant whose `_catalog/defaults/workspace/` has an extra file not in R1's list (e.g., leftover `TOOLS.md`) — the seeder leaves it alone (write-only, no deletes).
- Error path: S3 PUT fails for one file midway through seeding — subsequent files still attempt; handler returns a summary of successes and failures.
- Integration: tenant-create hook fires `ensureDefaultsExist` and the new tenant's first template (created on the same day) has `_catalog/{templateSlug}/workspace/` populated by `copyDefaultsToTemplate`.

**Verification:**
- Running the handler against a dev environment populates every tenant's defaults.
- Creating a new template via the admin UI shows all 11 files in the template workspace tab.

---

### Phase 2 — Overlay engine

- [ ] **Unit 4: Server-side overlay composer library**

**Goal:** Implement `packages/api/src/lib/workspace-overlay.ts` as the single composer shared between the admin internal endpoint and the snapshot path. Includes placeholder sanitization and the read-time substitution logic.

**Requirements:** R2, R4, R5, R7

**Dependencies:** Unit 1

**Files:**
- Create: `packages/api/src/lib/workspace-overlay.ts` (exports `composeFile`, `composeList`, `classifyFile`)
- Create: `packages/api/src/lib/placeholder-substitution.ts` (exports `sanitizeValue`, `substitute`)
- Create: `packages/api/src/lib/workspace-file-classes.ts` (exports `PINNED_FILES`, `LIVE_FILES`, `MANAGED_FILES`)
- Test: `packages/api/src/__tests__/workspace-overlay.test.ts`
- Test: `packages/api/src/__tests__/placeholder-substitution.test.ts`

**Approach:**
- `composeFile(tenant, agentSlug, path, ctx) → { source, content, sha256 }`:
  1. Resolve agent row + template slug from DB (never trust caller input for tenant).
  2. Classify `path` as `pinned | live | managed` (USER.md is managed).
  3. For `managed` (USER.md): return agent-scoped object; if absent, fall through to template like live (no read-time substitution — USER.md's substitution happens at write time in Unit 6).
  4. For `pinned`: resolve against the pinned content hash stored in `agents.agent_pinned_versions`. If agent override exists, use it.
  5. For `live`: walk the chain `{agent}/ → _catalog/{template}/ → _catalog/defaults/`, first hit wins.
  6. Run `substitute(sanitize({AGENT_NAME, HUMAN_NAME, HUMAN_EMAIL, HUMAN_TITLE, HUMAN_TIMEZONE, HUMAN_PRONOUNS, TENANT_NAME}), content)` on the chosen content for live files. Variables are **always server-computed** from DB state (agent + users + user_profiles + tenant joins), never accepted from request body. Pre-assignment (`human_pair_id` null), all `{{HUMAN_*}}` values render as `—` so admin UI never shows raw `{{HUMAN_NAME}}` literals in the preview.
- `composeList(tenant, agentSlug, ctx, {include_content?: boolean}) → Array<{path, source, sha256, content?}>`: union of paths across the three levels; when `include_content=true`, returns full composed content in a single response. The batch mode is a **Unit 5 requirement**, not a Unit 7 deferral — the Strands runtime uses it to avoid N round-trips at bootstrap.
- `sanitizeValue(value) → string`: strip/escape markdown structural chars, HTML comments, ANSI escape sequences (`\x1b\[[0-9;]*[A-Za-z]`), bidirectional Unicode overrides (`U+202A..U+202E`, `U+2066..U+2069`, `U+200B`, `U+FEFF` outside BOM position), C0/C1 control characters including null bytes, managed-block delimiter strings (`<!--managed:...-->`), and Unicode homoglyphs that could spoof placeholder syntax. Normalize input to NFC before processing. Max-length cap at 500 chars. On violation, log only the violation category and field name (never the raw value — PII leak hazard) and redact rather than throwing. Sanitization is invoked on every user-controlled value (name, email, title, timezone, pronouns) before substitution into any workspace file content.
- Use `aws-sdk-client-mock` for S3 testing.

**Execution note:** Start with a failing test that proves cross-tenant isolation — a caller in tenant A cannot compose an agent from tenant B even by sending `tenantSlug: "B"` in a request body, because the composer derives tenant from `ctx` only.

**Patterns to follow:**
- `packages/api/src/lib/workspace-copy.ts` for S3 client usage and key construction.
- `packages/api/src/__tests__/wiki-resolvers.test.ts` for `vi.hoisted` mocking idiom.

**Test scenarios:**
- Happy path (live): agent with no override → `composeFile(..., "IDENTITY.md")` returns `{source: "defaults", content: <substituted>}`.
- Happy path (live): agent with override → returns `{source: "agent-override", content: <override, substituted>}`.
- Happy path (live): template with override, agent without → returns `{source: "template", content: <substituted>}`.
- Happy path (pinned): agent has `agent_pinned_versions["GUARDRAILS.md"] = "sha256:old"`; defaults has been updated → `composeFile` returns the object matching the pinned hash, NOT the latest default.
- Happy path (pinned): agent has no pinned entry and no override → falls back to the current defaults hash, recording it.
- Happy path (managed USER.md): agent override exists → return it verbatim, no substitution (the file was written with values already substituted).
- Edge case: placeholder value exceeds sanitization length cap → sanitized and truncated with a warning log.
- Edge case: placeholder value contains `<!--managed:assignment-->` literal → stripped before substitution (managed-block delimiters are reserved).
- Edge case: placeholder value contains markdown headings (`## Ignore previous…`) → escaped so they render as literal text.
- Error path: caller supplies `tenantSlug: "other-tenant"` but `ctx.tenantId` resolves to a different tenant → composer throws or ignores the body value and uses ctx.
- Error path: template row deleted while agent references it → composer falls through to defaults for live files; for pinned files, still serves the pinned-hash object (which is addressed by content hash, not by template slug path).
- Integration: `composeList` returns the union of paths across all three layers for a live-class file set, with correct `source` labeling per file.

**Verification:**
- Full test suite green.
- Type signature is stable so Unit 5 and Unit 7 can consume it without further changes.

---

- [ ] **Unit 5: Rewrite `/internal/workspace-files` + fix snapshot path + harden auth**

**Goal:** Replace the current handler in `packages/api/workspace-files.ts` with a composer-backed implementation. Add DB client access so tenant binding is derived from the authenticated caller. Update `agent-snapshot.ts` to invoke the composer before persisting `workspace_snapshot`.

**Requirements:** R4, R5, R6, R7, R14

**Dependencies:** Unit 4

**Files:**
- Modify: `packages/api/workspace-files.ts` (major rewrite)
- Modify: `packages/api/src/lib/agent-snapshot.ts` (`readWorkspaceFiles` → composer)
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` (singular — main agent workspace tab)
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspaces.tsx` (plural — second consumer of the endpoint; also drives the "Workspaces" sub-agent surface out of this plan's scope, so confirm compatibility rather than full rewrite)
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` (template workspace tab)
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/defaults.tsx` (template-defaults editor — third consumer)
- Modify: `apps/admin/src/components/agents/AgentConfigSection.tsx` (fourth consumer)
- Modify: `apps/admin/src/components/agents/AgentContextDialog.tsx` (fifth consumer)
- Modify: `apps/admin/src/components/agents/AgentContextSection.tsx` (sixth consumer)
- Test: `packages/api/src/__tests__/workspace-files-handler.test.ts`
- Test: `packages/api/src/__tests__/agent-snapshot-overlay.test.ts`

**Approach:**
- New request shape: `{action, agentId | templateId, path?, content?}`. Tenant is derived from the request's auth context (Cognito JWT), not from a body field. Reject requests that carry a `tenantSlug` body field that doesn't match the resolved tenant.
- `action: "list"` → calls `composer.composeList`; response includes `{path, source, overridden, sha256}` per file.
- `action: "get"` → calls `composer.composeFile`; response is `{content, source, sha256}`.
- `action: "put"` → writes to `{agent}/workspace/{path}` only; rejects writes to guardrail-class files unless paired with an `acceptTemplateUpdate`-style flag (covered in Unit 9).
- `action: "delete"` → deletes the agent-scoped override; for pinned files this reverts to the currently-pinned hash, not the latest template.
- `action: "regenerate-map"` → unchanged for now; manifest semantics revisited in Unit 7.
- `agent-snapshot.ts`: `readWorkspaceFiles(tenant, agentSlug)` now iterates `composer.composeList` and snapshots the composed content for each path, so `workspace_snapshot` stays complete.
- Auth hardening: handler uses the same Cognito-authenticated path the rest of the GraphQL Lambda uses (investigate `resolveCallerTenantId` from `feedback_oauth_tenant_resolver` memory).

**Execution note:** Add characterization coverage for the current handler's behavior before rewriting — 4 existing agents and the admin UI depend on the exact response shape.

**Patterns to follow:**
- GraphQL Lambda auth pattern (`packages/api/src/graphql/...`) for extracting tenant from ctx.
- `resolveCallerTenantId` usage precedent (from memory).

**Test scenarios:**
- Happy path: authenticated admin calls `list` for an agent in their tenant → returns composed list with `source` labels.
- Happy path: `get` for an inherited file returns `{source: "template", content: ...}` without requiring the file to exist at agent scope.
- Happy path: `put` on a live file creates the agent-scoped override; a subsequent `get` returns `{source: "agent-override"}`.
- Happy path: `delete` on an overridden live file makes the next `get` return `{source: "template" | "defaults"}`.
- Edge case: `put` on a pinned file without the accept-update flag returns 403 with a clear error.
- Error path: caller's JWT resolves to tenant A; body claims `tenantSlug: "B"` → 403, no S3 interaction.
- Error path: unauthenticated caller (no JWT, bearer token only) → 401. Legacy `API_AUTH_SECRET` bearer is **removed** — deployments that still use it must migrate to Cognito session auth before this unit ships.
- Integration: `agentVersions.workspace_snapshot` captures all 11 composed files (not just agent overrides) after creating a version for an agent with no overrides.

**Verification:**
- Admin UI loads the workspace tab with the new response shape.
- `agentVersions.workspace_snapshot` for a fresh agent contains the full composed file set.

---

### Phase 3 — Integration

- [ ] **Unit 6: `updateAgent` → USER.md write-at-assignment**

**Goal:** When `updateAgent.humanPairId` is set, changed, or cleared, substitute the template USER.md with the human's values and write the file in full to `{agent}/workspace/USER.md` inside the same request. On S3 failure, the mutation fails and the DB update rolls back.

**Requirements:** R9, R10, R11, R11a

**Dependencies:** Unit 1, Unit 4

**Files:**
- Modify: `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts`
- Create: `packages/api/src/lib/user-md-writer.ts` (pure function — load template, sanitize, substitute, PUT)
- Test: `packages/api/src/__tests__/update-agent-user-md.test.ts`
- Test: `packages/api/src/__tests__/user-md-writer.test.ts`

**Approach:**
- Follow the `runtimeConfig` side-effect pattern at `updateAgent.mutation.ts:34-83`: check `i.humanPairId !== undefined`, compare old vs new, and invoke the writer.
- Writer steps: (1) load human via `users` + `user_profiles` join; (2) call composer to get the template USER.md (follows the normal chain); (3) run `substitute(sanitize({HUMAN_NAME, HUMAN_EMAIL, HUMAN_TITLE, HUMAN_TIMEZONE, HUMAN_PRONOUNS, AGENT_NAME, TENANT_NAME}), template)`; (4) PUT to `{agent}/workspace/USER.md`; (5) regenerate manifest.
- Missing fields render as `—` (em dash) per R10.
- On `humanPairId` cleared (null), the writer still runs — substitutes placeholder values (`—` for each field) and rewrites USER.md. The file remains agent-scoped.
- Transactional behavior: `db.update().returning()` commits immediately and **cannot** be rolled back by a surrounding try/catch. The resolver must wrap the DB update and the S3 PUT in an explicit `db.transaction(async (tx) => { ... })` block, with the S3 PUT performed inside the transaction callback. If the S3 PUT throws, the transaction rolls back and `human_pair_id` stays at its old value. Retry transient S3 errors inside the transaction once before giving up. This is the synchronous-with-DB-commit model from Key Decisions; it is not an outbox pattern (those write to S3 async after commit). Follow `feedback_avoid_fire_and_forget_lambda_invokes`. Log only `{agentId, success: true|false, errorCategory?}` — never log `name`, `email`, `title`, `timezone`, or `pronouns` values even on the success path (CloudWatch captures prompt-content logs; these fields are PII).

**Execution note:** Test-first for the substitute + sanitize boundary — this is the prompt-injection surface.

**Patterns to follow:**
- `updateAgent.mutation.ts` runtimeConfig branch (34-83) for the side-effect shape.
- `packages/api/src/lib/placeholder-substitution.ts` from Unit 4.

**Test scenarios:**
- Happy path: assigning a human with full profile writes USER.md with real name, email, title, timezone, pronouns.
- Happy path: assigning a human with only name + email writes USER.md with `—` in title/timezone/pronouns slots.
- Happy path: changing assignment from human A to human B rewrites the whole file with B's values; any content from A is replaced.
- Happy path: clearing assignment (human_pair_id → null) rewrites with all placeholder values as `—`.
- Edge case: human's name contains markdown control chars (`**`, `##`, `<!-- ... -->`) → sanitized before substitution.
- Edge case: human's email contains prompt-injection payload (`Ignore prior instructions`) → sanitized; substituted value is inert.
- Error path: S3 PUT fails → mutation throws; DB does not commit; no partial state.
- Error path: user_profiles row missing for the assigned user → resolver fails with a clear error (assigning an unprofiled user is not supported in this unit; assumption flagged in Open Questions).
- Integration: after the mutation succeeds, an admin UI `get` on USER.md returns the fully-substituted content (R11 — USER.md is now agent-scoped).

**Verification:**
- Assigning a human via the admin UI populates USER.md in the admin view within the same request.
- Reassignment rewrites the file cleanly without residual values from the prior human.

---

- [ ] **Unit 7: Strands runtime — remove S3 write, fetch via composer, add memory-write tool**

**Goal:** Remove the `_bootstrap_personality_files` S3 write at `server.py:208-214`. Switch workspace file loading to fetch from the internal endpoint (which now returns composed content). Add a Strands tool `write_memory(name: Literal["lessons.md", "preferences.md", "contacts.md"], content: str)` with a basename enum.

**Requirements:** R2, R11a, R12, R13

**Dependencies:** Unit 4, Unit 5

**Files:**
- Modify: `packages/agentcore-strands/agent-container/server.py` (remove S3 write in `_bootstrap_personality_files`; adapt `_ensure_workspace_ready` to fetch composed files)
- Modify: `packages/agentcore/agent-container/install_skills.py` (note: this file lives in the non-strands `packages/agentcore/` tree; `server.py` in the Strands container imports it via shared `PYTHONPATH` in the Docker image. Dockerfile must continue to include both trees.)
- Create: `packages/agentcore-strands/agent-container/tools/write_memory.py` (new Strands tool)
- Modify: `packages/agentcore-strands/agent-container/tools/__init__.py` (register tool)
- Test: `packages/agentcore-strands/agent-container/tests/test_bootstrap_no_s3_write.py`
- Test: `packages/agentcore-strands/agent-container/tests/test_write_memory_tool.py`

**Approach:**
- `_ensure_workspace_ready` now calls the internal composer endpoint for each personality file, writes locally to `WORKSPACE_DIR`, and does NOT write back to S3.
- Endpoint call uses the container's service credentials (same auth path as other internal calls from the runtime).
- `write_memory` tool:
  - Parameter: `name: Literal["lessons.md", "preferences.md", "contacts.md"]` and `content: str`.
  - Tool body: POST to `/internal/workspace-files` with `action: "put"`, `path: "memory/{name}"`, `content`. The server handler (Unit 5) already canonicalizes and rejects path escapes — the enum means there is no path string to escape in the first place.
  - On success, regenerates manifest; the next `_ensure_workspace_ready` sees the new content via composer.
- Remove any lingering Python-side substitution of `{{AGENT_NAME}}` / `{{HUMAN_NAME}}` — substitution is the composer's job now.

**Execution note:** Characterization-first on the existing `_ensure_workspace_ready` flow before touching it — this is the load-bearing cold-start path.

**Patterns to follow:**
- Existing Strands tool registration in `tools/__init__.py`.
- The container's existing HTTP client pattern for internal endpoint calls.

**Test scenarios:**
- Happy path: `_ensure_workspace_ready` downloads composed files from the endpoint and writes them to `WORKSPACE_DIR`. No S3 PUT is issued from the container.
- Happy path: `write_memory(name="lessons.md", content="...")` invokes the endpoint with `path: "memory/lessons.md"` and returns success.
- Edge case: `write_memory` invoked with a name not in the enum → tool raises a validation error before any network call (Strands' type system enforces this; test verifies).
- Edge case: the LLM tries to construct a path via string concatenation (e.g., passes `"lessons.md/../GUARDRAILS.md"` as name) → rejected by the enum at the tool boundary.
- Error path: composer endpoint returns 5xx → `_ensure_workspace_ready` retries N times then surfaces a clear error to the caller (no silent degradation).
- Integration: agent invokes `write_memory`, the file is visible in the admin UI via the composer as `{source: "agent-override"}`.
- Integration: bootstrap no longer leaves an S3 object at `{agent}/workspace/SOUL.md` after first boot if the agent had no prior overrides.

**Verification:**
- Manual check: spin up an agent container, observe that S3 is not written to during bootstrap.
- `write_memory` tool appears in the agent's tool list and writes successfully.

---

- [ ] **Unit 8: `createAgentFromTemplate` — drop copy-on-create; initialize pinned versions**

**Goal:** Remove the `copyTemplateWorkspace` call at line 103-107 of `createAgentFromTemplate.mutation.ts`. New agents start with an empty S3 prefix and rely on the composer for reads. Populate `agents.agent_pinned_versions` with the content hashes of the template-base guardrail-class files at create time.

**Requirements:** R4, R6, R8a, R8c

**Dependencies:** Unit 1, Unit 4

**Files:**
- Modify: `packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts`
- Modify: `packages/api/src/lib/workspace-copy.ts` (deprecate `copyTemplateWorkspace`; keep `listTemplateFiles`)
- Create: `packages/api/src/lib/pinned-versions.ts` (exports `initializePinnedVersions(tenant, templateSlug)`)
- Test: `packages/api/src/__tests__/create-agent-pinned-versions.test.ts`

**Approach:**
- `initializePinnedVersions` iterates the guardrail-class set (`GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`), fetches each file via the composer at the template level (no agent context — the resolved content is the template base), SHA-256s it, and returns a `Record<string, string>` suitable for `agent_pinned_versions`.
- `createAgentFromTemplate` inserts the agent row with `agent_pinned_versions` populated; skips `copyTemplateWorkspace`.
- Manifest regeneration still runs — it just reflects an empty agent prefix now.

**Execution note:** None — straightforward resolver edit.

**Patterns to follow:**
- `createAgentFromTemplate.mutation.ts` current structure — keep skills/KB/MCP/email copy intact.

**Test scenarios:**
- Happy path: creating an agent from a template populates `agent_pinned_versions` with 3 entries keyed by the guardrail-class file names.
- Happy path: the agent's S3 prefix is empty immediately after creation (no forked copy).
- Happy path: reading IDENTITY.md for the new agent via the composer returns the template-level content (no agent override exists).
- Edge case: template has no custom `GUARDRAILS.md` (inherits from defaults) → pinned hash points at the defaults content; no error.
- Edge case: template has a custom `PLATFORM.md` → pinned hash captures the template version, not defaults.
- Integration: subsequent `updateAgent` with a human assignment writes USER.md (Unit 6) into the empty prefix successfully.

**Verification:**
- New agents created via the admin UI show correct `[inherited]` state across the board and correct pinned hashes in `agents.agent_pinned_versions`.
- `copyTemplateWorkspace` is no longer called from any production code path.

---

### Phase 4 — Admin UI and migration

- [ ] **Unit 9: Admin UI overlay badges, actions, and accept-update flow**

**Goal:** Update both the agent workspace tab and the agent-template workspace tab to render `[inherited]`/`[overridden]` badges, show `[template update available]` on pinned files, and offer override / revert / accept-update actions with diff preview. Add `acceptTemplateUpdate` GraphQL mutation.

**Requirements:** R8, R8a, R8b, R8d, R14, R15, R16

**Dependencies:** Unit 4, Unit 5

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`
- Create: `apps/admin/src/components/WorkspaceFileBadge.tsx`
- Create: `apps/admin/src/components/AcceptTemplateUpdateDialog.tsx` (includes a simple monaco-diff view)
- Create: `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/templates/acceptTemplateUpdateBulk.mutation.ts`
- Modify: `packages/api/src/graphql/schema.ts` (register both mutations)
- Test: `apps/admin/src/__tests__/workspace-file-badge.test.tsx`
- Test: `packages/api/src/__tests__/accept-template-update.test.ts`

**Approach:**
- Tree view renders each file with a badge derived from the `source` field returned by `composeList`.
- Clicking an inherited file opens the editor; the first edit shows a confirmation ("You are creating an agent-scoped override of this file. The template base will no longer flow through to this agent for this file."). On confirm, the save PUTs to the agent prefix.
- `acceptTemplateUpdate` mutation: takes `{agentId, filename}` where filename is in the pinned-class set. Requires the caller to be an authenticated admin of the agent's tenant (same `resolveCallerTenantId` + admin-role check the rest of the agent-mutation resolvers use); returns 403 otherwise. Action: fetch the current defaults/template content, SHA-256 it, update `agent_pinned_versions[filename]` to the new hash, and delete any agent-scoped override of that file.
- `acceptTemplateUpdateBulk` mutation: **required at enterprise scale** — takes `{templateId, filename, tenantId?}` and applies the accept-update to every agent using that template (optionally scoped to one tenant). Returns a per-agent success/failure report. Without this, accepting a GUARDRAILS.md update across 100 agents per tenant is 100 clicks — unusable. The mutation runs accepts in batches with `If-Match` ETag guards so concurrent admin edits on individual agents surface as conflicts rather than silent clobber.
- Diff preview: monaco's built-in diff editor, comparing current pinned content to latest template content.
- Template workspace tab: uses the composer to show the union of template-scoped + defaults-passthrough files, badged to indicate which are template-level vs inherited from defaults.

**Execution note:** For the admin-UI interaction-state coverage flagged in the design-lens review, include empty-state copy for "no defaults seeded yet" (shouldn't happen post-Unit 3 but defensive) and error-state for composer failures.

**Patterns to follow:**
- Existing split-pane editor UX in `$agentId_.workspace.tsx`.
- Existing GraphQL mutation resolver shape (copy from `syncTemplateToAgent.mutation.ts`).

**Test scenarios:**
- Happy path: tree view renders badges correctly for an agent with mixed inherited / overridden files.
- Happy path: clicking `[template update available]` on `GUARDRAILS.md` opens the diff; accepting updates `agent_pinned_versions` and removes any agent override.
- Happy path: `override` action on an inherited file opens the editor pre-populated with the inherited content; saving creates an agent-scoped object.
- Happy path: `revert to template` on an overridden file deletes the agent-scoped object; next view shows `[inherited]`.
- Edge case: clicking accept-update when the template version hasn't actually changed → no-op, no network call.
- Edge case: attempting to override a pinned file — UI routes through accept-update instead of a blind PUT.
- Error path: composer returns 5xx → tree shows an error row per affected file with a retry button.
- Integration: accept-update on `GUARDRAILS.md` changes the agent's runtime behavior on the next invocation (covered by Unit 7's endpoint call; verify via e2e).

**Verification:**
- Manual walk-through: agent with no overrides → all badges say `[inherited]`; editing a live file creates an override; accept-update on a pinned file advances the pin.
- Template workspace tab no longer shows "0 files" for any template.

---

- [ ] **Unit 10: Migration of 4 existing agents (placeholder-aware comparator)**

**Goal:** One-shot migration that, for every existing agent (4 pre-onboarding; potentially 400+ if some tenants onboard onto copy-on-create before Unit 8 ships), reverse-substitutes known placeholders in every agent-scoped S3 object, compares to the template base, and deletes objects that match — converting "forked copy" to "inherited." Files that meaningfully differ are kept as overrides. Produces a dry-run report before any destructive action. Sized for enterprise scale: pagination, partial-failure resilience, resume-from-checkpoint.

**Requirements:** R17, R18

**Dependencies:** Unit 4, Unit 8

**Files:**
- Create: `packages/api/src/handlers/migrate-existing-agents-to-overlay.ts`
- Create: `packages/api/src/lib/placeholder-aware-comparator.ts`
- Test: `packages/api/src/__tests__/placeholder-aware-comparator.test.ts`

**Approach:**
- Handler paginates through `agents` in batches of 50 (`.limit(50).offset(cursor)`), writing a checkpoint cursor to S3 after each batch so a failure mid-run resumes instead of restarting.
- For each agent in the batch:
  1. List agent-scoped S3 objects under `{agent}/workspace/`.
  2. For each file, fetch agent content, fetch corresponding template-base content via composer (pre-substitution), reverse-substitute `{{AGENT_NAME}}` → agent.name, `{{HUMAN_NAME}}` → paired human's name.
  3. Compare normalized template-with-substitution to agent content. If equal → safe to delete (this file was a bootstrap fork, not a deliberate override). If differs → keep.
  4. **Ambiguous-name flag**: if `agent.name` is a common noun (shortlist: "Assistant", "Agent", "User", "Admin", "Bot", "Memory", case-insensitive), mark the agent's matches as `REVIEW_REQUIRED` in the report rather than auto-deleting — the comparator can over-match when the substituted token also appears in template prose.
  5. Build a dry-run report: per-agent per-file table showing `delete | keep | review-required` with a short diff summary for non-delete cases.
- First invocation: `--dry-run` mode. Writes report to S3 / logs; makes no deletes. Requires explicit second invocation with `--commit` to delete.
- **Recovery**: S3 object versioning must be enabled on the bucket before `--commit` (handler issues `GetBucketVersioning` as a preflight and aborts if versioning is Suspended or not enabled). The dry-run report plus S3 object versions is the recovery artifact; no separate audit log needed.
- Migration also populates `agent_pinned_versions` for agents created pre-Unit 8 (no pinning record). Hashes are computed against the **current** template-base content, with a note that this is the "as-migrated" baseline — post-migration, `[template update available]` badges only fire for subsequent template edits, not for historical drift between agent creation and migration time.

**Execution note:** Test-first on the comparator — placeholder-aware comparison is the single most bug-prone piece.

**Patterns to follow:**
- `bootstrap-workspaces.ts` handler shape.
- `feedback_verify_wire_format_empirically` — before `--commit`, curl the composer endpoint for each of the 4 agents and confirm the composed view matches the expected post-migration state.

**Test scenarios:**
- Happy path: agent's IDENTITY.md content is `"Your name is Marco..."` (from substituted template `"Your name is {{AGENT_NAME}}..."`, agent.name=Marco) → comparator recognizes this as a bootstrap fork and flags for deletion.
- Happy path: agent's IDENTITY.md content has an additional paragraph not in the template → comparator flags as meaningful override, keeps.
- Edge case: agent's USER.md has `{{HUMAN_NAME}}` already substituted to "Eric" (human A) but human_pair_id now points at human B. Comparator uses CURRENT pair's name for reverse-substitution → content doesn't match template, kept as override. Note: this is correct; Unit 6 will handle the reassignment rewrite on next assignment change.
- Edge case: agent has a file not present at the template level (e.g., an ad-hoc `NOTES.md`) → comparator keeps it as override.
- Error path: S3 LIST fails for one agent → handler logs and continues to the next agent; final report marks that agent as "migration failed, retry."
- Integration: `--dry-run` produces a report that `--commit` exactly executes.

**Verification:**
- Dry-run report reviewed by human operator before commit.
- After commit: the 4 agents' S3 prefixes contain only files that represent genuine overrides. Composer still returns the correct composed view for all 11 canonical paths.
- `agents.agent_pinned_versions` is populated for all 4 agents.

## System-Wide Impact

- **Interaction graph:**
  - GraphQL `updateAgent` mutation now has an S3 side effect on `human_pair_id` change.
  - GraphQL `createAgentFromTemplate` no longer copies S3 files but does initialize pinned versions.
  - New GraphQL `acceptTemplateUpdate` mutation.
  - `/internal/workspace-files` handler is the composition seam for admin UI and Strands runtime.
  - `agent-snapshot.ts` reads composed files for `agentVersions.workspace_snapshot`.
  - Strands runtime removes an S3 write; adds an HTTP call per personality file at bootstrap.
- **Error propagation:**
  - USER.md write failure → `updateAgent` fails; client sees a clear error. No silent divergence.
  - Composer read failure for a pinned file → fail closed (return error to caller). For live file → fall through to defaults with a warning log.
  - Strands bootstrap composer failure → retry N times then error; agent invocation fails rather than silently running with stale workspace.
- **State lifecycle risks:**
  - 4 existing agents go through a one-shot destructive migration (R18). Pre-migration backup: S3 object versioning is recommended on the bucket before Unit 10 commits. Audit log captures every delete.
  - Pinned-version hashes drift if the guardrail-class content is regenerated by the content author — every agent will show `[template update available]` at once. Expected on first content publish; operators walk through accepting for each agent.
- **API surface parity:**
  - `/internal/workspace-files` request shape changes (bodyless tenant, new response fields). The admin UI is the only current caller — updated in Unit 5. No external API consumers.
- **Integration coverage:**
  - End-to-end: create agent → assign human → observe USER.md populated → agent reads composed view at bootstrap → agent writes `memory/lessons.md` → admin UI sees override → revert → next read returns inherited content.
- **Unchanged invariants:**
  - `agents.template_id`, `agents.human_pair_id`, `agent_templates.slug` semantics unchanged.
  - `agentVersions.workspace_snapshot` schema and restore semantics unchanged (just the write path computes composed content now).
  - Sub-workspace primitive (`{workspace-slug}/CONTEXT.md`) is untouched.
  - Router / Strands profile system unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Placeholder-aware migration comparator has a bug that leaves some files permanently overridden | Test-first on the comparator (Unit 10 Execution note). `--dry-run` gate before commit. Audit log enables recovery. |
| Cross-tenant isolation regression in the composer (caller in tenant A reads from tenant B) | First failing test in Unit 4 verifies isolation. Tenant is derived from ctx, never from request body — enforced at handler boundary. |
| Prompt-injection via unsanitized placeholder values (user sets `name` to a control string) | `sanitizeValue` module; max-length cap; escape markdown structural chars; audit log on sanitization violations. |
| Strands bootstrap latency increases because each file is a separate HTTP call | Composer endpoint supports `list + get-batch` or returns file contents in a single `list` response; benchmark during Unit 7. |
| Per-user memory/wiki refactor (memory record `project_memory_scope_refactor`) makes `memory/*` agent-writable surface short-lived; refactor is more urgent at 100+ humans per tenant | Keep Unit 7's `write_memory` tool in the plan (user decided to keep full scope), but flag the coupling explicitly: the `memory/*.md` primitive shape is expected to reshape when per-user memory lands. Prioritize the memory-scope refactor plan soon after enterprise onboarding so the reshape cost doesn't grow linearly with agent count. Meanwhile, Unit 7's tool is shipped with the understanding that its interface may change. |
| Default content quality is not enterprise-ready by onboarding | Ship v1 using the existing prose in `packages/system-workspace/` + `packages/memory-templates/` + `DEFAULT_FILES` (already prose-quality). Eric does a content-review pass before enterprise onboarding; any tenant-specific overrides go in via the template workspace tab. Do NOT gate Phase 1 on content rewrite — the pipeline can ship with existing content and be iterated on. |
| Composer Lambda saturates at 400+ agent cold-start or mass-wakeup | Composer caching required in Unit 4 (keyed on composed-ETag of all base layers). Batch endpoint returns content for all 11 files in one call. Per-tenant rate limit on /internal/workspace-files. |
| Bulk accept-update needed but missing → 100 clicks per tenant per guardrail edit | `acceptTemplateUpdateBulk` in Unit 9 accepts the update across every agent in a tenant using that template. Covered in Unit 9 spec. |
| Unit 10 migration assumed 4 agents but some tenants onboard before it runs → 400+ agents to migrate | Migration paginates in batches of 50 with checkpoint cursor; resume-from-failure; ambiguous-name flag for common-noun agent names. Covered in Unit 10 spec. |
| `acceptTemplateUpdate` races with concurrent admin edits to the same pinned file | S3 `If-Match` on PUT/DELETE; conflict returns a clear error and requires the admin to reload. |
| USER.md write fails after the DB commits `human_pair_id` change | Transactional outbox pattern (write S3, then commit DB), OR synchronous S3 write inside the resolver with DB rollback on failure. Unit 6 picks one. |
| Removing the Strands S3 write in Unit 7 breaks a production agent mid-deploy | Ship Unit 7 after the composer endpoint is live (Unit 5 merged + deployed). Include a fallback: if the endpoint is unreachable, the container falls back to direct S3 read (not substitute-and-write) for one release cycle. |
| Schema migration (Unit 1) fails on a tenant with a very large `user_profiles` table | Column additions with NULL default are non-blocking in Postgres. No risk on the scale of this workload. |

## Documentation / Operational Notes

- **Rollout order**: Unit 1 → Unit 2 → Unit 3 (ship Phase 1). Validate "0 files" state is resolved in dev + prod. → Unit 4. → **Units 5 and 7 ship in the same PR/deploy (atomic)** — Unit 5's removal of the `API_AUTH_SECRET` bearer auth breaks the Strands container's current internal-endpoint path, and Unit 7 is the unit that switches Strands to the new auth. They cannot land in either order without a broken window. During transition, the Phase 2 preflight disables the rogue S3 write-back in `_bootstrap_personality_files` (server.py:208-214) at the same time the new composer endpoint goes live, so every agent that cold-starts after Phase 2 stops creating new forks. → Unit 6 and Unit 8 can land in any order once Phase 2+7 are live. → Unit 9. → Unit 10 (migration of existing agents — last, after composer + UI are stable).
- **Drizzle migration numbering**: Unit 1's migration is filename-allocated at merge time, not hardcoded to `0017`. Active plans `2026-04-21-004-feat-wiki-place-capability-plan.md` and `2026-04-21-005-feat-wiki-place-capability-v2-plan.md` also target `0017`. The implementer renames to the next available integer when the PR is rebased for merge.
- **No CI migration runner**: the repo has no automated migration apply step (per plans 004 and 005' observation — migration 0016 had to be applied manually via `psql` after merge). Unit 1's PR description must include the exact `psql -f packages/database-pg/drizzle/NNNN_agent_workspace_overlay.sql` command, and Phase 3 Lambda deploys (Units 6, 8) must not ship to prod until the migration is applied.
- **Deploys**: all Lambda changes go via PR merge to main (per `feedback_graphql_deploy_via_pr`). No direct `aws lambda update-function-code`.
- **Monitoring**:
  - New CloudWatch alarm: composer error rate > 1% / 5 min.
  - New alarm: placeholder sanitization violations (log pattern match).
  - New alarm: `updateAgent` S3 PUT failures.
  - Strands bootstrap latency metric for the new HTTP path.
- **Content authoring handoff**: when Unit 2 merges with placeholder content, open a tracking issue for final copy review owned by a named human editor. Do not ship to production until that issue closes.
- **`/ce:compound` passes**: schedule one after Phase 2 (composer + sanitization) and one after Unit 10 (placeholder-aware migration). Novel territory per `learnings-researcher` findings.

## Phased Delivery

### Phase 1 — Foundation (ships standalone)
- Unit 1: schema migrations
- Unit 2: workspace-defaults package
- Unit 3: seed `_catalog/defaults/` across tenants

**Value delivered**: admin "0 files" state is resolved for every template going forward. Existing agents continue to operate under copy-on-create; no behavior change for them yet.

### Phase 2 — Overlay engine
- Unit 4: composer library
- Unit 5: internal endpoint + snapshot rewrite

**Value delivered**: composer is usable but not yet reaching agent runtimes; admin UI starts showing composed views.

### Phase 3 — Integration
- Unit 6: USER.md on assignment
- Unit 7: Strands runtime switch
- Unit 8: `createAgentFromTemplate` no-copy + pinned init

**Value delivered**: new agents fully live on the overlay model; template edits reach them.

### Phase 4 — UI and migration
- Unit 9: admin UI badges + accept-update
- Unit 10: migration of 4 existing agents

**Value delivered**: operators can observe and control inheritance; all 4 existing agents join the overlay model.

## Sources & References

- **Origin document**: [docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md](../brainstorms/2026-04-21-agent-workspace-files-requirements.md)
- **Memory records consulted**:
  - `memory/feedback_avoid_fire_and_forget_lambda_invokes.md`
  - `memory/feedback_oauth_tenant_resolver.md`
  - `memory/feedback_graphql_deploy_via_pr.md`
  - `memory/feedback_verify_wire_format_empirically.md`
  - `memory/feedback_pnpm_in_workspace.md`
  - `memory/project_memory_scope_refactor.md`
  - `memory/feedback_workspace_user_md_server_managed.md` (written during the brainstorm)
- **Relevant code**:
  - `packages/api/src/lib/workspace-copy.ts`
  - `packages/api/src/lib/agent-snapshot.ts`
  - `packages/api/workspace-files.ts`
  - `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts`
  - `packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts`
  - `packages/api/src/graphql/resolvers/templates/syncTemplateToAgent.mutation.ts`
  - `packages/api/src/handlers/bootstrap-workspaces.ts`
  - `packages/agentcore-strands/agent-container/server.py`
  - `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`
  - `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`
  - `packages/database-pg/src/schema/agents.ts`
  - `packages/database-pg/src/schema/core.ts`
  - `packages/database-pg/drizzle/`
