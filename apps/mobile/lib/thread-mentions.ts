import type { MentionCandidate } from "@/components/chat/MentionAutocomplete";
import type { MessageInputMention } from "@/components/input/MessageInputFooter";

export interface ThreadMentionTargetLike {
  id: string;
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  aliases?: string[] | null;
  isDefaultAgent?: boolean | null;
  avatarUrl?: string | null;
  role?: string | null;
  email?: string | null;
  description?: string | null;
}

export function mentionCandidatesForTargets(
  targets: readonly ThreadMentionTargetLike[] | null | undefined,
): MentionCandidate[] {
  return (targets ?? []).map((target) => {
    const candidate: MentionCandidate = {
      id: target.id,
      name: target.displayName,
      displayName: target.displayName,
      targetId: target.targetId,
      targetType: target.targetType,
      type: target.targetType === "AGENT" ? "assistant" : "member",
    };
    if (target.aliases) candidate.aliases = target.aliases;
    if (target.isDefaultAgent !== null && target.isDefaultAgent !== undefined) {
      candidate.isDefaultAgent = target.isDefaultAgent;
    }
    if (target.avatarUrl !== null && target.avatarUrl !== undefined) {
      candidate.avatarUrl = target.avatarUrl;
    }
    if (target.role !== null && target.role !== undefined) {
      candidate.role = target.role;
    }
    if (target.email !== null && target.email !== undefined) {
      candidate.email = target.email;
    }
    if (target.description !== null && target.description !== undefined) {
      candidate.description = target.description;
    }
    return candidate;
  });
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
    .filter(
      (candidate) =>
        candidate.name.toLowerCase().startsWith(normalizedQuery) ||
        candidate.aliases?.some((alias) =>
          alias.toLowerCase().includes(normalizedQuery),
        ) ||
        candidate.role?.toLowerCase().includes(normalizedQuery) ||
        candidate.email?.toLowerCase().includes(normalizedQuery) ||
        candidate.description?.toLowerCase().includes(normalizedQuery),
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
