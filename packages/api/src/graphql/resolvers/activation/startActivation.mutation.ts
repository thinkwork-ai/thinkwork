import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq } from "../../utils.js";
import {
  activationSessionToGraphql,
  activationSessions,
  assertUserAccess,
  fallbackAgentMessage,
  invokeActivationRuntime,
} from "./shared.js";
import { startSystemWorkflow } from "../../../lib/system-workflows/start.js";

export const startActivation = async (
  _parent: unknown,
  args: {
    input: {
      userId: string;
      mode?: "full" | "refresh";
      focusLayer?: string | null;
    };
  },
  ctx: GraphQLContext,
) => {
  const mode = args.input.mode ?? "full";
  if (mode === "refresh" && !args.input.focusLayer) {
    throw new GraphQLError("focusLayer is required for refresh activation", {
      extensions: { code: "BAD_INPUT" },
    });
  }
  const target = await assertUserAccess(ctx, args.input.userId);
  const [existing] = await db
    .select()
    .from(activationSessions)
    .where(
      and(
        eq(activationSessions.user_id, target.userId),
        eq(activationSessions.status, "in_progress"),
      ),
    )
    .limit(1);
  if (existing) {
    await launchActivationSystemWorkflow(existing, ctx);
    return activationSessionToGraphql(existing);
  }

  const currentLayer = mode === "refresh" ? args.input.focusLayer! : "rhythms";
  const runtimeResult = await invokeActivationRuntime({
    action: "start",
    userId: target.userId,
    tenantId: target.tenantId,
    mode,
    focusLayer: args.input.focusLayer ?? null,
    currentLayer,
  });
  const lastAgentMessage =
    typeof runtimeResult?.message === "string"
      ? runtimeResult.message
      : fallbackAgentMessage(currentLayer);

  const [created] = await db
    .insert(activationSessions)
    .values({
      user_id: target.userId,
      tenant_id: target.tenantId,
      mode,
      focus_layer: args.input.focusLayer ?? null,
      current_layer: currentLayer,
      last_agent_message: lastAgentMessage,
    })
    .returning();
  await launchActivationSystemWorkflow(created, ctx);
  return activationSessionToGraphql(created);
};

async function launchActivationSystemWorkflow(
  session: typeof activationSessions.$inferSelect,
  ctx: GraphQLContext,
): Promise<void> {
  try {
    await startSystemWorkflow({
      workflowId: "tenant-agent-activation",
      tenantId: session.tenant_id,
      triggerSource: "graphql",
      actorId: ctx.auth.principalId ?? null,
      actorType: ctx.auth.authType,
      domainRef: { type: "activation_session", id: session.id },
      input: {
        activationSessionId: session.id,
        userId: session.user_id,
        mode: session.mode,
        focusLayer: session.focus_layer,
        currentLayer: session.current_layer,
      },
    });
  } catch (err) {
    if (!isUnconfiguredSystemWorkflow(err)) throw err;
    console.warn(
      `[startActivation] system workflow unavailable, continuing with activation session only: ${(err as Error)?.message}`,
    );
  }
}

function isUnconfiguredSystemWorkflow(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes("has no configured state machine ARN")
  );
}
