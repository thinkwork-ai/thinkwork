---
date: 2026-06-03
topic: knowledge-bases-admin-to-spaces
scope: deep-feature
approach: Operator KB console in Spaces settings + close the binding/provider gaps
---

# Knowledge Bases: Operator Console in Spaces — Requirements

## Summary

Bring operator-grade Knowledge Base management into Spaces settings — create, upload, add-docs-later, sync, delete, re-chunk, and a test-retrieval panel — replacing the admin KB page. KBs become bindable both tenant-wide and per-Space, with both bindings actually reaching agent context, and failed KBs gain a real recovery path.

## Problem Frame

`apps/admin` is being deprecated; `apps/spaces` is becoming the single operator console. Admin has a complete KB lifecycle today (list, detail with document upload, sync, delete, chunking config, error display, sync-polling), but Spaces does not — its operator settings KB view (`apps/spaces/src/routes/_authed/settings.knowledge-bases.tsx` → `SettingsKnowledgeBases`) is a read-only summary table with no row-click navigation and no management controls. When admin retires, KB management disappears unless it lands in Spaces.

Three things make the current Spaces experience feel broken, and they compound:

- **Clicking a KB does nothing.** The settings table has no navigation wired. A separate read-only detail route exists at `/memory/kbs/$kbId`, but the settings table links nowhere, so the operator hits a dead end.
- **A failed KB is a dead end.** `createKnowledgeBase` invokes the provisioning Lambda fire-and-forget (`Event`), flips `status=failed`, and writes `error_message` asynchronously. There is no retry or recreate affordance, so a KB that failed to provision (like the "Company Policies" row sitting at failed / 0 docs) is permanently stuck and inspecting it yields nothing actionable.
- **Per-Space binding is silent theater.** `space_knowledge_bases` has a full write path (`setSpaceKnowledgeBases` mutation, GraphQL types, tenant-guard trigger), but the context provider (`packages/api/src/lib/context-engine/providers/bedrock-knowledge-base.ts:124`) only reads `agentKnowledgeBases`. An operator can bind a KB to a Space and the agent will never retrieve from it.

KBs are being positioned as a key feature of the ThinkWork Context system. A KB an operator can't manage, can't recover when it fails, can't trust to actually reach the agent, and can't inspect what it returns is not yet that feature.

## Key Decisions

- **Operator console lives in Spaces settings; user browse stays read-only.** Management (create / upload / sync / delete / re-chunk / test) is operator-gated and hosted at `/settings/knowledge-bases`, mirroring the Artifacts admin→Spaces migration (`docs/brainstorms/2026-06-03-artifacts-admin-to-spaces-requirements.md`). The existing read-only `/memory/kbs` browse remains for end-users to see what's available — they do not create or manage.

- **Both binding scopes are first-class, and both reach context.** Operators can bind a KB **tenant-wide** (agent-bound — every Space's threads retrieve it; already works) and **per-Space** (space-bound — only that Space's threads retrieve it; currently dead). v1 extends the context provider to union both, resolving the Space from the thread. A KB bound at both scopes must not return duplicate hits.

- **Failed KBs are recoverable, not terminal.** Provisioning errors are surfaced to the operator with the underlying reason, and a failed or stuck KB exposes a retry/recreate action. The user-initiated create path surfaces provisioning failure synchronously rather than only flipping a status asynchronously, consistent with the platform rule that user-driven Lambda invokes use `RequestResponse` and surface errors.

- **Re-chunking is a full re-ingest.** Bedrock fixes chunking at the data source, so changing chunk size/strategy reprocesses every document. The UI treats re-chunk as an explicit, acknowledged reprocessing action, not an in-place edit.

- **Admin KB route retires once parity lands.** Same retirement pattern as Artifacts — the admin KB list and detail are removed after the Spaces console reaches parity.

## Actors

