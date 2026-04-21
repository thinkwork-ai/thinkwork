---
date: 2026-04-21
topic: agent-workspace-files
---

# Agent Workspace Files: Defaults, Inheritance, and Human Sync

## Problem Frame

Workspace files (markdown files like `IDENTITY.md`, `USER.md`, `GUARDRAILS.md`) define most of what an agent is. Today ThinkWork has the plumbing to copy files from `defaults/workspace/` → template → agent, and it bootstraps `{{AGENT_NAME}}` / `{{HUMAN_NAME}}` substitution at container start. But three practical gaps make the system effectively broken for operators:

1. **The `defaults/workspace/` S3 prefix is empty**, so every template (including "Default") shows **0 files** in the admin UI. Nothing cascades because nothing is seeded.
2. **Agents are forked at creation time** — once `copyTemplateWorkspace()` runs, the agent's files are fully independent. Template improvements don't reach existing agents without a manual `syncTemplateToAgent` call, and there is no way to see whether an agent's file is "still from the template" or "diverged."
3. **Assigning a human to an agent doesn't update `USER.md`.** `{{HUMAN_NAME}}` is substituted at runtime bootstrap in memory, but never persisted to S3, and only `name` is substituted — not email, title, or timezone. The admin UI never shows the human's real identity inside the agent's `USER.md`.

The goal is a single coherent initiative that (a) seeds a high-quality default workspace, (b) converts the copy-on-create model to live overlay inheritance, and (c) persists a structured assignment block into `USER.md` when a human is paired with an agent.

## Visual: Read-Time Overlay Resolution

```
Request: read agent's workspace files
           |
           v
   For each canonical file path:
     override exists at {agent}/workspace/{path}?
        |
        +-- yes --> serve agent override    [badge: overridden]
        |
        +-- no  --> serve template base      [badge: inherited]
                     from _catalog/{template}/workspace/{path}
                     (or _catalog/defaults/workspace/{path} if template has none)

Write path (admin or agent runtime):
     write lands ONLY in {agent}/workspace/{path}
     ==> file becomes "overridden"; template base is untouched

Revert (admin UI):
     delete the object at {agent}/workspace/{path}
     ==> file reverts to "inherited"; template base flows through again
```

## Requirements

**Seed Defaults**

