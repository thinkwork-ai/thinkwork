/**
 * Analyst semantic model — Drizzle schema → SCHEMA.md generator.
 *
 * THINK-228 U1. Walks the exported Drizzle table definitions (deploy-time
 * static, PR-reviewable — no live DB introspection) and emits the semantic
 * model markdown the analyst profile reads before generating SQL.
 *
 * The denylists below are a security control, not just doc curation: U2's
 * `analyst_reader` role migration derives its GRANT surface from the same
 * lists, so a table absent here is also a table the analyst role cannot
 * SELECT. Denial criteria (per the plan): credentials, bearer tokens,
 * HMAC/share-link signing material, session state, and auth_config-adjacent
 * secrets.
 */

import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";

import * as schema from "../schema";
import {
  ANALYST_SCHEMA_ANNOTATIONS,
  type AnalystColumnAnnotation,
  type AnalystSchemaAnnotations,
  type AnalystTableAnnotation,
  type AnalystTenantScope,
} from "./annotations";

const dialect = new PgDialect();

/**
 * Public-schema tables fully excluded from the semantic model and from the
 * analyst_reader GRANT surface. Every entry is auth machinery: credential
 * values, bearer tokens/hashes, session state, or provider auth wiring.
 */
export const ANALYST_DENYLISTED_TABLES: ReadonlySet<string> = new Set([
  "agent_api_keys", // API key hashes
  "auth_provider_resources", // client_secret_ref + provider auth wiring
  // THINK-234: platform billing/infra ledgers with no tenant-analytics value.
  // These carry no `tenant_id`, so they cannot be row-scoped; rather than
  // grant them tenant-wide they are dropped from the analyst surface entirely.
  "billing_export_imports", // platform billing-export ingest ledger — no tenant dimension
  "customer_deployment_session_events", // parent customer_deployment_sessions is denylisted (bearer material)
  "stripe_events", // raw Stripe webhook event ledger — platform-global
  "webhook_idempotency", // platform webhook de-dup ledger — no tenant dimension
  "bootstrap_credential_leases", // secret ARNs + fingerprints
  // THINK-280 capability runtime: broker/credential control-plane tables.
  // Bindings carry vault refs, external clients carry secret hashes, and
  // definition versions carry signature envelopes — none are analytics data.
  "capability_credential_bindings", // credential_refs_json vault references
  "capability_definition_versions", // signature_json signing envelopes
  "capability_external_clients", // client_secret_hash bearer material
  "connect_providers", // OAuth provider config (may embed client secrets)
  "credentials", // encrypted_value — raw encrypted credentials
  "customer_deployment_sessions", // client_token_hash bearer material
  "email_provider_installs", // credential/webhook secret refs
  "email_reply_tokens", // bearer token hashes
  "invites", // invite token hashes (claimable capability)
  "join_requests", // claim_secret_hash (claimable capability)
  "plugin_install_keys", // install key secret material
  "routine_approval_tokens", // task_token — raw bearer values
  "slack_workspaces", // bot token secret paths
  "tenant_auth_provider_references", // provider auth wiring
  "tenant_credentials", // credential secret refs
  "tenant_mcp_admin_keys", // admin key hashes
  "user_mcp_tokens", // per-user MCP token refs
  "user_plugin_activation_tokens", // activation token secret refs
  "search_queries", // THINK-263: search telemetry — raw query text + per-user rows, operational sensor not tenant analytics
  "webhook_deliveries", // signature material + raw delivery payloads
  "webhooks", // raw webhook tokens
  "workflow_task_tokens", // raw Step Functions task tokens
  "workos_auth_bridges", // auth session bridge state + nonces
  "workos_auth_sessions", // login session state
]);

/**
 * Column-level denials for tables that are analytically valuable but carry
 * one or two sensitive columns. These columns are omitted from the semantic
 * model, and U2 grants column-level SELECT on the remaining columns (so
 * `SELECT *` on these tables fails — the doc only ever names granted
 * columns).
 */
export const ANALYST_DENYLISTED_COLUMNS: Readonly<
  Record<string, readonly string[]>
