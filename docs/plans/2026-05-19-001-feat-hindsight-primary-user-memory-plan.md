---
title: "feat: Hindsight-primary user memory"
type: feat
status: active
date: 2026-05-19
origin:
  - docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md
  - docs/plans/2026-05-18-002-feat-requester-memory-dreaming-plan.md
related:
  - docs/brainstorms/2026-04-27-hindsight-wiki-document-replication-requirements.md
  - docs/brainstorms/2026-04-24-hindsight-retain-reshape-and-daily-memory-requirements.md
  - docs/brainstorms/2026-05-16-wiki-brain-schema-extraction-requirements.md
external-references:
  - https://hindclaw.pro/
  - https://github.com/openclaw/openclaw
---

# feat: Hindsight-Primary User Memory

## Overview

Flip requester memory from "Markdown source of truth, Hindsight as index" to a
Hindsight-primary v1:

1. Thread idle learning creates a processed thread memory digest.
2. The digest is retained into the requester's Hindsight bank as a stable,
   replaceable document before Markdown sync.
3. S3 Markdown remains the human-auditable working/export surface, not the
   machine memory authority.
4. Dreaming reads Hindsight-backed working documents and requester Markdown
   exports, then writes Dream Diary and compact `MEMORY.md` exports.
5. Wiki/Ontology extraction continues downstream from Hindsight records through
   the existing `wiki-compile` cursor pipeline.

This keeps the concrete OpenClaw affordances users can inspect (`MEMORY.md`,
working daily files, `DREAMS.md`) while letting Hindsight do the primary machine
memory job: retention, recall, reflection, and change cursors.

## Problem Frame

The current requester memory pipeline now works end to end, but its polarity is
wrong for the next architecture. The idle learner writes daily Markdown and
durable Markdown first, then upserts changed files to Hindsight. That makes S3
Markdown the operational memory database and leaves Hindsight as a secondary
index.

The desired architecture is closer to HindClaw: Hindsight is the primary memory
brain; Markdown is a local, reviewable working layer; Wiki/Ontology is the
curated downstream knowledge product. The immediate bug-risk is also practical:
daily working files can look like raw message previews instead of processed
memory artifacts, which makes it hard for an operator to tell whether learning
actually happened.

## Scope Boundaries

In scope:

- Requester/user memory for persisted Thinkwork Threads.
- Hindsight stable document upserts for processed thread digests.
- S3 Markdown working files rewritten as concise processed digests, not raw
  transcript previews.
- Dreaming source selection that treats Hindsight-backed working documents as
  machine evidence and Markdown as audit/export.
- Compile enqueue from Hindsight retain so Wiki/Ontology remains downstream.

Out of scope:

- Removing S3 Markdown memory files.
- Replacing the Hindsight service or schema.
- Replacing the existing Wiki compiler with Hindsight's native graph.
- Migrating every historical Markdown file in this branch.
- User-facing settings for memory thresholds.
- Requester-specific skills.

## Current System Notes

- `packages/api/src/lib/requester-memory/learner.ts` extracts deterministic
  candidates, writes `memory/working/YYYY-MM-DD.md`,
  `memory/candidates/YYYY-MM-DD.md`, and `memory/MEMORY.md`, then calls
  `syncRequesterMemoryToHindsight`.
