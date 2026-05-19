import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaceMembers, spaces } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { toGraphqlSpace } from "./shared.js";

type CreateSpaceInput = {
  tenantId: string;
  name: string;
  description?: string | null;
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
  const callerUserId = await resolveCallerUserId(ctx);
  const slug = await nextAvailableSpaceSlug(input.tenantId, slugify(name));

  const [row] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(spaces)
      .values({
        tenant_id: input.tenantId,
        slug,
        name,
        description,
        status: "active",
        kind: "custom",
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

  return toGraphqlSpace(row);
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

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "space"
  );
}
