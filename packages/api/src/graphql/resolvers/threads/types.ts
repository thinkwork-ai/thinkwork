import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  asc,
  lt,
  sql,
  inArray,
  threads,
  messages,
  artifacts,
  costEvents,
  threadTurns,
  threadDependencies,
  computers,
  spaces,
  threadParticipants,
  computerToCamel,
  messageToCamel,
  snakeToCamel,
} from "../../utils.js";
import { artifactToCamelWithPayload } from "../artifacts/payload.js";

const THREAD_PARTICIPANT_ENUM_FIELDS = new Set([
  "participantType",
  "notificationPreference",
]);
const SPACE_ENUM_FIELDS = new Set(["status", "kind"]);

function uppercaseFields(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
) {
  for (const field of fields) {
    if (typeof row[field] === "string") {
      row[field] = row[field].toUpperCase();
    }
  }
  return row;
}

function threadParticipantToCamel(row: Record<string, unknown>) {
  return uppercaseFields(snakeToCamel(row), THREAD_PARTICIPANT_ENUM_FIELDS);
}

function spaceToCamel(row: Record<string, unknown>) {
  return uppercaseFields(snakeToCamel(row), SPACE_ENUM_FIELDS);
}

export const threadTypeResolvers = {
  agent: (thread: any, _args: any, ctx: GraphQLContext) => {
    if (thread.agent && typeof thread.agent === "object") return thread.agent;
    const agentId = thread.agentId || thread.agent_id;
    return agentId ? ctx.loaders.agent.load(agentId) : null;
  },
  computer: async (thread: any) => {
    if (thread.computer && typeof thread.computer === "object")
      return thread.computer;
    const computerId = thread.computerId || thread.computer_id;
    if (!computerId) return null;
    const [row] = await db
      .select()
      .from(computers)
      .where(eq(computers.id, computerId));
    return row ? computerToCamel(row) : null;
  },
  space: async (thread: any) => {
    if (thread.space && typeof thread.space === "object") return thread.space;
    const spaceId = thread.spaceId || thread.space_id;
    if (!spaceId) return null;
    const threadTenantId = thread.tenantId ?? thread.tenant_id ?? null;
    const conditions = [eq(spaces.id, spaceId)];
    if (typeof threadTenantId === "string" && threadTenantId.length > 0) {
      conditions.push(eq(spaces.tenant_id, threadTenantId));
    }
    const [row] = await db
      .select()
      .from(spaces)
      .where(and(...conditions));
    return row ? spaceToCamel(row) : null;
  },
  participants: async (thread: any) => {
    const threadTenantId = thread.tenantId ?? thread.tenant_id ?? null;
    const conditions = [eq(threadParticipants.thread_id, thread.id)];
    if (typeof threadTenantId === "string" && threadTenantId.length > 0) {
      conditions.push(eq(threadParticipants.tenant_id, threadTenantId));
    }
    const rows = await db
      .select()
      .from(threadParticipants)
      .where(and(...conditions))
      .orderBy(asc(threadParticipants.created_at));
    return rows.map((row) => threadParticipantToCamel(row));
  },
  user: (thread: any, _args: any, ctx: GraphQLContext) => {
    if (thread.user && typeof thread.user === "object") return thread.user;
    const userId = thread.userId || thread.user_id;
    return userId ? ctx.loaders.user.load(userId) : null;
  },
  assignee: (thread: any, _args: any, ctx: GraphQLContext) => {
    if (thread.assignee && typeof thread.assignee === "object")
      return thread.assignee;
    const assigneeId = thread.assigneeId || thread.assignee_id;
    const assigneeType = thread.assigneeType || thread.assignee_type;
    if (assigneeType === "user" && assigneeId)
      return ctx.loaders.user.load(assigneeId);
    return null;
  },
  reporter: (thread: any, _args: any, ctx: GraphQLContext) => {
    if (thread.reporter && typeof thread.reporter === "object")
      return thread.reporter;
    const reporterId = thread.reporterId || thread.reporter_id;
    return reporterId ? ctx.loaders.user.load(reporterId) : null;
  },
  messages: async (thread: any, args: any, _ctx: GraphQLContext) => {
    const limit = Math.min(args.limit || 50, 200);
    // Plan-012 U7: belt-and-suspenders tenant scoping. The thread row
    // here was already fetched through a tenant-aware path
    // (Query.thread / Query.threads / etc.), but adding Message.parts
    // — which carries tool input/output and reasoning content per
    // contract v1 — means we want a defense-in-depth filter on every
    // query that selects messages. If `thread.tenantId` is set on the
    // parent (it always is for resolvers reachable from
    // thread.query.ts and threadToCamel), gate the message read on
    // it; otherwise fall back to thread_id-only and trust the
    // upstream gate.
    const threadTenantId = thread.tenantId ?? thread.tenant_id ?? null;
    const conditions = [eq(messages.thread_id, thread.id)];
    if (typeof threadTenantId === "string" && threadTenantId.length > 0) {
      conditions.push(eq(messages.tenant_id, threadTenantId));
    }
    if (args.cursor) {
      conditions.push(lt(messages.created_at, new Date(args.cursor)));
    }
    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(asc(messages.created_at))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const endCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    const messageIds = items.map((m) => m.id);
    let artifactsByMessageId: Record<string, Record<string, unknown>> = {};
    if (messageIds.length > 0) {
      const linkedArtifacts = await db
        .select()
        .from(artifacts)
        .where(inArray(artifacts.source_message_id, messageIds));
      for (const a of linkedArtifacts) {
        if (a.source_message_id) {
          artifactsByMessageId[a.source_message_id] =
            await artifactToCamelWithPayload(a);
        }
      }
    }

    return {
      edges: items.map((m) => ({
        node: {
          ...messageToCamel(m),
          durableArtifact: artifactsByMessageId[m.id] ?? null,
        },
        cursor: m.created_at.toISOString(),
      })),
      pageInfo: { hasNextPage: hasMore, endCursor },
    };
  },
  lastActivityAt: async (thread: any, _args: any, ctx: GraphQLContext) => {
    if (thread.lastActivityAt) return thread.lastActivityAt;
    return ctx.loaders.threadLastActivityAt.load(thread.id);
  },
  costSummary: async (thread: any) => {
    const directCosts = await db
      .select({ total: sql<string>`COALESCE(SUM(amount_usd), 0)` })
      .from(costEvents)
      .where(eq(costEvents.thread_id, thread.id));

    const turnCosts = await db
      .select({
        total: sql<string>`COALESCE(SUM(${costEvents.amount_usd}), 0)`,
      })
      .from(costEvents)
      .innerJoin(
        threadTurns,
        sql`${threadTurns.wakeup_request_id}::text = ${costEvents.request_id}`,
      )
      .where(
        and(
          eq(threadTurns.thread_id, thread.id),
          sql`${costEvents.thread_id} IS NULL`,
        ),
      );

    const total =
      Number(directCosts[0]?.total || 0) + Number(turnCosts[0]?.total || 0);
    return total > 0 ? total : null;
  },
  blockedBy: async (thread: any) => {
    const rows = await db
      .select()
      .from(threadDependencies)
      .where(eq(threadDependencies.thread_id, thread.id));
    return rows.map((r) => snakeToCamel(r));
  },
  blocks: async (thread: any) => {
    const rows = await db
      .select()
      .from(threadDependencies)
      .where(eq(threadDependencies.blocked_by_thread_id, thread.id));
    return rows.map((r) => snakeToCamel(r));
  },
  isBlocked: async (thread: any) => {
    const result = await db.execute(sql`
			SELECT EXISTS (
				SELECT 1 FROM thread_dependencies td
				JOIN threads t ON t.id = td.blocked_by_thread_id
				WHERE td.thread_id = ${thread.id}::uuid
				  AND t.status NOT IN ('done', 'cancelled')
			) AS blocked
		`);
    const row = (result.rows || [])[0] as { blocked: boolean } | undefined;
    return row?.blocked === true;
  },
  lifecycleStatus: (thread: any, _args: any, ctx: GraphQLContext) => {
    return ctx.loaders.threadLifecycleStatus.load(thread.id);
  },
};

export const threadParticipantTypeResolvers = {
  user: (participant: any, _args: any, ctx: GraphQLContext) => {
    if (participant.user && typeof participant.user === "object")
      return participant.user;
    const userId = participant.userId || participant.user_id;
    return userId ? ctx.loaders.user.load(userId) : null;
  },
  agent: (participant: any, _args: any, ctx: GraphQLContext) => {
    if (participant.agent && typeof participant.agent === "object")
      return participant.agent;
    const agentId = participant.agentId || participant.agent_id;
    return agentId ? ctx.loaders.agent.load(agentId) : null;
  },
};
