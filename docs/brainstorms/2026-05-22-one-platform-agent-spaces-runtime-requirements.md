---
date: 2026-05-22
topic: one-platform-agent-spaces-runtime
---

> **Partial supersession (2026-05-24):** Sections R6, R10, R17-R19, R20, R21, R22, and R24 are superseded by `docs/brainstorms/2026-05-24-folder-is-the-agent-thinkwork-alignment-requirements.md`. See that doc's Requirements section for the canonical replacement.

# One Platform Agent + Spaces Runtime

## Summary

Collapse ThinkWork's agent runtime to one platform agent per tenant whose workspace IS the agent — subagents are folders inside that workspace, not separate DB rows. Each agent turn runs against a workspace rendered per `(agent, space, user)` tuple, with the active Space layering its `SPACE.md`, skills, tools, Hindsight memory bank, and email identity on top of the agent baseline, and the invoking user layering `USER.md` plus their own Hindsight bank. Recall fans across user + space banks; writes default to the active Space with explicit `scope='user'` opt-out. Email moves from per-agent vanity addresses to per-Space addresses, with the existing PRD-14 reply-token mechanism preserved and a per-Space `email_triggers_enabled` toggle gating tenant-user cold contact.

---

## Problem Frame

ThinkWork has cycled through several agent-runtime shapes in flight:

1. **Per-user serverless AgentCore agent** with an S3-injected workspace.
2. **Always-on ECS "computer"** with EFS-backed workspace, offloading actual work to AgentCore agents (a "thin computer + worker agent" split).
3. **Shared computer → offloaded agents** with USER.md as the per-user context injection point.
4. **Today** — back to serverless AgentCore, no ECS "computer," Spaces introduced as the new context primitive but only half implemented.

The half-implemented state is the cost. The codebase still carries the entanglement of every prior shape: a `agents` table designed for per-user/per-role multiplicity, a `space_agent_assignments` table that exists because agents and spaces were modeled as orthogonal entities, a `spaces` table with ~8 legacy fields the new admin UI no longer reads, `apps/computer`-named code that's mid-rename to `apps/spaces`, system contracts living in container-bundle paths rather than the workspace, USER.md treated as a per-agent file instead of a per-user file, Hindsight memory scoped only to the user with no space-level bank, and no rendered per-turn workspace anywhere — the runtime still reads a workspace materialized once at agent-create time. Multiple in-flight brainstorms and plans (2026-05-19 through 2026-05-22) keep adding to specific surfaces without settling the underlying runtime model. The 2026-05-20 brainstorm landed on "agents are durable role/capability actors plus Spaces inject per-turn context," which keeps the per-agent multiplicity that the original product motivation no longer needs.

Operators, planners, and contributors cannot answer the simplest model question — "what is an agent?" — without choosing one of three different in-flight answers. That friction now exceeds the cost of committing to one model and pulling every adjacent in-flight plan into it.

---

## Actors

- A1. Tenant admin: edits the platform agent's workspace baseline (identity, guardrails, baseline skills, baseline MCP) and authors Spaces.
- A2. Space author: configures a Space — name, `SPACE.md`, space-level skills, space-level tool/MCP additions and restrictions, members for private spaces.
- A3. End user: opens or creates a thread inside a Space, mentions subagents, calls memory tools that read/write per the active Space's privacy boundary.
- A4. Platform renderer: composes the agent baseline + active Space + invoking user into a per-tuple rendered workspace, caches it, invalidates on source change.
- A5. Agent runtime (AgentCore Strands container): syncs the rendered workspace path to `/tmp/workspace`, builds the system prompt, runs the turn — no awareness of how the workspace was composed.
- A6. Automation source (scheduled job, connector webhook, subagent delegation): invokes the agent without a human user; the renderer collapses the user slot gracefully.
- A7. External email correspondent: a human reachable by email who participates in agent-initiated email threads (token-bearing replies) or, when registered as a tenant user, cold-contacts a Space via its email address.

---

## Key Flows

- F1. Tenant admin edits the platform agent baseline
  - **Trigger:** Tenant admin opens the platform agent workspace editor in admin.
  - **Actors:** A1, A4
  - **Steps:** Admin edits `SOUL.md`, `IDENTITY.md`, `GUARDRAILS.md`, baseline `skills/`, or any subagent folder (e.g., `sql/CONTEXT.md`). On save, source files land in the tenant's agent-baseline S3 prefix. The renderer's invalidation handler enumerates all rendered tuples `(this_agent, *, *)` and marks them stale.
  - **Outcome:** Next turn in any `(this_agent, space, user)` tuple rerenders before sync; turns in already-rendered-then-stale tuples re-cache lazily on first hit.
  - **Covered by:** R1, R2, R3, R10, R15

