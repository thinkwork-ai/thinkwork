/**
 * HTML Document Artifacts (THINK-147 U3): the `document.emit` branch of the
 * chat-agent-activity handler.
 *
 * The `emit_document` Pi tool POSTs the full dual-body document here (payload
 * shape `{ ..., document: {...} }` on the /activity route — bodies ride the
 * ~6MB Lambda invoke, never `thread_turn_events`). The handler:
 *
 *   1. validates shape, then runs DocSpector (document-preflight.ts) — rejects
 *      return as a diagnostics array in the synchronous response so the agent
 *      self-corrects in-turn (R7);
 *   2. writes both head bodies to S3 (digest = canonical markdown record,
 *      render = single-file HTML) under the two-key rule (KTD4);
 *   3. upserts the born-as-artifact row keyed by (thread, documentId) —
 *      deterministic id, exactly-once under concurrency, mirroring
 *      born-artifact.ts (KTD8);
 *   4. on `status: "final"`, pins both bodies as a content-addressed,
 *      write-once version (combined hash over digest+render) and flips status
 *      via the head_write_seq guarded UPDATE;
 *   5. appends only a compact card event (≤ DOCUMENT_CARD_MAX_BYTES) to the
 *      thread pipeline (R4).
 *
 * The acting user is derived SERVER-SIDE from the turn's triggering message
 * (never trusted from the payload): it stamps `artifact_versions.created_by`
 * and authorizes finalize-time space assignment member-or-above (THINK-145
 * KTD8 — never the service principal alone).
 *
 * Log hygiene: this module never logs body content — sizes, hashes, and
 * diagnostic codes only.
 */

import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@thinkwork/database-pg";
import {
  documentSectionWaivers,
  messages,
} from "@thinkwork/database-pg/schema";
import {
  and,
  artifacts,
  artifactVersions,
  db,
  eq,
  sql,
} from "../../graphql/utils.js";
import { creatorUserIdForThread } from "./artifact-creator.js";
import {
  buildManifestSnapshot,
  recordDocumentConformance,
} from "./document-conformance.js";
import { hasSpaceWriteRole } from "./canvas-access.js";
import {
  compileDocument,
  type CompositorDiagnostic,
} from "./document-compositor.js";
import { boundedCanvasText } from "./canvas-lifecycle.js";
import {
  DOCUMENT_CARD_MAX_BYTES,
  runDocumentPreflight,
  type DocumentPreflightResult,
} from "./document-preflight.js";
import {
  artifactContentKey,
  artifactRenderKey,
  writeArtifactPayloadToS3,
} from "./payload-storage.js";
import {
  ingestDocumentArtifactMemory,
  type DocumentMemoryInput,
} from "./document-memory.js";
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
} from "../thread-turn-events.js";
import { notifyThreadTurnStep } from "../../graphql/notify.js";
import {
  resolvePlateForEmission,
  type EmissionPlateResolution,
} from "./plate-registry.js";
import { resolveRunActingUserId } from "../agent-loops/run-acting-user.js";

/** `artifacts.metadata.kind` for dual-body document artifacts. */
export const DOCUMENT_METADATA_KIND = "document" as const;

/**
 * Genre IS the artifact `type` (lowercase DB value). THINK-153: the genre set
 * is registry-driven — the plate registry (plate-registry.ts) validates slugs
 * at emission time; the old hardcoded DOCUMENT_GENRES enum is gone.
 */
export const DOCUMENT_GENRE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `thread_turn_events.payload.kind` for the compact in-thread card (R4). */
export const DOCUMENT_CARD_PAYLOAD_KIND = "document.card" as const;

export const DOCUMENT_RENDER_CONTENT_TYPE = "text/html; charset=utf-8" as const;
export const DOCUMENT_DIGEST_CONTENT_TYPE =
  "text/markdown; charset=utf-8" as const;

