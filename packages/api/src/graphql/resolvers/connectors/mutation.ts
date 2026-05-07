import { and, eq } from "drizzle-orm";
import {
  agents,
  computers,
  connections,
  connectors as connectorsTable,
  routines,
} from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  runConnectorDispatchTick,
  type ConnectorDispatchResult,
} from "../../../lib/connectors/runtime.js";

type DispatchTargetType = "agent" | "routine" | "hybrid_routine" | "computer";

type CreateConnectorInput = {
  tenantId: string;
  type: string;
  name: string;
  description?: string | null;
  connectionId?: string | null;
  config?: unknown;
  dispatchTargetType: DispatchTargetType;
  dispatchTargetId: string;
  enabled?: boolean | null;
  createdByType?: string | null;
  createdById?: string | null;
};

type UpdateConnectorInput = {
  type?: string | null;
  name?: string | null;
  description?: string | null;
  connectionId?: string | null;
  config?: unknown;
  dispatchTargetType?: DispatchTargetType | null;
  dispatchTargetId?: string | null;
  enabled?: boolean | null;
};

type ConnectorRow = typeof connectorsTable.$inferSelect;

export async function createConnector(
  _parent: unknown,
  args: { input: CreateConnectorInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireTenantAdmin(ctx, input.tenantId);
  await validateDispatchTarget(
    input.tenantId,
    input.dispatchTargetType,
    input.dispatchTargetId,
  );
  await validateConnection(input.tenantId, input.connectionId ?? null);

  const [row] = await db
    .insert(connectorsTable)
    .values({
      tenant_id: input.tenantId,
      type: requireString(input.type, "type"),
      name: requireString(input.name, "name"),
      description: input.description ?? null,
      connection_id: input.connectionId ?? null,
      config: parseAwsJson(input.config, "config"),
      dispatch_target_type: input.dispatchTargetType,
      dispatch_target_id: input.dispatchTargetId,
      enabled: input.enabled ?? true,
      created_by_type: input.createdByType ?? null,
      created_by_id: input.createdById ?? null,
    })
    .returning();
  if (!row) {
    throw new GraphQLError("Failed to create connector", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  auditConnectorMutation("createConnector", row, "success", ctx);
  return snakeToCamel(row);
}

export async function updateConnector(
  _parent: unknown,
  args: { id: string; input: UpdateConnectorInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const current = await loadConnectorForMutation(args.id);
  await requireTenantAdmin(ctx, current.tenant_id);

  const input = args.input;
  const dispatchTargetType =
    input.dispatchTargetType ?? current.dispatch_target_type;
  const dispatchTargetId = input.dispatchTargetId ?? current.dispatch_target_id;
  if (
    input.dispatchTargetType !== undefined ||
    input.dispatchTargetId !== undefined
  ) {
    if (!dispatchTargetType || !dispatchTargetId) {
      throw new GraphQLError("Connector dispatch target is required", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    await validateDispatchTarget(
      current.tenant_id,
      dispatchTargetType as DispatchTargetType,
      dispatchTargetId,
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (input.type !== undefined)
    updates.type = requireString(input.type, "type");
  if (input.name !== undefined)
    updates.name = requireString(input.name, "name");
  if (input.description !== undefined)
    updates.description = input.description ?? null;
  if (input.connectionId !== undefined)
    updates.connection_id = input.connectionId ?? null;
  if (input.connectionId !== undefined)
    await validateConnection(current.tenant_id, input.connectionId ?? null);
  if (input.config !== undefined)
    updates.config = parseAwsJson(input.config, "config");
  if (input.dispatchTargetType !== undefined)
    updates.dispatch_target_type = requireString(
      input.dispatchTargetType,
      "dispatchTargetType",
    );
  if (input.dispatchTargetId !== undefined)
    updates.dispatch_target_id = requireString(
      input.dispatchTargetId,
      "dispatchTargetId",
    );
  if (input.enabled !== undefined)
    updates.enabled = requireBoolean(input.enabled, "enabled");

  const [row] = await db
    .update(connectorsTable)
    .set(updates)
    .where(eq(connectorsTable.id, args.id))
    .returning();
  if (!row) {
    throw new GraphQLError("Connector not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  auditConnectorMutation("updateConnector", row, "success", ctx);
  return snakeToCamel(row);
}

export async function pauseConnector(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown> {
  return updateConnectorLifecycle(args.id, "pauseConnector", ctx, {
    status: "paused",
    enabled: false,
  });
}

export async function resumeConnector(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown> {
  return updateConnectorLifecycle(args.id, "resumeConnector", ctx, {
    status: "active",
    enabled: true,
  });
}

export async function archiveConnector(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown> {
  return updateConnectorLifecycle(args.id, "archiveConnector", ctx, {
    status: "archived",
    enabled: false,
  });
}

export async function runConnectorNow(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown> {
  const current = await loadConnectorForMutation(args.id);
  await requireTenantAdmin(ctx, current.tenant_id);

  const results = await runConnectorDispatchTick({
    connectorId: current.id,
    tenantId: current.tenant_id,
    limit: 1,
    force: true,
  });

  auditConnectorMutation("runConnectorNow", current, "success", ctx);
  return {
    connectorId: current.id,
    results: results.map(connectorDispatchResultToGraphql),
  };
}

async function updateConnectorLifecycle(
  id: string,
  mutationName: string,
  ctx: GraphQLContext,
  lifecycle: { status: "active" | "paused" | "archived"; enabled: boolean },
): Promise<unknown> {
  const current = await loadConnectorForMutation(id);
  await requireTenantAdmin(ctx, current.tenant_id);

  const [row] = await db
    .update(connectorsTable)
    .set({
      status: lifecycle.status,
      enabled: lifecycle.enabled,
      updated_at: new Date(),
    })
    .where(eq(connectorsTable.id, id))
    .returning();
  if (!row) {
    throw new GraphQLError("Connector not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  auditConnectorMutation(mutationName, row, "success", ctx);
  return snakeToCamel(row);
}

async function loadConnectorForMutation(id: string): Promise<ConnectorRow> {
  const [row] = await db
    .select()
    .from(connectorsTable)
    .where(eq(connectorsTable.id, id))
    .limit(1);

  if (!row) {
    throw new GraphQLError("Connector not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}

async function validateDispatchTarget(
  tenantId: string,
  dispatchTargetType: DispatchTargetType,
  dispatchTargetId: string,
): Promise<void> {
  let table: typeof agents | typeof routines | typeof computers | null = null;
  if (dispatchTargetType === "agent") table = agents;
  if (dispatchTargetType === "computer") table = computers;
  if (
    dispatchTargetType === "routine" ||
    dispatchTargetType === "hybrid_routine"
  ) {
    table = routines;
  }
  if (!table) {
    throw new GraphQLError("Connector dispatch target type is invalid", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const [target] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, dispatchTargetId), eq(table.tenant_id, tenantId)))
    .limit(1);

  if (!target) {
    throw new GraphQLError("Connector dispatch target not found", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

async function validateConnection(
  tenantId: string,
  connectionId: string | null,
): Promise<void> {
  if (!connectionId) return;

  const [connection] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.tenant_id, tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    throw new GraphQLError("Connector connection not found", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function parseAwsJson(value: unknown, fieldName: string): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new GraphQLError(`${fieldName} must be valid JSON`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function requireString(value: string | null, fieldName: string): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new GraphQLError(`${fieldName} must be a non-empty string`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function requireBoolean(value: boolean | null, fieldName: string): boolean {
  if (typeof value === "boolean") return value;
  throw new GraphQLError(`${fieldName} must be a boolean`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function auditConnectorMutation(
  mutationName: string,
  row: ConnectorRow,
  outcome: "success",
  ctx: GraphQLContext,
): void {
  console.info(
    "[connector_mutation_audit]",
    JSON.stringify({
      mutation: mutationName,
      outcome,
      tenantId: row.tenant_id,
      connectorId: row.id,
      actorSub: ctx.auth?.principalId ?? null,
      actorEmail: ctx.auth?.email ?? null,
    }),
  );
}

function connectorDispatchResultToGraphql(
  result: ConnectorDispatchResult,
): Record<string, unknown> {
  return {
    status: result.status,
    connectorId: result.connectorId,
    executionId: "executionId" in result ? (result.executionId ?? null) : null,
    externalRef: "externalRef" in result ? (result.externalRef ?? null) : null,
    threadId: "threadId" in result ? (result.threadId ?? null) : null,
    messageId: "messageId" in result ? (result.messageId ?? null) : null,
    computerId: "computerId" in result ? (result.computerId ?? null) : null,
    computerTaskId:
      "computerTaskId" in result ? (result.computerTaskId ?? null) : null,
    targetType: "targetType" in result ? result.targetType : null,
    reason: "reason" in result ? result.reason : null,
    error: "error" in result ? result.error : null,
  };
}
