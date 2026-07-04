/**
 * Living Artifacts (THINK-145 U4): born-as-artifact upsert.
 *
 * Every emitted GenUI canvas is an artifact row from first emission (R10). This
 * runs server-side in the chat-agent-activity append path (the plan's chosen
 * seam — a server-side upsert here avoids runtime→API chatter) when a
 * json-render part event arrives, keyed by the part's stable id.
 *
 * The upsert is exactly-once per (thread, stable part id) under concurrent
 * re-emission because the artifact id is deterministically derived from those
 * keys and inserted with `ON CONFLICT (id)` — re-emission updates the same row
 * (only while it is still a draft) rather than creating a duplicate. A canvas
 * that has already been SAVED (status != 'draft') is never overwritten by a
 * stray re-emission; the U8 check-in path owns saved-canvas head updates.
 *
 * U8 check-out routing (R13): when a SAVED canvas has been checked out into a
 * thread, that thread's re-emission of the same stable part id must update the
 * ORIGINAL artifact's head — not mint a new (thread, part)-derived draft. The
 * check-out records a `{threadId}` entry in the original artifact's
 * `metadata.checkouts` array; {@link findCheckoutRoutedArtifact} consults it
 * before the derive path. An unrelated thread emitting the same stable id with
 * NO check-out record still gets its own artifact (collision safety).
 */

import { createHash } from "node:crypto";
import {
  stableStringify,
  validateThreadJsonRenderPersistedPart,
  type ThreadJsonRenderPart,
} from "../thread-json-render/persisted-parts.js";
import { partFromThreadJsonRenderStateSnapshotPayload } from "@thinkwork/thread-json-render";
import { and, artifacts, db, eq, sql } from "../../graphql/utils.js";
import {
  artifactContentKey,
  writeArtifactPayloadToS3,
} from "./payload-storage.js";
import {
  CANVAS_CONTENT_TYPE,
  CANVAS_METADATA_KIND,
  boundedCanvasText,
  deriveCanvasArtifactId,
  loadCanvasHeadContent,
  type CanvasArtifactRow,
} from "./canvas-lifecycle.js";

/**
 * Legacy `thread_turn_events.payload.kind` for a full json-render part carried
 * as a `ui_message_chunk` activity event. Kept in sync with the runtime's
 * `THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND` (a wire contract, inlined to avoid
 * a cross-package import into the API lib).
 */
const LEGACY_UI_MESSAGE_CHUNK_PAYLOAD_KIND =
  "thread_json_render.ui_message_chunk" as const;

/** Activity `event_type`s that can carry a born-as-artifact canvas part. */
export const BORN_CANVAS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ui_message_chunk",
  "state_snapshot",
]);

/**
 * Extract the json-render part from either the AG-UI STATE_SNAPSHOT envelope or
 * the legacy `ui_message_chunk` payload; null for anything else.
 */
function extractCanvasPart(payload: unknown): ThreadJsonRenderPart | null {
  const snapshot = partFromThreadJsonRenderStateSnapshotPayload(payload);
  if (snapshot) return snapshot;
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).kind ===
      LEGACY_UI_MESSAGE_CHUNK_PAYLOAD_KIND
  ) {
    return (payload as Record<string, unknown>).chunk as ThreadJsonRenderPart;
  }
  return null;
}

/**
 * Upsert (or update) the draft canvas artifact for a json-render activity
 * event. Returns the artifact id on a persisted/updated canvas, or null when
 * the event carries no valid canvas part.
 */
export async function upsertDraftCanvasFromActivityEvent(input: {
  tenantId: string;
  threadId: string;
  agentId: string | null;
  payload: unknown;
}): Promise<{ artifactId: string } | null> {
  const rawPart = extractCanvasPart(input.payload);
  if (!rawPart) return null;

  const validation = validateThreadJsonRenderPersistedPart(rawPart);
  if (!validation.ok) return null;
  const part = validation.part;

  const stablePartId = part.id;

  // U8 check-out routing (R13): if THIS thread has checked out a saved canvas
  // under this stable part id, route the head update to that ORIGINAL artifact
  // instead of deriving/minting a new one. A thread with no check-out record
  // for this part falls through to the ordinary born-as-artifact path, so an
  // unrelated thread emitting the same stable id keeps its own artifact.
  const checkedOut = await findCheckoutRoutedArtifact({
    tenantId: input.tenantId,
    threadId: input.threadId,
    stablePartId,
  });
  if (checkedOut) {
    await updateCheckedOutCanvasHead({
      tenantId: input.tenantId,
      artifact: checkedOut,
      part,
    });
    return { artifactId: checkedOut.id };
  }

  const artifactId = deriveCanvasArtifactId(
    input.tenantId,
    input.threadId,
    stablePartId,
  );

  const content = stableStringify(part);
  const key = artifactContentKey({
    tenantId: input.tenantId,
    artifactId,
    // Head key (overwrite-in-place) — no revision. Pins write revision keys.
  });
  await writeArtifactPayloadToS3({
    tenantId: input.tenantId,
    key,
    body: content,
    contentType: CANVAS_CONTENT_TYPE,
  });

  const metadata = {
    kind: CANVAS_METADATA_KIND,
    stablePartId,
    schemaVersion: part.data.schemaVersion,
    catalogVersion: part.data.catalogVersion,
    specHash: part.data.specHash ?? null,
  };
  const title = boundedCanvasText(
    part.data.mobileFallback.title || "Canvas",
    160,
  );
  const summary = boundedCanvasText(
    part.data.mobileFallback.summary || "Generated canvas.",
    500,
  );

  await db
    .insert(artifacts)
    .values({
      id: artifactId,
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      thread_id: input.threadId,
      title,
      type: "data_view",
      status: "draft",
      content: null,
      s3_key: key,
      summary,
      metadata,
    })
    .onConflictDoUpdate({
      target: artifacts.id,
      // Re-emission refreshes the head — but ONLY while the canvas is still a
      // draft. A saved canvas (status != 'draft') is never clobbered here.
      set: {
        title,
        content: null,
        s3_key: key,
        summary,
        metadata,
        updated_at: new Date(),
      },
      setWhere: sql`${artifacts.status} = 'draft'`,
    });

  return { artifactId };
}

