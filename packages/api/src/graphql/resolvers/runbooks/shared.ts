import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, computers, computerRunbookRuns } from "../../utils.js";
import { requireComputerReadAccess } from "../computers/shared.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function resolveRunbookCaller(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; userId: string | null }> {
  const caller = await resolveCaller(ctx);
  if (!caller.tenantId) {
    throw new GraphQLError("Tenant context is required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return { tenantId: caller.tenantId, userId: caller.userId };
}

export async function requireRunbookRunAccess(
  ctx: GraphQLContext,
  tenantId: string,
  runId: string,
) {
  const [run] = await db
    .select()
    .from(computerRunbookRuns)
    .where(
      and(
        eq(computerRunbookRuns.tenant_id, tenantId),
        eq(computerRunbookRuns.id, runId),
      ),
    )
    .limit(1);
  if (!run) {
    throw new GraphQLError("Runbook run not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const [computer] = await db
    .select()
    .from(computers)
    .where(
      and(eq(computers.tenant_id, tenantId), eq(computers.id, run.computer_id)),
    )
    .limit(1);
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireComputerReadAccess(ctx, computer);
  return run;
}

export async function requireComputerAccess(
  ctx: GraphQLContext,
  tenantId: string,
  computerId: string,
) {
  const [computer] = await db
    .select()
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireComputerReadAccess(ctx, computer);
  return computer;
}
