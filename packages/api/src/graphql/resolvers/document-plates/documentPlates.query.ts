import type { GraphQLContext } from "../../context.js";
import {
  drizzlePlateStore,
  listPlates,
} from "../../../lib/artifacts/plate-registry.js";
import { plateToGraphql, requirePlateReader } from "./shared.js";

/**
 * All plates for the tenant (R16): platform library then tenant-created.
 * Hidden plates are visible to operators only (AE5 list half).
 */
export async function documentPlates(
  _parent: unknown,
  args: { tenantId?: string | null },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const { tenantId, isOperator } = await requirePlateReader(ctx, args.tenantId);
  const store = drizzlePlateStore();
  const [plates, rows] = await Promise.all([
    listPlates(tenantId, store),
    store.listPlateRows(tenantId),
  ]);
  const rowBySlug = new Map(rows.map((r) => [r.slug, r]));
  return plates
    .filter((p) => isOperator || !p.hidden)
    .map((p) => {
      const row = rowBySlug.get(p.slug);
      const overrides =
        row && Object.keys(row.config ?? {}).length > 0 ? row.config : null;
      return plateToGraphql(p, overrides as Record<string, unknown> | null);
    });
}
