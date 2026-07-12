/**
 * Consent policy for external memory sources (THINK-193 U2).
 *
 * memory_source_authorizations rows are operator-granted envelopes: a
 * processor may only ingest a (source_family, source_binding_key) while an
 * ACTIVE, unexpired grant exists, and its source-config boundary must stay
 * WITHIN the grant's boundary envelope (assertBoundaryWithin).
 *
 * NOTE on schema access: the memory_source_authorizations table lands in a
 * parallel change to @thinkwork/database-pg. The table is accessed via a
 * namespace import so the pure policy functions (grantInactiveReason,
 * assertBoundaryWithin) stay loadable and unit-testable while the schema
 * export is pending.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import * as dbSchema from "@thinkwork/database-pg/schema";

import type { DbHandle } from "./types.js";

/** A memory_source_authorizations row. */
export type GrantRow = typeof dbSchema.memorySourceAuthorizations.$inferSelect;

/** Thrown when ingestion is attempted without (or beyond) a valid grant. */
export class MemoryAuthorizationError extends Error {
  readonly name = "MemoryAuthorizationError";
}

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

/**
 * PURE: why a grant row is NOT currently usable, or null when it is.
 * An `expires_at` in the past wins even when the stored status is a stale
 * 'active' (expiry is a wall-clock fact, not a row transition).
 */
export function grantInactiveReason(
  grant: { status: string; expires_at: Date | null },
  now: Date = new Date(),
): string | null {
  if (grant.status === "revoked") return "revoked";
  if (grant.status === "expired") return "expired";
  if (grant.expires_at !== null && grant.expires_at <= now) return "expired";
  return grant.status === "active" ? null : `status '${grant.status}'`;
}

/**
 * Boundary schemas (Codex U2 P1): the grant envelope is only meaningful over
 * an explicit, per-source-family list of governed dimensions. Each dimension
 * has a comparison kind and a DEFAULT that mirrors the value the runtime
 * uses when the dimension is omitted — so an omitted grant key means "the
 * default allowance", never "unlimited", and an omitted config key still
 * requests the runtime default rather than slipping under the check.
 */
export type BoundaryDimension =
  /**
   * Numeric ceiling. Values on BOTH sides must be integers inside
   * [min, max] — the runtime clamps/floors out-of-domain values UPWARD
   * (effectiveLimit min 1, clampSnapshotTtlDays min 7), so a
   * zero/negative/fractional value must never pass comparison as if it
   * were narrower (Codex P2).
   */
  | { kind: "cap"; default: number; min: number; max: number }
  /**
   * Allowlist over a closed value domain. Values on BOTH sides must be
   * strings drawn from `domain` — an ungoverned value can neither be
   * granted nor requested.
   */
  | {
      kind: "allowlist";
      default: readonly string[];
      domain: readonly string[];
    }
  /**
   * URL envelope over an OPEN value domain (U5). Values on BOTH sides are
   * strings, each either an exact https URL (no credentials; normalized
   * host + path, fragment dropped, query preserved) or a bounded domain
   * rule `domain:<host>` covering that exact host with every path — never
   * subdomains (`domain:example.com` does NOT cover `www.example.com`).
   * Envelope semantics: every requested value must sit inside some grant
   * value — an exact URL inside an equal exact URL or inside a granted
   * domain rule for its host; a requested domain rule only inside an
   * EQUAL granted domain rule. The default is [] — nothing readable.
   * Malformed values fail closed on either side.
   */
  | { kind: "urlSet"; default: readonly string[] }
  /**
   * Opaque-identifier allowlist over an OPEN value domain (U6 email label
   * ids like "INBOX"/"Label_1234…", U7 knowledge_bases.id values — both
   * are dynamic tenant/provider data, so a closed allowlist domain is
   * impossible). Values on BOTH sides are non-empty trimmed single-line
   * strings (bounded length, no control characters —
   * stringSetValueInvalidReason); the envelope relation is plain
   * subset-of: every requested value must appear verbatim in the grant.
   * The default is [] — an empty/omitted grant allows exactly nothing.
   * Malformed values fail closed on either side.
   */
  | { kind: "stringSet"; default: readonly string[] };