/** True when the artifact row is a dual-body document. */
export function isDocumentMetadata(metadata: unknown): boolean {
  const parsed = parseMetadata(metadata);
  return (
    parsed !== null &&
    (parsed as { kind?: unknown }).kind === DOCUMENT_METADATA_KIND
  );
}

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === "string") {
    try {
      return parseMetadata(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  return metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

/**
 * Deterministic artifact id keyed by (tenant, thread, documentId) — the
 * primary-key upsert is exactly-once under concurrent re-emission, mirroring
 * `deriveCanvasArtifactId`. v5-shaped UUID from a SHA-256 of the key.
 */
export function deriveDocumentArtifactId(
  tenantId: string,
  threadId: string,
  documentId: string,
): string {
  const hex = createHash("sha256")
    .update(`document:${tenantId}:${threadId}:${documentId}`)
    .digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export interface DocumentEmitInput {
  documentId?: string;
  genre: string;
  title: string;
  abstract: string;
  digestMarkdown: string;
  status: "draft" | "final";
  spaceId?: string;
}

export type DocumentEmitParse =
  | { ok: true; value: DocumentEmitInput }
  | { ok: false; error: string };

/** Shape validation — tool bugs, not model-actionable content rejects. */
export function parseDocumentEmitInput(raw: unknown): DocumentEmitParse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "document must be an object" };
  }
  const doc = raw as Record<string, unknown>;
  const genre = doc.genre;
  if (typeof genre !== "string" || !DOCUMENT_GENRE_SLUG_RE.test(genre)) {
    return {
      ok: false,
      error:
        'document.genre must be a lowercase slug (letters, digits, hyphens), e.g. "report". The valid genres for this workspace are listed on the emit_document tool.',
    };
  }
  const title = typeof doc.title === "string" ? doc.title.trim() : "";
  if (!title) return { ok: false, error: "document.title is required" };
  if (typeof doc.digestMarkdown !== "string" || !doc.digestMarkdown.trim()) {
    return { ok: false, error: "document.digestMarkdown is required" };
  }
  if (doc.renderHtml !== undefined) {
    // THINK-154 retirement: the legacy dual-body shape is no longer accepted
    // (customer runtimes confirmed on the emit_document v2 cutover release).
    // Model-actionable so a lagging runtime's model can self-repair in-turn.
    return {
      ok: false,
      error:
        "document.renderHtml is no longer accepted — the platform compiles the document render from digestMarkdown. Re-emit WITHOUT render_html: put the document's full substance (frontmatter + markdown + tw: component blocks) in digest_markdown only.",
    };
  }
  const status = doc.status ?? "draft";
  if (status !== "draft" && status !== "final") {
    return { ok: false, error: 'document.status must be "draft" or "final"' };
  }
  if (
    doc.documentId !== undefined &&
    (typeof doc.documentId !== "string" ||
      doc.documentId.length === 0 ||
      doc.documentId.length > 128)
  ) {
    return {
      ok: false,
      error: "document.documentId must be a non-empty string (≤128 chars)",
    };
  }
  if (doc.spaceId !== undefined && typeof doc.spaceId !== "string") {
    return { ok: false, error: "document.spaceId must be a string" };
  }
  if (doc.spaceId !== undefined && status !== "final") {
    return {
      ok: false,
      error: 'document.spaceId is only valid with status "final"',
    };
  }
  return {
    ok: true,
    value: {
      documentId: doc.documentId as string | undefined,
      genre,
      title,
      abstract: typeof doc.abstract === "string" ? doc.abstract.trim() : "",
      digestMarkdown: doc.digestMarkdown,
      status,
      spaceId: doc.spaceId as string | undefined,
    },
  };
}

/** Injectable seams so tests exercise the flow without a live DB/S3. */
export interface DocumentEmissionDeps {
  preflight: (input: {
    renderHtml: string;
    digestMarkdown: string;
  }) => DocumentPreflightResult;
  /** THINK-153 (KTD3): registry validation between parse and compile. */
  resolvePlate: (input: {
    tenantId: string;
    slug: string;
  }) => Promise<EmissionPlateResolution>;
  /** THINK-154 (KTD1): compiles the v2 markdown-only shape into the render. */
  compile: typeof compileDocument;
  writePayload: typeof writeArtifactPayloadToS3;
  resolveActingUserId: (input: {
    tenantId: string;
    triggeringMessageId: string | null;
  }) => Promise<string | null>;
  /**
   * THINK-155 U1: second derivation source for scheduled turns — the
   * automation's run-as user (turn → run → `agent_loops.run_as_user_id`,
   * tenant-membership cross-checked). Consulted only when the triggering-
   * message source yields no user; human turns keep priority.
   */
  resolveRunActingUserId: (input: {
    tenantId: string;
    turnId: string;
  }) => Promise<string | null>;
  findExistingDraftDocument: (input: {
    tenantId: string;
    threadId: string;
    genre: string;
    title: string;
  }) => Promise<{ documentId: string } | null>;
  upsertDocumentRow: (input: {
    artifactId: string;
    tenantId: string;
    threadId: string;
    agentId: string | null;
    genre: string;
    title: string;
    abstract: string;
    documentId: string;
    digestKey: string;
    actingUserId: string | null;
  }) => Promise<void>;
  /**
   * THINK-183 U5: rewrite the artifact's section-waiver rows (delete +
   * reinsert, head semantics). Called only for manifest-bearing plates — a
   * contract-less emission never touches the waiver table.
   */
  replaceSectionWaivers: (input: {
    tenantId: string;
    artifactId: string;
    plateSlug: string;
    waivers: ReadonlyArray<{
      sectionId: string;
      tier: "required" | "required-if-material";
      reason: string;
    }>;
  }) => Promise<void>;
  /**
   * THINK-189 U3: append one conformance report for a manifest-bearing
   * emission. Best-effort — a recording failure logs and never touches the
   * emission outcome (R3).
   */
  recordConformance: typeof recordDocumentConformance;
  loadDocumentRow: (artifactId: string) => Promise<DocumentRow | null>;
  hasSpaceWriteRole: typeof hasSpaceWriteRole;
  pinDocumentHead: typeof pinDocumentHead;
  /**
   * Documents-as-memory (THINK-152 / THINK-193 P3): retain the digest +
   * colophon into the memory engine. Best-effort — a memory fault never fails
   * the emission.
   */
  ingestDocumentMemory: (input: DocumentMemoryInput) => Promise<unknown>;
  appendCardEvent: (input: {
    tenantId: string;
    turnId: string;
    threadId: string;
    agentId: string | null;
    title: string;
    card: Record<string, unknown>;
  }) => Promise<void>;
}

export interface DocumentRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  space_id: string | null;
  status: string;
  head_version: number | null;
  head_write_seq: number | null;
  metadata: unknown;
}

