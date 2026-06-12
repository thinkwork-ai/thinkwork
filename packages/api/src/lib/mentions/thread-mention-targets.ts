import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentProfileSpaceAssignments,
  agentProfiles,
  agents,
  spaceMembers,
  spaces,
  tenantMembers,
  threadParticipants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import type { MentionTarget } from "./parse-message-mentions.js";

export const DEFAULT_AGENT_MENTION_ALIASES = ["agent", "think"] as const;

export interface ThreadMentionTarget extends MentionTarget {
  id: string;
  avatarUrl?: string | null;
  role?: string | null;
  email?: string | null;
  description?: string | null;
  isDefaultAgent?: boolean;
}

export interface ThreadMentionTargetsRepository {
  loadThread(input: { tenantId: string; threadId: string }): Promise<{
    id: string;
    tenantId: string;
    spaceId: string | null;
    agentId: string | null;
    computerId: string | null;
  } | null>;
  loadTargets(input: {
    tenantId: string;
    threadId: string;
    spaceId?: string | null;
    threadAgentId?: string | null;
    computerId?: string | null;
  }): Promise<ThreadMentionTarget[]>;
  loadTenantTargets(input: {
    tenantId: string;
  }): Promise<ThreadMentionTarget[]>;
}

export async function loadThreadMentionTargets(
  input: { tenantId: string; threadId: string },
  repository: ThreadMentionTargetsRepository = new DrizzleThreadMentionTargetsRepository(),
) {
  const thread = await repository.loadThread(input);
  if (!thread) return [];
  return repository.loadTargets({
    tenantId: thread.tenantId,
    threadId: thread.id,
    spaceId: thread.spaceId,
    threadAgentId: thread.agentId,
    computerId: thread.computerId,
  });
}

/**
 * Thread-independent mention targets for the new-thread composer, where no
 * thread (and thus no participants/space) exists yet. Mirrors the no-space
 * branch of {@link loadTargets}: every active tenant member plus the
 * platform-default agent, with the platform agent marked as the default
 * mention so `@agent`/`@think` aliases resolve before the thread is created.
 */
export async function loadTenantMentionTargets(
  input: { tenantId: string },
  repository: ThreadMentionTargetsRepository = new DrizzleThreadMentionTargetsRepository(),
) {
  return repository.loadTenantTargets(input);
}

class DrizzleThreadMentionTargetsRepository implements ThreadMentionTargetsRepository {
  private readonly db = getDb();

  async loadThread(input: { tenantId: string; threadId: string }) {
    const [row] = await this.db
      .select({
        id: threads.id,
        tenantId: threads.tenant_id,
        spaceId: threads.space_id,
        agentId: threads.agent_id,
        computerId: threads.computer_id,
      })
      .from(threads)
      .where(
        and(
          eq(threads.id, input.threadId),
          eq(threads.tenant_id, input.tenantId),
        ),
      );
    return row ?? null;
  }

