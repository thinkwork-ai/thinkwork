import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantCredentials } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { scheduleTenantCredentialSecretDeletion } from "../../../lib/tenant-credentials/secret-store.js";
import { loadTenantCredentialForMutation } from "./shared.js";

export async function deleteTenantCredential(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<boolean> {
  const current = await loadTenantCredentialForMutation(args.id);
  await requireAdminOrApiKeyCaller(
    ctx,
    current.tenant_id,
    "manage_tenant_credentials",
  );

  // rds_iam rows carry no stored secret (empty secret_ref sentinel).
  if (current.secret_ref) {
    await scheduleTenantCredentialSecretDeletion(current.secret_ref);
  }
  await db
    .update(tenantCredentials)
    .set({
      status: "deleted",
      deleted_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(tenantCredentials.id, current.id));

  return true;
}
