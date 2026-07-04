import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantCredentials } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  normalizeCredentialSecret,
  rotateTenantCredentialSecret,
} from "../../../lib/tenant-credentials/secret-store.js";
import {
  validateGithubRepoConnection,
  type GithubRepoCredentialPayload,
} from "../../../lib/routines/repo-connection.js";
import {
  credentialToGraphql,
  loadTenantCredentialForMutation,
} from "./shared.js";

interface RotateTenantCredentialArgs {
  input: {
    id: string;
    secretJson: unknown;
  };
}

export async function rotateTenantCredential(
  _parent: unknown,
  args: RotateTenantCredentialArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const current = await loadTenantCredentialForMutation(args.input.id);
  await requireAdminOrApiKeyCaller(
    ctx,
    current.tenant_id,
    "manage_tenant_credentials",
  );

  const secret = normalizeCredentialSecret(current.kind, args.input.secretJson);
  // Rotations revalidate the connection like first save (R2) — the secret
  // in Secrets Manager is only replaced by a working repo/token/branch.
  if (current.kind === "github_repo") {
    await validateGithubRepoConnection(
      secret as unknown as GithubRepoCredentialPayload,
    );
  }
  await rotateTenantCredentialSecret({
    secretRef: current.secret_ref,
    payload: secret,
  });

  const [row] = await db
    .update(tenantCredentials)
    .set({
      updated_at: new Date(),
      last_validated_at: null,
    })
    .where(eq(tenantCredentials.id, current.id))
    .returning();

  return credentialToGraphql(row);
}
