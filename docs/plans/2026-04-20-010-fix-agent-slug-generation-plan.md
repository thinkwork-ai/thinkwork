---
title: "fix: Use generateSlug() at all agent-insert sites"
type: fix
status: active
date: 2026-04-20
---

# fix: Use generateSlug() at all agent-insert sites

## Overview

Two agent-creation code paths insert rows into `agents` without setting the
`slug` column, so those rows land with a `NULL` slug. The UI and downstream
code (email capability address, workspace paths, wiki scopes) treat the
slug as the agent's human handle — when it is `NULL`, consumers fall back
to raw UUIDs or names. The fix is to call the existing `generateSlug()`
helper at both insert sites.

## Problem Frame

The canonical slug format is `adjective-animal-NNN` (e.g.
`fleet-caterpillar-456`, `earnest-falcon-947`). A helper at
`packages/database-pg/src/utils/generate-slug.ts:100` produces this format
and is already used by the GraphQL resolvers. Two REST handlers were
written without calling it, so agents created via those paths have
`slug = NULL`:

- REST `POST /api/agents` — `packages/api/src/handlers/agents.ts:126-138`
- BYOB approve-join-request — `packages/api/src/handlers/invites.ts:452-463`

Symptoms: downstream code that interpolates `agent.slug` (email capability
address, workspace S3 prefix, wiki export path, mobile UI display) either
renders `null@agents.thinkwork.ai`, silently falls back to the agent's
UUID, or shows the raw name.

Any rows that already landed with `slug = NULL` are handled out of band —
operator can `UPDATE agents SET slug = ...` directly. No backfill tooling
is shipped with this fix.

## Requirements Trace

- R1. Every path that inserts into `agents` must populate `slug` using
  `generateSlug()` (or an explicitly-provided caller slug where that
  field is already part of the public contract).

## Scope Boundaries

- Not changing the `generateSlug()` implementation or word lists.
- Not adding a collision-retry loop (pre-existing gap — called out
  under Risks but deferred).
- Not tightening the `slug` column to `NOT NULL` (separate migration;
  see Deferred to Separate Tasks).
- Not adding a backfill script or admin-UI slug editor — NULL-slug
  rows are fixed manually by the operator when they matter.
- Not adding `email_channel` capability auto-provisioning to the two
  REST paths. The GraphQL paths do this but REST does not. That
  asymmetry exists independently of the slug bug and stays out of
  scope here.

### Deferred to Separate Tasks

- Tighten `agents.slug` to `.notNull().unique()` in
  `packages/database-pg/src/schema/agents.ts:37`: requires a migration
  that first confirms zero remaining NULL slugs. Do after this fix has
  been in place long enough that no new NULL-slug rows can appear.
- REST/BYOB feature parity with GraphQL agent creation (email
  capability provisioning, heartbeat scheduling, workspace copy):
  separate plan.

## Context & Research

### Relevant Code and Patterns

- Slug generator: `packages/database-pg/src/utils/generate-slug.ts:100`
  — `generateSlug()` returns `${adj}-${animal}-${num}` where
  `num ∈ [100, 999]`. Word lists: 192 adjectives × 292 animals × 900
  numbers ≈ 50M combos.
- Correct usage (reference):
  `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts:36`
  — `slug: generateSlug(),`.
- Correct usage (reference):
  `packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts:30`
  — `slug: i.slug || generateSlug(),`.
- Schema: `packages/database-pg/src/schema/agents.ts:37` —
  `slug: text("slug").unique()` (unique but **nullable**, which is
  what allowed the bug to land silently).

### Institutional Learnings

- The slug is load-bearing for the `email_channel` capability
  (address `${agent.slug}@agents.thinkwork.ai`, set in both GraphQL
  create paths). A NULL slug here silently produces
  `null@agents.thinkwork.ai`.

## Key Technical Decisions