function defaultDeps(): DocumentEmissionDeps {
  return {
    preflight: runDocumentPreflight,
    resolvePlate: ({ tenantId, slug }) =>
      resolvePlateForEmission(tenantId, slug),
    compile: compileDocument,
    writePayload: writeArtifactPayloadToS3,
    resolveActingUserId: async ({ tenantId, triggeringMessageId }) => {
      if (!triggeringMessageId) return null;
      const rows = await getDb()
        .select({
          sender_type: messages.sender_type,
          sender_id: messages.sender_id,
        })
        .from(messages)
        .where(
          and(
            eq(messages.id, triggeringMessageId),
            eq(messages.tenant_id, tenantId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row && row.sender_type === "user" && row.sender_id
        ? row.sender_id
        : null;
    },
    resolveRunActingUserId: (input) => resolveRunActingUserId(input),
    findExistingDraftDocument: async ({ tenantId, threadId, genre, title }) => {
      const rows = await db
        .select({ metadata: artifacts.metadata })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.tenant_id, tenantId),
            eq(artifacts.thread_id, threadId),
            eq(artifacts.type, genre),
            eq(artifacts.title, title),
            eq(artifacts.status, "draft"),
            sql`${artifacts.metadata}->>'kind' = ${DOCUMENT_METADATA_KIND}`,
          ),
        )
        .limit(1);
      const meta = parseMetadata(rows[0]?.metadata);
      const documentId = meta?.documentId;
      return typeof documentId === "string" ? { documentId } : null;
    },
    upsertDocumentRow: async (input) => {
      const metadata = {
        kind: DOCUMENT_METADATA_KIND,
        genre: input.genre,
        documentId: input.documentId,
        createdBy: input.actingUserId,
      };
      const title = boundedCanvasText(input.title, 160);
      const summary = boundedCanvasText(input.abstract || input.title, 500);
      const createdByUserId =
        input.actingUserId ?? (await creatorUserIdForThread(input.threadId));
      await db
        .insert(artifacts)
        .values({
          id: input.artifactId,
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          thread_id: input.threadId,
          created_by_user_id: createdByUserId,
          title,
          type: input.genre,
          status: "draft",
          content: null,
          s3_key: input.digestKey,
          summary,
          metadata,
        })
        .onConflictDoUpdate({
          target: artifacts.id,
          // Re-emission refreshes the head and re-opens a working draft (F3:
          // edits after finalize start a new draft head; the pinned version
          // stays immutable). createdBy is preserved from the original insert.
          set: {
            title,
            summary,
            s3_key: input.digestKey,
            status: "draft",
            updated_at: new Date(),
          },
        });
    },
    replaceSectionWaivers: async ({
      tenantId,
      artifactId,
      plateSlug,
      waivers,
    }) => {
      await db
        .delete(documentSectionWaivers)
        .where(
          and(
            eq(documentSectionWaivers.tenant_id, tenantId),
            eq(documentSectionWaivers.artifact_id, artifactId),
          ),
        );
      if (waivers.length > 0) {
        await db.insert(documentSectionWaivers).values(
          waivers.map((w) => ({
            tenant_id: tenantId,
            artifact_id: artifactId,
            plate_slug: plateSlug,
            section_id: w.sectionId,
            tier: w.tier,
            reason: w.reason,
          })),
        );
      }
    },
    recordConformance: recordDocumentConformance,
    loadDocumentRow: async (artifactId) => {
      const rows = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, artifactId))
        .limit(1);
      return (rows[0] as DocumentRow | undefined) ?? null;
    },
    hasSpaceWriteRole,
    pinDocumentHead,
    ingestDocumentMemory: ingestDocumentArtifactMemory,
    appendCardEvent: async ({
      tenantId,
      turnId,
      threadId,
      agentId,
      title,
      card,
    }) => {
      const store = drizzleThreadTurnEventStore();
      const row = await appendThreadTurnEvent(store, {
        tenantId,
        runId: turnId,
        agentId,
        eventType: "ui_message_chunk",
        message: title,
        payload: { kind: DOCUMENT_CARD_PAYLOAD_KIND, card },
        stream: "ui",
      });
      await notifyThreadTurnStep({
        runId: turnId,
        threadId,
        tenantId,
        seq: row.seq,
        eventType: "ui_message_chunk",
        stream: "ui",
        level: null,
        color: null,
        message: title,
        payload: { kind: DOCUMENT_CARD_PAYLOAD_KIND, card },
        createdAt: new Date().toISOString(),
      }).catch((err) => {
        console.error(
          "[document-emission] card notify failed (best-effort):",
          err,
        );
      });
    },
  };
}

