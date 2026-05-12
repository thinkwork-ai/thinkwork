export type SkillTemplateKey =
  | "script-tool"
  | "knowledge"
  | "process"
  | "runbook"
  | "blank";

export type SkillTemplateIcon =
  | "Code"
  | "FileText"
  | "ListChecks"
  | "Wand2"
  | "Zap";

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

export const SKILL_AUTHORING_TEMPLATES: Record<
  SkillTemplateKey,
  SkillTemplate
> = {
  "script-tool": {
    label: "Script Tool",
    description:
      "Skill with embedded Python scripts the agent executes directly",
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
  runbook: {
    label: "Computer Runbook",
    description:
      "Skill with a Computer routing, confirmation, phase, and output contract",
    icon: "ListChecks",
    skillMd: `---
name: {{slug}}
display_name: {{name_yaml}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
  thinkwork_kind: computer-runbook
  thinkwork_runbook_contract: references/thinkwork-runbook.json
execution: context
mode: tool
category: {{category}}
tags:{{tags_yaml}}
---

# {{name}}

Use this skill when the user wants repeatable substantial Computer work that should be routed, confirmed, executed as phases, and shown as a queue.

Start by reading \`references/thinkwork-runbook.json\` for routing, confirmation, phase, output, and asset contracts. Then load only the reference file for the active phase.

Follow the phase order unless the active run snapshot tells you otherwise: discover scope, analyze inputs, produce the requested output, then validate the result. Keep evidence and assumptions visibly separated.
`,
    extraFiles: {
      "references/thinkwork-runbook.json": `{
  "version": "1.0.0",
  "sourceVersion": "1.0.0",
  "routing": {
    "explicitAliases": [
      "{{slug_spaces}}",
      "{{name}}"
    ],
    "triggerExamples": [
      "Run the {{name}} runbook.",
      "Use {{name}} for this request.",
      "Create the {{name}} output from these inputs."
    ],
    "confidenceHints": [
      "The user asks for repeatable multi-step work matching {{name}}.",
      "The expected output needs planning, production, and validation rather than a short answer."
    ]
  },
  "inputs": [
    {
      "id": "scope",
      "label": "Scope",
      "description": "The person, team, account, topic, dataset, or business area this run should cover.",
      "required": false,
      "source": "user"
    }
  ],
  "confirmation": {
    "title": "Run {{name}}",
    "summary": "Computer will discover the relevant context, analyze the inputs, produce the requested output, and validate the result before presenting it.",
    "expectedOutputs": [
      "Completed output",
      "Evidence and assumptions",
      "Validation notes"
    ],
    "likelyTools": [
      "workspace search",
      "connected data sources",
      "artifact builder"
    ],
    "phaseSummary": [
      "Discover the relevant scope, sources, and constraints.",
      "Analyze inputs, gaps, and output requirements.",
      "Produce the requested output.",
      "Validate correctness, grounding, and usability."
    ]
  },
  "phases": [
    {
      "id": "discover",
      "title": "Discover context",
      "guidance": "references/discover.md",
      "capabilityRoles": ["research"],
      "dependsOn": [],
      "taskSeeds": [
        "Identify the requested scope, available sources, and constraints.",
        "Inventory missing inputs, assumptions, and decisions needed before production."
      ]
    },
    {
      "id": "analyze",
      "title": "Analyze requirements",
      "guidance": "references/analyze.md",
      "capabilityRoles": ["analysis"],
      "dependsOn": ["discover"],
      "taskSeeds": [
        "Turn discovered context into output requirements and evaluation criteria.",
        "Separate evidence-backed facts from assumptions or unresolved gaps."
      ]
    },
    {
      "id": "produce",
      "title": "Produce output",
      "guidance": "references/produce.md",
      "capabilityRoles": ["artifact_build"],
      "dependsOn": ["analyze"],
      "taskSeeds": [
        "Create the requested output using the runbook guidance and active workspace context.",
        "Persist any generated artifact with run metadata when the output is an app or document artifact."
      ]
    },
    {
      "id": "validate",
      "title": "Validate result",
      "guidance": "references/validate.md",
      "capabilityRoles": ["validation"],
      "dependsOn": ["produce"],
      "taskSeeds": [
        "Check that the output satisfies the requested scope and phase requirements.",
        "Document evidence, assumptions, and any follow-up risks."
      ]
    }
  ],
  "outputs": [
    {
      "id": "primary_output",
      "title": "{{name}} output",
      "type": "artifact",
      "description": "The primary deliverable produced by this runbook-capable skill."
    },
    {
      "id": "validation_summary",
      "title": "Validation summary",
      "type": "evidence",
      "description": "Notes covering grounding, assumptions, and output quality checks."
    }
  ],
  "overrides": {
    "allowedFields": [
      "catalog.description",
      "approval.summary",
      "approval.expectedOutputs",
      "routing.triggerExamples"
    ]
  }
}
`,
      "references/discover.md": `# {{name}} - Discover

Identify the user's scope, available source material, missing inputs, constraints, and success criteria. Keep a short list of assumptions that need to remain visible later.
`,
      "references/analyze.md": `# {{name}} - Analyze

Convert the discovered context into concrete output requirements. Separate facts from inference, decide what the output must include, and note any quality checks that should happen before completion.
`,
      "references/produce.md": `# {{name}} - Produce

Create the requested output from the analyzed requirements. If the output is an app or artifact, persist it through the appropriate artifact save path and include run metadata.
`,
      "references/validate.md": `# {{name}} - Validate

Verify that the output matches the requested scope, is grounded in the available sources, and clearly labels assumptions, gaps, and recommended follow-up.
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
  { value: "artifact", label: "Artifact" },
  { value: "dashboard", label: "Dashboard" },
  { value: "research", label: "Research" },
  { value: "map", label: "Map" },
  { value: "productivity", label: "Productivity" },
  { value: "integrations", label: "Integrations" },
  { value: "processes", label: "Processes" },
  { value: "knowledge", label: "Knowledge" },
  { value: "communication", label: "Communication" },
  { value: "custom", label: "Custom" },
];

export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

export function renderSkillTemplate(
  options: RenderSkillTemplateOptions,
): string {
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

function renderTemplateString(
  source: string,
  options: RenderSkillTemplateOptions,
): string {
  const slug = slugifySkillName(options.name);
  const name = options.name.trim();
  const description =
    options.description?.trim().replace(/\s+/g, " ") || `Custom skill: ${name}`;
  const parsedTags = parseSkillTags(options.tags);
  const tags =
    options.template === "runbook"
      ? Array.from(new Set(["computer-runbook", ...parsedTags]))
      : parsedTags;
  const tagsYaml =
    tags.length === 0
      ? " []"
      : `\n${tags.map((tag) => `  - ${yamlScalar(tag)}`).join("\n")}`;
  return source
    .replace(/\{\{name_yaml\}\}/g, yamlScalar(name))
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{slug\}\}/g, slug)
    .replace(/\{\{slug_spaces\}\}/g, slug.replace(/-/g, " "))
    .replace(/\{\{slug_underscore\}\}/g, skillSlugToPythonIdentifier(slug))
    .replace(/\{\{description\}\}/g, description)
    .replace(/\{\{category\}\}/g, yamlScalar(options.category || "custom"))
    .replace(/\{\{tags_yaml\}\}/g, tagsYaml);
}

function yamlScalar(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