export type BoundarySchema = Record<string, BoundaryDimension>;

/** stringSet value shape: non-empty, no control chars, bounded length. */
const STRING_SET_MAX_CHARS = 256;

/** PURE: why one stringSet value is malformed, or null when valid. */
export function stringSetValueInvalidReason(value: unknown): string | null {
  if (typeof value !== "string") return "not a string";
  if (value.trim() === "" || value !== value.trim()) {
    return "must be a non-empty trimmed string";
  }
  if (value.length > STRING_SET_MAX_CHARS) {
    return `longer than ${STRING_SET_MAX_CHARS} characters`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value))
    return "contains control characters";
  return null;
}

// ---------------------------------------------------------------------------
// urlSet value parsing (U5)
// ---------------------------------------------------------------------------

/** A parsed urlSet entry: one exact page or one bounded host rule. */
export type UrlSetEntry =
  | { kind: "url"; url: string }
  | { kind: "domain"; host: string };

const DOMAIN_RULE_PREFIX = "domain:";
/** Hostname: lowercase labels, at least one dot, no wildcards/ports/paths. */
const HOST_RULE_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * PURE: canonicalize an exact URL for envelope comparison and evidence
 * identity. https-only, credential-free; the fragment is dropped, the host
 * is lowercased (URL does this), the default port is elided, trailing
 * slashes collapse ("/a/" === "/a", "" === "/"), and the query string is
 * PRESERVED (distinct queries are distinct pages). Throws on anything
 * unparsable — callers fail closed.
 */
export function normalizeExactUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`'${raw}' is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`'${raw}' must use https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`'${raw}' must not contain credentials`);
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return `https://${parsed.host}${path}${parsed.search}`;
}

/**
 * PURE: parse one urlSet value into an exact-URL or domain-rule entry.
 * Throws (fail closed) on malformed values — wildcards, non-https URLs,
 * credentials, hosts with paths/ports, single-label hosts.
 */
export function parseUrlSetEntry(value: string): UrlSetEntry {
  if (value.startsWith(DOMAIN_RULE_PREFIX)) {
    const host = value.slice(DOMAIN_RULE_PREFIX.length);
    if (!HOST_RULE_RE.test(host)) {
      throw new Error(
        `'${value}' is not a valid domain rule — expected domain:<lowercase-host> with no wildcards, ports, or paths`,
      );
    }
    return { kind: "domain", host };
  }
  return { kind: "url", url: normalizeExactUrl(value) };
}

/**
 * PURE: is one requested urlSet entry inside the granted entries?
 * exact-in-exact is normalized equality; exact-in-domain is exact host
 * equality (no subdomain widening); domain-in-domain is host equality
 * (there is no "broader" rule shape in V1).
 */
function urlEntryWithin(
  requested: UrlSetEntry,
  granted: readonly UrlSetEntry[],
): boolean {
  for (const grant of granted) {
    if (requested.kind === "url") {
      if (grant.kind === "url" && grant.url === requested.url) return true;
      if (
        grant.kind === "domain" &&
        new URL(requested.url).hostname === grant.host
      ) {
        return true;
      }
    } else if (grant.kind === "domain" && grant.host === requested.host) {
      return true;
    }
  }
  return false;
}

/**
 * PURE: is an already-fetched URL (e.g. a post-redirect FINAL url) inside a
 * urlSet envelope? Malformed inputs and malformed envelope values are
 * treated as NOT allowed (fail closed) rather than throwing — this runs on
 * provider-controlled data mid-acquisition.
 */
