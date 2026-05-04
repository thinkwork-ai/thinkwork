import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenantCredentials } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { assertKnownStatus, credentialToGraphql } from "./shared.js";

export async function tenantCredentials_(
  _parent: unknown,
  args: { tenantId: string; status?: string | null },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  await requireAdminOrApiKeyCaller(ctx, args.tenantId, "read_tenant_credentials");

  const conditions = [eq(tenantCredentials.tenant_id, args.tenantId)];
  if (args.status) {
    assertKnownStatus(args.status);
    conditions.push(eq(tenantCredentials.status, args.status));
  }

  const rows = await db
    .select()
    .from(tenantCredentials)
    .where(and(...conditions))
    .orderBy(tenantCredentials.display_name);

  return rows.map((row) => credentialToGraphql(row));
}