  async loadTargets(input: {
    tenantId: string;
    threadId: string;
    spaceId?: string | null;
    threadAgentId?: string | null;
    computerId?: string | null;
  }) {
    const byKey = new Map<string, ThreadMentionTarget>();

    const participantRows = await this.db
      .select({
        participantType: threadParticipants.participant_type,
        role: threadParticipants.role,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userImage: users.image,
        agentId: agents.id,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentAvatarUrl: agents.avatar_url,
        notificationPreference: threadParticipants.notification_preference,
        participantCreatedAt: threadParticipants.created_at,
        participantId: threadParticipants.id,
      })
      .from(threadParticipants)
      .leftJoin(users, eq(users.id, threadParticipants.user_id))
      .leftJoin(agents, eq(agents.id, threadParticipants.agent_id))
      .where(
        and(
          eq(threadParticipants.tenant_id, input.tenantId),
          eq(threadParticipants.thread_id, input.threadId),
        ),
      );

    for (const row of participantRows) {
      addTarget(byKey, targetFromRow(row));
    }
    const subscribedAgentParticipantId = [...participantRows]
      .filter(
        (row) =>
          row.participantType === "agent" &&
          row.agentId &&
          row.notificationPreference === "subscribed",
      )
      .sort((a, b) => {
        const created =
          (a.participantCreatedAt?.getTime() ?? 0) -
          (b.participantCreatedAt?.getTime() ?? 0);
        if (created !== 0) return created;
        return (a.participantId ?? "").localeCompare(b.participantId ?? "");
      })[0]?.agentId;

    const spaceAccessMode = input.spaceId
      ? await this.loadSpaceAccessMode(input.tenantId, input.spaceId)
      : null;
    let platformAgentId: string | null = null;

    if (input.spaceId) {
      const memberRows = await this.db
        .select({
          participantType: spaceMembers.role,
          role: spaceMembers.role,
          userId: users.id,
          userName: users.name,
          userEmail: users.email,
          userImage: users.image,
        })
        .from(spaceMembers)
        .leftJoin(users, eq(users.id, spaceMembers.user_id))
        .where(
          and(
            eq(spaceMembers.tenant_id, input.tenantId),
            eq(spaceMembers.space_id, input.spaceId),
          ),
        );
      for (const row of memberRows) {
        addTarget(byKey, {
          id: `user:${row.userId}`,
          targetType: "user",
          targetId: row.userId ?? "",
          displayName: row.userName ?? row.userEmail ?? "User",
          aliases: [row.userName, row.userEmail].filter(isString),
          avatarUrl: row.userImage,
          email: row.userEmail,
          role: row.role,
        });
      }

      const [platformAgent] = await this.db
        .select({
          role: agents.role,
          agentId: agents.id,
          agentName: agents.name,
          agentSlug: agents.slug,
          agentAvatarUrl: agents.avatar_url,
        })
        .from(agents)
        .where(
          and(
            eq(agents.tenant_id, input.tenantId),
            eq(agents.is_platform_default, true),
          ),
        )
        .limit(1);
      if (platformAgent) {
        platformAgentId = platformAgent.agentId;
        addTarget(byKey, {
          id: `agent:${platformAgent.agentId}`,
          targetType: "agent",
          targetId: platformAgent.agentId,
          displayName: platformAgent.agentName,
          aliases: [platformAgent.agentName, platformAgent.agentSlug].filter(
            isString,
          ),
          avatarUrl: platformAgent.agentAvatarUrl,
          role: platformAgent.role,
        });
      }
    }

    if (!input.spaceId || spaceAccessMode === "public") {
      const tenantMemberRows = await this.db
        .select({
          role: tenantMembers.role,
          userId: users.id,
          userName: users.name,
          userEmail: users.email,
          userImage: users.image,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.principal_id))
        .where(
          and(
            eq(tenantMembers.tenant_id, input.tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.status, "active"),
          ),
        );
      for (const row of tenantMemberRows) {
        addTarget(byKey, {
          id: `user:${row.userId}`,
          targetType: "user",
          targetId: row.userId,
          displayName: row.userName ?? row.userEmail ?? "User",
          aliases: [row.userName, row.userEmail].filter(isString),
          avatarUrl: row.userImage,
          email: row.userEmail,
          role: row.role,
        });
      }
    }

    if (!input.spaceId) {
      const tenantAgentRows = await this.db
        .select({
          role: agents.role,
          agentId: agents.id,
          agentName: agents.name,
          agentSlug: agents.slug,
          agentAvatarUrl: agents.avatar_url,
        })
        .from(agents)
        .where(
          and(
            eq(agents.tenant_id, input.tenantId),
            eq(agents.is_platform_default, true),
          ),
        );
      for (const row of tenantAgentRows) {
        platformAgentId ??= row.agentId;
        addTarget(byKey, {
          id: `agent:${row.agentId}`,
          targetType: "agent",
          targetId: row.agentId,
          displayName: row.agentName,
          aliases: [row.agentName, row.agentSlug].filter(isString),
          avatarUrl: row.agentAvatarUrl,
          role: row.role,
        });
      }
    }

    const defaultAgentId = resolveDefaultAgentIdForMentionTargets({
      threadAgentId: input.threadAgentId,
      computerId: input.computerId,
      platformAgentId,
      subscribedAgentParticipantId,
    });
    if (defaultAgentId) {
      await this.ensureDefaultAgentTarget(
        byKey,
        input.tenantId,
        defaultAgentId,
      );
      markDefaultAgentTarget(byKey, defaultAgentId);
    }
    await this.addAgentProfileTargets(byKey, {
      tenantId: input.tenantId,
      spaceId: input.spaceId ?? null,
    });

    return [...byKey.values()].filter((target) => target.targetId);
  }

