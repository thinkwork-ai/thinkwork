import { getDb } from "@thinkwork/database-pg";
import { artifacts, documentPlates } from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { getPlatformPlate } from "../../../lib/artifacts/plate-definitions.js";
import { drizzlePlateStore } from "../../../lib/artifacts/plate-registry.js";
import { requirePlateAdmin } from "./shared.js";

/**
 * Delete a tenant-created plate (R5). Platform plates are never deleted
 * (hide instead); tenant plates delete only when no artifact rows reference
 * the slug as their type.
 */
export async function deleteDocumentPlate(
  _parent: unknown,
  args: { tenantId?: string | null; slug: string },
  ctx: GraphQLContext,
): Promise<{ ok: boolean; error: string | null }> {
  const tenantId = await requirePlateAdmin(ctx, args.tenantId);
  const slug = args.slug?.trim().toLowerCase();
  const store = drizzlePlateStore();
  const row = await store.getPlateRow(tenantId, slug);

  if (row?.origin !== "tenant") {
    if (getPlatformPlate(slug)) {
      return {
        ok: false,
        error:
          "Platform plates cannot be deleted — hide the plate instead to remove it from use.",
      };
    }
    return { ok: false, error: `No tenant plate "${slug}" to delete` };
  }

  const db = getDb();
  const [referencing] = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.tenant_id, tenantId), eq(artifacts.type, slug)))
    .limit(1);
  if (referencing) {
    return {
      ok: false,
      error:
        "Documents of this genre exist — hide the plate instead so existing documents keep rendering.",
    };
  }

  await db
    .delete(documentPlates)
    .where(
      and(
        eq(documentPlates.tenant_id, tenantId),
        eq(documentPlates.slug, slug),
      ),
    );
  return { ok: true, error: null };
}
