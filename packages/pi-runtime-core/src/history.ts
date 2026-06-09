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
  return textFromContent((message as { content?: unknown }).content);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => textFromContent(part)).join("");
  }
  if (!content || typeof content !== "object") return "";

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) return textFromContent(record.content);
  if (record.content && typeof record.content === "object") {
    return textFromContent(record.content);
  }
  return "";
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