  async loadTenantTargets(input: { tenantId: string }) {
    const byKey = new Map<string, ThreadMentionTarget>();
    let platformAgentId: string | null = null;

    const tenantMemberRows = await this.db
      .select({
        role: tenantMembers.role,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userImage: users.image,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.principal_id))
      .where(
        and(
          eq(tenantMembers.tenant_id, input.tenantId),
          eq(tenantMembers.principal_type, "user"),
          eq(tenantMembers.status, "active"),
        ),
      );
    for (const row of tenantMemberRows) {
      addTarget(byKey, {
        id: `user:${row.userId}`,
        targetType: "user",
        targetId: row.userId,
        displayName: row.userName ?? row.userEmail ?? "User",
        aliases: [row.userName, row.userEmail].filter(isString),
        avatarUrl: row.userImage,
        email: row.userEmail,
        role: row.role,
      });
    }

    const tenantAgentRows = await this.db
      .select({
        role: agents.role,
        agentId: agents.id,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentAvatarUrl: agents.avatar_url,
      })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, input.tenantId),
          eq(agents.is_platform_default, true),
        ),
      );
    for (const row of tenantAgentRows) {
      platformAgentId ??= row.agentId;
      addTarget(byKey, {
        id: `agent:${row.agentId}`,
        targetType: "agent",
        targetId: row.agentId,
        displayName: row.agentName,
        aliases: [row.agentName, row.agentSlug].filter(isString),
        avatarUrl: row.agentAvatarUrl,
        role: row.role,
      });
    }

    if (platformAgentId) {
      markDefaultAgentTarget(byKey, platformAgentId);
    }
    await this.addAgentProfileTargets(byKey, {
      tenantId: input.tenantId,
      spaceId: null,
      includeAllProfiles: true,
    });

    return [...byKey.values()].filter((target) => target.targetId);
  }

  private async addAgentProfileTargets(
    byKey: Map<string, ThreadMentionTarget>,
    input: {
      tenantId: string;
      spaceId?: string | null;
      includeAllProfiles?: boolean;
    },
  ) {
    const profileRows = await this.db
      .select({
        profileId: agentProfiles.id,
        slug: agentProfiles.slug,
        name: agentProfiles.name,
        description: agentProfiles.description,
        routingGuidance: agentProfiles.routing_guidance,
        sourceSpaceId: agentProfiles.source_space_id,
      })
      .from(agentProfiles)
      .where(
        and(
          eq(agentProfiles.tenant_id, input.tenantId),
          eq(agentProfiles.enabled, true),
        ),
      );
    if (profileRows.length === 0) return;

    const assignmentRows = await this.db
      .select({
        profileId: agentProfileSpaceAssignments.profile_id,
        spaceId: agentProfileSpaceAssignments.space_id,
      })
      .from(agentProfileSpaceAssignments)
      .where(eq(agentProfileSpaceAssignments.tenant_id, input.tenantId));
    const assignments = new Map<string, Set<string>>();
    for (const row of assignmentRows) {
      const existing = assignments.get(row.profileId) ?? new Set<string>();
      existing.add(row.spaceId);
      assignments.set(row.profileId, existing);
    }

    const eligibleRows = profileRows.filter((row) => {
      const spacesForProfile = assignments.get(row.profileId);
      return (
        input.includeAllProfiles ||
        !spacesForProfile ||
        spacesForProfile.size === 0 ||
        (input.spaceId ? spacesForProfile.has(input.spaceId) : false)
      );
    });
    // A space-local profile shadows a same-slug central profile while its
    // Space is active (mirrors loadAgentProfileRuntimeConfigs).
    const shadowedSlugs = new Set(
      eligibleRows
        .filter((row) => input.spaceId && row.sourceSpaceId === input.spaceId)
        .map((row) => row.slug),
    );
    for (const row of eligibleRows) {
      if (row.sourceSpaceId === null && shadowedSlugs.has(row.slug)) continue;
      addTarget(byKey, {
        id: `agent_profile:${row.profileId}`,
        targetType: "agent_profile",
        targetId: row.profileId,
        displayName: row.name,
        aliases: [row.name, row.slug].filter(isString),
        role: "Agent Profile",
        description: row.description ?? row.routingGuidance,
      });
    }
  }

  private async ensureDefaultAgentTarget(
    byKey: Map<string, ThreadMentionTarget>,
    tenantId: string,
    agentId: string,
  ) {
    const key = `agent:${agentId}`;
    if (byKey.has(key)) return;
    const [agent] = await this.db
      .select({
        role: agents.role,
        agentId: agents.id,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentAvatarUrl: agents.avatar_url,
      })
      .from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.id, agentId)))
      .limit(1);
    if (!agent) return;
    addTarget(byKey, {
      id: `agent:${agent.agentId}`,
      targetType: "agent",
      targetId: agent.agentId,
      displayName: agent.agentName,
      aliases: [agent.agentName, agent.agentSlug].filter(isString),
      avatarUrl: agent.agentAvatarUrl,
      role: agent.role,
    });
  }

  private async loadSpaceAccessMode(
    tenantId: string,
    spaceId: string,
  ): Promise<string | null> {
    const [space] = await this.db
      .select({ accessMode: spaces.access_mode })
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)));
    return space?.accessMode ?? null;
  }
}