- `packages/api/src/lib/requester-memory/markdown.ts` renders the working daily
  file with requester and assistant message previews. That is useful for debug,
  but it reads like transcript storage.
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` already supports
  stable `document_id` + `update_mode: "replace"` through
  `upsertMarkdownMemoryDocument`, `retainConversation`, and
  `retainDailyMemory`.
- `packages/api/src/handlers/memory-retain.ts` already calls
  `maybeEnqueuePostTurnCompile` after successful Hindsight retain.
- `packages/api/src/lib/wiki/compiler.ts` already reads incremental Hindsight
  records through `listRecordsUpdatedSince` and writes Wiki pages.
- `packages/api/src/lib/requester-memory/dreaming.ts` already implements a
  user-level light/REM/deep sweep, `memory/DREAMS.md`, and deep promotion.
- `packages/api/src/lib/context-engine/providers/memory.ts` already supports
  Hindsight `reflect` as a query mode and bridges recalled memory to Wiki pages.

## Key Decisions

1. **Hindsight primary, Markdown mirror.** The idle learner retains a processed
   thread digest to Hindsight first. Markdown files mirror that processed digest
   for inspection and manual editing.
2. **One replaceable document per thread digest.** Use a stable document id
   derived from requester user id and thread id. Re-runs replace the digest
   instead of appending volatile run metadata.
3. **Daily working files are summaries.** `memory/working/YYYY-MM-DD.md`
   contains thread outcome, decisions, durable candidates, staged candidates,
   rejected counts, and evidence ids. It does not contain raw assistant message
   previews.
4. **Dreaming does not read generated dream reports as evidence.** Existing
   exclusion rules stay in place. Hindsight-backed thread digests and public
   memory files are eligible; reports, `.dreams`, and `DREAMS.md` are review
   artifacts.
5. **Wiki/Ontology stays downstream of Hindsight.** Successful primary retain
   should enqueue compile through the existing `maybeEnqueuePostTurnCompile`
   path or an equivalent helper, so the Wiki compiler continues to consume
   Hindsight records with cursors.

## Implementation Units

### U1 — Hindsight-Primary Thread Digest Retain

**Goal:** Add a requester-memory primary retain path that writes the processed
thread digest to Hindsight as a stable replaceable document and enqueues Wiki
compile after success.

**Files:**

- `packages/api/src/lib/requester-memory/hindsight-primary.ts` (new)
- `packages/api/src/lib/requester-memory/hindsight-sync.ts`
- `packages/api/src/lib/requester-memory/learner.ts`
- `packages/api/src/lib/requester-memory/hindsight-primary.test.ts` (new)
- `packages/api/src/lib/requester-memory/learner.test.ts`

**Approach:**

- Build a `ProcessedThreadMemoryDigest` from existing learner inputs: thread
  metadata, accepted candidates, promoted candidates, staged candidates,
  rejected count, transcript/evidence ids, and scheduled time.
- Render it as compact Markdown with no raw transcript body.
- Upsert it through `upsertMarkdownMemoryDocument` using
  `context="thinkwork_requester_thread_digest"` and
  `document_id="requester_thread_digest:{userId}:{threadId}"`.
- After a successful upsert, enqueue Wiki compile for `(tenantId, userId)` via
  `maybeEnqueuePostTurnCompile`.
- Do not fail the idle run solely because compile enqueue fails; record the
  enqueue result in metadata/report output.

**Execution note:** Test-first for document id, content shape, adapter payload,
and compile enqueue behavior.

**Verification:**

- Hindsight upsert receives a stable thread digest document id.
- Digest content contains candidates/evidence summary and no assistant response
  transcript section.
- Compile enqueue is attempted after successful Hindsight upsert.
- Adapter failure is reflected in run metadata without corrupting Markdown.

### U2 — Working Markdown as Processed Memory

**Goal:** Replace raw-ish thread journal rendering with the same processed
thread digest used for primary retain.

**Files:**

- `packages/api/src/lib/requester-memory/markdown.ts`
- `packages/api/src/lib/requester-memory/learner.ts`
- `packages/api/src/lib/requester-memory/markdown.test.ts` (new if needed)
- `packages/api/src/lib/requester-memory/learner.test.ts`

**Approach:**

- Replace `renderThreadJournalAppendSection` usage with processed digest
  rendering.
- Preserve idempotent per-thread section upsert.
- Include high-signal fields: title, thread type/channel/status, message count,
  attachment count, extracted/promoted/staged/rejected counts, candidate bullets,
  and evidence message ids.
- Avoid run ids in stable working sections unless needed in hidden reports.

**Verification:**

- Re-running the same idle learner produces no Markdown diff.
- Working daily file does not include `### Assistant Responses`.
- Empty candidate runs still write an operator-readable "no promoted/staged
  candidates" digest.

