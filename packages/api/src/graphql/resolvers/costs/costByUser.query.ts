import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  gte,
  lte,
  sql,
  inArray,
  costEvents,
  users,
  startOfMonth,
} from "../../utils.js";

const SYSTEM_USER_ROW = {
  userId: null,
  userName: "System / unattributed",
  userEmail: null,
  isSystem: true,
};

export const costByUser = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const from = args.from ? new Date(args.from) : startOfMonth();
  const to = args.to ? new Date(args.to) : new Date();
  const rows = await db
    .select({
      userId: costEvents.user_id,
      totalUsd: sql<number>`COALESCE(SUM(amount_usd), 0)::float`,
      eventCount: sql<number>`COUNT(*)::int`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, args.tenantId),
        gte(costEvents.created_at, from),
        lte(costEvents.created_at, to),
      ),
    )
    .groupBy(costEvents.user_id);

  const userIds = rows
    .map((row) => row.userId)
    .filter((userId): userId is string => Boolean(userId));
  const userRows =
    userIds.length > 0
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
          })
          .from(users)
          .where(
            and(eq(users.tenant_id, args.tenantId), inArray(users.id, userIds)),
          )
      : [];
  const usersById = new Map(userRows.map((user) => [user.id, user]));

  return rows
    .map((row) => {
      if (!row.userId) {
        return {
          ...SYSTEM_USER_ROW,
          totalUsd: row.totalUsd,
          eventCount: row.eventCount,
        };
      }

      const user = usersById.get(row.userId);
      return {
        userId: row.userId,
        userName: user?.name || user?.email || "Unknown user",
        userEmail: user?.email ?? null,
        totalUsd: row.totalUsd,
        eventCount: row.eventCount,
        isSystem: false,
      };
    })
    .sort((a, b) => b.totalUsd - a.totalUsd);
};
