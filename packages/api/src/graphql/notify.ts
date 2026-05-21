/**
 * AppSync subscription notifications.
 * Fires mutations on AppSync to trigger @aws_subscribe fan-out to WebSocket clients.
 */

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";

async function postToAppSync(
  mutation: string,
  variables: Record<string, unknown>,
): Promise<void> {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) return;
  try {
    const response = await fetch(APPSYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APPSYNC_API_KEY,
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
