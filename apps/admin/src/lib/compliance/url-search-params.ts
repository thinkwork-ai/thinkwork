import {
  ComplianceActorType,
  ComplianceEventType,
} from "@/gql/graphql";

export const COMPLIANCE_RANGE_VALUES = ["7d", "30d", "this-quarter"] as const;
export type ComplianceRange = (typeof COMPLIANCE_RANGE_VALUES)[number];

export interface ComplianceSearchParams {
  tenantId?: string;
  actorType?: ComplianceActorType;
  eventType?: ComplianceEventType;
  since?: string;
  until?: string;
  range?: ComplianceRange;
  cursor?: string;
  /** Cross-tenant view toggle (operator-only). 1 = on. */
  xt?: 1;
  /** Set when validation rejected one or more keys; UI shows a sonner toast. */
  invalid?: 1;
}

const ACTOR_TYPES = new Set<string>(Object.values(ComplianceActorType));
const EVENT_TYPES = new Set<string>(Object.values(ComplianceEventType));

export function pickActorType(v: unknown): ComplianceActorType | undefined {
  return typeof v === "string" && ACTOR_TYPES.has(v)
    ? (v as ComplianceActorType)
    : undefined;
}

export function pickEventType(v: unknown): ComplianceEventType | undefined {
  return typeof v === "string" && EVENT_TYPES.has(v)
    ? (v as ComplianceEventType)
    : undefined;
}

function pickRange(v: unknown): ComplianceRange | undefined {
  return typeof v === "string" &&
    (COMPLIANCE_RANGE_VALUES as readonly string[]).includes(v)
    ? (v as ComplianceRange)
    : undefined;
}

function pickIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : v;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length < 256 ? v : undefined;
}

export function validateComplianceSearch(
  search: Record<string, unknown>,
): ComplianceSearchParams {
  const out: ComplianceSearchParams = {};
  let dropped = false;

  if (search.tenantId !== undefined) {
    const v = pickString(search.tenantId);
    if (v) out.tenantId = v;
    else dropped = true;
  }

  if (search.actorType !== undefined) {
    const v = pickActorType(search.actorType);
    if (v) out.actorType = v;
    else dropped = true;
  }

  if (search.eventType !== undefined) {
    const v = pickEventType(search.eventType);
    if (v) out.eventType = v;
    else dropped = true;
  }

  if (search.since !== undefined) {
    const v = pickIso(search.since);
    if (v) out.since = v;
    else dropped = true;
  }

  if (search.until !== undefined) {
    const v = pickIso(search.until);
    if (v) out.until = v;
    else dropped = true;
  }

  if (search.range !== undefined) {
    const v = pickRange(search.range);
    if (v) out.range = v;
    else dropped = true;
  }

  if (search.cursor !== undefined) {
    const v = pickString(search.cursor);
    if (v) out.cursor = v;
    else dropped = true;
  }

  if (search.xt !== undefined) {
    if (search.xt === 1 || search.xt === "1") out.xt = 1;
    else dropped = true;
  }

  if (dropped) out.invalid = 1;
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the effective `since` timestamp from explicit `since` or `range`
 * marker. Explicit `since` always wins; otherwise the marker translates to
 * a current-time-relative ISO string. `until` is never set from the marker.
 */
export function resolveSince(
  params: ComplianceSearchParams,
  now: Date = new Date(),
): string | undefined {
  if (params.since) return params.since;
  if (!params.range) return undefined;
  if (params.range === "7d") return new Date(now.getTime() - 7 * DAY_MS).toISOString();
  if (params.range === "30d") return new Date(now.getTime() - 30 * DAY_MS).toISOString();
  if (params.range === "this-quarter") {
    const month = now.getUTCMonth();
    const quarterStartMonth = month - (month % 3);
    return new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)).toISOString();
  }
  return undefined;
}
