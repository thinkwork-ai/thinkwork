import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import {
  computerDelegations as computerDelegationsTable,
  computerTasks as computerTasksTable,
  connectorExecutions as connectorExecutionsTable,
  connectors as connectorsTable,
  threadTurns as threadTurnsTable,
} from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type ConnectorFilter = {
  status?: string | null;
  type?: string | null;
  includeArchived?: boolean | null;
} | null;

export async function connectors_(
  _parent: unknown,
  args: {
    filter?: ConnectorFilter;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const tenantId = await requireResolvedTenantId(ctx);
  const filter = args.filter ?? null;
  const conditions = [eq(connectorsTable.tenant_id, tenantId)];

  if (filter?.status) {
    conditions.push(eq(connectorsTable.status, filter.status));
  } else if (!filter?.includeArchived) {
    conditions.push(ne(connectorsTable.status, "archived"));
  }
  if (filter?.type) {
    conditions.push(eq(connectorsTable.type, filter.type));
  }
  if (args.cursor) {
    conditions.push(lt(connectorsTable.created_at, new Date(args.cursor)));
  }

  const rows = await db
    .select()
    .from(connectorsTable)
    .where(and(...conditions))
    .orderBy(desc(connectorsTable.created_at))
    .limit(clampLimit(args.limit));

  return rows.map(snakeToCamel);
}

export async function connector(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const tenantId = await requireResolvedTenantId(ctx);
  const [row] = await db
    .select()
    .from(connectorsTable)
    .where(
      and(
        eq(connectorsTable.id, args.id),
        eq(connectorsTable.tenant_id, tenantId),
      ),
    )
    .limit(1);

  return row ? snakeToCamel(row) : null;
}

export async function connectorExecutions(
  _parent: unknown,
  args: {
    connectorId?: string | null;
    status?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const tenantId = await requireResolvedTenantId(ctx);

  if (args.connectorId) {
    const [connectorRow] = await db
      .select({ id: connectorsTable.id })
      .from(connectorsTable)
      .where(
        and(
          eq(connectorsTable.id, args.connectorId),
          eq(connectorsTable.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!connectorRow) return [];
  }

  const conditions = [eq(connectorExecutionsTable.tenant_id, tenantId)];
  if (args.connectorId) {
    conditions.push(
      eq(connectorExecutionsTable.connector_id, args.connectorId),
    );
  }
  if (args.status) {
    conditions.push(eq(connectorExecutionsTable.current_state, args.status));
  }
  if (args.cursor) {
    conditions.push(
      lt(connectorExecutionsTable.started_at, new Date(args.cursor)),
    );
  }

  const rows = await db
    .select()
    .from(connectorExecutionsTable)
    .where(and(...conditions))
    .orderBy(desc(connectorExecutionsTable.started_at))
    .limit(clampLimit(args.limit));

  return rows.map(snakeToCamel);
}

export async function connectorRunLifecycles(
  _parent: unknown,
  args: {
    connectorId?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const tenantId = await requireResolvedTenantId(ctx);

  if (args.connectorId) {
    const [connectorRow] = await db
      .select({ id: connectorsTable.id })
      .from(connectorsTable)
      .where(
        and(
          eq(connectorsTable.id, args.connectorId),
          eq(connectorsTable.tenant_id, tenantId),
        ),
      )
      .limit(1);

    if (!connectorRow) return [];
  }

  const conditions = [eq(connectorExecutionsTable.tenant_id, tenantId)];
  if (args.connectorId) {
    conditions.push(
      eq(connectorExecutionsTable.connector_id, args.connectorId),
    );
  }
  if (args.cursor) {
    conditions.push(
      lt(connectorExecutionsTable.created_at, new Date(args.cursor)),
    );
  }

  const rows = await db
    .select({
      execution: connectorExecutionsTable,
      connector: connectorsTable,
      taskId: computerTasksTable.id,
      taskStatus: computerTasksTable.status,
      taskInput: computerTasksTable.input,
      taskOutput: computerTasksTable.output,
      taskError: computerTasksTable.error,
      taskCompletedAt: computerTasksTable.completed_at,
      taskCreatedAt: computerTasksTable.created_at,
      delegationId: computerDelegationsTable.id,
      delegationStatus: computerDelegationsTable.status,
      delegationAgentId: computerDelegationsTable.agent_id,
      delegationInputArtifacts: computerDelegationsTable.input_artifacts,
      delegationOutputArtifacts: computerDelegationsTable.output_artifacts,
      delegationResult: computerDelegationsTable.result,
      delegationError: computerDelegationsTable.error,
      delegationCompletedAt: computerDelegationsTable.completed_at,
      delegationCreatedAt: computerDelegationsTable.created_at,
      turnId: threadTurnsTable.id,
      turnThreadId: threadTurnsTable.thread_id,
      turnAgentId: threadTurnsTable.agent_id,
      turnStatus: threadTurnsTable.status,
      turnResultJson: threadTurnsTable.result_json,
      turnError: threadTurnsTable.error,
      turnErrorCode: threadTurnsTable.error_code,
      turnStartedAt: threadTurnsTable.started_at,
      turnFinishedAt: threadTurnsTable.finished_at,
      turnCreatedAt: threadTurnsTable.created_at,
    })
    .from(connectorExecutionsTable)
    .innerJoin(
      connectorsTable,
      and(
        eq(connectorsTable.id, connectorExecutionsTable.connector_id),
        eq(connectorsTable.tenant_id, tenantId),
      ),
    )
    .leftJoin(
      computerTasksTable,
      and(
        eq(computerTasksTable.tenant_id, tenantId),
        sql`${computerTasksTable.id}::text = ${connectorExecutionsTable.outcome_payload}->>'computerTaskId'`,
      ),
    )
    .leftJoin(
      computerDelegationsTable,
      and(
        eq(computerDelegationsTable.tenant_id, tenantId),
        eq(computerDelegationsTable.task_id, computerTasksTable.id),
      ),
    )
    .leftJoin(
      threadTurnsTable,
      and(
        eq(threadTurnsTable.tenant_id, tenantId),
        sql`${threadTurnsTable.id}::text = COALESCE(${computerDelegationsTable.result}->>'threadTurnId', ${computerDelegationsTable.output_artifacts}->>'threadTurnId')`,
      ),
    )
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`COALESCE(${connectorExecutionsTable.started_at}, ${connectorExecutionsTable.created_at})`,
      ),
    )
    .limit(clampLimit(args.limit));

  return rows.map((row) => connectorRunLifecycleToGraphql(row));
}

export async function connectorExecution(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const tenantId = await requireResolvedTenantId(ctx);
  const [row] = await db
    .select()
    .from(connectorExecutionsTable)
    .where(
      and(
        eq(connectorExecutionsTable.id, args.id),
        eq(connectorExecutionsTable.tenant_id, tenantId),
      ),
    )
    .limit(1);

  return row ? snakeToCamel(row) : null;
}

function connectorRunLifecycleToGraphql(row: any): Record<string, unknown> {
  const execution = snakeToCamel(row.execution);
  const connector = snakeToCamel(row.connector);
  const outcomePayload = parseRecord(row.execution?.outcome_payload);

  return {
    execution,
    connector,
    computerTask: row.taskId
      ? {
          id: row.taskId,
          status: row.taskStatus,
          input: row.taskInput,
          output: row.taskOutput,
          error: row.taskError,
          completedAt: row.taskCompletedAt,
          createdAt: row.taskCreatedAt,
        }
      : null,
    delegation: row.delegationId
      ? {
          id: row.delegationId,
          status: row.delegationStatus,
          agentId: row.delegationAgentId,
          inputArtifacts: row.delegationInputArtifacts,
          outputArtifacts: row.delegationOutputArtifacts,
          result: row.delegationResult,
          error: row.delegationError,
          completedAt: row.delegationCompletedAt,
          createdAt: row.delegationCreatedAt,
        }
      : null,
    threadTurn: row.turnId
      ? {
          id: row.turnId,
          threadId: row.turnThreadId,
          agentId: row.turnAgentId,
          status: row.turnStatus,
          resultJson: row.turnResultJson,
          error: row.turnError,
          errorCode: row.turnErrorCode,
          startedAt: row.turnStartedAt,
          finishedAt: row.turnFinishedAt,
          createdAt: row.turnCreatedAt,
        }
      : null,
    threadId: stringField(outcomePayload, "threadId"),
    messageId: stringField(outcomePayload, "messageId"),
    computerId: stringField(outcomePayload, "computerId"),
  };
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function requireResolvedTenantId(ctx: GraphQLContext): Promise<string> {
  const tenantId = ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (tenantId) return tenantId;
  throw new GraphQLError("Unauthorized", {
    extensions: { code: "UNAUTHENTICATED" },
  });
}

function clampLimit(limit?: number | null): number {
  return Math.min(Math.max(limit ?? 25, 1), 100);
}
