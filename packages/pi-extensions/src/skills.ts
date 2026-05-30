import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

export interface WorkspaceSkill {
  slug: string;
  name: string;
  description: string;
  skillPath: string;
  content: string;
}

export interface SkillsExtensionOptions {
  skills: WorkspaceSkill[];
}

export function formatWorkspaceSkills(skills: WorkspaceSkill[]): string {
  if (!skills.length) return "";
  return [
    "Workspace skills are available from the copied local workspace tree.",
    "Use the workspace_skill tool to read the full instructions before applying one.",
    "",
    ...skills.map(
      (skill) => `- ${skill.slug}: ${skill.description || skill.name}`,
    ),
  ].join("\n");
}

export function createSkillsExtension(
  options: SkillsExtensionOptions,
): ThinkworkExtension {
  const skills = options.skills;
  return defineExtension({
    name: "thinkwork-skills",
    toolNames: skills.length > 0 ? ["workspace_skill"] : [],
    register(pi) {
      if (!skills.length) return;

      const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
      const tool: ToolDefinition = {
        name: "workspace_skill",
        label: "Workspace Skill",
        description:
          "Read a skill installed in this agent's copied workspace/skills folder before using its instructions.",
        parameters: Type.Object({
          slug: Type.String({ description: "Workspace skill slug." }),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const slug = String((params as { slug?: unknown }).slug || "").trim();
          const skill = bySlug.get(slug);
          if (!skill) {
            throw new Error(
              `Unknown workspace skill '${slug}'. Available: ${skills
                .map((item) => item.slug)
                .join(", ")}`,
            );
          }
          return {
            content: [{ type: "text", text: skill.content }],
            details: {
              slug: skill.slug,
              name: skill.name,
              description: skill.description,
              path: skill.skillPath,
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
