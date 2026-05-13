import { db, eq, snakeToCamel, tenantSettings } from "../../utils.js";

export const tenantTypeResolvers = {
  settings: async (tenant: Record<string, unknown>) => {
    const tenantId =
      typeof tenant.id === "string"
        ? tenant.id
        : typeof tenant.tenant_id === "string"
          ? tenant.tenant_id
          : null;
    if (!tenantId) return null;

    const [row] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenant_id, tenantId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};
