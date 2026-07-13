/**
 * capabilityCredentialBindings / tenantServicePrincipals — the readiness
 * view of the governed capability runtime (THINK-280 U2, R6/R7).
 *
 * Operator/admin-gated. Bindings expose readiness state and REDACTED
 * probe evidence only: `credential_refs_json` never crosses this surface
 * (the projection in capabilityRuntime.shared.ts is an explicit field
 * list, asserted by test).
 */

import type { GraphQLContext } from "../../context.js";
import { and, db, eq } from "../../utils.js";
import {
  capabilityCredentialBindings as bindingsTable,
  tenantServicePrincipals as principalsTable,
} from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import type { CapabilityCredentialBindingRow } from "../../../lib/capabilities/readiness.js";
import {
  bindingToGql,
  servicePrincipalToGql,
  type TenantServicePrincipalRowLike,
} from "./capabilityRuntime.shared.js";

export async function capabilityCredentialBindings(
  _parent: unknown,
  args: { tenantId: string; definitionVersionId?: string | null },
  ctx: GraphQLContext,
): Promise<Array<Record<string, unknown>>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:bindings",
  );

  const where = args.definitionVersionId
    ? and(
        eq(bindingsTable.tenant_id, args.tenantId),
        eq(bindingsTable.definition_version_id, args.definitionVersionId),
      )
    : eq(bindingsTable.tenant_id, args.tenantId);

  const rows = (await db
    .select()
    .from(bindingsTable)
    .where(where)) as CapabilityCredentialBindingRow[];

  return rows
    .filter((row) => row.tenant_id === args.tenantId)
    .sort(compareByCreatedDesc)
    .map(bindingToGql);
}

export async function tenantServicePrincipals(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<Array<Record<string, unknown>>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:bindings",
  );

  const rows = (await db
    .select()
    .from(principalsTable)
    .where(
      eq(principalsTable.tenant_id, args.tenantId),
    )) as TenantServicePrincipalRowLike[];

  return rows
    .filter((row) => row.tenant_id === args.tenantId)
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id))
    .map(servicePrincipalToGql);
}

function compareByCreatedDesc(
  a: { created_at: Date | null; id: string },
  b: { created_at: Date | null; id: string },
): number {
  const created =
    (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0);
  return created !== 0 ? created : a.id.localeCompare(b.id);
}
