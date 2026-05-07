import { and, desc, eq, lt, ne } from "drizzle-orm";
import {
  connectorExecutions as connectorExecutionsTable,
  connectors as connectorsTable,
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
