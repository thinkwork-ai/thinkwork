export type MentionTargetType = "user" | "agent";

export interface MentionTarget {
  targetType: MentionTargetType;
  targetId: string;
  displayName: string;
  aliases?: string[];
}

export interface ExplicitMentionInput {
  targetType: string;
  targetId: string;
  displayName?: string | null;
  rawText?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
}

export interface ParsedMention {
  targetType: MentionTargetType;
  targetId: string;
  displayName: string;
  rawText: string | null;
  startOffset: number | null;
  endOffset: number | null;
}

export function parseMessageMentions(input: {
  content?: string | null;
  targets: MentionTarget[];
  explicitMentions?: ExplicitMentionInput[] | null;
}): ParsedMention[] {
  const byKey = new Map<string, MentionTarget>();
  for (const target of input.targets) {
    byKey.set(mentionKey(target.targetType, target.targetId), target);
  }

  const mentions = new Map<string, ParsedMention>();
  for (const explicit of input.explicitMentions ?? []) {
    const targetType = normalizeTargetType(explicit.targetType);
    if (!targetType) continue;
    const target = byKey.get(mentionKey(targetType, explicit.targetId));
    if (!target) continue;
    mentions.set(mentionKey(targetType, target.targetId), {
      targetType,
      targetId: target.targetId,
      displayName: explicit.displayName?.trim() || target.displayName,
      rawText: explicit.rawText?.trim() || null,
      startOffset: integerOrNull(explicit.startOffset),
      endOffset: integerOrNull(explicit.endOffset),
    });
  }

  const content = input.content ?? "";
  if (content.includes("@")) {
    for (const match of findTextMentions(content, input.targets)) {
      const key = mentionKey(match.targetType, match.targetId);
      if (!mentions.has(key)) mentions.set(key, match);
    }
  }

  return [...mentions.values()];
}

function findTextMentions(
  content: string,
  targets: MentionTarget[],
): ParsedMention[] {
  const aliases = targets
    .flatMap((target) =>
      [target.displayName, ...(target.aliases ?? [])].map((alias) => ({
        alias: alias.trim(),
        target,
      })),
    )
    .filter((item) => item.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  const result: ParsedMention[] = [];

  for (const { alias, target } of aliases) {
    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
      "iu",
    );
    const match = pattern.exec(content);
    if (!match) continue;
    const startOffset = match.index + match[1].length;
    result.push({
      targetType: target.targetType,
      targetId: target.targetId,
      displayName: target.displayName,
      rawText: content.slice(startOffset, startOffset + alias.length + 1),
      startOffset,
      endOffset: startOffset + alias.length + 1,
    });
  }

  return result;
}

function normalizeTargetType(value: string): MentionTargetType | null {
  const normalized = value.toLowerCase();
  return normalized === "user" || normalized === "agent" ? normalized : null;
}

function mentionKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function integerOrNull(value: number | null | undefined) {
  return Number.isInteger(value) ? (value as number) : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
