/**
 * CompanyBrainProvider — host-supplied seam for the digital-twin read
 * surface (Company Brain U7 / KTD-5). Mirrors KnowledgeGraphProvider:
 * narrow request/response contract, host supplies transport + turn-bound
 * identity (R15 discipline — no tenant/user/thread fields here), results
 * are JSON payloads carrying per-fact provenance stamps.
 *
 * Results follow the twin-query contract: `{ ok: true, results }` or
 * `{ ok: false, reason }` — the extension renders a fixed unavailable text
 * for failures and NEVER throws mid-turn.
 */

export interface TwinToolPredicate {
  facet: string;
  attribute: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "exists" | "contains";
  value?: string | number | boolean;
}

export interface TwinCohortRequest {
  entityType: string;
  predicates: TwinToolPredicate[];
  path?: {
    relationship: string;
    targetType: string;
    predicates: TwinToolPredicate[];
  };
  limit?: number;
}

export interface TwinQueryPayload {
  ok: boolean;
  results?: Array<Record<string, unknown>>;
  reason?: string;
  detail?: string;
}

export interface CompanyBrainProvider {
  getEntity(
    request: { canonicalId: string },
    signal?: AbortSignal,
  ): Promise<TwinQueryPayload>;
  neighbors(
    request: { canonicalId: string; depth?: number },
    signal?: AbortSignal,
  ): Promise<TwinQueryPayload>;
  cohortQuery(
    request: TwinCohortRequest,
    signal?: AbortSignal,
  ): Promise<TwinQueryPayload>;
  systemEdges(
    request: { canonicalId: string },
    signal?: AbortSignal,
  ): Promise<TwinQueryPayload>;
}
