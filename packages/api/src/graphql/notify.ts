import { getConfig, getAppsyncApiKey } from "@thinkwork/runtime-config";

/**
 * AppSync subscription notifications.
 * Fires mutations on AppSync to trigger @aws_subscribe fan-out to WebSocket clients.
 */

// Read AppSync config at CALL time, not module load. AgentCore warm containers
// can boot before env injection, and tests set env after import — capturing at
// module load locks in stale/empty values. See feedback_vitest_env_capture_timing
// + project_agentcore_deploy_race_env.
function appsyncConfig(): { endpoint: string; apiKey: string } {
  return {
    endpoint: getConfig("APPSYNC_ENDPOINT") || "",
    apiKey: getAppsyncApiKey(),
  };
}

async function postToAppSync(
  mutation: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const { endpoint, apiKey } = appsyncConfig();
  if (!endpoint || !apiKey) return;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const body = await response.text();
    if (!response.ok || body.includes('"errors"')) {
      console.error(`[notify] AppSync error: ${response.status} ${body}`);
    }
  } catch (err) {
    console.error(`[notify] AppSync fetch error:`, err);
  }
}

export async function notifyThreadUpdate(payload: {
  threadId: string;
  tenantId: string;
  status: string;
  title: string;
}): Promise<void> {
  await postToAppSync(
    `mutation($threadId: ID!, $tenantId: ID!, $status: String!, $title: String!) {
			notifyThreadUpdate(threadId: $threadId, tenantId: $tenantId, status: $status, title: $title) {
				threadId tenantId status title updatedAt
			}
		}`,
    payload,
  );
}

export async function notifyThreadActivity(payload: {
  userId: string;
  tenantId: string;
  threadId: string;
  messageId: string;
  authorId?: string | null;
  authorType: string;
  snippet?: string | null;
  threadTitle?: string | null;
  createdAt?: string | null;
}): Promise<void> {
  await postToAppSync(
    `mutation($userId: ID!, $tenantId: ID!, $threadId: ID!, $messageId: ID!, $authorId: ID, $authorType: String!, $snippet: String, $threadTitle: String, $createdAt: AWSDateTime) {
			notifyThreadActivity(userId: $userId, tenantId: $tenantId, threadId: $threadId, messageId: $messageId, authorId: $authorId, authorType: $authorType, snippet: $snippet, threadTitle: $threadTitle, createdAt: $createdAt) {
				userId threadId messageId authorId authorType snippet threadTitle createdAt
			}
		}`,
    {
      userId: payload.userId,
      tenantId: payload.tenantId,
      threadId: payload.threadId,
      messageId: payload.messageId,
      authorId: payload.authorId ?? null,
      authorType: payload.authorType,
      snippet: payload.snippet ?? null,
      threadTitle: payload.threadTitle ?? null,
      createdAt: payload.createdAt ?? null,
    },
  );
}

export async function notifyNewMessage(payload: {
  messageId: string;
  threadId: string;
  tenantId: string;
  role: string;
  content?: string;
  senderType?: string;
  senderId?: string;
  ownerType?: string;
  ownerId?: string;
}): Promise<void> {
  const owner = deriveMessageOwner(payload);
  await postToAppSync(
    `mutation($messageId: ID!, $threadId: ID!, $tenantId: ID!, $role: String!, $content: String, $senderType: String, $senderId: ID, $ownerType: String, $ownerId: ID) {
			notifyNewMessage(messageId: $messageId, threadId: $threadId, tenantId: $tenantId, role: $role, content: $content, senderType: $senderType, senderId: $senderId, ownerType: $ownerType, ownerId: $ownerId) {
				messageId threadId tenantId role content senderType senderId ownerType ownerId createdAt
			}
		}`,
    { ...payload, ...owner },
  );
}

export async function notifyWorkspaceAccessRevoked(payload: {
  tenantId: string;
  spaceId: string;
  userId: string;
  revokedAt: string;
}): Promise<void> {
  await postToAppSync(
    `mutation($tenantId: ID!, $spaceId: ID!, $userId: ID!, $revokedAt: AWSDateTime!) {
      notifyWorkspaceAccessRevoked(tenantId: $tenantId, spaceId: $spaceId, userId: $userId, revokedAt: $revokedAt) {
        tenantId spaceId userId revokedAt
      }
    }`,
    payload,
  );
}

function deriveMessageOwner(payload: {
  role: string;
  senderType?: string;
  senderId?: string;
  ownerType?: string;
  ownerId?: string;
}) {
  const senderType = payload.senderType?.toLowerCase() ?? "";
  let ownerType = payload.ownerType?.toLowerCase() ?? senderType;
  if (ownerType === "assistant") ownerType = "agent";
  if (!["agent", "computer", "system", "user"].includes(ownerType)) {
    const role = payload.role.toLowerCase();
    ownerType =
      role === "assistant"
        ? "agent"
        : role === "system" || role === "tool"
          ? "system"
          : "user";
  }
  return {
    ownerType,
    ownerId: payload.ownerId ?? payload.senderId,
  };
}

/**
 * Fire a mid-turn activity step to AppSync (onThreadTurnStep subscribers).
 * Best-effort — postToAppSync swallows errors. The durable record is the
 * thread_turn_events row already persisted by the caller; a dropped notify
 * costs latency, not data (the client replays via threadTurnEvents(afterSeq)).
 */
export async function notifyThreadTurnStep(payload: {
  runId: string;
  threadId: string;
  tenantId: string;
  seq: number;
  eventType: string;
  stream?: string | null;
  level?: string | null;
  color?: string | null;
  message?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}): Promise<void> {
  await postToAppSync(
    `mutation($runId: ID!, $threadId: ID!, $tenantId: ID!, $seq: Int!, $eventType: String!, $stream: String, $level: String, $color: String, $message: String, $payload: AWSJSON, $createdAt: AWSDateTime!) {
			notifyThreadTurnStep(runId: $runId, threadId: $threadId, tenantId: $tenantId, seq: $seq, eventType: $eventType, stream: $stream, level: $level, color: $color, message: $message, payload: $payload, createdAt: $createdAt) {
				runId threadId tenantId seq eventType stream level color message payload createdAt
			}
		}`,
    {
      runId: payload.runId,
      threadId: payload.threadId,
      tenantId: payload.tenantId,
      seq: payload.seq,
      eventType: payload.eventType,
      stream: payload.stream ?? null,
      level: payload.level ?? null,
      color: payload.color ?? null,
      message: payload.message ?? null,
      payload: payload.payload ? JSON.stringify(payload.payload) : null,
      createdAt: payload.createdAt,
    },
  );
}

export async function publishComputerThreadChunk(payload: {
  threadId: string;
  chunk: Record<string, unknown>;
  seq: number;
}): Promise<void> {
  await postToAppSync(
    `mutation($threadId: ID!, $chunk: AWSJSON!, $seq: Int!) {
			publishComputerThreadChunk(threadId: $threadId, chunk: $chunk, seq: $seq) {
				threadId chunk seq publishedAt
			}
		}`,
    {
      threadId: payload.threadId,
      chunk: JSON.stringify(payload.chunk),
      seq: payload.seq,
    },
  );
}
