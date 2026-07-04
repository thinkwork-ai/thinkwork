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
 */

import {
  stableStringify,
  validateThreadJsonRenderPersistedPart,
  type ThreadJsonRenderPart,
} from "../thread-json-render/persisted-parts.js";
import { partFromThreadJsonRenderStateSnapshotPayload } from "@thinkwork/thread-json-render";
import { artifacts, db, sql } from "../../graphql/utils.js";
import {
  artifactContentKey,
  writeArtifactPayloadToS3,
} from "./payload-storage.js";
import {
  CANVAS_CONTENT_TYPE,
  CANVAS_METADATA_KIND,
  boundedCanvasText,
  deriveCanvasArtifactId,
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
