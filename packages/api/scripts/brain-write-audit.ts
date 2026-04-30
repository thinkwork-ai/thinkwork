import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const since = process.argv[2] ?? "24 hours";
const db = getDb();

const result = await db.execute(sql`
  SELECT tenant_id, action, count(*)::int AS count
  FROM activity_log
  WHERE action LIKE 'brain_%'
    AND created_at >= now() - (${since} || '')::interval
  GROUP BY tenant_id, action
  ORDER BY tenant_id, action
`);

console.log("tenant_id,action,count");
for (const row of (result as unknown as { rows: any[] }).rows ?? []) {
	console.log(`${row.tenant_id},${row.action},${row.count}`);
}