export function isUrlWithinUrlSet(
  url: string,
  values: readonly string[],
): boolean {
  let requested: UrlSetEntry;
  try {
    requested = { kind: "url", url: normalizeExactUrl(url) };
  } catch {
    return false;
  }
  const granted: UrlSetEntry[] = [];
  for (const value of values) {
    try {
      granted.push(parseUrlSetEntry(value));
    } catch {
      // Skip malformed grant values: they grant nothing.
    }
  }
  return urlEntryWithin(requested, granted);
}

/**
 * PURE: the concrete fetchable URL list from a urlSet boundary value —
 * exact URLs only, normalized, deduped, sorted. Domain rules select
 * NOTHING here (V1): they only widen what exact config URLs a grant
 * allows; the adapter never crawls a domain. Malformed values throw.
 */
export function resolveExactUrls(values: readonly string[]): string[] {
  const urls = new Set<string>();
  for (const value of values) {
    const entry = parseUrlSetEntry(value);
    if (entry.kind === "url") urls.add(entry.url);
  }
  return [...urls].sort();
}

/**
 * Defaults track the runtime fallbacks in stages.ts / snapshots.ts
 * (DEFAULT_MAX_RECORDS, DEFAULT_PAGE_SIZE, DEFAULT_EVIDENCE_BATCH,
 * DEFAULT_SNAPSHOT_TTL_DAYS); cap min/max track the runtime clamps
 * (effectiveLimit bounds, MAX_EVIDENCE_BATCH, clampSnapshotTtlDays). The
 * `objects` domain must stay in lockstep with the adapter's
 * TWENTY_GOVERNED_OBJECTS — a policy test pins them together. New source
 * families register their schema here; a family without a schema fails
 * closed in assertBoundaryWithin/assertGrantBoundaryValid.
 */
export const BOUNDARY_SCHEMAS: Record<string, BoundarySchema> = {
  twenty: {
    maxRecords: { kind: "cap", default: 200, min: 1, max: 2000 },
    pageSize: { kind: "cap", default: 50, min: 1, max: 200 },
    projectBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    retainBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    snapshotTtlDays: { kind: "cap", default: 30, min: 7, max: 90 },
    // BINARY object capability: Twenty's REST listing offers only depth
    // 0/1 — no per-relation selection — so 'relations' grants the whole
    // depth-1 dossier (people+opportunities+notes) or nothing. Claiming
    // finer granularity would filter storage while still reading
    // ungranted relation bodies over the wire.
    objects: {
      kind: "allowlist",
      default: ["companies"],
      domain: ["companies", "relations"],
    },
  },
  // U5: Firecrawl web enrichment. `urls` is the readable envelope (default
  // [] = nothing readable); `maxPages` caps scrapes per run. Defaults/caps
  // track the adapter's runtime constants (adapters/firecrawl.ts).
  firecrawl: {
    urls: { kind: "urlSet", default: [] },
    maxPages: { kind: "cap", default: 5, min: 1, max: 50 },
    projectBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    retainBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    snapshotTtlDays: { kind: "cap", default: 30, min: 7, max: 90 },
  },
  // U7: Bedrock Knowledge Base document projection. `knowledgeBaseIds`
  // is the readable envelope of knowledge_bases.id values (default [] =
  // nothing readable); the source_binding_key convention is the
  // knowledge_bases.id — one source config per KB — so the config-side
  // set is normally exactly [bindingKey]. `maxDocuments` caps manifest
  // rows acquired per run. Defaults/caps track adapters/bedrock-kb.ts.
  bedrock_kb: {
    knowledgeBaseIds: { kind: "stringSet", default: [] },
    maxDocuments: { kind: "cap", default: 25, min: 1, max: 500 },
    pageSize: { kind: "cap", default: 10, min: 1, max: 100 },
    projectBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    retainBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    snapshotTtlDays: { kind: "cap", default: 30, min: 7, max: 90 },
  },
  // U6: email (Gmail behind the provider-neutral adapter). `labels` is the
  // readable envelope of provider label ids (default [] = nothing readable —
  // fail closed); `maxMessages` caps message reads per run; `pageSize` caps
  // history.list pages. Defaults/caps track adapters/gmail.ts constants.
  email: {
    labels: { kind: "stringSet", default: [] },
    maxMessages: { kind: "cap", default: 50, min: 1, max: 500 },
    pageSize: { kind: "cap", default: 25, min: 1, max: 100 },
    projectBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    retainBatch: { kind: "cap", default: 25, min: 1, max: 100 },
    snapshotTtlDays: { kind: "cap", default: 30, min: 7, max: 90 },
  },
};

