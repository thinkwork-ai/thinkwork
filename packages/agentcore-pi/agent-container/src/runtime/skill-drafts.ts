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
  return [
    "<skill_creator_command>",
    "The user invoked /skill-creator for this turn.",
    `Read and follow the ${SKILL_CREATOR_WORKSPACE_SKILL_SLUG} workspace skill before drafting or editing a skill.`,
    "Help the user create or improve a ThinkWork skill through an interview-driven workflow.",
    "Persist candidate skill files in the workspace under skills/<skill-slug>/ with a complete SKILL.md.",
    "The SKILL.md must begin with YAML frontmatter containing at least name and description, for example: ---\\nname: <skill-slug>\\ndescription: <one clear sentence>\\n---.",
    "Put the skill operating instructions after the frontmatter; do not rely on manifest.json as a substitute for SKILL.md frontmatter.",
    "When the user asks to submit, review, approve, register, or publish the skill, ThinkWork will register the changed skill folder as a Skill Library draft during turn finalization.",
    "Do not ask the user for skillDraftId, API endpoint URLs, tenant IDs, or other internal registration details.",
    "A skill should not be published to the Skill Library until the user approves it.",
    "</skill_creator_command>",
  ].join("\n");
}
