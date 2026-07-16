import type { GraphQLContext } from "../../context.js";

/**
 * ThreadTurn type resolvers (THINK-301 U6, KTD-A). recoveryPending is
 * derived server-side from retry_queue via a per-request DataLoader so every
 * ThreadTurn-returning surface (threadTurns, threadTurn, cancelThreadTurn)
 * gets it uniformly with no N+1. Always resolves a boolean, never null.
 */
export const threadTurnTypeResolvers = {
  recoveryPending: (turn: any, _args: any, ctx: GraphQLContext) => {
    const turnId = turn?.id;
    if (!turnId || typeof turnId !== "string") return false;
    const tenantId = turn.tenantId ?? turn.tenant_id ?? null;
    return ctx.loaders.threadTurnRecoveryPending.load({
      turnId,
      tenantId: typeof tenantId === "string" ? tenantId : null,
    });
  },
};
