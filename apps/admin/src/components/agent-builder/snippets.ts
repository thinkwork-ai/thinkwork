export interface SnippetDefinition {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const AGENT_BUILDER_SNIPPETS: SnippetDefinition[] = [
  {
    id: "routing-row",
    name: "Routing row",
    description: "A starter row for AGENTS.md routing tables.",
    content: "| New task | specialist/ | specialist/CONTEXT.md |  |\n",
  },
  {
    id: "guardrails-section",
    name: "Guardrails section",
    description: "A compact safety boundary section.",
    content:
      "\n## Boundaries\n\n- Ask before taking irreversible actions.\n- Keep tenant data scoped to the current workspace.\n",
  },
  {
    id: "identity-block",
    name: "Identity block",
    description: "A starter identity paragraph.",
    content:
      "\n## Role\n\nYou are responsible for this folder's specialist work. Stay within this scope and escalate anything outside it.\n",
  },
  {
    id: "context-section",
    name: "Context section",
    description: "A folder-scope context scaffold.",
    content:
      "\n## What This Folder Handles\n\nDescribe the work this sub-agent owns, the signals it should watch for, and when it should hand control back.\n",
  },
];

export const STARTER_AGENT_TEMPLATES: SnippetDefinition[] = [
  {
    id: "single-agent",
    name: "Single agent",
    description: "Root-only AGENTS.md routing scaffold.",
    content:
      "## Routing\n\n| Task | Go to | Read | Skills |\n| --- | --- | --- | --- |\n| General work | ./ | CONTEXT.md |  |\n",
  },
  {
    id: "two-specialists",
    name: "Two specialists",
    description: "Delegator with support and operations specialists.",
    content:
      "## Routing\n\n| Task | Go to | Read | Skills |\n| --- | --- | --- | --- |\n| Support triage | support/ | support/CONTEXT.md |  |\n| Operations follow-up | operations/ | operations/CONTEXT.md |  |\n",
  },
];