function schemaFor(sourceFamily: string | undefined): BoundarySchema {
  const schema = sourceFamily ? BOUNDARY_SCHEMAS[sourceFamily] : undefined;
  if (!schema) {
    throw new MemoryAuthorizationError(
      `no boundary schema is registered for source family '${sourceFamily}' — refusing to evaluate boundaries`,
    );
  }
  return schema;
}

/**
 * Every key must be a governed dimension and every value must sit inside
 * the dimension's canonical domain. On the grant side this stops a typo
 * like `maxRecord` from silently falling back to the default envelope
 * (Codex P2); on the requested side it is the fail-closed rejection of
 * unknown/non-comparable config.
 */
function assertBoundarySideValid(
  boundary: Record<string, unknown>,
  schema: BoundarySchema,
  sourceFamily: string | undefined,
  side: "grant" | "source-config",
): void {
  for (const [key, value] of Object.entries(boundary)) {
    const dimension = schema[key];
    if (!dimension) {
      throw new MemoryAuthorizationError(
        `${side} boundary key '${key}' is not a governed dimension for source family '${sourceFamily}'`,
      );
    }
    if (dimension.kind === "cap") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < dimension.min ||
        value > dimension.max
      ) {
        throw new MemoryAuthorizationError(
          `${side} boundary key '${key}' (${JSON.stringify(value)}) must be an integer between ${dimension.min} and ${dimension.max}`,
        );
      }
      continue;
    }
    if (dimension.kind === "urlSet") {
      if (!Array.isArray(value)) {
        throw new MemoryAuthorizationError(
          `${side} boundary key '${key}' (${JSON.stringify(value)}) must be an array of exact https URLs or domain:<host> rules`,
        );
      }
      for (const item of value) {
        if (typeof item !== "string") {
          throw new MemoryAuthorizationError(
            `${side} boundary key '${key}' includes ${JSON.stringify(item)}, which is not a string URL/domain rule`,
          );
        }
        try {
          parseUrlSetEntry(item);
        } catch (err) {
          throw new MemoryAuthorizationError(
            `${side} boundary key '${key}' includes ${JSON.stringify(item)}: ${(err as Error).message}`,
          );
        }
      }
      continue;
    }
    if (dimension.kind === "stringSet") {
      if (!Array.isArray(value)) {
        throw new MemoryAuthorizationError(
          `${side} boundary key '${key}' (${JSON.stringify(value)}) must be an array of identifier strings`,
        );
      }
      for (const item of value) {
        const reason = stringSetValueInvalidReason(item);
        if (reason !== null) {
          throw new MemoryAuthorizationError(
            `${side} boundary key '${key}' includes ${JSON.stringify(item)}: ${reason}`,
          );
        }
      }
      continue;
    }
    if (!Array.isArray(value)) {
      throw new MemoryAuthorizationError(
        `${side} boundary key '${key}' (${JSON.stringify(value)}) must be an array of governed values (${dimension.domain.join(", ")})`,
      );
    }
    for (const item of value) {
      if (typeof item !== "string" || !dimension.domain.includes(item)) {
        throw new MemoryAuthorizationError(
          `${side} boundary key '${key}' includes ${JSON.stringify(item)}, which is not a governed value (${dimension.domain.join(", ")})`,
        );
      }
    }
  }
}

/**
 * PURE: validate a grant boundary against its family schema at GRANT time,
 * so operators get an immediate error for typo'd keys or out-of-domain
 * values instead of storing an envelope that later evaluates as the
 * defaults. Throws MemoryAuthorizationError naming the violating key.
 */
