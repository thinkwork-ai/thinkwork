/**
 * Render-skip gate for follow-up chat turns (warm-sessions plan U2 / KTD7).
 *
 * chat-agent-invoke renders the agent workspace synchronously on every turn
 * even though follow-up turns in an active thread almost never change the
 * render inputs. This lib persists a `lastRender` marker on the thread row
 * and decides — cheaply, without invoking the renderer Lambda — whether the
 * previous render is still valid.
 *
 * Freshness mirrors the renderer's own model (compose-tuple):
 *   1. S3 mtimes over the render's `sourcePrefixes` (probe below), and
 *   2. DB-derived routing data that never bumps an S3 mtime (space index,
 *      participants, saved canvases, profile rows) — captured here as a
 *      content hash (`routingSignature`) so drift busts the skip.
 *
 * Failure posture is fail-closed to RENDER: any read/probe/signature error
 * degrades to "changed", never to a false "unchanged". Only the marker
 * write is best-effort (a lost marker just costs one extra render).
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getDb, type Database } from "@thinkwork/database-pg";
import { agents, spaces, threads, users } from "@thinkwork/database-pg/schema";
import { DrizzleWorkspaceTupleRepository } from "./workspace-renderer/repository.js";
import type { WorkspaceTupleRepository } from "./workspace-renderer/types.js";

export const THREAD_LAST_RENDER_VERSION = 1;

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_LIST_PAGES_PER_PREFIX = 5;

export interface ThreadLastRenderMarker {
  version: number;
  generatedAt: string; // ISO
  renderedPrefix: string;
  sourcePrefixes: string[];
  activeSpace?: { id: string; slug: string; name: string; isDefault: boolean };
  /** EffectiveWorkspacePolicy — carried opaquely for dispatch reuse. */
  effectivePolicy?: unknown;
  capabilities?: { fingerprint: string; manifest: unknown };
  hydrateManifest?: unknown;
  routingSignature: string;
  configFingerprint: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidMarker(value: unknown): value is ThreadLastRenderMarker {
  if (typeof value !== "object" || value === null) return false;
  const marker = value as Record<string, unknown>;
  return (
    marker.version === THREAD_LAST_RENDER_VERSION &&
    isNonEmptyString(marker.renderedPrefix) &&
    Array.isArray(marker.sourcePrefixes) &&
    marker.sourcePrefixes.length > 0 &&
    marker.sourcePrefixes.every(isNonEmptyString) &&
    typeof marker.routingSignature === "string" &&
    typeof marker.configFingerprint === "string" &&
    typeof marker.generatedAt === "string" &&
    Number.isFinite(Date.parse(marker.generatedAt))
  );
}