> = {
  // Raw normalized source content (emails, note bodies) — plan boundary is
  // encrypted S3 snapshot refs/hashes only; content never analyst-readable.
  memory_evidence_items: ["normalized_snapshot"],
  // Full normalized claim value can embed note/email bodies from source
  // records — same content boundary as evidence snapshots.
  memory_claims: ["value"],
  routines: ["credential_refs"], // connector credential references
  skill_catalog: ["signature_payload"], // skill signing material
  skill_runs: ["completion_hmac_secret"], // per-run HMAC secret
  tenant_builtin_tools: ["secret_ref"], // per-tool secret ARN references
  tenant_mcp_servers: ["auth_config"], // secretRef-bearing auth config
  users: ["expo_push_token"], // push-capability bearer token
};

/**
 * Column names that match SENSITIVE_COLUMN_PATTERN but were reviewed and
 * are not secret-bearing. Keyed as "table.column"; each entry must say why.
 */
export const AUDITED_SAFE_COLUMNS: Readonly<Record<string, string>> = {
  "skill_catalog.signature_status": "status enum only — no key material",
};

/**
 * Names that suggest secret-bearing content. Token-count columns
 * (`input_tokens`, `token_count`) intentionally do not match.
 */
export const SENSITIVE_COLUMN_PATTERN =
  /secret|password|credential|api_key|apikey|private_key|signing|signature|hmac|bearer|auth_config|(^|_)token(_hash)?$/i;

export interface AnalystColumn {
  name: string;
  pgType: string;
  notNull: boolean;
  isPrimaryKey: boolean;
  enumValues?: readonly string[];
}

export interface AnalystForeignKey {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
}

export interface AnalystTable {
  name: string;
  columns: AnalystColumn[];
  foreignKeys: AnalystForeignKey[];
  /** Columns omitted via ANALYST_DENYLISTED_COLUMNS (for grant generation). */
  deniedColumns: string[];
}

function isPgTable(value: unknown): value is PgTable {
  return value instanceof PgTable;
}

/**
 * This schema models enums as text columns constrained by CHECK
 * `col IN ('a','b',...)` — there are no pgEnum columns. Extract per-column
 * value legends from the rendered CHECK expressions.
 */
function enumLegendsFromChecks(
  tableName: string,
  checks: ReturnType<typeof getTableConfig>["checks"],
): Map<string, string[]> {
  const legends = new Map<string, string[]>();
  const inList = new RegExp(
    `"${tableName}"\\."([a-z0-9_]+)" IN \\(([^)]*)\\)`,
    "g",
  );
  for (const check of checks) {
    const rendered = dialect.sqlToQuery(check.value).sql;
    for (const match of rendered.matchAll(inList)) {
      const column = match[1];
      const values = [...match[2].matchAll(/'((?:[^']|'')*)'/g)].map(
        (m) => m[1],
      );
      if (values.length === 0) continue;
      const existing = legends.get(column) ?? [];
      for (const value of values) {
        if (!existing.includes(value)) existing.push(value);
      }
      legends.set(column, existing);
    }
  }
  return legends;
}

/**
 * Enumerate the analyst-visible tables: public schema only, minus the table
 * denylist, minus per-table denied columns. Deterministic ordering.
 */
