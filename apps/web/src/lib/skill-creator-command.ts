export const SKILL_CREATOR_COMMAND = "/skill-creator";
export const SKILL_CREATOR_FALLBACK_PROMPT =
  "Help me create a new ThinkWork skill.";

export interface SkillCreatorCommandMetadata {
  type: "skill_creator";
  source: "slash_command";
  command: typeof SKILL_CREATOR_COMMAND;
}

const COMMAND_RE = /(^|\s)\/skill-creator(?=\s|$)/u;

export function normalizeSkillCreatorCommandContent(content: string): {
  content: string;
  command: SkillCreatorCommandMetadata | null;
} {
  const match = COMMAND_RE.exec(content);
  if (!match) return { content, command: null };

  const before = content.slice(0, match.index + (match[1]?.length ?? 0));
  const after = content.slice(match.index + match[0].length);
  const normalizedContent = `${before}${after}`.replace(/\s+/g, " ").trim();
  return {
    content: normalizedContent || SKILL_CREATOR_FALLBACK_PROMPT,
    command: {
      type: "skill_creator",
      source: "slash_command",
      command: SKILL_CREATOR_COMMAND,
    },
  };
}

export function isSkillCreatorSlashQuery(query: string | null): boolean {
  if (query === null) return false;
  if (query.trim() === "") return false;
  return "skill-creator".startsWith(query.toLowerCase());
}
