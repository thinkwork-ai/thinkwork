import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, spaces, tenants, users } from "@thinkwork/database-pg/schema";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceRenderTupleInput,
  WorkspaceTupleRepository,
} from "./types.js";

function userSlug(user: { email: string | null; name: string | null }): string {
  const base = user.email?.split("@")[0] || user.name || "user";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class DrizzleWorkspaceTupleRepository implements WorkspaceTupleRepository {
  private readonly db = getDb();

  async resolve(
    input: WorkspaceRenderTupleInput,
  ): Promise<ResolvedWorkspaceRenderTuple | null> {
    const [tenant] = await this.db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));
    if (!tenant?.slug) return null;

    const [agent] = await this.db
      .select({
        id: agents.id,
        slug: agents.slug,
        name: agents.name,
      })
      .from(agents)
      .where(
        and(eq(agents.id, input.agentId), eq(agents.tenant_id, input.tenantId)),
      );
    if (!agent?.slug) return null;

    const [space] = await this.db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        name: spaces.name,
        kind: spaces.kind,
        prompt: spaces.prompt,
        toolPolicy: spaces.tool_policy,
        mcpPolicy: spaces.mcp_policy,
        status: spaces.status,
      })
      .from(spaces)
      .where(
        and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
      );
    if (!space || space.status !== "active") return null;

    let resolvedUser: {
      id: string;
      slug: string;
      name: string | null;
    } | null = null;
    if (input.userId) {
      const [user] = await this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(
          and(eq(users.id, input.userId), eq(users.tenant_id, input.tenantId)),
        );
      if (user) {
        resolvedUser = {
          id: user.id,
          slug: userSlug(user),
          name: user.name,
        };
      }
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      spaceId: space.id,
      spaceSlug: space.slug,
      spaceName: space.name,
      spaceKind: space.kind,
      spacePrompt: space.prompt,
      spaceToolPolicy: space.toolPolicy,
      spaceMcpPolicy: space.mcpPolicy,
      userId: resolvedUser?.id ?? input.userId ?? null,
      userSlug: resolvedUser?.slug ?? null,
      userName: resolvedUser?.name ?? null,
    };
  }
}
