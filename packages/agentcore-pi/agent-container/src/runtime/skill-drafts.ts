export const SKILL_CREATOR_WORKSPACE_SKILL_SLUG = "skill-creator";

export interface RuntimeSkillCreatorCommandPayload {
  type: "skill_creator";
  source: "slash_command";
  command: "/skill-creator";
  draftApi?: {
    target?: string;
    workspaceFilesApi?: string;
  };
}

export function parseSkillCreatorCommandPayload(
  value: unknown,
): RuntimeSkillCreatorCommandPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== "skill_creator" ||
    record.source !== "slash_command" ||
    record.command !== "/skill-creator"
  ) {
    return null;
  }
  const draftApi =
    record.draftApi && typeof record.draftApi === "object"
      ? (record.draftApi as Record<string, unknown>)
      : {};
  return {
    type: "skill_creator",
    source: "slash_command",
    command: "/skill-creator",
    draftApi: {
      target:
        typeof draftApi.target === "string" ? draftApi.target : "skillDraftId",
      workspaceFilesApi:
        typeof draftApi.workspaceFilesApi === "string"
          ? draftApi.workspaceFilesApi
          : "/api/workspaces/files",
    },
  };
}

export function formatSkillCreatorCommandContext(
  command: RuntimeSkillCreatorCommandPayload | null,
): string {
  if (!command) return "";
  const target = command.draftApi?.target ?? "skillDraftId";
  const workspaceFilesApi =
    command.draftApi?.workspaceFilesApi ?? "/api/workspaces/files";
  return [
    "<skill_creator_command>",
    "The user invoked /skill-creator for this turn.",
    `Read and follow the ${SKILL_CREATOR_WORKSPACE_SKILL_SLUG} workspace skill before drafting or editing a skill.`,
    "Help the user create or improve a ThinkWork skill through an interview-driven workflow.",
    `When persisting draft files, use the ThinkWork workspace files API (${workspaceFilesApi}) with target ${target}; do not write directly to tenant S3.`,
    "A skill should not be published to the Skill Library until the user approves it.",
    "</skill_creator_command>",
  ].join("\n");
}