- A1. **Operator / tenant admin** (incl. Eric) — creates, uploads to, syncs, re-chunks, binds, tests, recovers, and deletes KBs from Spaces settings.
- A2. **End user** — browses available KBs read-only; never manages them. Benefits indirectly when bound KBs improve agent answers.
- A3. **Agent runtime** — retrieves from bound KBs (tenant-wide + the thread's Space) via the Bedrock context provider during a turn.
- A4. **Provisioning/ingestion backend** — `knowledge-base-manager` Lambda (create/sync/delete against Bedrock) and `knowledge-base-files` Lambda (upload/list/delete), which set `status`, `document_count`, `last_sync_status`, and `error_message`.

## Requirements

### Console parity (operator management in Spaces settings)

- R1. From `/settings/knowledge-bases`, an operator can create a new KB (name, description, chunking config) without leaving Spaces.
- R2. The operator KB list navigates on row-click to a management-capable detail surface for that KB.
- R3. The detail surface lets an operator upload documents, add more documents later, and delete individual documents.
- R4. The detail surface lets an operator trigger a sync (ingestion) and shows live status while syncing, including document count and last-sync result.
- R5. The detail surface lets an operator delete a KB, with the same teardown admin performs (Bedrock KB, data source, S3 documents, DB rows).
- R6. The detail surface shows KB configuration (embedding model, chunking strategy, chunk size, overlap, status, last sync) and any error message.
- R7. All management actions in R1–R6 are operator-gated; non-operators cannot reach them.

### Refinement (beyond admin parity)

- R8. An operator can change a KB's chunking strategy / chunk size / overlap, which triggers a full re-ingest of all documents; the UI makes clear this reprocesses every document.
- R9. An operator can run a **test query** against a KB and see the ranked results the agent would retrieve — snippet text, relevance score, and source document — without involving a chat thread.

### Failure recovery

- R10. A KB that failed to provision surfaces the underlying failure reason to the operator in plain terms.
- R11. An operator can retry/recreate a failed or stuck KB; retry is idempotent and does not orphan partially-provisioned Bedrock resources.
- R12. Provisioning failure on create is surfaced to the initiating operator at create time, not only via a later asynchronous status flip.

### Binding (both scopes, both wired)

- R13. An operator can bind/unbind a KB **tenant-wide** (every Space's threads retrieve it) from the operator console.
- R14. An operator can bind/unbind a KB **per-Space** (only that Space's threads retrieve it).
- R15. The agent context provider retrieves from both tenant-wide (agent-bound) and the thread's Space (space-bound) KBs in a single turn.
- R16. A KB bound at both tenant-wide and per-Space scope contributes its hits once, not twice.

### Migration

- R17. The admin KB list and detail routes are removed once R1–R16 are in place; no operator KB capability is lost in the cutover.

## Key Flows

- F1. **Create and populate a KB**
  - **Trigger:** Operator clicks "New Knowledge Base" in `/settings/knowledge-bases`.
  - **Actors:** A1, A4
  - **Steps:** Operator enters name/description/chunking → KB provisions (Bedrock KB + S3 data source) → on success, KB is `active`; on failure, the operator sees the reason and a retry action → operator uploads documents → operator triggers sync → ingestion runs and document count + last-sync populate.
  - **Covered by:** R1, R3, R4, R6, R10, R11, R12

- F2. **Bind a KB to a Space and verify it works**
  - **Trigger:** Operator binds an existing KB to a specific Space.
  - **Actors:** A1, A3
  - **Steps:** Operator selects the KB and binds it to Space S (per-Space) → a thread in Space S runs a turn → the context provider resolves S from the thread and retrieves from the space-bound KB → results appear in the agent's context.
  - **Outcome:** Space-bound KB measurably reaches the agent (no longer dead).
  - **Covered by:** R14, R15

- F3. **Refine via re-chunk**
  - **Trigger:** Operator changes a KB's chunk size on the detail surface.
  - **Actors:** A1, A4
  - **Steps:** Operator edits chunking config → UI confirms this reprocesses all documents → full re-ingest runs → document count / last-sync update → operator runs a test query to compare retrieval quality.
  - **Covered by:** R8, R9

- F4. **Recover a failed KB**
  - **Trigger:** Operator opens a KB showing `failed` / 0 docs (e.g., "Company Policies").
  - **Actors:** A1, A4
  - **Steps:** Operator sees the failure reason → clicks retry/recreate → provisioning re-runs idempotently → KB reaches `active` or surfaces a fresh, actionable error.
  - **Covered by:** R10, R11

## Acceptance Examples

- AE1. **Space-bound retrieval reaches context.** **Given** KB K bound only to Space S, **when** a thread in Space S runs a turn whose query matches K's content, **then** the agent's context includes hits from K; **and** a thread in a different Space does not.
- AE2. **Dual-bound KB de-duplicates.** **Given** KB K bound both tenant-wide and to Space S, **when** a thread in Space S retrieves, **then** K's matching chunks appear once, not twice.
- AE3. **Failed create is visible immediately.** **Given** an operator creates a KB and provisioning fails, **when** the create action returns, **then** the operator sees the failure reason without waiting for a later status refresh.
- AE4. **Retry is idempotent.** **Given** a KB stuck in `failed` after partial provisioning, **when** the operator retries, **then** provisioning completes or re-fails cleanly without creating duplicate Bedrock resources.
- AE5. **Re-chunk reprocesses everything.** **Given** a KB with N synced documents, **when** the operator changes chunk size, **then** the UI indicates a full re-ingest and all N documents are reprocessed (not just new ones).
- AE6. **Non-operator cannot manage.** **Given** a non-operator user, **when** they reach the KB surfaces, **then** they can browse read-only but see no create/upload/sync/delete/bind controls.

## Scope Boundaries

**In scope**
- Operator KB console in Spaces settings with full lifecycle (R1–R7).
- Re-chunk and test-retrieval refinement (R8–R9).
- Failure recovery and synchronous create-error surfacing (R10–R12).
- Both binding scopes, unioned and de-duplicated in the provider (R13–R16).
- Removal of the admin KB route/detail (R17).

**Deferred for later**
- Auto-sync on upload (ingestion still operator-triggered; it's async and costs tokens).
- Document preview/inline viewing beyond name/size/date.
- Bulk/parallelized document upload optimizations.
- Per-binding search tuning (`search_config` JSONB exists but is not surfaced for editing in v1).

**Outside this product's identity**
- Replacing or reconfiguring the embedding model, vector store, or Bedrock ingestion pipeline — we manage Bedrock KBs, not re-implement retrieval.
- End-user (non-operator) KB creation/management.
- Changes to `spaces.*` schema owned by the separate Spaces rearchitecture workstream (`space_knowledge_bases` is `public.*` and is in scope).

## Dependencies / Assumptions

- **Operator role signal in Spaces.** Reuse the existing operator gate that already hides operator-only settings nav (the Artifacts migration relies on the same signal); admin used `requireTenantAdmin()`.
- **Thread→Space resolution in the context engine.** R15 assumes the agent request/thread exposes its Space to the provider. Verify the provider can resolve `space_id` from the thread before unioning space-bound KBs; if not, that wiring is part of this work.
- **Bedrock chunking is data-source-fixed.** R8's full re-ingest assumption rests on chunking being set at data-source creation; planning must confirm whether re-chunk updates the existing data source or recreates it, and how that interacts with in-flight `status`.
- **Idempotent provisioning.** R11 assumes `knowledge-base-manager` create can be made safe to re-run against a partially-provisioned KB (existing `aws_kb_id` / `aws_data_source_id`), cleaning up or reusing rather than duplicating.
- **`RequestResponse` create path.** R12 implies changing `createKnowledgeBase` off fire-and-forget `Event` invoke for the user-facing failure surface; confirm provisioning latency is acceptable for a synchronous create, or design a fast-ack + surfaced-error pattern.
- Spaces has a vitest harness (`apps/spaces/src/vitest.config.ts`) — new behavior lands with tests.

## Outstanding Questions

**Resolve before planning**
- None blocking — the two load-bearing product decisions (full refinement scope; both binding scopes first-class) are settled.

**Deferred to planning**
- Whether re-chunk recreates the Bedrock data source or updates it in place (drives R8 mechanics).
- Whether the operator console reuses the existing read-only detail components (`/memory/kbs/$kbId`) with operator-gated controls added, or a distinct settings detail route — a reuse-vs-new decision parallel to the Artifacts migration.
- Synchronous-create vs fast-ack-plus-error pattern for R12, given Bedrock provisioning latency.
- Dedup strategy for R16 (by `knowledge_base_id` before retrieval vs by hit after).

## Sources / Research

- Data model: `packages/database-pg/src/schema/knowledge-bases.ts` (`knowledge_bases`, `agent_knowledge_bases`, `space_knowledge_bases`), `packages/database-pg/graphql/types/knowledge-bases.graphql`, `.../spaces.graphql`.
- Admin KB surface (to retire): `apps/admin/src/routes/_authed/_tenant/knowledge-bases/index.tsx`, `.../knowledge-bases/$kbId.tsx`, `apps/admin/src/lib/knowledge-base-api.ts`.
- Spaces KB surfaces: `apps/spaces/src/routes/_authed/settings.knowledge-bases.tsx` (operator summary, no nav), `apps/spaces/src/routes/_authed/_shell/memory.kbs.tsx` + `memory.kbs.$kbId.tsx` (read-only browse/detail), `apps/spaces/src/lib/kb-files-api.ts` (list-only).
- Resolvers/mutations: `packages/api/src/graphql/resolvers/knowledge/` (create/update/delete/sync, setAgentKnowledgeBases), `packages/api/src/graphql/resolvers/spaces/setSpaceKnowledgeBases.mutation.ts`.
- Backend: `packages/api/knowledge-base-manager.ts` (create/sync/delete via Bedrock), `packages/api/knowledge-base-files.ts` (upload/list/delete), `scripts/build-lambdas.sh` entries.
- Context provider (the binding gap): `packages/api/src/lib/context-engine/providers/bedrock-knowledge-base.ts` — reads `agentKnowledgeBases` only at line 124.
- Terraform: `terraform/modules/data/bedrock-knowledge-base/main.tf` (KB service role).
- Sibling migration pattern: `docs/brainstorms/2026-06-03-artifacts-admin-to-spaces-requirements.md`.
- Admin docs (behavior reference): `docs/src/content/docs/applications/admin/knowledge-bases.mdx`.