- F2. Space author creates and configures a Space
  - **Trigger:** Tenant admin or Space author creates a Space and edits its workspace tree.
  - **Actors:** A2, A4
  - **Steps:** Space author edits `SPACE.md` (the Space's startup instructions, mandatory), `skills/` folder for space-additive skills, `TOOLS.md` / `MCP.md` for space-additive built-ins and MCP servers, and (when present) a `policy/` declaration for tool/skill restrictions. On private spaces, author adds members. On save, source files land in the tenant's space S3 prefix. Renderer invalidates `(*, this_space, *)` tuples. A Hindsight bank is provisioned for the Space on first create.
  - **Outcome:** Future turns inside this Space see the Space's `SPACE.md`, additive tools, and Space Hindsight bank in their rendered workspace.
  - **Covered by:** R4, R5, R6, R7, R11, R12, R15, R16

- F3. End user starts a thread in a Space and mentions a subagent
  - **Trigger:** End user opens a thread in `general` Space (tenant default) or a non-default Space (e.g., `finance`), types `@sql`.
  - **Actors:** A3, A4, A5
  - **Steps:** Server resolves the `(tenant_id, space_id, user_id)` tuple, asks the renderer for the rendered workspace path (cache hit or fresh render). Runtime container syncs that path to `/tmp/workspace`. System-prompt builder loads `AGENTS.md`, `SOUL.md`, `PLATFORM.md`, the active Space's `SPACE.md`, `USER.md`, and the standard composed files. Agent reads `AGENTS.md` routing table, follows `@sql` to the `sql/` subagent folder, reads `sql/CONTEXT.md`, executes with the merged tool list.
  - **Outcome:** Agent has the agent baseline + Space context + user context for the turn. Tools are the union of baseline + Space additions, narrowed by Space policy.
  - **Covered by:** R1, R6, R8, R10, R12, R13, R17, R18

- F4. Agent calls `remember()` mid-turn
  - **Trigger:** Mid-turn, agent calls `remember("snowflake creds rotated")` in a non-default Space (e.g., `finance`).
  - **Actors:** A5
  - **Steps:** Memory tool resolves active Space context. Because the turn is in a non-default Space, the write routes to the Space's Hindsight bank by default. If the agent called `remember("Eric prefers concise summaries", scope='user')`, the write routes to the user bank instead. In the tenant default Space (`general`), all `remember()` writes route to the user bank regardless of scope arg, since there is no specialized room to attach to.
  - **Outcome:** Privacy boundary is enforced by bank choice: Space facts are visible only to that Space's members on future recall; user facts cross every Space the user enters.
  - **Covered by:** R19, R20, R21

- F5. Scheduled job fires inside a Space with no invoking human user
  - **Trigger:** A `scheduled_jobs` row fires for "every morning at 6am, inspect Finance blocking tasks and email the team."
  - **Actors:** A4, A5, A6
  - **Steps:** Server constructs the tuple `(agent_id, finance_space_id, null)`. Renderer returns a rendered workspace where `USER.md` is absent. Runtime syncs as normal. System-prompt builder skips the `USER.md` block. Recall fans only over the Space bank (no user bank). Any `remember(..., scope='user')` call is a no-op (or warning).
  - **Outcome:** Async turns operate with Space context only; no user context is silently fabricated and no orphan write lands in some sentinel user bank.
  - **Covered by:** R22, R23, R24

- F6. Agent sends email from a thread; recipient replies
  - **Trigger:** Agent in a turn inside `finance` Space calls the email-send tool to `cold-prospect@example.com`.
  - **Actors:** A5, A7
  - **Steps:** Server generates a reply token (`generateReplyToken({ agentId, contextId: threadId, contextType: 'thread' })`), persists `email_reply_tokens` row with `recipient_email`, `ses_message_id`, `expires_at`, `max_uses=3`. Outbound is sent with `From:` and `Reply-To:` = `finance@<tenant>.agents.thinkwork.ai` and a `Message-Id:` SES returns and stores. Recipient hits reply; their client copies the original Message-Id into `In-Reply-To:`. Inbound Lambda parses `In-Reply-To`, looks up the token row by `ses_message_id`, validates: row exists, sender matches `recipient_email`, not expired, `use_count < max_uses`, sender still in the active thread allowlist. Pass → append the inbound message to the thread, increment `use_count`. Fail any gate → reject with audit log.
  - **Outcome:** External humans (not necessarily ThinkWork users) participate in agent-initiated email threads via a credentialed back-channel; no ThinkWork account required for token-bearing replies.
  - **Covered by:** R26, R27, R28, R29, R31

- F7. Registered tenant user cold-contacts a Space by email
  - **Trigger:** Eric (a registered user in tenant `acme`) emails `finance@acme.agents.thinkwork.ai` with no prior thread.
  - **Actors:** A3, A4, A7
  - **Steps:** SES delivers to the catchall. Lambda observes no `In-Reply-To`, recipient local-part matches a known Space slug (`finance`), looks up the `finance` Space, checks `email_triggers_enabled = true`, checks sender `From:` matches a `users.email` in `acme`. For private `finance`: also checks sender is in `space_members`. All pass → emit a cold-contact trigger event (matches the connector/webhook event model from `2026-05-19-004`) that creates a new thread in `finance` with the email body as the first message and the sender as the invoking user. Agent picks up the thread on its normal turn loop.
  - **Outcome:** Email becomes a first-class first-contact surface for a Space, opt-in per Space, gated by tenant membership and Space access mode.
  - **Covered by:** R28, R29, R30, R31, R32

---

## Requirements

**Agent runtime model**

- R1. There is exactly one platform agent per tenant. The `agents` DB table reduces to one row per tenant; existing FKs from `threads`, `turns`, `evaluations`, schedules, and other consumers continue to reference `agents.id` unchanged.
- R2. The platform agent's workspace IS the agent. Identity (`SOUL.md`, `IDENTITY.md`), behavior (`GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`), routing (`AGENTS.md`), baseline skills (`skills/`), and subagent folders (e.g., `sql/`, `report/`) all live in the agent baseline workspace. Specialization comes from folder structure, not from additional DB rows.
- R3. Subagent slugs (`@sql`, `@report`, `@coordinator`) resolve by walking the rendered workspace's `AGENTS.md` routing table, not by DB lookup. Subagent uniqueness is enforced at workspace-write time, not by a DB constraint.
- R4. The `space_agent_assignments` table is dropped. "This subagent is only available in finance" capability, if needed, returns as a declaration in the Space's `SPACE.md` (or a sibling policy file) — not as a DB row.

**Per-tuple rendered workspace**

- R5. The runtime workspace consumed by the Strands container is composed per `(agent_id, space_id, user_id?)` tuple by a server-side renderer. The container itself remains unaware of the composition; it syncs S3 → `/tmp/workspace` as today.
- R6. The renderer composes: the agent baseline workspace, the active Space's workspace tree (including `SPACE.md`, space-additive `skills/`, `TOOLS.md`, `MCP.md`), and the invoking user's workspace files (including `USER.md`) when the user is present. The composed result is materialized under a per-tuple S3 prefix.
- R7. The composed `AGENTS.md` (root map) is generated by the renderer, not authored. It references the active Space and tells the agent where Space context lives. The agent baseline's authored `AGENTS.md` is the template input.
- R8. The renderer caches rendered tuples in S3. A render is reused for any subsequent turn on the same tuple as long as no source for that tuple (agent baseline, that Space, that user) has changed since the last render.
- R9. Source-file writes (admin saves agent baseline, Space author saves Space content, user-file writes) trigger cache invalidation for affected tuples — `(this_agent, *, *)` for agent-baseline writes, `(*, this_space, *)` for Space writes, `(*, *, this_user)` for user writes.

**Space as workspace + memory boundary**

- R10. A Space is a tenant-scoped authored workspace tree plus a Hindsight memory bank. `SPACE.md` is the Space's startup instructions (loaded into the system prompt at session start) and is mandatory for every Space, including the tenant default.
- R11. Every tenant has a default Space (current slug: `general` or `default`) created at tenant provisioning. The default Space's `SPACE.md` is seeded from platform defaults and editable by the tenant.
- R12. Spaces can be public (any tenant user can open threads inside) or private (only Space members can see threads or open new ones). Public/private enforcement is for thread/UI access. The runtime renderer always trusts that the server resolved the active Space before invoking it.
- R13. A Space's authored content is fully visible to the agent during turns inside that Space. There is no read-time gating of Space files for the agent; the gating is at the human-access layer (membership).

**User context**

- R14. Every user has a workspace folder containing `USER.md` and any additional per-user files the platform writes (e.g., identity facts, preferences). The user folder's contents are server-managed in the same pattern USER.md uses today — written by the platform on identity events, not edited by hand.
- R15. The user workspace is composed into the rendered workspace at runtime, not copied into any agent's static workspace prefix. Removing this entanglement closes the "per-agent USER.md" pattern.
- R16. When the renderer is invoked with no user (async/automation sources), the user workspace files are omitted from the composed output and the system-prompt builder skips the user-context block.

**Tools, skills, MCP**

- R17. The agent baseline carries default tools, baseline skills (workspace `skills/` folders), and baseline MCP server bindings. Subagent folders can carry their own `skills/` for subagent-local capability.
- R18. Spaces can ADD tools, skills, and MCP server bindings via their workspace tree (`skills/`, `TOOLS.md`, `MCP.md`, or equivalent files). Spaces can also RESTRICT baseline capabilities via policy.
- R19. The effective per-turn tool set is `union(agent baseline, Space additions)` filtered by `Space policy restrictions`. Provenance (which source provided each tool) is preserved in the rendered workspace so the agent and operators can inspect it.

**Memory and Hindsight**

- R20. Every Space owns a dedicated Hindsight memory bank, provisioned at Space creation. Every user owns a dedicated Hindsight memory bank (existing). Recall (`recall()`) fans across the active Space's bank AND the invoking user's bank when both are present; the agent sees results from both, with provenance.
- R21. Memory writes (`remember()`, `reflect()`) default to the active Space's bank when the active Space is non-default. The agent can opt out of the default with `scope='user'` to write to the user bank instead (e.g., for genuinely user-private facts like preferences).
- R22. In the tenant default Space, all `remember()` writes route to the user bank regardless of scope argument. The default Space exists to be a generic surface; it should not accumulate space-specific facts.

**Async / non-user invocations**

- R23. The renderer accepts an optional `user_id`. When `user_id` is null, USER.md and any user-folder files are omitted from the composed workspace and the user Hindsight bank is omitted from recall fan-out.
- R24. `remember()` and `reflect()` with `scope='user'` are no-ops (with a warning log) when the active turn has no invoking user.
- R25. The set of automation sources covered by the no-user path includes: `scheduled_jobs` firings, connector webhook → Space-task routes that have no human originator, subagent delegations where the parent turn itself had no user, wiki/memory maintenance jobs, and any other non-human-originated invocation.

**Email channel**

- R26. Each Space has a stable email address of the form `<space-slug>@<tenant>.agents.thinkwork.ai`. The per-agent vanity-address scheme (`<agent.slug>@agents.thinkwork.ai`, auto-provisioned via `agentCapabilities` rows) is retired — there is no per-agent email identity in the single-platform-agent world.
- R27. All agent-initiated outbound email from a turn uses the active Space's address as both `From:` and `Reply-To:`. There are no per-thread email addresses; thread routing on inbound replies is recovered via the `In-Reply-To` → `email_reply_tokens.ses_message_id` → `context_id` chain that the existing PRD-14 token schema already supports.
- R28. Spaces gain an `email_triggers_enabled` boolean configuration field, default `false`. Cold-contact inbound mail to a Space's address is rejected when the toggle is off, regardless of sender. This is a per-Space opt-in switch operators must turn on explicitly.
- R29. The inbound Lambda gates messages based on whether they bear a token (have `In-Reply-To` resolving to a live `email_reply_tokens` row) or are cold (no resolvable token). Two distinct gate sets apply.
- R30. **Reply path (token present):** the inbound message is accepted only if all of: token row exists and not expired, `use_count < max_uses`, sender `From:` matches the row's `recipient_email`, and sender is still in the active thread allowlist (thread participants ∪ private-Space members ∪ @mentioned humans ∪ agent-invited recipients). Token-bearing replies do **not** require the sender to be a registered ThinkWork user — the token IS the credential, supporting external collaboration with agent-invited correspondents who have no ThinkWork account.
- R31. **Cold-contact path (no token):** the inbound message is accepted only if all of: recipient local-part matches a known `<space-slug>` for the tenant, the matched Space has `email_triggers_enabled = true`, sender `From:` matches a `users.email` in the same tenant, and (for private Spaces) sender is in `space_members` for that Space. Accepted cold contacts emit a trigger event (matching the connector/webhook trigger model from `2026-05-19-004`) that creates a new thread in the Space with the email body as the first message and the registered tenant user as the invoking user.
- R32. The `email_reply_tokens.agent_id` FK continues to point at `agents.id`. Under the one-row-per-tenant agents model, every row in this table FKs to the tenant's single platform agent row — preserving the existing schema with no migration of the FK column itself. The semantic meaning of `agent_id` shifts from "which role-agent owns this thread" to "which tenant's platform agent owns this thread" but the column and FK are unchanged.

**Cleanup and supersession**

- R33. This brainstorm supersedes the 2026-05-20 `spaces-as-agent-context-modules-template-removal` brainstorm's "agents are durable role/capability actors" framing. The current in-flight plans (`2026-05-20-003`, `2026-05-21-002`, `2026-05-21-005`, `2026-05-21-007`) adopt this model rather than the older one; planning must reconcile each before continuing.
- R34. Legacy agent-runtime concepts that no longer have a place in this model are removed, not hidden: ECS "computer" entities, EFS-backed workspace, per-user/per-role agent multiplicity, `space_agent_assignments`, per-agent admin UI screens that exist because agents had distinct configs, per-agent vanity email addresses (`<agent.slug>@agents.thinkwork.ai`) and their `agentCapabilities` rows of capability `email_channel`. Templates (already on a removal path per 2026-05-20-003) finish their removal.
- R35. Renaming or repathing is out of scope for this work where it duplicates existing in-flight efforts (`apps/computer` → `apps/spaces` is `2026-05-21-003`; system-contract relocation is `2026-05-22-001`). This brainstorm reshapes runtime composition; it does not re-do those.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a tenant with one platform agent row, when a user mentions `@sql-agent` in a thread, then the runtime resolves the mention by walking the rendered workspace's `AGENTS.md` routing table, finds the `sql/` subagent folder, and executes — no DB lookup against `agents.handle = 'sql-agent'` happens.

- AE2. **Covers R5, R6, R8.** Given the tuple `(platform_agent, finance, eric)` has not been rendered before, when a turn starts on that tuple, then the renderer composes the workspace fresh (agent baseline + finance Space tree + Eric's user files), writes the composed output to a per-tuple S3 prefix, and the runtime syncs from that prefix. Given the same tuple is invoked again before any source change, then the renderer returns the cached prefix without re-composing.

- AE3. **Covers R9, R10.** Given a Space author edits `finance/SPACE.md`, when the save commits, then the renderer invalidates all cached tuples `(*, finance, *)` and the next turn on each of those tuples re-renders before sync.

- AE4. **Covers R10, R11, R12, R13.** Given a private `finance` Space with members `[eric, lin]`, when `bob` (not a member) tries to open a thread inside `finance`, then the request is rejected at the access layer before any renderer or runtime call. When `eric` opens a thread inside `finance`, then `finance/SPACE.md` is loaded into the system prompt at session start.

- AE5. **Covers R17, R18, R19.** Given the agent baseline grants `web_search` and `calculator`, and the `finance` Space adds `snowflake_mcp` and restricts `web_search`, when a turn runs in `finance`, then the agent's effective tools are `{calculator, snowflake_mcp}` and `web_search` is absent. Provenance shows `calculator` from agent baseline and `snowflake_mcp` from `finance` Space.

- AE6. **Covers R20, R21, R22.** Given a turn in the non-default `finance` Space, when the agent calls `remember("snowflake creds rotated")`, then the write goes to the `finance` Space Hindsight bank only. When the agent calls `remember("Eric prefers concise summaries", scope='user')`, then the write goes to Eric's user bank only. Given the same agent in the tenant default Space, when it calls `remember("X")` with any scope, then the write goes to the user bank.

- AE7. **Covers R23, R24, R25.** Given a `scheduled_jobs` row fires for a Finance-scoped morning blocking-task check, when the renderer is invoked with `(platform_agent, finance, null)`, then the rendered workspace has no `USER.md`, recall fans only over the `finance` bank, and any `remember(..., scope='user')` call returns a no-op with a warning log.

- AE8. **Covers R26, R27, R30.** Given an agent in tenant `acme`'s `finance` Space emails `cold-prospect@example.com`, when the outbound is sent, then `From:` and `Reply-To:` are both `finance@acme.agents.thinkwork.ai` and an `email_reply_tokens` row is persisted with `recipient_email = cold-prospect@example.com` and `ses_message_id` from SES. When `cold-prospect` replies (preserving `In-Reply-To` to the original Message-Id), then the inbound Lambda recovers the token row, validates sender match and use_count, and appends the message to the original thread — even though `cold-prospect` is not a ThinkWork user.

- AE9. **Covers R28, R31.** Given `acme`'s private `finance` Space has `email_triggers_enabled = false`, when registered tenant user `eric@acme.com` cold-emails `finance@acme.agents.thinkwork.ai`, then the inbound is rejected with an audit log. Given the operator flips `email_triggers_enabled = true`, when `eric` (already in `space_members`) cold-emails again, then a new thread is created in `finance` with `eric` as the invoking user. Given non-member `bob@acme.com` cold-emails the same address, then the inbound is rejected (private Space membership gate fails). Given non-tenant `random@other.com` cold-emails, then the inbound is rejected (registered-user gate fails).

- AE10. **Covers R35.** Given the `2026-05-21-003` rebrand of `apps/computer` → `apps/spaces` is in-flight, when this brainstorm's planning starts, then this planning does not modify `apps/computer`/`apps/spaces` source-tree paths and inherits the rebrand's results.

---

## Success Criteria

- An operator can answer "what is an agent in ThinkWork?" in one sentence: "one platform agent per tenant whose workspace is the agent; subagents are folders inside it." Today the same question has three competing answers across active brainstorms and plans.
- A new contributor reading the runtime code can trace a single turn from request → rendered workspace tuple → S3 sync → system prompt build without crossing the boundary between an `agents` table query and an in-workspace AGENTS.md walk twice.
- A downstream planner can produce the data migration, renderer service, admin UI collapse, and `space_agent_assignments` removal as sequenced units without needing to re-decide whether the agents table dies, what scope `remember()` writes to, or how async invocations render.
- After implementation, the per-tuple S3 rendered prefix is the single, inspectable source of truth for what an agent saw during any turn — replay is reading one S3 prefix.

---

## Scope Boundaries

- The connector / Step Functions runtime work (`docs/plans/2026-05-19-004-feat-spaces-stepfunctions-connectors-plan.md`) stays its own plan and adopts the new tuple-key model where applicable; it is not rewritten here.
- Public/private Space access enforcement (`docs/plans/2026-05-21-001-feat-public-private-space-access-plan.md`) ships as-planned; this brainstorm consumes the membership model rather than redefining it.
- The `apps/computer` → `apps/spaces` source-tree rebrand (`docs/plans/2026-05-21-003-feat-spaces-rebrand-and-picker-polish-plan.md`) finishes on its own track; no source-path renames in this work.
- The admin Space Studio UI specifics (`docs/plans/2026-05-21-005-feat-admin-space-studio-simplification-plan.md`) and the legacy Space schema-field cleanup (`docs/plans/2026-05-21-007-refactor-space-schema-cleanup-plan.md`) inherit the new agent model; they are not folded into this brainstorm but must reconcile against it.
- The system-contracts-as-workspace-files refactor (`docs/plans/2026-05-22-001-refactor-system-contracts-as-workspace-files-plan.md`) finishes on its own track; this work uses the resulting workspace-resident contract files.
- The customer-onboarding `spaces.kind = 'customer_onboarding'` workflow is a separate workstream and not in scope for this runtime cleanup.
- Mobile (`apps/mobile`) client changes are out of scope. The mobile client consumes the same GraphQL/REST surface; runtime composition changes are server-internal.
- Evaluations referencing legacy `agent_id` semantics will need a mechanical backfill but the v1 cut here just makes those evals reference the per-tenant platform agent row — eval semantics evolution is its own follow-up.
- **Email channel exclusions.** v1 does not include: outbound email from contexts with no active thread or no active Space (e.g., system maintenance emails — those use a separate sender path, not this channel); a marketing/transactional sender path; multi-recipient email-thread fan-out semantics beyond what the existing token model supports (`max_uses=3` per recipient); operator UI for inspecting/revoking individual `email_reply_tokens` rows (a follow-up if abuse cases surface); abuse mitigation beyond the gates in R30/R31 (rate-limiting, DMARC enforcement, attachment scanning — those are planning concerns).

---

## Key Decisions

- **One platform agent per tenant (option 1 of three considered).** The "many durable role agents" framing (2026-05-20) preserved per-row admin/configuration but kept the multiplicity that the original product motivation no longer needs. The "kill the table entirely" option (subagents as pure folders, no DB row at all) would have invalidated every existing FK — `threads`, `turns`, `evaluations`, schedules — and forced a wide-blast migration. Stubbing the table to one row per tenant keeps every FK valid, drops only `space_agent_assignments`, and concentrates the admin collapse on workspace editing rather than schema rewrite.
- **Per-tuple cached render over per-turn live render or pure prompt injection.** Pure prompt injection (server reads SPACE.md / USER.md at session start, no workspace re-render) was the smallest path — but it leaves Space-additive skills and MCP bindings to a separate composition path at tool-load time, and breaks the "the rendered workspace is the agent's truth" inspection model. Per-turn live render gives the cleanest mental model but burns S3 and adds latency to every turn. Per-tuple caching with source-change invalidation gives the unified-workspace inspection model with first-use latency only.
- **Tools: agent baseline + Space additive (option B of three).** Pure Space-owned tools (option A) would have meant the agent baseline has no capability surface, which is wrong for a platform agent whose whole point is to ship with a useful default capability set. Filesystem-with-externals-at-space (option C) treats MCP/built-ins as fundamentally different from skill folders, which they are, but the union-with-policy-restriction model already supports both shapes without forcing the user to learn two layering rules.
- **`remember()` defaults to active Space; explicit `scope='user'` opt-out.** Always-both writes (option C) was rejected because it cross-contaminates: user-private facts leak into a shared Space bank, and Space-specific facts pollute cross-Space user recall — exactly the privacy boundary Spaces are supposed to create. Agent-explicit scope on every call (option A) puts the decision in the right place but creates friction for the common case (in `finance`, most facts are about `finance`). Default-to-active-Space matches the common case and surfaces user-private facts as an explicit opt-out the agent has to think about.
- **Optional user; render collapses gracefully (option C of three for async).** A system sentinel user per tenant (option B) was rejected because it loses the human-owner audit trail and creates a fake-user surface the platform has to maintain. Per-source on-behalf-of declaration (option A) was rejected because it forces every async source to thread a `runs_as_user_id` through its plumbing, which is non-trivial for connector webhooks where the "on behalf of" semantics are fuzzy. Optional user with graceful collapse keeps the renderer's surface simple and forces consumers (memory tools, USER-aware skills) to handle the null case explicitly rather than via a fake user that papers over the absence.
- **Rendered output is the new source of truth for "what the agent saw."** Today, debug/replay requires re-deriving what the workspace looked like at turn time. With per-tuple rendered prefixes preserved (at least until invalidated), an operator can `aws s3 ls` the prefix to see the exact composed workspace for any (agent, space, user) tuple.
- **Email addresses are Space-scoped, not thread-scoped or agent-scoped.** Per-thread addresses (`thread-<id>@...`) were rejected because they multiply the address space and need per-thread provisioning. Per-agent vanity addresses are dead by construction (one agent per tenant). Space addresses give cold contact a stable handle and reply routing works fine via the existing PRD-14 token + `In-Reply-To` chain. The token carrier is the standard `Message-Id`/`In-Reply-To` header pair (`ses_message_id` column in `email_reply_tokens` was already shaped for this), not a custom `X-*` header (clients strip those on reply) and not the address local-part (would force per-thread provisioning).
- **Cold-contact requires tenant-registered sender + per-Space opt-in.** Allowing arbitrary internet senders to open threads in public Spaces was rejected as too permissive; restricting to tenant `users.email` rows keeps cold contact useful for internal-to-tenant first-contact ("email the Finance team's agent") without opening a public spam vector. The `email_triggers_enabled` Space toggle gives operators an explicit per-room kill switch — defaults off so a tenant doesn't silently inherit cold-contact email surfaces on every new Space.
- **Token-bearing replies bypass the tenant-registered gate.** External correspondents the agent emails (a prospect, a vendor, a customer) don't need ThinkWork accounts to reply — the bounded-use HMAC token in the reply path IS the credential. This is required for v1 to support the most common email-channel use case (agent reaches out, external human replies).

---

## Dependencies / Assumptions

- The current Strands container's flat S3 → `/tmp/workspace` sync model is preserved; the container does not learn about renderer details. (Verified: `packages/agentcore-strands/agent-container/container-sources/server.py` reads from `WORKSPACE_DIR = /tmp/workspace` and walks files.)
- The current `workspace-bootstrap.ts` materialize-at-write-time pattern is replaced for the per-tuple render path, but the bootstrap's "agent baseline files in S3" outputs become the renderer's input source. The materialize-at-write-time path may continue to serve as the agent-baseline source for renderer composition.
- Hindsight already supports multiple memory banks via per-bank namespacing. Provisioning a new bank per Space is incremental work, not architectural. (Assumption: needs verification during planning that Hindsight's per-bank quota/cost model is acceptable at "one bank per Space" multiplicity.)
- The `agents` table's existing FKs (`threads.agent_id`, `turns.agent_id`, schedules, evals, etc.) remain valid after the table reduces to one row per tenant. (Verified: `packages/database-pg/src/schema/agents.ts` shows the table is heavily referenced; preserving one row per tenant keeps every FK live.)
- Public/private Space access enforcement is delivered by `2026-05-21-001`; this work assumes that enforcement is in place at the GraphQL/HTTP layer before runtime composition is invoked.
- `apps/computer` → `apps/spaces` rebrand is delivered by `2026-05-21-003`; this work uses the post-rename source paths.
- The renderer service is a new Lambda. Its trigger surface (S3 PutObject events on agent baseline / Space / user prefixes) and cache structure (S3 prefix per tuple, with an invalidation timestamp file or equivalent) are open implementation choices for ce-plan.
- Existing per-agent admin UI screens (agent editor, agent skills page, agent MCP assignments, etc.) consolidate into "platform agent workspace editor" — admin UI rewrite scope is its own work item but its shape is determined here.
- The PRD-14 email-reply-token infrastructure (`packages/api/src/lib/email-tokens.ts`, `email_reply_tokens` table) is preserved unchanged in shape; only callers shift. (Verified: schema in `packages/database-pg/src/schema/email-channel.ts` already has `ses_message_id` column for In-Reply-To lookup.)
- The SES terraform module (`terraform/modules/app/ses-email`) already provisions the delegated subdomain, DKIM, and inbound catchall plumbing — Space-address routing is a Lambda-layer change, not new infrastructure. (Verified.)
- Per-agent vanity-address GraphQL resolvers (`claimVanityEmailAddress`, `releaseVanityEmailAddress`, `toggleAgentEmailChannel`, `updateAgentEmailAllowlist`, `agentEmailCapability`) and the auto-provision call in `createAgent.mutation.ts` retire as part of R34's cleanup. Their replacement is a per-Space `email_triggers_enabled` mutation plus the implicit Space-address derivation (`<slug>@<tenant>.agents.thinkwork.ai`).
- The tenant-subdomain shape (`<tenant>.agents.thinkwork.ai`) is assumed available — current SES module uses a single `email_domain` variable; multi-tenant address shaping likely needs the module to either provision per-tenant subdomains or use a single catchall and route by parsing the local-part. Planning to decide.

---

## Outstanding Questions

### Resolve Before Planning

- None. All product-shape decisions are resolved in this document.

### Deferred to Planning

- [Affects R5-R9][Technical] Define the renderer's exact S3 prefix layout for cached tuples, the invalidation mechanism (timestamp file vs. DynamoDB record vs. S3 inventory), and the cache eviction policy (TTL, write-on-demand, periodic GC).
- [Affects R3][Technical] Define the subagent slug uniqueness invariant — workspace-write-time validation against duplicate folder names with the same routing entry.
- [Affects R7][Technical] Define the renderer's composition rules for `AGENTS.md`: how a template-shaped baseline `AGENTS.md` is merged with active-Space routing additions to produce the rendered `AGENTS.md`.
- [Affects R20][Technical] Define the per-Space Hindsight bank provisioning lifecycle: at Space create, at first turn in the Space, or admin-triggered? Define the bank teardown story for archived Spaces.
- [Affects R19][Technical] Define the policy declaration syntax for Space tool/skill restrictions — declarative file in the Space tree (e.g., `policy/tools.md` or YAML frontmatter on `TOOLS.md`) vs. structured DB field. Filesystem-is-the-agent argues for the former.
- [Affects R4][Technical] Define how a Space restricts which subagent slugs are mentionable inside it (the capability that goes away when `space_agent_assignments` drops). Likely a declaration in `SPACE.md` or `policy/`.
- [Affects R26][Process] Decide the reconciliation order for in-flight plans: do the four affected plans (`2026-05-20-003`, `2026-05-21-002`, `2026-05-21-005`, `2026-05-21-007`) pause and adopt this brainstorm's model, or do they continue and accept this brainstorm's rework as a follow-up cleanup? Affects sequencing of the data migration.
- [Affects R14, R15][Technical] Define the user workspace folder contents beyond `USER.md` — what files the platform writes per-user, where they're rooted, and how they're invalidated.
- [Affects R1][Technical] Define the data migration from the current N agent rows per tenant to one row per tenant: which existing agent row becomes "the platform agent," how do other rows' workspace contents fold into it as subagent folders, what happens to `agents.handle` (becomes subagent slug?), what happens to per-agent threads (re-FK to the platform agent row?).
- [Affects R27][Needs research] Audit `packages/api/src/lib/computers/`, `packages/computer-stdlib`, `packages/computer-runtime` for ECS/EFS-era assumptions that still survive in code. Some have been removed; the audit confirms what remains and which removals belong in this work vs. follow-up.
- [Affects R26][Technical] Decide the Space-address domain shape: single shared subdomain (`<tenant>-<space>@agents.thinkwork.ai` or `<space>@<tenant>.agents.thinkwork.ai`) vs. per-tenant subdomain (`<space>@<tenant>.agents.thinkwork.ai` with one SES domain identity per tenant). The latter is cleaner DKIM/SPF per tenant but multiplies SES domain identities; the former centralizes domain auth at the cost of local-part parsing.
- [Affects R31][Technical] Define the cold-contact trigger event shape — likely a new `email_trigger` row analogous to `connector_event` from `2026-05-19-004`, or a direct `computer_tasks` write. Reconcile with the Step Functions connector runtime's event model.
- [Affects R28, R31][Design] Define the admin UI surface for `email_triggers_enabled` in Space Studio (per `2026-05-21-005`). Likely a toggle in the Space's Configuration tab or a dedicated Automations sub-section, but the Space Studio simplification plan should host it.
- [Affects R29, R30][Technical] Define abuse-mitigation behaviors beyond gate failures: rate-limit thresholds per Space, DMARC/SPF enforcement strictness, attachment scanning/quarantine policy, and operator-visible reject-log surface. v1 ships with the gates; mitigation depth is planning territory.
- [Affects R30][Technical] Decide the `max_uses` semantics for token reuse on a long-running thread: today's default is 3. Long-running external collaborations (multi-week back-and-forth) may exhaust the count; either raise the default, refresh the token on each agent reply within the thread, or accept that token exhaustion triggers a fresh outbound to re-credential. Likely "refresh on each agent reply" but verify.
