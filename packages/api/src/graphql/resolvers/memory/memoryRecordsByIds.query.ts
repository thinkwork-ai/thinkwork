import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import {
  requireMemoryUserScope,
  UserScopeAuthError,
} from "../core/require-user-scope.js";
import { toMemoryRecordRows } from "./memoryRecords.query.js";

export const memoryRecordsByIds = async (
  _parent: any,
  args: {
    tenantId: string;
    ids: string[];
  },
  ctx: GraphQLContext,
) => {
  if (args.ids.length === 0) return [];

  let scope: { tenantId: string; userId: string };
  try {
    scope = await requireMemoryUserScope(ctx, {
      tenantId: args.tenantId,
      allowTenantAdmin: true,
    });
  } catch (error) {
    if (error instanceof UserScopeAuthError) return [];
    throw error;
  }

  if (scope.tenantId !== args.tenantId) return [];

  const requestedIds = new Set(args.ids);
  const { inspect: inspectService } = getMemoryServices();
  const records = await inspectService.inspect({
    tenantId: scope.tenantId,
    ownerType: "user",
    ownerId: scope.userId,
  });

  return toMemoryRecordRows(
    records.filter((record) => requestedIds.has(record.id)),
    scope.userId,
  );
};