export function assertGrantBoundaryValid(
  grantBoundary: Record<string, unknown>,
  options: { sourceFamily: string },
): void {
  const sourceFamily = options?.sourceFamily;
  assertBoundarySideValid(
    grantBoundary,
    schemaFor(sourceFamily),
    sourceFamily,
    "grant",
  );
}

/**
 * PURE: validate a SOURCE-CONFIG boundary against its family schema (the
 * source-config side of assertGrantBoundaryValid) — used by the
 * setMemorySourceConfig mutation so operators get an immediate error for
 * typo'd keys or malformed values before a config row is stored. Whether
 * the config also fits inside the grant envelope is checked separately
 * (assertBoundaryWithin) when a grant exists.
 */
export function assertSourceConfigBoundaryValid(
  configBoundary: Record<string, unknown>,
  options: { sourceFamily: string },
): void {
  const sourceFamily = options?.sourceFamily;
  assertBoundarySideValid(
    configBoundary,
    schemaFor(sourceFamily),
    sourceFamily,
    "source-config",
  );
}

/**
 * PURE: assert the processor's source-config boundary is WITHIN the grant
 * envelope. Both sides are first validated against the family schema
 * (unknown keys and out-of-domain values throw — on EITHER side), then
 * compared per governed dimension using EFFECTIVE values: a side that
 * omits a dimension gets the schema default (fail closed) — an empty
 * grant allows exactly the defaults, not everything. `sourceFamily` is
 * REQUIRED so a family without a registered schema fails closed instead
 * of silently evaluating under another family's policy. Throws
 * MemoryAuthorizationError naming the violating key.
 */
