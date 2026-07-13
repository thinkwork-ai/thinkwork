/**
 * capabilityRuntimeCatalog — tenant + platform capability definitions
 * with their versions and derived operation views (THINK-280 U2).
 *
 * Operator/admin-gated. Platform-scoped definitions (tenant_id IS NULL)
 * are reference contracts visible for admission — never auto-granted.
 * A malformed stored descriptor renders that version with
 * `operations: []` (logged server-side) rather than failing the query.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, isNull, or } from "../../utils.js";
import { capabilityDefinitions } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import type { CapabilityDefinitionRow } from "../../../lib/capabilities/research.js";
import {
  definitionToGql,
  loadVersionRowsByDefinition,
} from "./capabilityRuntime.shared.js";

export async function capabilityRuntimeCatalog(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<Array<Record<string, unknown>>> {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "capabilities:catalog");

  const rows = (await db
    .select()
    .from(capabilityDefinitions)
    .where(
      or(
        eq(capabilityDefinitions.tenant_id, args.tenantId),
        isNull(capabilityDefinitions.tenant_id),
      ),
    )) as CapabilityDefinitionRow[];

  // Defense-in-depth tenant filter + deterministic ordering in JS (the
  // research lib convention — unit-testable without SQL).
  const definitions = rows
    .filter((row) => row.tenant_id === args.tenantId || row.tenant_id === null)
    .sort(
      (a, b) =>
        a.namespace.localeCompare(b.namespace) ||
        a.class.localeCompare(b.class) ||
        a.slug.localeCompare(b.slug) ||
        a.id.localeCompare(b.id),
    );

  const versionsByDefinition = await loadVersionRowsByDefinition(
    definitions.map((row) => row.id),
  );

  return definitions.map((row) =>
    definitionToGql(row, versionsByDefinition.get(row.id) ?? []),
  );
}
