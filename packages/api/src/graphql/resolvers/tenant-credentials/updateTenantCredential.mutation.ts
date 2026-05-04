import type { GraphQLContext } from "../../context.js";
import { db, eq, tenantCredentials } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { parseAwsJsonObject } from "../../../lib/tenant-credentials/secret-store.js";
import {
  assertKnownStatus,
  assertSlugAvailable,
  credentialToGraphql,
  loadTenantCredentialForMutation,
  normalizeSlug,
} from "./shared.js";

interface UpdateTenantCredentialArgs {
  id: string;
  input: {
    displayName?: string | null;
    slug?: string | null;
    status?: string | null;
    metadataJson?: unknown;
  };
}

export async function updateTenantCredential(
  _parent: unknown,
  args: UpdateTenantCredentialArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const current = await loadTenantCredentialForMutation(args.id);
  await requireAdminOrApiKeyCaller(
    ctx,
    current.tenant_id,
    "manage_tenant_credentials",
  );

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (args.input.displayName != null) {
    const displayName = args.input.displayName.trim();
    if (!displayName) throw new Error("displayName cannot be blank");
    updates.display_name = displayName;
  }
  if (args.input.slug != null) {
    const slug = normalizeSlug(args.input.slug);
    await assertSlugAvailable({
      tenantId: current.tenant_id,
      slug,
      exceptId: current.id,
    });
    updates.slug = slug;
  }
  if (args.input.status != null) {
    assertKnownStatus(args.input.status);
    updates.status = args.input.status;
    updates.deleted_at = args.input.status === "deleted" ? new Date() : null;
  }
  if (args.input.metadataJson !== undefined) {
    updates.metadata_json = parseAwsJsonObject(
      args.input.metadataJson ?? {},
      "metadataJson",
    );
  }

  const [row] = await db
    .update(tenantCredentials)
    .set(updates)
    .where(eq(tenantCredentials.id, args.id))
    .returning();

  return credentialToGraphql(row);
}
