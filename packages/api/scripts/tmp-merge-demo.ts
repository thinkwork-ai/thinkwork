/** AE5 demo: merge the duplicate canonical entities on dev (preview → confirm). */
import { getDb } from "@thinkwork/database-pg";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";

async function main() {
  const db = getDb();
  const { and, eq, sql } = await import("drizzle-orm");
  const { canonicalEntities } = await import("@thinkwork/database-pg/schema");
  const rows = await db
    .select({ id: canonicalEntities.id, name: canonicalEntities.display_name })
    .from(canonicalEntities)
    .where(
      and(
        eq(canonicalEntities.tenant_id, TENANT),
        eq(canonicalEntities.status, "active"),
        sql`lower(${canonicalEntities.display_name}) IN ('mcpherson oil', 'mcphersonoil.com')`,
      ),
    );
  const survivor = rows.find((r) => r.name.toLowerCase() === "mcpherson oil");
  const loser = rows.find((r) => r.name.toLowerCase() === "mcphersonoil.com");
  if (!survivor || !loser) {
    console.log("candidates:", JSON.stringify(rows));
    throw new Error("expected both canonical entities");
  }
  const { computeMergeImpact, mergeCanonicalEntities } = await import(
    "../src/lib/entity-identity/merge.js"
  );
  const impact = await computeMergeImpact(db, {
    tenantId: TENANT,
    survivorId: survivor.id,
    loserId: loser.id,
  });
  console.log("PREVIEW:", JSON.stringify(impact));
  const result = await mergeCanonicalEntities(db, {
    tenantId: TENANT,
    survivorId: survivor.id,
    loserId: loser.id,
    confirmImpact: impact,
    actorUserId: "4dee701a-c17b-46fe-9f38-a333d4c3fad0",
  });
  console.log("MERGED:", JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
