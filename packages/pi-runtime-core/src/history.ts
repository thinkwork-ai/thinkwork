import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@earendil-works/pi-ai";

interface HistoryMessage {
  role?: unknown;
  content?: unknown;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function textFromAssistant(
  message: AssistantMessage | undefined,
): string {
  if (!message) return "";
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function normalizeHistory(
  history: unknown,
  currentModelId: string,
): Message[] {
  if (!Array.isArray(history)) return [];
  const messages: Message[] = [];
  for (const entry of history as HistoryMessage[]) {
    const role = entry?.role;
    if (typeof entry.content !== "string" || !entry.content.trim()) continue;
    const content = entry.content;
    if (role === "user") {
      messages.push({
        role: "user",
        content,
        timestamp: Date.now(),
      } as Message);
      continue;
    }
    if (role === "assistant") {
      const textPart: TextContent = { type: "text", text: content };
      messages.push({
        role: "assistant",
        content: [textPart],
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: currentModelId,
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      } as Message);
    }
  }
  return messages;
}
