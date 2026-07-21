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
  threadTurns,
} from "@thinkwork/database-pg/schema";
import {
  and,
  artifacts,
  artifactVersions,
  db,
  desc,
  eq,
  inArray,
  sql,
  threadTurnEvents,
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
import {
  resolveTurnRunContext,
  type TurnRunContext,
} from "../agent-loops/run-acting-user.js";
import { captureDocumentBindingArtifact } from "../agent-loops/document-binding-capture.js";
import { recordDocumentRefreshFailure } from "@thinkwork/database-pg";

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

/** The logical documentId recorded on a document artifact row's metadata. */
function metadataDocumentId(row: DocumentRow): string | null {
  const meta = parseMetadata(row.metadata);
  const documentId = meta?.documentId;
  return typeof documentId === "string" && documentId ? documentId : null;
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
   * automation's run context (turn → run → `agent_loops`), whose
   * `actingUserId` is the tenant-membership-cross-checked run-as user.
   * Consulted only when the triggering-message source yields no user; human
   * turns keep priority.
   */
  resolveTurnRunContext: (input: {
    tenantId: string;
    turnId: string;
  }) => Promise<TurnRunContext | null>;
  /**
   * THINK-155 U5 (KTD4): the bound document's artifact id for this turn, read
   * from `thread_turns.context_snapshot.agentLoop.documentId` (the wakeup
   * payload spreads into the snapshot). Null when the run carries no binding
   * — every production dispatch path today (ship-inert). Unlike identity,
   * this IS payload-carried by design: it is a target constraint the server
   * enforces, not a trust input.
   */
  resolveBoundDocumentId: (input: {
    tenantId: string;
    turnId: string;
  }) => Promise<string | null>;
  /**
   * THINK-155 U3: stamp a successful scheduled refresh — sets
   * `artifacts.last_refresh_at`, clears `refresh_failed_at`. Best-effort;
   * called only on the run-derived path.
   */
  markRefreshSucceeded: (input: {
    tenantId: string;
    artifactId: string;
  }) => Promise<void>;
  /**
   * THINK-227 U3: first-run capture — after a run-derived finalize pins the
   * document, write the artifact id back into the automation's create-mode
   * binding (`target_spec.documentBinding.capturedArtifactId`, first writer
   * wins; no-op for existing-mode or already-captured bindings). Best-effort;
   * optional so test harnesses without capture concerns keep compiling.
   */
  captureBindingArtifact?: (input: {
    tenantId: string;
    agentLoopId: string;
    artifactId: string;
  }) => Promise<{ captured: boolean }>;
  /**
   * THINK-155 U3 → THINK-227 U6: record a failed scheduled refresh — stamps
   * `artifacts.refresh_failed_at` (the reader's amber stale state). The
   * inbox writer is retired (R5); the failure's run-facing record is the run
   * ledger/step evidence the finalize path persists. Best-effort; called
   * only on the run-derived path.
   */
  recordRefreshFailure: (input: {
    tenantId: string;
    agentLoopId: string;
    loopName: string | null;
    runId: string;
    errorCode: string;
    errorMessage: string;
    artifactId: string | null;
  }) => Promise<void>;
  /**
   * In-thread continuity for interactive emits (no documentId carried): the
   * document this thread is already working on, so a follow-up edit revises
   * it instead of forking a copy. Two sources, in priority order:
   *   1. a document row homed in this thread (draft OR final — F3: edits
   *      after finalize re-open a draft head) matching genre+title;
   *   2. the thread's most recent `document.card` event matching genre+title
   *      — covers documents emitted INTO this thread by a bound automation
   *      run whose artifact row is homed in another thread.
   */
  findThreadDocumentForRevision: (input: {
    tenantId: string;
    threadId: string;
    genre: string;
    title: string;
  }) => Promise<DocumentRow | null>;
  /**
   * The document row carrying a logical `metadata.documentId` — the token the
   * agent carries between emits. Tenant-wide: a carried documentId names one
   * living document no matter which thread emits, so revising from a thread
   * other than the row's home thread must never fork a per-thread copy.
   */
  findDocumentByLogicalId: (input: {
    tenantId: string;
    documentId: string;
  }) => Promise<DocumentRow | null>;
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
    /**
     * THINK-155 U2: run-derived refreshes must never demote a finalized
     * document to draft mid-emission — on conflict, update metadata only and
     * leave `status` (and the head pointer) to the finalize pin.
     */
    preserveHeadOnConflict?: boolean;
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
    resolveTurnRunContext: (input) => resolveTurnRunContext(input),
    resolveBoundDocumentId: async ({ tenantId, turnId }) => {
      const rows = await getDb()
        .select({ context_snapshot: threadTurns.context_snapshot })
        .from(threadTurns)
        .where(
          and(eq(threadTurns.id, turnId), eq(threadTurns.tenant_id, tenantId)),
        )
        .limit(1);
      const snapshot = rows[0]?.context_snapshot;
      const agentLoop =
        snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
          ? (snapshot as Record<string, unknown>).agentLoop
          : null;
      const documentId =
        agentLoop && typeof agentLoop === "object" && !Array.isArray(agentLoop)
          ? (agentLoop as Record<string, unknown>).documentId
          : null;
      return typeof documentId === "string" && documentId ? documentId : null;
    },
    markRefreshSucceeded: async ({ tenantId, artifactId }) => {
      await db
        .update(artifacts)
        .set({
          last_refresh_at: new Date(),
          refresh_failed_at: null,
          updated_at: new Date(),
        })
        .where(
          and(eq(artifacts.id, artifactId), eq(artifacts.tenant_id, tenantId)),
        );
    },
    captureBindingArtifact: (input) => captureDocumentBindingArtifact(input),
    recordRefreshFailure: (input) =>
      recordDocumentRefreshFailure(getDb(), { ...input, now: new Date() }),
    findThreadDocumentForRevision: async ({
      tenantId,
      threadId,
      genre,
      title,
    }) => {
      // Rows store the bounded title (upsertDocumentRow) — compare likewise.
      const boundedTitle = boundedCanvasText(title, 160);
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.tenant_id, tenantId),
            eq(artifacts.thread_id, threadId),
            eq(artifacts.type, genre),
            eq(artifacts.title, boundedTitle),
            inArray(artifacts.status, ["draft", "final"]),
            sql`${artifacts.metadata}->>'kind' = ${DOCUMENT_METADATA_KIND}`,
          ),
        )
        .orderBy(desc(artifacts.updated_at))
        .limit(1);
      if (rows[0]) return rows[0] as DocumentRow;

      // Card-event fallback: a bound automation run emits into this thread
      // but homes the artifact row in the automation's own thread. The card
      // the thread displays is the continuity record. Bounded scan of the
      // thread's recent cards, newest first.
      const cards = await db
        .select({ payload: threadTurnEvents.payload })
        .from(threadTurnEvents)
        .innerJoin(threadTurns, eq(threadTurnEvents.run_id, threadTurns.id))
        .where(
          and(
            eq(threadTurnEvents.tenant_id, tenantId),
            eq(threadTurns.thread_id, threadId),
            sql`${threadTurnEvents.payload}->>'kind' = ${DOCUMENT_CARD_PAYLOAD_KIND}`,
          ),
        )
        .orderBy(desc(threadTurnEvents.id))
        .limit(20);
      for (const row of cards) {
        const card = (row.payload as { card?: Record<string, unknown> } | null)
          ?.card;
        if (
          card &&
          card.genre === genre &&
          card.title === boundedTitle &&
          typeof card.artifactId === "string"
        ) {
          const doc = await db
            .select()
            .from(artifacts)
            .where(
              and(
                eq(artifacts.id, card.artifactId),
                eq(artifacts.tenant_id, tenantId),
                inArray(artifacts.status, ["draft", "final"]),
              ),
            )
            .limit(1);
          if (doc[0]) return doc[0] as DocumentRow;
        }
      }
      return null;
    },
    findDocumentByLogicalId: async ({ tenantId, documentId }) => {
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.tenant_id, tenantId),
            inArray(artifacts.status, ["draft", "final"]),
            sql`${artifacts.metadata}->>'kind' = ${DOCUMENT_METADATA_KIND}`,
            sql`${artifacts.metadata}->>'documentId' = ${documentId}`,
          ),
        )
        .orderBy(desc(artifacts.updated_at))
        .limit(1);
      return (rows[0] as DocumentRow | undefined) ?? null;
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
          // Run-derived refreshes (THINK-155 U2) update metadata only —
          // status stays untouched so readers never see a draft flash.
          set: input.preserveHeadOnConflict
            ? { title, summary, updated_at: new Date() }
            : {
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
    /**
     * Exact human identity already re-authorized from a non-message action
     * chain (for example an answered question card). Never populate this
     * from an invoke payload; ordinary message turns keep resolving sender
     * identity from triggeringMessageId below.
     */
    trustedActingUserId?: string | null;
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

  // ---- Identity: acting user + documentId fallback (KTD8) ----------------
  // Resolved before the content gates so a failed scheduled refresh can be
  // recorded against its automation (THINK-155 U3).
  // A normal message remains the authoritative identity source even if a
  // caller accidentally supplies both fields. Trusted action identity is
  // accepted only for turns that have no triggering human message.
  let actingUserId = input.triggeringMessageId
    ? null
    : (input.trustedActingUserId ?? null);
  if (!actingUserId) {
    actingUserId = await deps.resolveActingUserId({
      tenantId: input.tenantId,
      triggeringMessageId: input.triggeringMessageId,
    });
  }
  // THINK-155 U1: scheduled turns (no triggering user message) fall back to
  // the automation's run-as user; human turns keep priority. The run context
  // also drives write ordering (U2 keep-last-good) and failure
  // observability (U3).
  let runContext: TurnRunContext | null = null;
  if (!actingUserId) {
    runContext = await deps.resolveTurnRunContext({
      tenantId: input.tenantId,
      turnId: input.turnId,
    });
    actingUserId = runContext?.actingUserId ?? null;
  }
  const runDerived = runContext !== null;

  // THINK-155 U3: a failed scheduled *finalize* is recorded (refresh stamp +
  // deduplicated inbox item). Draft-stage rejections are the agent's in-turn
  // self-correction loop (DocSpector-style), not a refresh failure yet — the
  // run either recovers with a successful finalize or fails terminally
  // (caught by the finalize-projection path). Best-effort: recording never
  // masks the emission response.
  let refreshArtifactId: string | null = null;
  const recordScheduledRefreshFailure = async (
    errorCode: string,
    errorMessage: string,
  ) => {
    if (!runContext || doc.status !== "final") return;
    try {
      await deps.recordRefreshFailure({
        tenantId: input.tenantId,
        agentLoopId: runContext.agentLoopId,
        loopName: runContext.loopName,
        runId: runContext.runId,
        errorCode,
        errorMessage,
        artifactId: refreshArtifactId,
      });
    } catch (err) {
      console.error(
        "[document-emission] refresh-failure record failed (best-effort):",
        err,
      );
    }
  };

  // ---- Bound-document target enforcement (THINK-155 U5, KTD4) ------------
  // When the run's payload carries a bound documentId (an artifact id), every
  // emit on this turn revises exactly that artifact — the agent cannot fork a
  // duplicate report through instruction drift. Inert today: no production
  // dispatch path sets it until THINK-213's binding config lands.
  let boundArtifact: DocumentRow | null = null;
  if (runDerived) {
    const boundId = await deps.resolveBoundDocumentId({
      tenantId: input.tenantId,
      turnId: input.turnId,
    });
    if (boundId) {
      const row = await deps.loadDocumentRow(boundId);
      // KTD1-mirror cross-check: the bound artifact must exist in the turn's
      // tenant. A cross-tenant or dangling binding rejects with no write.
      if (!row || row.tenant_id !== input.tenantId) {
        await recordScheduledRefreshFailure(
          "BOUND_DOCUMENT_INVALID",
          `Bound document ${boundId} was not found in this workspace`,
        );
        return {
          statusCode: 200,
          body: {
            ok: false,
            code: "BOUND_DOCUMENT_INVALID",
            error:
              "This run maintains a bound document that could not be resolved in this workspace. Do not create a replacement document; report the failure instead.",
          },
        };
      }
      refreshArtifactId = row.id;
      const boundLogicalId = metadataDocumentId(row) ?? row.id;
      if (
        doc.documentId &&
        doc.documentId !== boundLogicalId &&
        doc.documentId !== row.id
      ) {
        return {
          statusCode: 200,
          body: {
            ok: false,
            code: "BOUND_DOCUMENT_MISMATCH",
            error: `This run maintains one bound document; emit with document_id "${boundLogicalId}" (or omit document_id) instead of starting a new document.`,
          },
        };
      }
      boundArtifact = row;
    }
  }

  let documentId: string;
  let artifactId: string;
  if (boundArtifact) {
    // Revisions target the bound artifact regardless of the turn's thread —
    // the (tenant, thread, documentId) derivation would fork a copy when the
    // automation runs in a fresh thread.
    documentId = metadataDocumentId(boundArtifact) ?? boundArtifact.id;
    artifactId = boundArtifact.id;
  } else if (doc.documentId) {
    // A carried documentId names ONE living document tenant-wide. Resolve it
    // to the existing row wherever it is homed — the (tenant, thread,
    // documentId) derivation is only for documents born in this thread, and
    // deriving here for a document homed in another thread (e.g. created by
    // an automation run) would fork a same-title copy. Adopting a row homed
    // elsewhere into a space requires the acting user to hold write access
    // to that space; otherwise fall back to the thread-local derivation.
    documentId = doc.documentId;
    const derived = deriveDocumentArtifactId(
      input.tenantId,
      input.threadId,
      documentId,
    );
    let adopted: DocumentRow | null = null;
    if (!runDerived) {
      const existing =
        (await deps.loadDocumentRow(derived)) ??
        (await deps.findDocumentByLogicalId({
          tenantId: input.tenantId,
          documentId,
        }));
      if (existing && existing.tenant_id === input.tenantId) {
        if (existing.id === derived || !existing.space_id) {
          adopted = existing;
        } else if (actingUserId) {
          const allowed = await deps.hasSpaceWriteRole(
            input.tenantId,
            existing.space_id,
            actingUserId,
          );
          if (allowed) adopted = existing;
        }
      }
    }
    artifactId = adopted ? adopted.id : derived;
  } else {
    // THINK-155 U2: run-derived turns never adopt a stray row — continuity
    // rides the documentId the agent carries between emits (or the binding).
    if (runDerived) {
      documentId = randomUUID();
      artifactId = deriveDocumentArtifactId(
        input.tenantId,
        input.threadId,
        documentId,
      );
    } else {
      // Interactive continuity: a follow-up emit in a thread that already
      // has this document (own row or an automation-emitted card) revises it
      // — one living document per thread, never a same-title fork.
      const existing = await deps.findThreadDocumentForRevision({
        tenantId: input.tenantId,
        threadId: input.threadId,
        genre: doc.genre,
        title: doc.title,
      });
      if (existing) {
        documentId = metadataDocumentId(existing) ?? existing.id;
        artifactId = existing.id;
      } else {
        documentId = randomUUID();
        artifactId = deriveDocumentArtifactId(
          input.tenantId,
          input.threadId,
          documentId,
        );
      }
    }
  }
  refreshArtifactId = artifactId;

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
    await recordScheduledRefreshFailure(
      "COMPILE_REJECTED",
      `UNKNOWN_GENRE: genre "${doc.genre}" is not registered`,
    );
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
    // artifactId is already resolved (bound, carried, adopted, or fresh) —
    // an existing row of the hidden genre means this is a revision, allowed.
    const revisionRow = await deps.loadDocumentRow(artifactId);
    if (!revisionRow) {
      await recordScheduledRefreshFailure(
        "COMPILE_REJECTED",
        `GENRE_HIDDEN: genre "${doc.genre}" cannot start a new document`,
      );
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
    await recordScheduledRefreshFailure(
      "COMPILE_REJECTED",
      compiled.diagnostics.map((d) => d.code).join(", "),
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

  // Plate identity + per-section outcomes for the emit response. The tool
  // surfaces these in its activity details so the thread shows WHICH plate
  // authored the document and how each contract section fared (present /
  // waived / missing) instead of an anonymous "Using emit document" row.
  const plateOutcome = {
    plate: { slug: plate.slug, displayName: plate.displayName },
    ...(compiled.sectionFacts
      ? {
          sections: compiled.sectionFacts.sections.map((fact) => ({
            id: fact.id,
            title:
              plate.sections?.find((section) => section.id === fact.id)
                ?.title ?? fact.id,
            tier: fact.tier,
            status: fact.status,
          })),
        }
      : {}),
  };

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
    await recordScheduledRefreshFailure(
      "COMPILER_DEFECT",
      preflight.diagnostics.map((d) => `${d.code}@${d.location}`).join(", "),
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

  // ---- Finalize-time space authorization (before any write) --------------
  if (doc.status === "final" && doc.spaceId) {
    if (!actingUserId) {
      const failure = {
        statusCode: 200,
        body: {
          ok: false,
          code: "FORBIDDEN",
          error: runContext
            ? "The automation's run-as user is unset or no longer an active tenant member; finalize into a space requires a valid run-as user."
            : "Space assignment requires an acting user (turn has no triggering user message). Finalize without spaceId, or have the user finalize.",
        },
      };
      await recordScheduledRefreshFailure("FORBIDDEN", failure.body.error);
      return failure;
    }
    const allowed = await deps.hasSpaceWriteRole(
      input.tenantId,
      doc.spaceId,
      actingUserId,
    );
    if (!allowed) {
      const failure = {
        statusCode: 200,
        body: {
          ok: false,
          code: "FORBIDDEN",
          error:
            "The acting user is not a member of the target space; the document was not modified.",
        },
      };
      await recordScheduledRefreshFailure("FORBIDDEN", failure.body.error);
      return failure;
    }
  }

  // ---- THINK-155 U2: run-derived draft emits stage nothing visible -------
  // Each emit carries the full document, so a scheduled draft needs no
  // persistence: the response's documentId is the continuity token the agent
  // carries into the finalize emit, and the document row is created only at
  // finalize. Readers keep seeing the last finalized state throughout.
  if (runDerived && doc.status !== "final") {
    const row = await deps.loadDocumentRow(artifactId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        artifactId,
        documentId,
        status: "draft",
        headVersion: row?.head_version ?? 0,
        ...plateOutcome,
        ...(compileWarnings.length > 0 ? { warnings: compileWarnings } : {}),
      },
    };
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
  const writeHeadBodies = async () => {
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
  };
  const writeWaivers = async () => {
    // THINK-183 U5: head-semantics waiver rewrite. Only manifest-bearing
    // plates touch the table — a re-emission with zero waivers clears prior
    // rows, and a contract-less plate issues no statement at all (AE4 inert
    // path).
    if ((plate.sections?.length ?? 0) > 0) {
      await deps.replaceSectionWaivers({
        tenantId: input.tenantId,
        artifactId,
        plateSlug: plate.slug,
        waivers: compiled.waivers,
      });
    }
  };

  let headVersion = 0;
  let status: "draft" | "final" = "draft";
  // Space owner for memory routing: the finalize input wins; a re-emitted
  // draft of a previously space-assigned document keeps the row's space.
  let memorySpaceId: string | null = doc.spaceId ?? null;

  if (runDerived) {
    // ---- THINK-155 U2: keep-last-good ordering for scheduled finalize ----
    // The visible head (head render key — the body resolver always reads it)
    // and `artifacts.status` change only after the pin succeeds. A failure or
    // crash anywhere in this block leaves readers on the last finalized
    // version; the pin's own S3 writes are content-addressed and idempotent,
    // so a retried emission converges instead of colliding with staged keys.
    const preexisting = await deps.loadDocumentRow(artifactId);
    if (!preexisting) {
      // First emission: no last-good state to preserve — write the head
      // bodies up front so the fresh row never dangles without content.
      await writeHeadBodies();
    }
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
      // Never demote a finalized document to draft mid-refresh (draft flash).
      preserveHeadOnConflict: true,
    });
    const row = await deps.loadDocumentRow(artifactId);
    if (!row) {
      await recordScheduledRefreshFailure(
        "INTERNAL",
        "Document row missing after upsert",
      );
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
        await recordScheduledRefreshFailure("CONFLICT", err.message);
        return {
          statusCode: 200,
          body: { ok: false, code: "CONFLICT", error: err.message },
        };
      }
      throw err;
    }
    if (preexisting) {
      // The head swap is the last visible step (KTD2).
      await writeHeadBodies();
    }
    await writeWaivers();
    // THINK-155 U3: the refresh succeeded — stamp it (best-effort).
    try {
      await deps.markRefreshSucceeded({
        tenantId: input.tenantId,
        artifactId,
      });
    } catch (err) {
      console.error(
        "[document-emission] refresh-success stamp failed (best-effort):",
        err,
      );
    }
    // THINK-227 U3: first-run capture — a create-mode binding locks onto the
    // artifact its first successful finalize produced (first writer wins;
    // the capture module guards mode + already-captured). Best-effort.
    if (runContext && deps.captureBindingArtifact) {
      try {
        await deps.captureBindingArtifact({
          tenantId: input.tenantId,
          agentLoopId: runContext.agentLoopId,
          artifactId,
        });
      } catch (err) {
        console.error(
          "[document-emission] binding capture failed (best-effort):",
          err,
        );
      }
    }
  } else {
    await writeHeadBodies();
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
    await writeWaivers();

    // ---- Finalize: pin both bodies + flip (KTD8) -------------------------
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
    documentId,
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
      ...plateOutcome,
      ...(compileWarnings.length > 0 ? { warnings: compileWarnings } : {}),
    },
  };
}

/** Build the ≤10KB thread card; truncates the abstract to fit (R4). */
export function buildDocumentCard(input: {
  artifactId: string;
  /**
   * Logical document id — the durable identity. Clients fall back to it when
   * the card's artifactId no longer resolves (a fork cleaned up, a re-homed
   * document), so old cards keep opening the living document.
   */
  documentId?: string;
  title: string;
  genre: string;
  abstract: string;
  status: "draft" | "final";
  headVersion: number;
}): Record<string, unknown> {
  const base = {
    artifactId: input.artifactId,
    ...(input.documentId ? { documentId: input.documentId } : {}),
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
