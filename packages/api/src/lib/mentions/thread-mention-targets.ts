import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  spaceMembers,
  tenantMembers,
  threadParticipants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import {
  listAgentFolderProfilesForTenant,
  type WorkspaceAgentFolderProfile,
} from "../agent-profile-workspace-files.js";
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

class DrizzleThreadMentionTargetsRepository
  implements ThreadMentionTargetsRepository
{
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

    // Mention Invite (THINK-136 R2): a mention is a thread-level invite, so
    // every active tenant member is a valid user mention target in EVERY
    // thread — including threads in private Spaces the member doesn't belong
    // to. The thread-visibility predicate and the mention-participant insert
    // already honor the invite; gating targets on public-space access made
    // validateExplicitMentions reject the very mention the composer offered
    // (first send hard-failed; the retry silently dropped the invite).
    // Space members added above keep their richer role info (addTarget keeps
    // the first entry per key).
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

  /**
   * Subagent-folders U11: mention targets come from the workspace
   * agent-folder index (`agents/<slug>/INSTRUCTIONS.md`), not
   * `agent_profiles` rows. Folder profiles are tenant-global (space-
   * scoped sub-agents are a future folder-based arc), so no space
   * filtering applies; targetId is the folder slug. Best-effort — an
   * unresolvable workspace adds no profile targets.
   */
  private async addAgentProfileTargets(
    byKey: Map<string, ThreadMentionTarget>,
    input: {
      tenantId: string;
      spaceId?: string | null;
      includeAllProfiles?: boolean;
    },
  ) {
    let profiles: WorkspaceAgentFolderProfile[] | null = null;
    try {
      profiles = await listAgentFolderProfilesForTenant(input.tenantId);
    } catch (err) {
      console.warn(
        "[thread-mention-targets] agent-folder index unavailable:",
        err,
      );
    }
    for (const profile of profiles ?? []) {
      if (!profile.config.enabled) continue;
      const name = titleizeSlug(profile.slug);
      addTarget(byKey, {
        id: `agent_profile:${profile.slug}`,
        targetType: "agent_profile",
        targetId: profile.slug,
        displayName: name,
        aliases: [name, profile.slug].filter(isString),
        role: "Agent Profile",
        description: profile.config.description,
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

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
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
