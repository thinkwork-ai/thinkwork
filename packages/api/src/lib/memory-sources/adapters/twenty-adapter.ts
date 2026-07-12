/**
 * Twenty CRM MemorySourceAdapter registration (THINK-193 U5 seam).
 *
 * The acquisition loop below is the U1-U4 twenty inline from stages.ts,
 * moved verbatim behind the family-generic adapter interface: incremental
 * (updatedAt, id) cursor with equal-cohort page-token threading, monotonic
 * high-water guard, CAS retry, and the bounded backscan reconciliation
 * sweep. Pure normalization/rendering stays in ./twenty.js.
 */

import {
  acquireCompaniesPage,
  buildCompanyDossier,
  checkTwentyReadiness,
  projectionKeyForCompany,
  reconcileCompaniesPage,
  type TwentyCompaniesCursor,
} from "./twenty.js";
import type { TwentyRestClient } from "../../twenty/rest-client.js";
import { recordAcquiredPage } from "../evidence.js";
import {
  advanceCheckpoint,
  CheckpointConflictError,
  ensureCheckpoint,
  getCheckpoint,
} from "../repository.js";
import { extractCompanyClaims } from "../claims.js";
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_PAGE_SIZE,
  effectiveLimit,
  isNoProgress,
  pageFingerprint,
  type PageProgressState,
} from "../acquire-helpers.js";
import type {
  AdapterAcquireArgs,
  AdapterAcquireOutcome,
  MemorySourceAdapter,
} from "./registry.js";

const PARTITION_KEY = "companies";

export function cursorFromCheckpoint(
  cursor: Record<string, unknown> | null | undefined,
): TwentyCompaniesCursor | null {
  const lastUpdatedAt = cursor?.lastUpdatedAt;
  const lastId = cursor?.lastId;
  if (typeof lastUpdatedAt !== "string" || typeof lastId !== "string") {
    return null;
  }
  return { lastUpdatedAt, lastId };
}

/** Opaque backscan sweep position stored inside the checkpoint cursor. */
export function backscanTokenFrom(
  cursor: Record<string, unknown> | null | undefined,
): string | null {
  const token = cursor?.backscanToken;
  return typeof token === "string" && token ? token : null;
}

