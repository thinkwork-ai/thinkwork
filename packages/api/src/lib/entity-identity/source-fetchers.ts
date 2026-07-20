/**
 * Identity-match source record fetchers (THINK-321 U7, KTD-7).
 *
 * Fetches source rows SERVER-SIDE per registered identity source. Two
 * connector kinds are supported:
 *
 *   - **External/internal Postgres (analyst sources)** — rows ride the
 *     analyst query broker's HTTP MCP route (`POST /mcp/analyst/{slug}`)
 *     with a signed `system_refresh` caller context, exactly the
 *     canvas-refresh headless seam (THINK-229 U2 / THINK-239). The broker
 *     is the sole component with a network path to customer databases
 *     (analyst egress split, PR #3794/#3795) — this module NEVER opens a
 *     direct socket to a customer Postgres, keeping the dual-plane rule
 *     (docs/solutions/architecture-patterns/analyst-external-postgres-
 *     dual-plane-2026-07.md). Each query is a synchronous request with
 *     surfaced errors.
 *
 *   - **Twenty CRM** — company records via the memory-source config
 *     credential path (`checkTwentyReadiness`): the tenant's enabled
 *     twenty memory-source binding supplies the binding key and the
 *     processor owner's token (there is deliberately no tenant-wide user
 *     OAuth to borrow).
 *
 * Postgres table/column resolution is CONVENTIONAL and fail-visible: the
 * fetcher discovers the granted surface via information_schema (itself a
 * broker query), resolves each entity type to a table by slug-derived
 * candidates and key-kind column candidates, and reports unresolvable
 * types as warnings on the job row instead of guessing.
 */

