/**
 * Member-space list for agent dispatch (THINK-261 #6 / company-brain plan U6).
 *
 * The Pi runtime fans memory recall out to the space banks of every space the
 * invoking user belongs to, and labels each recalled memory with its space
 * name — but the runtime has no ThinkWork-DB lookup surface, so both the ids
 * (bank targets) and the names (scope labels) must ride the dispatch payload.
 * This helper resolves them in one query at dispatch build.
 *
 * Best-effort by design: dispatch must never fail because the membership
 * lookup did (the turn degrades to user-bank recall, mirroring
 * `documentPlatesForDispatch`'s failure posture).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { spaceMembers, spaces } from "@thinkwork/database-pg/schema";

export interface DispatchMemberSpace {
  id: string;
  name: string;
}

export async function memberSpacesForDispatch(
  tenantId: string,
  userId: string | null | undefined,
): Promise<DispatchMemberSpace[] | undefined> {
  if (!userId) return undefined;
  try {
    const rows = await getDb()
      .select({ id: spaces.id, name: spaces.name })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaceMembers.space_id, spaces.id))
      .where(
        and(
          eq(spaceMembers.tenant_id, tenantId),
          eq(spaceMembers.user_id, userId),
          eq(spaces.status, "active"),
        ),
      );
    return rows.map((row) => ({ id: row.id, name: row.name }));
  } catch (err) {
    console.warn(
      `[member-spaces] lookup failed (best-effort) tenant=${tenantId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}
