import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, ne, spaces, sql, tenants } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  copySpaceSourcePrefix,
  deleteSpaceSourceKeys,
  deleteSpaceSourcePrefix,
} from "../../../lib/spaces/space-source-prefix-rename.js";
import { normalizeExplicitSpaceSlug } from "../../../lib/spaces/space-slug.js";
import { parseSpaceEmailTriggerStatus, toGraphqlSpace } from "./shared.js";

type UpdateSpaceEmailTriggerInput = {
  spaceId: string;
  status: string;
  emailPrefix?: string | null;
};

export async function setSpaceEmailTriggers(
  _parent: unknown,
  args: { spaceId: string; enabled: boolean },
  ctx: GraphQLContext,
) {
  return updateSpaceEmailTriggerState(
    {
      spaceId: args.spaceId,
      status: args.enabled ? "ENABLED" : "DISABLED",
    },
    ctx,
    "set_space_email_triggers",
  );
}

export async function updateSpaceEmailTrigger(
  _parent: unknown,
  args: { input: UpdateSpaceEmailTriggerInput },
  ctx: GraphQLContext,
) {
  return updateSpaceEmailTriggerState(
    args.input,
    ctx,
    "update_space_email_trigger",
  );
}

async function updateSpaceEmailTriggerState(
  input: UpdateSpaceEmailTriggerInput,
  ctx: GraphQLContext,
  authAction: string,
) {
  const status = parseSpaceEmailTriggerStatus(input.status);
  if (!status) throw new GraphQLError("Invalid email trigger status");

  const [space] = await db
    .select({
      id: spaces.id,
      tenant_id: spaces.tenant_id,
      slug: spaces.slug,
      email_trigger_status: spaces.email_trigger_status,
    })
    .from(spaces)
    .where(eq(spaces.id, input.spaceId));

  if (!space) throw new GraphQLError("Space not found");

  await requireAdminOrServiceCaller(ctx, space.tenant_id, authAction);

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, space.tenant_id));
  if (!tenant) throw new GraphQLError("Tenant not found");

  const hasPrefixEdit =
    input.emailPrefix !== undefined && input.emailPrefix !== null;
  if (status === "none" && hasPrefixEdit) {
    throw new GraphQLError("Cannot edit email prefix while deleting trigger");
  }

  let newSlug = space.slug;
  if (hasPrefixEdit) {
    newSlug = normalizeExplicitSpaceSlug(input.emailPrefix ?? "");
    if (!newSlug) throw new GraphQLError("Space email prefix is required");

    await assertSpaceSlugAvailable(db, space.tenant_id, input.spaceId, newSlug);
  }

  const slugChanged = newSlug !== space.slug;
  if (slugChanged) {
    const row = await updateSpaceEmailTriggerWithSlugChange({
      input,
      space,
      tenantSlug: tenant.slug,
      status,
      newSlug,
    });
    return toGraphqlSpace(row);
  }

  const [row] = await db
    .update(spaces)
    .set({
      ...(slugChanged ? { slug: newSlug } : {}),
      email_trigger_status: status,
      email_triggers_enabled: status === "enabled",
      updated_at: new Date(),
    })
    .where(
      and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, space.tenant_id)),
    )
    .returning();

  if (!row) throw new GraphQLError("Space not found");

  if (slugChanged) {
    try {
      const result = await deleteSpaceSourcePrefix({
        tenantSlug: tenant.slug,
        oldSpaceSlug: space.slug,
      });
      if (result.failures.length > 0) {
        console.warn("Space source prefix cleanup had per-object failures", {
          tenantSlug: tenant.slug,
          oldSpaceSlug: space.slug,
          failures: result.failures,
        });
      }
    } catch (err) {
      console.warn("Space source prefix cleanup failed", {
        tenantSlug: tenant.slug,
        oldSpaceSlug: space.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return toGraphqlSpace(row);
}

async function updateSpaceEmailTriggerWithSlugChange(input: {
  input: UpdateSpaceEmailTriggerInput;
  space: { id: string; tenant_id: string; slug: string };
  tenantSlug: string;
  status: string;
  newSlug: string;
}) {
  let copyResult: Awaited<ReturnType<typeof copySpaceSourcePrefix>> | null =
    null;
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`space-email-trigger:${input.space.tenant_id}:${input.newSlug}`}))`,
    );
    await assertSpaceSlugAvailable(
      tx,
      input.space.tenant_id,
      input.input.spaceId,
      input.newSlug,
    );

    copyResult = await copySpaceSourcePrefix({
      tenantSlug: input.tenantSlug,
      oldSpaceSlug: input.space.slug,
      newSpaceSlug: input.newSlug,
    });

    try {
      const [updated] = await tx
        .update(spaces)
        .set({
          slug: input.newSlug,
          email_trigger_status: input.status,
          email_triggers_enabled: input.status === "enabled",
          updated_at: new Date(),
        })
        .where(
          and(
            eq(spaces.id, input.input.spaceId),
            eq(spaces.tenant_id, input.space.tenant_id),
          ),
        )
        .returning();

      if (!updated) throw new GraphQLError("Space not found");

      await copySpaceSourcePrefix({
        tenantSlug: input.tenantSlug,
        oldSpaceSlug: input.space.slug,
        newSpaceSlug: input.newSlug,
        mode: "overwrite",
      });
      return updated;
    } catch (err) {
      await cleanupCopiedKeys(copyResult?.copiedKeys ?? []);
      throw err;
    }
  });

  try {
    const result = await deleteSpaceSourcePrefix({
      tenantSlug: input.tenantSlug,
      oldSpaceSlug: input.space.slug,
    });
    if (result.failures.length > 0) {
      console.warn("Space source prefix cleanup had per-object failures", {
        tenantSlug: input.tenantSlug,
        oldSpaceSlug: input.space.slug,
        failures: result.failures,
      });
    }
  } catch (err) {
    console.warn("Space source prefix cleanup failed", {
      tenantSlug: input.tenantSlug,
      oldSpaceSlug: input.space.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return row;
}

async function assertSpaceSlugAvailable(
  database: Pick<typeof db, "select">,
  tenantId: string,
  spaceId: string,
  slug: string,
) {
  const [conflict] = await database
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, tenantId),
        eq(spaces.slug, slug),
        ne(spaces.id, spaceId),
      ),
    );
  if (conflict) {
    throw new GraphQLError("Space email prefix is already in use");
  }
}

async function cleanupCopiedKeys(copiedKeys: string[]) {
  try {
    const result = await deleteSpaceSourceKeys({ keys: copiedKeys });
    if (result.failures.length > 0) {
      console.warn("Space source prefix rollback cleanup had failures", {
        failures: result.failures,
      });
    }
  } catch (err) {
    console.warn("Space source prefix rollback cleanup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
