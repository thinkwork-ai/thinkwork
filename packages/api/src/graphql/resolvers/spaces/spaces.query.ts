import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  sql,
  spaces as spacesTable,
  spaceMembers,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  canReadTenantSpaces,
  parseSpaceStatus,
  toGraphqlSpace,
} from "./shared.js";

export async function spaces(
  _parent: any,
  args: { tenantId: string; status?: string | null },
  ctx: GraphQLContext,
) {
  if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
    return [];
  }

  const conditions = [eq(spacesTable.tenant_id, args.tenantId)];
  const status = parseSpaceStatus(args.status);
  if (status) conditions.push(eq(spacesTable.status, status));

  let callerUserId: string | null = null;
  let isTenantAdminCaller = ctx.auth.authType !== "cognito";
  if (ctx.auth.authType === "cognito") {
    callerUserId = await resolveCallerUserId(ctx);
    try {
      await requireTenantAdmin(ctx, args.tenantId);
      isTenantAdminCaller = true;
    } catch {
      isTenantAdminCaller = false;
    }
    if (!isTenantAdminCaller) {
      if (!callerUserId) return [];
      conditions.push(
        sql`EXISTS (
          SELECT 1
            FROM ${spaceMembers} caller_sm
           WHERE caller_sm.tenant_id = ${args.tenantId}
             AND caller_sm.space_id = ${spacesTable.id}
             AND caller_sm.user_id = ${callerUserId}
        )`,
      );
    }
  }

  const rows = await db
    .select()
    .from(spacesTable)
    .where(and(...conditions));
  const summaries = await loadSpaceSummaries({
    tenantId: args.tenantId,
    callerUserId,
    spaceIds: rows.map((row) => row.id),
  });

  return rows.map((row) => ({
    ...toGraphqlSpace(row),
    unreadThreadCount: summaries.get(row.id)?.unreadThreadCount ?? 0,
    lastActivityAt: summaries.get(row.id)?.lastActivityAt ?? null,
  }));
}

async function loadSpaceSummaries(input: {
  tenantId: string;
  callerUserId: string | null;
  spaceIds: string[];
}) {
  const empty = new Map<
    string,
    { unreadThreadCount: number; lastActivityAt: Date | string | null }
  >();
  if (input.spaceIds.length === 0) return empty;

  const spaceIdList = sql.join(
    input.spaceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT
      t.space_id,
      MAX(COALESCE(t.last_turn_completed_at, t.updated_at, t.created_at)) AS last_activity_at,
      COUNT(*) FILTER (
        WHERE ${
          input.callerUserId
            ? sql`tp.id IS NOT NULL
              AND (
                tp.last_read_at IS NULL
                OR COALESCE(t.last_turn_completed_at, t.updated_at, t.created_at) > tp.last_read_at
              )`
            : sql`FALSE`
        }
      )::int AS unread_thread_count
    FROM threads t
    LEFT JOIN thread_participants tp
      ON tp.tenant_id = t.tenant_id
     AND tp.thread_id = t.id
     AND tp.participant_type = 'user'
     AND ${
       input.callerUserId ? sql`tp.user_id = ${input.callerUserId}` : sql`FALSE`
     }
    WHERE t.tenant_id = ${input.tenantId}
      AND t.space_id IN (${spaceIdList})
      AND t.archived_at IS NULL
    GROUP BY t.space_id
  `);

  return new Map(
    (
      (result.rows ?? []) as Array<{
        space_id: string;
        unread_thread_count: number | string | null;
        last_activity_at: Date | string | null;
      }>
    ).map((row) => [
      row.space_id,
      {
        unreadThreadCount: Number(row.unread_thread_count ?? 0),
        lastActivityAt: row.last_activity_at,
      },
    ]),
  );
}
