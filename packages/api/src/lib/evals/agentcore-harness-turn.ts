import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  harnessManagedThreadEnrollments,
  messages,
  tenants,
  threadParticipants,
  threads,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { ensureDefaultThreadSpace } from "../spaces/default-space.js";
import { requireHarnessManagedProfile } from "../harness/managed-profile.js";
import type { EvalReplayHistoryMessage } from "./agentcore-direct.js";

export interface CanonicalHarnessEvalTurn {
  threadId: string;
  threadTurnId: string;
  triggeringMessageId: string;
}

export interface CanonicalHarnessEvalResult {
  output: string;
  composedSystemPrompt: string | null;
  usage: Record<string, unknown> | null;
}

/**
 * Create the same persisted identity tuple a human chat turn uses, but in a
 * system-hidden evaluation thread. Harness authorization is consequently
 * minted from a real user message + participant + managed enrollment; evals
 * never gain a special identity bypass.
 */
export async function createCanonicalHarnessEvalTurn(input: {
  tenantId: string;
  tenantSlug: string;
  agentId: string;
  requesterUserId: string;
  sessionId: string;
  message: string;
  messagesHistory?: EvalReplayHistoryMessage[];
}): Promise<CanonicalHarnessEvalTurn> {
  if (!input.requesterUserId.trim()) {
    throw new Error(
      "AgentCore Harness evaluations require an exact requester user identity.",
    );
  }
  const database = getDb();
  const [space, profile] = await Promise.all([
    ensureDefaultThreadSpace({
      tenantId: input.tenantId,
      userId: input.requesterUserId,
    }),
    requireHarnessManagedProfile(input.tenantSlug),
  ]);
  const createdAt = new Date();

  return database.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
      .where(eq(tenants.id, input.tenantId))
      .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
    if (!tenant) throw new Error("Tenant not found for Harness evaluation");

    const existingThreads = await tx
      .select({
        id: threads.id,
        workspaceFolderName: threads.workspace_folder_name,
      })
      .from(threads)
      .where(eq(threads.tenant_id, input.tenantId));
    const identifier = `EVAL-${tenant.nextNumber}`;
    const title = `Evaluation ${input.sessionId}`.slice(0, 160);
    const [thread] = await tx
      .insert(threads)
      .values({
        tenant_id: input.tenantId,
        agent_id: input.agentId,
        space_id: space.id,
        user_id: input.requesterUserId,
        number: tenant.nextNumber,
        identifier,
        title,
        workspace_folder_name: workspaceFolderName(
          title,
          existingThreads.map((row) => row.workspaceFolderName ?? row.id),
          "thread",
        ),
        status: "in_progress",
        channel: "chat",
        created_by_type: "user",
        created_by_id: input.requesterUserId,
        metadata: {
          systemHidden: true,
          visibility: "system_hidden",
          purpose: "evaluation",
          evalSessionId: input.sessionId,
          runtimeType: "agentcore",
        },
        created_at: createdAt,
        updated_at: createdAt,
      })
      .returning({ id: threads.id });

    await tx.insert(threadParticipants).values({
      tenant_id: input.tenantId,
      thread_id: thread.id,
      space_id: space.id,
      participant_type: "user",
      user_id: input.requesterUserId,
      role: "requester",
      source: "eval_runner",
      notification_preference: "muted",
      last_read_at: createdAt,
    });
    await tx.insert(harnessManagedThreadEnrollments).values({
      tenant_id: input.tenantId,
      thread_id: thread.id,
      logical_agent_id: input.agentId,
      trust_profile: "default",
      harness_arn: profile.harnessArn,
      qualifier: profile.endpointName,
      resolved_version: profile.liveVersion,
      session_strategy: "fresh",
      prior_runtime: "pi",
      status: "active",
      enrolled_by_user_id: input.requesterUserId,
    });

    let sequence = 0;
    for (const history of input.messagesHistory ?? []) {
      await tx.insert(messages).values({
        thread_id: thread.id,
        tenant_id: input.tenantId,
        role: history.role,
        content: history.content,
        sender_type: history.role === "user" ? "user" : "agent",
        sender_id:
          history.role === "user" ? input.requesterUserId : input.agentId,
        metadata: { evalReplay: true },
        created_at: new Date(createdAt.getTime() + sequence++),
      });
    }
    const [message] = await tx
      .insert(messages)
      .values({
        thread_id: thread.id,
        tenant_id: input.tenantId,
        role: "user",
        content: input.message,
        sender_type: "user",
        sender_id: input.requesterUserId,
        metadata: { evalSessionId: input.sessionId },
        created_at: new Date(createdAt.getTime() + sequence),
      })
      .returning({ id: messages.id });

    const [turn] = await tx
      .insert(threadTurns)
      .values({
        tenant_id: input.tenantId,
        agent_id: input.agentId,
        thread_id: thread.id,
        triggering_message_id: message.id,
        invocation_source: "eval",
        runtime_type: "agentcore",
        status: "running",
        turn_number: 1,
        context_snapshot: {
          evalMode: true,
          useMemory: false,
          evalSessionId: input.sessionId,
        },
        started_at: createdAt,
        last_activity_at: createdAt,
      })
      .returning({ id: threadTurns.id });

    return {
      threadId: thread.id,
      threadTurnId: turn.id,
      triggeringMessageId: message.id,
    };
  });
}

export async function loadCanonicalHarnessEvalResult(input: {
  tenantId: string;
  threadTurnId: string;
}): Promise<CanonicalHarnessEvalResult> {
  const database = getDb();
  const [turn] = await database
    .select({
      status: threadTurns.status,
      error: threadTurns.error,
      finalizedAt: threadTurns.finalized_at,
      resultJson: threadTurns.result_json,
      usageJson: threadTurns.usage_json,
      systemPrompt: threadTurns.system_prompt,
    })
    .from(threadTurns)
    .where(
      and(
        eq(threadTurns.id, input.threadTurnId),
        eq(threadTurns.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!turn?.finalizedAt) {
    throw new Error(
      "AgentCore Harness evaluation returned before finalization",
    );
  }
  if (turn.status !== "succeeded") {
    throw new Error(
      turn.error || `AgentCore Harness evaluation ${turn.status ?? "failed"}`,
    );
  }
  const result =
    turn.resultJson && typeof turn.resultJson === "object"
      ? (turn.resultJson as Record<string, unknown>)
      : {};
  const usage =
    turn.usageJson && typeof turn.usageJson === "object"
      ? (turn.usageJson as Record<string, unknown>)
      : null;
  return {
    output: typeof result.response === "string" ? result.response : "",
    composedSystemPrompt: turn.systemPrompt?.trim() || null,
    usage,
  };
}

export function canonicalHarnessEvalTraceId(sessionId: string): string {
  return `eval-${randomUUID()}-${sessionId}`.slice(0, 200);
}
