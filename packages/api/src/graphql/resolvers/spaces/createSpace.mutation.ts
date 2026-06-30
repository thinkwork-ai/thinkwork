import { GraphQLError } from "graphql";
import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaceMembers, spaces, tenants } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { normalizeSpaceSlug } from "../../../lib/spaces/space-slug.js";
import { ensureSpaceMdSourceFile } from "../../../lib/spaces/space-md-source-file.js";
import { parseSpaceAccessMode, toGraphqlSpace } from "./shared.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

type CreateSpaceInput = {
  tenantId: string;
  name: string;
  description?: string | null;
  accessMode?: string | null;
};

export async function createSpace(
  _parent: unknown,
  args: { input: CreateSpaceInput },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(ctx, input.tenantId, "create_space");

  const name = input.name.trim();
  if (!name) {
    throw new GraphQLError("Space name is required");
  }

  const description = input.description?.trim() || null;
  const accessMode = parseSpaceAccessMode(input.accessMode) ?? "public";
  const callerUserId = await resolveCallerUserId(ctx);
  const slug = await nextAvailableSpaceSlug(
    input.tenantId,
    normalizeSpaceSlug(name),
  );
  const folderName = await nextAvailableSpaceFolderName(input.tenantId, name);
  const tenantSlug = await tenantSlugForSpace(input.tenantId);

  const [row] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(spaces)
      .values({
        tenant_id: input.tenantId,
        slug,
        workspace_folder_name: folderName,
        name,
        description,
        status: "active",
        kind: "custom",
        access_mode: accessMode,
        template_key: slug,
        config: {
          workflow: "custom",
          version: 1,
          source: "admin_create_space",
        },
      })
      .returning();

    if (callerUserId) {
      await tx
        .insert(spaceMembers)
        .values({
          tenant_id: input.tenantId,
          space_id: created.id,
          user_id: callerUserId,
          role: "owner",
          notification_preference: "subscribed",
        })
        .onConflictDoNothing();
    }

    return [created];
  });

  await seedSpaceMdSourceFile({
    bucket: getConfig("WORKSPACE_BUCKET") || "",
    tenantSlug,
    spaceSlug: folderName,
    spaceName: name,
    description,
  });

  return toGraphqlSpace(row);
}

async function seedSpaceMdSourceFile(input: {
  bucket: string;
  tenantSlug: string | null;
  spaceSlug: string;
  spaceName: string;
  description: string | null;
}) {
  if (!input.bucket || !input.tenantSlug) return;
  try {
    await ensureSpaceMdSourceFile({
      ...input,
      tenantSlug: input.tenantSlug,
      overwrite: false,
      s3Client: s3,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[createSpace] SPACE.md seed failed for ${input.tenantSlug}/${input.spaceSlug}: ${message}`,
    );
  }
}

async function tenantSlugForSpace(tenantId: string): Promise<string | null> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.slug ?? null;
}

async function nextAvailableSpaceFolderName(
  tenantId: string,
  displayName: string,
) {
  const existingRows = await db
    .select({
      slug: spaces.slug,
      workspaceFolderName: spaces.workspace_folder_name,
    })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId)));
  return workspaceFolderName(
    displayName,
    existingRows.map((row) => row.workspaceFolderName ?? row.slug),
    "space",
  );
}

async function nextAvailableSpaceSlug(tenantId: string, baseSlug: string) {
  const existingRows = await db
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId)));
  const existing = new Set(existingRows.map((row) => row.slug));

  if (!existing.has(baseSlug)) return baseSlug;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new GraphQLError("Could not generate a unique Space slug");
}
