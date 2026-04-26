import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  activationApplyOutbox,
  activationSessions,
  activationSessionTurns,
  agents,
  and,
  db,
  desc,
  eq,
  randomUUID,
  sql,
  userProfiles,
  users,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export const ACTIVATION_LAYER_ORDER = [
  "rhythms",
  "decisions",
  "dependencies",
  "knowledge",
  "friction",
] as const;

export type ActivationLayer = (typeof ACTIVATION_LAYER_ORDER)[number];

export function parseAwsJson(value: unknown, fieldName: string): unknown {
  if (value == null) return {};
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new GraphQLError(`${fieldName} must be valid JSON`, {
      extensions: { code: "BAD_INPUT" },
    });
  }
}

export function activationSessionToGraphql(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    mode: row.mode,
    focusLayer: row.focus_layer,
    currentLayer: row.current_layer,
    status: row.status,
    layerStates: JSON.stringify(row.layer_states ?? {}),
    lastAgentMessage: row.last_agent_message,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    lastActiveAt:
      row.last_active_at instanceof Date
        ? row.last_active_at.toISOString()
        : row.last_active_at,
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : row.completed_at,
  };
}

export function activationTurnToGraphql(row: Record<string, unknown>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    layerId: row.layer_id,
    turnIndex: row.turn_index,
    role: row.role,
    content: row.content,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export function activationEventFromSession(
  row: Record<string, unknown>,
  eventType: string,
) {
  return {
    sessionId: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    status: row.status,
    currentLayer: row.current_layer,
    layerStates: JSON.stringify(row.layer_states ?? {}),
    lastAgentMessage: row.last_agent_message,
    eventType,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}

export async function loadActivationSession(sessionId: string) {
  const [session] = await db
    .select()
    .from(activationSessions)
    .where(eq(activationSessions.id, sessionId));
  if (!session) {
    throw new GraphQLError("Activation session not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return session;
}

export async function assertActivationAccess(
  ctx: GraphQLContext,
  session: { user_id: string; tenant_id: string },
): Promise<void> {
  if (ctx.auth.authType === "apikey") {
    if (!ctx.auth.agentId) {
      throw new GraphQLError("Agent identity required", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    const [agent] = await db
      .select({
        human_pair_id: agents.human_pair_id,
        tenant_id: agents.tenant_id,
      })
      .from(agents)
      .where(
        and(
          eq(agents.id, ctx.auth.agentId),
          eq(agents.tenant_id, session.tenant_id),
        ),
      );
    if (!agent || agent.human_pair_id !== session.user_id) {
      throw new GraphQLError("Agent is not paired with this user", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    return;
  }

  const caller = await resolveCaller(ctx);
  if (caller.userId === session.user_id) return;
  await requireTenantAdmin(ctx, session.tenant_id);
}

export async function assertUserAccess(
  ctx: GraphQLContext,
  userId: string,
): Promise<{ userId: string; tenantId: string }> {
  const [target] = await db
    .select({ id: users.id, tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, userId));
  if (!target || !target.tenant_id) {
    throw new GraphQLError("User not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  if (ctx.auth.authType === "apikey") {
    if (!ctx.auth.agentId) {
      throw new GraphQLError("Agent identity required", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    const [agent] = await db
      .select({
        human_pair_id: agents.human_pair_id,
        tenant_id: agents.tenant_id,
      })
      .from(agents)
      .where(
        and(
          eq(agents.id, ctx.auth.agentId),
          eq(agents.tenant_id, target.tenant_id),
        ),
      );
    if (!agent || agent.human_pair_id !== userId) {
      throw new GraphQLError("Agent is not paired with this user", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    return { userId: target.id, tenantId: target.tenant_id };
  }

  const caller = await resolveCaller(ctx);
  if (caller.userId !== target.id) {
    await requireTenantAdmin(ctx, target.tenant_id);
  }
  return { userId: target.id, tenantId: target.tenant_id };
}

export async function nextTurnIndex(sessionId: string): Promise<number> {
  const [latest] = await db
    .select({ turn_index: activationSessionTurns.turn_index })
    .from(activationSessionTurns)
    .where(eq(activationSessionTurns.session_id, sessionId))
    .orderBy(desc(activationSessionTurns.turn_index))
    .limit(1);
  return (latest?.turn_index ?? -1) + 1;
}

export async function invokeActivationRuntime(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const functionName = process.env.ACTIVATION_AGENT_INVOKE_FN_ARN;
  if (!functionName) return null;

  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
  const raw = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "";
  if (response.FunctionError) {
    throw new GraphQLError(`Activation runtime failed: ${raw}`, {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { message: raw };
  }
}

export function fallbackAgentMessage(layer: string): string {
  const label = layer.replace(/_/g, " ");
  return `Let's map your ${label}. What tends to repeat, matter, or slow you down here?`;
}

export function composeOperatingModel(
  layerStates: unknown,
): Record<string, unknown> {
  const states =
    typeof layerStates === "object" && layerStates !== null
      ? (layerStates as Record<string, any>)
      : {};
  const layers: Record<string, unknown> = {};
  for (const layer of ACTIVATION_LAYER_ORDER) {
    const state = states[layer] ?? {};
    layers[layer] = {
      ...(typeof state === "object" && state !== null ? state : {}),
      applied_at: new Date().toISOString(),
    };
  }
  return { version: 1, layers };
}

export async function insertApplyOutboxRows(
  tx: any,
  sessionId: string,
  userId: string,
  tenantId: string,
  approvals: Array<Record<string, any>>,
): Promise<void> {
  const pairedAgents = await tx
    .select({ id: agents.id, tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.human_pair_id, userId));

  const rows: Array<typeof activationApplyOutbox.$inferInsert> = [];
  for (const agent of pairedAgents) {
    rows.push({
      session_id: sessionId,
      item_type: "user_md",
      payload: { agentId: agent.id, tenantId: agent.tenant_id, userId },
    });
  }

  for (const approval of approvals) {
    if (approval.action !== "apply") continue;
    const layer = approval.layer;
    const target =
      layer === "friction" ? "memory" : approval.target || "memory";
    rows.push({
      session_id: sessionId,
      item_type: target === "wiki" ? "wiki_seed" : "memory_seed",
      payload: { tenantId, userId, layer, payload: approval.payload },
    });
  }

  if (rows.length > 0) {
    await tx.insert(activationApplyOutbox).values(rows);
  }
}

export function assertFrictionPrivacy(
  approvals: Array<Record<string, any>>,
): void {
  for (const approval of approvals) {
    if (
      approval.action === "apply" &&
      approval.layer === "friction" &&
      approval.target === "wiki"
    ) {
      throw new GraphQLError(
        "Friction-layer entries can only target private memory",
        {
          extensions: { code: "BAD_INPUT" },
        },
      );
    }
  }
}

export async function applyOperatingModel(
  session: typeof activationSessions.$inferSelect,
  applyId: string,
  approvals: Array<Record<string, any>>,
) {
  assertFrictionPrivacy(approvals);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(activationSessions)
      .where(eq(activationSessions.id, session.id))
      .for("update");
    if (!locked) {
      throw new GraphQLError("Activation session not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    if (locked.last_apply_id === applyId) return locked;
    if (locked.status !== "ready_for_review") {
      throw new GraphQLError("Activation session is not ready to apply", {
        extensions: { code: "BAD_INPUT" },
      });
    }

    const operatingModel = composeOperatingModel(locked.layer_states);
    await tx
      .update(userProfiles)
      .set({
        operating_model: operatingModel,
        operating_model_history: sql`array_append(${userProfiles.operating_model_history}, coalesce(${userProfiles.operating_model}, '{}'::jsonb))`,
        updated_at: new Date(),
      })
      .where(eq(userProfiles.user_id, locked.user_id));

    await insertApplyOutboxRows(
      tx,
      locked.id,
      locked.user_id,
      locked.tenant_id,
      approvals,
    );

    const [updated] = await tx
      .update(activationSessions)
      .set({
        status: "applied",
        last_apply_id: applyId,
        completed_at: new Date(),
        updated_at: new Date(),
        last_active_at: new Date(),
      })
      .where(eq(activationSessions.id, locked.id))
      .returning();
    return updated;
  });
}

export { activationSessions, activationSessionTurns, randomUUID, sql };
