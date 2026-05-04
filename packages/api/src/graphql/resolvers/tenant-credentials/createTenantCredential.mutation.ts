import { randomUUID } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import { db, tenantCredentials } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  normalizeCredentialSecret,
  parseAwsJsonObject,
  putTenantCredentialSecret,
  scheduleTenantCredentialSecretDeletion,
  tenantCredentialSecretName,
} from "../../../lib/tenant-credentials/secret-store.js";
import {
  assertKnownKind,
  assertSlugAvailable,
  credentialToGraphql,
  normalizeSlug,
  slugFromDisplayName,
} from "./shared.js";

interface CreateTenantCredentialArgs {
  input: {
    tenantId: string;
    displayName: string;
    slug?: string | null;
    kind: string;
    metadataJson?: unknown;
    secretJson: unknown;
  };
}

export async function createTenantCredential(
  _parent: unknown,
  args: CreateTenantCredentialArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAdminOrApiKeyCaller(
    ctx,
    input.tenantId,
    "manage_tenant_credentials",
  );
  assertKnownKind(input.kind);

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("displayName is required");

  const slug = normalizeSlug(input.slug?.trim() || slugFromDisplayName(displayName));
  await assertSlugAvailable({ tenantId: input.tenantId, slug });

  const credentialId = randomUUID();
  const secretName = tenantCredentialSecretName({
    tenantId: input.tenantId,
    credentialId,
  });
  const secret = normalizeCredentialSecret(input.kind, input.secretJson);
  const secretRef = await putTenantCredentialSecret({
    secretName,
    payload: secret,
  });
  const metadata = parseAwsJsonObject(input.metadataJson ?? {}, "metadataJson");
  const actorId = await resolveCallerUserId(ctx);

  try {
    const [row] = await db
      .insert(tenantCredentials)
      .values({
        id: credentialId,
        tenant_id: input.tenantId,
        display_name: displayName,
        slug,
        kind: input.kind,
        status: "active",
        secret_ref: secretRef,
        schema_json: {},
        metadata_json: metadata,
        created_by_user_id: actorId ?? ctx.auth.principalId ?? null,
      })
      .returning();

    return credentialToGraphql(row);
  } catch (err) {
    await scheduleTenantCredentialSecretDeletion(secretRef).catch((cleanupErr) => {
      console.error(
        "[tenant-credentials] Failed to schedule orphaned secret cleanup",
        cleanupErr,
      );
    });
    throw err;
  }
}
