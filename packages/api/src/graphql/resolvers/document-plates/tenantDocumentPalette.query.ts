import type { GraphQLContext } from "../../context.js";
import { drizzlePlateStore } from "../../../lib/artifacts/plate-registry.js";
import { requirePlateReader } from "./shared.js";

/** The tenant document palette (member-readable; U7 dialog reads it). */
export async function tenantDocumentPalette(
  _parent: unknown,
  args: { tenantId?: string | null },
  ctx: GraphQLContext,
): Promise<{ light: string; dark: string }> {
  const { tenantId } = await requirePlateReader(ctx, args.tenantId);
  const palette = await drizzlePlateStore().getTenantDocumentPalette(tenantId);
  return {
    light: JSON.stringify(palette.light),
    dark: JSON.stringify(palette.dark),
  };
}