import { and, eq } from "drizzle-orm";
import {
  memoryProcessorConfigs,
  memorySourceConfigs,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import type { Database } from "../db.js";
import {
  ANALYST_CALLER_CONTEXT_HEADER,
  hashAnalystRequestBody,
  matchAnalystBrokerUrl,
  mintAnalystCallerContextHeader,
  sourceClaimsFromRuntimeMetadata,
  type AnalystSourceClaims,
} from "../analyst/caller-context.js";
import { resolveTenantMcpServerTarget } from "../mcp-configs.js";
import { mcpCallTool, type McpServerTarget } from "../mcp-client-call.js";
import { checkTwentyReadiness } from "../memory-sources/adapters/twenty.js";
import { TWENTY_MCP_SLUG } from "../twenty/rest-client.js";
import type { IdentityRule } from "./normalizers.js";
import type {
  IdentitySourceRecord,
  SourceFetchArgs,
  SourceFetchResult,
  SourceRecordFetcher,
} from "./bootstrap.js";

const LOG_PREFIX = "[identity-match:fetch]";

/** Per-broker-query row page (bounded well below the broker's inline cap). */
const POSTGRES_PAGE_SIZE = 100;
const TWENTY_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Column conventions (fail-visible: unresolved types become warnings)
// ---------------------------------------------------------------------------

const KEY_KIND_COLUMN_CANDIDATES: Record<string, string[]> = {
  name: ["name", "display_name", "company_name", "customer_name", "full_name"],
  domain: ["domain", "domain_name", "website", "url"],
  email: ["email", "email_address"],
  phone: ["phone", "phone_number"],
};

const ID_COLUMN_CANDIDATES = ["id", "uuid", "external_id"];

export function tableCandidatesForSlug(slug: string): string[] {
  const base = slug.toLowerCase().replace(/-/g, "_");
  const candidates = [base, `${base}s`, `${base}es`];
  if (base.endsWith("y")) candidates.push(`${base.slice(0, -1)}ies`);
  return [...new Set(candidates)];
}

export interface PostgresEntityPlan {
  entityTypeSlug: string;
  table: string;
  idColumn: string;
  displayColumn: string;
  keyColumns: Array<{ keyKind: string; column: string }>;
}

/**
 * Resolve one entity type to a fetch plan against the discovered granted
 * surface. Returns null (caller records a warning) when no table or no
 * usable key column resolves.
 */
export function resolvePostgresEntityPlan(
  entityTypeSlug: string,
  rules: IdentityRule[],
  columnsByTable: Map<string, Set<string>>,
): PostgresEntityPlan | null {
  for (const table of tableCandidatesForSlug(entityTypeSlug)) {
    const columns = columnsByTable.get(table);
    if (!columns) continue;
    const idColumn = ID_COLUMN_CANDIDATES.find((c) => columns.has(c));
    if (!idColumn) continue;
    const keyColumns: Array<{ keyKind: string; column: string }> = [];
    for (const rule of rules) {
      const candidates = KEY_KIND_COLUMN_CANDIDATES[rule.keyKind] ?? [
        rule.keyKind,
      ];
      const column = candidates.find((c) => columns.has(c));
      if (column && !keyColumns.some((k) => k.keyKind === rule.keyKind)) {
        keyColumns.push({ keyKind: rule.keyKind, column });
      }
    }
    if (keyColumns.length === 0) continue;
    const displayColumn =
      keyColumns.find((k) => k.keyKind === "name")?.column ??
      KEY_KIND_COLUMN_CANDIDATES.name!.find((c) => columns.has(c)) ??
      idColumn;
    return { entityTypeSlug, table, idColumn, displayColumn, keyColumns };
  }
  return null;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlIdent(value: string): string {
  // Conventional names only (discovered from information_schema); quoting
  // guards against reserved words, and a double-quote in a discovered name
  // is refused outright rather than escaped into cleverness.
  if (value.includes('"')) {
    throw new Error(`refusing to quote identifier containing '"': ${value}`);
  }
  return `"${value}"`;
}

// ---------------------------------------------------------------------------
// Broker query transport (the canvas-refresh seam)
// ---------------------------------------------------------------------------

export interface BrokerQueryEnvelope {
  columns: Array<{ name: string }>;
  rows: Array<Array<unknown>>;
  row_count: number;
  truncated: boolean;
}

export type BrokerQueryFn = (sql: string) => Promise<BrokerQueryEnvelope>;

/**
 * Build a `query`-tool caller against the analyst broker for one sourced
 * connector: resolve the tenant MCP target (service-credential bearer),
 * attach the signed system_refresh caller context per POST (bodyHash-bound,
 * sourceClaims for sourced routes), and parse the envelope. MCP isError
 * results (gate rejections, SQL errors) throw with the broker's text.
 */
export async function createBrokerQuery(args: {
  db: Database;
  tenantId: string;
  jobId: string;
  connectorSlug: string;
}): Promise<BrokerQueryFn> {
  const resolved = await resolveTenantMcpServerTarget({
    tenantId: args.tenantId,
    serverName: args.connectorSlug,
    logPrefix: LOG_PREFIX,
  });
  if (resolved.kind !== "ok") {
    throw new Error(
      `connector "${args.connectorSlug}" is not headless-callable: ${resolved.reason}`,
    );
  }
  const { isBroker, sourceSlug } = matchAnalystBrokerUrl(resolved.target.url);
  if (!isBroker) {
    throw new Error(
      `connector "${args.connectorSlug}" is not an analyst broker route (${resolved.target.url}) — ` +
        "identity-match only fetches Postgres rows through the broker, never directly",
    );
  }

  let sourceClaims: AnalystSourceClaims | null = null;
  if (sourceSlug) {
    const [row] = await args.db
      .select({ runtime_metadata: tenantMcpServers.runtime_metadata })
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.tenant_id, args.tenantId),
          eq(tenantMcpServers.slug, sourceSlug),
        ),
      )
      .limit(1);
    sourceClaims = sourceClaimsFromRuntimeMetadata(
      sourceSlug,
      row?.runtime_metadata,
    );
    if (!sourceClaims) {
      throw new Error(
        `analyst source "${sourceSlug}" has missing/invalid runtime_metadata.analyst_source — cannot fetch`,
      );
    }
  }

  const target: McpServerTarget = {
    ...resolved.target,
    perRequestHeaders: async (body) => {
      const header = await mintAnalystCallerContextHeader({
        actor: "system_refresh",
        tenantId: args.tenantId,
        refreshId: `identity-match:${args.jobId}`,
        bodyHash: hashAnalystRequestBody(body),
        ...(sourceClaims ? { sourceClaims } : {}),
      }).catch((err) => {
        console.error(`${LOG_PREFIX} caller-context mint threw:`, err);
        return null;
      });
      const extra: Record<string, string> = {};
      if (header) extra[ANALYST_CALLER_CONTEXT_HEADER] = header;
      return extra;
    },
  };

  return async (sql: string) => {
    const result = await mcpCallTool(target, "query", { sql });
    const text = firstText(result.raw);
    if (result.isError) {
      throw new Error(`broker query rejected: ${text ?? "no diagnostic text"}`);
    }
    if (!text) throw new Error("broker query returned no envelope");
    const envelope = JSON.parse(text) as BrokerQueryEnvelope;
    if (!Array.isArray(envelope.columns) || !Array.isArray(envelope.rows)) {
      throw new Error("broker query envelope missing columns/rows");
    }
    return envelope;
  };
}

