import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  eq,
  and,
  desc,
  asc,
  inArray,
  sql,
  threads,
  threadParticipants,
  threadToCamel,
} from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { requireTenantAdmin, hasServiceSecret } from "../core/authz.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";

export const threadsPaged_query = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const authType = ctx.auth?.authType;
  let callerUserId: string | null = null;
  let isTenantAdminCaller = hasServiceSecret(ctx);
  if (authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) {
      return { items: [], totalCount: 0 };
    }
    callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return { items: [], totalCount: 0 };
    try {
      await requireTenantAdmin(ctx, args.tenantId);
      isTenantAdminCaller = true;
    } catch (err) {
      if (!(err instanceof GraphQLError)) throw err;
      isTenantAdminCaller = false;
    }
  }

  const conditions: any[] = [eq(threads.tenant_id, args.tenantId)];
  if (args.spaceId) {
    if (
      authType === "cognito" &&
      !(await hasSpaceMemberAccess(ctx, args.tenantId, args.spaceId))
    ) {
      return { items: [], totalCount: 0 };
    }
    conditions.push(eq(threads.space_id, args.spaceId));
  }

  if (authType === "cognito" && !isTenantAdminCaller && !args.spaceId) {
    if (!callerUserId) return { items: [], totalCount: 0 };
    conditions.push(callerParticipantExists(args.tenantId, callerUserId));
  }

  // Filter: scope to a single Computer when the caller passes one. Plan
  // 2026-05-13-005 U1 — admin Computer Detail Dashboard renders the same
  // shared ThreadsTable as /threads, filtered to a specific Computer.
  // Tenant scoping above still applies; the computerId predicate is layered
  // on top so a cross-tenant computerId returns empty rather than leaking.
  if (args.computerId) {
    conditions.push(eq(threads.computer_id, args.computerId));
  }

  // Filter: archived vs non-archived
  if (args.showArchived) {
    conditions.push(sql`${threads.archived_at} IS NOT NULL`);
  } else {
    conditions.push(sql`${threads.archived_at} IS NULL`);
  }

  if (args.unreadOnly) {
    if (authType === "cognito" && !callerUserId) {
      return { items: [], totalCount: 0 };
    }
    if (!callerUserId) {
      conditions.push(sql`FALSE`);
    } else {
      conditions.push(
        callerUnreadParticipantExists(args.tenantId, callerUserId),
      );
    }
  }

  // Filter: statuses (array)
  if (args.statuses?.length) {
    const lower = args.statuses.map((s: string) => s.toLowerCase());
    conditions.push(sql`${threads.status} = ANY(${lower})`);
  }

  // Filter: search
  if (args.search) {
    conditions.push(
      sql`search_vector @@ plainto_tsquery('english', ${args.search})`,
    );
  }

  const whereClause = and(...conditions);

  // Sort
  const sortField = args.sortField || "updated";
  const sortDir = args.sortDir || "desc";
  const dirFn = sortDir === "asc" ? asc : desc;

  let orderClause;
  switch (sortField) {
    case "status":
      orderClause = dirFn(threads.status);
      break;
    case "title":
      orderClause = dirFn(threads.title);
      break;
    case "created":
      orderClause = dirFn(threads.created_at);
      break;
    case "updated":
    default:
      orderClause = dirFn(threads.updated_at);
      break;
  }

  const limit = args.limit || 50;
  const offset = args.offset || 0;

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(threads)
      .where(whereClause),
    db
      .select()
      .from(threads)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset),
  ]);
  const callerReadStateByThreadId = await loadCallerReadState({
    tenantId: args.tenantId,
    callerUserId,
    threadIds: rows.map((row) => row.id),
  });

  return {
    items: rows.map((r) => {
      const participantReadState = callerReadStateByThreadId.get(r.id);
      if (!participantReadState) return threadToCamel(r);
      return threadToCamel({
        ...r,
        last_read_at: participantReadState.last_read_at,
      });
    }),
    totalCount: countResult[0]?.count ?? 0,
  };
};

function callerParticipantExists(tenantId: string, callerUserId: string) {
  return sql`EXISTS (
    SELECT 1
      FROM ${threadParticipants} caller_tp
     WHERE caller_tp.tenant_id = ${tenantId}
       AND caller_tp.thread_id = ${threads.id}
       AND caller_tp.participant_type = 'user'
       AND caller_tp.user_id = ${callerUserId}
  )`;
}

function callerUnreadParticipantExists(tenantId: string, callerUserId: string) {
  return sql`EXISTS (
    SELECT 1
      FROM ${threadParticipants} caller_tp
     WHERE caller_tp.tenant_id = ${tenantId}
       AND caller_tp.thread_id = ${threads.id}
       AND caller_tp.participant_type = 'user'
       AND caller_tp.user_id = ${callerUserId}
       AND (
         caller_tp.last_read_at IS NULL
         OR COALESCE(${threads.last_turn_completed_at}, ${threads.updated_at}, ${threads.created_at}) > caller_tp.last_read_at
       )
  )`;
}

async function loadCallerReadState(input: {
  tenantId: string;
  callerUserId: string | null;
  threadIds: string[];
}) {
  if (!input.callerUserId || input.threadIds.length === 0) {
    return new Map<string, { last_read_at: Date | null }>();
  }

  const rows = await db
    .select({
      thread_id: threadParticipants.thread_id,
      last_read_at: threadParticipants.last_read_at,
    })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.callerUserId),
        inArray(threadParticipants.thread_id, input.threadIds),
      ),
    );

  return new Map(rows.map((row) => [row.thread_id, row]));
}
