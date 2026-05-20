import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  spaceAgentAssignments,
  spaceMembers,
  tenantMembers,
  threadParticipants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import type {
  MentionTarget,
  MentionTargetType,
} from "./parse-message-mentions.js";

export interface ThreadMentionTarget extends MentionTarget {
  id: string;
  avatarUrl?: string | null;
  role?: string | null;
}

export interface ThreadMentionTargetsRepository {
  loadThread(input: {
    tenantId: string;
    threadId: string;
  }): Promise<{ id: string; tenantId: string; spaceId: string | null } | null>;
  loadTargets(input: {
    tenantId: string;
    threadId: string;
    spaceId?: string | null;
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
  });
}

class DrizzleThreadMentionTargetsRepository implements ThreadMentionTargetsRepository {
  private readonly db = getDb();

  async loadThread(input: { tenantId: string; threadId: string }) {
    const [row] = await this.db
      .select({
        id: threads.id,
        tenantId: threads.tenant_id,
        spaceId: threads.space_id,
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
          role: row.role,
        });
      }

      const assignmentRows = await this.db
        .select({
          role: spaceAgentAssignments.local_role,
          agentId: agents.id,
          agentName: agents.name,
          agentSlug: agents.slug,
          agentAvatarUrl: agents.avatar_url,
        })
        .from(spaceAgentAssignments)
        .innerJoin(agents, eq(agents.id, spaceAgentAssignments.agent_id))
        .where(
          and(
            eq(spaceAgentAssignments.tenant_id, input.tenantId),
            eq(spaceAgentAssignments.space_id, input.spaceId),
            eq(spaceAgentAssignments.status, "active"),
          ),
        );
      for (const row of assignmentRows) {
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
          ne(agents.status, "archived"),
        ),
      );
    for (const row of tenantAgentRows) {
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

    return [...byKey.values()].filter((target) => target.targetId);
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
}): ThreadMentionTarget | null {
  if (row.participantType === "agent" && row.agentId) {
    return {
      id: `agent:${row.agentId}`,
      targetType: "agent",
      targetId: row.agentId,
      displayName: row.agentName ?? row.agentSlug ?? "Agent",
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
  if (!byKey.has(key)) byKey.set(key, target);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