export function listAnalystTables(): AnalystTable[] {
  const byName = new Map<string, AnalystTable>();
  for (const value of Object.values(schema)) {
    if (!isPgTable(value)) continue;
    const cfg = getTableConfig(value);
    const schemaName = cfg.schema ?? "public";
    if (schemaName !== "public") continue;
    if (ANALYST_DENYLISTED_TABLES.has(cfg.name)) continue;
    if (byName.has(cfg.name)) continue; // aliased re-exports (e.g. scheduled_jobs)

    const deniedColumns = new Set(ANALYST_DENYLISTED_COLUMNS[cfg.name] ?? []);
    const compositePk = new Set(
      cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)),
    );
    const legends = enumLegendsFromChecks(cfg.name, cfg.checks);
    const columns: AnalystColumn[] = cfg.columns
      .filter((column) => !deniedColumns.has(column.name))
      .map((column) => ({
        name: column.name,
        pgType: column.getSQLType(),
        notNull: column.notNull,
        isPrimaryKey: column.primary || compositePk.has(column.name),
        enumValues: legends.get(column.name),
      }));

    const foreignKeys: AnalystForeignKey[] = cfg.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        columns: ref.columns.map((c) => c.name),
        foreignTable: getTableConfig(ref.foreignTable as PgTable).name,
        foreignColumns: ref.foreignColumns.map((c) => c.name),
      };
    });

    byName.set(cfg.name, {
      name: cfg.name,
      columns,
      foreignKeys,
      deniedColumns: [...deniedColumns].sort(),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Audit that every sensitive-looking column is covered by a table denial, a
 * column denial, or an explicit reviewed-safe entry. Returns violations as
 * "table.column" strings; generation fails while any exist, so a new
 * secret-bearing column cannot silently enter the model or the grant
 * surface.
 */
export function auditSensitiveCoverage(): string[] {
  const violations: string[] = [];
  for (const table of listAnalystTables()) {
    for (const column of table.columns) {
      if (!SENSITIVE_COLUMN_PATTERN.test(column.name)) continue;
      const key = `${table.name}.${column.name}`;
      if (AUDITED_SAFE_COLUMNS[key]) continue;
      violations.push(key);
    }
  }
  return violations.sort();
}

/**
 * The GRANT surface for the `analyst_reader` role (U2), derived from the
 * same table walk as the semantic model so doc and grants cannot drift.
 * Explicit per-table grants (never `GRANT ... ON ALL TABLES`) keep the
 * surface fail-closed: a new table is unreadable until the migration is
 * regenerated and re-applied. Mixed tables get column-level SELECT, so
 * `SELECT *` fails there by design — the semantic model only ever names
 * granted columns.
 *
 * The output is embedded in
 * packages/database-pg/drizzle/0227_analyst_reader_role.sql between the
 * BEGIN/END GENERATED ANALYST GRANTS markers; a vitest test asserts the
 * committed migration matches this function's current output.
 */
export function analystGrantSql(): string {
  // Existence-guarded: dev can lag the Drizzle schema (hand-rolled
  // migration ordering, pending db:push), and a plain GRANT against a
  // missing table aborts the whole transactional apply. A missing table is
  // simply not granted (fail-closed) and reported via WARNING; re-running
  // the migration after the table lands grants it.
  const lines: string[] = [
    "DO $$",
    "DECLARE",
    "  missing text[] := '{}';",
    "BEGIN",
  ];
  for (const table of listAnalystTables()) {
    lines.push(`  IF to_regclass('public.${table.name}') IS NOT NULL THEN`);
    if (table.deniedColumns.length === 0) {
      lines.push(`    GRANT SELECT ON public.${table.name} TO analyst_reader;`);
    } else {
      const granted = table.columns
        .map((c) => c.name)
        .sort()
        .join(", ");
      lines.push(
        `    REVOKE ALL PRIVILEGES ON public.${table.name} FROM analyst_reader;`,
        `    GRANT SELECT (${granted}) ON public.${table.name} TO analyst_reader;`,
      );
    }
    lines.push(
      `  ELSE`,
      `    missing := missing || '${table.name}'::text;`,
      `  END IF;`,
    );
  }
  lines.push(
    "  IF array_length(missing, 1) > 0 THEN",
    "    RAISE WARNING 'analyst grants skipped for tables missing on this database: %', missing;",
    "  END IF;",
    "END $$;",
  );
  return lines.join("\n");
}

export const ANALYST_GRANTS_BEGIN_MARKER = "-- BEGIN GENERATED ANALYST GRANTS";
export const ANALYST_GRANTS_END_MARKER = "-- END GENERATED ANALYST GRANTS";

export const ANALYST_RLS_BEGIN_MARKER = "-- BEGIN GENERATED ANALYST RLS";
export const ANALYST_RLS_END_MARKER = "-- END GENERATED ANALYST RLS";

/** Single name for every per-table analyst tenant-isolation policy. */
export const ANALYST_RLS_POLICY_NAME = "analyst_tenant_isolation";

/**
 * The verified tenant the broker pins on the connection after every
 * `DISCARD ALL`, read back inside each policy. `missing_ok = true` (the
 * second arg) makes an unset GUC return NULL rather than erroring; a NULL
 * cast to uuid yields NULL, and every `= NULL` comparison is false — so an
 * un-primed connection sees zero rows (fail-closed) instead of erroring or
 * leaking. Migration precedent: drizzle/0076_scheduled_jobs_marco_backfill.sql.
 */
const ANALYST_TENANT_GUC =
  "current_setting('thinkwork.analyst_tenant', true)::uuid";

/**
 * Build the `USING (...)` predicate for a table's RLS policy from its
 * resolved tenant scope.
 */
function tenantScopeUsingExpr(
  table: AnalystTable,
  scope: Exclude<AnalystTenantScope, "global">,
): string {
  if (scope === "self") {
    // The tenant dimension itself: the row's own id is the tenant id.
    return `id = ${ANALYST_TENANT_GUC}`;
  }
  if (scope === "column") {
    return `tenant_id = ${ANALYST_TENANT_GUC}`;
  }
  const { via, parentTable, parentColumn = "id" } = scope.join;
  return (
    `EXISTS (SELECT 1 FROM public.${parentTable} p ` +
    `WHERE p.${parentColumn} = public.${table.name}.${via} ` +
    `AND p.tenant_id = ${ANALYST_TENANT_GUC})`
  );
}

/**
 * The row-level-security surface for `analyst_reader` (THINK-234), derived
 * from the same table walk as the grants so the two cannot drift. For every
 * granted table EXCEPT "global" reference tables it enables RLS and emits a
 * single `analyst_tenant_isolation` policy scoped `TO analyst_reader` and
 * `FOR SELECT`, filtering rows to the tenant the broker pins on the
 * connection (see ANALYST_TENANT_GUC).
 *
 * Safety of `ENABLE ROW LEVEL SECURITY`: the policies are `TO analyst_reader`,
 * but enabling RLS on a table default-denies EVERY non-owner role that lacks
 * a matching policy. This is safe here because no other non-owner role holds
 * SELECT on any `public.*` table — the compliance_* roles are scoped entirely
 * to the `compliance.*` schema (drizzle/0070, 0073, 0222). The application's
 * writer connects as the table OWNER (master/migration user), which bypasses
 * RLS entirely (no FORCE is applied). "global" tables are left with RLS
 * DISABLED on purpose, so even that theoretical surface stays untouched.
 *
 * Existence-guarded with the same idiom as analystGrantSql: a table missing
 * on a lagging dev DB is skipped (fail-closed — unenabled, hence still only
 * reachable via its grant) and reported via WARNING; re-running after the
 * table lands enables it. DROP POLICY IF EXISTS before CREATE keeps re-runs
 * idempotent.
 *
 * The output is embedded in
 * packages/database-pg/drizzle/0230_analyst_rls.sql between the
 * BEGIN/END GENERATED ANALYST RLS markers; a vitest test asserts the
 * committed migration matches this function's current output.
 */
export function analystRlsSql(
  annotations: AnalystSchemaAnnotations = ANALYST_SCHEMA_ANNOTATIONS,
): string {
  const tables = listAnalystTables();
  validateAnnotations(annotations, tables);

  const globals: string[] = [];
  const lines: string[] = [
    "DO $$",
    "DECLARE",
    "  missing text[] := '{}';",
    "BEGIN",
  ];
  for (const table of tables) {
    const scope = resolveTenantScope(table, annotations[table.name]);
    if (scope === "global") {
      globals.push(table.name);
      continue;
    }
    const usingExpr = tenantScopeUsingExpr(table, scope);
    lines.push(
      `  IF to_regclass('public.${table.name}') IS NOT NULL THEN`,
      `    ALTER TABLE public.${table.name} ENABLE ROW LEVEL SECURITY;`,
      `    DROP POLICY IF EXISTS ${ANALYST_RLS_POLICY_NAME} ON public.${table.name};`,
      `    CREATE POLICY ${ANALYST_RLS_POLICY_NAME} ON public.${table.name}`,
      `      FOR SELECT TO analyst_reader`,
      `      USING (${usingExpr});`,
      `  ELSE`,
      `    missing := missing || '${table.name}'::text;`,
      `  END IF;`,
    );
  }
  lines.push(
    "  IF array_length(missing, 1) > 0 THEN",
    "    RAISE WARNING 'analyst RLS skipped for tables missing on this database: %', missing;",
    "  END IF;",
    "END $$;",
  );

  // Global (RLS intentionally NOT enabled — see analystRlsSql docstring):
  //   <table>, <table>, ...
  const header = [
    "-- Global reference tables — granted but RLS intentionally NOT enabled",
    `-- (no tenant dimension): ${globals.join(", ") || "(none)"}.`,
  ];
  return [...header, ...lines].join("\n");
}

function formatColumnRow(
  column: AnalystColumn,
  annotation: AnalystColumnAnnotation | undefined,
): string {
  const flags: string[] = [];
  if (column.isPrimaryKey) flags.push("PK");
  if (column.notNull) flags.push("not null");
  if (annotation?.note) flags.push(annotation.note);
  // Additive-only: a PII flag can only append this warning token to the
  // column's rendered row. It has no path to auditSensitiveCoverage and can
  // never mark a column as reviewed/safe — that audit's fail-closed
  // guarantee comes solely from the denylists/AUDITED_SAFE_COLUMNS above.
  if (annotation?.pii) flags.push("⚠ PII");
  return `| ${column.name} | ${column.pgType} | ${flags.join(", ")} |`;
}

/**
 * Validate that every table/column referenced by the annotation overlay
 * actually exists in the generated model's manifest (typo guard). Throws a
 * descriptive Error naming the bad table/column on the first mismatch found
 * (deterministic order: tables as declared in the overlay object).
 */
function validateAnnotations(
  annotations: AnalystSchemaAnnotations,
  tables: AnalystTable[],
): void {
  const tableByName = new Map(tables.map((t) => [t.name, t]));
  for (const [tableName, tableAnnotation] of Object.entries(annotations)) {
    const table = tableByName.get(tableName);
    if (!table) {
      throw new Error(
        `analyst schema annotations: table "${tableName}" in ANALYST_SCHEMA_ANNOTATIONS ` +
          "(packages/database-pg/src/analyst/annotations.ts) does not exist in the analyst " +
          "semantic model — check for a typo, or a table that is denylisted/not granted.",
      );
    }
    // THINK-234: validate the tenant-scope classification's join wiring
    // (typo guard against non-existent FK/parent columns).
    validateTenantScopeAnnotation(table, tableAnnotation, tableByName);
    if (!tableAnnotation.columns) continue;
    const columnNames = new Set(table.columns.map((c) => c.name));
    for (const columnName of Object.keys(tableAnnotation.columns)) {
      if (!columnNames.has(columnName)) {
        throw new Error(
          `analyst schema annotations: column "${tableName}.${columnName}" in ` +
            "ANALYST_SCHEMA_ANNOTATIONS (packages/database-pg/src/analyst/annotations.ts) does " +
            "not exist in the analyst semantic model — check for a typo, or a column that is " +
            "denylisted/not granted.",
        );
      }
    }
  }
}

function tableHasColumn(table: AnalystTable, name: string): boolean {
  return table.columns.some((c) => c.name === name);
}

/**
 * Validate a table's `tenantScope` annotation (THINK-234): a join spec must
 * name a real FK column on the child, a granted parent table that carries
 * `tenant_id`, and a real parent key column. "column"/"self"/"global" carry
 * no references to check here (classification coverage is enforced by
 * `resolveTenantScope`).
 */
function validateTenantScopeAnnotation(
  table: AnalystTable,
  annotation: AnalystTableAnnotation,
  tableByName: Map<string, AnalystTable>,
): void {
  const scope = annotation.tenantScope;
  if (!scope || typeof scope === "string") return;
  const { via, parentTable, parentColumn = "id" } = scope.join;
  const where = `ANALYST_SCHEMA_ANNOTATIONS["${table.name}"].tenantScope.join (packages/database-pg/src/analyst/annotations.ts)`;
  if (!tableHasColumn(table, via)) {
    throw new Error(
      `analyst tenant scope: ${where} references FK column "${table.name}.${via}", which does not exist in the analyst semantic model.`,
    );
  }
  const parent = tableByName.get(parentTable);
  if (!parent) {
    throw new Error(
      `analyst tenant scope: ${where} references parent table "${parentTable}", which is not a granted analyst table.`,
    );
  }
  if (!tableHasColumn(parent, parentColumn)) {
    throw new Error(
      `analyst tenant scope: ${where} references parent key "${parentTable}.${parentColumn}", which does not exist.`,
    );
  }
  if (!tableHasColumn(parent, "tenant_id")) {
    throw new Error(
      `analyst tenant scope: ${where} joins to parent "${parentTable}", which has no tenant_id column to scope by.`,
    );
  }
}

/**
 * Resolve a granted table's effective tenant scope (THINK-234). The explicit
 * `tenantScope` annotation wins; absent it, a table with a `tenant_id` column
 * defaults to "column" scope. A table with neither is a hard error — it must
 * be explicitly classified (self/global/join) or denylisted.
 */
export function resolveTenantScope(
  table: AnalystTable,
  annotation: AnalystTableAnnotation | undefined,
): AnalystTenantScope {
  const explicit = annotation?.tenantScope;
  if (explicit) return explicit;
  if (tableHasColumn(table, "tenant_id")) return "column";
  throw new Error(
    `analyst tenant scope: granted table "${table.name}" has no tenant_id column and no explicit ` +
      'tenantScope classification. Add a tenantScope ("self" | "global" | { join }) in ' +
      "ANALYST_SCHEMA_ANNOTATIONS (packages/database-pg/src/analyst/annotations.ts), or denylist the " +
      "table in ANALYST_DENYLISTED_TABLES (packages/database-pg/src/analyst/semantic-model.ts).",
  );
}

/**
 * Generate the semantic model markdown. Deterministic: same schema input →
 * byte-identical output. Throws if the sensitive-column audit fails.
 *
 * `annotations` is the operator overlay (THINK-229 U7, KTD9) merged into the
 * rendered doc: a table note under each `## table` heading, and per-column
 * notes/PII warnings appended to that column's row. It defaults to the
 * committed `ANALYST_SCHEMA_ANNOTATIONS`; callers (tests) may pass `{}` to
 * get the un-annotated baseline. Annotations never affect
 * `auditSensitiveCoverage` — that call above takes no annotation input.
 */
// ---------------------------------------------------------------------------
// External data sources (THINK-239)
//
// A registered external Postgres source has no Drizzle definition to walk —
// its schema is INTROSPECTED at registration time and persisted as a stored
// model (model.json). The renderer below produces the same-shaped SCHEMA.md
// the analyst reads before writing SQL, generalized to any stored model. The
// probe/reconciler read the same stored model back for drift detection.
// ---------------------------------------------------------------------------

export interface StoredAnalystColumn {
  name: string;
  /** Postgres type spelling as introspected (data_type, arrays as `x array`). */
  pgType: string;
}

export interface StoredAnalystTable {
  name: string;
  columns: StoredAnalystColumn[];
}

export interface StoredAnalystModel {
  version: 1;
  tables: StoredAnalystTable[];
}

/**
 * Build a deterministic stored model from introspected `(table, column,
 * pgType)` rows (information_schema.columns of the reader-granted surface).
 * Tables and columns are sorted so the same live schema always yields a
 * byte-identical model.json — the drift check hashes it.
 */
export function storedModelFromColumns(
  rows: Array<{ table: string; column: string; pgType: string }>,
): StoredAnalystModel {
  const byTable = new Map<string, StoredAnalystColumn[]>();
  for (const row of rows) {
    const cols = byTable.get(row.table) ?? [];
    cols.push({ name: row.column, pgType: row.pgType });
    byTable.set(row.table, cols);
  }
  const tables: StoredAnalystTable[] = [...byTable.entries()]
    .map(([name, columns]) => ({
      name,
      columns: [...columns].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { version: 1, tables };
}

/**
 * Render SCHEMA.md for a stored (introspected) analyst model — the external
 * counterpart of {@link generateAnalystSchemaMarkdown}. Same table/column
 * layout so the analyst's SQL-authoring guidance is identical across builtin
 * and registered sources.
 */
export function renderStoredAnalystSchemaMarkdown(
  model: StoredAnalystModel,
  opts: { sourceName: string },
): string {
  const tables = [...model.tables].sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [
    `# ${opts.sourceName} — semantic model`,
    "",
    "<!-- GENERATED FILE — do not edit by hand. -->",
    "<!-- Regenerate by re-registering this data source. -->",
    "",
    "This document describes every table you are permitted to query on this",
    "data source. It was introspected from the source's granted reader surface;",
    "tables and columns not listed here are not granted to your database role,",
    "so do not query them (and avoid `SELECT *` — name the columns you need).",
    "",
    "## Tables",
    "",
    ...tables.map((t) => `- [${t.name}](#${t.name.replace(/_/g, "-")})`),
    "",
  ];
  for (const table of tables) {
    lines.push(`## ${table.name}`, "");
    lines.push("| column | type |");
    lines.push("| --- | --- |");
    for (const column of [...table.columns].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(`| ${column.name} | ${column.pgType} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function generateAnalystSchemaMarkdown(
  annotations: AnalystSchemaAnnotations = ANALYST_SCHEMA_ANNOTATIONS,
): string {
  const violations = auditSensitiveCoverage();
  if (violations.length > 0) {
    throw new Error(
      `analyst semantic model: sensitive-looking columns lack denylist/reviewed-safe coverage: ${violations.join(", ")}. ` +
        "Add them to ANALYST_DENYLISTED_TABLES / ANALYST_DENYLISTED_COLUMNS or AUDITED_SAFE_COLUMNS in packages/database-pg/src/analyst/semantic-model.ts.",
    );
  }

  const tables = listAnalystTables();
  validateAnnotations(annotations, tables);
  const lines: string[] = [
    "# ThinkWork dev Postgres — semantic model",
    "",
    "<!-- GENERATED FILE — do not edit by hand. -->",
    "<!-- Regenerate: pnpm --filter @thinkwork/database-pg exec tsx ../../scripts/generate-analyst-schema.ts -->",
    "",
    "This document describes every table you are permitted to query on this",
    "data source. It is generated from the application's canonical schema",
    "definitions; tables and columns not listed here are not granted to your",
    "database role, so do not query them (and avoid `SELECT *` — name the",
    "columns you need).",
    "",
    "Conventions:",
    "",
    "- Multi-tenant: most tables carry `tenant_id` → `tenants.id`. Always",
    "  scope aggregates by `tenant_id` unless the question is explicitly",
    "  cross-tenant.",
    "- Timestamps are `timestamp with time zone` and named `*_at`.",
    "- Join hints list the declared foreign keys; prefer them over inferred",
    "  joins.",
    "",
    "## Tables",
    "",
    ...tables.map((t) => `- [${t.name}](#${t.name.replace(/_/g, "-")})`),
    "",
  ];

  for (const table of tables) {
    const tableAnnotation: AnalystTableAnnotation | undefined =
      annotations[table.name];
    lines.push(`## ${table.name}`, "");
    if (tableAnnotation?.note) {
      lines.push(`Note: ${tableAnnotation.note}`, "");
    }
    lines.push("| column | type | flags |");
    lines.push("| --- | --- | --- |");
    for (const column of table.columns) {
      lines.push(
        formatColumnRow(column, tableAnnotation?.columns?.[column.name]),
      );
    }
    lines.push("");

    const enumColumns = table.columns.filter((c) => c.enumValues);
    if (enumColumns.length > 0) {
      lines.push("Enum values:", "");
      for (const column of enumColumns) {
        lines.push(
          `- \`${column.name}\`: ${column.enumValues!.map((v) => `\`${v}\``).join(", ")}`,
        );
      }
      lines.push("");
    }

    if (table.foreignKeys.length > 0) {
      lines.push("Join hints:", "");
      const hints = table.foreignKeys
        .map(
          (fk) =>
            `- \`${table.name}.${fk.columns.join(", ")}\` → \`${fk.foreignTable}.${fk.foreignColumns.join(", ")}\``,
        )
        .sort();
      lines.push(...hints, "");
    }

    if (table.deniedColumns.length > 0) {
      lines.push(
        `Not granted (do not query): ${table.deniedColumns.map((c) => `\`${c}\``).join(", ")}.`,
        "",
      );
    }
  }

  return lines.join("\n");
}