/**
 * Pin the document head (BOTH bodies) as a write-once, content-addressed
 * version and flip status to FINAL — the document counterpart of
 * `snapshotHeadToVersion`, hashing digest AND render together so a render-only
 * revision still produces a distinct pin. Guarded by the head_write_seq
 * conditional UPDATE (THINK-145 KTD6).
 */
export async function pinDocumentHead(input: {
  row: DocumentRow;
  userId: string | null;
  spaceId?: string;
  digestMarkdown: string;
  renderHtml: string;
}): Promise<{ headVersion: number; contentHash: string; pinned: boolean }> {
  const { row } = input;
  const contentHash = createHash("sha256")
    .update(input.digestMarkdown)
    .update(" ")
    .update(input.renderHtml)
    .digest("hex");

  // Idempotent re-finalize: same content already pinned as the latest version
  // while the row is FINAL → no new pin (AE3's second-finalize case).
  if (row.status === "final") {
    const latest = await db
      .select({ content_hash: artifactVersions.content_hash })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifact_id, row.id))
      .orderBy(sql`${artifactVersions.version} DESC`)
      .limit(1);
    if (latest[0]?.content_hash === contentHash) {
      return {
        headVersion: row.head_version ?? 0,
        contentHash,
        pinned: false,
      };
    }
  }

  const digestPinKey = artifactContentKey({
    tenantId: row.tenant_id,
    artifactId: row.id,
    revision: contentHash,
  });
  const renderPinKey = artifactRenderKey({
    tenantId: row.tenant_id,
    artifactId: row.id,
    revision: contentHash,
  });
  // Content-addressed and idempotent by key — safe to write before the guarded
  // UPDATE claims the pin.
  await writeArtifactPayloadToS3({
    tenantId: row.tenant_id,
    key: digestPinKey,
    body: input.digestMarkdown,
    contentType: DOCUMENT_DIGEST_CONTENT_TYPE,
  });
  await writeArtifactPayloadToS3({
    tenantId: row.tenant_id,
    key: renderPinKey,
    body: input.renderHtml,
    contentType: DOCUMENT_RENDER_CONTENT_TYPE,
  });

  const observedSeq = row.head_write_seq ?? 0;
  const newVersion = (row.head_version ?? 0) + 1;
  const updated = await db
    .update(artifacts)
    .set({
      status: "final",
      head_version: newVersion,
      head_write_seq: sql`${artifacts.head_write_seq} + 1`,
      updated_at: new Date(),
      ...(input.spaceId ? { space_id: input.spaceId } : {}),
    })
    .where(
      and(eq(artifacts.id, row.id), eq(artifacts.head_write_seq, observedSeq)),
    )
    .returning();
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new DocumentEmissionConflict(
      "Document head changed concurrently; retry the finalize",
    );
  }

  await db.insert(artifactVersions).values({
    tenant_id: row.tenant_id,
    artifact_id: row.id,
    version: newVersion,
    s3_key: digestPinKey,
    content_hash: contentHash,
    created_by: input.userId,
  });

  return { headVersion: newVersion, contentHash, pinned: true };
}

