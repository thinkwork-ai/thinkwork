import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";

export type TenantPlatformAgent = typeof agents.$inferSelect;

export class PlatformAgentNotFoundError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Platform agent not found for tenant: ${tenantId}`);
    this.name = "PlatformAgentNotFoundError";
  }
}

export class MultiplePlatformAgentsError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Multiple platform agents found for tenant: ${tenantId}`);
    this.name = "MultiplePlatformAgentsError";
  }
}

export async function resolveTenantPlatformAgent(
  tenantId: string,
  db = getDb(),
): Promise<TenantPlatformAgent> {
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    )
    .limit(2);

  if (rows.length === 0) throw new PlatformAgentNotFoundError(tenantId);
  if (rows.length > 1) throw new MultiplePlatformAgentsError(tenantId);
  return rows[0];
}
