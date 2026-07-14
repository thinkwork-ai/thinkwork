/**
 * Analyst semantic model — operator annotation overlay.
 *
 * THINK-229 U7 (KTD9). Unlike `generated/analyst/SCHEMA.md`, which is a
 * fully-regenerable build artifact and must never be hand-edited, THIS FILE
 * is hand-edited on purpose: it is the one place operators add business
 * context (free-text notes) and PII flags to the analyst semantic model.
 * `generateAnalystSchemaMarkdown` in `./semantic-model.ts` merges these
 * annotations into the rendered markdown at generation time; the generated
 * file itself stays derived-only, so the staleness gate
 * (`analyst-semantic-model.test.ts`) keeps its guarantee that SCHEMA.md is
 * always exactly reproducible from code.
 *
 * Trust boundary: annotations are code-reviewed input (same posture as the
 * denylists in semantic-model.ts), not live-editable config. A typo — a
 * table or column name that doesn't exist in the generated model's manifest
 * — fails generation loudly rather than silently dropping the annotation.
 *
 * PII flags are additive-only: a `pii: true` column annotation can only add
 * a visible "⚠ PII" warning to that column's rendered row. It is never read
 * by `auditSensitiveCoverage` (or any other input to the sensitive-column
 * audit) and can never mark a column as reviewed-safe or otherwise weaken
 * that audit. The audit's fail-closed guarantee comes entirely from
 * ANALYST_DENYLISTED_TABLES / ANALYST_DENYLISTED_COLUMNS / AUDITED_SAFE_COLUMNS
 * in semantic-model.ts — this file has no path into it.
 */

export interface AnalystColumnAnnotation {
  /** Free-text business note appended to the column's rendered row. */
  note?: string;
  /**
   * Additive-only warning flag. When true, the rendered row gains a
   * "⚠ PII" marker. Never consulted by the sensitive-column audit.
   */
  pii?: boolean;
}

/**
 * How a table is scoped to a single tenant for the analyst's row-level
 * security policies (THINK-234). Every table granted to `analyst_reader`
 * resolves to exactly one of these:
 *
 *   - "column"  — the table carries a `tenant_id` column; the RLS policy is
 *                 `USING (tenant_id = <verified tenant>)`. This is the
 *                 DEFAULT when the annotation is absent AND the table has a
 *                 `tenant_id` column; a granted table with no `tenant_id`
 *                 column and no explicit `tenantScope` fails validation.
 *   - "self"    — the table IS the tenant dimension (`tenants`); the policy
 *                 filters on `id`, not `tenant_id`.
 *   - "global"  — platform-wide reference data with no tenant dimension
 *                 (e.g. capability_catalog, model_catalog). Granted, but RLS
 *                 is deliberately NOT enabled on these tables so no other
 *                 role's reads change; the note must say why.
 *   - { join }  — the table has no `tenant_id` of its own; the policy checks
 *                 that a parent row (reached via a foreign key) belongs to
 *                 the verified tenant. `via` is the FK column on THIS table,
 *                 `parentTable` the referenced table, `parentColumn` the
 *                 referenced key (defaults to "id").
 */
export type AnalystTenantScope =
  | "column"
  | "self"
  | "global"
  | { join: AnalystTenantScopeJoin };

export interface AnalystTenantScopeJoin {
  /** Foreign-key column on the annotated (child) table. */
  via: string;
  /** Table the FK references (must carry `tenant_id`). */
  parentTable: string;
  /** Referenced key column on the parent table. Defaults to "id". */
  parentColumn?: string;
}

export interface AnalystTableAnnotation {
  /** Free-text business note rendered directly under the table heading. */
  note?: string;
  /** Per-column annotations, keyed by column name. */
  columns?: Record<string, AnalystColumnAnnotation>;
  /**
   * Row-level tenant-scope classification (THINK-234). Absent = "column"
   * when the table has a `tenant_id` column, otherwise a validation error.
   * Consumed only by the RLS generator (`analystRlsSql`); it never affects
   * the rendered SCHEMA.md.
   */
  tenantScope?: AnalystTenantScope;
}

/** Keyed by table name. */
export type AnalystSchemaAnnotations = Record<string, AnalystTableAnnotation>;

/**
 * Seeded operator annotations. `users` is granted to the analyst model
 * (see ANALYST_DENYLISTED_TABLES in semantic-model.ts — `users` is not
 * denylisted, only its `expo_push_token` column is) and already carries an
 * `email` column, making it a real example of a business note plus a PII
 * flag rather than an invented table.
 */
export const ANALYST_SCHEMA_ANNOTATIONS: AnalystSchemaAnnotations = {
  users: {
    note: "End-user account records. Always scope by tenant_id; avoid joining across tenants in ad hoc reports.",
    columns: {
      email: {
        note: "Primary contact email for the account.",
        pii: true,
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Row-level tenant-scope classifications (THINK-234).
  //
  // Tables with a `tenant_id` column need no entry here — they default to
  // "column" scope. The entries below are the exceptions: the tenant dimension
  // itself, platform-global reference data, and tables that reach their tenant
  // through a foreign key. Every granted table WITHOUT a `tenant_id` column
  // MUST appear here (or be denylisted) or generation fails.
  // ---------------------------------------------------------------------------

  // The tenant dimension itself: filter on `id`, not `tenant_id`.
  tenants: {
    tenantScope: "self",
  },

  // Platform-wide reference data — no tenant dimension. Granted so the analyst
  // can resolve capability/model metadata, but RLS is intentionally NOT enabled
  // (there is nothing to scope, and leaving RLS off keeps every other role's
  // reads of these tables unchanged).
  capability_catalog: {
    tenantScope: "global",
    note: "Platform-global capability reference data — not tenant-scoped. RLS is intentionally not enabled (THINK-234).",
  },
  model_catalog: {
    tenantScope: "global",
    note: "Platform-global model reference data — not tenant-scoped. RLS is intentionally not enabled (THINK-234).",
  },

  // Join-scoped: no `tenant_id` of their own; tenancy is inherited from a
  // parent row via the named foreign key. FK/parent columns verified against
  // the Drizzle schema.
  agent_operation_leases: {
    tenantScope: {
      join: { via: "agent_id", parentTable: "agents", parentColumn: "id" },
    },
  },
  eval_case_overrides: {
    tenantScope: {
      join: { via: "run_id", parentTable: "eval_runs", parentColumn: "id" },
    },
  },
  eval_results: {
    tenantScope: {
      join: { via: "run_id", parentTable: "eval_runs", parentColumn: "id" },
    },
  },
  plugin_components: {
    tenantScope: {
      join: {
        via: "plugin_install_id",
        parentTable: "plugin_installs",
        parentColumn: "id",
      },
    },
  },
  user_plugin_activations: {
    tenantScope: {
      join: {
        via: "plugin_install_id",
        parentTable: "plugin_installs",
        parentColumn: "id",
      },
    },
  },
};
