// Turn-driving + event→ChatMessage mapping for the on-device harness chat mode.
//
// This is the testable core the `useHarnessChat` hook wraps: it runs one harness turn and
// emits ChatMessage snapshots (optimistic user message, streaming assistant text, final
// assistant turn) via `onUpdate`. Kept under lib/ so vitest covers it (the hook itself is a
// thin React wrapper). The renderer is unchanged — these ChatMessages feed the shared
// ChatView exactly like the GraphQL/Gateway modes.

import type { ChatMessage } from "../../hooks/useGatewayChat";
import { createAgentSession } from "./session";
import { buildTurnContext } from "./turn-context";
import type { ImagePart, Message, ModelProvider, Tool } from "./types";

let idCounter = 0;
function genId(seed: number): string {
  idCounter += 1;
  return `harness-${seed.toString(36)}-${idCounter.toString(36)}`;
}

/** Map the visible ChatMessage transcript to harness messages (user + assistant text only). */
function toHarnessMessages(prior: ChatMessage[]): Message[] {
  return prior
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export interface RunHarnessChatTurnInput {
  userText: string;
  images?: ImagePart[];
  /** The existing visible transcript. */
  prior: ChatMessage[];
  provider: ModelProvider;
  tools?: Tool[];
  agentName?: string;
  model?: string;
  /** Injected clock so ids/timestamps are deterministic in tests. */
  now: () => number;
  /** Called with the full updated message list as the turn progresses. */
  onUpdate: (messages: ChatMessage[]) => void;
}

const ERROR_TEXT = "Something went wrong handling that turn. Please try again.";

export async function runHarnessChatTurn(
  input: RunHarnessChatTurnInput,
): Promise<ChatMessage[]> {
  const { provider, tools = [], agentName, model, now, onUpdate } = input;
  const ts = now();

  const userMsg: ChatMessage = {
    id: genId(ts),
    role: "user",
    content: input.userText,
    timestamp: ts,
  };
  let assistant: ChatMessage = {
    id: genId(ts),
    role: "assistant",
    content: "",
    timestamp: ts + 1,
    isStreaming: true,
  };

  const snapshot = (): ChatMessage[] => [...input.prior, userMsg, assistant];
  onUpdate(snapshot());

  const { system, tools: turnTools } = buildTurnContext({ agentName, tools });
  const session = createAgentSession({
    modelProvider: provider,
    model,
    systemPrompt: system,
    tools: turnTools,
    messages: toHarnessMessages(input.prior),
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "assistant_text") {
      assistant = { ...assistant, content: event.text };
      onUpdate(snapshot());
    }
  });

  let result;
  try {
    result = await session.prompt(input.userText, input.images);
  } finally {
    unsubscribe();
  }

  const failed = result.stopReason === "error";
  assistant = {
    ...assistant,
    content: result.finalText || (failed ? ERROR_TEXT : assistant.content),
    isStreaming: false,
  };
  const final = snapshot();
  onUpdate(final);
  return final;
}
