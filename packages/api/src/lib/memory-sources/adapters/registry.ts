/**
 * Per-family memory-source adapter seam (THINK-193 U5).
 *
 * The stage runner (stages.ts) owns everything family-NEUTRAL: grant
 * lookup + boundary-within enforcement, per-page grant revalidation,
 * erase-fence capture, lease/CAS/continuation machinery, evidence + claim
 * ledgers, Hindsight retain, and run-item recording. Adapters own the
 * family-SPECIFIC pieces behind this interface: provider readiness, the
 * acquisition loop shape (cursor semantics differ radically per provider),
 * snapshot → projection rendering, subject/projection identity, and claim
 * extraction. U6 (Gmail) and U7 register new adapters here without
 * touching the runner.
 */

import type { Database } from "@thinkwork/database-pg";
import type { ApprovalPlanOverride } from "@thinkwork/agent-loops-core";

import type { ClaimUpsert } from "../claims.js";
import type {
  EvidenceTargetScope,
  MemoryProcessorConfig,
  MemorySourceConfig,
} from "../types.js";

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface AdapterReadinessArgs {
  tenantId: string;
  /** processor.created_by_user_id (null when the processor has no owner). */
  userId: string | null;
  /** The persisted source_binding_key — resolved fail-closed. */
  bindingKey: string;
}

/** `client` is adapter-opaque; the runner hands it back to runAcquire. */
export type AdapterReadiness =
  | { ready: true; client: unknown }
  | { ready: false; reason: string };

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

export interface AdapterAcquireArgs {
  db: Database;
  /** The opaque client checkReadiness produced. */
  client: unknown;
  /** Injected S3 client for S3-first snapshot uploads (U6 email privacy);
   * undefined falls back to the lazy module client in snapshots.ts. */
  s3?: import("@aws-sdk/client-s3").S3Client;
  /** U6: personal-capable families additionally see target_scope 'user'
   * (the owner's User Bank); shared families keep space/tenant. */
  processor: MemoryProcessorConfig & { target_scope: EvidenceTargetScope };
  source: MemorySourceConfig;
  workflowRunId: string;
  /** Saved source boundary (already proven WITHIN the grant envelope). */
  boundary: Record<string, unknown>;
  /** Processor budget — narrow-only alongside boundary/options. */
  budget: Record<string, unknown>;
  /** Run options — may only NARROW saved limits. */
  options: Record<string, unknown>;
  /** Approved-plan override (U3) — narrow-only. */
  override: ApprovalPlanOverride | null;
  /** The ACTIVE grant's boundary — the maximum readable envelope, for
   * mid-loop scope re-checks (e.g. post-redirect URL containment). */
  grantBoundary: Record<string, unknown>;
  /** Re-check the run's grant before EVERY provider page read; throws
   * MemoryAuthorizationError (the runner converts it to a visible stage
   * failure and never advances the unread page's checkpoint). */
  revalidateGrant: () => Promise<void>;
  /** Erase write-fence captured with the source row at stage start; pass
   * into every page commit. */
  eraseFence: { expectedEraseGeneration: number };
  /** Stage-level counters, mutated in place across sources. */
  counts: { changed: number; seen: number; pages: number };
}

export type AdapterAcquireOutcome =
  | { ok: true; summary: Record<string, unknown> }
  /** A visible stage failure (checkpoint state already consistent). */
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface MemorySourceAdapter {
  readonly family: string;
  /** Checkpoint partition key for this family's acquisition cursor. */
  readonly partitionKey: string;
  /** Hindsight path segment + evidence/metadata source label:
   * `memory-sources/<pathSegment>/<projection-key-path>.md`. */
  readonly pathSegment: string;
  /** Family mints provider tokens as the processor's owning user; the
   * runner fails visibly when created_by_user_id is missing. */
  readonly requiresOwnerUser: boolean;
  /** U6: whether this family may run on PERSONAL (user-scoped) processors
   * writing the owner's User Bank. Shared-only families (twenty, firecrawl)
   * declare false and are rejected on user scope both by the
   * worker's family policy and the stage-level gate. */
  readonly supportsPersonalScope: boolean;

  /** Resolve provider credentials/config into a usable client — fail
   * closed with a reason, never throw for expected misconfiguration. */
  checkReadiness(
    db: Database,
    args: AdapterReadinessArgs,
  ): Promise<AdapterReadiness>;

  /** The family's full per-source acquisition loop. The runner has already
   * validated the grant envelope and readiness; the adapter must call
   * `revalidateGrant()` before every provider read, commit pages through
   * evidence.recordAcquiredPage with `eraseFence`, and never advance a
   * checkpoint for an unread/failed page. */
  runAcquire(args: AdapterAcquireArgs): Promise<AdapterAcquireOutcome>;

  /** Stable projection key: one Hindsight document per source item. */
  projectionKeyFor(sourceItemId: string): string;
  /** Durable claim-ledger subject key for a source item. */
  subjectKeyFor(sourceItemId: string): string;
  /** Deterministic fallback projection when a subject has no claims. */
  buildProjection(
    snapshot: Record<string, unknown>,
    sourceItemId: string,
  ): { title: string; markdown: string };
  /** Ontology-shaped claims from one normalized snapshot. */
  extractClaims(input: {
    snapshot: Record<string, unknown>;
    sourceItemId: string;
    targetScope: EvidenceTargetScope;
    targetId: string;
  }): ClaimUpsert[];
  /** Edition timestamp used to close superseded claim intervals (null when
   * the provider exposes none — the ledger falls back to transition time). */
  editionEffectiveFrom(snapshot: Record<string, unknown>): Date | null;
  /** Human label for preflight focus chips (advisory only). */
  focusLabelFor(
    snapshot: Record<string, unknown> | null,
    sourceItemId: string,
  ): string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

import { twentyAdapter } from "./twenty-adapter.js";
import { firecrawlAdapter } from "./firecrawl.js";
import { emailAdapter } from "./email.js";

const ADAPTERS: Record<string, MemorySourceAdapter> = {
  [twentyAdapter.family]: twentyAdapter,
  [firecrawlAdapter.family]: firecrawlAdapter,
  [emailAdapter.family]: emailAdapter,
};

/** The adapter for a source family, or null (caller fails visibly). */
export function getMemorySourceAdapter(
  family: string,
): MemorySourceAdapter | null {
  return ADAPTERS[family] ?? null;
}
