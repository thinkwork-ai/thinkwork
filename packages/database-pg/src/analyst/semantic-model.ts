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

const dialect = new PgDialect();

/**
 * Public-schema tables fully excluded from the semantic model and from the
 * analyst_reader GRANT surface. Every entry is auth machinery: credential
 * values, bearer tokens/hashes, session state, or provider auth wiring.
 */
export const ANALYST_DENYLISTED_TABLES: ReadonlySet<string> = new Set([
  "agent_api_keys", // API key hashes
  "auth_provider_resources", // client_secret_ref + provider auth wiring
  "bootstrap_credential_leases", // secret ARNs + fingerprints
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
  const lines: string[] = [];
  for (const table of listAnalystTables()) {
    if (table.deniedColumns.length === 0) {
      lines.push(`GRANT SELECT ON public.${table.name} TO analyst_reader;`);
    } else {
      const granted = table.columns
        .map((c) => c.name)
        .sort()
        .join(", ");
      lines.push(
        `REVOKE ALL PRIVILEGES ON public.${table.name} FROM analyst_reader;`,
        `GRANT SELECT (${granted}) ON public.${table.name} TO analyst_reader;`,
      );
    }
  }
  return lines.join("\n");
}

export const ANALYST_GRANTS_BEGIN_MARKER = "-- BEGIN GENERATED ANALYST GRANTS";
export const ANALYST_GRANTS_END_MARKER = "-- END GENERATED ANALYST GRANTS";

function formatColumnRow(column: AnalystColumn): string {
  const flags: string[] = [];
  if (column.isPrimaryKey) flags.push("PK");
  if (column.notNull) flags.push("not null");
  return `| ${column.name} | ${column.pgType} | ${flags.join(", ")} |`;
}

/**
 * Generate the semantic model markdown. Deterministic: same schema input →
 * byte-identical output. Throws if the sensitive-column audit fails.
 */
export function generateAnalystSchemaMarkdown(): string {
  const violations = auditSensitiveCoverage();
  if (violations.length > 0) {
    throw new Error(
      `analyst semantic model: sensitive-looking columns lack denylist/reviewed-safe coverage: ${violations.join(", ")}. ` +
        "Add them to ANALYST_DENYLISTED_TABLES / ANALYST_DENYLISTED_COLUMNS or AUDITED_SAFE_COLUMNS in packages/database-pg/src/analyst/semantic-model.ts.",
    );
  }

  const tables = listAnalystTables();
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
    lines.push(`## ${table.name}`, "");
    lines.push("| column | type | flags |");
    lines.push("| --- | --- | --- |");
    for (const column of table.columns) {
      lines.push(formatColumnRow(column));
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
