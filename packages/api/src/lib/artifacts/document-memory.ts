/**
 * Documents as first-class memory sources (THINK-152 / THINK-193 P3).
 *
 * Every `emit_document` also retains its markdown digest — prefixed with a
 * provenance colophon (title, genre, status, who, when, thread) — into the
 * memory engine via the `upsertMarkdownMemoryDocument` adapter seam. The
 * Hindsight document id is keyed by the artifact id with replace semantics, so
 * re-emission revises the memory document instead of duplicating it and the
 * Brain always reflects the latest head.
 *
 * Invoked best-effort from `handleDocumentEmission` — a memory fault never
 * fails the emission. Bank routing mirrors the memory-retain owner
 * convention: space-assigned documents land in the space bank; otherwise the
 * acting user's bank; otherwise the thread owner's; otherwise skip.
 */

import { getDb } from "@thinkwork/database-pg";
import { agents, threads, users } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import { getMemoryServices } from "../memory/index.js";
import { isEvalTrafficMetadata } from "../memory/eval-traffic.js";
import { buildDocumentArtifactRetainOptions } from "../memory/hindsight-retain-params.js";
import type { MemoryAdapter } from "../memory/adapter.js";

export const DOCUMENT_MEMORY_CONTEXT = "thinkwork_document";

/** Stable memory-document id for an emitted document artifact. */
export function documentArtifactMemoryId(artifactId: string): string {
  return `document_artifact:${artifactId}`;
}

export interface DocumentMemoryInput {
  tenantId: string;
  threadId: string;
  agentId: string | null;
  artifactId: string;
  documentId: string;
  genre: string;
  title: string;
  abstract: string;
  digestMarkdown: string;
  status: "draft" | "final";
  headVersion: number;
  actingUserId: string | null;
  spaceId: string | null;
  emittedAt: string;
}

export interface DocumentMemoryDeps {
  getAdapter: () => MemoryAdapter;
  loadThreadContext: (input: {
    tenantId: string;
    threadId: string;
  }) => Promise<{ userId: string | null; metadata: unknown } | null>;
  loadUserName: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<string | null>;
  loadAgentName: (input: {
    tenantId: string;
    agentId: string;
  }) => Promise<string | null>;
}

function defaultDeps(): DocumentMemoryDeps {
  return {
    getAdapter: () => getMemoryServices().adapter,
    loadThreadContext: async ({ tenantId, threadId }) => {
      const rows = await getDb()
        .select({ user_id: threads.user_id, metadata: threads.metadata })
        .from(threads)
        .where(and(eq(threads.id, threadId), eq(threads.tenant_id, tenantId)))
        .limit(1);
      const row = rows[0];
      return row
        ? { userId: row.user_id ?? null, metadata: row.metadata ?? null }
        : null;
    },
    loadUserName: async ({ tenantId, userId }) => {
      const rows = await getDb()
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)))
        .limit(1);
      const row = rows[0];
      return row?.name?.trim() || row?.email?.trim() || null;
    },
    loadAgentName: async ({ tenantId, agentId }) => {
      const rows = await getDb()
        .select({ name: agents.name })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
        .limit(1);
      return rows[0]?.name?.trim() || null;
    },
  };
}

/**
 * The colophon gives the extractor provenance referents inline, so extracted
 * units carry complete "who/when/what document" context instead of dangling
 * fragments — the core THINK-193 P3 insight.
 */
export function buildDocumentMemoryContent(input: {
  title: string;
  genre: string;
  status: "draft" | "final";
  headVersion: number;
  abstract: string;
  digestMarkdown: string;
  agentName: string | null;
  userName: string | null;
  threadId: string;
  artifactId: string;
  emittedAt: string;
}): string {
  const author = [
    input.agentName ? `agent "${input.agentName}"` : null,
    input.userName ? `for ${input.userName}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const versionNote =
    input.status === "final" ? `final, v${input.headVersion}` : "draft";
  const lines = [
    `# ${input.title}`,
    "",
    `> Document colophon — provenance for this record:`,
    `> - Genre: ${input.genre} (${versionNote})`,
    `> - Emitted: ${input.emittedAt}${author ? ` by ${author}` : ""}`,
    `> - Thread: ${input.threadId}`,
    `> - Artifact: ${input.artifactId}`,
  ];
  if (input.abstract.trim()) {
    lines.push(`> - Abstract: ${input.abstract.trim()}`);
  }
  return `${lines.join("\n")}\n\n${input.digestMarkdown.trim()}\n`;
}

export type DocumentMemoryIngestResult =
  | { ingested: true; ownerType: "user" | "space"; ownerId: string }
  | { ingested: false; reason: string };

export async function ingestDocumentArtifactMemory(
  input: DocumentMemoryInput,
  deps: DocumentMemoryDeps = defaultDeps(),
): Promise<DocumentMemoryIngestResult> {
  const adapter = deps.getAdapter();
  const capabilities = await adapter.capabilities();
  if (!capabilities.retain || !adapter.upsertMarkdownMemoryDocument) {
    return { ingested: false, reason: "engine_unsupported" };
  }

  const thread = await deps.loadThreadContext({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
  if (thread && isEvalTrafficMetadata(thread.metadata)) {
    return { ingested: false, reason: "eval_traffic" };
  }

  const ownerUserId = input.actingUserId ?? thread?.userId ?? null;
  const owner: { ownerType: "user" | "space"; ownerId: string } | null =
    input.spaceId
      ? { ownerType: "space", ownerId: input.spaceId }
      : ownerUserId
        ? { ownerType: "user", ownerId: ownerUserId }
        : null;
  if (!owner) {
    return { ingested: false, reason: "no_owner" };
  }

  const [agentName, userName] = await Promise.all([
    input.agentId
      ? deps.loadAgentName({ tenantId: input.tenantId, agentId: input.agentId })
      : Promise.resolve(null),
    ownerUserId
      ? deps.loadUserName({ tenantId: input.tenantId, userId: ownerUserId })
      : Promise.resolve(null),
  ]);

  const content = buildDocumentMemoryContent({
    title: input.title,
    genre: input.genre,
    status: input.status,
    headVersion: input.headVersion,
    abstract: input.abstract,
    digestMarkdown: input.digestMarkdown,
    agentName,
    userName,
    threadId: input.threadId,
    artifactId: input.artifactId,
    emittedAt: input.emittedAt,
  });

  await adapter.upsertMarkdownMemoryDocument({
    tenantId: input.tenantId,
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    path: `documents/${input.genre}/${input.artifactId}.md`,
    content,
    documentId: documentArtifactMemoryId(input.artifactId),
    context: DOCUMENT_MEMORY_CONTEXT,
    async: true,
    hindsight: buildDocumentArtifactRetainOptions({
      spaceId: input.spaceId,
      timestamp: input.emittedAt,
    }),
    metadata: {
      source: "document_artifact",
      sourceContext: DOCUMENT_MEMORY_CONTEXT,
      artifactId: input.artifactId,
      documentId: input.documentId,
      threadId: input.threadId,
      agentId: input.agentId ?? undefined,
      genre: input.genre,
      status: input.status,
      headVersion: input.headVersion,
      documentTitle: input.title,
      emittedAt: input.emittedAt,
      emittedByUserId: input.actingUserId ?? undefined,
    },
  });
  console.log(
    `[document-memory] ingested artifact=${input.artifactId.slice(0, 12)} owner=${owner.ownerType}:${owner.ownerId.slice(0, 12)} status=${input.status} bytes=${content.length}`,
  );
  return { ingested: true, ...owner };
}
