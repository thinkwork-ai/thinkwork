import type { ReactNode } from "react";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import type { SkillOption } from "@/components/spaces/SkillMenu";
import { cn } from "@/lib/utils";

type ShortcutKind = "agent-profile" | "agent" | "user" | "skill";

interface ShortcutMention {
  targetType?: string | null;
  targetId?: string | null;
  displayName?: string | null;
  rawText?: string | null;
}

interface ShortcutSegment {
  start: number;
  end: number;
  label: string;
  kind: ShortcutKind;
}

interface InlineShortcutTextProps {
  text: string;
  mentions?: ShortcutMention[];
  mentionTargets?: MentionTarget[];
  skillCatalog?: SkillOption[];
  className?: string;
  tokenClassName?: string;
  fallbackAgentProfiles?: boolean;
  fallbackMentions?: boolean;
  fallbackSkills?: boolean;
}

const TOKEN_PREFIX_BOUNDARY = "(^|[\\s([{])";
const TOKEN_SUFFIX_BOUNDARY = "(?=$|[\\s.,!?;:)\\]}])";

export function InlineShortcutText({
  text,
  mentions = [],
  mentionTargets = [],
  skillCatalog = [],
  className,
  tokenClassName,
  fallbackAgentProfiles = false,
  fallbackMentions = false,
  fallbackSkills = false,
}: InlineShortcutTextProps) {
  if (!text) return null;

  const segments = shortcutSegmentsForText(text, {
    mentions,
    mentionTargets,
    skillCatalog,
    fallbackAgentProfiles,
    fallbackMentions,
    fallbackSkills,
  });

  if (segments.length === 0) {
    return <>{text}</>;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  segments.forEach((segment, index) => {
    if (segment.start > cursor) {
      nodes.push(text.slice(cursor, segment.start));
    }
    nodes.push(
      <span
        key={`${segment.kind}-${segment.start}-${index}`}
        className={cn(
          "inline-flex max-w-full align-baseline font-medium",
          segment.kind === "user" && "text-blue-300",
          segment.kind === "agent" && "text-cyan-300",
          segment.kind === "agent-profile" && "text-[#54a9ff]",
          segment.kind === "skill" && "text-violet-300",
          tokenClassName,
        )}
        data-shortcut-token={segment.kind}
      >
        {segment.label}
      </span>,
    );
    cursor = segment.end;
  });
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return className ? <span className={className}>{nodes}</span> : <>{nodes}</>;
}

export function shortcutSegmentsForText(
  text: string,
  options: {
    mentions?: ShortcutMention[];
    mentionTargets?: MentionTarget[];
    skillCatalog?: SkillOption[];
    fallbackAgentProfiles?: boolean;
    fallbackMentions?: boolean;
    fallbackSkills?: boolean;
  } = {},
): ShortcutSegment[] {
  const candidates: ShortcutSegment[] = [];
  const addLiteralToken = (
    token: string | null | undefined,
    label: string | null | undefined,
    kind: ShortcutKind,
  ) => {
    const normalizedToken = token?.trim();
    const normalizedLabel = label?.trim();
    if (!normalizedToken || !normalizedLabel) return;
    const expression =
      kind === "agent-profile"
        ? new RegExp(
            `(${escapeRegExp(normalizedToken)})${TOKEN_SUFFIX_BOUNDARY}`,
            "giu",
          )
        : new RegExp(
            `${TOKEN_PREFIX_BOUNDARY}(${escapeRegExp(normalizedToken)})${TOKEN_SUFFIX_BOUNDARY}`,
            "giu",
          );
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) {
      const prefix = kind === "agent-profile" ? "" : (match[1] ?? "");
      const value = kind === "agent-profile" ? (match[1] ?? "") : (match[2] ?? "");
      const start = match.index + prefix.length;
      candidates.push({
        start,
        end: start + value.length,
        label: normalizedLabel,
        kind,
      });
    }
  };

  for (const mention of options.mentions ?? []) {
    const kind = mentionKind(mention.targetType);
    if (!kind) continue;
    const label = mention.displayName?.trim();
    const rawText = mention.rawText?.trim();
    addLiteralToken(rawText, label, kind);
    if (label) {
      addLiteralToken(`${kind === "agent-profile" ? "#" : "@"}${label}`, label, kind);
    }
  }

  for (const target of options.mentionTargets ?? []) {
    const kind = mentionKind(target.targetType);
    if (!kind) continue;
    const trigger = kind === "agent-profile" ? "#" : "@";
    addLiteralToken(`${trigger}${target.displayName}`, target.displayName, kind);
    for (const alias of target.aliases ?? []) {
      addLiteralToken(`${trigger}${alias}`, target.displayName, kind);
    }
  }

  for (const skill of options.skillCatalog ?? []) {
    const label = skill.displayName?.trim() || skill.slug;
    addLiteralToken(`/${skill.slug}`, label, "skill");
  }

  if (options.fallbackAgentProfiles) {
    collectRegexTokens(
      text,
      /#([A-Za-z][\w.'-]*)/gu,
      "agent-profile",
      candidates,
    );
  }

  if (options.fallbackMentions) {
    collectRegexTokens(
      text,
      /@([A-Za-z][A-Za-z0-9_-]*)(?=$|[\s,!?;:)\]}])/gu,
      "user",
      candidates,
    );
  }

  if (options.fallbackSkills) {
    collectRegexTokens(
      text,
      /(^|[\s([{])\/([A-Za-z][\w.'-]*)/gu,
      "skill",
      candidates,
    );
  }

  return selectNonOverlapping(candidates);
}

function collectRegexTokens(
  text: string,
  expression: RegExp,
  kind: ShortcutKind,
  candidates: ShortcutSegment[],
) {
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    const hasPrefixGroup = match.length > 2;
    const prefix = hasPrefixGroup ? (match[1] ?? "") : "";
    const value = hasPrefixGroup ? (match[2] ?? "") : (match[1] ?? "");
    if (!value) continue;
    const start = match.index + prefix.length;
    candidates.push({
      start,
      end: start + value.length + 1,
      label: value,
      kind,
    });
  }
}

function selectNonOverlapping(candidates: ShortcutSegment[]) {
  const sorted = candidates
    .filter((candidate) => candidate.end > candidate.start)
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - b.start - (a.end - a.start);
    });
  const selected: ShortcutSegment[] = [];
  for (const candidate of sorted) {
    if (
      selected.some(
        (existing) =>
          candidate.start < existing.end && candidate.end > existing.start,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function mentionKind(targetType: string | null | undefined): ShortcutKind | null {
  if (targetType === "AGENT_PROFILE") return "agent-profile";
  if (targetType === "AGENT") return "agent";
  if (targetType === "USER") return "user";
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
