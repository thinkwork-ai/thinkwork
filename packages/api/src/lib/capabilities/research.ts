/**
 * Connection research control plane (THINK-280 U2 — R3, R4; A1; F1).
 *
 * Research is NON-EXECUTABLE knowledge: this module searches admitted /
 * platform capability definitions and stored connection proposals, and
 * creates immutable proposal rows. Nothing here touches folders, signing,
 * bindings, or dispatch — only admission (admission.ts) signs anything,
 * and only readiness (readiness.ts) touches bindings.
 *
 * External discovery is a SEAM ONLY in this slice: `externalFetcher` is
 * an injected interface with hard size/time bounds. A failed, oversized,
 * or absent fetch degrades the `state` field with a bounded detail
 * string and never affects the DB-backed results (AE research
 * availability never gates admission).
 *
 * Conventions: hand-rolled fail-closed validation (no zod), typed result
 * objects matching CapabilityRuntimeMutationResult in
 * packages/database-pg/graphql/types/capability-runtime.graphql; errors
 * accumulate into safe `reason` text rather than throwing.
 */

import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { getDb } from "@thinkwork/database-pg";
import {
  capabilityConnectionProposals,
  capabilityDefinitions,
} from "@thinkwork/database-pg/schema";
import {
  CanonicalizationError,
  canonicalSha256Hex,
} from "@thinkwork/capability-contracts";

export type Db = ReturnType<typeof getDb>;

export type CapabilityDefinitionRow = typeof capabilityDefinitions.$inferSelect;
export type CapabilityConnectionProposalRow =
  typeof capabilityConnectionProposals.$inferSelect;

/** Generic actor provenance for proposal rows (agent/user/system). */
export interface CapabilityActor {
  type: "user" | "agent" | "system";
  id?: string | null;
}

/** Bounded external-discovery seam (integrations.sh arrives in a later slice). */
export interface ExternalDiscoveryFetcher {
  fetch(
    query: string,
    limits: { maxBytes: number; timeoutMs: number },
  ): Promise<{ ok: boolean; evidence?: unknown; reason?: string }>;
}

export const EXTERNAL_DISCOVERY_MAX_BYTES = 256 * 1024;
export const EXTERNAL_DISCOVERY_TIMEOUT_MS = 8000;
/** Hard cap on the degraded-state detail string (safe, bounded text). */
export const STATE_DETAIL_MAX_CHARS = 300;

/** Upper bound on rows fetched per table for a single research query. */
const SEARCH_ROW_LIMIT = 200;

export interface ConnectionResearchResult {
  state: "ok" | "degraded";
  stateDetail?: string;
  definitions: CapabilityDefinitionRow[];
  proposals: CapabilityConnectionProposalRow[];
}

export interface SearchCapabilityRuntimeInput {
  tenantId: string;
  query: string;
  allowExternal?: boolean;
  externalFetcher?: ExternalDiscoveryFetcher;
}

/**
 * Research search: tenant-scoped + platform (tenant_id IS NULL) capability
 * definitions and tenant-scoped connection proposals matching `query`.
 * Deterministic ordering; external discovery can only degrade `state`,
 * never the DB results.
 */