/**
 * Find the SAVED canvas that `threadId` has checked out under `stablePartId`
 * (U8, R13). Check-out records a `{threadId}` entry in the ORIGINAL artifact's
 * `metadata.checkouts` array (see `checkoutCanvas.mutation.ts`); this lookup
 * matches on that plus the artifact's own `metadata.stablePartId`. Returns null
 * when the thread has no check-out for the part — the caller then takes the
 * ordinary derive path, so an unrelated same-stable-id emission is never routed
 * to another thread's artifact.
 */
async function findCheckoutRoutedArtifact(input: {
  tenantId: string;
  threadId: string;
  stablePartId: string;
}): Promise<CanvasArtifactRow | null> {
  const [row] = await db
    .select({
      id: artifacts.id,
      tenant_id: artifacts.tenant_id,
      type: artifacts.type,
      status: artifacts.status,
      content: artifacts.content,
      s3_key: artifacts.s3_key,
      head_version: artifacts.head_version,
      head_write_seq: artifacts.head_write_seq,
      metadata: artifacts.metadata,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, input.tenantId),
        sql`${artifacts.metadata}->>'stablePartId' = ${input.stablePartId}`,
        sql`${artifacts.metadata}->'checkouts' @> ${JSON.stringify([
          { threadId: input.threadId },
        ])}::jsonb`,
      ),
    )
    .limit(1);
  return (row as CanvasArtifactRow | undefined) ?? null;
}

/**
 * Overwrite a checked-out (already-saved) canvas's head from a re-emitted part,
 * guarded by the KTD6 `head_write_seq` monotonic counter so concurrent
 * re-emissions serialize (no silent loss). The counter bumps ONLY when the
 * content actually changes — an idempotent re-emission is a no-op. The
 * `metadata.checkouts` / `stablePartId` / `kind` linkage is preserved (shallow
 * `||` merge); only the derived spec fields + title/summary refresh.
 */
async function updateCheckedOutCanvasHead(input: {
  tenantId: string;
  artifact: CanvasArtifactRow;
  part: ThreadJsonRenderPart;
}): Promise<void> {
  const newContent = stableStringify(input.part);
  const newHash = createHash("sha256").update(newContent).digest("hex");
  const title = boundedCanvasText(
    input.part.data.mobileFallback.title || "Canvas",
    160,
  );
  const summary = boundedCanvasText(
    input.part.data.mobileFallback.summary || "Generated canvas.",
    500,
  );
  const specFields = JSON.stringify({
    schemaVersion: input.part.data.schemaVersion,
    catalogVersion: input.part.data.catalogVersion,
    specHash: input.part.data.specHash ?? null,
  });

  let current: CanvasArtifactRow | null = input.artifact;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!current) return;
    const currentContent = await loadCanvasHeadContent(current);
    const currentHash = createHash("sha256")
      .update(currentContent)
      .digest("hex");
    if (currentHash === newHash) return; // idempotent re-emission — nothing to do

    const key = artifactContentKey({
      tenantId: input.tenantId,
      artifactId: current.id,
      // Head key (overwrite-in-place); check-in pins write revision keys.
    });
    await writeArtifactPayloadToS3({
      tenantId: input.tenantId,
      key,
      body: newContent,
      contentType: CANVAS_CONTENT_TYPE,
    });

    const observedSeq = current.head_write_seq ?? 0;
    const [updated] = await db
      .update(artifacts)
      .set({
        content: null,
        s3_key: key,
        title,
        summary,
        metadata: sql`coalesce(${artifacts.metadata}, '{}'::jsonb) || ${specFields}::jsonb`,
        head_write_seq: sql`${artifacts.head_write_seq} + 1`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(artifacts.id, current.id),
          eq(artifacts.head_write_seq, observedSeq),
        ),
      )
      .returning();
    if (updated) return;

    // Lost the KTD6 guard race — another writer bumped the head. Reload and
    // retry against the new head so writes serialize instead of clobbering.
    const [reloaded] = await db
      .select({
        id: artifacts.id,
        tenant_id: artifacts.tenant_id,
        type: artifacts.type,
        status: artifacts.status,
        content: artifacts.content,
        s3_key: artifacts.s3_key,
        head_version: artifacts.head_version,
        head_write_seq: artifacts.head_write_seq,
        metadata: artifacts.metadata,
      })
      .from(artifacts)
      .where(eq(artifacts.id, input.artifact.id))
      .limit(1);
    current = (reloaded as CanvasArtifactRow | undefined) ?? null;
  }
}
