export const BUILT_IN_AGENT_PROFILE_KEYS = [
  "research",
  "coding",
  "analyst",
  "reviewer",
] as const;

export const DEFAULT_PROFILE_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export type BuiltInProfileKey = (typeof BUILT_IN_AGENT_PROFILE_KEYS)[number];

export interface BuiltInProfileSeed {
  built_in_key: BuiltInProfileKey;
  slug: string;
  name: string;
  description: string;
  routing_guidance: string;
  instructions: string;
  tool_policy: Record<string, unknown>;
  skill_policy: Record<string, unknown>;
  execution_controls: Record<string, unknown>;
}

export const BUILT_IN_PROFILE_SEEDS: BuiltInProfileSeed[] = [
  {
    built_in_key: "research",
    slug: "research",
    name: "Research",
    description: "Delegates focused research, source finding, and synthesis.",
    routing_guidance:
      "Use for web, document, and knowledge-gathering subtasks that need citations or source comparison.",
    instructions:
      "Research the assigned question, cite the sources you used, and return a concise answer with relevant evidence.",
    tool_policy: { builtInTools: ["web-search", "web-extract"] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
    },
  },
  {
    built_in_key: "coding",
    slug: "coding",
    name: "Coding",
    description: "Delegates code inspection, implementation, and test tasks.",
    routing_guidance:
      "Use for software engineering subtasks in Spaces where coding work is allowed.",
    instructions:
      "Inspect the relevant files, make scoped code recommendations or changes, and report verification clearly.",
    tool_policy: { builtInTools: ["execute_code", "bash"] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
    },
  },
  {
    built_in_key: "analyst",
    slug: "analyst",
    name: "Analyst",
    description:
      "Delegates data analysis, metric review, and structured reporting.",
    routing_guidance:
      "Use for data, spreadsheet, CRM, and quantitative analysis subtasks.",
    instructions:
      "Analyze the assigned data or tool results, state assumptions, and return decision-ready findings.",
    tool_policy: { builtInTools: [], mcpServers: [] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
    },
  },
  {
    built_in_key: "reviewer",
    slug: "reviewer",
    name: "Reviewer",
    description:
      "Reviews agent outputs for quality, correctness, and completeness.",
    routing_guidance:
      "Use before final response when an answer, artifact, or delegated result needs a quality gate, or when the parent Agent is uncertain whether the output is good enough.",
    instructions:
      "Review the candidate agent output against the user's request and available evidence. Return a concise verdict with one of: pass, revise, or fail. If the output should not be sent, explain exactly what must change and give actionable feedback for the parent Agent to improve it. Do not rewrite the full answer unless asked; focus on decision-quality review.",
    tool_policy: { builtInTools: [] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      reviewGate: true,
      maxReviewLoops: 2,
    },
  },
];
