export type SkillTemplateKey = "script-tool" | "knowledge" | "process" | "blank";

export type SkillTemplateIcon = "Code" | "FileText" | "Wand2" | "Zap";

export type SkillTemplate = {
  label: string;
  description: string;
  icon: SkillTemplateIcon;
  skillMd: string;
  extraFiles?: Record<string, string>;
};

export type RenderSkillTemplateOptions = {
  template: SkillTemplateKey;
  name: string;
  description?: string;
  category?: string;
  tags?: string | string[];
};

export const SKILL_AUTHORING_TEMPLATES: Record<SkillTemplateKey, SkillTemplate> = {
  "script-tool": {
    label: "Script Tool",
    description: "Skill with embedded Python scripts the agent executes directly",
    icon: "Code",
    skillMd: `---
name: {{slug}}
display_name: {{name_yaml}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
execution: script
mode: tool
category: {{category}}
tags:{{tags_yaml}}
scripts:
  - name: {{slug_underscore}}_action
    path: scripts/tool.py
    description: Execute the main action for this skill.
    default_enabled: true
---

# {{name}}

## Tools

Describe the tools this skill provides.

## Usage

Explain when and how to use this skill.
`,
    extraFiles: {
      "scripts/tool.py": `"""{{name}} - custom skill script."""

import json


def {{slug_underscore}}_action(query: str) -> str:
    """Execute the main action for this skill.

    Args:
        query: The user's request.

    Returns:
        JSON result.
    """
    return json.dumps({"result": f"Processed: {query}"})
`,
    },
  },
  knowledge: {
    label: "Knowledge Skill",
    description: "Domain-specific instructions with no tools - pure context",
    icon: "FileText",
    skillMd: `---
name: {{slug}}
display_name: {{name_yaml}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
execution: context
mode: tool
category: {{category}}
tags:{{tags_yaml}}
---

# {{name}}

## Overview

Describe the domain knowledge this skill provides.

## Key Principles

List the most important rules and guidelines.

## References

- Read \`references/guide.md\` when you need the detailed reference for this domain.
`,
    extraFiles: {
      "references/guide.md": `# {{name}} - Reference Guide

Add detailed reference material here that the agent can load on demand.
`,
    },
  },
  process: {
    label: "Process / Workflow",
    description: "Multi-step business process with structured steps",
    icon: "Wand2",
    skillMd: `---
name: {{slug}}
display_name: {{name_yaml}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
execution: context
mode: tool
category: {{category}}
tags:{{tags_yaml}}
---

# {{name}}

## Overview

Describe what this process achieves.

## Steps Summary

1. **Step 1** - Brief description
2. **Step 2** - Brief description
3. **Step 3** - Brief description

## References

- Read \`references/steps.md\` when you need the detailed step-by-step instructions.

## Guardrails

- What NOT to do during this process.
`,
    extraFiles: {
      "references/steps.md": `# {{name}} - Detailed Steps

## Step 1: [Name]

Detailed instructions for step 1.

## Step 2: [Name]

Detailed instructions for step 2.

## Step 3: [Name]

Detailed instructions for step 3.
`,
    },
  },
  blank: {
    label: "Blank",
    description: "Empty template with required structure only",
    icon: "Zap",
    skillMd: `---
name: {{slug}}
display_name: {{name_yaml}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
execution: context
mode: tool
category: {{category}}
tags:{{tags_yaml}}
---

# {{name}}

Add your skill instructions here.
`,
  },
};

export const SKILL_CATEGORIES = [
  { value: "productivity", label: "Productivity" },
  { value: "integrations", label: "Integrations" },
  { value: "processes", label: "Processes" },
  { value: "knowledge", label: "Knowledge" },
  { value: "communication", label: "Communication" },
  { value: "research", label: "Research" },
  { value: "custom", label: "Custom" },
];

export function slugifySkillName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function skillSlugToPythonIdentifier(slug: string): string {
  return slug.replace(/-/g, "_");
}

export function parseSkillTags(tags: string | string[] | undefined): string[] {
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.trim()).filter(Boolean);
  }
  return (tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function buildLocalSkillPath(slug: string, path = "SKILL.md"): string {
  const cleanSlug = slugifySkillName(slug);
  const cleanPath = path.split("/").filter(Boolean).join("/");
  return cleanPath ? `skills/${cleanSlug}/${cleanPath}` : `skills/${cleanSlug}`;
}

export function renderSkillTemplate(options: RenderSkillTemplateOptions): string {
  const template = SKILL_AUTHORING_TEMPLATES[options.template];
  return renderTemplateString(template.skillMd, options);
}

export function renderSkillExtraFiles(
  options: RenderSkillTemplateOptions,
): Record<string, string> {
  const template = SKILL_AUTHORING_TEMPLATES[options.template];
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(template.extraFiles ?? {})) {
    out[path] = renderTemplateString(content, options);
  }
  return out;
}

function renderTemplateString(source: string, options: RenderSkillTemplateOptions): string {
  const slug = slugifySkillName(options.name);
  const name = options.name.trim();
  const description = options.description?.trim().replace(/\s+/g, " ") || `Custom skill: ${name}`;
  const tags = parseSkillTags(options.tags);
  const tagsYaml =
    tags.length === 0 ? " []" : `\n${tags.map((tag) => `  - ${yamlScalar(tag)}`).join("\n")}`;
  return source
    .replace(/\{\{name_yaml\}\}/g, yamlScalar(name))
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{slug\}\}/g, slug)
    .replace(/\{\{slug_underscore\}\}/g, skillSlugToPythonIdentifier(slug))
    .replace(/\{\{description\}\}/g, description)
    .replace(/\{\{category\}\}/g, yamlScalar(options.category || "custom"))
    .replace(/\{\{tags_yaml\}\}/g, tagsYaml);
}

function yamlScalar(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
