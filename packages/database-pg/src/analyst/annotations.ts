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

export interface AnalystTableAnnotation {
  /** Free-text business note rendered directly under the table heading. */
  note?: string;
  /** Per-column annotations, keyed by column name. */
  columns?: Record<string, AnalystColumnAnnotation>;
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
};