function targetFromRow(row: {
  participantType: string | null;
  role: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
  agentId: string | null;
  agentName: string | null;
  agentSlug: string | null;
  agentAvatarUrl: string | null;
  notificationPreference?: string | null;
  participantCreatedAt?: Date | null;
  participantId?: string | null;
}): ThreadMentionTarget | null {
  if (row.participantType === "agent" && row.agentId) {
    return {
      id: `agent:${row.agentId}`,
      targetType: "agent",
      targetId: row.agentId,
      displayName: row.agentName ?? "Agent",
      aliases: [row.agentName, row.agentSlug].filter(isString),
      avatarUrl: row.agentAvatarUrl,
      role: row.role,
    };
  }
  if (row.userId) {
    return {
      id: `user:${row.userId}`,
      targetType: "user",
      targetId: row.userId,
      displayName: row.userName ?? row.userEmail ?? "User",
      aliases: [row.userName, row.userEmail].filter(isString),
      avatarUrl: row.userImage,
      email: row.userEmail,
      role: row.role,
    };
  }
  return null;
}

function addTarget(
  byKey: Map<string, ThreadMentionTarget>,
  target: ThreadMentionTarget | null,
) {
  if (!target?.targetId) return;
  const key = `${target.targetType}:${target.targetId}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, {
      ...target,
      aliases: uniqueStrings(target.aliases ?? []),
    });
    return;
  }
  byKey.set(key, {
    ...existing,
    aliases: uniqueStrings([
      ...(existing.aliases ?? []),
      ...(target.aliases ?? []),
    ]),
    avatarUrl: existing.avatarUrl ?? target.avatarUrl,
    role: existing.role ?? target.role,
    email: existing.email ?? target.email,
    isDefaultAgent: existing.isDefaultAgent || target.isDefaultAgent,
  });
}

export function resolveDefaultAgentIdForMentionTargets(input: {
  threadAgentId?: string | null;
  computerId?: string | null;
  platformAgentId?: string | null;
  subscribedAgentParticipantId?: string | null;
}) {
  if (input.computerId) return null;
  return (
    input.threadAgentId ??
    input.platformAgentId ??
    input.subscribedAgentParticipantId ??
    null
  );
}

export function markDefaultAgentTarget(
  byKey: Map<string, ThreadMentionTarget>,
  agentId: string,
) {
  const key = `agent:${agentId}`;
  const target = byKey.get(key);
  if (!target) return;
  byKey.set(key, {
    ...target,
    isDefaultAgent: true,
    aliases: uniqueStrings([
      ...DEFAULT_AGENT_MENTION_ALIASES,
      ...(target.aliases ?? []),
    ]),
  });
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
