/**
 * Optional engine capabilities the external-source memory pipeline needs.
 *
 * THINK-406 retired Hindsight, and the surviving AgentCore adapter implements
 * none of these: it has no markdown-document store, so there is nothing to
 * upsert, delete, or consolidate. Rather than pin the dead methods onto the
 * shared {@link MemoryAdapter} contract, the pipeline declares the shape it
 * *wants* here and keeps its existing runtime guards.
 *
 * The practical effect is that the retain, compound, erase, and retraction
 * paths now fail closed with an explicit "unsupported engine" result on every
 * deployment. Acquire/extract/project/resolve still run and still write the
 * evidence + claim ledger (which `lib/entity-identity` reads), so the
 * subsystem is inert rather than broken.
 *
 * Retiring the pipeline outright is tracked as follow-up work — it also owns
 * the `memory-stage-worker` / `memory-stage-sweeper` /
 * `memory-retraction-drainer` Lambdas, their schedules and alarms, the
 * `MemorySource*` GraphQL surface, and the web Automation definition tab.
 */

import type { MemoryAdapter } from "../memory/adapter.js";

/** Delete one engine document by stable id, cascading to extracted units. */
export type DeleteDocumentFn = (req: {
  tenantId: string;
  ownerType: "user" | "agent" | "space" | "tenant";
  ownerId: string;
  documentId: string;
}) => Promise<"deleted" | "not_found">;

/** Upsert a markdown memory document into the owner's bank. */
export type UpsertMarkdownMemoryDocumentFn = (req: {
  tenantId: string;
  ownerType: "user" | "agent" | "space" | "tenant";
  ownerId: string;
  path: string;
  content: string;
  documentId: string;
  context: string;
  async?: boolean;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

/** Drive the engine's native bank consolidation for one raw bank id. */
export type ConsolidateBankByIdFn = (bankId: string) => Promise<void>;

/**
 * The document-store capabilities the pipeline probes for at runtime. Every
 * member is optional; no engine currently supplies any of them.
 */
export type DocumentCapableMemoryAdapter = MemoryAdapter & {
  upsertMarkdownMemoryDocument?: UpsertMarkdownMemoryDocumentFn;
  deleteDocument?: DeleteDocumentFn;
  consolidateBankById?: ConsolidateBankByIdFn;
};

/** The narrowed slice the retraction saga accepts. */
export type RetractionCapableAdapter = {
  deleteDocument?: DeleteDocumentFn;
  consolidateBankById?: ConsolidateBankByIdFn;
};