- R1. A canonical set of default workspace files lives under `_catalog/defaults/workspace/` per tenant, seeded with opinionated starter content. File set: `SOUL.md`, `IDENTITY.md`, `USER.md`, `GUARDRAILS.md`, `MEMORY_GUIDE.md`, `CAPABILITIES.md`, `PLATFORM.md`, `ROUTER.md`, `memory/lessons.md`, `memory/preferences.md`, `memory/contacts.md`.
- R2. Default files support placeholder variables. At minimum: `{{AGENT_NAME}}`, `{{HUMAN_NAME}}`, `{{HUMAN_EMAIL}}`, `{{HUMAN_TITLE}}`, `{{TENANT_NAME}}`. For most files, substitution happens at **read-time composition**, not at seed time (so updating a user's email updates what the agent sees). The exception is USER.md, whose substitution happens at **write time** during the assignment event (R9) — see the "Human Assignment → USER.md" group. Substituted values are user-controlled (name, title, email) and must be sanitized before insertion: strip or escape characters that are structurally significant to the target context — markdown structure and prompt-control sequences. Unsanitized values are a prompt-injection surface: a user whose `name` is "Ignore previous instructions…" should not be able to hijack the agent's system prompt.
- R3. The default file set is versioned as source-controlled content in the repo and deployed into every tenant's `_catalog/defaults/workspace/` on tenant creation and on a re-seed action.

**Template → Agent Inheritance (Live Overlay)**

- R4. Agents store **only overridden files** under `{agent}/workspace/`. Non-overridden files resolve to the template base at read-time.
- R5. Template base resolution chains: `{agent}/workspace/{path}` → `_catalog/{template}/workspace/{path}` → `_catalog/defaults/workspace/{path}`. First hit wins. The S3 prefix at every level is constructed server-side from the authenticated caller's tenant, never from caller-supplied input, so the chain cannot walk into another tenant's `_catalog/`. Template and agent identifiers are validated against DB rows scoped to that tenant before use in the S3 key.
- R6. Writing to any file (from admin UI or agent runtime) creates/updates the object at `{agent}/workspace/{path}`. The template base is never mutated by an agent-scoped action.
- R7. The admin UI and the Strands runtime both receive the **composed** workspace (overlay applied), not raw S3 contents. No caller needs to implement the chain themselves.
- R8. A "revert to template" action deletes the agent-scoped override object. The file then resolves to the template base on the next read.

**Propagation Policy by File Class**

Not every file should propagate the same way. The cost of a bad change to `GUARDRAILS.md` is fleet-wide safety regression on the next invocation; the cost of a bad change to `IDENTITY.md` is usually cosmetic. The inheritance model splits files into two classes:

- R8a. **Pinned files** — `GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`. Each agent records which template-base version of these files it was created against (or most recently accepted). Template edits to pinned files do **not** propagate automatically. The admin UI surfaces a "Template update available" badge on the agent's workspace tab when the pinned version is behind; an explicit per-agent "accept update" action (with diff preview) advances the pin and starts using the new base.
- R8b. **Live files** — everything else (`SOUL.md`, `IDENTITY.md`, `MEMORY_GUIDE.md`, `ROUTER.md`, `memory/*`). These follow R4–R5 unchanged: non-overridden reads fall through to the current template base on every read. `USER.md` is always agent-scoped (R11), so propagation policy doesn't apply to it.
- R8c. The pinned-version record is per-agent per-file (e.g., `agent_pinned_versions: { "GUARDRAILS.md": "<s3-version-id-or-content-hash>", ... }`). S3 object versioning or a stored content hash at accept-time is the reference; planning should pick one.
- R8d. "Revert to template" (R8) on a pinned file reverts to the file's **pinned version**, not the latest template content. To move to the latest template content, the operator uses "accept update" on that file, which implicitly reverts any agent-scoped override as well.

**Human Assignment → USER.md**

USER.md is **entirely server-managed** by the assignment event. It is not a free-form file with a managed region — the *whole file* is rewritten on every assignment. Per-agent notes about the human (working style, preferences, context) belong in `memory/preferences.md` or `memory/contacts.md`, not USER.md.

- R9. When `agents.human_pair_id` is set, changed, or cleared via `updateAgent`, the server reads the template USER.md (from `_catalog/{template}/workspace/USER.md` or `_catalog/defaults/workspace/USER.md`), substitutes the human's fields (`{{HUMAN_NAME}}`, `{{HUMAN_EMAIL}}`, `{{HUMAN_TITLE}}`, etc.), and writes the resulting file in full to `{agent}/workspace/USER.md`. This write happens synchronously within the `updateAgent` request.
- R10. The substituted fields are: name, email, title, timezone, pronouns (pulled from the `users` table and the user's profile). Unknown/blank fields render as `—` rather than omitted, so the shape is stable across users. If `human_pair_id` is cleared, the values are replaced with placeholders and the file is rewritten; the override still exists.
- R11. USER.md in the agent's workspace **always overrides** the template — once R9 has fired at least once, USER.md is always agent-scoped. This is by design: USER.md is inherently per-agent-and-per-human. Placeholder substitution for USER.md happens at **write time** (during the assignment event), not at read time. Read-time `{{HUMAN_*}}` substitution (R2) still applies to other files (IDENTITY.md, SOUL.md, etc.) that reference the human.
- R11a. Before first assignment (i.e., `human_pair_id` is null on agent create), USER.md follows the normal overlay chain: it inherits the template's USER.md with placeholders unsubstituted. First assignment converts it into an agent-scoped override permanently.

**Agent Self-Modification**

- R12. The Strands runtime has a workspace-write tool scoped to `memory/lessons.md`, `memory/preferences.md`, `memory/contacts.md` only. The tool's parameter is a **basename enum** (one of those three values), not a path — no path traversal, `..` sequences, URL-encoded separators, or `/` characters are interpretable by the tool. The server-side handler rejects any input outside the enum, canonicalizes the S3 key to `{agent}/workspace/memory/{basename}`, and logs rejected attempts for audit. Writes via this tool produce agent-scoped overrides (per R6). (Scope extensibility — if future `memory/*` files become writable — is tracked as a deferred question; the enum shape keeps the v1 boundary provable by construction.)
- R13. All other workspace files are read-only from the agent runtime. Authoring/editing them happens via the admin UI (human-driven) or via template edits that flow down through inheritance.

**Admin UI**

- R14. The agent's workspace tab lists the composed file set with a visible `[inherited]` or `[overridden]` indicator per file, and shows which source (template vs. defaults) an inherited file came from. Pinned-class files (R8a) additionally surface a "Template update available" badge when the agent's pinned version is behind the current template base.
- R15. Each inherited file offers an "override" action (starts an agent-scoped copy seeded from the template). Each overridden file offers a "revert to template" action (per R8). Pinned files with a pending template update offer an "accept update" action with a diff preview against the currently-pinned version (per R8a).
- R16. The agent-template workspace tab (the screen currently showing "0 files" for the Default template) always lists the template's file set including files inherited from `defaults/` — so template authors can see the full composed template, not just template-scoped overrides.

**Migration / Backfill**

- R17. For tenants that already exist, a one-shot job seeds `_catalog/defaults/workspace/` with the canonical content and writes the workspace manifest.
- R18. For the 4 existing agents created under the copy-on-create model, a one-shot migration identifies files whose content — **after reverse-substituting known placeholders** (`{{AGENT_NAME}}`, `{{HUMAN_NAME}}`, etc.) — matches the template base, and removes them from the agent's S3 prefix, converting those files from "forked copy" to "inherited." Files that meaningfully differ are kept as overrides. A naive byte-identical comparator is insufficient because the existing bootstrap path already substituted placeholders into the agents' S3 objects (see Dependencies). This migration is **load-bearing for the propagation success criterion** — without it, the 4 existing agents remain permanently forked and template edits never reach them.

## Success Criteria

- Every newly-created template shows a populated workspace tab (no "0 files" state) without the template author writing a single file.
- An edit to a **live-class** file in `_catalog/defaults/` (e.g., `SOUL.md`, `IDENTITY.md`, `MEMORY_GUIDE.md`) is observable in every existing agent that has not overridden that file on the next admin-UI view and the next agent invocation — without running any migration.
- An edit to a **pinned-class** file in `_catalog/defaults/` (e.g., `GUARDRAILS.md`) does **not** change the behavior of any existing agent until an operator explicitly accepts the update per agent. Every agent with a behind-latest pinned version surfaces a "Template update available" badge in the admin UI.
- Assigning a human to an agent populates the agent's `USER.md` managed block with the human's name, email, title, timezone, and pronouns, visible in the admin UI within the same request.
- Re-assigning the same agent to a different human fully rewrites USER.md in S3 with the new human's values; any prior content in USER.md is intentionally replaced. Per-agent notes about the human live in `memory/preferences.md` / `memory/contacts.md` and are unaffected.
- The agent runtime can write to `memory/lessons.md` and have that change visible in the admin UI and on the next bootstrap.
- No agent can write to `GUARDRAILS.md`, `PLATFORM.md`, or `CAPABILITIES.md` via its runtime tools.

## Scope Boundaries

- Not addressing sub-workspaces (the "Workspaces" primitive shown on the Marco agent screenshot — `{workspace-slug}/CONTEXT.md`). Those are separate from workspace files and out of scope for this initiative.
- Not redesigning the Strands router profile system. `ROUTER.md` is a seed file, not a structural change.
- Not introducing a visual diff tool for overrides vs. template base. The admin UI only needs to indicate state (inherited/overridden) and support revert — not render a diff.
- Not introducing multiple archetypal default sets (delegator, analyst, etc.). One opinionated default, with per-template customization via overrides.
- Not changing how memory/wiki primitives relate to workspace files. `memory/lessons.md` etc. remain prose files shaped by the agent; they do not replace the wiki/memory systems.
- Snapshot *semantics* are preserved (`agentVersions.workspace_snapshot` still captures the composed workspace at version time), but snapshot *implementation* must change: the snapshot path previously read `{agent}/workspace/` directly and captured everything because everything was copied; under overlay it must invoke the composer before persisting, or snapshots silently become override-only and version restore/diff/audit regress. This is an implementation requirement for planning, not a scope exclusion.

## Key Decisions

- **Live overlay at read-time for most files; pinned propagation for safety-critical files**: Live overlay eliminates drift bugs and manual sync burden for the files where cosmetic drift is the risk (IDENTITY, SOUL, MEMORY_GUIDE, ROUTER, memory/*). Pinning the guardrail-class files (GUARDRAILS, PLATFORM, CAPABILITIES) avoids the failure mode where a single bad save to defaults silently weakens every agent's safety on the next invocation — those files instead require per-agent explicit accept with a diff preview. Trade-off: every workspace read is an overlay composition instead of a single S3 object fetch, and agents now carry a per-file pinned-version record. Acceptable because reads are already listing-bounded and the pinned record is small.
- **One opinionated default set, not multiple archetypes**: Quality compounds in one place. Templates express domain-specific behavior by overriding `IDENTITY.md` and adding new files, not by picking an archetype.
- **USER.md is fully server-managed; write happens at assignment time**: USER.md is per-agent-and-per-human by nature — expecting it to inherit from the template like IDENTITY.md doesn't match what the file is. On every assignment event, the server substitutes the template USER.md and writes the whole file to the agent's S3 prefix. No managed-block parsing, no read-time composition of USER.md. Per-agent notes about the human (working style, preferences) live in `memory/preferences.md`/`memory/contacts.md`, not USER.md.
- **Runtime agent can write only `memory/*`**: Matches how those files are already used; keeps the blast radius small; prevents the agent from quietly editing its own guardrails.
- **Placeholder substitution at read-time, not at seed time**: Ensures that a user's name/email change propagates without re-seeding or re-syncing anything.

## Dependencies / Assumptions

- Verified against `packages/database-pg/src/schema/core.ts`: the `users` table exposes `name`, `email`, `phone`, `image`; `user_profiles` adds `display_name`, `theme`, `notification_preferences`. There is **no** `title`, `timezone`, or `pronouns` column. The earlier assumption that `title` existed was a misread — the `title` field in `packages/api/src/handlers/chat-agent-invoke.ts` is a thread/push-notification title, not a user profession. R10's extended fields are therefore a **prerequisite schema migration**, not an assumption: planning must add `title`, `timezone`, `pronouns` (or an equivalent JSONB profile payload) before R10 can render them. Until then, only `name` and `email` are renderable.
- The Strands runtime today writes placeholder-substituted content back to S3 inside `_bootstrap_personality_files()` (`packages/agentcore-strands/agent-container/server.py:207-211`). Under the overlay model, this write path **must be removed** — otherwise every agent's first container start persists substituted personality files as agent-scoped overrides, permanently disabling inheritance for those files. This also means R18's comparator must be placeholder-aware (reverse-substitute before comparing) to avoid leaving the existing 4 agents permanently overridden due to that legacy write.
- Composition will require a non-trivial rewrite of the existing `POST /internal/workspace-files` handler (`packages/api/workspace-files.ts`): the current handler resolves every action against a single `tenants/{tenantSlug}/agents/{instanceId}/workspace/` prefix, has no DB client, and has no notion of the agent's template. The "right composition seam" assumption therefore means extending this Lambda with a template resolver and per-file `[inherited]|[overridden]` payload, or introducing a new GraphQL resolver. Architectural choice for planning; this is a handler rewrite, not a touch-up.
- Architectural choice for planning: whether overlay composition lives at the API/GraphQL layer (single composer, two callers) or at the S3 read path (composer duplicated in TypeScript for admin and Python for Strands). Bias toward server-side composition so the runtime stays simple and the composer does not diverge between implementations.
- **Content authoring is a parallel sub-track, not a platform task.** The 11 seed files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `GUARDRAILS.md`, `MEMORY_GUIDE.md`, `CAPABILITIES.md`, `PLATFORM.md`, `ROUTER.md`, `memory/lessons.md`, `memory/preferences.md`, `memory/contacts.md`) define the default voice, tone, and safety posture of every ThinkWork agent. Planning should identify a named owner for initial content and a review step before the content ships to production — the engineering plan delivers the pipe; the content is its own deliverable.
- **Overlap with paused per-user memory/wiki refactor.** R12 makes per-agent `memory/*.md` files agent-writable. The broader memory/wiki primitive is concurrently being re-scoped from per-agent to per-user (see memory record `project_memory_scope_refactor`). If user-scoped memory will eventually subsume these files, per-agent writable memory prose is a short-lived shape. Planning should verify the interaction: either confirm this initiative is independent of the refactor, or sequence behind it. Dogfood signal will surface quickly — if agents treat `memory/preferences.md` as duplicate-of-wiki, it is the wrong shape.

## Outstanding Questions

### Deferred to Planning

- [Affects R4-R7][Technical] Where does overlay composition run — at the API/GraphQL layer, as a shared library in `packages/api/src/lib/workspace-overlay.ts`, or at the S3 read path via a lightweight composer in the Strands runtime? Planning should propose one, with bias toward server-side composition so the runtime stays simple.
- [Affects R2][Technical] Exact placeholder variable set and source-of-truth for each. Enumerate from the `users` and `tenants` tables during planning.
- [Affects R9-R11][Technical] Where does the assignment-block writer live — inside `updateAgent.mutation.ts`, or as a domain service called from it (and from any future assignment surface)? Planning should pick based on whether other assignment entry points are likely.
- [Affects R17-R18][Needs research] Precise backfill plan: exact object-copy commands for the 4 existing agents, whether to gate this behind a feature flag, and whether to produce a dry-run report before the destructive copy-removal step.
- [Affects R14-R15][Technical] Admin UI rendering of inherited vs. overridden badges and the revert action UX. Design detail for planning, not a product decision.
- [Affects R16][Needs research] Whether the agent-template workspace tab's current "0 files" state is strictly because `defaults/` is empty, or because the template's own workspace was never populated by `copyDefaultsToTemplate()` on that specific template. Worth verifying against the actual S3 prefix for the existing "Default" template before writing the migration.
- [Affects R5-R7][Technical] Cache invalidation semantics. If composed views are cached (manifest-ETag or otherwise), an edit to `_catalog/defaults/GUARDRAILS.md` must invalidate every dependent agent's cache on the next read — otherwise the "instant propagation" success criterion is false in practice. Planning must define cache-key granularity, dependency tracking from base→composed, or an acceptably short TTL. The current manifest ETag is agent-scoped and will *not* observe base-layer edits.
- [Affects R5, R8][Technical] Template-delete and template-version semantics. When a template row is deleted while agents reference it, does the chain fall through to defaults silently (behavioral regression with no operator preview), does delete cascade/migrate agents, or is delete blocked while agents reference the template? "Revert to template" when the template has since been edited also needs a target version policy (latest? pinned-at-agent-create?).
- [Affects R5-R7][Technical] Error-handling policy for composition failures. If the template-level S3 GET fails mid-compose (transient S3 error, throttling), does the composer fail closed (error to caller), fall through to defaults (risk: silently degrades IDENTITY.md), or retry? Different answers for admin-UI vs. Strands-runtime callers.
- [Affects R9][Technical] Should USER.md write be transactional with the `updateAgent` DB update of `human_pair_id`? If the S3 write fails after the DB commit, `human_pair_id` points at a human but USER.md still reflects the prior assignment. Planning should pick: (a) outbox/retry so S3 write is eventually consistent with the DB, (b) best-effort S3 write + a reconciliation job, or (c) expose a "resync USER.md" admin action as the recovery path.

## Next Steps

-> `/ce:plan` for structured implementation planning
