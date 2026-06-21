import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import { and, db, eq, artifacts, threads } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { artifactToCamelWithPayload } from "./payload.js";

export const artifact = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.id));
  if (!row) return null;
  await requireTenantMember(ctx, row.tenant_id);
  await assertGenUISnapshotAccess(ctx, row);
  return artifactToCamelWithPayload(row);
};

async function assertGenUISnapshotAccess(
  ctx: GraphQLContext,
  row: { tenant_id: string; thread_id?: string | null; metadata?: unknown },
) {
  if (!isGenUISnapshotArtifact(row.metadata)) return;
  if (!row.thread_id) {
    throw new GraphQLError("Generated UI artifact is missing source thread", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || caller.tenantId !== row.tenant_id) {
    throw new GraphQLError("Generated UI artifact source thread required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const [visibleThread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.id, row.thread_id),
        eq(threads.tenant_id, row.tenant_id),
        callerVisibleThreadPredicate(row.tenant_id, caller.userId),
      ),
    );
  if (!visibleThread) {
    throw new GraphQLError("Generated UI artifact source thread required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}

function isGenUISnapshotArtifact(metadata: unknown): boolean {
  if (typeof metadata === "string") {
    try {
      return isGenUISnapshotArtifact(JSON.parse(metadata));
    } catch {
      return false;
    }
  }
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as { kind?: unknown }).kind === "genui_snapshot"
  );
}