async function runTwentyAcquire(
  args: AdapterAcquireArgs,
): Promise<AdapterAcquireOutcome> {
  const {
    db,
    processor,
    source,
    boundary,
    budget,
    options,
    override,
    eraseFence,
    counts,
  } = args;
  const client = args.client as TwentyRestClient;

  // Binary object capability (policy agent contract): the saved source
  // boundary's already-validated `objects` selection — omitted means the
  // adapter's companies-only (depth-0) default.
  const approvedObjects = boundary.objects as readonly string[] | undefined;
  const pageSize = effectiveLimit(
    [boundary.pageSize, budget.pageSize, options.pageSize],
    DEFAULT_PAGE_SIZE,
    1,
    200,
  );
  const maxRecords = effectiveLimit(
    [
      boundary.maxRecords,
      budget.maxRecords,
      options.maxRecords,
      override?.maxRecords,
    ],
    DEFAULT_MAX_RECORDS,
    1,
    2000,
  );

  let checkpoint = await ensureCheckpoint(db, {
    tenantId: processor.tenant_id,
    sourceConfigId: source.id,
    partitionKey: PARTITION_KEY,
  });
  let cursor = cursorFromCheckpoint(checkpoint.cursor);
  let pageToken: string | null = null;
  let fetched = 0;
  let casRetries = 0;
  let progress: PageProgressState | null = null;

  while (fetched < maxRecords) {
    // Codex U2 #2: the grant is re-checked before EVERY provider page
    // read — a revoke/expiry/re-issue after page 1 prevents page 2, and
    // the unread page's checkpoint never advances. MemoryAuthorizationError
    // propagates to the runner, which fails the stage visibly.
    await args.revalidateGrant();
    const page = await acquireCompaniesPage(client, {
      cursor,
      pageSize: Math.min(pageSize, maxRecords - fetched),
      targetScope: processor.target_scope,
      targetId: processor.target_id,
      startingAfter: pageToken,
      objects: approvedObjects,
    });
    counts.pages += 1;
    fetched += page.rawCount;
    pageToken = page.pageToken ?? null;

    // No-progress guard (Codex F5): a repeated provider token or an
    // identical consecutive id set means paging is stuck — stop VISIBLY
    // instead of spinning the budget or advancing a bogus cursor.
    const observedProgress: PageProgressState = {
      token: pageToken,
      fingerprint: pageFingerprint(page.items.map((item) => item.sourceItemId)),
    };
    if (isNoProgress(progress, observedProgress)) {
      return {
        ok: false,
        error: `acquisition made no progress on source ${source.id}: Twenty returned a repeated page token or an identical record set twice in a row — aborting the incremental pass`,
      };
    }
    progress = observedProgress;

    if (page.items.length === 0) {
      // A full raw page whose kept set is empty means every record is
      // covered by the cursor (an equal-updatedAt cohort). With a provider
      // page token we advance through it; without one we must fail
      // VISIBLY — silently breaking would permanently skip the cohort.
      const fullPage = page.rawCount >= Math.min(pageSize, maxRecords);
      if (fullPage && pageToken) continue;
      if (fullPage && !pageToken) {
        return {
          ok: false,
          error:
            "acquisition cannot advance past an equal-updatedAt cohort: the Twenty server exposed no page cursor — raise pageSize above the cohort size or upgrade Twenty",
        };
      }
      break;
    }

    // High-water cursor: last kept item's (updatedAt, id) — from the
    // ORDERING timestamp only (Codex F4: sourceVersion now embeds a
    // content-hash edition suffix and must never become lastUpdatedAt).
    // Items without a timestamp are re-seen next run and deduped instead.
    const lastTimestamped = [...page.items]
      .reverse()
      .find((item) => item.sourceTimestamp != null);
    const observed: { lastUpdatedAt: string; lastId: string } | null =
      lastTimestamped
        ? {
            lastUpdatedAt: lastTimestamped.sourceTimestamp!.toISOString(),
            lastId: lastTimestamped.sourceItemId,
          }
        : null;
    // Monotonic guard (Codex F5): never regress the high-water mark.
    // A filtered response containing older records means provider
    // ordering/filtering is best-effort — log and rely on the backscan.
    // Compare parsed instants (not strings): mixed timestamp precision
    // ("…00Z" vs "…00.000Z") breaks lexical ordering.
    let highWater: TwentyCompaniesCursor;
    if (
      observed &&
      (!cursor?.lastUpdatedAt ||
        Date.parse(observed.lastUpdatedAt) >= Date.parse(cursor.lastUpdatedAt))
    ) {
      highWater = observed;
    } else {
      if (observed) {
        console.warn(
          `[memory-sources:twenty] filtered page for source ${source.id} contained records older than cursor ${cursor?.lastUpdatedAt} — keeping the cursor and relying on backscan reconciliation`,
        );
      }
      highWater = cursor ?? { lastUpdatedAt: null, lastId: null };
    }

    try {
      const recorded = await recordAcquiredPage(db, {
        tenantId: processor.tenant_id,
        sourceConfigId: source.id,
        workflowRunId: args.workflowRunId,
        partitionKey: PARTITION_KEY,
        expectedCheckpointVersion: checkpoint.version,
        nextCursor: {
          ...highWater,
          // Preserve the round-robin backscan position across incremental
          // checkpoint advances.
          backscanToken: backscanTokenFrom(checkpoint.cursor),
        } as unknown as Record<string, unknown>,
        items: page.items,
        eraseFence,
      });
      counts.changed += recorded.changed.length;
      counts.seen += recorded.seen;
      checkpoint = recorded.checkpoint;
      casRetries = 0;
    } catch (err) {
      if (err instanceof CheckpointConflictError && casRetries < 3) {
        // A concurrent worker (duplicate Event delivery or a parallel run
        // on the same source) advanced the checkpoint first. Their commit
        // is durable and evidence upserts dedupe, so re-read the surviving
        // cursor and continue instead of failing a run whose work is done.
        casRetries += 1;
        checkpoint =
          (await getCheckpoint(db, {
            sourceConfigId: source.id,
            partitionKey: PARTITION_KEY,
          })) ??
          (await ensureCheckpoint(db, {
            tenantId: processor.tenant_id,
            sourceConfigId: source.id,
            partitionKey: PARTITION_KEY,
          }));
        cursor = cursorFromCheckpoint(checkpoint.cursor);
        pageToken = null;
        progress = null;
        continue;
      }
      throw err;
    }
    cursor = page.nextCursor ?? highWater;

    if (page.nextCursor === null) break;
  }

  // Bounded relation reconciliation / backscan (Codex F4/F5): the
  // incremental gte-filtered pass never re-sees a company whose people/
  // opportunities/notes changed without touching the parent updatedAt.
  // Sweep unfiltered pages with the REMAINING record budget, recording
  // evidence WITHOUT advancing the incremental checkpoint (content-
  // sensitive editions make unchanged records cheap dedupe no-ops). The
  // sweep position round-robins across runs via cursor.backscanToken.
  let backscanToken = backscanTokenFrom(checkpoint.cursor);
  let backscanPages = 0;
  let backscanProgress: PageProgressState | null = null;
  while (fetched < maxRecords) {
    await args.revalidateGrant();
    const page = await reconcileCompaniesPage(client, {
      startingAfter: backscanToken,
      pageSize: Math.min(pageSize, maxRecords - fetched),
      targetScope: processor.target_scope,
      targetId: processor.target_id,
      objects: approvedObjects,
    });
    counts.pages += 1;
    fetched += page.rawCount;
    backscanPages += 1;

    const observedProgress: PageProgressState = {
      token: page.pageToken ?? null,
      fingerprint: pageFingerprint(page.items.map((item) => item.sourceItemId)),
    };
    if (isNoProgress(backscanProgress, observedProgress)) {
      return {
        ok: false,
        error: `backscan made no progress on source ${source.id}: Twenty returned a repeated page token or an identical record set twice in a row — aborting the reconciliation sweep`,
      };
    }
    backscanProgress = observedProgress;

    if (page.items.length > 0) {
      const recorded = await recordAcquiredPage(db, {
        tenantId: processor.tenant_id,
        sourceConfigId: source.id,
        workflowRunId: args.workflowRunId,
        partitionKey: PARTITION_KEY,
        expectedCheckpointVersion: checkpoint.version,
        nextCursor: checkpoint.cursor ?? {},
        items: page.items,
        skipCheckpointAdvance: true,
        eraseFence,
      });
      counts.changed += recorded.changed.length;
      counts.seen += recorded.seen;
    }

    backscanToken = page.pageToken ?? null;
    // Token exhausted: the sweep finished (or the provider exposes no
    // paging) — a null token restarts the round-robin next run.
    if (!backscanToken) break;
  }

  if (backscanPages > 0) {
    // Persist the sweep position with the same version CAS the
    // incremental pass uses. A lost CAS is benign: evidence is already
    // recorded and the sweep resumes from the surviving cursor next run.
    const advanced = await advanceCheckpoint(db, {
      sourceConfigId: source.id,
      partitionKey: PARTITION_KEY,
      expectedVersion: checkpoint.version,
      cursor: {
        ...((checkpoint.cursor ?? {}) as Record<string, unknown>),
        backscanToken,
      },
    });
    if (advanced) {
      checkpoint = advanced;
    } else {
      console.warn(
        `[memory-sources:twenty] backscan checkpoint CAS lost for source ${source.id} — sweep position not persisted this run`,
      );
    }
  }

  return {
    ok: true,
    summary: {
      family: source.source_family,
      fetched,
      checkpointVersion: checkpoint.version,
      backscanPages,
      backscanToken,
    },
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export const twentyAdapter: MemorySourceAdapter = {
  family: "twenty",
  partitionKey: PARTITION_KEY,
  pathSegment: "twenty",
  requiresOwnerUser: true,
  checkReadiness: (db, args) =>
    checkTwentyReadiness(db, {
      tenantId: args.tenantId,
      // requiresOwnerUser: the runner guarantees a non-null owner before
      // calling readiness.
      userId: args.userId!,
      // Codex F3: resolve exactly the persisted tenant-owned binding —
      // readiness fails closed when it is missing/disabled/unapproved.
      bindingKey: args.bindingKey,
    }),
  runAcquire: runTwentyAcquire,
  projectionKeyFor: projectionKeyForCompany,
  subjectKeyFor: (sourceItemId) => `twenty:company:${sourceItemId}`,
  buildProjection: (snapshot) => buildCompanyDossier(snapshot),
  extractClaims: (input) => extractCompanyClaims(input),
  editionEffectiveFrom: (snapshot) => {
    const raw = stringOrNull(snapshot.updatedAt);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
  focusLabelFor: (snapshot, sourceItemId) =>
    stringOrNull(snapshot?.name) ?? sourceItemId,
};
