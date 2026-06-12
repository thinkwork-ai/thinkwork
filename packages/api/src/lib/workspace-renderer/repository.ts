import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentProfileSpaceAssignments,
  agentProfiles,
  agents,
  spaceMembers,
  spaces,
  tenants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceAgentProfileRoutingEntry,
  WorkspaceSpaceIndexEntry,
  WorkspaceSpaceParticipantEntry,
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
        workspaceFolderName: agents.workspace_folder_name,
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
        workspaceFolderName: spaces.workspace_folder_name,
        name: spaces.name,
        kind: spaces.kind,
        accessMode: spaces.access_mode,
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
          workspaceFolderName: users.workspace_folder_name,
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
          slug: user.workspaceFolderName ?? userSlug(user),
          name: user.name,
        };
      }
    }

    let resolvedThreadSlug: string | null = input.threadSlug ?? null;
    if (input.threadId) {
      const [thread] = await this.db
        .select({
          id: threads.id,
          workspaceFolderName: threads.workspace_folder_name,
        })
        .from(threads)
        .where(
          and(
            eq(threads.id, input.threadId),
            eq(threads.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      resolvedThreadSlug =
        thread?.workspaceFolderName ?? input.threadSlug ?? input.threadId;
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      agentId: agent.id,
      agentSlug: agent.workspaceFolderName ?? agent.slug,
      agentName: agent.name,
      spaceId: space.id,
      spaceSlug: space.workspaceFolderName ?? space.slug,
      spaceName: space.name,
      spaceKind: space.kind,
      spaceAccessMode: space.accessMode,
      spacePrompt: space.prompt,
      spaceToolPolicy: space.toolPolicy,
      spaceMcpPolicy: space.mcpPolicy,
      threadId: input.threadId ?? null,
      threadSlug: resolvedThreadSlug,
      userId: resolvedUser?.id ?? input.userId ?? null,
      userSlug: resolvedUser?.slug ?? null,
      userName: resolvedUser?.name ?? null,
    };
  }

  async listAuthorizedSpaces(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceIndexEntry[]> {
    const rows = await this.db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        workspaceFolderName: spaces.workspace_folder_name,
        name: spaces.name,
        accessMode: spaces.access_mode,
      })
      .from(spaces)
      .where(
        and(eq(spaces.tenant_id, tuple.tenantId), eq(spaces.status, "active")),
      );

    const memberSpaceIds = new Set<string>();
    if (tuple.userId) {
      const memberships = await this.db
        .select({ spaceId: spaceMembers.space_id })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.tenant_id, tuple.tenantId),
            eq(spaceMembers.user_id, tuple.userId),
          ),
        );
      for (const membership of memberships) {
        memberSpaceIds.add(membership.spaceId);
      }
    }

    return rows
      .filter(
        (space) =>
          space.id === tuple.spaceId ||
          space.accessMode === "public" ||
          memberSpaceIds.has(space.id),
      )
      .map((space) => ({
        id: space.id,
        slug: space.workspaceFolderName ?? space.slug,
        name: space.name,
        accessMode: space.accessMode,
        isActive: space.id === tuple.spaceId,
      }))
      .sort((left, right) => {
        if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }

  async listSpaceParticipants(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceParticipantEntry[]> {
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(spaceMembers)
      .innerJoin(users, eq(spaceMembers.user_id, users.id))
      .where(
        and(
          eq(spaceMembers.tenant_id, tuple.tenantId),
          eq(spaceMembers.space_id, tuple.spaceId),
        ),
      );

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name?.trim() || row.email?.split("@")[0] || row.id,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
  }

  async listRoutableAgentProfiles(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceAgentProfileRoutingEntry[]> {
    const profileRows = await this.db
      .select({
        id: agentProfiles.id,
        slug: agentProfiles.slug,
        name: agentProfiles.name,
        routingGuidance: agentProfiles.routing_guidance,
      })
      .from(agentProfiles)
      .where(
        and(
          eq(agentProfiles.tenant_id, tuple.tenantId),
          eq(agentProfiles.enabled, true),
        ),
      );
    if (profileRows.length === 0) return [];

    const assignmentRows = await this.db
      .select({
        profileId: agentProfileSpaceAssignments.profile_id,
        spaceId: agentProfileSpaceAssignments.space_id,
      })
      .from(agentProfileSpaceAssignments)
      .where(eq(agentProfileSpaceAssignments.tenant_id, tuple.tenantId));
    const spaceIdsByProfileId = new Map<string, Set<string>>();
    for (const row of assignmentRows) {
      const set = spaceIdsByProfileId.get(row.profileId) ?? new Set<string>();
      set.add(row.spaceId);
      spaceIdsByProfileId.set(row.profileId, set);
    }

    return profileRows
      .filter((profile) => {
        const assignedSpaceIds = spaceIdsByProfileId.get(profile.id);
        // No assignments → globally available; otherwise the active Space
        // must be among the assignments (mirrors
        // loadAgentProfileRuntimeConfigs scoping).
        return !assignedSpaceIds || assignedSpaceIds.has(tuple.spaceId);
      })
      .map((profile) => ({
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
        routingGuidance: profile.routingGuidance ?? null,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }
}
