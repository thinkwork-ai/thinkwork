import type { GraphQLContext } from "../../context.js";
import { agentProfiles, and, db, eq } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  badInput,
  ensureBuiltInAgentProfiles,
  notFound,
  normalizeProfileSlug,
  toAgentProfileGraphql,
} from "./shared.js";

export async function agentProfile(
  _parent: unknown,
  args: { tenantId: string; id?: string | null; slug?: string | null },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "agent_profiles:read");
  await ensureBuiltInAgentProfiles(args.tenantId);

  if (!args.id && !args.slug) {
    throw badInput("Either id or slug is required");
  }

  const selector = args.id
    ? eq(agentProfiles.id, args.id)
    : eq(agentProfiles.slug, normalizeProfileSlug(args.slug ?? ""));
  const [row] = await db
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.tenant_id, args.tenantId), selector));

  return row ? toAgentProfileGraphql(row) : null;
}

export async function loadRequiredAgentProfile(tenantId: string, id: string) {
  const [row] = await db
    .select()
    .from(agentProfiles)
    .where(
      and(eq(agentProfiles.tenant_id, tenantId), eq(agentProfiles.id, id)),
    );
  if (!row) throw notFound("Agent Profile not found");
  return row;
}
