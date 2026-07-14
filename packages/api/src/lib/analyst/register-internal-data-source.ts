/**
 * Input validation for registerInternalAnalystDataSource (THINK-239).
 *
 * Reuses the external source's slug rules (pattern + reserved `postgres-dev`)
 * but takes a clusterId + database instead of host/port/credential — the
 * credential is auto-provisioned, never entered.
 */

import {
  ANALYST_SOURCE_SLUG_PATTERN,
  AnalystRegistrationInputError,
  normalizeAnalystSourceSchema,
  RESERVED_ANALYST_SOURCE_SLUGS,
} from "./register-data-source.js";

export { normalizeAnalystSourceSchema } from "./register-data-source.js";

export interface RegisterInternalAnalystDataSourceInput {
  clusterId: string;
  database: string;
  name: string;
  slug: string;
  /** Selected schema (THINK-283). Omitted/null defaults to `public`. */
  schema?: string | null;
}

export interface NormalizedInternalRegisterInput {
  clusterId: string;
  database: string;
  name: string;
  slug: string;
  /** Always present after normalization; raw catalog case preserved. */
  schema: string;
}

/** The built-in `thinkwork` app database stays on the built-in connector path. */
export const WORKSPACE_DATABASE = "thinkwork";

export function validateInternalRegisterInput(
  input: RegisterInternalAnalystDataSourceInput,
): NormalizedInternalRegisterInput {
  const name = (input.name ?? "").trim();
  if (!name) throw new AnalystRegistrationInputError("name is required");

  const slug = (input.slug ?? "").trim();
  if (!ANALYST_SOURCE_SLUG_PATTERN.test(slug)) {
    throw new AnalystRegistrationInputError(
      `slug "${slug}" is invalid — must match ${ANALYST_SOURCE_SLUG_PATTERN.source} ` +
        "(lowercase letters/digits/hyphens, 2–39 chars, not starting with a hyphen).",
    );
  }
  if (RESERVED_ANALYST_SOURCE_SLUGS.has(slug)) {
    throw new AnalystRegistrationInputError(
      `slug "${slug}" is reserved for a built-in data source — choose another.`,
    );
  }

  const clusterId = (input.clusterId ?? "").trim();
  if (!clusterId)
    throw new AnalystRegistrationInputError("clusterId is required");

  const database = (input.database ?? "").trim();
  if (!database)
    throw new AnalystRegistrationInputError("database is required");
  if (database === WORKSPACE_DATABASE) {
    throw new AnalystRegistrationInputError(
      `the "${WORKSPACE_DATABASE}" workspace database is registered through the ` +
        "built-in connector — use the Workspace database (built-in) option instead.",
    );
  }

  const schema = normalizeAnalystSourceSchema(input.schema);

  return { clusterId, database, name, slug, schema };
}
