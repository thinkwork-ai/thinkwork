// On-device harness chat hook.
//
// Thin React wrapper around runHarnessChatTurn (the tested core in lib/agent). Runs the
// agent loop on the device against the cloud Bedrock provider (no AWS creds on device —
// the provider POSTs to /api/model/converse with the Cognito idToken). Returns the same
// shape the GraphQL/Gateway chat hooks return, so it drops straight into the shared
// ChatView. v1 starts a fresh in-memory session (historyLoaded immediately true);
// persistence into platform threads lands in U7.

import { useCallback, useRef, useState } from "react";
import { getIdToken } from "../lib/auth";
import { BedrockModelProvider } from "../lib/agent/providers/bedrock";
import { runHarnessChatTurn } from "../lib/agent/harness-chat-core";
import type { Tool } from "../lib/agent/types";
import type { ChatMessage, ConnectionStatus } from "./useGatewayChat";

export interface UseHarnessChatOptions {
  agentName?: string;
  /** Inference-profile model id (us.*); defaults to the proxy's configured model. */
  model?: string;
  /** Tools available this turn (network/MCP + capability tools). */
  tools?: Tool[];
}

export interface UseHarnessChatResult {
  messages: ChatMessage[];
  send: (text: string) => void;
  connectionStatus: ConnectionStatus;
  isStreaming: boolean;
  historyLoaded: boolean;
}

export function useHarnessChat(
  opts: UseHarnessChatOptions = {},
): UseHarnessChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // One provider instance for the hook's lifetime; getToken resolves the idToken per call.
  const providerRef = useRef(
    new BedrockModelProvider({ getToken: getIdToken }),
  );
  // Mirror messages in a ref so send() reads the latest transcript without re-creating.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const streamingRef = useRef(false);
  streamingRef.current = isStreaming;

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || streamingRef.current) return;
      setIsStreaming(true);
      void runHarnessChatTurn({
        userText: text,
        prior: messagesRef.current,
        provider: providerRef.current,
        tools: opts.tools,
        agentName: opts.agentName,
        model: opts.model,
        now: () => Date.now(),
        onUpdate: setMessages,
      }).finally(() => setIsStreaming(false));
    },
    [opts.tools, opts.agentName, opts.model],
  );

  return {
    messages,
    send,
    connectionStatus: "connected",
    isStreaming,
    historyLoaded: true,
  };
}
