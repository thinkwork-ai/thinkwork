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

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();
  return candidates
    .filter((candidate) =>
      candidate.name.toLowerCase().startsWith(normalizedQuery),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function currentMentionQuery(
  text: string,
  cursorPos: number,
): string | null {
  const safeCursorPos = Math.max(0, Math.min(cursorPos, text.length));
  const before = text.slice(0, safeCursorPos);
  const match = /(?:^|\s)@([\w.'-]*)$/u.exec(before);
  return match ? match[1] : null;
}
