export interface ThreadAgentModeMessage {
  role?: string | null;
  senderType?: string | null;
  senderId?: string | null;
  sender?: {
    type?: string | null;
    id?: string | null;
  } | null;
}

export interface ThreadAgentModeMention {
  targetType: "USER" | "AGENT";
  targetId: string;
}

export type ThreadAgentMode = "single" | "multi";

export function deriveThreadAgentMode(input: {
  currentUserId?: string | null;
  messages?: ThreadAgentModeMessage[];
  draftMentions?: ThreadAgentModeMention[];
}): ThreadAgentMode {
  const { currentUserId, messages = [], draftMentions = [] } = input;

  const otherHumanPosted = currentUserId
    ? messages.some((message) => {
        const role = message.role?.toUpperCase();
        const senderType = (
          message.sender?.type ??
          message.senderType ??
          ""
        ).toLowerCase();
        const senderId = message.sender?.id ?? message.senderId ?? null;

        return (
          role === "USER" &&
          senderType !== "agent" &&
          Boolean(senderId) &&
          senderId !== currentUserId
        );
      })
    : false;

  const draftMentionsOtherUser = draftMentions.some(
    (mention) =>
      mention.targetType === "USER" && mention.targetId !== currentUserId,
  );

  return otherHumanPosted || draftMentionsOtherUser ? "multi" : "single";
}

export function deriveThreadAgentDefault(input: {
  currentUserId?: string | null;
  messages?: ThreadAgentModeMessage[];
  draftMentions?: ThreadAgentModeMention[];
}): {
  mode: ThreadAgentMode;
  agentDefaultOn: boolean;
} {
  const mode = deriveThreadAgentMode(input);
  return { mode, agentDefaultOn: mode === "single" };
}
