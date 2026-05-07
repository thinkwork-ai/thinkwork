import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { computerDelegations } from "@thinkwork/database-pg/schema";

const db = getDb();

type DelegationTerminalInputBase = {
  tenantId: string;
  agentId: string;
  threadId: string;
  threadTurnId: string;
  messageId?: string;
};

export async function markConnectorDelegationTurnCompleted(
  input: DelegationTerminalInputBase & {
    responseText: string;
    usage?: Record<string, unknown>;
  },
) {
  const responsePreview = input.responseText.slice(0, 1000);
  const rows = await updateRunningConnectorDelegation(input, {
    status: "completed",
    result: {
      threadTurnId: input.threadTurnId,
      threadId: input.threadId,
      agentId: input.agentId,
      messageId: input.messageId ?? null,
      status: "succeeded",
      responsePreview,
      responseLength: input.responseText.length,
      usage: input.usage ?? null,
    },
    error: null,
  });

  return {
    updatedCount: rows.length,
    delegationIds: rows.map((row) => row.id),
  };
}

export async function markConnectorDelegationTurnFailed(
  input: DelegationTerminalInputBase & {
    errorMessage: string;
    errorCode?: string | null;
  },
) {
  const rows = await updateRunningConnectorDelegation(input, {
    status: "failed",
    result: null,
    error: {
      threadTurnId: input.threadTurnId,
      threadId: input.threadId,
      agentId: input.agentId,
      messageId: input.messageId ?? null,
      status: "failed",
      message: input.errorMessage.slice(0, 2000),
      code: input.errorCode ?? null,
    },
  });

  return {
    updatedCount: rows.length,
    delegationIds: rows.map((row) => row.id),
  };
}

async function updateRunningConnectorDelegation(
  input: DelegationTerminalInputBase,
  terminal: {
    status: "completed" | "failed";
    result: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
  },
) {
  if (!input.messageId) return [];

  const outputArtifacts = {
    threadTurnId: input.threadTurnId,
    threadId: input.threadId,
    agentId: input.agentId,
    messageId: input.messageId,
  };
  const conditions = [
    eq(computerDelegations.tenant_id, input.tenantId),
    eq(computerDelegations.agent_id, input.agentId),
    eq(computerDelegations.status, "running"),
    sql`${computerDelegations.input_artifacts}->>'threadId' = ${input.threadId}`,
    sql`${computerDelegations.input_artifacts}->>'messageId' = ${input.messageId}`,
  ];

  return db
    .update(computerDelegations)
    .set({
      status: terminal.status,
      output_artifacts: outputArtifacts,
      result: terminal.result,
      error: terminal.error,
      completed_at: new Date(),
    })
    .where(and(...conditions))
    .returning({
      id: computerDelegations.id,
      status: computerDelegations.status,
    });
}
