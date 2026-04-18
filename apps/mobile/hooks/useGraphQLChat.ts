import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMessages, useSendMessage } from "@/lib/hooks/use-messages";
import { useMutation } from "urql";
import { CreateThreadMutation } from "@/lib/graphql-queries";
import { useNewMessageSubscription } from "@thinkwork/react-native-sdk";
import type { ChatMessage } from "./useGatewayChat";

export interface CallerIdentity {
  name?: string;
  email?: string;
  role?: string;
  isOwner?: boolean;
}

/**
 * GraphQL-backed chat hook — replacement for useConvexChat.
 *
 * Fetches messages via urql query + subscribes to new messages via
 * the OnNewMessage subscription. Sends messages via the SendMessage mutation.
 *
 * Thread lifecycle: if no threadId is provided, one is auto-created on
 * the first sendMessage call (channel: "CHAT").
 */
export function useGraphQLChat(
  agentId: string,
  threadId?: string,
  tenantId?: string,
  caller?: CallerIdentity,
) {
  // Track the active threadId — either passed in or auto-created
  const [localThreadId, setLocalThreadId] = useState<string | undefined>(threadId);
  const activeThreadId = threadId || localThreadId;

  // Thread creation
  const [, executeCreateThread] = useMutation(CreateThreadMutation);
  const creatingThread = useRef(false);

  // Sync prop threadId into local state
  useEffect(() => {
    if (threadId) setLocalThreadId(threadId);
  }, [threadId]);

  const [{ data, fetching }, reexecuteMessages] = useMessages(activeThreadId);
  const [, executeSendMessage] = useSendMessage();

  // Subscribe to real-time new messages
  const [subResult] = useNewMessageSubscription(activeThreadId);

  // Track whether we're waiting for a response
  const [waitingForResponse, setWaitingForResponse] = useState(false);

  // Optimistic messages — shown immediately before API round-trip completes
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);

  // --- Build messages from query ---
  const queryMessages: ChatMessage[] = useMemo(() => {
    const edges = data?.messages?.edges ?? [];
    return edges.map((edge: any) => {
      const m = edge.node;
      const normalizedRole = (m.role || "").toLowerCase();
      // Parse toolResults from AWSJSON string
      let toolResults: Array<Record<string, unknown>> | null = null;
      if (m.toolResults) {
        console.log('[GenUI] Raw toolResults:', typeof m.toolResults, String(m.toolResults).slice(0, 200));
        try {
          const parsed = typeof m.toolResults === 'string' ? JSON.parse(m.toolResults) : m.toolResults;
          if (Array.isArray(parsed) && parsed.length > 0) {
            toolResults = parsed;
            console.log('[GenUI] Parsed toolResults:', parsed.length, 'items, first _type:', parsed[0]?._type);
          }
        } catch (e) {
          console.error('[GenUI] Failed to parse toolResults:', e);
        }
      } else {
        if (normalizedRole === 'assistant') {
          console.log('[GenUI] No toolResults on assistant message:', m.id);
        }
      }

      return {
        id: m.id,
        role: (normalizedRole === "user" ? "user" : "assistant") as ChatMessage["role"],
        content: (m.content ?? "").trim(),
        durableArtifact: m.durableArtifact ?? null,
        toolResults,
        timestamp: new Date(m.createdAt).getTime(),
        isStreaming: false,
      };
    });
  }, [data]);

  // Merge subscription events into message list
  const [subMessages, setSubMessages] = useState<ChatMessage[]>([]);
  const seenIds = useRef(new Set<string>());

  // Reset sub messages when thread changes (keep optimistic — they clear on server confirm)
  useEffect(() => {
    setSubMessages([]);
    seenIds.current.clear();
  }, [activeThreadId]);

  // When a subscription event arrives, append it if not already in query results
  useEffect(() => {
    const event = subResult.data?.onNewMessage;
    if (!event?.messageId) return;
    if (seenIds.current.has(event.messageId)) return;
    seenIds.current.add(event.messageId);

    const newMsg: ChatMessage = {
      id: event.messageId,
      role: ((event.role || "").toLowerCase() === "user" ? "user" : "assistant") as ChatMessage["role"],
      content: (event.content ?? "").trim(),
      timestamp: new Date(event.createdAt).getTime(),
      isStreaming: false,
    };

    // Clear optimistic messages when server confirms the user message —
    // batched in the same setState cycle to avoid flash
    if (newMsg.role === "user") {
      setOptimisticMessages([]);
    }

    setSubMessages((prev) => [...prev, newMsg]);

    // Also refetch query to stay in sync
    reexecuteMessages({ requestPolicy: "network-only" });

    // Stop waiting if we got an assistant message
    if (newMsg.role === "assistant") {
      setWaitingForResponse(false);
    }
  }, [subResult.data]);

  // Auto-detect "waiting for response" when last message is from user
  // (covers the case where first message was sent outside this hook)
  useEffect(() => {
    if (!activeThreadId || fetching) return;
    const lastMsg = queryMessages[queryMessages.length - 1];
    if (lastMsg?.role === "user" && !waitingForResponse) {
      setWaitingForResponse(true);
    }
  }, [queryMessages, activeThreadId, fetching]);

  // Polling fallback: refetch messages every 5s while waiting for a response
  // Catches responses the subscription might miss (e.g., WS not connected yet)
  useEffect(() => {
    if (!waitingForResponse || !activeThreadId) return;
    const interval = setInterval(() => {
      reexecuteMessages({ requestPolicy: "network-only" });
    }, 5000);
    return () => clearInterval(interval);
  }, [waitingForResponse, activeThreadId, reexecuteMessages]);

  // Combine query messages + subscription messages, deduplicated
  const chatMessages: ChatMessage[] = useMemo(() => {
    const queryIds = new Set(queryMessages.map((m) => m.id));
    const extra = subMessages.filter((m) => !queryIds.has(m.id));
    const confirmed = [...queryMessages, ...extra];

    // Clear optimistic messages once the real data includes a user message
    // with matching content (i.e., the server confirmed it)
    const confirmedContents = new Set(
      confirmed.filter((m) => m.role === "user").map((m) => m.content),
    );
    const pending = optimisticMessages.filter(
      (m) => !confirmedContents.has(m.content),
    );

    return [...pending, ...confirmed];
  }, [queryMessages, subMessages, optimisticMessages]);

  // Synthetic typing placeholder that morphs into the real assistant message.
  // By keeping the same `__typing__` key, FlatList re-renders the cell in-place
  // instead of unmounting/mounting — no layout shift.
  const wasWaitingRef = useRef(false);
  const replacementIdRef = useRef<string | null>(null);

  const displayMessages = useMemo(() => {
    const hasStreaming = chatMessages.some(m => m.isStreaming);
    // Typing indicator disabled for now — can re-enable by removing the `false &&`
    const showTyping = false && waitingForResponse && !hasStreaming;

    if (showTyping) {
      wasWaitingRef.current = true;
      replacementIdRef.current = null;
      return [
        {
          id: '__typing__',
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          isStreaming: false,
          isTypingPlaceholder: true,
        },
        ...chatMessages,
      ];
    }

    // Transition: was waiting -> got response. Identify the new assistant message.
    // Sub messages are appended chronologically so the assistant msg may be
    // anywhere in the array — find it by role + highest timestamp.
    if (wasWaitingRef.current) {
      wasWaitingRef.current = false;
      let newest: ChatMessage | null = null;
      for (const m of chatMessages) {
        if (m.role === 'assistant' && (!newest || m.timestamp > newest.timestamp)) {
          newest = m;
        }
      }
      if (newest) {
        replacementIdRef.current = newest.id;
      }
    }

    // Keep the replacement aliased as __typing__ so FlatList reuses the cell
    if (replacementIdRef.current) {
      const realId = replacementIdRef.current;
      const replacement = chatMessages.find(m => m.id === realId);
      if (replacement) {
        const rest = chatMessages.filter(m => m.id !== realId);
        return [
          { ...replacement, id: '__typing__', isTypingPlaceholder: false },
          ...rest,
        ];
      }
      // Message disappeared (refetch reordered), clear alias
      replacementIdRef.current = null;
    }

    return chatMessages;
  }, [chatMessages, waitingForResponse]);

  const sendMessage = useCallback(
    async (
      content: string,
      mentions?: Array<{ id: string; name: string; type: "member" | "assistant" }>,
    ) => {
      console.log("[GraphQLChat] sendMessage called:", content, "agentId:", agentId);

      let tid = activeThreadId;

      // Auto-create thread if we don't have one
      if (!tid && tenantId && !creatingThread.current) {
        creatingThread.current = true;
        try {
          const result = await executeCreateThread({
            input: {
              tenantId,
              agentId,
              title: "Chat",
              channel: "CHAT",
            },
          });
          tid = result.data?.createThread?.id;
          if (tid) {
            setLocalThreadId(tid);
            console.log("[GraphQLChat] Auto-created thread:", tid);
          } else {
            console.error("[GraphQLChat] Failed to create thread:", result.error);
            creatingThread.current = false;
            return;
          }
        } catch (e) {
          console.error("[GraphQLChat] Thread creation failed:", e);
          creatingThread.current = false;
          return;
        }
        creatingThread.current = false;
      }

      if (!tid) {
        console.error("[GraphQLChat] No threadId available, cannot send message");
        return;
      }

      // Optimistic: show message + typing indicator immediately
      const optimisticMsg: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
        isStreaming: false,
      };
      setOptimisticMessages((prev) => [...prev, optimisticMsg]);
      setWaitingForResponse(true);

      try {
        const result = await executeSendMessage({
          input: {
            threadId: tid,
            role: "USER",
            content,
            senderType: "user",
          },
        });
        if (result.error) {
          console.error("[GraphQLChat] sendMessage error:", result.error);
          // Remove optimistic message on failure
          setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
          setWaitingForResponse(false);
        } else {
          console.log("[GraphQLChat] sendMessage succeeded:", result.data?.sendMessage?.id);
        }
      } catch (e) {
        console.error("[GraphQLChat] sendMessage FAILED:", e);
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        setWaitingForResponse(false);
      }
    },
    [activeThreadId, tenantId, agentId, executeCreateThread, executeSendMessage],
  );

  return {
    messages: displayMessages,
    sendMessage,
    isConnected: true,
    isStreaming: waitingForResponse,
    historyLoaded: !fetching || optimisticMessages.length > 0 || waitingForResponse,
    threadId: activeThreadId,
  };
}