export async function searchCapabilityRuntime(
  db: Db,
  input: SearchCapabilityRuntimeInput,
): Promise<ConnectionResearchResult> {
  const query = input.query.trim();
  const pattern = `%${escapeLikePattern(query)}%`;

  const definitionRows = await db
    .select()
    .from(capabilityDefinitions)
    .where(
      and(
        or(
          eq(capabilityDefinitions.tenant_id, input.tenantId),
          isNull(capabilityDefinitions.tenant_id),
        ),
        or(
          ilike(capabilityDefinitions.slug, pattern),
          ilike(capabilityDefinitions.display_name, pattern),
          ilike(capabilityDefinitions.namespace, pattern),
        ),
      ),
    )
    .limit(SEARCH_ROW_LIMIT);

  const proposalRows = await db
    .select()
    .from(capabilityConnectionProposals)
    .where(
      and(
        eq(capabilityConnectionProposals.tenant_id, input.tenantId),
        or(
          ilike(capabilityConnectionProposals.payload_fingerprint, pattern),
          sql`(${capabilityConnectionProposals.payload_json} -> 'descriptor' ->> 'slug') ILIKE ${pattern}`,
          sql`(${capabilityConnectionProposals.payload_json} ->> 'slug') ILIKE ${pattern}`,
          sql`(${capabilityConnectionProposals.payload_json} ->> 'displayName') ILIKE ${pattern}`,
        ),
      ),
    )
    .limit(SEARCH_ROW_LIMIT);

  // Defense-in-depth JS re-filter mirroring the SQL predicates (and the
  // deterministic sort lives here, not in SQL, so it is unit-testable).
  const definitions = definitionRows
    .filter((row) => row.tenant_id === input.tenantId || row.tenant_id === null)
    .filter((row) => definitionMatches(row, query))
    .sort(compareDefinitions);
  const proposals = proposalRows
    .filter((row) => row.tenant_id === input.tenantId)
    .filter((row) => proposalMatches(row, query))
    .sort(compareProposals);

  let state: "ok" | "degraded" = "ok";
  let stateDetail: string | undefined;
  if (input.allowExternal === true) {
    if (!input.externalFetcher) {
      state = "degraded";
      stateDetail = boundDetail(
        "external discovery requested but no fetcher is configured in this slice",
      );
    } else {
      try {
        const fetched = await input.externalFetcher.fetch(query, {
          maxBytes: EXTERNAL_DISCOVERY_MAX_BYTES,
          timeoutMs: EXTERNAL_DISCOVERY_TIMEOUT_MS,
        });
        if (!fetched.ok) {
          state = "degraded";
          stateDetail = boundDetail(
            `external discovery failed: ${fetched.reason ?? "unspecified"}`,
          );
        }
        // fetched.evidence is deliberately unused in this slice — converting
        // raw discovery output into proposal evidence is later wiring.
      } catch (err) {
        state = "degraded";
        stateDetail = boundDetail(
          `external discovery threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    state,
    ...(stateDetail !== undefined ? { stateDetail } : {}),
    definitions,
    proposals,
  };
}

export interface CreateConnectionProposalInput {
  tenantId: string;
  /** Refresh target; omit for a new Connection. */
  definitionId?: string | null;
  /** Proposed descriptor + research evidence payload (validated lightly here;
   * full descriptor validation happens fail-closed at admission). */
  payload: unknown;
  /** Official provider source URLs backing every material claim. */
  sourceUrls: string[];
  actor: CapabilityActor;
}

export interface CreateConnectionProposalResult {
  outcome: "applied" | "rejected";
  reason?: string;
  proposal?: CapabilityConnectionProposalRow;
}

/**
 * Persist an immutable, non-executable connection proposal (status
 * 'draft'). Approval binds to the exact payload fingerprint computed here.
 */
export async function createConnectionProposal(
  db: Db,
  input: CreateConnectionProposalInput,
): Promise<CreateConnectionProposalResult> {
  const reasons: string[] = [];

  if (!Array.isArray(input.sourceUrls) || input.sourceUrls.length === 0) {
    reasons.push("sourceUrls: at least one official source URL is required");
  } else {
    input.sourceUrls.forEach((url, i) => {
      const problem = sourceUrlProblem(url);
      if (problem) reasons.push(`sourceUrls[${i}]: ${problem}`);
    });
  }

  if (
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    reasons.push("payload: must be a JSON object");
  }

  let payloadFingerprint: string | null = null;
  if (reasons.length === 0) {
    try {
      payloadFingerprint = canonicalSha256Hex(input.payload);
    } catch (err) {
      reasons.push(
        err instanceof CanonicalizationError
          ? `payload: not canonicalizable (${err.message})`
          : "payload: not canonicalizable",
      );
    }
  }

  if (input.definitionId) {
    const [definition] = await db
      .select()
      .from(capabilityDefinitions)
      .where(eq(capabilityDefinitions.id, input.definitionId))
      .limit(1);
    if (
      !definition ||
      (definition.tenant_id !== null && definition.tenant_id !== input.tenantId)
    ) {
      reasons.push("definitionId: no such definition for this tenant");
    }
  }

  if (reasons.length > 0 || payloadFingerprint === null) {
    return { outcome: "rejected", reason: reasons.join("; ") };
  }

  const [proposal] = await db
    .insert(capabilityConnectionProposals)
    .values({
      tenant_id: input.tenantId,
      definition_id: input.definitionId ?? null,
      payload_json: input.payload,
      payload_fingerprint: payloadFingerprint,
      provenance_json: { sourceUrls: input.sourceUrls },
      status: "draft",
      created_by_actor_type: input.actor.type,
      created_by_actor_id: input.actor.id ?? null,
    })
    .returning();

  return { outcome: "applied", proposal: proposal! };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function boundDetail(detail: string): string {
  return detail.length > STATE_DETAIL_MAX_CHARS
    ? `${detail.slice(0, STATE_DETAIL_MAX_CHARS - 1)}…`
    : detail;
}

function sourceUrlProblem(url: unknown): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return "must be a non-empty string";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a syntactically valid URL";
  }
  if (parsed.protocol !== "https:") return "must use https";
  if (!parsed.hostname) return "missing host";
  return null;
}

function includesCaseless(haystack: unknown, needle: string): boolean {
  return (
    typeof haystack === "string" &&
    haystack.toLowerCase().includes(needle.toLowerCase())
  );
}

function definitionMatches(
  row: CapabilityDefinitionRow,
  query: string,
): boolean {
  if (query === "") return true;
  return (
    includesCaseless(row.slug, query) ||
    includesCaseless(row.display_name, query) ||
    includesCaseless(row.namespace, query)
  );
}

function proposalMatches(
  row: CapabilityConnectionProposalRow,
  query: string,
): boolean {
  if (query === "") return true;
  const payload =
    row.payload_json && typeof row.payload_json === "object"
      ? (row.payload_json as Record<string, unknown>)
      : {};
  const descriptor =
    payload.descriptor && typeof payload.descriptor === "object"
      ? (payload.descriptor as Record<string, unknown>)
      : {};
  return (
    includesCaseless(row.payload_fingerprint, query) ||
    includesCaseless(descriptor.slug, query) ||
    includesCaseless(payload.slug, query) ||
    includesCaseless(payload.displayName, query)
  );
}

function compareDefinitions(
  a: CapabilityDefinitionRow,
  b: CapabilityDefinitionRow,
): number {
  return (
    a.namespace.localeCompare(b.namespace) ||
    a.class.localeCompare(b.class) ||
    a.slug.localeCompare(b.slug) ||
    a.id.localeCompare(b.id)
  );
}

function compareProposals(
  a: CapabilityConnectionProposalRow,
  b: CapabilityConnectionProposalRow,
): number {
  const created =
    (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0);
  return created !== 0 ? created : a.id.localeCompare(b.id);
}
