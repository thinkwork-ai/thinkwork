import type { MessageInputMention } from "@/components/input/MessageInputFooter";
import { sendMessageMentionsForInput } from "@/lib/thread-mentions";
import {
  buildSendMessageMutationVariables,
  type SendMessageGoalMode,
} from "@thinkwork/react-native-sdk";

export interface ThreadConversationSendVariablesArgs {
  threadId: string;
  content: string;
  currentUserId?: string | null;
  mentions?: MessageInputMention[];
  modelId?: string | null;
  goalMode?: SendMessageGoalMode | null;
}

export function sendableThreadConversationMentions(
  content: string,
  mentions: readonly MessageInputMention[] | null | undefined,
) {
  return (mentions ?? [])
    .filter(isSendableMention)
    .filter((mention) => content.includes(mention.rawText));
}

export function buildThreadConversationSendVariables({
  threadId,
  content,
  currentUserId,
  mentions = [],
  modelId,
  goalMode,
}: ThreadConversationSendVariablesArgs) {
  const mentionsToSend = sendableThreadConversationMentions(content, mentions);
  const variables = buildSendMessageMutationVariables(threadId, content, {
    senderType: "user",
    ...(currentUserId ? { senderId: currentUserId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(goalMode ? { goalMode } : {}),
  });

  return {
    ...variables,
    input: {
      ...variables.input,
      ...(mentionsToSend.length > 0
        ? { mentions: sendMessageMentionsForInput(mentionsToSend) }
        : {}),
    },
  };
}

export function isSendableMention(
  mention: MessageInputMention,
): mention is MessageInputMention & {
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  rawText: string;
} {
  return Boolean(
    mention.targetType &&
      mention.targetId &&
      mention.displayName &&
      mention.rawText,
  );
}
