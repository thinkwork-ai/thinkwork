# Documents as first-class memory sources (THINK-193 P3 / THINK-152 rescoped)

**Date:** 2026-07-06
**Ticket:** THINK-152 (parent THINK-193 Memory & Company Brain)
**Source analysis:** docs/brainstorms/2026-07-06-company-brain-quality-reset-analysis.md §P3

## Problem

The Brain's highest-quality potential sources — emitted documents (compositor
output) — are never ingested. They carry exactly the context that chat-fragment
memories lack: author, timestamp, genre, deliberate synthesized substance.
Meanwhile extraction quality is now fixed (Hindsight 0.8.4 + Haiku 4.5, live on
dev per THINK-201), so ingesting documents compounds good signal, not noise.

This is the **Brain-ingestion slice** of THINK-152 only. Navigator read tools
(`artifact_ls`/`artifact_rg`/`artifact_read`) and Linear auto-mirroring stay in
the ticket as follow-on scope.

## Design

Every `emit_document` (draft and final) also retains its **markdown digest +
colophon** into Hindsight via the existing `upsertMarkdownMemoryDocument`
adapter seam — the same mechanism Space document ingest uses.

- **Hook point:** `handleDocumentEmission`
  (`packages/api/src/lib/artifacts/document-emission.ts`), after the durable
  persist (row upsert / pin), **best-effort** exactly like the card append: a
  memory fault never fails the emission.
- **Document identity:** `document_id = document_artifact:{artifactId}` with
  `update_mode: "replace"` — re-emission revises the memory document instead of
  duplicating it; the memory always reflects the latest head.
- **Content:** a small colophon block (title, genre, status, abstract, agent,
  acting user, thread, emitted-at) prepended to the digest markdown, so the
  extractor sees provenance referents inline.
- **Bank routing:** space-assigned document (finalize `spaceId` or an existing
  `space_id` on the row) → space bank; else acting user (turn's triggering
  message sender) → user bank; else the thread's `user_id`; else skip with a
  log line. Mirrors the memory-retain owner convention.
- **Tags:** new `buildDocumentArtifactRetainOptions` in
  `hindsight-retain-params.ts` — `source:document`, `surface:pi`,
  `scope:document`, plus `space:{id}` + `scope:space` or `scope:personal`.
  Context string: `thinkwork_document`.
- **Eval traffic:** threads whose metadata carries the `evalTraffic` marker are
  skipped (P1 hygiene carried forward). `isEvalTrafficMetadata` moves from the
  memory-retain handler to `packages/api/src/lib/memory/eval-traffic.ts`
  (re-exported from the handler for compatibility).
- **Async:** `async: true` — extraction queues in Hindsight; no added latency
  on the emit path.

## Changes

1. `packages/api/src/lib/memory/eval-traffic.ts` — NEW; relocated
   `isEvalTrafficMetadata`.
2. `packages/api/src/lib/memory/hindsight-retain-params.ts` — add
   `buildDocumentArtifactRetainOptions`.
3. `packages/api/src/lib/artifacts/document-memory.ts` — NEW;
   `buildDocumentMemoryContent` (colophon + digest) and
   `ingestDocumentArtifactMemory` (owner resolution, capability check, adapter
   call, structured logging).
4. `packages/api/src/lib/artifacts/document-emission.ts` — new
   `ingestDocumentMemory` dep in `DocumentEmissionDeps`, invoked best-effort
   after persist/pin with artifactId, documentId, doc fields, actingUserId,
   spaceId (from finalize input or row), status, emittedAt.
5. Tests: colophon/content builder, owner resolution + eval-skip, retain-params
   builder, emission-flow tests via the deps seam (called with expected args;
   ingest failure does not fail emission).

## Verification

- `pnpm --filter @thinkwork/api test` + typecheck (full package suite).
- Live dev smoke: create a thread instructing the agent to emit a document;
  confirm a `document_artifact:%` row in `hindsight.documents`, extracted
  `hindsight.memory_units` tagged `source:document` that are referent-complete,
  and that emission itself still returns ok.
