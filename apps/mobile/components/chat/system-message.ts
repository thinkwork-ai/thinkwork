import type { ChatMessage } from "@/hooks/useGatewayChat";

const SYSTEM_CONTEXT_PREFIX = "[SYSTEM CONTEXT";
const SYSTEM_INSTRUCTION_TAG = "[SYSTEM INSTRUCTION]";
const INTERACTION_TAG = "[INTERACTION]";
const END_SYSTEM_TAG = "[END SYSTEM]";

export function isSystemMessage(message: Pick<ChatMessage, "content">): boolean {
  const content = message.content?.trim() ?? "";
  return (
    content.startsWith(SYSTEM_CONTEXT_PREFIX) ||
    (content.includes(SYSTEM_INSTRUCTION_TAG) && !content.includes(INTERACTION_TAG))
  );
}

export function getRenderableMessageContent(
  message: Pick<ChatMessage, "content">,
  showSystemMessages: boolean,
): string | null {
  const content = message.content?.replace(/\[\[\s*reply_to[^\]]*\]\]\s*/g, "").trim() ?? "";

  if (!content) return null;

  const interactionMatch = content.match(/\[INTERACTION\](.*?)\[\/INTERACTION\]/s);
  const interactionText = interactionMatch?.[1]?.trim() ?? null;

  if (content.includes(SYSTEM_INSTRUCTION_TAG)) {
    if (!showSystemMessages) {
      return interactionText;
    }

    return content;
  }

  if (content.startsWith(SYSTEM_CONTEXT_PREFIX)) {
    if (!showSystemMessages) return null;

    const endIndex = content.indexOf(END_SYSTEM_TAG);
    if (endIndex === -1) return content;
    return content.slice(0, endIndex + END_SYSTEM_TAG.length).trim();
  }

  return content;
}

export function isInteractionOnlyMessage(content: string): boolean {
  return content.includes(SYSTEM_INSTRUCTION_TAG) && content.includes(INTERACTION_TAG);
}
