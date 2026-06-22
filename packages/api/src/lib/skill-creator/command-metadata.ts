export const SKILL_CREATOR_COMMAND = "/skill-creator";
export const SKILL_CREATOR_FALLBACK_PROMPT =
  "Help me create a new ThinkWork skill.";

export interface SkillCreatorCommandMetadata {
  type: "skill_creator";
  source: "slash_command";
  command: typeof SKILL_CREATOR_COMMAND;
}

export interface SkillCreatorCommandNormalization {
  content: string;
  command: SkillCreatorCommandMetadata | null;
}

const COMMAND_RE = /(^|\s)\/skill-creator(?=\s|$)/u;

export function normalizeSkillCreatorCommandContent(
  content: string,
): SkillCreatorCommandNormalization {
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

export function appendSkillCreatorCommandMetadata(
  metadata: Record<string, unknown>,
  command: SkillCreatorCommandMetadata | null | undefined,
): Record<string, unknown> {
  if (!command) return metadata;
  return {
    ...metadata,
    command,
  };
}

export function parseSkillCreatorCommandMetadata(
  metadata: unknown,
): SkillCreatorCommandMetadata | null {
  const record = parseJsonRecord(metadata);
  const command = record.command;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return null;
  }
  const commandRecord = command as Record<string, unknown>;
  if (
    commandRecord.type !== "skill_creator" ||
    commandRecord.source !== "slash_command" ||
    commandRecord.command !== SKILL_CREATOR_COMMAND
  ) {
    return null;
  }
  return {
    type: "skill_creator",
    source: "slash_command",
    command: SKILL_CREATOR_COMMAND,
  };
}

export interface RuntimeSkillCreatorCommandPayload {
  type: "skill_creator";
  source: "slash_command";
  command: typeof SKILL_CREATOR_COMMAND;
  draftApi: {
    target: "skillDraftId";
    workspaceFilesApi: "/api/workspaces/files";
  };
}

export function toRuntimeSkillCreatorCommandPayload(
  command: SkillCreatorCommandMetadata | null | undefined,
): RuntimeSkillCreatorCommandPayload | undefined {
  if (!command) return undefined;
  return {
    type: command.type,
    source: command.source,
    command: command.command,
    draftApi: {
      target: "skillDraftId",
      workspaceFilesApi: "/api/workspaces/files",
    },
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseJsonRecord(parsed);
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