export function assertBoundaryWithin(
  grantBoundary: Record<string, unknown>,
  configBoundary: Record<string, unknown>,
  options: { sourceFamily: string },
): void {
  const sourceFamily = options?.sourceFamily;
  const schema = schemaFor(sourceFamily);
  assertBoundarySideValid(grantBoundary, schema, sourceFamily, "grant");
  assertBoundarySideValid(
    configBoundary,
    schema,
    sourceFamily,
    "source-config",
  );

  for (const [key, dimension] of Object.entries(schema)) {
    const allowance =
      key in grantBoundary ? grantBoundary[key] : dimension.default;
    const requested =
      key in configBoundary ? configBoundary[key] : dimension.default;

    // Side validation above guarantees the shapes; only the envelope
    // relation is left to check.
    if (dimension.kind === "cap") {
      if ((requested as number) > (allowance as number)) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' (${JSON.stringify(requested)}) exceeds the grant envelope cap ${JSON.stringify(allowance)}`,
        );
      }
      continue;
    }
    if (dimension.kind === "urlSet") {
      // Side validation above proved parseability on both sides; only the
      // envelope relation is left. An empty/omitted grant value allows
      // exactly nothing.
      const grantedEntries = (allowance as readonly string[]).map(
        parseUrlSetEntry,
      );
      for (const item of requested as readonly string[]) {
        if (!urlEntryWithin(parseUrlSetEntry(item), grantedEntries)) {
          throw new MemoryAuthorizationError(
            `source-config boundary key '${key}' includes ${JSON.stringify(item)}, which is outside the granted URL envelope`,
          );
        }
      }
      continue;
    }
    if (dimension.kind === "stringSet") {
      // Plain subset-of over verbatim identifiers. An empty/omitted grant
      // value allows exactly nothing.
      const granted = new Set(allowance as readonly string[]);
      for (const item of requested as readonly string[]) {
        if (!granted.has(item)) {
          throw new MemoryAuthorizationError(
            `source-config boundary key '${key}' includes ${JSON.stringify(item)}, which is outside the granted identifier set`,
          );
        }
      }
      continue;
    }
    const allowed = new Set(allowance as readonly string[]);
    for (const item of requested as readonly string[]) {
      if (!allowed.has(item)) {
        throw new MemoryAuthorizationError(
          `source-config boundary key '${key}' includes ${JSON.stringify(item)}, which is outside the grant allowlist`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grant lookups
// ---------------------------------------------------------------------------

async function listGrants(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow[]> {
  const table = dbSchema.memorySourceAuthorizations;
  return await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.tenant_id, args.tenantId),
        eq(table.processor_config_id, args.processorConfigId),
        eq(table.source_family, args.sourceFamily),
        eq(table.source_binding_key, args.sourceBindingKey),
      ),
    )
    .orderBy(desc(table.created_at));
}

/**
 * The newest usable grant for this (processor, source binding), or null
 * when none is active and unexpired.
 */
export async function getActiveGrant(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow | null> {
  const grants = await listGrants(db, args);
  const now = new Date();
  return (
    grants.find((grant) => grantInactiveReason(grant, now) === null) ?? null
  );
}

/**
 * Like getActiveGrant, but a missing/revoked/expired grant throws
 * MemoryAuthorizationError with a message that says which it was.
 */
export async function requireActiveGrant(
  db: DbHandle,
  args: {
    tenantId: string;
    processorConfigId: string;
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<GrantRow> {
  const grants = await listGrants(db, args);
  const now = new Date();
  const active = grants.find(
    (grant) => grantInactiveReason(grant, now) === null,
  );
  if (active) return active;

  const binding = `${args.sourceFamily}:${args.sourceBindingKey}`;
  if (grants.length === 0) {
    throw new MemoryAuthorizationError(
      `no memory-source authorization grant exists for processor ${args.processorConfigId} and source '${binding}' — an operator must grant access before ingestion runs`,
    );
  }
  const reason = grantInactiveReason(grants[0]!, now) ?? "inactive";
  throw new MemoryAuthorizationError(
    `the memory-source authorization for processor ${args.processorConfigId} and source '${binding}' is ${reason} — re-grant access before ingestion runs`,
  );
}

/**
 * Codex U2 #2: re-check the SAME grant immediately before a provider page
 * read. The grant must still exist, still be active/unexpired, and still be
 * the same grant_version the run started with — a revoke, expiry, or
 * boundary re-issue between pages stops the very next page read. Throws
 * MemoryAuthorizationError; callers must not advance the checkpoint for an
 * unread page.
 */
export async function revalidateGrant(
  db: DbHandle,
  args: { tenantId: string; grantId: string; expectedGrantVersion: number },
): Promise<void> {
  const table = dbSchema.memorySourceAuthorizations;
  const [row] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, args.grantId), eq(table.tenant_id, args.tenantId)))
    .limit(1);
  if (!row) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} no longer exists — acquisition stopped before the next page`,
    );
  }
  const reason = grantInactiveReason(row, new Date());
  if (reason !== null) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} is ${reason} — acquisition stopped before the next page`,
    );
  }
  if (row.grant_version !== args.expectedGrantVersion) {
    throw new MemoryAuthorizationError(
      `authorization grant ${args.grantId} changed (version ${row.grant_version}, run started with ${args.expectedGrantVersion}) — acquisition stopped; the next run re-reads the new boundary`,
    );
  }
}

/**
 * Revoke a grant: status 'revoked', revoked_at now, grant_version bumped.
 * Returns the updated row, or null when no such grant exists in the tenant.
 * `revokedByUserId` is accepted for call-site audit intent; the table has
 * no revoked_by column yet, so it is not persisted.
 */
export async function revokeGrant(
  db: DbHandle,
  args: { tenantId: string; grantId: string; revokedByUserId?: string },
): Promise<GrantRow | null> {
  const table = dbSchema.memorySourceAuthorizations;
  const [row] = await db
    .update(table)
    .set({
      status: "revoked",
      revoked_at: new Date(),
      grant_version: sql`${table.grant_version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(table.id, args.grantId), eq(table.tenant_id, args.tenantId)))
    .returning();
  return row ?? null;
}