- **Use the existing `generateSlug()` helper at both REST sites rather
  than inventing a new policy.** Rationale: the helper already exists,
  is used by the GraphQL resolvers that were built more carefully, and
  produces the exact adjective-animal-NNN format the user expects.
- **Do not add retry-on-collision logic in this fix.** Rationale: the
  pre-existing GraphQL paths don't have it either. Collision
  probability per insert is ~1 in 50M; handling it is a separate
  hardening task that should cover all four `generateSlug()` agent-
  insert call sites uniformly.

## Implementation Units

- [x] **Unit 1: REST `POST /api/agents` — call `generateSlug()`**

**Goal:** The REST agent-create handler populates `slug` on insert.

**Requirements:** R1

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/handlers/agents.ts`

**Approach:**
- Import `generateSlug` from
  `@thinkwork/database-pg/utils/generate-slug` (matches how the
  GraphQL resolvers import it).
- Add `slug: generateSlug(),` to the `.values({...})` object in
  `createAgent`.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts:36`

**Test scenarios:**
- Happy path: POST `/api/agents` with a valid body returns a row
  whose `slug` matches `/^[a-z]+-[a-z]+-\d{3}$/`.
- Edge case: two back-to-back POSTs against the same tenant produce
  two distinct slugs.
- Error path: missing `name` still short-circuits with
  `error("name is required")` before any slug is generated.

**Verification:**
- A freshly-created agent returned from this endpoint has a
  non-null, adjective-animal-NNN slug.

- [x] **Unit 2: BYOB approve-join-request — call `generateSlug()`**

**Goal:** The join-request approval flow populates `slug` when it
converts a pending join request into a real agent row.

**Requirements:** R1

**Dependencies:** None (independent of Unit 1).

**Files:**
- Modify: `packages/api/src/handlers/invites.ts`

**Approach:**
- Import `generateSlug` alongside the existing schema imports.
- Add `slug: generateSlug(),` to the `.values({...})` object in
  `approveJoinRequest`.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts:36`

**Test scenarios:**
- Happy path: approving a pending join request produces an `agents`
  row with a non-null slug in adjective-animal-NNN form. The
  corresponding `join_requests.status` transitions to `approved`
  and `created_agent_id` points at the new row.
- Edge case: the handler still refuses to re-approve a non-pending
  request (409) — no slug is drawn for the rejected path.
- Integration: the activity-log insert still fires with
  `action="agent_registered"` and the new agent's `id`.

**Verification:**
- After approving a test join request, the resulting agent row has
  a valid slug and every existing downstream behavior (activity
  log, join-request update) still happens.

## System-Wide Impact

- **Interaction graph:** `agents.slug` is consumed by the
  `email_channel` capability config, workspace S3 prefixes
  (`workspace-copy.ts`), wiki export (`handlers/wiki-export.ts`),
  email inbound/outbound routing (`email-inbound.ts`,
  `email-send.ts`), and mobile UI displays. All of these already
  handle the GraphQL-created path correctly; they stop emitting
  junk once REST/BYOB paths also set slugs.
- **Unchanged invariants:** `agents.slug`'s UNIQUE constraint still
  holds. The column remains nullable at the schema level
  (tightening to `NOT NULL` is deferred — see Scope Boundaries).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Generated slug collides with an existing one (UNIQUE constraint violation). | ~1-in-50M odds; tolerable for this fix. Pre-existing risk shared with the GraphQL resolvers — tracked as a separate hardening task. |
| Pre-existing NULL-slug rows still exist in the DB. | Operator fixes any that matter manually via `UPDATE agents SET slug = ...`. No code-level backfill ships with this change. |

## Sources & References

- Slug helper: `packages/database-pg/src/utils/generate-slug.ts:100`
- Broken site 1: `packages/api/src/handlers/agents.ts:126-138`
- Broken site 2: `packages/api/src/handlers/invites.ts:451-463`
- Correct reference 1: `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts:36`
- Correct reference 2: `packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts:30`
- Schema: `packages/database-pg/src/schema/agents.ts:37`
