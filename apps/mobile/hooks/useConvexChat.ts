/**
 * Chat hook — replaces useConvexChat with GraphQL-based implementation.
 *
 * Uses useSendMessage() mutation and useMessages() query from urql hooks.
 * Now uses threadId (PRD-15 thread unification).
 */

import { useMessages, useSendMessage } from "@/lib/hooks/use-messages";
import type { ChatMessage } from "./useGatewayChat";

export interface CallerIdentity {
  name?: string;
  email?: string;
  role?: string;
  isOwner?: boolean;
}

export function useConvexChat(threadId: string, caller?: CallerIdentity) {
  const [{ data: messagesData }] = useMessages(threadId);
  const [, sendMessageMutation] = useSendMessage();

  const messages = messagesData?.messages;
  const edges = messages?.edges ?? [];

  const chatMessages: ChatMessage[] = edges.map((edge: any) => {
    const m = edge.node;
    return {
      id: m.id,
      role: (m.role ?? "user") as ChatMessage["role"],
      content: (m.content ?? "").trim(),
      artifactId: null,
      artifact: null,
      structuredData: m.metadata ? JSON.parse(m.metadata) : null,
      uiEnvelope: null,
      timestamp: new Date(m.createdAt).getTime(),
      isStreaming: false,
    };
  }).reverse(); // Messages come in desc order, reverse for display

  const sendMessage = async (
    content: string,
    mentions?: Array<{ id: string; name: string; type: "member" | "assistant" }>
  ) => {
    try {
      await sendMessageMutation({
        input: {
          threadId: threadId,
          role: "USER",
          content,
          senderType: "user",
          ...(caller?.name ? { metadata: JSON.stringify({ callerName: caller.name, mentions }) } : {}),
        },
      });
    } catch (e) {
      console.error("[GraphQLChat] sendMessage FAILED:", e);
    }
  };

  // Show typing indicator when the last message is from the user
  const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const isPending = lastMsg?.role === "user";

  return {
    messages: chatMessages,
    sendMessage,
    isConnected: true,
    isStreaming: isPending,
    historyLoaded: messagesData !== undefined,
  };
}
