import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

export interface WorkspaceSkill {
  slug: string;
  name: string;
  description: string;
  skillPath: string;
  content: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frontmatterValue(source: string, key: string): string | undefined {
  if (!source.startsWith("---\n")) return undefined;
  const end = source.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const frontmatter = source.slice(4, end);
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match?.[1] === key) return unquote(match[2] ?? "");
  }
  return undefined;
}

async function walk(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries.sort()) {
    const abs = path.join(dir, entry);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      found.push(...(await walk(abs)));
    } else if (
      st.isFile() &&
      entry === "SKILL.md" &&
      path.basename(path.dirname(path.dirname(abs))) === "skills"
    ) {
      found.push(abs);
    }
  }
  return found;
}

export async function discoverWorkspaceSkills(
  workspaceDir: string,
): Promise<WorkspaceSkill[]> {
  const skillFiles = await walk(workspaceDir);
  const bySlug = new Map<string, WorkspaceSkill>();

  for (const skillPath of skillFiles) {
    const slug = path.basename(path.dirname(skillPath));
    if (!slug || bySlug.has(slug)) continue;
    let content: string;
    try {
      content = await readFile(skillPath, "utf8");
    } catch {
      continue;
    }
    bySlug.set(slug, {
      slug,
      name:
        frontmatterValue(content, "display_name") ??
        frontmatterValue(content, "name") ??
        slug,
      description: frontmatterValue(content, "description") ?? "",
      skillPath,
      content,
    });
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
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

export function buildWorkspaceSkillTool(
  skills: WorkspaceSkill[],
): AgentTool<any> | null {
  if (!skills.length) return null;
  const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  return {
    name: "workspace_skill",
    label: "Workspace Skill",
    description:
      "Read a skill installed in this agent's copied workspace/skills folder before using its instructions.",
    parameters: Type.Object({
      slug: Type.String({ description: "Workspace skill slug." }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
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
}
