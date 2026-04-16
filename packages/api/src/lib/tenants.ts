import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenants } from "@thinkwork/database-pg/schema";

const db = getDb();

/** Resolve a tenant slug to its UUID. Returns null if no match. */
export async function resolveTenantId(
	tenantSlug: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: tenants.id })
		.from(tenants)
		.where(eq(tenants.slug, tenantSlug))
		.limit(1);
	return row?.id ?? null;
}