export async function readThreadLastRender(
  input: { tenantId: string; threadId: string },
  deps: { db?: Database } = {},
): Promise<ThreadLastRenderMarker | null> {
  try {
    const db = deps.db ?? getDb();
    const [row] = await db
      .select({ metadata: threads.metadata })
      .from(threads)
      .where(
        and(
          eq(threads.id, input.threadId),
          eq(threads.tenant_id, input.tenantId),
        ),
      );
    const candidate = (row?.metadata as Record<string, unknown> | null)?.[
      "lastRender"
    ];
    return isValidMarker(candidate) ? candidate : null;
  } catch (err) {
    console.warn(
      `[workspace-render-skip] marker read failed thread=${input.threadId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Best-effort atomic marker write: a single jsonb_set UPDATE that merges
 * only the `lastRender` key, preserving sibling metadata written by other
 * features (same pattern as workspace-projection-snapshot).
 */
export async function writeThreadLastRender(
  input: { tenantId: string; threadId: string; marker: ThreadLastRenderMarker },
  deps: { db?: Database } = {},
): Promise<void> {
  try {
    const db = deps.db ?? getDb();
    const markerJson = JSON.stringify(input.marker);
    await db
      .update(threads)
      .set({
        metadata: sql`jsonb_set(
          coalesce(${threads.metadata}, '{}'::jsonb),
          '{lastRender}',
          ${markerJson}::jsonb,
          true
        )`,
      })
      .where(
        and(
          eq(threads.id, input.threadId),
          eq(threads.tenant_id, input.tenantId),
        ),
      );
  } catch (err) {
    console.warn(
      `[workspace-render-skip] marker write failed (best-effort) thread=${input.threadId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * sha256 over a canonical JSON of the DB-derived render inputs that never
 * bump an S3 mtime (compose-tuple's "regenerate-and-compare" data): the
 * authorized-space index, active-space participants, saved-canvas index,
 * and the agent/space/user profile row timestamps.
 *
 * Fail-closed: any error yields a unique `error:` value so a probe failure
 * can never compare equal to a stored signature (forces a render).
 */
export async function computeRoutingSignature(
  input: {
    tenantId: string;
    agentId: string;
    spaceId: string;
    userId?: string | null;
  },
  deps: { repository?: WorkspaceTupleRepository; db?: Database } = {},
): Promise<string> {
  try {
    const repository = deps.repository ?? new DrizzleWorkspaceTupleRepository();
    const tuple = await repository.resolve({
      tenantId: input.tenantId,
      agentId: input.agentId,
      spaceId: input.spaceId,
      userId: input.userId ?? null,
    });
    if (!tuple) throw new Error("tuple resolution returned null");

    const [spaceIndex, participants, canvases] = await Promise.all([
      repository.listAuthorizedSpaces?.(tuple) ?? Promise.resolve([]),
      repository.listSpaceParticipants?.(tuple) ?? Promise.resolve([]),
      repository.listSavedCanvases?.(tuple) ?? Promise.resolve([]),
    ]);

    const db = deps.db ?? getDb();
    const [agentRow] = await db
      .select({ updatedAt: agents.updated_at })
      .from(agents)
      .where(
        and(eq(agents.id, input.agentId), eq(agents.tenant_id, input.tenantId)),
      );
    const [spaceRow] = await db
      .select({ updatedAt: spaces.updated_at })
      .from(spaces)
      .where(
        and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
      );
    let userUpdatedAt: string | null = null;
    if (input.userId) {
      const [userRow] = await db
        .select({ updatedAt: users.updated_at })
        .from(users)
        .where(
          and(eq(users.id, input.userId), eq(users.tenant_id, input.tenantId)),
        );
      userUpdatedAt = userRow?.updatedAt?.toISOString() ?? null;
    }

    const canonical = JSON.stringify({
      v: 1,
      spaces: spaceIndex
        .map((space) => ({ id: space.id, slug: space.slug, name: space.name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      participants: participants
        .map((p) => ({ id: p.id, slug: p.slug, name: p.name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      // Repository exposes the exact rendered fields (artifactId + name),
      // not updatedAt — name drift is what actually changes the render.
      canvases: canvases
        .map((canvas) => ({ id: canvas.artifactId, name: canvas.name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      agentUpdatedAt: agentRow?.updatedAt?.toISOString() ?? null,
      spaceUpdatedAt: spaceRow?.updatedAt?.toISOString() ?? null,
      userUpdatedAt,
    });
    return createHash("sha256").update(canonical).digest("hex");
  } catch (err) {
    console.warn(
      `[workspace-render-skip] routing signature failed (fail-closed) tenant=${input.tenantId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // Unique per call so it can never equal a stored signature.
    return `error:${Date.now()}.${Math.random().toString(36).slice(2)}`;
  }
}

let sharedS3: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  if (!sharedS3) sharedS3 = new S3Client({});
  return sharedS3;
}

/**
 * True only when every object under every source prefix has
 * LastModified <= since. Conservative on every edge: S3 error, or a prefix
 * still truncated after MAX_LIST_PAGES_PER_PREFIX pages → false (render).
 */
export async function probeSourcePrefixesUnchanged(
  input: { bucket: string; sourcePrefixes: string[]; since: Date },
  deps: { s3?: Pick<S3Client, "send"> } = {},
): Promise<boolean> {
  const s3 = deps.s3 ?? s3Client();
  try {
    const results = await Promise.all(
      input.sourcePrefixes.map(async (prefix) => {
        let continuationToken: string | undefined;
        for (let page = 0; page < MAX_LIST_PAGES_PER_PREFIX; page += 1) {
          const response = await s3.send(
            new ListObjectsV2Command({
              Bucket: input.bucket,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
          );
          for (const object of response.Contents ?? []) {
            if (
              object.LastModified &&
              object.LastModified.getTime() > input.since.getTime()
            ) {
              return false;
            }
          }
          if (!response.IsTruncated) return true;
          continuationToken = response.NextContinuationToken;
        }
        return false; // page cap exceeded — too big to prove unchanged
      }),
    );
    return results.every(Boolean);
  } catch (err) {
    console.warn(
      `[workspace-render-skip] source probe failed (fail-closed) bucket=${input.bucket}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

export interface RenderSkipDecision {
  skip: boolean;
  reason: string;
  marker?: ThreadLastRenderMarker;
}

function resolveMaxAgeMs(override: number | undefined): number {
  if (override !== undefined) return override;
  const fromEnv = Number(process.env.RENDER_SKIP_MAX_AGE_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_MAX_AGE_MS;
}

export async function evaluateRenderSkip(args: {
  marker: ThreadLastRenderMarker | null;
  bucket: string | undefined;
  currentRoutingSignature: string;
  currentConfigFingerprint: string;
  maxAgeMs?: number;
  deps?: { probe?: typeof probeSourcePrefixesUnchanged };
}): Promise<RenderSkipDecision> {
  const { marker } = args;
  if (!marker) return { skip: false, reason: "no_marker" };
  if (!args.bucket) return { skip: false, reason: "no_bucket" };

  const maxAgeMs = resolveMaxAgeMs(args.maxAgeMs);
  const generatedAtMs = Date.parse(marker.generatedAt);
  if (Date.now() - generatedAtMs > maxAgeMs) {
    return { skip: false, reason: "marker_expired" };
  }
  if (marker.routingSignature !== args.currentRoutingSignature) {
    return { skip: false, reason: "routing_changed" };
  }
  if (marker.configFingerprint !== args.currentConfigFingerprint) {
    return { skip: false, reason: "config_changed" };
  }

  const probe = args.deps?.probe ?? probeSourcePrefixesUnchanged;
  const unchanged = await probe({
    bucket: args.bucket,
    sourcePrefixes: marker.sourcePrefixes,
    since: new Date(generatedAtMs),
  });
  if (!unchanged) return { skip: false, reason: "sources_changed" };

  return { skip: true, reason: "fresh", marker };
}