export class DocumentEmissionConflict extends Error {}

export interface DocumentEmissionResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

/**
 * Full `document.emit` flow. Returns an HTTP-shaped response the activity
 * handler serializes as-is; the tool surfaces `body` verbatim.
 */
export async function handleDocumentEmission(
  input: {
    tenantId: string;
    threadId: string;
    agentId: string | null;
    turnId: string;
    triggeringMessageId: string | null;
    raw: unknown;
  },
  deps: DocumentEmissionDeps = defaultDeps(),
): Promise<DocumentEmissionResponse> {
  const parsed = parseDocumentEmitInput(input.raw);
  if (!parsed.ok) {
    return {
      statusCode: 400,
      body: { ok: false, error: parsed.error, code: "BAD_REQUEST" },
    };
  }
  const doc = parsed.value;

  // ---- Plate registry (THINK-153 KTD3): validate the genre between parse
  // and compile. Unknown slug → self-repair rejection naming the valid set;
  // hidden slug → rejected for NEW documents, but a revision turn carrying an
  // existing document_id of that genre still compiles (hiding a plate must
  // not strand in-flight revisions).
  const resolution = await deps.resolvePlate({
    tenantId: input.tenantId,
    slug: doc.genre,
  });
  if (!resolution.ok) {
    return {
      statusCode: 200,
      body: {
        ok: false,
        code: "COMPILE_REJECTED",
        diagnostics: [
          {
            code: "UNKNOWN_GENRE",
            message: `Genre "${doc.genre}" is not registered for this workspace. Valid genres: ${resolution.visibleSlugs.join(", ")}. Re-emit with one of those slugs.`,
            location: "genre",
          },
        ],
      },
    };
  }
  const plate = resolution.plate;
  if (plate.hidden) {
    const revisionRow = doc.documentId
      ? await deps.loadDocumentRow(
          deriveDocumentArtifactId(
            input.tenantId,
            input.threadId,
            doc.documentId,
          ),
        )
      : null;
    if (!revisionRow) {
      return {
        statusCode: 200,
        body: {
          ok: false,
          code: "COMPILE_REJECTED",
          diagnostics: [
            {
              code: "GENRE_HIDDEN",
              message: `Genre "${doc.genre}" is hidden for this workspace and cannot start a new document. Valid genres: ${resolution.visibleSlugs.join(", ")}. Re-emit with one of those slugs.`,
              location: "genre",
            },
          ],
        },
      };
    }
  }

  // ---- Compositor (THINK-154 KTD1): compile the markdown into the house
  // render between parse and preflight — the only emission path. -----------
  const compiled = deps.compile({
    plate,
    title: doc.title,
    abstract: doc.abstract,
    markdownBody: doc.digestMarkdown,
  });
  if (!compiled.ok) {
    console.log(
      `[document-emission] compile rejected: ${compiled.diagnostics
        .map((d) => d.code)
        .join(",")} (digest ${Buffer.byteLength(doc.digestMarkdown, "utf8")}B)`,
    );
    return {
      statusCode: 200,
      body: {
        ok: false,
        code: "COMPILE_REJECTED",
        diagnostics: compiled.diagnostics,
      },
    };
  }
  const renderHtml = compiled.renderHtml;
  const compileWarnings = compiled.warnings;

  // ---- DocSpector (R6: retained runtime preflight before the S3 write) ----
  const preflight = deps.preflight({
    renderHtml,
    digestMarkdown: doc.digestMarkdown,
  });
  if (!preflight.ok) {
    // R6: a preflight failure on compiled output is a compiler defect —
    // log it as a platform error (codes + sizes + hash, never bodies) and
    // do NOT hand the model a retry it can't act on.
    const digestHash = createHash("sha256")
      .update(doc.digestMarkdown)
      .digest("hex");
    console.error(
      `[document-emission] COMPILER DEFECT: compiled output failed preflight: ${preflight.diagnostics
        .map((d) => `${d.code}@${d.location}`)
        .join(
          ",",
        )} (genre ${doc.genre}, digest ${Buffer.byteLength(doc.digestMarkdown, "utf8")}B sha256:${digestHash}, render ${Buffer.byteLength(renderHtml, "utf8")}B)`,
    );
    return {
      statusCode: 500,
      body: {
        ok: false,
        code: "COMPILER_DEFECT",
        error:
          "The platform failed to compile this document correctly. This is a platform defect, not a problem with your input — it has been logged. Do not retry with modified content.",
      },
    };
  }

  // ---- Identity: documentId fallback (KTD8) + acting user ----------------
  let documentId = doc.documentId ?? null;
  if (!documentId) {
    const existing = await deps.findExistingDraftDocument({
      tenantId: input.tenantId,
      threadId: input.threadId,
      genre: doc.genre,
      title: doc.title,
    });
    documentId = existing?.documentId ?? randomUUID();
  }
  const artifactId = deriveDocumentArtifactId(
    input.tenantId,
    input.threadId,
    documentId,
  );
  let actingUserId = await deps.resolveActingUserId({
    tenantId: input.tenantId,
    triggeringMessageId: input.triggeringMessageId,
  });
  // THINK-155 U1: scheduled turns (no triggering user message) fall back to
  // the automation's run-as user; human turns keep priority. The source
  // distinction also drives write ordering (U2 keep-last-good).
  let actingUserSource: "message" | "run" | null = actingUserId
    ? "message"
    : null;
  if (!actingUserId) {
    actingUserId = await deps.resolveRunActingUserId({
      tenantId: input.tenantId,
      turnId: input.turnId,
    });
    if (actingUserId) actingUserSource = "run";
  }

  // ---- Finalize-time space authorization (before any write) --------------
  if (doc.status === "final" && doc.spaceId) {
    if (!actingUserId) {
      return {
        statusCode: 200,
        body: {
          ok: false,
          code: "FORBIDDEN",
          error:
            "Space assignment requires an acting user (turn has no triggering user message). Finalize without spaceId, or have the user finalize.",
        },
      };
    }
    const allowed = await deps.hasSpaceWriteRole(
      input.tenantId,
      doc.spaceId,
      actingUserId,
    );
    if (!allowed) {
      return {
        statusCode: 200,
        body: {
          ok: false,
          code: "FORBIDDEN",
          error:
            "The acting user is not a member of the target space; the document was not modified.",
        },
      };
    }
  }

  // ---- Head writes (two-key rule) + born-as-artifact upsert --------------
  const digestKey = artifactContentKey({
    tenantId: input.tenantId,
    artifactId,
  });
  const renderKey = artifactRenderKey({
    tenantId: input.tenantId,
    artifactId,
  });
  await deps.writePayload({
    tenantId: input.tenantId,
    key: digestKey,
    body: doc.digestMarkdown,
    contentType: DOCUMENT_DIGEST_CONTENT_TYPE,
  });
  await deps.writePayload({
    tenantId: input.tenantId,
    key: renderKey,
    body: renderHtml,
    contentType: DOCUMENT_RENDER_CONTENT_TYPE,
  });
  await deps.upsertDocumentRow({
    artifactId,
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: input.agentId,
    genre: doc.genre,
    title: doc.title,
    abstract: doc.abstract,
    documentId,
    digestKey,
    actingUserId,
  });

  // THINK-183 U5: head-semantics waiver rewrite. Only manifest-bearing plates
  // touch the table — a re-emission with zero waivers clears prior rows, and
  // a contract-less plate issues no statement at all (AE4 inert path).
  if ((plate.sections?.length ?? 0) > 0) {
    await deps.replaceSectionWaivers({
      tenantId: input.tenantId,
      artifactId,
      plateSlug: plate.slug,
      waivers: compiled.waivers,
    });
  }

  // ---- Finalize: pin both bodies + flip (KTD8) ----------------------------
  let headVersion = 0;
  let status: "draft" | "final" = "draft";
  // Space owner for memory routing: the finalize input wins; a re-emitted
  // draft of a previously space-assigned document keeps the row's space.
  let memorySpaceId: string | null = doc.spaceId ?? null;
  if (doc.status === "final") {
    const row = await deps.loadDocumentRow(artifactId);
    if (!row) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error: "Document row missing after upsert",
          code: "INTERNAL",
        },
      };
    }
    memorySpaceId = doc.spaceId ?? row.space_id ?? null;
    try {
      const pin = await deps.pinDocumentHead({
        row,
        userId: actingUserId,
        spaceId: doc.spaceId,
        digestMarkdown: doc.digestMarkdown,
        renderHtml,
      });
      headVersion = pin.headVersion;
      status = "final";
    } catch (err) {
      if (err instanceof DocumentEmissionConflict) {
        return {
          statusCode: 200,
          body: { ok: false, code: "CONFLICT", error: err.message },
        };
      }
      throw err;
    }
  } else {
    const row = await deps.loadDocumentRow(artifactId);
    headVersion = row?.head_version ?? 0;
    memorySpaceId = row?.space_id ?? null;
  }

  // THINK-189 U3: append one conformance report per manifest-bearing
  // emission (corpus semantics, unlike the waiver head-rewrite above).
  // Best-effort and awaited — an INSERT is fast, and fire-and-forget
  // promises die at Lambda freeze; a failure logs and the emission proceeds.
  if ((plate.sections?.length ?? 0) > 0 && compiled.sectionFacts) {
    try {
      await deps.recordConformance({
        tenantId: input.tenantId,
        artifactId,
        plateSlug: plate.slug,
        documentStatus: status,
        digestMarkdown: doc.digestMarkdown,
        sectionFacts: compiled.sectionFacts,
        manifestSnapshot: buildManifestSnapshot(plate),
      });
    } catch (err) {
      console.error(
        "[document-emission] conformance record failed (best-effort):",
        err,
      );
    }
  }

  // ---- Documents-as-memory (THINK-152 / THINK-193 P3) --------------------
  // Best-effort like the card append: the document is durably persisted; a
  // memory fault costs Brain ingestion, not data.
  await deps
    .ingestDocumentMemory({
      tenantId: input.tenantId,
      threadId: input.threadId,
      agentId: input.agentId,
      artifactId,
      documentId,
      genre: doc.genre,
      title: doc.title,
      abstract: doc.abstract,
      digestMarkdown: doc.digestMarkdown,
      status,
      headVersion,
      actingUserId,
      spaceId: memorySpaceId,
      emittedAt: new Date().toISOString(),
    })
    .catch((err) => {
      console.error(
        "[document-emission] memory ingest failed (best-effort):",
        err,
      );
    });

  // ---- Compact card event (R4) — abstract truncated to the ceiling -------
  const card = buildDocumentCard({
    artifactId,
    title: doc.title,
    genre: doc.genre,
    abstract: doc.abstract,
    status,
    headVersion,
  });
  await deps
    .appendCardEvent({
      tenantId: input.tenantId,
      turnId: input.turnId,
      threadId: input.threadId,
      agentId: input.agentId,
      title: boundedCanvasText(doc.title, 160),
      card,
    })
    .catch((err) => {
      // Best-effort like every activity append side-effect: the document is
      // durably persisted; a card fault costs thread visibility, not data.
      console.error(
        "[document-emission] card append failed (best-effort):",
        err,
      );
    });

  return {
    statusCode: 200,
    body: {
      ok: true,
      artifactId,
      documentId,
      status,
      headVersion,
      ...(compileWarnings.length > 0 ? { warnings: compileWarnings } : {}),
    },
  };
}

/** Build the ≤10KB thread card; truncates the abstract to fit (R4). */
export function buildDocumentCard(input: {
  artifactId: string;
  title: string;
  genre: string;
  abstract: string;
  status: "draft" | "final";
  headVersion: number;
}): Record<string, unknown> {
  const base = {
    artifactId: input.artifactId,
    title: boundedCanvasText(input.title, 160),
    genre: input.genre,
    status: input.status,
    headVersion: input.headVersion,
  };
  let abstract = input.abstract.trim();
  let card = { ...base, abstract };
  // JSON size includes the envelope; shrink the abstract until it fits.
  while (
    Buffer.byteLength(JSON.stringify(card), "utf8") > DOCUMENT_CARD_MAX_BYTES &&
    abstract.length > 0
  ) {
    abstract = abstract.slice(0, Math.floor(abstract.length / 2)).trimEnd();
    card = { ...base, abstract: abstract ? `${abstract}…` : "" };
  }
  return card;
}