### U3 — Dreaming Reads Hindsight-Primary Artifacts

**Goal:** Ensure dreaming recognizes processed thread digests as the working
memory evidence layer and does not promote from generated reports.

**Files:**

- `packages/api/src/lib/requester-memory/dreaming.ts`
- `packages/api/src/lib/requester-memory/hindsight-sync.ts`
- `packages/api/src/lib/requester-memory/dreaming.test.ts`

**Approach:**

- Treat `memory/working/*.md` and `memory/MEMORY.md` as public audit/export
  inputs.
- Keep excluding `memory/DREAMS.md`, `memory/dreaming/**`,
  `memory/reports/**`, `.dreams`, and snapshots.
- Sync Dream Diary and `MEMORY.md` export changes to Hindsight as audit docs,
  but do not make reports promotion sources.

**Verification:**

- Dreaming source gathering includes processed working files.
- Dreaming source gathering excludes Dream Diary/reports/internal state.
- Deep promotion remains grounded in candidate/evidence lines, not generated
  reflections.

### U4 — Context Runtime Prefers Hindsight Reflection

**Goal:** Make requester context composition prefer Hindsight reflect/recall,
with Markdown only as an inspectable fallback/export layer.

**Files:**

- `packages/api/src/lib/computers/requester-context.ts`
- `packages/api/src/lib/context-engine/providers/memory.ts`
- Existing tests under `packages/api/src/lib/computers` and
  `packages/api/src/lib/context-engine`

**Approach:**

- Use Hindsight reflect when query mode asks for reflection and the adapter
  supports it.
- Surface provider metadata that distinguishes primary Hindsight memory from
  Markdown export documents.
- Keep requester validation and tenant-scope checks unchanged.

**Verification:**

- Requester context returns reflection hits when configured for reflect.
- Failure degrades to skipped/error status without throwing into Computer
  runtime.

### U5 — Wiki/Ontology Continuation

**Goal:** Confirm Hindsight-primary memory still feeds Wiki/Ontology extraction
through existing compile jobs.

**Files:**

- `packages/api/src/lib/wiki/enqueue.ts`
- `packages/api/src/lib/wiki/compiler.ts`
- `packages/api/src/lib/requester-memory/hindsight-primary.ts`
- Existing wiki tests as needed

**Approach:**

- Reuse existing compile enqueue helper.
- Ensure primary digest records carry metadata that downstream planner can use:
  `source`, `sourceContext`, `threadId`, `path`, `evidenceMessageIds`, and
  candidate categories.
- Do not create a new compiler path unless the existing Hindsight cursor cannot
  see the records.

**Verification:**

- Unit test proves compile enqueue receives tenant/user after primary retain.
- Existing compile tests remain green.

## Verification Plan

Smallest meaningful checks first:

- `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/hindsight-primary.test.ts`
- `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/learner.test.ts src/lib/requester-memory/dreaming.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `bash scripts/build-lambdas.sh thread-idle-memory-learning requester-memory-dreaming wiki-compile`

Manual/dev verification after merge/deploy:

1. Create a new requester Thread with an explicit preference or correction.
2. Run or wait for idle learning.
3. Confirm Hindsight contains one
   `thinkwork_requester_thread_digest` document for the thread.
4. Confirm `memory/working/YYYY-MM-DD.md` contains a processed digest, not raw
   assistant message previews.
5. Confirm `memory/MEMORY.md` only contains promoted compact facts.
6. Confirm Wiki compile job is enqueued or deduped after the Hindsight retain.

## Risks

- **Double ingestion:** Existing runtime `memory-retain` may still retain full
  thread documents. This branch does not remove that path; it makes requester
  idle learning's processed digest the primary requester-memory artifact.
- **Over-promotion:** Keep deterministic candidate thresholds and safety gates.
- **Hindsight outage:** Idle learner should still write Markdown audit output and
  report Hindsight failure.
- **Compiler churn:** Compile enqueue is deduped by the existing repository
  helper, so retaining a digest should not create compile storms.