function firstText(raw: unknown): string | null {
  const content = (raw as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    const text = (item as { text?: unknown })?.text;
    if (typeof text === "string") return text;
  }
  return null;
}

function rowsAsObjects(
  envelope: BrokerQueryEnvelope,
): Array<Record<string, unknown>> {
  const names = envelope.columns.map((c) => c.name);
  return envelope.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    names.forEach((name, i) => {
      obj[name] = row[i];
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Postgres fetcher (keyset pagination on ::text of the id column)
// ---------------------------------------------------------------------------

interface PostgresCursor {
  /** Per-entity-type last-seen id (::text keyset) or "done". */
  [entityTypeSlug: string]: string | null;
}

export async function fetchPostgresSourceRecords(
  args: SourceFetchArgs & { query: BrokerQueryFn },
): Promise<SourceFetchResult> {
  const warnings: string[] = [];
  const discovery = await args.query(
    "SELECT table_name, column_name FROM information_schema.columns " +
      "WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position",
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rowsAsObjects(discovery)) {
    const table = String(row.table_name ?? "");
    const column = String(row.column_name ?? "");
    if (!table || !column) continue;
    const set = columnsByTable.get(table) ?? new Set<string>();
    set.add(column);
    columnsByTable.set(table, set);
  }

  const cursor: PostgresCursor = {
    ...((args.cursor as PostgresCursor | null) ?? {}),
  };
  const records: IdentitySourceRecord[] = [];
  let remaining = args.limit;
  let drained = true;

  for (const entityTypeSlug of args.entityTypeSlugs) {
    if (cursor[entityTypeSlug] === "done") continue;
    const rules = args.rulesByType.get(entityTypeSlug) ?? [];
    const plan = resolvePostgresEntityPlan(
      entityTypeSlug,
      rules,
      columnsByTable,
    );
    if (!plan) {
      warnings.push(
        `entity type "${entityTypeSlug}" resolves to no granted table/columns ` +
          `(candidates: ${tableCandidatesForSlug(entityTypeSlug).join(", ")}) — skipped`,
      );
      cursor[entityTypeSlug] = "done";
      continue;
    }

    let lastId = cursor[entityTypeSlug] ?? null;
    let typeDrained = false;
    while (remaining > 0 && !typeDrained) {
      const pageSize = Math.min(POSTGRES_PAGE_SIZE, remaining);
      const selectCols = [
        `${sqlIdent(plan.idColumn)}::text AS __id`,
        `${sqlIdent(plan.displayColumn)}::text AS __display`,
        ...plan.keyColumns.map(
          (k) =>
            `${sqlIdent(k.column)}::text AS ${sqlIdent(`__k_${k.keyKind}`)}`,
        ),
      ].join(", ");
      const where = lastId
        ? ` WHERE ${sqlIdent(plan.idColumn)}::text > ${sqlLiteral(lastId)}`
        : "";
      const sql =
        `SELECT ${selectCols} FROM ${sqlIdent(plan.table)}${where} ` +
        `ORDER BY ${sqlIdent(plan.idColumn)}::text LIMIT ${pageSize}`;
      const envelope = await args.query(sql);
      const rows = rowsAsObjects(envelope);
      for (const row of rows) {
        const externalId = row.__id == null ? "" : String(row.__id);
        if (!externalId) continue;
        const naturalKeys = plan.keyColumns
          .map((k) => ({
            keyKind: k.keyKind,
            rawValue:
              row[`__k_${k.keyKind}`] == null
                ? ""
                : String(row[`__k_${k.keyKind}`]),
          }))
          .filter((k) => k.rawValue);
        records.push({
          entityTypeSlug,
          externalId,
          displayName:
            row.__display == null || String(row.__display) === ""
              ? externalId
              : String(row.__display),
          naturalKeys,
        });
        lastId = externalId;
      }
      remaining -= rows.length;
      if (rows.length < pageSize) typeDrained = true;
    }
    if (typeDrained) {
      cursor[entityTypeSlug] = "done";
    } else {
      cursor[entityTypeSlug] = lastId;
      drained = false;
    }
  }

  return {
    records,
    cursor: drained ? null : cursor,
    drained,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Twenty fetcher (memory-source config credential path)
// ---------------------------------------------------------------------------

interface TwentyCursor {
  pageToken?: string | null;
}

/** Extract a display string from Twenty's polymorphic field shapes. */
function twentyString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["primaryLinkUrl", "primaryLinkLabel", "name", "url"]) {
      if (typeof record[key] === "string" && record[key]) {
        return record[key] as string;
      }
    }
  }
  return "";
}

export async function fetchTwentySourceRecords(
  args: SourceFetchArgs & { db: Database },
): Promise<SourceFetchResult> {
  const warnings: string[] = [];
  // The memory-source binding is the credential source: the enabled twenty
  // source config names the binding, its processor's creator holds the
  // connected account.
  const [binding] = await args.db
    .select({
      source_binding_key: memorySourceConfigs.source_binding_key,
      created_by_user_id: memoryProcessorConfigs.created_by_user_id,
    })
    .from(memorySourceConfigs)
    .innerJoin(
      memoryProcessorConfigs,
      eq(memorySourceConfigs.processor_config_id, memoryProcessorConfigs.id),
    )
    .where(
      and(
        eq(memorySourceConfigs.tenant_id, args.tenantId),
        eq(memorySourceConfigs.source_family, "twenty"),
        eq(memorySourceConfigs.enabled, true),
      ),
    )
    .limit(1);
  if (!binding?.created_by_user_id) {
    throw new Error(
      "no enabled Twenty memory-source binding (with an owning user) for this tenant — " +
        "connect Twenty as a memory source before running an identity match against it",
    );
  }
  const readiness = await checkTwentyReadiness(args.db as Database, {
    tenantId: args.tenantId,
    userId: binding.created_by_user_id,
    bindingKey: binding.source_binding_key,
  });
  if (!readiness.ready) {
    throw new Error(`Twenty credential unavailable: ${readiness.reason}`);
  }

  // Companies map to ONE entity type; when several types declare twenty,
  // prefer a customer/company-shaped slug and surface the choice.
  const sorted = [...args.entityTypeSlugs].sort();
  const entityTypeSlug =
    sorted.find((slug) => /customer|company|account/.test(slug)) ?? sorted[0]!;
  if (sorted.length > 1) {
    warnings.push(
      `multiple entity types declare twenty (${sorted.join(", ")}) — companies scanned as "${entityTypeSlug}"`,
    );
  }
  const rules = args.rulesByType.get(entityTypeSlug) ?? [];
  const wantsDomain = rules.some((rule) => rule.keyKind === "domain");
  const wantsName = rules.some((rule) => rule.keyKind === "name");

  const records: IdentitySourceRecord[] = [];
  let pageToken = (args.cursor as TwentyCursor | null)?.pageToken ?? null;
  let remaining = args.limit;
  let drained = false;

  while (remaining > 0) {
    const page = await readiness.client.listPage("companies", {
      limit: Math.min(TWENTY_PAGE_SIZE, remaining),
      depth: 0,
      ...(pageToken ? { startingAfter: pageToken } : {}),
    });
    for (const record of page.records) {
      const externalId = typeof record.id === "string" ? record.id : "";
      if (!externalId) continue;
      const name = twentyString(record.name);
      const domain = twentyString(record.domainName);
      const naturalKeys: Array<{ keyKind: string; rawValue: string }> = [];
      if (wantsName && name)
        naturalKeys.push({ keyKind: "name", rawValue: name });
      if (wantsDomain && domain) {
        naturalKeys.push({ keyKind: "domain", rawValue: domain });
      }
      records.push({
        entityTypeSlug,
        externalId,
        displayName: name || externalId,
        naturalKeys,
      });
    }
    remaining -= page.records.length;
    const nextToken =
      page.pageInfo?.hasNextPage && page.pageInfo.endCursor
        ? page.pageInfo.endCursor
        : null;
    if (!nextToken || page.records.length === 0) {
      drained = true;
      pageToken = null;
      break;
    }
    pageToken = nextToken;
  }

  return {
    records,
    cursor: drained ? null : { pageToken },
    drained,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Dispatch by connector kind
// ---------------------------------------------------------------------------

/**
 * The default fetcher: inspect the connector row and dispatch — analyst
 * broker routes (runtime_metadata.analyst_source or a /mcp/analyst URL) go
 * through the broker query seam; the Twenty binding goes through the
 * memory-source credential client. Anything else is refused visibly.
 */
export function createDefaultSourceRecordFetcher(
  db: Database = defaultDb,
): SourceRecordFetcher {
  return async (args: SourceFetchArgs): Promise<SourceFetchResult> => {
    const [connector] = await db
      .select({
        slug: tenantMcpServers.slug,
        url: tenantMcpServers.url,
        managed_application_key: tenantMcpServers.managed_application_key,
        runtime_metadata: tenantMcpServers.runtime_metadata,
      })
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.tenant_id, args.tenantId),
          eq(tenantMcpServers.slug, args.connectorSlug),
        ),
      )
      .limit(1);
    if (!connector) {
      throw new Error(
        `connector "${args.connectorSlug}" no longer exists for this tenant`,
      );
    }

    const isTwenty =
      connector.slug === TWENTY_MCP_SLUG ||
      connector.managed_application_key === "twenty";
    if (isTwenty) {
      return fetchTwentySourceRecords({ ...args, db });
    }

    const hasAnalystMeta = !!(
      connector.runtime_metadata &&
      typeof connector.runtime_metadata === "object" &&
      (connector.runtime_metadata as Record<string, unknown>).analyst_source
    );
    if (hasAnalystMeta || matchAnalystBrokerUrl(connector.url).isBroker) {
      const query = await createBrokerQuery({
        db,
        tenantId: args.tenantId,
        jobId: args.jobId,
        connectorSlug: args.connectorSlug,
      });
      return fetchPostgresSourceRecords({ ...args, query });
    }

    throw new Error(
      `connector "${args.connectorSlug}" is neither an analyst Postgres source nor the Twenty binding — ` +
        "identity-match has no fetcher for this connector kind",
    );
  };
}
