import type { MentionCandidate } from "@/components/chat/MentionAutocomplete";
import type { MessageInputMention } from "@/components/input/MessageInputFooter";

export interface ThreadMentionTargetLike {
  id: string;
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
}

export function mentionCandidatesForTargets(
  targets: ThreadMentionTargetLike[],
): MentionCandidate[] {
  return targets.map((target) => ({
    id: target.id,
    name: target.displayName,
    displayName: target.displayName,
    targetId: target.targetId,
    targetType: target.targetType,
    type: target.targetType === "AGENT" ? "assistant" : "member",
  }));
}

export function sendMessageMentionsForInput(mentions: MessageInputMention[]) {
  return mentions.map((mention) => ({
    targetType: mention.targetType,
    targetId: mention.targetId,
    displayName: mention.displayName,
    rawText: mention.rawText,
  }));
}
